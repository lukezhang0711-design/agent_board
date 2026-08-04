/**
 * Session Kanban Board Atoms
 *
 * State for the session kanban board view in TrackerMode.
 * Sessions/workstreams/worktrees are organized into effective phase columns
 * (backlog, planning, implementing, validating, complete).
 *
 * A linked work-order status is projected first; metadata.phase remains the
 * fallback for sessions without a work order.
 * Only sessions with a phase appear on the board.
 */

import { atom } from 'jotai';
import { atomFamily } from '../debug/atomFamilyRegistry';
import type { SessionMeta } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import {
  sessionRegistryAtom,
  sessionProcessingAtom,
  sessionHasPendingInteractivePromptAtom,
} from './sessions';

// ============================================================
// Types
// ============================================================

/** Phase columns on the kanban board */
export type SessionPhase = 'backlog' | 'planning' | 'implementing' | 'validating' | 'complete';

/** Card type determines visual treatment and whether child run states are shown */
export type KanbanCardType = 'session' | 'workstream' | 'worktree';

/** Summary of child session states for a workstream/worktree card */
export interface ChildRunStateSummary {
  running: number;
  waiting: number;
  review: number;
  idle: number;
  done: number;
  total: number;
}

// ============================================================
// Phase Column Definitions
// ============================================================

export const SESSION_PHASE_COLUMNS: { value: SessionPhase; label: string; color: string }[] = [
  { value: 'backlog', label: 'Backlog', color: '#6b7280' },
  { value: 'planning', label: 'Planning', color: '#60a5fa' },
  { value: 'implementing', label: 'Implementing', color: '#eab308' },
  { value: 'validating', label: 'Validating', color: '#a78bfa' },
  { value: 'complete', label: 'Complete', color: '#4ade80' },
];

const VALID_PHASES = new Set<string>(SESSION_PHASE_COLUMNS.map(c => c.value));

/** Phase priority for deriving workstream phase from children (lower = more active) */
const PHASE_PRIORITY: Record<string, number> = {
  implementing: 0,
  validating: 1,
  planning: 2,
  backlog: 3,
  complete: 4,
};

type WorkOrderStatus =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'waiting'
  | 'interrupted'
  | 'completed'
  | 'failed';

const WORK_ORDER_TYPE = 'work-order';

function isWorkOrder(record: TrackerRecord): boolean {
  return record.primaryType === WORK_ORDER_TYPE
    || (Array.isArray(record.typeTags) && record.typeTags.includes(WORK_ORDER_TYPE));
}

function workOrderUpdatedAt(record: TrackerRecord): number {
  const timestamp = Date.parse(record.system.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Find the latest work-order projection associated with a session.
 *
 * `childSessionId` is the direct link written by MetaAgentService. The two
 * link collections are compatibility fallbacks for older cards and for
 * records restored through a sync/import path.
 */
export function findWorkOrderForSession(
  sessionId: string,
  records: Iterable<TrackerRecord>,
  linkedTrackerItemIds: readonly string[] = [],
): TrackerRecord | undefined {
  const linkedIds = new Set(linkedTrackerItemIds);
  const candidates: TrackerRecord[] = [];

  for (const record of records) {
    if (!isWorkOrder(record)) continue;
    const childSessionId = record.fields.childSessionId;
    const linkedSessions = record.system.linkedSessions ?? [];
    const hasDirectChildSession = typeof childSessionId === 'string' && childSessionId.trim().length > 0;
    if (
      childSessionId === sessionId
      // Once a card has a current direct child, older linked sessions must not
      // project the same reused card back onto the board as a second run.
      || (!hasDirectChildSession && (
        linkedSessions.includes(sessionId)
        || linkedIds.has(record.id)
      ))
    ) {
      candidates.push(record);
    }
  }

  candidates.sort((a, b) => {
    const updatedDifference = workOrderUpdatedAt(b) - workOrderUpdatedAt(a);
    return updatedDifference !== 0 ? updatedDifference : b.id.localeCompare(a.id);
  });
  return candidates[0];
}

/** True when a session is an older run retained in a reused work-order link. */
export function isSupersededWorkOrderSession(
  sessionId: string,
  records: Iterable<TrackerRecord>,
  linkedTrackerItemIds: readonly string[] = [],
): boolean {
  const linkedIds = new Set(linkedTrackerItemIds);
  for (const record of records) {
    if (!isWorkOrder(record)) continue;
    const childSessionId = record.fields.childSessionId;
    if (typeof childSessionId !== 'string' || childSessionId.trim().length === 0 || childSessionId === sessionId) {
      continue;
    }
    const linkedSessions = record.system.linkedSessions ?? [];
    if (linkedSessions.includes(sessionId) || linkedIds.has(record.id)) {
      return true;
    }
  }
  return false;
}

function normalizedWorkOrderStatus(status: unknown): WorkOrderStatus | undefined {
  if (typeof status !== 'string') return undefined;
  const normalized = status.trim().toLowerCase();
  return (
    normalized === 'queued'
    || normalized === 'dispatched'
    || normalized === 'running'
    || normalized === 'waiting'
    || normalized === 'interrupted'
    || normalized === 'completed'
    || normalized === 'failed'
  ) ? normalized : undefined;
}

/**
 * Map the work-order lifecycle to the five phase-board columns.
 *
 * Failed work orders stay visible in their last known non-terminal phase; if
 * history has no phase, Implementing is the visible failure bucket. This keeps
 * a failed dispatch out of Complete while the card gets a dedicated failure
 * badge below.
 */
export function phaseForWorkOrderStatus(
  status: unknown,
  fallbackPhase?: string,
): SessionPhase | undefined {
  const normalized = normalizedWorkOrderStatus(status);
  switch (normalized) {
    case 'queued':
    case 'dispatched':
      return 'planning';
    case 'running':
      return 'implementing';
    case 'waiting':
    case 'interrupted':
      return VALID_PHASES.has(fallbackPhase ?? '') && fallbackPhase !== 'complete'
        ? fallbackPhase as SessionPhase
        : 'implementing';
    case 'completed':
      return 'complete';
    case 'failed':
      return VALID_PHASES.has(fallbackPhase ?? '') && fallbackPhase !== 'complete'
        ? fallbackPhase as SessionPhase
        : 'implementing';
    default:
      return VALID_PHASES.has(fallbackPhase ?? '') ? fallbackPhase as SessionPhase : undefined;
  }
}

/** Resolve one session's board phase, including a work-order projection. */
export function effectiveSessionPhase(
  meta: SessionMeta,
  records: Iterable<TrackerRecord>,
): SessionPhase | undefined {
  const workOrder = findWorkOrderForSession(meta.id, records, meta.linkedTrackerItemIds);
  if (workOrder) {
    return phaseForWorkOrderStatus(workOrder.fields.status, meta.phase);
  }
  return VALID_PHASES.has(meta.phase ?? '') ? meta.phase as SessionPhase : undefined;
}

// ============================================================
// Helpers
// ============================================================

/** Derive the card type from session metadata */
export function getCardType(meta: SessionMeta | undefined): KanbanCardType {
  if (!meta) return 'session';
  if (meta.worktreeId) return 'worktree';
  if (meta.sessionType === 'workstream' || meta.childCount > 0) return 'workstream';
  return 'session';
}

/**
 * Derive the effective phase for a workstream parent from its children's phases.
 * Returns the "most active" child phase (implementing > validating > planning > backlog > complete).
 * Returns undefined if no children have a phase.
 */
function derivePhaseFromChildren(
  parentId: string,
  registry: Map<string, SessionMeta>,
  records: Iterable<TrackerRecord>,
): string | undefined {
  let bestPhase: string | undefined;
  let bestPriority = Infinity;

  for (const [_id, meta] of registry) {
    if (meta.parentSessionId !== parentId) continue;
    const phase = effectiveSessionPhase(meta, records);
    if (phase) {
      const priority = PHASE_PRIORITY[phase] ?? Infinity;
      if (priority < bestPriority) {
        bestPriority = priority;
        bestPhase = phase;
      }
    }
  }

  return bestPhase;
}

// ============================================================
// Filter State
// ============================================================

export interface SessionKanbanFilter {
  search: string;
  tags: string[];
  showComplete: boolean;
}

/** Filter state for the kanban board */
export const sessionKanbanFilterAtom = atom<SessionKanbanFilter>({
  search: '',
  tags: [],
  showComplete: true,
});

// ============================================================
// Derived Atoms
// ============================================================

/** Key type for the grouped map - includes 'unphased' for sessions without a phase */
export type SessionPhaseKey = SessionPhase | 'unphased';

/** Derived: sessions grouped by phase for the kanban board */
export const sessionsByPhaseAtom = atom((get) => {
  const registry = get(sessionRegistryAtom);
  const filter = get(sessionKanbanFilterAtom);
  const trackerRecords = Array.from(get(trackerItemsMapAtom).values());

  const grouped = new Map<SessionPhaseKey, SessionMeta[]>();
  grouped.set('unphased', []);
  for (const col of SESSION_PHASE_COLUMNS) {
    grouped.set(col.value, []);
  }

  for (const [_id, meta] of registry) {
    // Only show root sessions (not children of workstreams)
    if (meta.parentSessionId) continue;
    // A retry reuses the card but keeps historical session links for audit. The
    // old session must not remain as a second unlinked-looking board card.
    if (isSupersededWorkOrderSession(meta.id, trackerRecords, meta.linkedTrackerItemIds)) continue;

    // For workstream parents without an explicit phase, derive from children
    const phase = effectiveSessionPhase(meta, trackerRecords)
      ?? (meta.childCount > 0 ? derivePhaseFromChildren(meta.id, registry, trackerRecords) : undefined);
    const workOrder = findWorkOrderForSession(meta.id, trackerRecords, meta.linkedTrackerItemIds);
    const workOrderFailed = normalizedWorkOrderStatus(workOrder?.fields.status) === 'failed';

    // Skip complete if filter says hide
    if (!filter.showComplete && phase === 'complete') continue;

    // Skip archived unless in complete column
    if (meta.isArchived && phase !== 'complete' && !workOrderFailed) continue;

    // Apply search filter
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (!meta.title.toLowerCase().includes(q)) continue;
    }

    // Apply tag filter
    if (filter.tags.length > 0) {
      const sessionTags = meta.tags || [];
      if (!filter.tags.some(t => sessionTags.includes(t))) continue;
    }

    if (phase && VALID_PHASES.has(phase)) {
      grouped.get(phase as SessionPhase)!.push(meta);
    } else {
      grouped.get('unphased')!.push(meta);
    }
  }

  // Sort each column by updatedAt desc
  for (const [_phase, sessions] of grouped) {
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  return grouped;
});

/** Derived: total count of sessions on the board (with a phase) */
export const sessionKanbanTotalCountAtom = atom((get) => {
  const grouped = get(sessionsByPhaseAtom);
  let total = 0;
  for (const sessions of grouped.values()) {
    total += sessions.length;
  }
  return total;
});

/** Derived: all unique tags from root sessions (with counts) */
export const sessionKanbanTagsAtom = atom((get) => {
  const registry = get(sessionRegistryAtom);
  const tagCounts = new Map<string, number>();

  for (const [_id, meta] of registry) {
    if (meta.parentSessionId) continue;
    if (meta.tags) {
      for (const tag of meta.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
  }

  return Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
});

/**
 * True while a dispatch is queued waiting for a Head Agent slot.
 *
 * Derived straight from the registry rather than driven by its own listener:
 * the flag is persisted in session metadata and the enqueue path already fires
 * `sessions:refresh-list`, so the registry is the authoritative source and stays
 * correct across renderer reloads. Same approach as `phase`.
 */
export const sessionDispatchQueuedAtom = atomFamily((sessionId: string) =>
  atom((get): boolean => get(sessionRegistryAtom).get(sessionId)?.dispatchQueued === true)
);

/**
 * True after a Head Agent interrupts a child session. Like the queued state,
 * this derives from the refreshed registry so the board stays correct after a
 * renderer reload rather than depending on a transient event listener.
 */
export const sessionInterruptedAtom = atomFamily((sessionId: string) =>
  atom((get): boolean => get(sessionRegistryAtom).get(sessionId)?.interruptedByHead === true)
);

/** Latest tracker work-order status for a session, if one is linked. */
export const sessionWorkOrderStatusAtom = atomFamily((sessionId: string) =>
  atom((get): string | undefined => {
    const meta = get(sessionRegistryAtom).get(sessionId);
    const records = get(trackerItemsMapAtom).values();
    const workOrder = findWorkOrderForSession(sessionId, records, meta?.linkedTrackerItemIds);
    return typeof workOrder?.fields.status === 'string' ? workOrder.fields.status : undefined;
  })
);

/** Current attempt number for the card shown on a session's kanban card. */
export const sessionWorkOrderAttemptNumberAtom = atomFamily((sessionId: string) =>
  atom((get): number | undefined => {
    const meta = get(sessionRegistryAtom).get(sessionId);
    const records = get(trackerItemsMapAtom).values();
    const workOrder = findWorkOrderForSession(sessionId, records, meta?.linkedTrackerItemIds);
    if (!workOrder) return undefined;
    const attempts = Array.isArray(workOrder.fields.attempts) ? workOrder.fields.attempts : [];
    const status = normalizedWorkOrderStatus(workOrder.fields.status);
    const isTerminal = status === 'completed' || status === 'failed';
    return Math.max(1, attempts.length + (isTerminal ? 0 : 1));
  })
);

/** True when the linked work order is terminally failed. */
export const sessionWorkOrderFailedAtom = atomFamily((sessionId: string) =>
  atom((get): boolean => normalizedWorkOrderStatus(get(sessionWorkOrderStatusAtom(sessionId))) === 'failed')
);

// ============================================================
// Child Run State Atoms
// ============================================================

/** Derive child run state summary for a workstream/worktree card */
export const childRunStatesAtom = atomFamily((sessionId: string) =>
  atom((get): ChildRunStateSummary => {
    const registry = get(sessionRegistryAtom);
    const summary: ChildRunStateSummary = {
      running: 0, waiting: 0, review: 0, idle: 0, done: 0, total: 0,
    };

    for (const [_id, meta] of registry) {
      if (meta.parentSessionId !== sessionId) continue;
      summary.total++;

      const isProcessing = get(sessionProcessingAtom(meta.id));
      const hasPendingPrompt = get(sessionHasPendingInteractivePromptAtom(meta.id));

      if (isProcessing) {
        summary.running++;
      } else if (hasPendingPrompt) {
        summary.waiting++;
      } else if (meta.isArchived) {
        summary.done++;
      } else if (meta.uncommittedCount > 0) {
        summary.review++;
      } else {
        summary.idle++;
      }
    }

    return summary;
  })
);

// ============================================================
// Action Atoms
// ============================================================

/** Set the phase of a session (writes to metadata JSONB via IPC) */
export const setSessionPhaseAtom = atom(
  null,
  async (get, set, payload: { sessionId: string; phase: SessionPhase | null }) => {
    const { sessionId, phase } = payload;

    // Optimistic update in registry
    const registry = new Map(get(sessionRegistryAtom));
    const meta = registry.get(sessionId);
    if (meta) {
      registry.set(sessionId, { ...meta, phase: phase ?? undefined });
      set(sessionRegistryAtom, registry);
    }

    // Persist to database via existing IPC handler
    try {
      await window.electronAPI.invoke('sessions:update-session-metadata', sessionId, { phase: phase ?? null });
    } catch (error) {
      console.error('[sessionKanban] Failed to set phase:', error);
      // Revert optimistic update on failure
      if (meta) {
        const revertRegistry = new Map(get(sessionRegistryAtom));
        revertRegistry.set(sessionId, meta);
        set(sessionRegistryAtom, revertRegistry);
      }
    }
  }
);

/** Set tags on a session (writes to metadata JSONB via IPC) */
export const setSessionTagsAtom = atom(
  null,
  async (get, set, payload: { sessionId: string; tags: string[] }) => {
    const { sessionId, tags } = payload;

    // Optimistic update in registry
    const registry = new Map(get(sessionRegistryAtom));
    const meta = registry.get(sessionId);
    if (meta) {
      registry.set(sessionId, { ...meta, tags });
      set(sessionRegistryAtom, registry);
    }

    // Persist to database
    try {
      await window.electronAPI.invoke('sessions:update-session-metadata', sessionId, { tags });
    } catch (error) {
      console.error('[sessionKanban] Failed to set tags:', error);
      if (meta) {
        const revertRegistry = new Map(get(sessionRegistryAtom));
        revertRegistry.set(sessionId, meta);
        set(sessionRegistryAtom, revertRegistry);
      }
    }
  }
);

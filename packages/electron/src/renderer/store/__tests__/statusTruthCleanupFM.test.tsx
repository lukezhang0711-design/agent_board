// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { SessionMeta } from '@nimbalyst/runtime';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  sessionKanbanTotalCountAtom,
  sessionKanbanGroupedChildCountAtom,
  sessionKanbanFilterAtom,
  childRunStatesAtom,
  sessionWorkOrderFailedAtom,
} from '../atoms/sessionKanban';
import {
  sessionRegistryAtom,
} from '../atoms/sessions';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { AIInput } from '../../components/UnifiedAI/AIInput';
import { SessionKanbanBoard } from '../../components/TrackerMode/SessionKanbanBoard';
import { NavigationGutter } from '../../components/NavigationGutter/NavigationGutter';
import { projectStateAtom, defaultProjectState } from '../atoms/projectState';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
    <span data-material-icon={icon} className={className}>{icon}</span>
  ),
  ProviderIcon: () => <span data-testid="provider-icon" />,
}));

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: () => null,
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => null,
}));

vi.mock('../../components/AgenticCoding/SessionContextMenu', () => ({
  SessionContextMenu: () => null,
}));

vi.mock('../../components/AgentMode/ArchiveWorktreeDialog', () => ({
  ArchiveWorktreeDialog: () => null,
}));

vi.mock('../../hooks/useArchiveWorktreeDialog', () => ({
  useArchiveWorktreeDialog: () => ({
    dialogState: null,
    showDialog: vi.fn(),
    closeDialog: vi.fn(),
    confirmArchive: vi.fn(),
  }),
}));

vi.mock('../../help', () => ({
  HelpTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/UserMenuPopover', () => ({
  UserMenuPopover: () => null,
}));

vi.mock('../../components/GutterContextMenu', () => ({
  GutterContextMenu: () => null,
}));

vi.mock('../../../extensions/panels/usePanels', () => ({
  useExtensionGutterButtons: () => [],
  useExtensionBottomPanelButtons: () => [],
}));

vi.mock('../../components/ThemeToggleButton/ThemeToggleButton', () => ({
  ThemeToggleButton: () => null,
}));

vi.mock('../../components/ExtensionDevIndicator', () => ({
  ExtensionDevIndicator: () => null,
}));

vi.mock('../../components/SyncStatusButton/SyncStatusButton', () => ({
  SyncStatusButton: () => null,
}));

vi.mock('../../components/TrustIndicator', () => ({
  TrustIndicator: () => null,
}));

vi.mock('../../components/UnifiedAI/ModelSelector', () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock('../../components/UnifiedAI/EffortLevelSelector', () => ({
  EffortLevelSelector: () => <div data-testid="effort-selector" />,
}));

vi.mock('../../components/UnifiedAI/ActionPromptsDropdown', () => ({
  ActionPromptsDropdown: () => <div data-testid="action-prompts-dropdown" />,
}));

vi.mock('../../components/UnifiedAI/ContextUsageDisplay', () => ({
  ContextUsageDisplay: () => <div data-testid="context-usage-display" />,
}));

vi.mock('../../components/UnifiedAI/ModeTag', () => ({
  ModeTag: () => <div data-testid="mode-tag" />,
}));

function makeMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'session-1',
    title: 'Test Session',
    provider: 'claude-code',
    sessionType: 'session',
    workspaceId: '/workspace',
    worktreeId: null,
    parentSessionId: null,
    childCount: 0,
    uncommittedCount: 0,
    createdAt: 1,
    updatedAt: 2,
    messageCount: 0,
    isArchived: false,
    isPinned: false,
    phase: 'planning',
    ...overrides,
  } as SessionMeta;
}

function makeWorkOrderRecord(id: string, childSessionId: string, status: string): TrackerRecord {
  return {
    id,
    primaryType: 'work-order',
    workspace: '/workspace',
    fields: {
      title: `Task for ${childSessionId}`,
      childSessionId,
      status,
      taskSummary: 'summary',
      dispatchedAt: '2026-08-31T00:00:00Z',
    },
    system: {
      createdAt: '2026-08-31T00:00:00Z',
      updatedAt: '2026-08-31T00:00:00Z',
      version: 1,
      formatVersion: 1,
      sync: { mode: 'local' },
    },
  } as unknown as TrackerRecord;
}

describe('施工单 FM: 真话清仓 (FB-062, FB-063, FB-102, FB-103, FB-135)', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    store.set(projectStateAtom, { ...defaultProjectState, hiddenGutterButtons: [] });
    window.electronAPI = {
      invoke: vi.fn().mockResolvedValue({ success: true }),
      openExternal: vi.fn(),
      documentService: {
        createTrackerItem: vi.fn(),
        archiveTrackerItem: vi.fn(),
      },
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('FB-062: 看板卡数与子会话数口径对齐', () => {
    it('GREEN ①: sessionKanbanGroupedChildCountAtom aligns with visible parent cards and filters', () => {
      // Parent 1 (planning phase, title: 'Alpha stream') has 2 children
      const parent1 = makeMeta({ id: 'parent-1', title: 'Alpha stream', sessionType: 'workstream', phase: 'planning' });
      const child1a = makeMeta({ id: 'child-1a', title: 'Child 1A', parentSessionId: 'parent-1', phase: undefined });
      const child1b = makeMeta({ id: 'child-1b', title: 'Child 1B', parentSessionId: 'parent-1', phase: undefined });

      // Parent 2 (implementing phase, title: 'Beta stream') has 1 child
      const parent2 = makeMeta({ id: 'parent-2', title: 'Beta stream', sessionType: 'workstream', phase: 'implementing' });
      const child2a = makeMeta({ id: 'child-2a', title: 'Child 2A', parentSessionId: 'parent-2', phase: undefined });

      store.set(sessionRegistryAtom, new Map([
        ['parent-1', parent1],
        ['child-1a', child1a],
        ['child-1b', child1b],
        ['parent-2', parent2],
        ['child-2a', child2a],
      ]));

      // Without filter: 2 parent cards, 3 child sessions grouped under them
      expect(store.get(sessionKanbanTotalCountAtom)).toBe(2);
      expect(store.get(sessionKanbanGroupedChildCountAtom)).toBe(3);

      // Apply search filter matching only "Alpha"
      store.set(sessionKanbanFilterAtom, { search: 'Alpha', tags: [], showComplete: false });

      // With filter: 1 parent card, exactly 2 child sessions grouped under the visible parent
      expect(store.get(sessionKanbanTotalCountAtom)).toBe(1);
      expect(store.get(sessionKanbanGroupedChildCountAtom)).toBe(2);
    });
  });

  describe('FB-063: 窄窗下输入区控制条可换行、模型回执截断策略', () => {
    it('GREEN ②: AIInput inline controls container has flexWrap: wrap and resolved model receipt truncates with full tooltip', () => {
      render(
        <Provider store={store}>
          <AIInput
            value=""
            onChange={vi.fn()}
            onSend={vi.fn()}
            mode="agent"
            onModeChange={vi.fn()}
            currentModel="claude-3-7-sonnet"
            onModelChange={vi.fn()}
            resolvedModel="anthropic/claude-3-7-sonnet-thought-20250219-extended-capacity"
            sessionHasMessages={false}
          />
        </Provider>,
      );

      const receipt = screen.getByTestId('resolved-model-receipt');
      expect(receipt).toBeTruthy();
      // Has truncate and max-w-[200px] classes
      expect(receipt.className).toContain('truncate');
      expect(receipt.className).toContain('max-w-[200px]');
      // Full model name is accessible via title tooltip on hover
      expect(receipt.getAttribute('title')).toBe(
        'Engine-reported model: anthropic/claude-3-7-sonnet-thought-20250219-extended-capacity',
      );

      // Parent controls container has flexWrap: 'wrap'
      const controlsContainer = receipt.parentElement;
      expect(controlsContainer?.style.display).toBe('flex');
      expect(controlsContainer?.style.flexWrap).toBe('wrap');
    });
  });

  describe('FB-103: 失败卡标签如实显示 failed', () => {
    it('GREEN ④: childRunStatesAtom counts failed work orders under summary.failed and not idle', () => {
      const parent = makeMeta({ id: 'parent-1', title: 'Workstream 1', sessionType: 'workstream', phase: 'implementing' });
      const normalChild = makeMeta({ id: 'child-normal', parentSessionId: 'parent-1' });
      const failedChild = makeMeta({ id: 'child-failed', parentSessionId: 'parent-1' });

      const failedWorkOrder = makeWorkOrderRecord('wo-failed', 'child-failed', 'failed');

      store.set(sessionRegistryAtom, new Map([
        ['parent-1', parent],
        ['child-normal', normalChild],
        ['child-failed', failedChild],
      ]));
      store.set(trackerItemsMapAtom, new Map([
        ['wo-failed', failedWorkOrder],
      ]));

      expect(store.get(sessionWorkOrderFailedAtom('child-failed'))).toBe(true);
      expect(store.get(sessionWorkOrderFailedAtom('child-normal'))).toBe(false);

      const summary = store.get(childRunStatesAtom('parent-1'));
      expect(summary.total).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.idle).toBe(1);
    });
  });

  describe('FB-135: Tracker 与 Kanban 两个入口各有名字与范围说明', () => {
    it('GREEN ⑤: Sidebar Tracker entrance clearly specifies "工作区全部事项"', () => {
      render(
        <Provider store={store}>
          <NavigationGutter
            contentMode="files"
            onContentModeChange={vi.fn()}
            onOpenSettings={vi.fn()}
            workspacePath="/workspace"
          />
        </Provider>,
      );

      const trackerBtn = screen.getByTestId('tracker-mode-button');
      expect(trackerBtn.getAttribute('aria-label') || trackerBtn.getAttribute('title')).toContain('工作区全部事项');
    });

    it('GREEN ⑤: Session Kanban toolbar clearly specifies "看板 · 本次派发相关"', () => {
      store.set(sessionRegistryAtom, new Map([
        ['s-1', makeMeta({ id: 's-1', title: 'Main task', phase: 'backlog' })],
      ]));

      render(
        <Provider store={store}>
          <SessionKanbanBoard />
        </Provider>,
      );

      const scopeHeader = screen.getByTestId('kanban-scope-header');
      expect(scopeHeader).toBeTruthy();
      expect(scopeHeader.textContent).toContain('看板');
      expect(scopeHeader.textContent).toContain('本次派发相关');
    });

    it('GREEN ⑥ (Regression Safeguard): Tracker and Kanban data ranges remain isolated and unaltered', () => {
      // Tracker maps items across entire workspace regardless of session
      const bugRecord = {
        id: 'bug-1',
        type: 'bug',
        workspace: '/workspace',
        fields: { title: 'Workspace bug' },
      } as unknown as TrackerRecord;
      store.set(trackerItemsMapAtom, new Map([['bug-1', bugRecord]]));

      // Session registry has separate session items
      const session = makeMeta({ id: 'session-solo', title: 'Independent session', phase: 'backlog' });
      store.set(sessionRegistryAtom, new Map([['session-solo', session]]));

      // Kanban board total count derives strictly from sessions
      expect(store.get(sessionKanbanTotalCountAtom)).toBe(1);
      // Tracker items map contains the workspace record
      expect(store.get(trackerItemsMapAtom).get('bug-1')?.fields.title).toBe('Workspace bug');
    });
  });
});

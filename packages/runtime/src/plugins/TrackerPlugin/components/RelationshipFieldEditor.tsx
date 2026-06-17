/**
 * RelationshipFieldEditor — editor/renderer for `relationship` (and legacy
 * `reference`) tracker fields (Epic C Phase 1).
 *
 * Renders the current value as clickable pills with a remove affordance, plus an
 * add control (a native <datalist> typeahead over `candidates` — no manual
 * positioning needed). All value math delegates to the pure, unit-tested model
 * in ../models/trackerRelationships, so this component stays a thin view.
 */

import React, { useMemo, useState } from 'react';
import type { FieldDefinition, TrackerRelationshipValue } from '../models/TrackerDataModel';
import {
  normalizeRelationshipValue,
  addRelationshipValue,
  removeRelationshipValue,
  serializeRelationshipValue,
} from '../models/trackerRelationships';

/** A selectable target item for the typeahead. */
export interface RelationshipCandidate {
  itemId: string;
  title?: string;
  issueKey?: string;
  trackerType?: string;
}

export interface RelationshipFieldEditorProps {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: TrackerRelationshipValue | TrackerRelationshipValue[] | null) => void;
  /** Candidate target items for the add typeahead. */
  candidates?: RelationshipCandidate[];
  /** Click a pill to open the related item. */
  onOpenItem?: (itemId: string) => void;
  /** Read-only render (pills only, no add/remove). */
  readOnly?: boolean;
}

function pillLabel(v: TrackerRelationshipValue): string {
  return v.issueKey || v.title || v.itemId;
}

export const RelationshipFieldEditor: React.FC<RelationshipFieldEditorProps> = ({
  field,
  value,
  onChange,
  candidates = [],
  onOpenItem,
  readOnly,
}) => {
  const [draft, setDraft] = useState('');
  const current = useMemo(() => normalizeRelationshipValue(value), [value]);
  const currentIds = useMemo(() => new Set(current.map((v) => v.itemId)), [current]);

  const datalistId = `rel-cand-${field.name}`;

  const commit = (next: TrackerRelationshipValue[]) => {
    onChange(serializeRelationshipValue(field, next));
  };

  const resolveDraftToCandidate = (raw: string): RelationshipCandidate | null => {
    const q = raw.trim();
    if (!q) return null;
    // Match a candidate by issueKey, id, or title (case-insensitive).
    const lc = q.toLowerCase();
    const hit = candidates.find(
      (c) => c.issueKey?.toLowerCase() === lc || c.itemId.toLowerCase() === lc || c.title?.toLowerCase() === lc,
    );
    if (hit) return hit;
    // Fall back to a bare id so the user can link something not in the list.
    return { itemId: q };
  };

  const handleAdd = () => {
    const cand = resolveDraftToCandidate(draft);
    if (!cand || currentIds.has(cand.itemId)) {
      setDraft('');
      return;
    }
    const next = addRelationshipValue(field, current, {
      itemId: cand.itemId,
      title: cand.title,
      issueKey: cand.issueKey,
      trackerType: cand.trackerType,
    });
    commit(next);
    setDraft('');
  };

  const handleRemove = (itemId: string) => {
    commit(removeRelationshipValue(current, itemId));
  };

  return (
    <div className="relationship-field-editor flex flex-col gap-1.5" data-testid={`relationship-field-${field.name}`}>
      <div className="flex flex-wrap gap-1">
        {current.length === 0 && (
          <span className="text-[12px] text-[var(--nim-text-faint)] italic">No links</span>
        )}
        {current.map((v) => (
          <span
            key={v.itemId}
            className="relationship-pill inline-flex items-center gap-1 rounded-full bg-[var(--nim-bg-tertiary)] px-2 py-0.5 text-[12px] text-[var(--nim-text)]"
          >
            <button
              type="button"
              className="relationship-pill-open hover:underline"
              title={v.title || v.itemId}
              onClick={() => onOpenItem?.(v.itemId)}
            >
              {pillLabel(v)}
            </button>
            {!readOnly && (
              <button
                type="button"
                className="relationship-pill-remove text-[var(--nim-text-faint)] hover:text-[var(--nim-error)]"
                title="Remove link"
                aria-label={`Remove ${pillLabel(v)}`}
                onClick={() => handleRemove(v.itemId)}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      {!readOnly && (
        <div className="flex gap-1">
          <input
            type="text"
            list={datalistId}
            value={draft}
            placeholder="Link an item…"
            className="flex-1 py-1 px-2 border border-[var(--nim-border)] rounded bg-[var(--nim-bg)] text-[var(--nim-text)] text-[12px] focus:outline-none focus:border-[var(--nim-primary)]"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
            }}
          />
          <datalist id={datalistId}>
            {candidates
              .filter((c) => !currentIds.has(c.itemId))
              .map((c) => (
                <option key={c.itemId} value={c.issueKey || c.title || c.itemId}>
                  {c.title || c.itemId}
                </option>
              ))}
          </datalist>
          <button
            type="button"
            className="relationship-add px-2 py-1 rounded text-[12px] bg-[var(--nim-primary)] text-[var(--nim-on-primary)] disabled:opacity-40"
            disabled={!draft.trim()}
            onClick={handleAdd}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
};

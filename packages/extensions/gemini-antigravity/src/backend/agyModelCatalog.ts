/**
 * Raw `agy models` catalog handling.
 *
 * `agy` owns both the selectable model id and its display label. This module
 * only separates the command's documented TSV columns. It never recognises a
 * model family, normalises case, infers a tier, or manufactures a fallback
 * row: doing any of those changes the engine contract (notably for
 * third-party models exposed by Antigravity).
 */

export interface AgyModelDescriptor {
  /** Opaque extension-facing key. It is the exact engine model identifier. */
  key: string;
  /** Exact value passed to `agy --model`. */
  agyModel: string;
  /** Exact display value emitted by agy (or the id for a one-column row). */
  displayName: string;
  default?: boolean;
}

function rawString(value: unknown): string | undefined {
  // Whitespace-only entries are not model rows. Do not trim valid engine
  // values: the picker and --model argument must retain the original field.
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function addRow(
  output: AgyModelDescriptor[],
  seen: Set<string>,
  id: unknown,
  name?: unknown,
  isDefault?: unknown,
): void {
  const rawId = rawString(id);
  if (!rawId || seen.has(rawId)) return;
  const rawName = rawString(name) ?? rawId;
  seen.add(rawId);
  output.push({
    key: rawId,
    agyModel: rawId,
    displayName: rawName,
    ...(isDefault === true ? { default: true } : {}),
  });
}

function parseTsvRow(line: string, output: AgyModelDescriptor[], seen: Set<string>): void {
  const trimmed = line.trim();
  // `agy models` emits this presentation-only progress line before its TSV
  // rows. It is never an engine model identifier.
  if (
    !trimmed
    || /^(?:fetching\s+)?available models\s*(?:\.{3})?\s*:?$/i.test(trimmed)
  ) return;

  const tabIndex = line.indexOf('\t');
  if (tabIndex === -1) {
    // A one-column engine row is still opaque and valid as both its label and
    // input. No family/tier extraction is attempted.
    addRow(output, seen, line, line);
    return;
  }

  // Split exactly once at the documented TSV delimiter. Further tabs, spaces,
  // punctuation, casing, and all contents of both fields remain untouched.
  addRow(output, seen, line.slice(0, tabIndex), line.slice(tabIndex + 1));
}

/** Parse the documented `agy models` TSV output without changing its fields. */
export function parseAgyModelsOutput(output: string): AgyModelDescriptor[] {
  const rows: AgyModelDescriptor[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    parseTsvRow(line, rows, seen);
  }
  return rows;
}

/**
 * Kept as a named boundary for callers/tests. It copies raw descriptors only;
 * there is deliberately no static alias table or default-row fabrication.
 */
export function buildAgyModelCatalog(rows: readonly AgyModelDescriptor[]): AgyModelDescriptor[] {
  const output: AgyModelDescriptor[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    addRow(output, seen, row.agyModel, row.displayName, row.default);
  }
  return output;
}

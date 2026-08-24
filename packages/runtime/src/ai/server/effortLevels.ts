/**
 * Effort level constants for adaptive reasoning (Opus 4.6 and Sonnet 4.6).
 * Matches the Claude Code CLI's /model effort slider and CLAUDE_CODE_EFFORT_LEVEL env var.
 *
 * Historical labels are listed below for display only. Engine catalogs own
 * which values exist for a particular model.
 */

/**
 * An effort level is owned by an engine/model catalog, not by the app. Keep
 * the raw value end-to-end so a newly introduced engine level needs no
 * Nimbalyst release before it can be selected and sent back to that engine.
 */
export type EffortLevel = string;

/**
 * Known labels are presentation sugar only. This must never be used to decide
 * which values a model supports; that comes solely from supportedEffortLevels.
 */
export const EFFORT_LEVELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'xhigh', label: 'xHigh' },
  { key: 'max', label: 'Max' },
  { key: 'ultra', label: 'Ultra' },
];

/** Preserve any non-empty raw engine value without translating it. */
export function parseEffortLevel(value: unknown): EffortLevel | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/** Return a friendly known label while leaving future engine values untouched. */
export function getEffortLevelLabel(level: EffortLevel): string {
  return EFFORT_LEVELS.find((entry) => entry.key === level)?.label ?? level;
}

export type DeclaredEffortResolution = {
  effortLevel: EffortLevel | undefined;
  outcome: 'accepted' | 'fallback' | 'dropped' | 'none';
  requestedEffort: EffortLevel | undefined;
};

/**
 * Resolve only against the selected model's own declaration. The caller owns
 * persistence/logging; this pure helper deliberately knows nothing about any
 * provider vocabulary or global default.
 */
export function resolveDeclaredEffortLevel(
  requestedEffort: unknown,
  supportedEffortLevels: readonly unknown[] | undefined,
  defaultEffortLevel?: unknown,
): DeclaredEffortResolution {
  const requested = parseEffortLevel(requestedEffort);
  const supported = Array.from(new Set((supportedEffortLevels ?? [])
    .map(parseEffortLevel)
    .filter((level): level is EffortLevel => level !== undefined)));

  if (supported.length === 0) {
    return {
      effortLevel: undefined,
      outcome: requested ? 'dropped' : 'none',
      requestedEffort: requested,
    };
  }
  if (!requested) {
    return {
      effortLevel: undefined,
      outcome: 'none',
      requestedEffort: undefined,
    };
  }
  if (supported.includes(requested)) {
    return { effortLevel: requested, outcome: 'accepted', requestedEffort: requested };
  }
  const declaredDefault = parseEffortLevel(defaultEffortLevel);
  const fallback = declaredDefault && supported.includes(declaredDefault)
    ? declaredDefault
    : supported[0]!;
  return {
    effortLevel: fallback,
    outcome: 'fallback',
    requestedEffort: requested,
  };
}

/**
 * Resolve the effective effort level for a session.
 *
 * An explicit per-session value wins; otherwise we fall back to the app-wide
 * default that the UI effort selector displays. Without this fallback the
 * selector showed the app default (e.g. "Max") while the session silently ran
 * at the CLI's built-in "high", because the default was never written into
 * session metadata (GitHub #546).
 *
 * Returns undefined only when neither is set, so callers leave the CLI on its
 * own built-in default rather than forcing one.
 */
export function resolveEffortLevel(
  sessionEffortLevel: unknown,
  appDefaultEffortLevel: EffortLevel | undefined
): EffortLevel | undefined {
  return parseEffortLevel(sessionEffortLevel) ?? parseEffortLevel(appDefaultEffortLevel);
}

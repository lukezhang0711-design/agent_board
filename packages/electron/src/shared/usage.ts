export type UsageProviderId = 'openai-codex' | 'claude-code';

export interface UsagePool {
  key: string;
  provider: UsageProviderId;
  limitId: string;
  name: string;
  utilization: number;
  resetsAt: string | null;
  windowMinutes: number | null;
  updatedAt: number;
  stale: boolean;
}

export type UsagePoolMap = Record<string, UsagePool>;

export interface ProviderUsageData {
  provider: UsageProviderId;
  pools: UsagePoolMap;
  lastUpdated: number | null;
  error?: string;
}

export interface CodexUsageData extends ProviderUsageData {
  provider: 'openai-codex';
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: number | null;
  };
  tokenUsage?: {
    totalTokens: number;
    lastTokens: number | null;
  };
}

export interface ClaudeUsageData extends ProviderUsageData {
  provider: 'claude-code';
}

export function makeUsagePoolKey(provider: UsageProviderId, limitId: string): string {
  return `${provider}:${limitId}`;
}

export function mergeUsagePoolSnapshot(
  current: UsagePool | undefined,
  candidate: UsagePool,
): UsagePool {
  if (!current) return candidate;
  if (candidate.updatedAt < current.updatedAt) return current;

  const sameCycle =
    current.resetsAt !== null
    && candidate.resetsAt === current.resetsAt
    && candidate.windowMinutes === current.windowMinutes;

  if (sameCycle && candidate.utilization < current.utilization) {
    return { ...candidate, utilization: current.utilization };
  }

  return candidate;
}

export function markUsagePoolsStale(pools: UsagePoolMap): UsagePoolMap {
  return Object.fromEntries(
    Object.entries(pools).map(([key, pool]) => [key, { ...pool, stale: true }]),
  );
}

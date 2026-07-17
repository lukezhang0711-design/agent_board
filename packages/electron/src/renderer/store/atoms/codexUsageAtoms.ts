/**
 * Atoms for Codex usage tracking
 *
 * These atoms store usage data parsed from Codex CLI session files,
 * including 5-hour session and weekly utilization percentages.
 * Only populated for subscription users (ChatGPT Plus/Pro).
 */

import { atom } from 'jotai';
import { formatResetTime } from './claudeUsageAtoms';
import type { CodexUsageData, UsagePool } from '../../../shared/usage';

export { formatResetTime };
export type { CodexUsageData } from '../../../shared/usage';

export const codexUsageAtom = atom<CodexUsageData | null>(null);

// The usage-indicator enabled toggle now lives in the flat-key SettingsService
// under `ai.showCodexUsageIndicator`. Read it with
// `useSetting('ai.showCodexUsageIndicator')` and write it with
// `useSetSetting('ai.showCodexUsageIndicator')` -- it hydrates before React
// mounts and stays in lockstep across windows via the broadcast.

export const codexUsageAvailableAtom = atom((get) => {
  const usage = get(codexUsageAtom);
  if (!usage) return false;
  if (usage.error) return true;
  const hasUsageData = Object.keys(usage.pools).length > 0;
  const hasCreditsData = Boolean(usage.credits?.hasCredits) || typeof usage.credits?.balance === 'number';
  const hasTokenUsage = (usage.tokenUsage?.totalTokens ?? 0) > 0;
  return hasUsageData || hasCreditsData || hasTokenUsage;
});

export const codexUsageSummaryPoolAtom = atom<UsagePool | null>((get) => {
  const usage = get(codexUsageAtom);
  if (!usage) return null;
  return Object.values(usage.pools).reduce<UsagePool | null>(
    (highest, pool) => !highest || pool.utilization > highest.utilization ? pool : highest,
    null,
  );
});

export const codexUsageSessionColorAtom = atom((get) => {
  const pool = get(codexUsageSummaryPoolAtom);
  if (!pool || pool.stale) return 'muted';
  const util = pool.utilization;
  if (util >= 80) return 'red';
  if (util >= 50) return 'yellow';
  return 'green';
});

export const codexUsageWeeklyColorAtom = atom((get) => {
  return get(codexUsageSessionColorAtom);
});

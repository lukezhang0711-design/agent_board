import { isSettingKey, type SettingKey } from '../../../shared/settings/keys';

export type AISettingsSkipReason = 'unknown_key' | 'invalid_value';

export interface AISettingsSkippedEntry {
  key: string;
  reason: AISettingsSkipReason;
}

export interface AISettingsWriteResult {
  savedKeys: string[];
  skipped: AISettingsSkippedEntry[];
}

export interface AISettingsStore {
  get(key: string, defaultValue: unknown): unknown;
  set(key: string, value: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function keyForLog(key: string): string {
  const singleLine = key.replace(/[\r\n\t]/g, ' ');
  return singleLine.length > 160 ? `${singleLine.slice(0, 157)}...` : singleLine;
}

function logSkippedSetting(
  warn: (message: string) => void,
  key: string,
  reason: AISettingsSkipReason,
): void {
  // Do not log the value or the raw validation error: either can contain a
  // provider token, a model name, or other user-controlled content.
  warn(`[ai:saveSettings] skipped key=${keyForLog(key)} reason=${reason}`);
}

/**
 * Turns the legacy blob-save handler's writes into independently recoverable
 * operations. A bad item is reported and skipped; it cannot abort later
 * legitimate settings in the same payload.
 */
export function createTolerantAISettingsWriter(
  persist: (key: SettingKey, value: unknown) => void,
  warn: (message: string) => void,
): {
  set: (key: string, value: unknown) => boolean;
  result: AISettingsWriteResult;
} {
  const result: AISettingsWriteResult = {
    savedKeys: [],
    skipped: [],
  };

  const set = (key: string, value: unknown): boolean => {
    if (!isSettingKey(key)) {
      result.skipped.push({ key, reason: 'unknown_key' });
      logSkippedSetting(warn, key, 'unknown_key');
      return false;
    }

    try {
      persist(key, value);
      result.savedKeys.push(key);
      return true;
    } catch {
      result.skipped.push({ key, reason: 'invalid_value' });
      logSkippedSetting(warn, key, 'invalid_value');
      return false;
    }
  };

  return { set, result };
}

/**
 * Moves provider entries outside the current settings allowlist to a durable
 * quarantine. Keeping the original value lets a future matching provider
 * recover it deliberately instead of silently deleting user configuration.
 * Extension provider keys enter that allowlist through AgentProviderRegistry,
 * so a registered extension's previously quarantined slice is restored here
 * during startup; unregistered extensions remain quarantined.
 */
export function quarantineUnrecognizedAIProviderSettings(
  store: AISettingsStore,
): string[] {
  const providerSettings = store.get('providerSettings', {});
  if (!isRecord(providerSettings)) return [];

  const storedQuarantine = store.get('_unrecognized', {});
  const quarantine: Record<string, unknown> = isRecord(storedQuarantine)
    ? { ...storedQuarantine }
    : { _previousValue: storedQuarantine };
  const quarantinedProviders = isRecord(quarantine.providerSettings)
    ? quarantine.providerSettings
    : {};

  const recognized: Record<string, unknown> = {};
  const unrecognized: Record<string, unknown> = {};
  for (const [providerId, config] of Object.entries(providerSettings)) {
    if (isSettingKey(`ai.provider.${providerId}`)) {
      recognized[providerId] = config;
    } else {
      unrecognized[providerId] = config;
    }
  }

  // A provider may have been unavailable at the previous launch but be
  // registered now. Move only those newly-recognized entries back; entries
  // for still-unavailable providers remain safely quarantined.
  const remainingQuarantine: Record<string, unknown> = {};
  for (const [providerId, config] of Object.entries(quarantinedProviders)) {
    if (isSettingKey(`ai.provider.${providerId}`)) {
      if (!(providerId in recognized)) recognized[providerId] = config;
    } else {
      remainingQuarantine[providerId] = config;
    }
  }

  const providerIds = Object.keys(unrecognized);
  const restoredProviderIds = Object.keys(quarantinedProviders)
    .filter((providerId) => isSettingKey(`ai.provider.${providerId}`));
  if (providerIds.length === 0 && restoredProviderIds.length === 0) return [];

  store.set('providerSettings', recognized);
  const nextQuarantine = {
    ...quarantine,
    providerSettings: {
      ...remainingQuarantine,
      ...unrecognized,
    },
  };
  store.set('_unrecognized', {
    ...nextQuarantine,
  });

  return providerIds.sort();
}

export function formatAISettingsKeysForLog(keys: string[]): string {
  return keys.map(keyForLog).join(', ');
}

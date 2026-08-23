import { store } from '../index';
import { agentModeSettingsAtom } from '../atoms/appSettings';

interface DefaultModelMigration {
  from: string;
  to: string;
}

const pendingMigrations = new Map<string, string>();

function isDefaultModelMigration(value: unknown): value is DefaultModelMigration {
  if (!value || typeof value !== 'object') return false;
  const migration = value as Partial<DefaultModelMigration>;
  return typeof migration.from === 'string'
    && migration.from.length > 0
    && typeof migration.to === 'string'
    && migration.to.length > 0;
}

/**
 * Applies a main-process-proven equivalent migration only while the renderer
 * still points at the original spelling. The compare-and-swap protects a
 * model the user chose while the live catalog was refreshing.
 */
export function applyPendingDefaultModelMigration(): void {
  const current = store.get(agentModeSettingsAtom);
  const migratedModel = pendingMigrations.get(current.defaultModel);
  if (!migratedModel || migratedModel === current.defaultModel) return;

  store.set(agentModeSettingsAtom, {
    ...current,
    defaultModel: migratedModel,
  });
}

/**
 * Keeps the renderer's in-memory next-session default aligned with the
 * canonical value already persisted by AIService. The listener is registered
 * before startup setting hydration; queued migrations are replayed just after
 * agent-mode settings load so an early automatic health check cannot be lost.
 */
export function initDefaultModelMigrationListeners(): () => void {
  return window.electronAPI.on('settings:default-ai-model-migrated', (payload: unknown) => {
    if (!isDefaultModelMigration(payload)) {
      console.error('[DefaultModelMigrationListeners] Ignored malformed default-model migration payload');
      return;
    }

    pendingMigrations.set(payload.from, payload.to);
    applyPendingDefaultModelMigration();
  });
}

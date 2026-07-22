/**
 * Centralized IPC listeners for Codex usage tracking
 *
 * Follows the pattern from centralized-ipc-listener-architecture.md:
 * - Components NEVER subscribe to IPC events directly
 * - Central listeners update atoms
 * - Components read from atoms
 */

import { store } from '../index';
import { codexUsageAtom, CodexUsageData } from '../atoms/codexUsageAtoms';
import { sessionStoreAtom } from '../atoms/sessions';
import { settingAtom } from '../atoms/settingAtomFamily';

const codexUsageEnabledAtom = settingAtom('ai.showCodexUsageIndicator');

function isCodexUsageEnabled(): boolean {
  return store.get(codexUsageEnabledAtom);
}

function fetchUsage(channel: 'codex-usage:get' | 'codex-usage:refresh'): void {
  window.electronAPI.invoke(channel).then((data: CodexUsageData | null) => {
    if (data) {
      store.set(codexUsageAtom, data);
    }
  }).catch((error: Error) => {
    console.error('[CodexUsageListeners] Failed to get initial usage:', error);
  });
}

export function initCodexUsageListeners(): () => void {
  const cleanups: Array<() => void> = [];

  const handleUsageUpdate = (data: CodexUsageData) => {
    store.set(codexUsageAtom, data);
  };

  cleanups.push(
    window.electronAPI.on('codex-usage:update', handleUsageUpdate)
  );

  cleanups.push(
    window.electronAPI.on('ai:streamResponse', (data: {
      sessionId?: string;
      isComplete?: boolean;
    }) => {
      if (!isCodexUsageEnabled()) return;
      if (!data.sessionId || !data.isComplete) return;
      const session = store.get(sessionStoreAtom(data.sessionId));
      if (session?.provider !== 'openai-codex') return;

      void window.electronAPI.invoke('codex-usage:turn-completed').catch((error: Error) => {
        console.error('[CodexUsageListeners] Failed to refresh after turn completion:', error);
      });
    })
  );

  let wasEnabled = isCodexUsageEnabled();
  if (wasEnabled) fetchUsage('codex-usage:get');
  cleanups.push(store.sub(codexUsageEnabledAtom, () => {
    const enabled = isCodexUsageEnabled();
    if (enabled && !wasEnabled) fetchUsage('codex-usage:refresh');
    wasEnabled = enabled;
  }));

  return () => {
    cleanups.forEach(fn => fn?.());
  };
}

export async function recordCodexActivity(): Promise<void> {
  if (!isCodexUsageEnabled()) return;
  try {
    await window.electronAPI.invoke('codex-usage:activity');
  } catch (error) {
    console.error('[CodexUsageListeners] Failed to record activity:', error);
  }
}

export async function refreshCodexUsage(): Promise<CodexUsageData | null> {
  try {
    const data = await window.electronAPI.invoke('codex-usage:refresh');
    return data;
  } catch (error) {
    console.error('[CodexUsageListeners] Failed to refresh usage:', error);
    return null;
  }
}

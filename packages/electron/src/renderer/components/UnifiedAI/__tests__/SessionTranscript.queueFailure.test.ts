import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showError: vi.fn(),
}));

// Keep this focused on the queue boundary; the transcript renderer's syntax
// highlighting and widget host are unrelated to failure visibility.
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/AgentTranscriptPanel', () => ({
  AgentTranscriptPanel: () => null,
}));
vi.mock('@nimbalyst/runtime/store', () => ({
  store: { get: () => null },
  registerInteractiveWidgetHost: () => {},
  unregisterInteractiveWidgetHost: () => {},
}));
vi.mock('@nimbalyst/runtime/ui/AgentTranscript/utils/messageTypeHelpers', () => ({
  isToolLikeMessage: () => false,
}));
vi.mock('../../CustomEditors/registry', () => ({
  customEditorRegistry: { get: () => null },
}));
vi.mock('../../../services/ErrorNotificationService', () => ({
  errorNotificationService: { showError: mocks.showError },
}));

import { surfaceQueuedPromptFailure } from '../SessionTranscript';

describe('SessionTranscript queued prompt failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the durable-create failure and clears a stale local queue badge', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('store write failed');
    });
    const setQueuedPrompts = vi.fn();

    await surfaceQueuedPromptFailure('session-1', new Error('store write failed'), invoke, setQueuedPrompts);

    expect(mocks.showError).toHaveBeenCalledWith('Failed to queue prompt', 'store write failed');
    expect(invoke).toHaveBeenCalledWith('ai:listPendingPrompts', 'session-1');
    expect(setQueuedPrompts).toHaveBeenCalledWith([]);
  });
});

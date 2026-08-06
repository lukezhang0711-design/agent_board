// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { pendingVoiceCommandAtom } from '../../../store/atoms/voiceModeState';
import { PendingVoiceCommand } from '../PendingVoiceCommand';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-testid={`icon-${icon}`} />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PendingVoiceCommand IME composition guard', () => {
  it('keeps the full edited prompt when the composition commit key has no native IME flags', async () => {
    const onSubmit = vi.fn();
    const jotaiStore = createStore();
    jotaiStore.set(pendingVoiceCommandAtom, {
      id: 'voice-command-ime',
      prompt: 'notes,1:DP-.md, provider claude-code claude-codehaiku.',
      sessionId: 'session-ime',
      createdAt: Date.now(),
      delayMs: 60_000,
      workspacePath: '/workspace',
    });

    render(
      <JotaiProvider store={jotaiStore}>
        <PendingVoiceCommand sessionId="session-ime" onSubmit={onSubmit} />
      </JotaiProvider>,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const prefix = 'notes,1:DP-.md, provider claude-code claude-codehaiku.';
    const composingValue = `${prefix} zhongwen`;
    const committedValue = `${prefix} 中文任务`;
    await waitFor(() => expect(textarea.value).toBe(prefix));

    fireEvent.compositionStart(textarea, { data: '' });
    fireEvent.compositionUpdate(textarea, { data: 'zhongwen' });
    fireEvent.change(textarea, { target: { value: composingValue } });

    const compositionCommit = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(compositionCommit, 'isComposing', { value: false });
    Object.defineProperty(compositionCommit, 'keyCode', { value: 0 });
    fireEvent(textarea, compositionCommit);

    expect(compositionCommit.defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea, { data: '中文任务' });
    fireEvent.change(textarea, { target: { value: committedValue } });
    fireEvent.keyDown(textarea, { key: 'Enter', bubbles: true, cancelable: true });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(committedValue, 'session-ime', '/workspace', undefined);
    });
  });
});

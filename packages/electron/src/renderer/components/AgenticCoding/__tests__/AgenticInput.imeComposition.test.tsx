// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../Typeahead/GenericTypeahead', () => ({
  GenericTypeahead: () => <div data-testid="typeahead-open" />,
}));
vi.mock('../AttachmentPreviewList', () => ({
  AttachmentPreviewList: () => null,
}));

import { AgenticInput } from '../AgenticInput';

const fileOptions = [{ id: 'file-1', label: 'notes.md', data: { path: 'notes.md' } }];

function Harness({ onSend }: { onSend: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState('');
  return (
    <AgenticInput
      value={value}
      onChange={setValue}
      onSend={onSend}
      fileMentionOptions={fileOptions}
      onFileMentionSearch={vi.fn()}
    />
  );
}

function dispatchCompositionEnter(
  textarea: HTMLTextAreaElement,
  overrides: { isComposing: boolean; keyCode: number },
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'isComposing', { value: overrides.isComposing });
  Object.defineProperty(event, 'keyCode', { value: overrides.keyCode });
  fireEvent(textarea, event);
  return event;
}

function dispatchCompositionCommitKey(textarea: HTMLTextAreaElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, 'isComposing', { value: false });
  Object.defineProperty(event, 'keyCode', { value: 0 });
  fireEvent(textarea, event);
  return event;
}

function ValueHarness({ onSend }: { onSend: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState('');
  return (
    <AgenticInput
      value={value}
      onChange={setValue}
      onSend={() => onSend(value)}
      fileMentionOptions={fileOptions}
      onFileMentionSearch={vi.fn()}
    />
  );
}

describe('AgenticInput IME composition guard', () => {
  afterEach(() => cleanup());

  it.each([
    ['native composition state', { isComposing: true, keyCode: 0 }],
    ['IME keyCode fallback', { isComposing: false, keyCode: 229 }],
  ])('does not let an open typeahead take Enter during %s', async (_label, composition) => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });
    textarea.setSelectionRange(1, 1);
    fireEvent.select(textarea);

    await waitFor(() => expect(screen.getByTestId('typeahead-open')).toBeTruthy());

    const event = dispatchCompositionEnter(textarea, composition);

    // Before the guard, Typeahead's Enter handler called preventDefault here.
    expect(event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the full composed prompt when the commit key has no native IME flags', () => {
    const onSend = vi.fn();
    render(<ValueHarness onSend={onSend} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const prefix = 'notes,1:DP-.md, provider claude-code claude-codehaiku.';
    const composingValue = `${prefix} zhongwen`;
    const committedValue = `${prefix} 中文任务`;

    fireEvent.change(textarea, { target: { value: prefix } });
    fireEvent.compositionStart(textarea, { data: '' });
    fireEvent.compositionUpdate(textarea, { data: 'zhongwen' });
    fireEvent.change(textarea, { target: { value: composingValue } });

    dispatchCompositionCommitKey(textarea);

    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea, { data: '中文任务' });
    fireEvent.change(textarea, { target: { value: committedValue } });
    fireEvent.keyDown(textarea, { key: 'Enter', bubbles: true, cancelable: true });

    expect(onSend).toHaveBeenCalledWith(committedValue);
  });
});

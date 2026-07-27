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
});

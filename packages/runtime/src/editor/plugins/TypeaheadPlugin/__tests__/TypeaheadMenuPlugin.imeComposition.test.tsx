// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical';

import { TypeaheadMenuPlugin } from '../TypeaheadMenuPlugin';

function EditorCapture({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onReady(editor), [editor, onReady]);
  return null;
}

describe('TypeaheadMenuPlugin IME composition guard', () => {
  it('does not let an already-open menu take composition-period Enter', async () => {
    if (!Range.prototype.getBoundingClientRect) {
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        value: () => new DOMRect(0, 0, 0, 0),
      });
    }

    let editor: LexicalEditor | null = null;
    const onOpen = vi.fn();
    const onSelectOption = vi.fn();

    const view = render(
      <LexicalComposer
        initialConfig={{
          namespace: 'typeahead-ime-composition-test',
          onError: (error) => {
            throw error;
          },
        }}
      >
        <ContentEditable data-testid="lexical-root" />
        <EditorCapture onReady={(capturedEditor) => { editor = capturedEditor; }} />
        <TypeaheadMenuPlugin
          options={[{ id: 'one', label: 'One', onSelect: vi.fn() }]}
          triggerFn={(text) => text === '/' ? {
            leadOffset: 0,
            matchingString: '/',
            replaceableString: '/',
          } : null}
          onQueryChange={vi.fn()}
          onSelectOption={onSelectOption}
          onOpen={onOpen}
        />
      </LexicalComposer>,
    );

    await waitFor(() => expect(editor).not.toBeNull());
    const resolvedEditor = editor!;
    const root = view.getByTestId('lexical-root');

    act(() => {
      resolvedEditor.update(() => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('/');
        paragraph.append(text);
        $getRoot().append(paragraph);
        text.select(1, 1);
      }, { discrete: true });
    });

    await waitFor(() => expect(root.lastChild?.textContent).toBe('/'));
    const textNode = root.lastChild?.firstChild;
    if (!textNode) throw new Error('Expected Lexical to render the trigger text');
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    act(() => {
      resolvedEditor.update(() => {}, { discrete: true });
    });
    await waitFor(() => expect(onOpen).toHaveBeenCalled());

    vi.spyOn(resolvedEditor, 'isComposing').mockReturnValue(true);
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'isComposing', { value: true });

    const handled = resolvedEditor.dispatchCommand(KEY_ENTER_COMMAND, event);

    // Before the composition guard, selecting the typeahead option swallowed Enter.
    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(onSelectOption).not.toHaveBeenCalled();
  });
});

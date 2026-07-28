// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();
  const typeaheadOptions = [{ id: 'file-1', label: 'notes.md', data: { path: 'notes.md' } }];
  const setAtom = vi.fn();
  return {
    ...actual,
    useAtomValue: () => typeaheadOptions,
    useSetAtom: () => setAtom,
  };
});

vi.mock('@nimbalyst/runtime', () => ({
  readClipboard: vi.fn(async () => ''),
}));

vi.mock('../../Typeahead/GenericTypeahead', () => ({
  GenericTypeahead: () => <div data-testid="typeahead-open" />,
}));

vi.mock('../../AgenticCoding/AttachmentPreviewList', () => ({
  AttachmentPreviewList: () => null,
}));
vi.mock('../VoiceModeButton.tsx', () => ({
  registerPendingVoiceCommandSetter: () => () => {},
}));
vi.mock('../ContextUsageDisplay', () => ({
  ContextUsageDisplay: () => null,
}));
vi.mock('../ActionPromptsDropdown', () => ({
  ActionPromptsDropdown: () => null,
}));
vi.mock('../MockupAnnotationIndicator', () => ({
  MockupAnnotationIndicator: () => null,
}));
vi.mock('../TextSelectionIndicator', () => ({
  TextSelectionIndicator: () => null,
}));
vi.mock('../EditorContextIndicator', () => ({
  EditorContextIndicator: () => null,
}));
vi.mock('../interactivePrompts', () => ({
  useMemoryMode: () => ({
    isMemoryMode: false,
    memoryTarget: 'user',
    isSaving: false,
    enterMemoryMode: vi.fn(),
    exitMemoryMode: vi.fn(),
    toggleMemoryTarget: vi.fn(),
    setMemoryTarget: vi.fn(),
    saveToMemory: vi.fn(async () => true),
  }),
  shouldActivateMemoryMode: () => false,
  getMemoryContent: (value: string) => value,
  MemoryPromptIndicator: () => null,
  MemorySaveButton: () => null,
}));
vi.mock('../../../help', () => ({
  HelpTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../store', () => ({
  fileMentionOptionsAtom: () => ({}),
  searchFileMentionAtom: {},
  sessionMentionOptionsAtom: () => ({}),
  searchSessionMentionAtom: {},
  sessionRegistryAtom: {},
}));
vi.mock('../../../store/atoms/voiceModeState', () => ({
  pendingVoiceCommandAtom: {},
  voiceActiveSessionIdAtom: {},
}));
vi.mock('../../../hooks/useAIInputUndo', () => ({
  useAIInputUndo: () => ({
    pushSnapshot: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    clear: vi.fn(),
    getUndoCount: () => 0,
  }),
}));

import { AIInput } from '../AIInput';

function Harness({ onSend }: { onSend: ReturnType<typeof vi.fn> }) {
  const [value, setValue] = useState('');
  return (
    <AIInput
      value={value}
      onChange={setValue}
      onSend={onSend}
      workspacePath="/workspace"
      testId="ai-input"
    />
  );
}

function ResolvedModelHarness() {
  const [value, setValue] = useState('');
  const props = {
    value,
    onChange: setValue,
    onSend: vi.fn(),
    workspacePath: '/workspace',
    testId: 'resolved-model-input',
    resolvedModel: 'claude-opus-5',
  } as any;
  return <AIInput {...props} />;
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

describe('AIInput IME composition guard', () => {
  beforeEach(() => {
    // The prompt-height read is unrelated to this keydown test; leave it
    // pending so its asynchronous state update cannot race the assertion.
    (window as any).electronAPI = { invoke: vi.fn(() => new Promise(() => {})) };
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as any).electronAPI;
  });

  it.each([
    ['native composition state', { isComposing: true, keyCode: 0 }],
    ['IME keyCode fallback', { isComposing: false, keyCode: 229 }],
  ])('does not let an open typeahead take Enter during %s', async (_label, composition) => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    const textarea = screen.getByTestId('ai-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '@' } });
    act(() => {
      textarea.setSelectionRange(1, 1);
      fireEvent.select(textarea);
    });

    await waitFor(() => expect(screen.getByTestId('typeahead-open')).toBeTruthy());

    const event = dispatchCompositionEnter(textarea, composition);

    // Before the guard, Typeahead's Enter handler called preventDefault here.
    expect(event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('AIInput resolved model receipt', () => {
  beforeEach(() => {
    (window as any).electronAPI = { invoke: vi.fn(() => new Promise(() => {})) };
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as any).electronAPI;
  });

  it('shows the actual model resolved by the provider without requiring another user action', () => {
    render(<ResolvedModelHarness />);
    expect(screen.getByTestId('resolved-model-receipt').textContent).toBe('Model: claude-opus-5');
  });
});

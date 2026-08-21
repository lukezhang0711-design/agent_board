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

function ModeToggleHarness({ disabled = false, onModeChange = vi.fn() }: { disabled?: boolean; onModeChange?: (mode: 'planning' | 'agent') => void }) {
  const Input = AIInput as React.ComponentType<any>;
  return (
    <Input
      value=""
      onChange={() => {}}
      onSend={() => {}}
      provider="claude-code"
      mode="planning"
      onModeChange={onModeChange}
      disableModeToggle={disabled}
      workspacePath="/workspace"
      testId="mode-toggle-input"
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
  // Some Chromium/IME combinations send the commit key without either the
  // native isComposing flag or the 229 keyCode. The component must still use
  // compositionstart/end state to keep this key out of the send path.
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

  it('keeps the full composed Head prompt when the commit key has no native IME flags', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    const textarea = screen.getByTestId('ai-input') as HTMLTextAreaElement;
    const prefix = 'notes,1:DP-.md, provider claude-code claude-codehaiku.';
    const composingValue = `${prefix} zhongwen`;
    const committedValue = `${prefix} 中文任务`;

    fireEvent.change(textarea, { target: { value: prefix } });
    fireEvent.compositionStart(textarea, { data: '' });
    fireEvent.compositionUpdate(textarea, { data: 'zhongwen' });
    fireEvent.change(textarea, { target: { value: composingValue } });

    dispatchCompositionCommitKey(textarea);

    // The commit key is still part of the composition even though Chromium
    // omitted both native markers. Sending here would drop the final Chinese
    // text when the Head clears its draft after submit.
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea, { data: '中文任务' });
    fireEvent.change(textarea, { target: { value: committedValue } });
    fireEvent.keyDown(textarea, { key: 'Enter', bubbles: true, cancelable: true });

    expect(onSend).toHaveBeenCalledWith(committedValue);
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

describe('AIInput plan toggle scope', () => {
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

  it('keeps the Plan/Agent toggle available for ordinary Claude sessions', () => {
    const onModeChange = vi.fn();
    render(<ModeToggleHarness onModeChange={onModeChange} />);
    const toggle = screen.getByTestId('plan-mode-toggle') as HTMLButtonElement;

    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    expect(onModeChange).toHaveBeenCalledWith('agent');
  });

  it('disables the engine mode toggle for Head sessions and blocks Shift+Tab', () => {
    render(<ModeToggleHarness disabled />);
    const toggle = screen.getByTestId('plan-mode-toggle') as HTMLButtonElement;

    expect(toggle.disabled).toBe(true);
    expect(toggle.title).toContain('Head');

    fireEvent.click(toggle);
    const textarea = screen.getByTestId('mode-toggle-input') as HTMLTextAreaElement;
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(textarea, event);
    expect(event.defaultPrevented).toBe(false);
  });
});

// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  atomSetter: vi.fn(),
  voiceModeSettingsAtom: Symbol('voiceModeSettingsAtom'),
  setVoiceModeSettingsAtom: Symbol('setVoiceModeSettingsAtom'),
  apiKeysAtom: Symbol('apiKeysAtom'),
  setApiKeyAtom: Symbol('setApiKeyAtom'),
  defaultAgentModelAtom: Symbol('defaultAgentModelAtom'),
  voiceModePreviewAudioAtom: Symbol('voiceModePreviewAudioAtom'),
  addSessionFullAtom: Symbol('addSessionFullAtom'),
  setSelectedWorkstreamAtom: Symbol('setSelectedWorkstreamAtom'),
  setWindowModeAtom: Symbol('setWindowModeAtom'),
  navigateToSettingsAtom: Symbol('navigateToSettingsAtom'),
}));

vi.mock('jotai', () => ({
  useAtom: (atom: symbol) => [
    atom === mocks.voiceModeSettingsAtom
      ? {
        enabled: true,
        voice: 'alloy',
        turnDetection: {},
        voiceAgentPrompt: {},
        codingAgentPrompt: {},
        submitDelayMs: 3000,
        listenWindowMs: 15000,
      }
      : undefined,
    mocks.atomSetter,
  ],
  useAtomValue: (atom: symbol) => {
    if (atom === mocks.apiKeysAtom) return { openai: 'test-key' };
    if (atom === mocks.defaultAgentModelAtom) return 'openai-codex:gpt-5.6';
    return null;
  },
  useSetAtom: () => mocks.atomSetter,
}));

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span aria-label={icon} />,
  ModelIdentifier: { tryParse: vi.fn() },
}));
vi.mock('../../../store/atoms/appSettings', () => ({
  voiceModeSettingsAtom: mocks.voiceModeSettingsAtom,
  setVoiceModeSettingsAtom: mocks.setVoiceModeSettingsAtom,
  apiKeysAtom: mocks.apiKeysAtom,
  setApiKeyAtom: mocks.setApiKeyAtom,
  defaultAgentModelAtom: mocks.defaultAgentModelAtom,
}));
vi.mock('../../../store/atoms/voiceModeState', () => ({
  voiceModePreviewAudioAtom: mocks.voiceModePreviewAudioAtom,
}));
vi.mock('../../../store', () => ({
  addSessionFullAtom: mocks.addSessionFullAtom,
  setSelectedWorkstreamAtom: mocks.setSelectedWorkstreamAtom,
  setWindowModeAtom: mocks.setWindowModeAtom,
  navigateToSettingsAtom: mocks.navigateToSettingsAtom,
}));
vi.mock('../../../contexts/DialogContext', () => ({
  useDialog: () => ({ confirm: vi.fn() }),
}));
vi.mock('../../common/AlphaBadge', () => ({
  AlphaBadge: () => <span>Alpha</span>,
  SETTINGS_ALPHA_TOOLTIP: 'Alpha feature',
}));
vi.mock('../voiceModeSummaryPrompt', () => ({
  buildVoiceProjectSummaryPrompt: vi.fn(),
  VOICE_PROJECT_SUMMARY_PATH: 'nimbalyst-local/voice-project-summary.md',
}));

import { VoiceModePanel } from '../VoiceModePanel';

afterEach(() => {
  cleanup();
  mocks.atomSetter.mockReset();
});

describe('VoiceModePanel product copy', () => {
  it('RED FO: does not identify the configured coding agent as Claude', () => {
    render(<VoiceModePanel />);

    expect(screen.queryByText(/control Claude Code with your voice/)).toBeNull();

    fireEvent.click(screen.getByText('Coding Agent Instructions (Voice Mode)'));
    expect(screen.queryByText(/Customize the coding agent \(Claude\)/)).toBeNull();
  });
});

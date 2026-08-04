// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('jotai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jotai')>();
  const providers = {};
  const setAtom = vi.fn();
  return {
    ...actual,
    useAtomValue: () => providers,
    useSetAtom: () => setAtom,
  };
});
vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: () => null,
  getProviderIcon: () => null,
}));
vi.mock('@nimbalyst/runtime/ai/server/types', () => ({
  isAgentProvider: (provider: string) => provider === 'openai-codex' || provider === 'openai-codex-acp',
  shouldBlockStartedSessionProviderSwitch: () => false,
}));
vi.mock('@floating-ui/react', () => ({
  autoUpdate: vi.fn(),
  flip: vi.fn(),
  FloatingPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  offset: vi.fn(),
  shift: vi.fn(),
  useDismiss: () => ({}),
  useFloating: () => ({
    refs: { setReference: vi.fn(), setFloating: vi.fn() },
    floatingStyles: {},
    context: {},
  }),
  useInteractions: () => ({
    getReferenceProps: (props: Record<string, unknown>) => props,
    getFloatingProps: () => ({}),
  }),
  useRole: () => ({}),
}));
vi.mock('../../../help', () => ({
  HelpTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ModelSelector } from '../ModelSelector';

beforeEach(() => {
  (window as any).electronAPI = {
    aiGetModels: vi.fn().mockResolvedValue({
      success: true,
      grouped: {
        'openai-codex-acp': [{
          id: 'openai-codex-acp:gpt-5.5',
          name: 'Codex ACP',
          provider: 'openai-codex-acp',
        }],
        'openai-codex': [{
          id: 'openai-codex:gpt-5.5',
          name: 'Codex',
          provider: 'openai-codex',
        }],
      },
    }),
  };
});

afterEach(() => {
  cleanup();
  delete (window as any).electronAPI;
});

describe('ModelSelector', () => {
  it('does not render OpenAI Codex ACP in the new-session model menu', async () => {
    render(
      <ModelSelector
        currentModel="openai-codex:gpt-5.5"
        onModelChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-picker'));

    await waitFor(() => expect(screen.getByTestId('model-picker-provider-openai-codex')).toBeTruthy());
    expect(screen.queryByText('Codex ACP')).toBeNull();
    expect(screen.queryByTestId('model-picker-provider-openai-codex-acp')).toBeNull();
  });

  it('GREEN: shows only the embedded Claude entry when the advanced CLI switch is at its default', async () => {
    (window as any).electronAPI.aiGetModels.mockResolvedValue({
      success: true,
      grouped: {
        'claude-code': [{
          id: 'claude-code:sonnet',
          name: 'Claude Agent · Sonnet',
          provider: 'claude-code',
        }],
        'claude-code-cli': [{
          id: 'claude-code-cli:sonnet',
          name: 'Claude Code CLI · Sonnet',
          provider: 'claude-code-cli',
        }],
      },
    });

    render(
      <ModelSelector
        currentModel="openai-codex:gpt-5.5"
        onModelChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-picker'));

    await waitFor(() => expect(screen.getByTestId('model-picker-provider-claude-code')).toBeTruthy());
    expect(screen.queryByTestId('model-picker-provider-claude-code-cli')).toBeNull();
  });
});

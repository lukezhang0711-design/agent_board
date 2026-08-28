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
    aiRefreshModelCatalogs: vi.fn().mockResolvedValue(undefined),
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

  it('GREEN EO: keeps a cached catalog visible and selectable after a refresh failure', async () => {
    (window as any).electronAPI.aiGetModels.mockResolvedValue({
      success: true,
      grouped: {
        'claude-code': [{
          id: 'claude-code:opus-1m',
          name: 'Claude Agent · Opus (1M context)',
          provider: 'claude-code',
          resolvedModel: 'claude-opus-5[1m]',
          supportsEffort: true,
          supportedEffortLevels: ['low', 'ultra'],
        }],
        'openai-codex': [
          { id: 'openai-codex:gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'openai-codex', supportedEffortLevels: ['low', 'ultra'] },
          { id: 'openai-codex:gpt-5.6-terra', name: 'GPT-5.6 Terra', provider: 'openai-codex', supportedEffortLevels: ['low', 'ultra'] },
          { id: 'openai-codex:gpt-5.6-luna', name: 'GPT-5.6 Luna', provider: 'openai-codex', supportedEffortLevels: ['low', 'ultra'] },
        ],
      },
      catalogStatuses: {
        'openai-codex': {
          verified: true,
          modelSource: 'cache',
          lastSuccessAt: 1,
          lastError: { message: 'codex app-server model/list timed out after 20ms' },
        },
      },
    });

    const onModelChange = vi.fn();
    render(
      <ModelSelector
        currentModel="openai-codex:gpt-5.6-sol"
        onModelChange={onModelChange}
      />,
    );

    fireEvent.click(screen.getByTestId('model-picker'));

    await waitFor(() => expect(screen.getAllByText('GPT-5.6 Sol').length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText('GPT-5.6 Terra')).toBeTruthy();
    expect(screen.getByText('GPT-5.6 Luna')).toBeTruthy();
    expect(screen.getByText(/claude-opus-5\[1m\]/)).toBeTruthy();
    expect(screen.getByTestId('model-catalog-status-openai-codex').textContent)
      .toContain('codex app-server model/list timed out after 20ms');
    expect(screen.getByTestId('model-catalog-status-openai-codex').textContent)
      .toContain('上次成功获取于');
    expect(screen.getByTestId('model-catalog-status-openai-codex').textContent)
      .toContain('原样交给引擎');
    const cachedSol = screen.getAllByText('GPT-5.6 Sol')
      .map((node) => node.closest('.model-selector-option'))
      .find(Boolean) as HTMLButtonElement;
    expect(cachedSol.disabled).toBe(false);
    fireEvent.click(cachedSol);
    expect(onModelChange).toHaveBeenCalledWith('openai-codex:gpt-5.6-sol');
  });

  it('GREEN: keeps the original catalog failure visible when first discovery returned no models', async () => {
    (window as any).electronAPI.aiGetModels.mockResolvedValue({
      success: true,
      grouped: {},
      catalogStatuses: {
        'claude-code': {
          verified: false,
          modelSource: 'none',
          lastError: { message: 'Claude SDK supportedModels timed out after 20ms' },
        },
      },
    });

    render(
      <ModelSelector
        currentModel="openai-codex:gpt-5.6-sol"
        onModelChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-picker'));

    await waitFor(() => expect(screen.getByTestId('model-catalog-status-claude-code')).toBeTruthy());
    expect(screen.getByTestId('model-catalog-status-claude-code').textContent)
      .toContain('Claude SDK supportedModels timed out after 20ms');
    expect(screen.getByText('No models available')).toBeTruthy();
  });

  it('GREEN: labels the first-install static row as unverified and prevents selecting it', async () => {
    (window as any).electronAPI.aiGetModels.mockResolvedValue({
      success: true,
      grouped: {
        'claude-code': [{
          id: 'claude-code:opus-1m',
          name: 'Claude Agent · Opus (unverified)',
          provider: 'claude-code',
          unverifiedPlaceholder: true,
        }],
      },
      catalogStatuses: {
        'claude-code': { verified: false, modelSource: 'placeholder' },
      },
    });
    const onModelChange = vi.fn();

    render(
      <ModelSelector
        currentModel="openai-codex:gpt-5.6-sol"
        onModelChange={onModelChange}
      />,
    );

    fireEvent.click(screen.getByTestId('model-picker'));

    const placeholder = await screen.findByText('Claude Agent · Opus (unverified)');
    const button = placeholder.closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onModelChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('model-catalog-status-claude-code').textContent)
      .toContain('模型目录未验证');
  });

  it('GREEN: keeps the first-install unverified notice visible even when the placeholder row is withheld', async () => {
    (window as any).electronAPI.aiGetModels.mockResolvedValue({
      success: true,
      grouped: {
        openai: [{ id: 'openai:gpt-5', name: 'OpenAI GPT', provider: 'openai' }],
      },
      catalogStatuses: {
        'claude-code': { verified: false, modelSource: 'placeholder' },
      },
    });

    render(
      <ModelSelector
        currentModel="openai:gpt-5"
        onModelChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-picker'));

    await waitFor(() => expect(screen.getByTestId('model-catalog-status-claude-code')).toBeTruthy());
    expect(screen.getByTestId('model-catalog-status-claude-code').textContent)
      .toContain('模型目录未验证');
    expect(screen.queryByText(/Opus \(unverified\)/)).toBeNull();
  });

  it('RED FB-140: renders a dynamic extension provider group while its first catalog read is in flight', async () => {
    (window as any).electronAPI.aiGetModels.mockResolvedValue({
      success: true,
      grouped: {},
      providerLabels: {
        'antigravity-gemini-agent': 'Gemini',
      },
      catalogStatuses: {
        'antigravity-gemini-agent': {
          verified: false,
          modelSource: 'none',
          inFlight: true,
          lastSuccessAt: null,
          lastError: null,
        },
      },
    });

    render(
      <ModelSelector
        currentModel="openai-codex:gpt-5.6-sol"
        onModelChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-picker'));

    await waitFor(() => expect(screen.getByTestId('model-picker-provider-antigravity-gemini-agent')).toBeTruthy());
    expect(screen.getByTestId('model-picker-provider-antigravity-gemini-agent').textContent)
      .toContain('Gemini');
    expect(screen.getByTestId('model-catalog-refreshing-antigravity-gemini-agent').textContent)
      .toContain('正在读取模型目录');
    expect(screen.queryByText('No models available')).toBeNull();
  });

  it('RED FB-140: renders the raw dynamic extension catalog failure without hiding the provider group', async () => {
    (window as any).electronAPI.aiGetModels.mockResolvedValue({
      success: true,
      grouped: {},
      providerLabels: {
        'antigravity-gemini-agent': 'Gemini',
      },
      catalogStatuses: {
        'antigravity-gemini-agent': {
          verified: false,
          modelSource: 'none',
          inFlight: false,
          lastSuccessAt: null,
          lastError: { message: 'agy models failed: offline' },
        },
      },
    });

    render(
      <ModelSelector
        currentModel="openai-codex:gpt-5.6-sol"
        onModelChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('model-picker'));

    await waitFor(() => expect(screen.getByTestId('model-picker-provider-antigravity-gemini-agent')).toBeTruthy());
    expect(screen.getByTestId('model-catalog-status-antigravity-gemini-agent').textContent)
      .toContain('agy models failed: offline');
  });

  it('GREEN FB-116: keeps the cached Gemini rows selectable-looking while its explicit picker refresh is in flight', async () => {
    const refresh = (() => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    })();
    let refreshing = false;
    (window as any).electronAPI.aiGetModels.mockImplementation(async () => ({
      success: true,
      grouped: {
        'antigravity-gemini-agent': [{
          id: 'antigravity-gemini-agent:gemini-3.7-flash-high',
          name: 'Gemini 3.7 Flash High',
          provider: 'antigravity-gemini-agent',
        }],
      },
      catalogStatuses: {
        'antigravity-gemini-agent': {
          verified: true,
          modelSource: 'runtime',
          inFlight: refreshing,
          lastSuccessAt: 1,
          lastError: null,
        },
      },
    }));
    (window as any).electronAPI.aiRefreshModelCatalogs.mockImplementation(() => {
      refreshing = true;
      return refresh.promise;
    });

    render(
      <ModelSelector
        currentModel="antigravity-gemini-agent:gemini-3.7-flash-high"
        onModelChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('model-picker').textContent).toContain('Gemini 3.7 Flash High'));
    fireEvent.click(screen.getByTestId('model-picker'));

    await waitFor(() => expect((window as any).electronAPI.aiRefreshModelCatalogs).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('model-catalog-refreshing-antigravity-gemini-agent')).toBeTruthy());
    expect(screen.getAllByText('Gemini 3.7 Flash High').length).toBeGreaterThanOrEqual(2);

    refreshing = false;
    refresh.resolve();
    await waitFor(() => expect(screen.queryByTestId('model-catalog-refreshing-antigravity-gemini-agent')).toBeNull());
  });
});

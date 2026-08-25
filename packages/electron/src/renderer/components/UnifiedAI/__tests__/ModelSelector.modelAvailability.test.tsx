// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

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
  ModelIdentifier: { tryParse: () => null },
  isClaudeCodeFamily: () => false,
  isAgentProvider: (provider: string) => provider === 'claude-code',
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
        'claude-code': [{
          id: 'claude-code:claude-fable-5[1m]',
          name: 'Fable (1M)',
          provider: 'claude-code',
        }],
      },
      catalogStatuses: {
        'claude-code': {
          verified: true,
          modelSource: 'runtime',
          lastError: null,
        },
      },
    }),
    aiRefreshModelCatalogs: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  cleanup();
  delete (window as any).electronAPI;
});

describe('ModelSelector persisted model safety valve', () => {
  it('GREEN ES: marks an orphaned, non-migratable session model and explains the required reselection', async () => {
    const onModelChange = vi.fn();
    render(
      <ModelSelector
        currentModel="claude-code:unknown-product-legacy-id"
        onModelChange={onModelChange}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('model-current-unavailable')).toBeTruthy());

    expect(screen.getByTestId('model-current-unavailable').textContent)
      .toBe('这个会话存的型号引擎已经不提供了，请重新选一个');
    expect(screen.getByTestId('model-picker').getAttribute('aria-invalid')).toBe('true');
    expect(onModelChange).not.toHaveBeenCalled();
  });
});

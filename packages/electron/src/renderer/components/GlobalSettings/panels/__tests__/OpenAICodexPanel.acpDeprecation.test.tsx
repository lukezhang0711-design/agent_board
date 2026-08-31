// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  legacyAcpConfig: { enabled: false },
}));

vi.mock('jotai', () => ({
  useAtomValue: () => ({ enabled: true }),
  useSetAtom: () => vi.fn(),
}));
vi.mock('../../../../hooks/useSetting', () => ({
  useSetting: (key: string) => key === 'ai.provider.openai-codex-acp' ? mocks.legacyAcpConfig : true,
  useSetSetting: () => vi.fn(),
}));
vi.mock('../../../../store/atoms/appSettings', () => ({
  getProviderConfigAtom: () => ({}),
  setProviderConfigAtom: {},
}));

import { OpenAICodexPanel } from '../OpenAICodexPanel';

beforeEach(() => {
  mocks.legacyAcpConfig = { enabled: false };
  (window as any).electronAPI = {
    invoke: vi.fn(() => new Promise(() => {})),
    on: vi.fn(() => vi.fn()),
  };
});

afterEach(() => {
  cleanup();
  delete (window as any).electronAPI;
});

describe('OpenAICodexPanel', () => {
  it('RED FO: only shows the ACP deprecation notice for a legacy ACP configuration', () => {
    render(
      <OpenAICodexPanel
        config={{ enabled: false, testStatus: 'idle' }}
        apiKeys={{}}
        availableModels={[]}
        loading={false}
        onToggle={vi.fn()}
        onApiKeyChange={vi.fn()}
        onModelToggle={vi.fn()}
        onSelectAllModels={vi.fn()}
        onTestConnection={vi.fn()}
        onConfigChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('codex-acp-deprecation-notice')).toBeNull();
    expect(
      screen.queryByText('OpenAI Codex (ACP) is deprecated; existing sessions remain viewable, and we recommend using OpenAI Codex.'),
    ).toBeNull();
    expect(screen.queryByText('Enable ACP transport')).toBeNull();

    cleanup();
    mocks.legacyAcpConfig = { enabled: true };
    render(
      <OpenAICodexPanel
        config={{ enabled: false, testStatus: 'idle' }}
        apiKeys={{}}
        availableModels={[]}
        loading={false}
        onToggle={vi.fn()}
        onApiKeyChange={vi.fn()}
        onModelToggle={vi.fn()}
        onSelectAllModels={vi.fn()}
        onTestConnection={vi.fn()}
        onConfigChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText('OpenAI Codex (ACP) is deprecated; existing sessions remain viewable, and we recommend using OpenAI Codex.'),
    ).toBeTruthy();
  });
});

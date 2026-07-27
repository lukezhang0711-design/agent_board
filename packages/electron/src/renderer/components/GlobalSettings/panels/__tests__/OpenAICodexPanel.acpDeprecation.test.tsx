// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('jotai', () => ({
  useAtomValue: () => ({ enabled: true }),
  useSetAtom: () => vi.fn(),
}));
vi.mock('../../../../hooks/useSetting', () => ({
  useSetting: () => true,
  useSetSetting: () => vi.fn(),
}));
vi.mock('../../../../store/atoms/appSettings', () => ({
  getProviderConfigAtom: () => ({}),
  setProviderConfigAtom: {},
}));

import { OpenAICodexPanel } from '../OpenAICodexPanel';

beforeEach(() => {
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
  it('replaces the ACP enable toggle with the deprecation notice', () => {
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
    expect(screen.queryByText('Enable ACP transport')).toBeNull();
  });
});

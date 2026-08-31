// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('jotai', () => ({
  useAtom: () => [true, vi.fn()],
  useAtomValue: () => false,
}));
vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: () => null,
}));
vi.mock('../../../store/atoms/settingAtomFamily', () => ({
  settingAtom: vi.fn(),
}));
vi.mock('../../../store/atoms/appSettings', () => ({
  apiKeysAtom: {},
}));
vi.mock('../../GlobalSettings/SettingsToggle', () => ({
  SettingsToggle: () => null,
}));

import { ChannelHealthPanel } from '../ChannelHealthPanel';

afterEach(() => {
  cleanup();
  delete (window as any).electronAPI;
});

describe('ChannelHealthPanel dynamic catalog status', () => {
  it('keeps the original fetch failure visible and moves the last-success timestamp to hover text', async () => {
    (window as any).electronAPI = {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'channel-health:get') return { running: false, results: [] };
        if (channel === 'ai:getModelCatalogStatus') {
          return {
            catalogs: {
              'openai-codex': {
                modelSource: 'cache',
                verified: true,
                lastSuccessAt: 1,
                lastError: { message: 'codex app-server model/list timed out after 20ms' },
              },
            },
          };
        }
        return {};
      }),
    };

    render(<ChannelHealthPanel workspacePath="/workspace" />);

    await waitFor(() => expect(screen.getByTestId('model-catalog-health-openai-codex')).toBeTruthy());
    const status = screen.getByTestId('model-catalog-health-openai-codex');
    expect(status.textContent).toContain('目录获取失败：codex app-server model/list timed out after 20ms');
    expect(status.textContent).not.toContain('上次成功获取于');
    expect(status.getAttribute('title')).toContain('上次成功获取于');
  });
});

// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span aria-label={icon} />,
  getProviderIcon: () => <span aria-label="provider icon" />,
}));

import { ProjectAIProvidersPanel } from '../ProjectAIProvidersPanel';

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      aiGetSettings: vi.fn().mockResolvedValue({ providerSettings: {}, apiKeys: {} }),
      aiGetAllModels: vi.fn().mockResolvedValue({
        success: true,
        grouped: {},
        catalogStatuses: {
          'claude-code': { lastError: { message: 'Claude catalog failed' } },
          'openai-codex': { lastError: { message: 'Codex catalog failed' } },
        },
      }),
      invoke: vi.fn((channel: string) => {
        if (channel === 'ai:getProjectSettings') return Promise.resolve({ success: false });
        if (channel === 'ai:getProjectTrackerAutomation') return Promise.resolve({ success: false });
        return Promise.resolve({ success: true });
      }),
    },
  });
});

afterEach(() => {
  cleanup();
  delete (window as any).electronAPI;
});

describe('ProjectAIProvidersPanel catalog warnings', () => {
  it('RED FO: only surfaces a catalog warning for a provider listed on this page', async () => {
    render(<ProjectAIProvidersPanel workspacePath="/workspace" workspaceName="Workspace" />);

    expect(await screen.findByText(/claude-code 模型目录获取失败/)).toBeTruthy();
    expect(screen.queryByText(/openai-codex 模型目录获取失败/)).toBeNull();
  });
});

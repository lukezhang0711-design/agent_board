// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AntigravityAgentSettings } from '../AntigravityAgentSettings';

const baseProps = {
  config: { enabled: true, testStatus: 'idle' as const, backendModuleEnabled: true },
  onToggle: vi.fn(),
  onModelToggle: vi.fn(),
  onSelectAllModels: vi.fn(),
  onTestConnection: vi.fn(async () => {}),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AntigravityAgentSettings model catalog state', () => {
  it('RED FB-140: shows the catalog read state for never-loaded and in-flight Gemini models', () => {
    render(
      <AntigravityAgentSettings
        {...baseProps}
        availableModels={[]}
        loading={false}
        catalogStatus={{
          modelSource: 'none',
          verified: false,
          inFlight: true,
          lastError: null,
          lastSuccessAt: null,
        }}
      />,
    );

    expect(screen.getByTestId('antigravity-agent-models-loading').textContent)
      .toBe('正在读取模型目录…');
  });

  it('RED FB-140: shows a raw catalog failure with a retry button and no install/login guess', () => {
    const onRefreshModels = vi.fn(async () => {});
    render(
      <AntigravityAgentSettings
        {...baseProps}
        availableModels={[]}
        loading={false}
        catalogStatus={{
          modelSource: 'none',
          verified: false,
          inFlight: false,
          lastError: { message: 'agy models failed: offline' },
          lastSuccessAt: null,
        }}
        onRefreshModels={onRefreshModels}
      />,
    );

    expect(screen.getByTestId('antigravity-agent-models-error').textContent)
      .toContain('agy models failed: offline');
    expect(screen.queryByText(/请确认 Antigravity CLI 已安装且已登录/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRefreshModels).toHaveBeenCalledOnce();
  });

  it('RED FB-140: limits install/login guidance to matching engine errors', () => {
    render(
      <AntigravityAgentSettings
        {...baseProps}
        availableModels={[]}
        loading={false}
        catalogStatus={{
          modelSource: 'none',
          verified: false,
          inFlight: false,
          lastError: { message: 'Antigravity CLI not logged in' },
          lastSuccessAt: null,
        }}
      />,
    );

    expect(screen.getByTestId('antigravity-agent-models-guidance').textContent)
      .toContain('请确认 Antigravity CLI 已安装且已登录后重试。');
  });

  it('GREEN FB-140: lists the successful live Gemini catalog', () => {
    render(
      <AntigravityAgentSettings
        {...baseProps}
        availableModels={[{
          id: 'antigravity-gemini-agent:gemini-3.7-flash-high',
          name: 'Gemini 3.7 Flash High',
          provider: 'antigravity-gemini-agent',
        }]}
        loading={false}
        catalogStatus={{
          modelSource: 'runtime',
          verified: true,
          inFlight: false,
          lastError: null,
          lastSuccessAt: Date.now(),
        }}
      />,
    );

    expect(screen.getByText('Gemini 3.7 Flash High')).toBeTruthy();
    expect(screen.queryByTestId('antigravity-agent-models-error')).toBeNull();
  });
});

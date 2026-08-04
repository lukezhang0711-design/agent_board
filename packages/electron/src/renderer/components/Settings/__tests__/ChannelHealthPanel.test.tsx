// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span aria-label={icon} />,
}));
vi.mock('../../../store/atoms/settingAtomFamily', () => ({
  settingAtom: vi.fn(),
}));

import { ChannelHealthRow, type ChannelHealthResultView } from '../ChannelHealthPanel';

function renderRow(result: ChannelHealthResultView) {
  render(<ChannelHealthRow result={result} running={false} onRerun={vi.fn()} />);
}

describe('ChannelHealthPanel rows', () => {
  it('renders green, yellow, and actionable red health states', () => {
    renderRow({
      id: 'claude-code',
      displayName: 'Claude（嵌入式）',
      transport: 'streaming',
      state: 'healthy',
      checkedAt: 1,
      firstResponseMs: 90,
      completionMs: 300,
    });
    expect(screen.getByTestId('channel-health-status-claude-code').textContent).toContain('通畅 · 300 毫秒');

    renderRow({
      id: 'openai-codex',
      displayName: 'Codex',
      transport: 'streaming',
      state: 'slow',
      completionMs: 11_000,
    });
    expect(screen.getByTestId('channel-health-status-openai-codex').textContent).toContain('较慢 · 11 秒');

    renderRow({
      id: 'claude-code-cli',
      displayName: 'Claude CLI',
      transport: 'claude-cli',
      state: 'failed',
      summary: '未登录',
      guidance: '请运行 claude /login 后重试',
    });
    expect(screen.getByTestId('channel-health-status-claude-code-cli').textContent).toContain('失败 · 未登录');
    expect(screen.getByTestId('channel-health-guidance-claude-code-cli').textContent).toContain('请运行 claude /login 后重试');
  });

  it('RED: renders API-key and auth-precheck failures with their non-misleading status copy', () => {
    renderRow({
      id: 'claude',
      displayName: 'Claude API',
      transport: 'streaming',
      state: 'failed',
      summary: '未配置密钥',
      guidance: '在设置中填入 API Key，或不使用此通道可忽略',
    });
    expect(screen.getByTestId('channel-health-status-claude').textContent).toContain('失败 · 未配置密钥');
    expect(screen.getByTestId('channel-health-guidance-claude').textContent)
      .toContain('在设置中填入 API Key，或不使用此通道可忽略');

    renderRow({
      id: 'claude-code-cli-precheck',
      displayName: 'Claude CLI',
      transport: 'claude-cli',
      state: 'unknown',
      summary: '检测超时',
      guidance: '请稍后重试。',
    });
    expect(screen.getByTestId('channel-health-status-claude-code-cli-precheck').textContent)
      .toContain('检测超时');
    expect(screen.getByTestId('channel-health-guidance-claude-code-cli-precheck').textContent)
      .toContain('请稍后重试。');
  });

  it('RED: renders a disabled extension as gray and prevents a health request from this row', () => {
    const onRerun = vi.fn();
    render(
      <ChannelHealthRow
        result={{
          id: 'gemini-fixture',
          displayName: 'Gemini',
          transport: 'streaming',
          state: 'disabled',
          summary: '未启用',
        }}
        running={false}
        onRerun={onRerun}
      />,
    );

    expect(screen.getByTestId('channel-health-status-gemini-fixture').textContent).toContain('未启用');
    expect((screen.getByTestId('channel-health-rerun-gemini-fixture') as HTMLButtonElement).disabled).toBe(true);
    expect(onRerun).not.toHaveBeenCalled();
  });
});

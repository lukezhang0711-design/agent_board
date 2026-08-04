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
});

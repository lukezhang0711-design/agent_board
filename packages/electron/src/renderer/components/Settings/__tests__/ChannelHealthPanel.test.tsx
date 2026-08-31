// @vitest-environment jsdom
import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span aria-label={icon} />,
}));
vi.mock('../../../store/atoms/settingAtomFamily', () => ({
  settingAtom: vi.fn(),
  onSettingChanged: vi.fn(),
}));

import {
  ChannelHealthRow,
  filterVisibleChannelHealthResults,
  type ChannelHealthResultView,
} from '../ChannelHealthPanel';

function renderRow(result: ChannelHealthResultView) {
  render(<ChannelHealthRow result={result} running={false} onRerun={vi.fn()} />);
}

describe('ChannelHealthPanel rows', () => {
  it('GREEN: hides CLI when advanced visibility is off and hides Claude API without an API key', () => {
    const results: ChannelHealthResultView[] = [
      { id: 'claude-code', displayName: 'Claude（嵌入式）', transport: 'streaming', state: 'never' },
      { id: 'claude-code-cli', displayName: 'Claude CLI', transport: 'claude-cli', state: 'never' },
      { id: 'claude', displayName: 'Claude API', transport: 'streaming', state: 'never' },
    ];

    expect(filterVisibleChannelHealthResults(results, {
      showClaudeCliChannel: false,
      hasAnthropicApiKey: false,
    }).map((result) => result.id)).toEqual(['claude-code']);

    expect(filterVisibleChannelHealthResults(results, {
      showClaudeCliChannel: true,
      hasAnthropicApiKey: true,
    }).map((result) => result.id)).toEqual(['claude-code', 'claude-code-cli', 'claude']);
  });

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

  it('renders a healthy Codex API-key session as API key mode', () => {
    renderRow({
      id: 'openai-codex-api-key',
      displayName: 'Codex',
      transport: 'streaming',
      state: 'healthy',
      summary: 'API key 模式',
      completionMs: 120,
    });

    expect(screen.getByTestId('channel-health-status-openai-codex-api-key').textContent)
      .toContain('API key 模式 · 120 毫秒');
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

  it('GREEN: renders a real CLI exit as an engine error with its exit code', () => {
    renderRow({
      id: 'claude-code-cli-exit',
      displayName: 'Claude CLI',
      transport: 'claude-cli',
      state: 'failed',
      summary: '引擎错误',
      exitCode: 0,
    });

    expect(screen.getByTestId('channel-health-status-claude-code-cli-exit').textContent)
      .toContain('失败 · 引擎错误');
    expect(screen.getByTestId('channel-health-guidance-claude-code-cli-exit').textContent)
      .toContain('退出码 0');
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

  it('GREEN 3: renders actionable re-login exit with verbatim raw output and copyable command when not logged in', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    renderRow({
      id: 'claude-code',
      displayName: 'Claude（嵌入式）',
      transport: 'streaming',
      state: 'failed',
      failureKind: 'not_logged_in',
      summary: '未登录',
      guidance: '请运行 claude /login 后重试',
      rawOutput: '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}',
    });

    // 1. Red light status
    expect(screen.getByTestId('channel-health-status-claude-code').textContent).toContain('失败 · 未登录');

    // 2. Verbatim engine raw output
    const rawOutputEl = screen.getByTestId('channel-health-raw-output-claude-code');
    expect(rawOutputEl.textContent).toContain('{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}');

    // 3. Actionable re-login command and copy button
    const commandEl = screen.getByTestId('channel-health-relogin-command-claude-code');
    expect(commandEl.textContent).toBe('claude /login');

    const copyBtn = screen.getByTestId('channel-health-copy-relogin-claude-code');
    expect(copyBtn.textContent).toBe('复制命令');

    // Click copy button
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(writeTextMock).toHaveBeenCalledWith('claude /login');
  });

  it('GREEN 3: renders appropriate re-login commands for Codex and Antigravity', () => {
    renderRow({
      id: 'openai-codex',
      displayName: 'Codex',
      transport: 'streaming',
      state: 'failed',
      failureKind: 'not_logged_in',
      summary: '未登录',
    });
    expect(screen.getByTestId('channel-health-relogin-command-openai-codex').textContent).toBe('codex login');

    renderRow({
      id: 'antigravity-gemini-agent',
      displayName: 'Gemini (Antigravity)',
      transport: 'streaming',
      state: 'failed',
      failureKind: 'not_logged_in',
      summary: '未登录',
    });
    expect(screen.getByTestId('channel-health-relogin-command-antigravity-gemini-agent').textContent).toBe('antigravity auth login');
  });
});

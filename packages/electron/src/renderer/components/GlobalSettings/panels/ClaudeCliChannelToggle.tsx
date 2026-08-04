import React from 'react';
import { useAtom } from 'jotai';
import { settingAtom } from '../../../store/atoms/settingAtomFamily';
import { SettingsToggle } from '../SettingsToggle';

export function ClaudeCliChannelToggle() {
  const [showClaudeCliChannel, setShowClaudeCliChannel] = useAtom(
    settingAtom('ai.showClaudeCliChannel'),
  );

  return (
    <SettingsToggle
      checked={showClaudeCliChannel}
      onChange={(enabled) => { void setShowClaudeCliChannel(enabled); }}
      name="高级：显示 Claude CLI 通道"
      description="仅影响新会话入口和通道体检；已有 Claude CLI 会话仍可继续对话。"
      testId="show-claude-cli-channel-toggle"
    />
  );
}

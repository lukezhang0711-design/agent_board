import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const electronRoot = existsSync(resolve(process.cwd(), 'src/renderer/components'))
  ? process.cwd()
  : resolve(process.cwd(), 'packages/electron');
const componentRoot = resolve(electronRoot, 'src/renderer/components');

function source(relativePath: string): string {
  return readFileSync(resolve(componentRoot, relativePath), 'utf8');
}

function electronSource(relativePath: string): string {
  return readFileSync(resolve(electronRoot, relativePath), 'utf8');
}

describe('FO product-copy cleanup contracts', () => {
  it('removes the four mixed-language runtime diagnostics from provider panels', () => {
    for (const relativePath of [
      'GlobalSettings/panels/CopilotCLIPanel.tsx',
      'GlobalSettings/panels/OpenAICodexPanel.tsx',
      'GlobalSettings/panels/OpenCodePanel.tsx',
      'GlobalSettings/panels/ClaudeCodePanel.tsx',
    ]) {
      expect(source(relativePath)).not.toContain('Current runtime (当前使用)');
    }
  });

  it('removes at least ten confirmed permanent implementation explanations', () => {
    const removedCopies: Array<[string, string]> = [
      ['Settings/ChannelHealthPanel.tsx', '默认使用各引擎原生登录/控制面探测，不发送模型提示、不消耗推理额度。'],
      ['Settings/ChannelHealthPanel.tsx', '默认开启；同一通道 10 分钟内不会重复自动体检。'],
      ['Settings/ChannelHealthPanel.tsx', '默认体检只检查登录或控制面状态；仅“深度体检”会发送固定一句话。'],
      ['Settings/ChannelHealthPanel.tsx', '深度体检（发送一句话）'],
      ['Settings/ChannelHealthPanel.tsx', '· 首响'],
      ['GlobalSettings/panels/MCPServersPanel.tsx', 'Connection testing is disabled for native MCP OAuth servers.'],
      ['Settings/panels/ProjectPermissionsPanel.tsx', 'Approvals saved to .claude/settings.local.json.'],
      ['Settings/panels/ExtensionConfigPanel.tsx', 'not supported in UI'],
      ['Settings/panels/TrackerConfigPanel.tsx', 'Right-click any inline tracker'],
      ['Settings/panels/InstalledExtensionsPanel.tsx', 'Extensions are installed in the extensions folder.'],
      ['GlobalSettings/panels/ClaudeCodePluginsPanel.tsx', 'enabledPlugins for this scope'],
      ['MetaAgentMode/FilePreviewRail.tsx', '工人改过或写出的文件会自动排到这里。'],
    ];

    for (const [relativePath, copy] of removedCopies) {
      expect(source(relativePath)).not.toContain(copy);
    }
  });

  it('keeps the required honest disclosures and safety confirmations', () => {
    expect(electronSource('src/renderer/utils/dispatchSkillLibrary.ts'))
      .toContain('Codex：技能管控只能会话级禁用、无逐次审批。');
    expect(source('UnifiedAI/PlanApprovalWidget.tsx'))
      .toContain('个技能在当前引擎不可用（换回');
    expect(source('UsageIndicator/AIUsagePopover.tsx'))
      .toContain('（本次会话累计消耗，非剩余额度）');
    expect(source('UsageIndicator/AIUsagePopover.tsx'))
      .toContain('Antigravity 桌面版未运行');
    expect(source('AIUsageReport/OverviewDashboard.tsx'))
      .toContain("return value == null ? '—' : value.toLocaleString();");
    expect(source('AIUsageReport/OverviewDashboard.tsx'))
      .toContain('a blank cache value is unavailable data, not no cache.');
    expect(source('TrackerMode/TrackerItemDetail.tsx'))
      .toContain('This cannot be undone.');
  });
});

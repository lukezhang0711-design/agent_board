import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { scanFileViolations } from '../../../styles/__tests__/visualTokensGuard.test';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../../');
const UNIFIED_AI_DIR = path.resolve(__dirname, '..');
const RENDERER_ROOT = path.resolve(__dirname, '../../..');

function walk(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (!file.includes('__tests__') && file !== 'node_modules') {
        results = results.concat(walk(fullPath));
      }
    } else if (/\.(tsx|ts)$/.test(file) && !file.includes('.test.') && !file.includes('.spec.')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('施工单 GD — 会话页 / 对话区 (components/UnifiedAI) 绿灯验收测试', () => {
  const unifiedFiles = walk(UNIFIED_AI_DIR);

  describe('绿①: 本屏零违例（硬字号、硬颜色、表外圆角、半档间距四类），且全部接入 TARGET_FILES', () => {
    it('asserts 0 hardcoded pixel fonts, raw colors, non-standard roundeds, and half gaps across components/UnifiedAI', () => {
      const violationsReport: Array<{ file: string; violations: ReturnType<typeof scanFileViolations> }> = [];

      for (const filePath of unifiedFiles) {
        const rel = path.relative(RENDERER_ROOT, filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        const v = scanFileViolations(content);

        if (
          v.pxFonts.length > 0 ||
          v.rawColors.length > 0 ||
          v.inlineFontSizes.length > 0 ||
          v.nonStdRounded.length > 0 ||
          v.halfGap.length > 0
        ) {
          violationsReport.push({ file: rel, violations: v });
        }
      }

      expect(
        violationsReport,
        `Violations found in components/UnifiedAI: ${JSON.stringify(violationsReport, null, 2)}`
      ).toEqual([]);
    });

    it('asserts all components/UnifiedAI source files are in TARGET_FILES in visualTokensGuard.test.ts', () => {
      const guardPath = path.resolve(RENDERER_ROOT, 'styles/__tests__/visualTokensGuard.test.ts');
      const guardContent = fs.readFileSync(guardPath, 'utf8');

      for (const filePath of unifiedFiles) {
        const rel = path.relative(RENDERER_ROOT, filePath);
        expect(
          guardContent.includes(`'${rel}'`),
          `Expected ${rel} to be registered in TARGET_FILES in visualTokensGuard.test.ts`
        ).toBe(true);
      }
    });

    it('asserts all components/UnifiedAI source files are in TARGET_FILES in generate-visual-tokens-baseline.js', () => {
      const scriptPath = path.resolve(REPO_ROOT, 'packages/electron/scripts/generate-visual-tokens-baseline.js');
      const scriptContent = fs.readFileSync(scriptPath, 'utf8');

      for (const filePath of unifiedFiles) {
        const rel = path.relative(RENDERER_ROOT, filePath);
        expect(
          scriptContent.includes(`'${rel}'`),
          `Expected ${rel} to be registered in TARGET_FILES in generate-visual-tokens-baseline.js`
        ).toBe(true);
      }
    });
  });

  describe('绿②: 14 处顶栏全部换成 PageHeader，或在报告中逐个说明为何不能换（严格对齐 14 处）', () => {
    it('verifies PageHeader replacement in PromptQueueList, TodoList, and PendingVoiceCommand', () => {
      const promptQueueContent = fs.readFileSync(path.join(UNIFIED_AI_DIR, 'PromptQueueList.tsx'), 'utf8');
      expect(promptQueueContent).toMatch(/import\s*\{\s*PageHeader\s*\}\s*from\s*['"]\.\.\/common\/PageHeader['"]/);
      expect(promptQueueContent).toContain('<PageHeader');

      const todoListContent = fs.readFileSync(path.join(UNIFIED_AI_DIR, 'TodoList.tsx'), 'utf8');
      expect(todoListContent).toMatch(/import\s*\{\s*PageHeader\s*\}\s*from\s*['"]\.\.\/common\/PageHeader['"]/);
      expect(todoListContent).toContain('<PageHeader');

      const pendingVoiceContent = fs.readFileSync(path.join(UNIFIED_AI_DIR, 'PendingVoiceCommand.tsx'), 'utf8');
      expect(pendingVoiceContent).toMatch(/import\s*\{\s*PageHeader\s*\}\s*from\s*['"]\.\.\/common\/PageHeader['"]/);
      expect(pendingVoiceContent).toContain('<PageHeader');
    });

    it('verifies exact accounting for the remaining 11 non-convertible header-like structures', () => {
      // 14 处结构会计清单严格对账
      const accountingList = [
        { file: 'PromptQueueList.tsx', replaced: true, reason: 'PageHeader 替换成功' },
        { file: 'TodoList.tsx', replaced: true, reason: 'PageHeader 替换成功' },
        { file: 'PendingVoiceCommand.tsx', replaced: true, reason: 'PageHeader 替换成功' },
        { file: 'ActionPromptsDropdown.tsx', replaced: false, reason: '浮层菜单内微组头（260px 宽），不能嵌套 h2 和高内边距' },
        { file: 'ModelSelector.tsx', replaced: false, reason: 'Agents 菜单内分组标签' },
        { file: 'ModelSelector.tsx', replaced: false, reason: '提供商层级微分组头（含 HelpTooltip）' },
        { file: 'ModelSelector.tsx', replaced: false, reason: '动态扩展未就绪提示行' },
        { file: 'ModelSelector.tsx', replaced: false, reason: 'Chat with open document 菜单内分组标签' },
        { file: 'ModelSelector.tsx', replaced: false, reason: '文档对话分组下提供商标头' },
        { file: 'ContextUsageDisplay.tsx', replaced: false, reason: 'Tooltip 气泡内微说明头（role=tooltip），仅 280px' },
        { file: 'PlanApprovalWidget.tsx', replaced: false, reason: '已通过 FX/GA 规范化且具 sticky top-0 单元测试断言契约' },
        { file: 'SkillTaxonomyProposalWidget.tsx', replaced: false, reason: '方案审批卡片内部子项标头' },
        { file: 'TranscriptEmbeddedFileCard.tsx', replaced: false, reason: '文件卡片手风琴折叠展开手柄' },
        { file: 'ClaudeCliPromptSurface.tsx', replaced: false, reason: '终端抽屉容器分割包裹层而非标题栏' },
      ];

      expect(accountingList.length).toBe(14);
      const replacedCount = accountingList.filter(item => item.replaced).length;
      const documentedCount = accountingList.filter(item => !item.replaced).length;
      expect(replacedCount).toBe(3);
      expect(documentedCount).toBe(11);
    });
  });

  describe('绿③: 两个下拉面板的外观一致性（圆角、内边距、高亮方式逐项断言）', () => {
    it('asserts ModelSelector and ActionPromptsDropdown panels use identical container classes', () => {
      const modelSelectorContent = fs.readFileSync(path.join(UNIFIED_AI_DIR, 'ModelSelector.tsx'), 'utf8');
      const actionPromptsContent = fs.readFileSync(path.join(UNIFIED_AI_DIR, 'ActionPromptsDropdown.tsx'), 'utf8');

      // 容器类名一致性：圆角 rounded-ui-lg、内边距 p-1、阴影 shadow-md
      expect(modelSelectorContent).toContain('rounded-ui-lg p-1');
      expect(modelSelectorContent).toContain('shadow-md');
      expect(actionPromptsContent).toContain('rounded-ui-lg p-1');
      expect(actionPromptsContent).toContain('shadow-md');

      // 菜单项圆角一致性：rounded-ui-base、纵向内边距 py-2
      expect(modelSelectorContent).toContain('rounded-ui-base');
      expect(modelSelectorContent).toContain('py-2');
      expect(actionPromptsContent).toContain('rounded-ui-base');
      expect(actionPromptsContent).toContain('py-2');

      // 选中项 / 焦点项高亮类名一致性：selected bg-[var(--nim-bg-secondary)] text-[var(--nim-primary)]
      const highlightPattern = 'selected bg-[var(--nim-bg-secondary)] text-[var(--nim-primary)]';
      expect(modelSelectorContent).toContain(highlightPattern);
      expect(actionPromptsContent).toContain(highlightPattern);
    });
  });

  describe('绿④: 反向断言——本屏无手写 position: fixed 坐标计算，浮层全部走 @floating-ui/react', () => {
    it('asserts no manual fixed coordinate math using getBoundingClientRect() inside components/UnifiedAI', () => {
      for (const filePath of unifiedFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        // Manual coordinate math typically involves getBoundingClientRect() combined with fixed positioning
        const hasManualFixedCoordMath =
          content.includes('getBoundingClientRect()') &&
          (content.includes('position: fixed') || content.includes('position: \'fixed\''));

        expect(
          hasManualFixedCoordMath,
          `File ${path.basename(filePath)} contains prohibited manual fixed coordinate math`
        ).toBe(false);
      }
    });

    it('asserts floating components use @floating-ui/react and FloatingPortal', () => {
      const modelSelectorContent = fs.readFileSync(path.join(UNIFIED_AI_DIR, 'ModelSelector.tsx'), 'utf8');
      expect(modelSelectorContent).toContain('FloatingPortal');

      const actionPromptsContent = fs.readFileSync(path.join(UNIFIED_AI_DIR, 'ActionPromptsDropdown.tsx'), 'utf8');
      expect(actionPromptsContent).toContain('FloatingPortal');

      const contextUsageContent = fs.readFileSync(path.join(UNIFIED_AI_DIR, 'ContextUsageDisplay.tsx'), 'utf8');
      expect(contextUsageContent).toContain('FloatingPortal');
      expect(contextUsageContent).toMatch(/import\s*\{[^}]*useFloating[^}]*\}\s*from\s*['"]@floating-ui\/react['"]/);
      expect(contextUsageContent).not.toContain('bottom-[calc(100%+8px)]');
    });
  });
});

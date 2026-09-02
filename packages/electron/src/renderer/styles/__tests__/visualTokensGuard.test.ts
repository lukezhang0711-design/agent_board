import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { visualTokens } from '../visualTokens';

const TARGET_FILES = [
  'components/UnifiedAI/PlanApprovalWidget.tsx',
  'components/Settings/SkillLibraryPanel.tsx',
  'components/Settings/ChannelHealthPanel.tsx',
  'components/TrackerMode/SessionKanbanBoard.tsx',
  'components/UsageIndicator/AIUsageIndicator.tsx',
  'components/UsageIndicator/AIUsagePopover.tsx',
  'components/UsageIndicator/UsagePoolList.tsx',
  'components/common/PageHeader.tsx',
  'components/common/EmptyStateMessage.tsx',
  'components/common/AgentBusyIndicator.tsx',
  'components/common/SettingsSection.tsx',
  'components/common/ItemCard.tsx',
  'components/common/StatusBadge.tsx',
  'components/common/Toolbar.tsx',
  // AgenticCoding (施工单 GE 已迁移)
  'components/AgenticCoding/AgentSessionHeader.tsx',
  'components/AgenticCoding/AgenticInput.tsx',
  'components/AgenticCoding/ArchiveProgress.tsx',
  'components/AgenticCoding/AttachmentPreview.tsx',
  'components/AgenticCoding/AttachmentPreviewList.tsx',
  'components/AgenticCoding/BlitzGroup.tsx',
  'components/AgenticCoding/CollapsibleGroup.tsx',
  'components/AgenticCoding/IndexBuildDialog.tsx',
  'components/AgenticCoding/MetaAgentGroup.tsx',
  'components/AgenticCoding/NewSuperLoopDialog.tsx',
  'components/AgenticCoding/ResizablePanel.tsx',
  'components/AgenticCoding/SessionContextMenu.tsx',
  'components/AgenticCoding/SessionHistory.tsx',
  'components/AgenticCoding/SessionImportDialog.tsx',
  'components/AgenticCoding/SessionListItem.tsx',
  'components/AgenticCoding/SessionRelativeTime.tsx',
  'components/AgenticCoding/SuperLoopGroup.tsx',
  'components/AgenticCoding/WorkstreamGroup.tsx',
  'components/AgenticCoding/WorktreeBaseBranchPicker.tsx',
  // AgentMode (施工单 GE 已迁移)
  'components/AgentMode/AgentMode.tsx',
  'components/AgentMode/AgentModelPicker.tsx',
  'components/AgentMode/AgentSessionPanel.tsx',
  'components/AgentMode/AgentWorkstreamPanel.tsx',
  'components/AgentMode/ArchiveBlitzDialog.tsx',
  'components/AgentMode/ArchiveWorktreeDialog.tsx',
  'components/AgentMode/BadGitStateDialog.tsx',
  'components/AgentMode/FilesEditedSidebar.tsx',
  'components/AgentMode/FilesScopeDropdown.tsx',
  'components/AgentMode/GitOperationsPanel.tsx',
  'components/AgentMode/MergeConfirmDialog.tsx',
  'components/AgentMode/MergeConflictDialog.tsx',
  'components/AgentMode/RebaseConflictDialog.tsx',
  'components/AgentMode/SquashCommitModal.tsx',
  'components/AgentMode/SuperFilesPanel.tsx',
  'components/AgentMode/TaskListPanel.tsx',
  'components/AgentMode/TeammatePanel.tsx',
  'components/AgentMode/TodoPanel.tsx',
  'components/AgentMode/TrackerPanel.tsx',
  'components/AgentMode/UntrackedFilesConflictDialog.tsx',
  'components/AgentMode/WorkstreamEditorTabs.tsx',
  'components/AgentMode/WorkstreamSessionTabs.tsx',
  'components/AgentMode/index.ts',
];

const RENDERER_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(RENDERER_ROOT, '../../../../');
const BASELINE_PATH = path.resolve(__dirname, '../visualTokensBaseline.json');

const ALLOWED_ROUNDED = /^rounded-ui-(?:base|lg|full|none)(?:-[tblr])?$/;

export function scanFileViolations(content: string, isExempt = false) {
  const pxFontRegex = /text-\[\d+(?:\.\d+)?px\]/g;
  const pxSpacingRegex = /(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[\d+(?:\.\d+)?px\]/g;
  const rawColorRegex = /(?:bg|text|border|ring)-\[#(?:[0-9a-fA-F]+)\]|(?:bg|text|border|ring)-\[rgb[a]?\([^)]+\)\]/g;
  const inlineFontSizeRegex = /fontSize:\s*['"]?\d+(?:\.\d+)?(?:px)?['"]?/g;

  let nonStdRounded: string[] = [];
  let halfGap: string[] = [];

  if (!isExempt) {
    const rawRoundeds = content.match(/(?<![a-zA-Z0-9_\-])rounded[^\s"'`>]+/g) ?? [];
    nonStdRounded = rawRoundeds.filter(cls => !ALLOWED_ROUNDED.test(cls));

    // 施工单 GH (甲案): 放行 p*-0.5 (微内衬 2px，用于徽章/药丸/小标签上下内衬)，其余 15 类间距/外边距/内边距前缀的任意 .5 档一律违例
    const halfSpacingRegex = /(?<![a-zA-Z0-9_])-?(?:gap(?:-[xy])?-\d*\.5|m[xytblr]?-\d*\.5|p[xytblr]?-(?!0\.5\b)\d*\.5)(?![a-zA-Z0-9_\-])/g;
    halfGap = content.match(halfSpacingRegex) ?? [];
  }

  return {
    pxFonts: [...(content.match(pxFontRegex) ?? []), ...(content.match(inlineFontSizeRegex) ?? [])],
    pxSpacings: content.match(pxSpacingRegex) ?? [],
    rawColors: content.match(rawColorRegex) ?? [],
    inlineFontSizes: content.match(inlineFontSizeRegex) ?? [],
    nonStdRounded,
    halfGap,
  };
}

function walkRendererFiles(dir: string): string[] {
  let results: string[] = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        if (!file.includes('__tests__') && file !== 'node_modules') {
          results = results.concat(walkRendererFiles(fullPath));
        }
      } else if (/\.(tsx|ts|jsx|js)$/.test(file) && !file.includes('.test.') && !file.includes('.spec.')) {
        results.push(fullPath);
      }
    });
  } catch (e) {}
  return results;
}

describe('Visual Token Guard & Single Truth Table (施工单 FX & GA)', () => {
  describe('既有底座与令牌表完整性验证', () => {
    it('defines visualTokens in a single source file with all four groups', () => {
      expect(visualTokens).toBeDefined();
      expect(visualTokens.fontSize).toBeDefined();
      expect(visualTokens.spacing).toBeDefined();
      expect(visualTokens.radius).toBeDefined();
      expect(visualTokens.surfaceLayer).toBeDefined();
    });

    it('has no more than 10 font size tiers (actual: 8 tiers)', () => {
      const fontTiers = Object.keys(visualTokens.fontSize);
      expect(fontTiers.length).toBeLessThanOrEqual(10);
      expect(fontTiers).toEqual([
        'micro',
        'caption',
        'compact',
        'body',
        'subhead',
        'title',
        'headline',
        'display',
      ]);
    });

    it('has no more than 8 spacing tiers (actual: 8 tiers)', () => {
      const spacingTiers = Object.keys(visualTokens.spacing);
      expect(spacingTiers.length).toBeLessThanOrEqual(8);
      expect(spacingTiers).toEqual([
        'none',
        'micro',
        'tight',
        'compact',
        'normal',
        'card',
        'section',
        'spacious',
      ]);
    });

    it('binds all surface layers strictly to --nim-* theme variables', () => {
      for (const [key, layer] of Object.entries(visualTokens.surfaceLayer)) {
        expect(layer.value, `Layer ${key} must reference var(--nim-*)`).toMatch(/^var\(--nim-/);
      }
    });

    it('catches synthetic hardcoded pixel font, spacing, raw colors, and inline font sizes', () => {
      const mockViolationCode = `
        <div className="text-[13px] p-[7px] bg-[#e74c3c] border-[rgba(96,165,250,0.5)] rounded-xl gap-1.5" style={{ fontSize: '16px' }}>
          Violation test
        </div>
      `;
      const result = scanFileViolations(mockViolationCode);
      expect(result.pxFonts).toContain('text-[13px]');
      expect(result.pxFonts).toContain("fontSize: '16px'");
      expect(result.pxSpacings).toContain('p-[7px]');
      expect(result.rawColors).toContain('bg-[#e74c3c]');
      expect(result.rawColors).toContain('border-[rgba(96,165,250,0.5)]');
      expect(result.nonStdRounded).toContain('rounded-xl');
      expect(result.halfGap).toContain('gap-1.5');
    });
  });

  describe('绿①: DESIGN.md 存在且五组令牌与九大节齐全且 10 条要点在案', () => {
    const designMdPath = path.resolve(REPO_ROOT, 'DESIGN.md');

    it('exists at repository root', () => {
      expect(fs.existsSync(designMdPath), `DESIGN.md must exist at ${designMdPath}`).toBe(true);
    });

    it('contains all 5 token groups in YAML frontmatter', () => {
      const content = fs.readFileSync(designMdPath, 'utf8');
      expect(content).toMatch(/^---\s*\n/);
      expect(content).toMatch(/\ncolors:\s*\n/);
      expect(content).toMatch(/\ntypography:\s*\n/);
      expect(content).toMatch(/\nrounded:\s*\n/);
      expect(content).toMatch(/\nspacing:\s*\n/);
      expect(content).toMatch(/\ncomponents:\s*/);
      expect(content).toMatch(/GB/); // 组件节明确注明由 GB 单补齐
    });

    it('contains all 9 body sections with exact headings', () => {
      const content = fs.readFileSync(designMdPath, 'utf8');
      const requiredSections = [
        '## Overview',
        '## Colors',
        '## Typography',
        '## Layout',
        '## Elevation & Depth',
        '## Shapes',
        "## Do's and Don'ts",
        '## Iteration Guide',
        '## Known Gaps',
      ];
      for (const section of requiredSections) {
        expect(content, `DESIGN.md must contain section ${section}`).toContain(section);
      }
    });

    it('embodies all 10 core principles required by chief reviewer', () => {
      const content = fs.readFileSync(designMdPath, 'utf8');
      // 1. 总原则：好看不是画得漂亮，是把能选的值砍到很少
      expect(content).toMatch(/好看不是画得漂亮|能选的值.*砍到很少/);
      // 2. 字号 8 档，按用途命名，不按大小命名，档位越多层级越糊
      expect(content).toMatch(/字号 8 档|按用途命名/);
      expect(content).toMatch(/档位越多层级越糊/);
      // 3. 底色分四层，同屏最多同时存在两层浮起
      expect(content).toMatch(/底色分四层|四层职责固定/);
      expect(content).toMatch(/同屏最多同时存在两层浮起/);
      // 4. 一屏只能有一个实心主色按钮
      expect(content).toMatch(/一屏只能有一个实心主色按钮/);
      // 5. 淡文字必须有自己的颜色档，绝不用透明度调淡，极淡只许用于非文字记号
      expect(content).toMatch(/淡文字必须有自己的颜色档|绝不用透明度调淡/);
      expect(content).toMatch(/只许用于分隔线|禁止用于文字/);
      // 6. 密集列表用带分隔线的行，不要用圆角卡片
      expect(content).toMatch(/密集列表用带分隔线的行|不要用圆角卡片/);
      // 7. 默认选更安静的那个
      expect(content).toMatch(/默认选更安静的那个/);
      // 8. 颜色只走 --nim-* 主题变量
      expect(content).toMatch(/--nim-\*.*主题变量/);
      // 9. Do's and Don'ts 至少写 10 条且带本仓库真实反例
      const dosAndDontsMatch = content.match(/\d+\.\s+\*\*Do\*\*:/g);
      expect(dosAndDontsMatch).not.toBeNull();
      expect(dosAndDontsMatch!.length).toBeGreaterThanOrEqual(10);
      expect(content).toMatch(/packages\/electron\/src\/renderer\/components\//);
      // 10. Known Gaps 如实写缺口
      expect(content).toMatch(/Known Gaps/);
      expect(content).toMatch(/通用零件|引擎品牌图标|动效/);
    });
  });

  describe('绿②: DESIGN.md 零个写死的十六进制色值（反向断言）', () => {
    it('contains zero hardcoded hex color codes in DESIGN.md', () => {
      const designMdPath = path.resolve(REPO_ROOT, 'DESIGN.md');
      const content = fs.readFileSync(designMdPath, 'utf8');
      const hexColorRegex = /#[0-9a-fA-F]{3,8}\b/g;
      const hexMatches = content.match(hexColorRegex);
      expect(hexMatches, `DESIGN.md must have 0 hex colors, found: ${hexMatches?.join(', ')}`).toBeNull();
    });
  });

  describe('绿①: 全渲染层只剩三档圆角与过渡接缝及其方向变体（反向断言）', () => {
    it('has zero rounded-md, rounded-lg, rounded-sm, 裸 rounded, rounded-[Npx] across renderer (excluding common)', () => {
      const allFiles = walkRendererFiles(RENDERER_ROOT).filter(
        f => !path.relative(RENDERER_ROOT, f).startsWith('components/common/') &&
             !path.relative(RENDERER_ROOT, f).startsWith('styles/')
      );

      const forbiddenNamed = [
        'rounded-md',
        'rounded-lg',
        'rounded-sm',
        'rounded-[3px]',
        'rounded-[5px]',
        'rounded-[7px]',
        'rounded-[0.625rem]',
        'rounded-[24px]',
      ];

      for (const pattern of forbiddenNamed) {
        const matchingFiles: string[] = [];
        allFiles.forEach(f => {
          const content = fs.readFileSync(f, 'utf8');
          if (content.includes(pattern)) {
            matchingFiles.push(path.relative(RENDERER_ROOT, f));
          }
        });
        expect(
          matchingFiles,
          `Found forbidden rounded class ${pattern} in: ${matchingFiles.join(', ')}`
        ).toEqual([]);
      }

      // Check bare rounded
      const bareMatchingFiles: string[] = [];
      const bareRegex = /(?<![a-zA-Z0-9_\-])rounded(?![a-zA-Z0-9_\-])/g;
      allFiles.forEach(f => {
        const content = fs.readFileSync(f, 'utf8');
        if (bareRegex.test(content)) {
          bareMatchingFiles.push(path.relative(RENDERER_ROOT, f));
        }
      });
      expect(
        bareMatchingFiles,
        `Found bare rounded in: ${bareMatchingFiles.join(', ')}`
      ).toEqual([]);
    });
  });

  describe('绿②: rounded-ui-sm 已从令牌表移除，全渲染层零引用', () => {
    it('has removed rounded-ui-sm from visualTokens.radius', () => {
      expect((visualTokens.radius as Record<string, unknown>).sm).toBeUndefined();
      expect(Object.keys(visualTokens.radius)).toEqual(['none', 'base', 'lg', 'full']);
      expect(visualTokens.radius.base.status).toBe('formal');
      expect(visualTokens.radius.lg.status).toBe('formal');
      expect(visualTokens.radius.full.status).toBe('formal');
      expect(visualTokens.radius.none.status).toBe('transitional');
    });

    it('has zero references to rounded-ui-sm across entire renderer', () => {
      const allFiles = walkRendererFiles(RENDERER_ROOT);
      const matchingFiles: string[] = [];
      allFiles.forEach(f => {
        const content = fs.readFileSync(f, 'utf8');
        if (content.includes('rounded-ui-sm')) {
          matchingFiles.push(path.relative(RENDERER_ROOT, f));
        }
      });
      expect(
        matchingFiles,
        `Found rounded-ui-sm in: ${matchingFiles.join(', ')}`
      ).toEqual([]);
    });
  });

  describe('绿③: 半档内边距九类全部为 0（逐类断言）', () => {
    it('asserts each of the 9 half-step padding/gap classes has zero occurrences', () => {
      const allFiles = walkRendererFiles(RENDERER_ROOT).filter(
        f => !path.relative(RENDERER_ROOT, f).startsWith('components/common/') &&
             !path.relative(RENDERER_ROOT, f).startsWith('styles/')
      );

      const nineClasses = [
        'py-1.5',
        'px-1.5',
        'p-1.5',
        'pt-1.5',
        'pb-1.5',
        'pl-1.5',
        'pr-1.5',
        'px-3.5',
        'gap-3.5',
      ];

      for (const cls of nineClasses) {
        const regex = new RegExp(`(?<![a-zA-Z0-9_\\-])${cls.replace('.', '\\.')}(?![a-zA-Z0-9_\\-])`, 'g');
        const matchingFiles: string[] = [];
        allFiles.forEach(f => {
          const content = fs.readFileSync(f, 'utf8');
          if (regex.test(content)) {
            matchingFiles.push(path.relative(RENDERER_ROOT, f));
          }
        });
        expect(
          matchingFiles,
          `Found half-step class ${cls} in: ${matchingFiles.join(', ')}`
        ).toEqual([]);
      }
    });
  });

  describe('绿④: 守门圆角判定为白名单式——注入夹具被拦截', () => {
    it('catches rounded-t-xl fixture', () => {
      const result = scanFileViolations('<div className="rounded-t-xl" />');
      expect(result.nonStdRounded).toContain('rounded-t-xl');
    });

    it('catches rounded-3xl fixture', () => {
      const result = scanFileViolations('<div className="rounded-3xl" />');
      expect(result.nonStdRounded).toContain('rounded-3xl');
    });

    it('catches rounded-[7px] fixture', () => {
      const result = scanFileViolations('<div className="rounded-[7px]" />');
      expect(result.nonStdRounded).toContain('rounded-[7px]');
    });
  });

  describe('绿①: 守门半档判定覆盖十五类前缀的任意 .5 档（注入 mt-1.5、px-2.5、mb-3.5 夹具均被拦截）', () => {
    it('catches mt-1.5, px-2.5, mb-3.5 fixtures', () => {
      const r1 = scanFileViolations('<div className="mt-1.5" />');
      expect(r1.halfGap).toContain('mt-1.5');
      const r2 = scanFileViolations('<div className="px-2.5" />');
      expect(r2.halfGap).toContain('px-2.5');
      const r3 = scanFileViolations('<div className="mb-3.5" />');
      expect(r3.halfGap).toContain('mb-3.5');
    });

    it('covers all fifteen prefix categories of half-step spacing', () => {
      const fifteenPrefixes = [
        'gap-1.5',
        'gap-x-1.5',
        'gap-y-1.5',
        'p-1.5',
        'px-2.5',
        'py-2.5',
        'pt-1.5',
        'pb-3.5',
        'pl-1.5',
        'pr-1.5',
        'm-1.5',
        'mx-2.5',
        'my-1.5',
        'mt-1.5',
        'mb-3.5',
        'ml-0.5',
        'mr-2.5',
      ];
      for (const cls of fifteenPrefixes) {
        const result = scanFileViolations(`<div className="${cls}" />`);
        expect(result.halfGap, `Expected ${cls} to be caught by guard`).toContain(cls);
      }
    });
  });

  describe('绿②: 甲案判定——p*-0.5 为唯一放行档，且 DESIGN.md 间距表包含微内衬 2px 并写明理由', () => {
    it('asserts p*-0.5 is the only exempted half-step spacing tier', () => {
      const allowed = scanFileViolations('<div className="py-0.5 px-0.5 p-0.5 pt-0.5 pb-0.5 pl-0.5 pr-0.5" />');
      expect(allowed.halfGap).toEqual([]);

      const disallowed = scanFileViolations('<div className="m-0.5 mt-0.5 mb-0.5 ml-0.5 mr-0.5 mx-0.5 my-0.5 gap-0.5" />');
      expect(disallowed.halfGap).toContain('m-0.5');
      expect(disallowed.halfGap).toContain('mt-0.5');
      expect(disallowed.halfGap).toContain('mb-0.5');
      expect(disallowed.halfGap).toContain('ml-0.5');
      expect(disallowed.halfGap).toContain('mr-0.5');
      expect(disallowed.halfGap).toContain('mx-0.5');
      expect(disallowed.halfGap).toContain('my-0.5');
      expect(disallowed.halfGap).toContain('gap-0.5');
    });

    it('asserts DESIGN.md spacing table documents micro / 微内衬 2px with rationale', () => {
      const designMdPath = path.resolve(REPO_ROOT, 'DESIGN.md');
      const content = fs.readFileSync(designMdPath, 'utf8');
      expect(content).toMatch(/micro:\s*\n\s*value:\s*2px/);
      expect(content).toMatch(/微内衬 2px/);
      expect(content).toMatch(/徽章.*药丸.*上下.*内衬|微标.*内衬/);
    });
  });

  describe('绿④: 全渲染层 p*-2.5 与全部外边距半档为 0（逐类断言）', () => {
    it('asserts each p*-2.5 and all outer margin half-step classes have zero occurrences across renderer', () => {
      const allFiles = walkRendererFiles(RENDERER_ROOT).filter(
        f => !path.relative(RENDERER_ROOT, f).startsWith('styles/')
      );

      const halfStepClassesToBan = [
        // p*-2.5 classes
        'p-2.5',
        'px-2.5',
        'py-2.5',
        'pt-2.5',
        'pb-2.5',
        'pl-2.5',
        'pr-2.5',
        // All outer margin half-step classes
        'm-0.5', 'm-1.5', 'm-2.5', 'm-3.5',
        'mt-0.5', 'mt-1.5', 'mt-2.5', 'mt-3.5',
        'mb-0.5', 'mb-1.5', 'mb-2.5', 'mb-3.5',
        'ml-0.5', 'ml-1.5', 'ml-2.5', 'ml-3.5',
        'mr-0.5', 'mr-1.5', 'mr-2.5', 'mr-3.5',
        'mx-0.5', 'mx-1.5', 'mx-2.5', 'mx-3.5',
        'my-0.5', 'my-1.5', 'my-2.5', 'my-3.5',
      ];

      for (const cls of halfStepClassesToBan) {
        const regex = new RegExp(`(?<![a-zA-Z0-9_\\-])${cls.replace('.', '\\.')}(?![a-zA-Z0-9_\\-])`, 'g');
        const matchingFiles: string[] = [];
        allFiles.forEach(f => {
          const content = fs.readFileSync(f, 'utf8');
          if (regex.test(content)) {
            matchingFiles.push(path.relative(RENDERER_ROOT, f));
          }
        });
        expect(
          matchingFiles,
          `Found half-step class ${cls} in: ${matchingFiles.join(', ')}`
        ).toEqual([]);
      }
    });
  });

  describe('绿⑤: 守门测试文件与基线产出脚本的正则逐字相同（比对两处字符串）', () => {
    it('asserts guard test regex and baseline script regex are identical word-for-word', () => {
      const guardContent = fs.readFileSync(__filename, 'utf8');
      const baselineScriptPath = path.resolve(REPO_ROOT, 'packages/electron/scripts/generate-visual-tokens-baseline.js');
      const baselineContent = fs.readFileSync(baselineScriptPath, 'utf8');

      const guardMatch = guardContent.match(/const halfSpacingRegex = (\/.+?\/[a-z]*);/);
      const baselineMatch = baselineContent.match(/const halfSpacingRegex = (\/.+?\/[a-z]*);/);

      expect(guardMatch, 'guard test must define halfSpacingRegex').not.toBeNull();
      expect(baselineMatch, 'baseline script must define halfSpacingRegex').not.toBeNull();
      expect(guardMatch![1]).toBe(baselineMatch![1]);
    });
  });

  describe('绿⑥: 基线文件由脚本重新产出，且全产品圆角与半档间距基线均为 0', () => {
    it('asserts nonStdRounded and halfGap are 0 across all directories in visualTokensBaseline.json', () => {
      expect(fs.existsSync(BASELINE_PATH), `Baseline JSON must exist at ${BASELINE_PATH}`).toBe(true);
      const baselineData = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Record<
        string,
        { pxFonts: number; rawColors: number; nonStdRounded: number; halfGap: number; fileCount: number }
      >;

      let totalRounded = 0;
      let totalGaps = 0;
      for (const [group, data] of Object.entries(baselineData)) {
        totalRounded += data.nonStdRounded;
        totalGaps += data.halfGap;
        expect(data.nonStdRounded, `Directory [${group}] nonStdRounded must be 0`).toBe(0);
        expect(data.halfGap, `Directory [${group}] halfGap must be 0`).toBe(0);
      }
      expect(totalRounded).toBe(0);
      expect(totalGaps).toBe(0);
    });
  });

  describe('绿⑦: DESIGN.md 十条反例逐条核过且当前全部成立', () => {
    const designMdPath = path.resolve(REPO_ROOT, 'DESIGN.md');

    it('verifies all 10 counter-examples in DESIGN.md reference real, existing violations', () => {
      const content = fs.readFileSync(designMdPath, 'utf8');
      const counterExampleLines: [string, RegExp][] = [
        ['SessionDropdown.tsx', /packages\/electron\/src\/renderer\/components\/AIChat\/SessionDropdown\.tsx:111/],
        ['PageHeader.tsx:60', /packages\/electron\/src\/renderer\/components\/common\/PageHeader\.tsx:60/],
        ['TaskListPanel.tsx', /packages\/electron\/src\/renderer\/components\/AgentMode\/TaskListPanel\.tsx:118/],
        ['ColorPicker.tsx', /packages\/runtime\/src\/editor\/ui\/ColorPicker\.tsx:152/],
        ['RequestUserInputWidget.tsx', /packages\/runtime\/src\/ui\/AgentTranscript\/components\/CustomToolWidgets\/RequestUserInputWidget\.tsx:631/],
        ['WakeupBanner.tsx', /packages\/electron\/src\/renderer\/components\/AIChat\/WakeupBanner\.tsx:106/],
        ['ClaudeCodePluginsPanel.tsx', /packages\/electron\/src\/renderer\/components\/GlobalSettings\/panels\/ClaudeCodePluginsPanel\.tsx/],
        ['WindowsClaudeCodeWarning.tsx', /packages\/electron\/src\/renderer\/components\/WindowsClaudeCodeWarning\/WindowsClaudeCodeWarning\.tsx:88/],
        ['DeveloperDashboard.tsx', /packages\/electron\/src\/renderer\/components\/DeveloperDashboard\/DeveloperDashboard\.tsx:217/],
        ['PageHeader.tsx:75', /packages\/electron\/src\/renderer\/components\/common\/PageHeader\.tsx:75/],
      ];

      for (const [name, regex] of counterExampleLines) {
        expect(content, `DESIGN.md must cite counter-example for ${name}`).toMatch(regex);
      }

      // Check that the referenced runtime files actually contain the violations
      const colorPickerContent = fs.readFileSync(path.resolve(REPO_ROOT, 'packages/runtime/src/editor/ui/ColorPicker.tsx'), 'utf8');
      expect(colorPickerContent).toContain('rounded-xl');

      const userInputWidgetContent = fs.readFileSync(path.resolve(REPO_ROOT, 'packages/runtime/src/ui/AgentTranscript/components/CustomToolWidgets/RequestUserInputWidget.tsx'), 'utf8');
      expect(userInputWidgetContent).toContain('gap-2.5');
    });
  });

  describe('防倒退检查（已迁移名单零违规 + 其余目录欠账天花板）', () => {
    describe('段 1: 已迁移名单零违规（硬字号、硬颜色、表外圆角、半档间距全部为 0）', () => {
      for (const relativePath of TARGET_FILES) {
        it(`enforces 100% token purity on ${relativePath}`, () => {
          const fullPath = path.resolve(RENDERER_ROOT, relativePath);
          expect(fs.existsSync(fullPath), `Target file exists: ${relativePath}`).toBe(true);

          const content = fs.readFileSync(fullPath, 'utf-8');
          const violations = scanFileViolations(content);

          expect(
            violations.pxFonts,
            `Hardcoded pixel font size found in ${relativePath}: ${violations.pxFonts.join(', ')}`
          ).toEqual([]);

          expect(
            violations.rawColors,
            `Raw color found in ${relativePath}: ${violations.rawColors.join(', ')}`
          ).toEqual([]);

          expect(
            violations.nonStdRounded,
            `Table-violating rounded corner found in ${relativePath}: ${violations.nonStdRounded.join(', ')}`
          ).toEqual([]);

          expect(
            violations.halfGap,
            `Half-step gap found in ${relativePath}: ${violations.halfGap.join(', ')}`
          ).toEqual([]);
        });
      }
    });

    describe('段 2: 其余目录欠账天花板（实际数不得高于脚本实测基线）', () => {
      it('asserts actual violations in all renderer directories do not exceed baseline', () => {
        expect(fs.existsSync(BASELINE_PATH), `Baseline JSON must exist at ${BASELINE_PATH}`).toBe(true);
        const baselineData = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Record<
          string,
          { pxFonts: number; rawColors: number; nonStdRounded: number; halfGap: number; fileCount: number }
        >;

        const allFiles = walkRendererFiles(RENDERER_ROOT);
        const actualByDir: Record<
          string,
          { pxFonts: number; rawColors: number; nonStdRounded: number; halfGap: number }
        > = {};

        allFiles.forEach(f => {
          const rel = path.relative(RENDERER_ROOT, f);
          if (TARGET_FILES.includes(rel)) return;

          let group = 'other';
          const parts = rel.split(path.sep);
          if (parts[0] === 'components' && parts.length > 1) {
            group = parts.length === 2 && !fs.statSync(f).isDirectory() ? 'components/_root' : 'components/' + parts[1];
          } else {
            group = parts.length === 1 ? '_root' : parts[0];
          }

          if (!actualByDir[group]) {
            actualByDir[group] = { pxFonts: 0, rawColors: 0, nonStdRounded: 0, halfGap: 0 };
          }
          const content = fs.readFileSync(f, 'utf8');
          const isExempt = rel.startsWith('components/common/') || rel.startsWith('styles/');
          const res = scanFileViolations(content, isExempt);
          actualByDir[group].pxFonts += res.pxFonts.length;
          actualByDir[group].rawColors += res.rawColors.length;
          actualByDir[group].nonStdRounded += res.nonStdRounded.length;
          actualByDir[group].halfGap += res.halfGap.length;
        });

        for (const [group, actual] of Object.entries(actualByDir)) {
          const base = baselineData[group] ?? { pxFonts: 0, rawColors: 0, nonStdRounded: 0, halfGap: 0 };

          expect(
            actual.pxFonts,
            `Directory [${group}] pxFonts (${actual.pxFonts}) exceeded baseline ceiling (${base.pxFonts})`
          ).toBeLessThanOrEqual(base.pxFonts);

          expect(
            actual.rawColors,
            `Directory [${group}] rawColors (${actual.rawColors}) exceeded baseline ceiling (${base.rawColors})`
          ).toBeLessThanOrEqual(base.rawColors);

          expect(
            actual.nonStdRounded,
            `Directory [${group}] nonStdRounded (${actual.nonStdRounded}) exceeded baseline ceiling (${base.nonStdRounded})`
          ).toBeLessThanOrEqual(base.nonStdRounded);

          expect(
            actual.halfGap,
            `Directory [${group}] halfGap (${actual.halfGap}) exceeded baseline ceiling (${base.halfGap})`
          ).toBeLessThanOrEqual(base.halfGap);
        }
      });
    });
  });
});

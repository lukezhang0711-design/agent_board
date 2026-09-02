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
];

const RENDERER_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(RENDERER_ROOT, '../../../../');
const BASELINE_PATH = path.resolve(__dirname, '../visualTokensBaseline.json');

export function scanFileViolations(content: string) {
  const pxFontRegex = /text-\[\d+(?:\.\d+)?px\]/g;
  const pxSpacingRegex = /(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[\d+(?:\.\d+)?px\]/g;
  const rawColorRegex = /(?:bg|text|border|ring)-\[#(?:[0-9a-fA-F]+)\]|(?:bg|text|border|ring)-\[rgb[a]?\([^)]+\)\]/g;
  const inlineFontSizeRegex = /fontSize:\s*['"]?\d+(?:\.\d+)?(?:px)?['"]?/g;
  const nonStdRoundedRegex = /\brounded-(?:xl|2xl|\[10px\]|\[18px\]|\[20px\])\b/g;
  const halfGapRegex = /\bgap(?:-[xy])?-(?:0\.5|1\.5|2\.5)\b/g;

  return {
    pxFonts: [...(content.match(pxFontRegex) ?? []), ...(content.match(inlineFontSizeRegex) ?? [])],
    pxSpacings: content.match(pxSpacingRegex) ?? [],
    rawColors: content.match(rawColorRegex) ?? [],
    inlineFontSizes: content.match(inlineFontSizeRegex) ?? [],
    nonStdRounded: content.match(nonStdRoundedRegex) ?? [],
    halfGap: content.match(halfGapRegex) ?? [],
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

  describe('绿③: 圆角令牌表只剩 3 个正式档 + 2 个标注过渡的档；全渲染层零表外圆角', () => {
    it('has 3 formal tiers and 2 transitional tiers in visualTokens.radius', () => {
      const radiusTiers = Object.keys(visualTokens.radius);
      expect(radiusTiers).toEqual(['none', 'sm', 'base', 'lg', 'full']);
      expect(visualTokens.radius.base.status).toBe('formal');
      expect(visualTokens.radius.lg.status).toBe('formal');
      expect(visualTokens.radius.full.status).toBe('formal');
      expect(visualTokens.radius.none.status).toBe('transitional');
      expect(visualTokens.radius.sm.status).toBe('transitional');
    });

    it('has zero rounded-xl, rounded-2xl, rounded-[10px], rounded-[18px], rounded-[20px] across entire renderer', () => {
      const allFiles = walkRendererFiles(RENDERER_ROOT);
      const forbiddenRounded = [
        'rounded-xl',
        'rounded-2xl',
        'rounded-[10px]',
        'rounded-[18px]',
        'rounded-[20px]',
      ];

      for (const pattern of forbiddenRounded) {
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
    });
  });

  describe('绿④: 全渲染层不再出现 gap-0.5 / gap-1.5 / gap-2.5', () => {
    it('has zero gap-0.5, gap-1.5, gap-2.5 across entire renderer', () => {
      const allFiles = walkRendererFiles(RENDERER_ROOT);
      const forbiddenGaps = ['gap-0.5', 'gap-1.5', 'gap-2.5'];

      for (const pattern of forbiddenGaps) {
        const matchingFiles: string[] = [];
        allFiles.forEach(f => {
          const content = fs.readFileSync(f, 'utf8');
          if (content.includes(pattern)) {
            matchingFiles.push(path.relative(RENDERER_ROOT, f));
          }
        });
        expect(
          matchingFiles,
          `Found half-step gap class ${pattern} in: ${matchingFiles.join(', ')}`
        ).toEqual([]);
      }
    });
  });

  describe('绿⑤: 防倒退检查（已迁移名单零违规 + 其余目录欠账天花板）', () => {
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
          const res = scanFileViolations(content);
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

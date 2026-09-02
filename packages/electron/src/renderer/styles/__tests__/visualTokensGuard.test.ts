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
];

const RENDERER_ROOT = path.resolve(__dirname, '../..');

export function scanFileViolations(content: string) {
  const pxFontRegex = /text-\[\d+(?:\.\d+)?px\]/g;
  const pxSpacingRegex = /(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-\[\d+(?:\.\d+)?px\]/g;
  const rawColorRegex = /(?:bg|text|border|ring)-\[#(?:[0-9a-fA-F]+)\]|(?:bg|text|border|ring)-\[rgb[a]?\([^)]+\)\]/g;
  const inlineFontSizeRegex = /fontSize:\s*['"]?\d+(?:\.\d+)?(?:px)?['"]?/g;

  return {
    pxFonts: content.match(pxFontRegex) ?? [],
    pxSpacings: content.match(pxSpacingRegex) ?? [],
    rawColors: content.match(rawColorRegex) ?? [],
    inlineFontSizes: content.match(inlineFontSizeRegex) ?? [],
  };
}

describe('Visual Token Guard & Single Truth Table (施工单 FX)', () => {
  describe('绿①: 令牌表单一文件定义且档数不超上限', () => {
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

    it('has no more than 5 radius tiers (actual: 5 tiers)', () => {
      const radiusTiers = Object.keys(visualTokens.radius);
      expect(radiusTiers.length).toBeLessThanOrEqual(5);
      expect(radiusTiers).toEqual(['none', 'sm', 'base', 'lg', 'full']);
    });

    it('has no more than 4 surface layers (actual: 4 layers)', () => {
      const surfaceTiers = Object.keys(visualTokens.surfaceLayer);
      expect(surfaceTiers.length).toBeLessThanOrEqual(4);
      expect(surfaceTiers).toEqual(['canvas', 'container', 'interactive', 'accent']);
    });
  });

  describe('绿③: 深浅双主题底色分层100%基于 --nim-* 变量', () => {
    it('binds all surface layers strictly to --nim-* theme variables', () => {
      for (const [key, layer] of Object.entries(visualTokens.surfaceLayer)) {
        expect(layer.value, `Layer ${key} must reference var(--nim-*)`).toMatch(/^var\(--nim-/);
      }
    });
  });

  describe('绿④: 防复发闸对违规精准拦截验证', () => {
    it('catches synthetic hardcoded pixel font, spacing, raw colors, and inline font sizes', () => {
      const mockViolationCode = `
        <div className="text-[13px] p-[7px] bg-[#e74c3c] border-[rgba(96,165,250,0.5)]" style={{ fontSize: '16px' }}>
          Violation test
        </div>
      `;
      const result = scanFileViolations(mockViolationCode);
      expect(result.pxFonts).toContain('text-[13px]');
      expect(result.pxSpacings).toContain('p-[7px]');
      expect(result.rawColors).toContain('bg-[#e74c3c]');
      expect(result.rawColors).toContain('border-[rgba(96,165,250,0.5)]');
      expect(result.inlineFontSizes).toContain("fontSize: '16px'");
    });
  });

  describe('绿②: 高频五屏零写死像素与零非主题颜色（守门断言）', () => {
    for (const relativePath of TARGET_FILES) {
      it(`enforces visual token purity on ${relativePath}`, () => {
        const fullPath = path.resolve(RENDERER_ROOT, relativePath);
        expect(fs.existsSync(fullPath), `Target file exists: ${relativePath}`).toBe(true);

        const content = fs.readFileSync(fullPath, 'utf-8');
        const violations = scanFileViolations(content);

        expect(
          violations.pxFonts,
          `Found hardcoded pixel font size in ${relativePath}: ${violations.pxFonts.join(', ')}`
        ).toEqual([]);

        expect(
          violations.pxSpacings,
          `Found hardcoded pixel spacing in ${relativePath}: ${violations.pxSpacings.join(', ')}`
        ).toEqual([]);

        expect(
          violations.rawColors,
          `Found raw non-theme color in ${relativePath}: ${violations.rawColors.join(', ')}`
        ).toEqual([]);

        expect(
          violations.inlineFontSizes,
          `Found inline hardcoded fontSize in ${relativePath}: ${violations.inlineFontSizes.join(', ')}`
        ).toEqual([]);
      });
    }
  });
});

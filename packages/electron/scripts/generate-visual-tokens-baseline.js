const fs = require('fs');
const path = require('path');

const RENDERER_ROOT = path.resolve(__dirname, '../src/renderer');
const OUTPUT_FILE = path.resolve(__dirname, '../src/renderer/styles/visualTokensBaseline.json');

const TARGET_FILES = new Set([
  'components/UnifiedAI/PlanApprovalWidget.tsx',
  'components/Settings/SkillLibraryPanel.tsx',
  'components/Settings/ChannelHealthPanel.tsx',
  'components/TrackerMode/SessionKanbanBoard.tsx',
  'components/UsageIndicator/AIUsageIndicator.tsx',
  'components/UsageIndicator/AIUsagePopover.tsx',
  'components/UsageIndicator/UsagePoolList.tsx',
]);

function walk(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        if (!file.includes('__tests__') && file !== 'node_modules') {
          results = results.concat(walk(fullPath));
        }
      } else if (/\.(tsx|ts|jsx|js)$/.test(file) && !file.includes('.test.') && !file.includes('.spec.')) {
        results.push(fullPath);
      }
    });
  } catch (e) {}
  return results;
}

const ALLOWED_ROUNDED = /^rounded-ui-(?:base|lg|full|none)(?:-[tblr])?$/;

function scanFile(content, isExempt = false) {
  const pxFontRegex = /text-\[\d+(?:\.\d+)?px\]/g;
  const inlineFontSizeRegex = /fontSize:\s*['"]?\d+(?:\.\d+)?(?:px)?['"]?/g;
  const rawColorRegex = /(?:bg|text|border|ring)-\[#(?:[0-9a-fA-F]+)\]|(?:bg|text|border|ring)-\[rgb[a]?\([^)]+\)\]/g;

  let nonStdRoundedCount = 0;
  let halfGapCount = 0;

  if (!isExempt) {
    const rawRoundeds = content.match(/(?<![a-zA-Z0-9_\-])rounded[^\s"'`>]+/g) || [];
    nonStdRoundedCount = rawRoundeds.filter(cls => !ALLOWED_ROUNDED.test(cls)).length;

    // 施工单 GH (甲案): 放行 p*-0.5 (微内衬 2px，用于徽章/药丸/小标签上下内衬)，其余 15 类间距/外边距/内边距前缀的任意 .5 档一律违例
    const halfSpacingRegex = /(?<![a-zA-Z0-9_\-])(?:gap(?:-[xy])?-\d*\.5|m[xytblr]?-\d*\.5|p[xytblr]?-(?!0\.5\b)\d*\.5)(?![a-zA-Z0-9_\-])/g;
    halfGapCount = (content.match(halfSpacingRegex) || []).length;
  }

  return {
    pxFonts: (content.match(pxFontRegex) || []).length + (content.match(inlineFontSizeRegex) || []).length,
    rawColors: (content.match(rawColorRegex) || []).length,
    nonStdRounded: nonStdRoundedCount,
    halfGap: halfGapCount,
  };
}

function generateBaseline() {
  const files = walk(RENDERER_ROOT);
  const baseline = {};

  files.forEach(f => {
    const rel = path.relative(RENDERER_ROOT, f);
    if (TARGET_FILES.has(rel)) return;

    let group = 'other';
    const parts = rel.split(path.sep);
    if (parts[0] === 'components' && parts.length > 1) {
      group = parts.length === 2 && !fs.statSync(f).isDirectory() ? 'components/_root' : 'components/' + parts[1];
    } else {
      group = parts.length === 1 ? '_root' : parts[0];
    }

    if (!baseline[group]) {
      baseline[group] = {
        pxFonts: 0,
        rawColors: 0,
        nonStdRounded: 0,
        halfGap: 0,
        fileCount: 0,
      };
    }

    const content = fs.readFileSync(f, 'utf8');
    const isExempt = rel.startsWith('components/common/') || rel.startsWith('styles/');
    const res = scanFile(content, isExempt);
    baseline[group].pxFonts += res.pxFonts;
    baseline[group].rawColors += res.rawColors;
    baseline[group].nonStdRounded += res.nonStdRounded;
    baseline[group].halfGap += res.halfGap;
    baseline[group].fileCount++;
  });

  // Sort keys alphabetically
  const sortedBaseline = {};
  Object.keys(baseline).sort().forEach(k => {
    sortedBaseline[k] = baseline[k];
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sortedBaseline, null, 2) + '\n', 'utf8');
  console.log(`Baseline successfully written to ${OUTPUT_FILE}`);
  console.log('\n=== Baseline Summary by Directory ===');
  console.log('| 目录 | 硬字号 (pxFonts) | 硬颜色 (rawColors) | 表外圆角 (nonStdRounded) | 半档间距 (halfGap) | 文件数 |');
  console.log('|---|---|---|---|---|---|');
  let totalFonts = 0, totalColors = 0, totalRounded = 0, totalGaps = 0, totalFiles = 0;
  for (const [k, v] of Object.entries(sortedBaseline)) {
    if (v.pxFonts > 0 || v.rawColors > 0 || v.nonStdRounded > 0 || v.halfGap > 0) {
      console.log(`| ${k} | ${v.pxFonts} | ${v.rawColors} | ${v.nonStdRounded} | ${v.halfGap} | ${v.fileCount} |`);
    }
    totalFonts += v.pxFonts;
    totalColors += v.rawColors;
    totalRounded += v.nonStdRounded;
    totalGaps += v.halfGap;
    totalFiles += v.fileCount;
  }
  console.log(`| **总计** | **${totalFonts}** | **${totalColors}** | **${totalRounded}** | **${totalGaps}** | **${totalFiles}** |`);
}

generateBaseline();

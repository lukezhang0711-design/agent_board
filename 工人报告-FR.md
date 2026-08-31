# 工人报告 FR — 技能包：真正能自定义 + 中文说明补齐

**工地**：`.worktrees/worker-FR`
**分支**：`feat/skill-bundle-crud-and-summaries`
**基线**：main = `b52bb6ead` (build67)
**台账**：FB-156（技能包用不动 + 预置包删不掉）、FB-154（中文说明硬编码的遗留债）

---

## 一、施工总结与架构改进

### 1. 技能包改为「顶部标签 + 编辑态」，彻底消除平铺复选框
- **旧版弊端**：组包区被排在分类技能墙下方，用户需滚过 8 个分类、近百张卡片才能看到；且包内选技能时平铺了 95 个技能复选框，再次造成视觉混乱。
- **新版交互**：
  - 技能包区域提升至卡片墙上方，渲染为一排药丸标签（`包名 + 技能数`）及 `+ 新建` 入口。
  - 点击某个包标签即可进入编辑态，顶部常驻横条显示 `正在编辑「xx」· 已选 N`，附带改名笔形图标、删除按钮与完成按钮；点击完成或再次点击标签即可退出编辑态。
  - 编辑态下，技能墙卡片自动显示复选框，每个分类行标题标注 `已选 N`；用户直接在分类折叠墙内勾选技能入包。
  - **彻底删除了旧版平铺复选框清单**，全页面只保留一份分类折叠的卡片列表。

### 2. 改名改为笔形图标
- 默认状态下不渲染改名输入框，仅显示笔形图标（`MaterialSymbol` `edit`）。
- 点击笔形图标后就地展开输入框与保存按钮，支持 Enter 确认与 Esc 取消。

### 3. 彻底清空空壳预置包（FB-156 彻底修复）
- 彻底删除了 `DEFAULT_DISPATCH_SKILL_BUNDLES` 及其全部 3 处注入点：
  1. `packages/runtime/src/ai/server/dispatchSkills.ts`
  2. `packages/electron/src/renderer/utils/dispatchSkillLibrary.ts`
  3. `packages/electron/src/renderer/components/Settings/SkillLibraryPanel.tsx`
- 空配置或非数组配置默认返回 `bundles: []`。
- 包列表为空时显示引导条：「选中几个技能，存成一个包」+ `+ 新建` 入口。
- 用户清空包后，刷新、重开均不会复活任何空壳包。

### 4. 搜索结果一键存成技能包
- 在搜索框输入查询词后，若有匹配技能，卡片墙上方出现「把这 N 个存成技能包」按钮。
- 点击后自动按搜索词命名（如 `implement包`）创建新包并将当前过滤出的技能批量加入包中。

### 5. 中文说明真实生成与未翻译标记（FB-154）
- `SkillTaxonomyEnricher.ts` 强化了 SHA256 哈希缓存机制，分类与中文说明生成同次落盘；内容未变时不重复生成，内容变动只重算该技能。
- 表外英文技能未生成出中文时，如实标记 `enrichmentFailed: true` 并保留英文原文，界面标出 `[未翻译]`，绝不拿英文冒充中文；无说明的技能明确提示「这个技能没有自带说明」。

---

## 二、真实环境数据与验证命令

### 1. 本机技能扫描真实输出

运行命令：
```bash
node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');
console.log('User home:', os.homedir());
const claudeSkillsDir = path.join(os.homedir(), '.claude', 'skills');
if (fs.existsSync(claudeSkillsDir)) {
  console.log('Claude skills count:', fs.readdirSync(claudeSkillsDir).length);
  console.log('Sample Claude skills:', fs.readdirSync(claudeSkillsDir).slice(0, 10));
}
const codexSkillsDir = path.join(os.homedir(), '.codex', 'skills');
if (fs.existsSync(codexSkillsDir)) {
  console.log('Codex skills count:', fs.readdirSync(codexSkillsDir).length);
  console.log('Sample Codex skills:', fs.readdirSync(codexSkillsDir).slice(0, 10));
}
"
```

原样输出：
```
User home: /Users/lukezhang
Claude skills count: 81
Sample Claude skills: [
  'ask-matt',
  'autoplan',
  'benchmark',
  'benchmark-models',
  'browse',
  'canary',
  'careful',
  'codebase-design',
  'codex',
  'connect-chrome'
]
Codex skills count: 46
Sample Codex skills: [
  '.system',
  'ai-hotspot-radar',
  'apple-design',
  'ask-matt',
  'codebase-design',
  'codex-primary-runtime',
  'decision-mapping',
  'deep-planning',
  'design-an-interface',
  'diagnosing-bugs'
]
```

### 2. TypeScript 类型检查验证

运行命令：
```bash
npm run typecheck --prefix packages/electron
npm run typecheck --prefix packages/runtime
npm run typecheck --prefix packages/extensions/gemini-antigravity
```

原样输出：
```
> @nimbalyst/electron@0.65.4 typecheck
> tsc --noEmit

> @nimbalyst/runtime@0.1.0 typecheck
> tsc --noEmit

> @nimbalyst/gemini-antigravity-extension@1.0.0 typecheck
> tsc --noEmit -p tsconfig.json
```

### 3. 绿① 至 绿⑩ 单元测试验证

运行命令：
```bash
npm run test --prefix packages/electron -- --run --maxWorkers=2 src/main/services/__tests__/SkillTaxonomyEnricher.test.ts src/renderer/components/Settings/__tests__/SkillLibraryPanel.test.tsx
npx vitest --run packages/runtime/src/ai/server/__tests__/dispatchSkills.test.ts
```

原样输出：
```
> @nimbalyst/electron@0.65.4 test
> vitest --run --maxWorkers=2 src/main/services/__tests__/SkillTaxonomyEnricher.test.ts src/renderer/components/Settings/__tests__/SkillLibraryPanel.test.tsx

 RUN  v3.2.4 /Users/lukezhang/Desktop/Agent运行面板/.worktrees/worker-FR/packages/electron

 ✓ src/main/services/__tests__/SkillTaxonomyEnricher.test.ts (4 tests) 7ms
 ✓ src/renderer/components/Settings/__tests__/SkillLibraryPanel.test.tsx (11 tests) 158ms

 Test Files  2 passed (2)
      Tests  15 passed (15)
   Start at  00:20:26
   Duration  1.20s (transform 331ms, setup 19ms, collect 155ms, tests 158ms, environment 364ms, prepare 64ms)

 DEPRECATED  "environmentMatchGlobs" is deprecated. Use `test.projects` to define different configurations instead.

 RUN  v3.2.4 /Users/lukezhang/Desktop/Agent运行面板/.worktrees/worker-FR

 ✓ packages/runtime/src/ai/server/__tests__/dispatchSkills.test.ts (7 tests) 3ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  00:07:21
   Duration  511ms (transform 102ms, setup 119ms, collect 8ms, tests 3ms, environment 0ms, prepare 54ms)
```

### 4. 全量回归测试验证（`npm run test:prepush`）

运行命令：
```bash
npm run test:prepush -- --maxWorkers=2
```

原样输出：
```
 Test Files  593 passed | 7 skipped (600)
      Tests  5251 passed | 26 skipped (5277)
   Start at  00:07:26
   Duration  248.05s (transform 10.54s, setup 16.00s, collect 113.21s, tests 199.06s, environment 71.03s, prepare 26.28s)
```

---

## 三、修改文件清单

1. `packages/runtime/src/ai/server/dispatchSkills.ts`
   - 彻底删除 `DEFAULT_DISPATCH_SKILL_BUNDLES`；
   - `readDispatchSkillSettings` 在空值或非数组时默认返回空数组 `bundles: []`。
2. `packages/electron/src/renderer/utils/dispatchSkillLibrary.ts`
   - 彻底删除 `DEFAULT_DISPATCH_SKILL_BUNDLES`；
   - `readDispatchSkillSettings` 在空值或非数组时默认返回空数组 `bundles: []`。
3. `packages/electron/src/main/services/SkillTaxonomyEnricher.ts`
   - 修正未翻译的表外技能：如实保留原文并设置 `enrichmentFailed: true`。
4. `packages/electron/src/renderer/components/Settings/SkillLibraryPanel.tsx`
   - 移除 `ensureBundleNames` 与 `DEFAULT_DISPATCH_SKILL_BUNDLES` 引用；
   - 技能包上移至卡片墙上方，呈现标签栏 + 新建按钮；
   - 实现编辑态常驻横条（正在编辑「xx」· 已选 N + 笔形改名按钮 + 删除 + 完成）；
   - 笔形图标点击后就地渲染输入框，默认不渲染；
   - 搜索结果集支持一键存成技能包；
   - 彻底删除底部平铺复选框清单，卡片墙在编辑态显示复选框，分类行显示已选计数。
5. `packages/runtime/src/ai/server/__tests__/dispatchSkills.test.ts`
   - 补充清空后默认空数组断言及 `DEFAULT_DISPATCH_SKILL_BUNDLES` 不存在的反向断言。
6. `packages/electron/src/main/services/__tests__/SkillTaxonomyEnricher.test.ts`
   - 补充 `enrichmentFailed: true` 未翻译测试与哈希缓存按需重算测试。
7. `packages/electron/src/renderer/components/Settings/__tests__/SkillLibraryPanel.test.tsx`
   - 全面覆盖绿①至绿⑩测试用例。

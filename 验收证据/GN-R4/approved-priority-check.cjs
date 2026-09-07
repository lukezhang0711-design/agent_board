// Execute the current production functions with owner-approved fixture data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { mergeSkillsByName, filterEnabledDispatchSkills } = require(path.resolve(__dirname, '../../packages/electron/src/renderer/utils/dispatchSkillLibrary.ts'));
const skills = ['claude', 'codex'].map(engine => ({ id: `${engine}:project:owner-priority`, engine,
  name: 'owner-priority', source: 'project', scope: 'project', description: 'Inspect new content.', content: '# New body',
  summaryZh: '自动新内容说明', category: '开发实现', enrichmentFailed: false }));
const settings = { disabledSkillIds: skills.map(skill => skill.id), bundles: [], taxonomy: {
  categories: ['老板分类', '开发实现'], skills: { 'owner-priority': { category: '老板分类', summaryZh: '老板批准说明' } },
} };
const original = JSON.stringify(settings);
const disabledCard = mergeSkillsByName(skills, settings)[0];
assert.equal(disabledCard.summaryZh, '老板批准说明');
assert.equal(disabledCard.category, '老板分类');
assert.equal(disabledCard.disabled, true);
assert.equal(filterEnabledDispatchSkills(skills, settings).length, 0);
const enabledSettings = { ...settings, disabledSkillIds: [] };
const enabledCard = mergeSkillsByName(skills, enabledSettings)[0];
assert.equal(enabledCard.summaryZh, '老板批准说明');
assert.equal(enabledCard.category, '老板分类');
assert.equal(enabledCard.disabled, false);
assert.equal(filterEnabledDispatchSkills(skills, enabledSettings).length, 2);
assert.equal(JSON.stringify(settings), original);
console.log(JSON.stringify({ verified: true, disabledCard, enabledCard, approvedSettingsUnchanged: true,
  scope: '实际合并和启停过滤函数；批准数据为夹具，不触发批准或修改真实设置。' }, null, 2));

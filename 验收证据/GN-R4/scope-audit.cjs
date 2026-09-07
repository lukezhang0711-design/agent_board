// Read-only audit against the fixed R3 parent and original main baseline.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const parent = '8a383887e8cdbe7fccd9073f0967a1e13e12922f';
const baseline = '28a1b7f3b963077a95faa0157fdbe2fa25ce159d';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const read = file => fs.readFileSync(file, 'utf8');
const old = (ref, file) => git('show', `${ref}:${file}`);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const root = path.resolve(__dirname, '../..');
process.chdir(root);
const proof = { parent, baseline, branch: git('branch', '--show-current').trim(), head: git('rev-parse', 'HEAD').trim() };
assert(proof.head === parent || git('rev-parse', 'HEAD^').trim() === parent);
assert.equal(proof.branch, 'fix/skill-summary-and-stop-dedup');
const allowed = [
  'renderer/components/MetaAgentMode/MetaAgentMode.tsx', 'renderer/components/Settings/SkillLibraryPanel.tsx',
  'renderer/utils/dispatchSkillLibrary.ts', 'main/ipc/SettingsHandlers.ts', 'main/services/SkillTaxonomyEnricher.ts',
  'main/services/__tests__/SkillTaxonomyEnricher.test.ts', 'main/services/__tests__/DispatchSkillLibraryService.test.ts',
  'main/ipc/__tests__/SettingsHandlers.skillSummaries.test.ts', 'renderer/components/Settings/__tests__/SkillLibraryPanel.test.tsx',
  'renderer/components/MetaAgentMode/__tests__/MetaAgentMode.GC.test.tsx',
  'renderer/components/MetaAgentMode/__tests__/MetaAgentMode.queuedSummary.test.tsx',
].map(file => `packages/electron/src/${file}`).concat([
  'packages/electron/e2e/ai/collab-chain.spec.ts', 'packages/electron/e2e/ai/fixtures/skill-summary-engine.cjs',
]);
const changes = git('diff', '--name-only', '-z', parent).split('\0').filter(Boolean);
assert(changes.every(file => allowed.includes(file) || file === '工人报告-GN-R4.md' || file.startsWith('验收证据/GN-R4/')));
proof.changedSourceFiles = changes.filter(file => file.startsWith('packages/'));
assert(proof.changedSourceFiles.every(file => allowed.includes(file)));
proof.forbiddenZeroDiff = {};
for (const file of ['main/services/DispatchSkillLibraryService.ts', 'renderer/components/UnifiedAI/SessionTranscript.tsx']) {
  const full = `packages/electron/src/${file}`;
  assert.equal(read(full), old(baseline, full));
  proof.forbiddenZeroDiff[full] = true;
}
const meta = 'packages/electron/src/renderer/components/MetaAgentMode/MetaAgentMode.tsx';
assert.equal(old(baseline, meta).replace(/showStopAndClearQueue=\{[^\n]+\}/, 'showStopAndClearQueue={false}'), read(meta));
proof.stopChangeIsOnlyVisibilityProp = true;
const handler = 'packages/electron/src/main/ipc/SettingsHandlers.ts';
function listHandler(text) {
  const start = text.indexOf("safeHandle('dispatch-skills:list'");
  return text.slice(start, text.indexOf('\n    });', start) + 8);
}
assert.equal(listHandler(read(handler)), listHandler(old(baseline, handler)));
assert(!read(handler).includes('dispatch-skills:get-cache-path'));
proof.listHandlerByteIdentical = true;
proof.productionCachePathIpcAbsent = true;
const collab = 'packages/electron/e2e/ai/collab-chain.spec.ts';
const before = old(parent, collab), after = read(collab);
const firstThree = text => text.slice(text.indexOf("test('creates a real meta-agent session"), text.indexOf("test('绿⑭:"));
assert.equal(firstThree(before), firstThree(after));
proof.originalThreeTests = { byteIdentical: true, sha256: sha(firstThree(after)) };
function assertions(text) {
  const source = ts.createSourceFile(collab, text, ts.ScriptTarget.Latest, true);
  const entries = [];
  function visit(node) {
    if (ts.isCallExpression(node) && !ts.isPropertyAccessExpression(node.parent) && /^expect(?:\(|\.poll\()/.test(node.getText(source))) {
      entries.push({ text: node.getText(source).replace(/\s+/g, ' '), page: node.pos >= text.indexOf("test('绿⑭:") && node.end < text.indexOf("test('绿⑮:") });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return entries;
}
const originals = assertions(before), current = assertions(after), unmatched = current.map(item => item.text);
const removed = originals.filter(item => { const i = unmatched.indexOf(item.text); if (i < 0) return true; unmatched.splice(i, 1); return false; });
assert.equal(originals.length, 127);
assert.equal(removed.length, 3);
assert(removed.every(item => item.page));
proof.assertions = { original: originals.length, current: current.length, removed, allOriginalNonPageAssertionsPreserved: true };
const chief = '/Users/lukezhang/Desktop/Agent运行面板/诊断报告/GN-R3验收-2026-09-07';
const expected = JSON.parse(read(path.join(__dirname, '00-输入与范围/历史探针SHA256.json')));
proof.originalProbeHashesUnchanged = {};
for (const [name, hash] of Object.entries(expected)) {
  const actual = sha(fs.readFileSync(path.join(chief, name)));
  assert.equal(actual, hash);
  proof.originalProbeHashesUnchanged[name] = actual;
}
git('diff', '--check');
proof.diffCheckPassed = true;
console.log(JSON.stringify(proof, null, 2));

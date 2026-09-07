import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
vi.mock('../../.worktrees/worker-GN/packages/electron/src/main/services/ai/claudeExecutableResolver', () => ({
  isClaudeExecutableInstalled: () => true,
  resolveClaudeExecutablePath: () => '/sentinel/real-engine-never-execute',
}));
import { SkillTaxonomyCacheManager, computeSkillHash } from '../../.worktrees/worker-GN/packages/electron/src/main/services/SkillTaxonomyEnricher';
const dirs: string[] = [];
function temp() { const d=fs.mkdtempSync(path.join(os.tmpdir(),'gn-r3-chief-')); dirs.push(d); return d; }
afterEach(() => { vi.unstubAllEnvs(); for(const d of dirs.splice(0)) fs.rmSync(d,{recursive:true,force:true}); });
it.each([
  ['missing', {type:'result',subtype:'success',result:'检查项目依赖'}],
  ['string true', {type:'result',subtype:'success',is_error:'true',result:'账户余额不足'}],
  ['number', {type:'result',subtype:'success',is_error:1,result:'检查项目依赖'}],
  ['null', {type:'result',subtype:'success',is_error:null,result:'检查项目依赖'}],
  ['error branch', {type:'result',subtype:'error_during_execution',is_error:true,result:'账户余额不足'}],
  ['non-string result', {type:'result',subtype:'success',is_error:false,result:{message:'检查项目依赖'}}],
  ['empty result', {type:'result',subtype:'success',is_error:false,result:' '}],
])('真实进程缺字段或字段类型错误必须保留原文：%s', async (label, payload) => {
  const d=temp(), executable=path.join(d,'engine.cjs'), calls=path.join(d,'calls.jsonl');
  const stdout=JSON.stringify(payload);
  fs.writeFileSync(executable,`#!/usr/bin/env node\nconst fs=require('fs');fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({pid:process.pid,args:process.argv.slice(2)})+'\\n');process.stdout.write(${JSON.stringify(stdout)});\n`);
  fs.chmodSync(executable,0o755);
  vi.stubEnv('NODE_ENV','test'); vi.stubEnv('NIMBALYST_TEST_SKILL_SUMMARY_ENGINE',executable);
  const manager=new SkillTaxonomyCacheManager(path.join(d,'cache.json'));
  const result=await manager.enrichAsync('chief-r3-unlisted','Inspect project dependencies.','# Body');
  const starts=fs.readFileSync(calls,'utf8').trim().split('\n').map(s=>JSON.parse(s));
  console.log('STRUCTURED_BOUNDARY',JSON.stringify({label,stdout,result,starts}));
  expect(starts).toHaveLength(1);
  expect(result.enrichmentFailed).toBe(true);
});
it('说明与正文包含冒号时，后台缓存必须分别生成，不能串用另一内容的成功摘要', async () => {
  const manager=new SkillTaxonomyCacheManager(path.join(temp(),'cache.json'));
  const name='chief-content-identity';
  const descA='Inspect dependencies:notes', bodyA='# body';
  const descB='Inspect dependencies', bodyB='notes:# body';
  const first=await manager.enrichAsync(name,descA,bodyA,undefined,async()=> '检查旧内容');
  const generatorB=vi.fn(async()=> '检查新内容');
  const second=await manager.enrichAsync(name,descB,bodyB,undefined,generatorB);
  console.log('BACKEND_CONTENT_IDENTITY',JSON.stringify({hashA:computeSkillHash(name,descA,bodyA),hashB:computeSkillHash(name,descB,bodyB),first,second,newContentCalls:generatorB.mock.calls.length}));
  expect(second.summaryZh).toBe('检查新内容');
  expect(generatorB).toHaveBeenCalledTimes(1);
});

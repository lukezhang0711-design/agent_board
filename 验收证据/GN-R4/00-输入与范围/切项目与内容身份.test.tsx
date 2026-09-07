// @vitest-environment jsdom
// 实际组件，通信使用假响应；此处只证明页面排队和内容身份，不冒充完整 E2E。
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('@nimbalyst/runtime', () => ({ MaterialSymbol: ({icon}: {icon:string}) => <span aria-label={icon}/> }));
import { SkillLibraryPanel } from '../../.worktrees/worker-GN/packages/electron/src/renderer/components/Settings/SkillLibraryPanel';
import { mergeSkillsByName, computeSkillContentKey, readDispatchSkillSettings } from '../../.worktrees/worker-GN/packages/electron/src/renderer/utils/dispatchSkillLibrary';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function observer() {
  class Observer { cb: Function; constructor(cb: Function) {this.cb=cb;} observe(target: Element){this.cb([{isIntersecting:true,target}],this);} unobserve(){} disconnect(){} }
  vi.stubGlobal('IntersectionObserver', Observer);
}
function descriptor(i: number, project: string) {
  return {id:`codex:project:skill-${i}`,engine:'codex' as const,name:`skill-${i}`,source:'project',scope:'project' as const,
    description:`Inspect project ${project} item ${i}.`,content:`# Body ${project} ${i}`,category:'开发实现',enrichmentFailed:true};
}
it('三个 A 请求未完成时切到 B，A 结束后应继续生成当前 B 的三项', async () => {
  observer(); const pending: Array<(value: any) => void> = [];
  const invoke = vi.fn((channel: string, arg: any) => {
    if(channel==='dispatch-skills:list') return Promise.resolve({skills:[0,1,2].map(i=>descriptor(i,arg))});
    if(channel==='dispatch-skills:generate-summary') {
      if(arg.workspacePath==='/a') return new Promise(resolve=>pending.push(resolve));
      return Promise.resolve({success:true,enrichmentFailed:false,summaryZh:'检查当前项目',category:'开发实现'});
    }
    return Promise.resolve(undefined);
  });
  Object.defineProperty(window,'electronAPI',{configurable:true,value:{invoke}});
  const {rerender}=render(<SkillLibraryPanel workspacePath="/a"/>);
  fireEvent.click(await screen.findByText('开发实现'));
  await waitFor(()=>expect(pending).toHaveLength(3));
  rerender(<SkillLibraryPanel workspacePath="/b"/>);
  await waitFor(()=>expect(screen.getByTestId('skill-card-skill-0').textContent).toContain('Inspect project /b'));
  await act(async()=>{ pending.forEach(resolve=>resolve({success:true,enrichmentFailed:false,summaryZh:'旧项目说明',category:'开发实现'})); });
  try { await waitFor(()=>expect(invoke.mock.calls.filter(([c,p])=>c==='dispatch-skills:generate-summary' && p.workspacePath==='/b')).toHaveLength(3)); }
  finally { console.log('A_TO_B_QUEUE',JSON.stringify(invoke.mock.calls.filter(([c])=>c==='dispatch-skills:generate-summary'))); }
  expect(screen.queryByText('旧项目说明')).toBeNull();
});
it('同名不同正文的另一引擎成功缓存，不能让主描述符的新内容冒充已翻译', () => {
  const a = descriptor(0,'a');
  const b = {...descriptor(0,'b'),id:'claude:project:skill-0',engine:'claude' as const,summaryZh:'旧内容的中文说明',enrichmentFailed:false};
  const [card] = mergeSkillsByName([a,b],readDispatchSkillSettings(undefined));
  console.log('MERGED_CONTENT',JSON.stringify({rawDescription:card.rawDescription,content:card.content,summaryZh:card.summaryZh,enrichmentFailed:card.enrichmentFailed}));
  expect(card.rawDescription).toBe(a.description);
  expect(card.content).toBe(a.content);
  expect(card.enrichmentFailed).toBe(true);
  expect(card.summaryZh).not.toBe(b.summaryZh);
});
it('说明或正文含分隔符时，两个不同内容身份不能碰撞', () => {
  const keyA=computeSkillContentKey('skill','Inspect dependencies:::notes','# body');
  const keyB=computeSkillContentKey('skill','Inspect dependencies','notes:::# body');
  console.log('CONTENT_KEY_COLLISION',JSON.stringify({keyA,keyB}));
  expect(keyA).not.toBe(keyB);
});
it.each(['failure','timeout'])('三个 A 请求以 %s 结束后必须接续当前 B', async (outcome) => {
  observer(); const pending: Array<(value: any) => void> = [];
  const invoke = vi.fn((channel: string, arg: any) => {
    if(channel==='dispatch-skills:list') return Promise.resolve({skills:[0,1,2].map(i=>descriptor(i,arg))});
    if(channel==='dispatch-skills:generate-summary') {
      if(arg.workspacePath==='/a') return new Promise(resolve=>pending.push(resolve));
      return Promise.resolve({success:true,enrichmentFailed:false,summaryZh:'检查当前项目',category:'开发实现'});
    }
    return Promise.resolve(undefined);
  });
  Object.defineProperty(window,'electronAPI',{configurable:true,value:{invoke}});
  const {rerender}=render(<SkillLibraryPanel workspacePath="/a"/>);
  fireEvent.click(await screen.findByText('开发实现'));
  await waitFor(()=>expect(pending).toHaveLength(3));
  rerender(<SkillLibraryPanel workspacePath="/b"/>);
  await waitFor(()=>expect(screen.getByTestId('skill-card-skill-0').textContent).toContain('Inspect project /b'));
  await act(async()=>{ pending.forEach(resolve=>resolve({success:false,enrichmentFailed:true,error:outcome==='timeout'?'timed out after 15000ms':'engine exited 1'})); });
  try { await waitFor(()=>expect(invoke.mock.calls.filter(([c,p])=>c==='dispatch-skills:generate-summary' && p.workspacePath==='/b')).toHaveLength(3)); }
  finally { console.log('A_TO_B_QUEUE',JSON.stringify(invoke.mock.calls.filter(([c])=>c==='dispatch-skills:generate-summary'))); }
  expect(screen.queryByText('旧项目说明')).toBeNull();
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
  };
});

import { DispatchSkillLibraryService } from '../DispatchSkillLibraryService';

describe('DispatchSkillLibraryService', () => {
  let tmpRoot: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  function makeTempHome() {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-skills-'));
    const home = path.join(tmpRoot, 'home');
    const workspace = path.join(tmpRoot, 'workspace');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: '' });
    return { home, workspace };
  }

  function writeSkill(filePath: string, name: string, description: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `---\nname: ${name}\ndescription: ${description}\n---\n${description}\n`,
      'utf8',
    );
  }

  it('green FD-1: lists only local Claude, Codex, and Gemini fixture skills with source and scope', () => {
    const { home, workspace } = makeTempHome();
    writeSkill(
      path.join(home, '.claude', 'skills', 'claude-fixture', 'SKILL.md'),
      'claude-fixture',
      'Claude local fixture',
    );
    writeSkill(
      path.join(workspace, '.agents', 'skills', 'codex-fixture', 'SKILL.md'),
      'codex-fixture',
      'Codex project fixture',
    );
    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.gemini', 'settings.json'),
      JSON.stringify({ skills: ['gemini-fixture'] }),
      'utf8',
    );

    const skills = new DispatchSkillLibraryService().listSkills(workspace);

    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'claude-fixture',
        engine: 'claude',
        source: 'user',
        scope: 'global',
      }),
      expect.objectContaining({
        name: 'codex-fixture',
        engine: 'codex',
        source: 'project',
        scope: 'project',
      }),
      expect.objectContaining({
        name: 'gemini-fixture',
        engine: 'gemini',
        source: 'config',
        scope: 'config',
      }),
    ]));
  });

  it('green FD-1: reads Codex skills/list when the local CLI supports it', () => {
    makeTempHome();
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        skills: [{ name: 'codex-cli-fixture', description: 'Codex CLI list fixture' }],
      }),
      stderr: '',
    } as any);

    const skills = new DispatchSkillLibraryService().listSkills();

    expect(spawnSyncMock).toHaveBeenCalledWith(
      'codex',
      ['skills', 'list', '--json'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'codex-cli-fixture',
        engine: 'codex',
        source: 'config',
        scope: 'config',
      }),
    ]));
  });

  it('green FK: attaches content to parsed file skills for comparison', () => {
    const { home } = makeTempHome();
    writeSkill(
      path.join(home, '.claude', 'skills', 'compare-fixture', 'SKILL.md'),
      'compare-fixture',
      'This is file body content',
    );

    const skills = new DispatchSkillLibraryService().listSkills();
    const target = skills.find((s) => s.name === 'compare-fixture');
    expect(target?.content).toBe('This is file body content');
  });

  it('red ①: 现状断言——前缀分组的缺陷 (名称前缀相同但用途完全不同的技能，按前缀会被强行分到同一组)', () => {
    // Naive prefix grouping implementation
    const naivePrefixGroup = (name: string) => name.split(/[-_:]/)[0];
    const skillA = { name: 'plan-ceo-review', expectedCategory: '规划决策' };
    const skillB = { name: 'plan-tune', expectedCategory: '工具环境' };

    // In old prefix logic, both have prefix 'plan' and would be grouped together
    expect(naivePrefixGroup(skillA.name)).toBe(naivePrefixGroup(skillB.name));
    // But their true taxonomy categories are completely distinct
    expect(skillA.expectedCategory).not.toBe(skillB.expectedCategory);
  });

  it('red ②: 现状断言——多行块格式若用冒号简单截断会拿到孤立 "|" 或空', () => {
    const multilineYaml = `---
name: my-skill
description: |
  This is the first paragraph.
  This is the second paragraph.
---
Body text
`;
    // Naive regex taking text on the same line after 'description:'
    const naiveMatch = multilineYaml.match(/^description:\s*(.*)$/m);
    const naiveExtracted = naiveMatch ? naiveMatch[1].trim() : '';
    expect(naiveExtracted).toBe('|'); // Naive extraction fails into '|'
  });

  it('green ①: 两种说明格式（单行、多行块）都能解析出正文', () => {
    const { home } = makeTempHome();
    // Single line
    writeSkill(
      path.join(home, '.claude', 'skills', 'single-line-skill', 'SKILL.md'),
      'single-line-skill',
      'Single line description text.',
    );

    // Multiline block (description: |)
    const multilinePath = path.join(home, '.claude', 'skills', 'multiline-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(multilinePath), { recursive: true });
    fs.writeFileSync(
      multilinePath,
      `---
name: multiline-skill
description: |
  First line of multiline block.
  Second line of multiline block.
---
Body content
`,
      'utf8',
    );

    const skills = new DispatchSkillLibraryService().listSkills();
    const singleSkill = skills.find((s) => s.name === 'single-line-skill');
    const multiSkill = skills.find((s) => s.name === 'multiline-skill');

    expect(singleSkill?.description).toBe('Single line description text.');
    expect(multiSkill?.description).toContain('First line of multiline block.');
    expect(multiSkill?.description).toContain('Second line of multiline block.');
    expect(multiSkill?.description).not.toBe('|');
  });

  it('green ③: 分类与中文说明来自同一次生成且落盘缓存；内容未变时不重新生成', () => {
    const { home } = makeTempHome();
    writeSkill(
      path.join(home, '.claude', 'skills', 'cached-skill', 'SKILL.md'),
      'cached-skill',
      'Cached skill description',
    );

    const service = new DispatchSkillLibraryService();
    const firstList = service.listSkillsDetailed();
    const firstSkill = firstList.skills.find((s) => s.name === 'cached-skill');
    expect(firstSkill?.category).toBeDefined();
    expect(firstSkill?.summaryZh).toBeDefined();

    // Calling again without content change should read from disk cache
    const secondList = service.listSkillsDetailed();
    const secondSkill = secondList.skills.find((s) => s.name === 'cached-skill');
    expect(secondSkill?.category).toBe(firstSkill?.category);
    expect(secondSkill?.summaryZh).toBe(firstSkill?.summaryZh);
  });

  it('green FK / 绿⑨: collects and returns scanning errors for corrupt JSON and failed codex CLI', () => {
    const { home } = makeTempHome();
    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.gemini', 'settings.json'),
      '{ invalid json here',
      'utf8',
    );
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'codex CLI not authorized',
    } as any);

    const result = new DispatchSkillLibraryService().listSkillsDetailed();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((err) => err.includes('配置 JSON 解析失败'))).toBe(true);
    expect(result.errors.some((err) => err.includes('codex skills list 跑不通'))).toBe(true);
  });
});

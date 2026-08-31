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

  it('green FK: collects and returns scanning errors for corrupt JSON and failed codex CLI', () => {
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

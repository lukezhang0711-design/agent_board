import { describe, expect, it } from 'vitest';
import {
  CODEX_SKILL_CONTROL_NOTICE,
  readDispatchSkillSettings,
  resolveDispatchSkills,
  sanitizeDispatchSkillSettingsForLibrary,
  type DispatchSkillDescriptor,
} from '../dispatchSkills';
import * as dispatchSkillsModule from '../dispatchSkills';

const skills: DispatchSkillDescriptor[] = [
  { id: 'claude:user:implement', name: 'implement', engine: 'claude', source: 'user', scope: 'global' },
  { id: 'claude:user:review', name: 'review', engine: 'claude', source: 'user', scope: 'global' },
  { id: 'codex:user:implement', name: 'implement', engine: 'codex', source: 'user', scope: 'global' },
  { id: 'codex:user:review', name: 'review', engine: 'codex', source: 'user', scope: 'global' },
  { id: 'gemini:builtin:antigravity_guide', name: 'antigravity_guide', engine: 'gemini', source: 'builtin', scope: 'global' },
  { id: 'gemini:builtin:disabled', name: 'disabled', engine: 'gemini', source: 'builtin', scope: 'global' },
];

const settings = {
  disabledSkillIds: ['gemini:builtin:disabled'],
  bundles: [
    {
      id: 'construction',
      name: '施工包',
      skillIds: ['claude:user:implement', 'codex:user:implement', 'gemini:builtin:disabled'],
    },
  ],
};

describe('dispatch skill resolution', () => {
  it('绿①: 清空后读取，bundles 为空数组；反向断言 DEFAULT_DISPATCH_SKILL_BUNDLES 不存在', () => {
    expect((dispatchSkillsModule as any).DEFAULT_DISPATCH_SKILL_BUNDLES).toBeUndefined();
    expect(readDispatchSkillSettings(undefined)).toEqual({ disabledSkillIds: [], bundles: [] });
    expect(readDispatchSkillSettings({})).toEqual({ disabledSkillIds: [], bundles: [] });
    expect(readDispatchSkillSettings({ bundles: [] })).toEqual({ disabledSkillIds: [], bundles: [] });
    expect(readDispatchSkillSettings({ bundles: null })).toEqual({ disabledSkillIds: [], bundles: [] });
  });

  it('green FI-1: leaves every engine at its native default when skills are omitted', () => {
    expect(resolveDispatchSkills('claude-code', undefined, skills, settings)).toBeUndefined();
    expect(resolveDispatchSkills('openai-codex', undefined, skills, settings)).toBeUndefined();
    expect(resolveDispatchSkills('antigravity-gemini-agent', undefined, skills, settings)).toBeUndefined();
  });

  it('green FI-2: retains an explicit no-skill grant for every engine', () => {
    const claude = resolveDispatchSkills('claude-code', { skillIds: [] }, skills, settings);
    const codex = resolveDispatchSkills('openai-codex', { skillIds: [] }, skills, settings);
    const gemini = resolveDispatchSkills(
      'antigravity-gemini-agent',
      { skillIds: [] },
      skills,
      settings,
    );

    expect(claude?.native.claudeSdk).toEqual({ skills: [] });
    expect(codex?.native.codex?.config).toEqual({
      'skills.include_only': [],
      'skills.disabled': ['implement', 'review'],
    });
    expect(gemini?.native.gemini).toEqual({
      include_only: [],
      preToolUse: { include_only: [] },
    });
  });

  it('green FD-1/FD-2: removes disabled and missing skills from bundles before grant', () => {
    expect(sanitizeDispatchSkillSettingsForLibrary(settings, skills)).toEqual({
      disabledSkillIds: ['gemini:builtin:disabled'],
      bundles: [{
        id: 'construction',
        name: '施工包',
        skillIds: ['claude:user:implement', 'codex:user:implement'],
      }],
    });
  });

  it('green FD-5: maps Claude Agent SDK grants to the native skills option', () => {
    const resolution = resolveDispatchSkills(
      'claude-code',
      { skillIds: ['claude:user:implement', 'codex:user:implement'] },
      skills,
      settings,
    );
    expect(resolution?.effectiveSkillNames).toEqual(['implement']);
    expect(resolution?.native.claudeSdk).toEqual({ skills: ['implement'] });
  });

  it('green FD-5: maps Gemini grants to include_only and PreToolUse guards', () => {
    const resolution = resolveDispatchSkills(
      'antigravity-gemini-agent',
      { skillIds: ['gemini:builtin:antigravity_guide', 'gemini:builtin:disabled'] },
      skills,
      settings,
    );
    expect(resolution?.native.gemini).toEqual({
      include_only: ['antigravity_guide'],
      preToolUse: { include_only: ['antigravity_guide'] },
    });
  });

  it('green FD-5/FD-6: maps Codex grants to session-level config write and explicit downgrade notice', () => {
    const resolution = resolveDispatchSkills(
      'openai-codex',
      { skillIds: ['codex:user:implement'] },
      skills,
      settings,
    );
    expect(resolution?.native.codex).toMatchObject({
      control: 'skills/config/write',
      includeOnly: ['implement'],
      disabledSkillNames: ['review'],
      config: {
        'skills.include_only': ['implement'],
        'skills.disabled': ['review'],
      },
      notice: CODEX_SKILL_CONTROL_NOTICE,
    });
    expect(resolution?.notice).toBe(CODEX_SKILL_CONTROL_NOTICE);
  });
});

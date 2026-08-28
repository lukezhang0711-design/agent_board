import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));
vi.mock('../claudeCode/cliPathResolver', () => ({
  resolveClaudeAgentCliPath: async () => '/fake/claude',
}));
vi.mock('../../../../electron/claudeCodeEnvironment', () => ({
  setupClaudeCodeEnvironment: () => ({}),
  resolveNativeBinaryPath: () => undefined,
}));

import { resolveDispatchPermission } from '../../dispatchPermissionKnobs';
import { buildSdkOptions } from '../claudeCode/sdkOptionsBuilder';

function makeDeps(overrides: Partial<Parameters<typeof buildSdkOptions>[0]> = {}) {
  return {
    resolveModelVariant: () => 'sonnet',
    mcpConfigService: { getMcpServersConfig: async () => ({}) },
    createCanUseToolHandler: () => () => true,
    toolHooksService: {
      createPreToolUseHook: () => () => ({}),
      createPostToolUseHook: () => () => ({}),
      createPermissionDeniedHook: () => () => ({}),
    },
    teammateManager: { resolveTeamContext: async () => undefined },
    sessions: { getSessionId: () => null },
    config: {},
    abortController: new AbortController(),
    ...overrides,
  } as Parameters<typeof buildSdkOptions>[0];
}

function makeParams() {
  return {
    message: 'inspect safely',
    workspacePath: '/tmp/workspace',
    settingsEnv: {},
    shellEnv: {},
    systemPrompt: '',
    currentMode: undefined,
    imageContentBlocks: [],
    documentContentBlocks: [],
  } as Parameters<typeof buildSdkOptions>[1];
}

describe('buildSdkOptions dispatch permissions', () => {
  it('green EX-3b: emits Claude SDK’s actual native query options', async () => {
    const dispatchPermission = resolveDispatchPermission('claude-code', {
      permissionScope: 'read-only',
      disturbanceLevel: 'never',
    });

    const { options } = await buildSdkOptions(
      makeDeps({ config: { dispatchPermission } }),
      makeParams(),
    );

    // ClaudeCodeProvider passes this object directly as query({ options }).
    expect(options).toMatchObject({
      permissionMode: 'dontAsk',
      tools: ['Read', 'Glob', 'Grep', 'LS'],
      allowedTools: ['Read', 'Glob', 'Grep', 'LS'],
    });
    expect(options.disallowedTools).toBeUndefined();
  });

  it('green FD-5: emits Claude Agent SDK skill allowlist options', async () => {
    const dispatchPermission = resolveDispatchPermission('claude-code', {
      permissionScope: 'read-only',
      disturbanceLevel: 'never',
    });

    const { options } = await buildSdkOptions(
      makeDeps({
        config: {
          dispatchPermission,
          dispatchSkills: {
            engine: 'claude',
            requested: { skillIds: ['claude:user:implement'] },
            effective: { skillIds: ['claude:user:implement'] },
            effectiveSkillNames: ['implement'],
            native: {
              claudeSdk: { skills: ['implement'] },
            },
          },
        },
      }),
      makeParams(),
    );

    // ClaudeCodeProvider passes this object directly as query({ options }).
    expect(options).toMatchObject({
      skills: ['implement'],
      tools: ['Read', 'Glob', 'Grep', 'LS', 'Skill'],
      allowedTools: ['Read', 'Glob', 'Grep', 'LS'],
    });
  });

  it('green FD-7: emits an empty Claude Agent SDK skill allowlist when no skills are granted', async () => {
    const dispatchPermission = resolveDispatchPermission('claude-code', {
      permissionScope: 'read-only',
      disturbanceLevel: 'never',
    });

    const { options } = await buildSdkOptions(
      makeDeps({
        config: {
          dispatchPermission,
          dispatchSkills: {
            engine: 'claude',
            requested: { skillIds: [] },
            effective: { skillIds: [] },
            effectiveSkillNames: [],
            native: {
              claudeSdk: { skills: [] },
            },
          },
        },
      }),
      makeParams(),
    );

    // Claude Agent SDK treats skills: [] as no available skills.
    expect(options).toMatchObject({
      skills: [],
      tools: ['Read', 'Glob', 'Grep', 'LS', 'Skill'],
      allowedTools: ['Read', 'Glob', 'Grep', 'LS'],
    });
  });
});

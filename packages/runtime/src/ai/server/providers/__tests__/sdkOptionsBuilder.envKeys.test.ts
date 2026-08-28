/**
 * Env-key hardening tests for sdkOptionsBuilder.
 *
 * Regression coverage for the $100 shell-env-key incident — see CLAUDE.md
 * "Never Use Environment Variables as Implicit API Key Sources".
 *
 * As of claude-agent-sdk 0.2.111, `options.env` overlays `process.env`
 * instead of replacing it, so defense-in-depth requires both:
 *   1. Stripping the keys from process.env at main-process bootstrap, AND
 *   2. Stripping those keys from every shell/settings overlay we compose.
 *
 * These tests cover step 2. Login-based Claude Agent sessions must leave the
 * keys absent entirely; setting ANTHROPIC_API_KEY='' shadows OAuth login in
 * the native binary and breaks prompt execution.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock('../claudeCode/cliPathResolver', () => ({
  resolveClaudeAgentCliPath: async () => '/fake/claude',
}));

vi.mock('../../../../electron/claudeCodeEnvironment', () => ({
  setupClaudeCodeEnvironment: () => ({}),
  resolveNativeBinaryPath: () => undefined,
}));

import { buildSdkOptions } from '../claudeCode/sdkOptionsBuilder';
import { resolveClaudeCodeModelVariant } from '../../types';

function makeDeps(overrides: Partial<Parameters<typeof buildSdkOptions>[0]> = {}) {
  return {
    resolveModelVariant: () => 'opus',
    mcpConfigService: { getMcpServersConfig: async () => ({}) },
    createCanUseToolHandler: () => () => true,
    toolHooksService: {
      createPreToolUseHook: () => () => ({}),
      createPostToolUseHook: () => () => ({}),
      createPermissionDeniedHook: () => () => ({}),
    },
    teammateManager: {
      resolveTeamContext: async () => undefined,
      packagedBuildOptions: undefined as any,
    },
    sessions: { getSessionId: () => null },
    config: {},
    abortController: new AbortController(),
    ...overrides,
  } as Parameters<typeof buildSdkOptions>[0];
}

function makeParams(overrides: Partial<Parameters<typeof buildSdkOptions>[1]> = {}) {
  return {
    message: 'hello',
    workspacePath: '/tmp/workspace',
    settingsEnv: {},
    shellEnv: {},
    systemPrompt: '',
    currentMode: undefined,
    imageContentBlocks: [],
    documentContentBlocks: [],
    ...overrides,
  } as Parameters<typeof buildSdkOptions>[1];
}

describe('buildSdkOptions env-key hardening', () => {
  let originalAnthropic: string | undefined;
  let originalOpenAI: string | undefined;
  let originalEntrypoint: string | undefined;

  beforeEach(() => {
    originalAnthropic = process.env.ANTHROPIC_API_KEY;
    originalOpenAI = process.env.OPENAI_API_KEY;
    originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;
  });

  afterEach(() => {
    if (originalAnthropic === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropic;
    }
    if (originalOpenAI === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAI;
    }
    if (originalEntrypoint === undefined) {
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
    } else {
      process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint;
    }
  });

  it('removes ANTHROPIC_API_KEY when no configured key is provided', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-leaked-from-shell';
    process.env.OPENAI_API_KEY = 'sk-leaked-from-shell';

    const { options } = await buildSdkOptions(
      makeDeps({ config: {} }),
      makeParams({ shellEnv: { ANTHROPIC_API_KEY: 'sk-ant-leaked-shellenv' } })
    );

    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.env.OPENAI_API_KEY).toBeUndefined();
  });

  it('ignores ANTHROPIC_API_KEY that settingsEnv might carry', async () => {
    const { options } = await buildSdkOptions(
      makeDeps({ config: {} }),
      makeParams({
        settingsEnv: {
          ANTHROPIC_API_KEY: 'sk-ant-sneaked-via-settings',
          SOME_OTHER_FLAG: '1',
        },
      })
    );

    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options.env.SOME_OTHER_FLAG).toBe('1');
  });

  it('preserves Claude credential identity while stripping implicit credentials from every overlay', async () => {
    const previous = {
      USER: process.env.USER,
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      CLAUDE_CODE_OAUTH_REFRESH_TOKEN: process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN,
      CLAUDECODE: process.env.CLAUDECODE,
    };
    try {
      Object.assign(process.env, {
        USER: 'desktop-owner',
        CLAUDE_CONFIG_DIR: '/Users/desktop-owner/.claude-custom',
        ANTHROPIC_AUTH_TOKEN: 'process-token',
        CLAUDE_CODE_OAUTH_TOKEN: 'process-oauth-token',
        CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'process-refresh-token',
        CLAUDECODE: '1',
      });

      const { options } = await buildSdkOptions(
        makeDeps({ config: {} }),
        makeParams({
          shellEnv: {
            USER: 'shell-owner',
            CLAUDE_CONFIG_DIR: '/tmp/shell-claude',
            ANTHROPIC_AUTH_TOKEN: 'shell-token',
            CLAUDE_CODE_OAUTH_TOKEN: 'shell-oauth-token',
            CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'shell-refresh-token',
            CLAUDECODE: 'shell',
          },
          settingsEnv: {
            USER: 'settings-owner',
            CLAUDE_CONFIG_DIR: '/tmp/settings-claude',
            ANTHROPIC_AUTH_TOKEN: 'settings-token',
            CLAUDE_CODE_OAUTH_TOKEN: 'settings-oauth-token',
            CLAUDE_CODE_OAUTH_REFRESH_TOKEN: 'settings-refresh-token',
            CLAUDECODE: 'settings',
          },
        }),
      );

      expect(options.env.USER).toBe('desktop-owner');
      expect(options.env.CLAUDE_CONFIG_DIR).toBe('/Users/desktop-owner/.claude-custom');
      expect(options.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(options.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined();
      expect(options.env.CLAUDECODE).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('uses the configured API key from provider config when present', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-leaked-from-shell';

    const { options } = await buildSdkOptions(
      makeDeps({ config: { apiKey: 'sk-ant-user-configured' } }),
      makeParams()
    );

    expect(options.env.ANTHROPIC_API_KEY).toBe('sk-ant-user-configured');
  });

  it('sets the base env flags buildSdkOptions applies to every spawn', async () => {
    delete process.env.CLAUDE_CODE_ENTRYPOINT;

    const { options } = await buildSdkOptions(makeDeps(), makeParams());

    // Flags buildSdkOptions always composes onto the spawned session env.
    expect(options.env.ENABLE_TOOL_SEARCH).toBe('auto:2');
    expect(options.env.CLAUDE_CODE_ENTRYPOINT).toBe('cli');
  });

  it('green FB-125: gives only a Head session the verified MCP approval timeout environment', async () => {
    // buildSdkOptions inherits the host process environment, and a developer
    // running these tests from inside Claude Code already has MCP_TOOL_TIMEOUT
    // set. Isolate it so this asserts what the builder decides, not what the
    // shell happened to export.
    const inherited = process.env.MCP_TOOL_TIMEOUT;
    delete process.env.MCP_TOOL_TIMEOUT;
    try {
      const head = await buildSdkOptions(makeDeps(), makeParams({ isMetaAgent: true }));
      const standard = await buildSdkOptions(makeDeps(), makeParams({ isMetaAgent: false }));

      expect(head.options.env.MCP_TOOL_TIMEOUT).toBe('14400000');
      expect(standard.options.env.MCP_TOOL_TIMEOUT).toBeUndefined();
    } finally {
      if (inherited === undefined) delete process.env.MCP_TOOL_TIMEOUT;
      else process.env.MCP_TOOL_TIMEOUT = inherited;
    }
  });

  it('green FB-125: a Head session overrides an inherited MCP timeout instead of deferring to it', async () => {
    const inherited = process.env.MCP_TOOL_TIMEOUT;
    process.env.MCP_TOOL_TIMEOUT = '600000';
    try {
      const head = await buildSdkOptions(makeDeps(), makeParams({ isMetaAgent: true }));
      // The engine treats this as a hard wall-clock limit, so a shorter
      // inherited value would reintroduce the 600s plan-approval timeout.
      expect(head.options.env.MCP_TOOL_TIMEOUT).toBe('14400000');
    } finally {
      if (inherited === undefined) delete process.env.MCP_TOOL_TIMEOUT;
      else process.env.MCP_TOOL_TIMEOUT = inherited;
    }
  });

  it('green EZ-1: forces Head SDK permission mode to default even if stored mode says planning', async () => {
    const head = await buildSdkOptions(
      makeDeps(),
      makeParams({ isMetaAgent: true, currentMode: 'planning' }),
    );
    const standard = await buildSdkOptions(
      makeDeps(),
      makeParams({ isMetaAgent: false, currentMode: 'planning' }),
    );

    expect(head.options.permissionMode).toBe('default');
    expect(standard.options.permissionMode).toBe('plan');
  });

  it.each([
    ['claude-code:opus-5', 'opus-5'],
    ['claude-code:sonnet-5', 'sonnet-5'],
  ])('carries non-default effort for dynamically discovered %s into the SDK spawn environment', async (selectedModel, expectedSdkModel) => {
    const { options } = await buildSdkOptions(
      makeDeps({
        config: { model: selectedModel, effortLevel: 'max' },
        resolveModelVariant: () => resolveClaudeCodeModelVariant(selectedModel, 'claude-code:opus'),
      }),
      makeParams(),
    );

    expect(options.model).toBe(expectedSdkModel);
    expect(options.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('max');
  });

  it('carries the exact declared effort environment variable, including a model default', async () => {
    const selectedModel = 'claude-code:sonnet-5';
    const { options } = await buildSdkOptions(
      makeDeps({
        config: { model: selectedModel, effortLevel: 'high' },
        resolveModelVariant: () => resolveClaudeCodeModelVariant(selectedModel, 'claude-code:opus'),
      }),
      makeParams(),
    );

    expect(options.model).toBe('sonnet-5');
    expect(options.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('high');
  });

  it('forwards a future engine-declared effort value without consulting a global vocabulary', async () => {
    const { options } = await buildSdkOptions(
      makeDeps({
        config: { model: 'claude-code:sonnet-5', effortLevel: 'turbo' },
        resolveModelVariant: () => 'sonnet-5',
      }),
      makeParams(),
    );

    expect(options.env.CLAUDE_CODE_EFFORT_LEVEL).toBe('turbo');
  });

  it('does not pass an effort environment variable when the live model gate dropped Haiku effort', async () => {
    const { options } = await buildSdkOptions(
      makeDeps({
        config: { model: 'claude-code:haiku' },
        resolveModelVariant: () => 'haiku',
      }),
      makeParams(),
    );

    expect(options.model).toBe('haiku');
    expect(options.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
  });
});

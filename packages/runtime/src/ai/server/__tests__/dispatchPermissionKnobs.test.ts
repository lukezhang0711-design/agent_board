import { describe, expect, it } from 'vitest';
import {
  getDefaultDispatchPermissionKnobs,
  getDispatchPermissionCapabilities,
  resolveDispatchPermission,
} from '../dispatchPermissionKnobs';

describe('dispatchPermissionKnobs', () => {
  it('green EX-2: defaults implementation and investigation workers independently', () => {
    expect(getDefaultDispatchPermissionKnobs('implementation')).toEqual({
      permissionScope: 'workspace-write',
      disturbanceLevel: 'on-failure',
    });
    expect(getDefaultDispatchPermissionKnobs('investigation')).toEqual({
      permissionScope: 'read-only',
      disturbanceLevel: 'never',
    });
  });

  it('green EX-3a: maps Codex to its actual app-server sandbox and approval fields', () => {
    expect(resolveDispatchPermission('openai-codex', {
      permissionScope: 'danger-full-access',
      disturbanceLevel: 'on-request',
    })).toMatchObject({
      engine: 'codex',
      effective: {
        permissionScope: 'danger-full-access',
        disturbanceLevel: 'on-request',
      },
      native: {
        codex: {
          sandbox: 'danger-full-access',
          approvalPolicy: 'on-request',
        },
      },
    });
  });

  it('green EX-3b: records Claude’s unsupported failure-only downgrade before native SDK/CLI arguments are built', () => {
    const resolution = resolveDispatchPermission('claude-code', {
      permissionScope: 'workspace-write',
      disturbanceLevel: 'on-failure',
    });

    expect(resolution).toMatchObject({
      engine: 'claude',
      effective: {
        permissionScope: 'workspace-write',
        disturbanceLevel: 'on-request',
      },
      native: {
        claudeSdk: {
          permissionMode: 'auto',
          tools: expect.arrayContaining(['Read', 'Write', 'Edit']),
        },
        claudeCli: {
          permissionMode: 'auto',
          tools: expect.arrayContaining(['Read', 'Write', 'Edit']),
          disallowedTools: expect.arrayContaining(['Bash']),
        },
      },
    });
    expect(resolution.notice).toContain('Claude：该引擎不支持“失败才问”，按“高危必问”执行。');
  });

  it('green EX-4: Gemini exposes only its real subset and its receipt names both degradations', () => {
    expect(getDispatchPermissionCapabilities('antigravity-gemini-agent')).toEqual({
      permissionScopes: ['read-only', 'workspace-write'],
      disturbanceLevels: ['never', 'on-request'],
    });

    const resolution = resolveDispatchPermission('antigravity-gemini-agent', {
      permissionScope: 'danger-full-access',
      disturbanceLevel: 'on-failure',
    });
    expect(resolution).toMatchObject({
      engine: 'gemini',
      effective: {
        permissionScope: 'workspace-write',
        disturbanceLevel: 'on-request',
      },
      native: {
        gemini: { mode: 'accept-edits' },
      },
    });
    expect(resolution.notice).toContain('Gemini：该引擎不支持“全放开”，按“只写自己工地”执行。');
    expect(resolution.notice).toContain('Gemini：该引擎不支持“失败才问”，按“高危必问”执行。');
  });
});

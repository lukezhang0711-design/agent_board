import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/workspaceDetection', () => ({
  resolveProjectPath: (workspaceId: string) => workspaceId,
}));

import {
  dispatchMetaAgentTool,
  getMetaAgentOpenAITools,
  normalizeSubmitPlanArgs,
  setMetaAgentToolFns,
} from '../metaAgentServer';

function validateRecordedLegacySubmitPlan(args: Record<string, unknown>): void {
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  if (!title) {
    throw new Error('title is required');
  }

  const planItems = Array.isArray(args.planItems)
    ? args.planItems.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
  if (planItems.length === 0 || !Array.isArray(args.planItems) || planItems.length !== args.planItems.length) {
    throw new Error('planItems must be a non-empty list of non-empty strings');
  }

  if (!Number.isInteger(args.workOrderCount) || (args.workOrderCount as number) < 0) {
    throw new Error('workOrderCount must be a non-negative integer');
  }

  const risks = typeof args.risks === 'string' ? args.risks.trim() : '';
  if (!risks) {
    throw new Error('risks is required');
  }
}

describe('submit_plan ergonomics', () => {
  const submitPlan = vi.fn(async (_sessionId: string, _workspaceId: string, args: Record<string, unknown>) =>
    JSON.stringify(args),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    submitPlan.mockImplementation(async (_sessionId, _workspaceId, args) => JSON.stringify(args));
    setMetaAgentToolFns({
      listWorktrees: vi.fn(),
      submitPlan,
      requestRedispatch: vi.fn(),
      createSession: vi.fn(),
      spawnSession: vi.fn(),
      getSessionStatus: vi.fn(),
      getSessionResult: vi.fn(),
      sendPrompt: vi.fn(),
      respondToPrompt: vi.fn(),
      listSpawnedSessions: vi.fn(),
      interruptSession: vi.fn(),
    });
  });

  function callSubmitPlan(args: Record<string, unknown>): Promise<string> {
    return dispatchMetaAgentTool(
      'mcp__nimbalyst-meta-agent__submit_plan',
      'head-session',
      '/workspace',
      args,
    );
  }

  it('replays the recorded four-error legacy sequence before the final legal call', () => {
    const recordedCalls: Record<string, unknown>[] = [
      {},
      { title: 'Fix submit plan ergonomics' },
      { title: 'Fix submit plan ergonomics', planItems: ['Add the approval-card guardrail'] },
      {
        title: 'Fix submit plan ergonomics',
        planItems: ['Add the approval-card guardrail'],
        workOrderCount: 1,
      },
      {
        title: 'Fix submit plan ergonomics',
        planItems: ['Add the approval-card guardrail'],
        workOrderCount: 1,
        risks: 'No known risk',
      },
    ];
    const errors: string[] = [];

    for (const args of recordedCalls) {
      try {
        validateRecordedLegacySubmitPlan(args);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    expect(errors).toEqual([
      'title is required',
      'planItems must be a non-empty list of non-empty strings',
      'workOrderCount must be a non-negative integer',
      'risks is required',
    ]);
    expect(recordedCalls.length - errors.length).toBe(1);
  });

  it('teaches both provider paths the complete minimal legal call', () => {
    const submitPlanTool = getMetaAgentOpenAITools()
      .find((candidate) => candidate.function.name === 'submit_plan');
    const schema = submitPlanTool?.function.parameters as Record<string, any>;

    expect(submitPlanTool?.function.description).toContain('"title": "Implement the approved plan"');
    expect(submitPlanTool?.function.description).toContain('"planItems": [');
    expect(submitPlanTool?.function.description).toContain('Inspect the current workspace');
    expect(submitPlanTool?.function.description).toContain('"workOrderCount": 1');
    expect(submitPlanTool?.function.description).toContain('"risks": []');
    expect(submitPlanTool?.function.description).toContain('title is a string');
    expect(submitPlanTool?.function.description).toContain('planItems is a non-empty array');
    expect(submitPlanTool?.function.description).toContain('workOrderCount is an optional non-negative integer');
    expect(submitPlanTool?.function.description).toContain('risks is a required array of strings');
    expect(submitPlanTool?.function.description).toContain('model taken from a list_models id');
    expect(submitPlanTool?.function.description).toContain('resolvedModel is display-only');
    expect(submitPlanTool?.function.description).toContain('skillBundleName/skillIds');
    expect(submitPlanTool?.function.description).toContain('Omit skillBundleName and skillIds unless skills must be narrowed');
    expect(submitPlanTool?.function.description).not.toContain('Omitted skills mean no skills are granted');
    expect(submitPlanTool?.function.description).not.toContain('"skillIds": []');
    expect(schema).toMatchObject({
      properties: {
        title: { type: 'string' },
        planItems: { type: 'array', minItems: 1, items: { type: 'string' } },
        workOrderCount: { type: 'integer', minimum: 0 },
        risks: { type: 'array', minItems: 0, items: { type: 'string' } },
      },
      required: ['title', 'planItems', 'risks'],
    });
    expect(schema.properties.modules).toMatchObject({
      type: 'array',
      items: {
        required: ['title', 'outputFiles', 'inputs', 'provider', 'model', 'doneCriteria'],
        properties: {
          title: { type: 'string' },
          outputFiles: { type: 'array' },
          inputs: { type: 'array' },
          provider: { type: 'string' },
          model: expect.objectContaining({
            type: 'string',
            description: expect.stringContaining('list_models catalog id'),
          }),
          effortLevel: { type: 'string', minLength: 1 },
          intent: { type: 'string' },
          permissionScope: { type: 'string' },
          disturbanceLevel: { type: 'string' },
          skillBundleName: { type: 'string' },
          skillIds: expect.objectContaining({
            type: 'array',
            description: expect.stringContaining('Omit to preserve the engine native default'),
          }),
          doneCriteria: { type: 'string' },
          candidates: {
            type: 'array',
            items: {
              required: ['name', 'approach', 'pros', 'cons', 'risks', 'provider', 'model'],
              properties: {
                skillBundleName: { type: 'string' },
                skillIds: { type: 'array' },
              },
            },
          },
        },
      },
    });
  });

  it('green FI-6: accepts modules without skill fields and leaves them absent', () => {
    const normalized = normalizeSubmitPlanArgs({
      title: 'Use native skill defaults',
      planItems: ['Dispatch without narrowing skills'],
      risks: [],
      modules: [{
        title: 'Native-default worker',
        outputFiles: ['report.md'],
        inputs: ['brief'],
        provider: 'claude-code',
        model: 'haiku',
        doneCriteria: 'Use the engine default skills.',
      }],
    });

    expect(normalized.modules).toEqual([{
      title: 'Native-default worker',
      outputFiles: ['report.md'],
      inputs: ['brief'],
      provider: 'claude-code',
      model: 'haiku',
      intent: 'implementation',
      permissionScope: 'workspace-write',
      disturbanceLevel: 'on-failure',
      doneCriteria: 'Use the engine default skills.',
    }]);
  });

  it('keeps an explicit complete call unchanged', async () => {
    const args = {
      title: 'Approved dispatch gate',
      planItems: ['Persist plan approval'],
      workOrderCount: 1,
      risks: ['Durable response timeout'],
    };

    await expect(callSubmitPlan(args)).resolves.toBe(JSON.stringify(args));
    expect(submitPlan).toHaveBeenCalledWith('head-session', '/workspace', args);
  });

  it('accepts structured modules and candidate alternatives without dropping fields', async () => {
    const args = {
      title: 'Compare implementation routes',
      planItems: ['Choose the approved route'],
      risks: [],
      modules: [{
        title: 'Approval card',
        outputFiles: ['packages/electron/src/renderer/components/UnifiedAI/PlanApprovalWidget.tsx'],
        inputs: ['Existing approval widget'],
        provider: 'openai-codex',
        model: 'gpt-5.4-mini',
        effortLevel: 'medium',
        skillBundleName: '施工包',
        skillIds: [],
        doneCriteria: 'Matrix and approval payload are tested.',
        candidates: [{
          name: '方案 A',
          approach: 'Use a responsive comparison matrix.',
          pros: ['Aligned fields', 'Easy to scan'],
          cons: 'Requires horizontal scrolling on narrow windows.',
          risks: ['Selection payload could be stale.'],
          provider: 'openai-codex',
          model: 'gpt-5.4-mini',
          effortLevel: 'low',
          skillBundleName: '施工包',
          skillIds: ['codex:user:implement'],
        }],
      }],
    };

    const result = await callSubmitPlan(args);
    expect(JSON.parse(result)).toMatchObject({
      ...args,
      workOrderCount: 1,
      modules: [{
        ...args.modules[0],
        intent: 'implementation',
        permissionScope: 'workspace-write',
        disturbanceLevel: 'on-failure',
        candidates: [{
          ...args.modules[0].candidates[0],
          intent: 'implementation',
          permissionScope: 'workspace-write',
          disturbanceLevel: 'on-failure',
        }],
      }],
    });
    expect(submitPlan).toHaveBeenCalledWith('head-session', '/workspace', expect.objectContaining({
      title: args.title,
      planItems: args.planItems,
      risks: args.risks,
      workOrderCount: 1,
      modules: [expect.objectContaining({
        ...args.modules[0],
        intent: 'implementation',
        permissionScope: 'workspace-write',
        disturbanceLevel: 'on-failure',
        candidates: [expect.objectContaining({
          ...args.modules[0].candidates[0],
          intent: 'implementation',
          permissionScope: 'workspace-write',
          disturbanceLevel: 'on-failure',
        })],
      })],
    }));
  });

  it('normalizes structured fields with the same tolerant string handling as legacy fields', () => {
    expect(normalizeSubmitPlanArgs({
      title: '  Structured plan  ',
      planItems: ['  Keep a short summary  '],
      risks: ['  One risk  '],
      modules: [{
        title: '  Module 1  ',
        outputFiles: ['  dist/result.md  '],
        inputs: ['  source brief  '],
        provider: ' openai-codex ',
        model: ' gpt-5.4-mini ',
        effortLevel: 'medium',
        skillBundleName: '  施工包  ',
        skillIds: ['  codex:user:implement  '],
        doneCriteria: '  Result exists.  ',
        candidates: [{
          name: '  A  ',
          approach: '  Do A.  ',
          pros: ['  Fast  '],
          cons: '  Narrow scope.  ',
          risks: ['  None known.  '],
          provider: ' openai-codex ',
          model: ' gpt-5.4-mini ',
          effortLevel: 'low',
          skillBundleName: '  调研包  ',
          skillIds: [],
        }],
      }],
    })).toEqual({
      title: 'Structured plan',
      planItems: ['Keep a short summary'],
      workOrderCount: 1,
      risks: ['One risk'],
      modules: [{
        title: 'Module 1',
        outputFiles: ['dist/result.md'],
        inputs: ['source brief'],
        provider: 'openai-codex',
        model: 'gpt-5.4-mini',
        effortLevel: 'medium',
        skillBundleName: '施工包',
        skillIds: ['codex:user:implement'],
        intent: 'implementation',
        permissionScope: 'workspace-write',
        disturbanceLevel: 'on-failure',
        doneCriteria: 'Result exists.',
        candidates: [{
          name: 'A',
          approach: 'Do A.',
          pros: ['Fast'],
          cons: 'Narrow scope.',
          risks: ['None known.'],
          provider: 'openai-codex',
          model: 'gpt-5.4-mini',
          effortLevel: 'low',
          skillBundleName: '调研包',
          skillIds: [],
          intent: 'implementation',
          permissionScope: 'workspace-write',
          disturbanceLevel: 'on-failure',
        }],
      }],
    });
  });

  it('green EX-2: defaults omitted knobs by worker role for modules and candidates', () => {
    const modules = normalizeSubmitPlanArgs({
      title: 'Role-specific defaults',
      planItems: ['Dispatch one investigator and one implementer'],
      risks: [],
      modules: [{
        title: 'Implement',
        outputFiles: ['src/implement.ts'],
        inputs: ['brief'],
        provider: 'openai-codex',
        model: 'gpt-5.4-mini',
        doneCriteria: 'Implementation is ready.',
      }, {
        title: 'Investigate',
        outputFiles: ['report.md'],
        inputs: ['brief'],
        provider: 'claude-code',
        model: 'haiku',
        intent: 'investigation',
        doneCriteria: 'Report is ready.',
        candidates: [{
          name: 'Read-only path',
          approach: 'Inspect without mutation.',
          pros: ['No writes'],
          cons: ['Cannot patch'],
          risks: ['May need a follow-up'],
          provider: 'claude-code',
          model: 'haiku',
        }],
      }],
    }).modules;

    expect(modules).toEqual([
      expect.objectContaining({
        intent: 'implementation',
        permissionScope: 'workspace-write',
        disturbanceLevel: 'on-failure',
      }),
      expect.objectContaining({
        intent: 'investigation',
        permissionScope: 'read-only',
        disturbanceLevel: 'never',
        candidates: [expect.objectContaining({
          intent: 'investigation',
          permissionScope: 'read-only',
          disturbanceLevel: 'never',
        })],
      }),
    ]);
  });

  it('green ET-1c: preserves the exact submitted model only for downstream validation feedback', () => {
    const rawModel = '  claude-opus-5[1m]  ';
    const result = normalizeSubmitPlanArgs({
      title: 'Preserve model validation input',
      planItems: ['Reject a resolved model without rewriting Head input'],
      risks: [],
      modules: [{
        title: 'Validation module',
        outputFiles: ['module.md'],
        inputs: ['model catalog'],
        provider: 'claude-code',
        model: rawModel,
        doneCriteria: 'The correction points to the untouched Head value.',
        candidates: [{
          name: 'Alternative',
          approach: 'Use the same model input preservation.',
          pros: ['Clear feedback'],
          cons: ['Internal metadata'],
          risks: ['None'],
          provider: 'claude-code',
          model: rawModel,
        }],
      }],
    });

    const module = result.modules?.[0];
    const candidate = module?.candidates?.[0];
    expect(module?.model).toBe('claude-opus-5[1m]');
    expect(module?.rawModelForValidation).toBe(rawModel);
    expect(candidate?.model).toBe('claude-opus-5[1m]');
    expect(candidate?.rawModelForValidation).toBe(rawModel);
    expect(Object.keys(module ?? {})).not.toContain('rawModelForValidation');
    expect(Object.keys(candidate ?? {})).not.toContain('rawModelForValidation');
    expect(JSON.stringify(result)).not.toContain(rawModel);
  });

  it('keeps an unknown model-declared effort and accepts Gemini-style modules without one', () => {
    expect(normalizeSubmitPlanArgs({
      title: 'Raw effort declaration',
      planItems: ['Use the engine catalog'],
      risks: [],
      modules: [{
        title: 'Claude future tier',
        outputFiles: ['report.md'],
        inputs: ['live catalog'],
        provider: 'claude-code',
        model: 'claude-code:sonnet',
        effortLevel: 'turbo',
        doneCriteria: 'The raw tier survives.',
      }, {
        title: 'Gemini embedded tier',
        outputFiles: ['gemini.md'],
        inputs: ['agy models'],
        provider: 'antigravity-gemini-agent',
        model: 'antigravity-gemini-agent:gemini-3.7-flash-high',
        doneCriteria: 'No invented independent effort field.',
      }],
    }).modules).toEqual([
      expect.objectContaining({ effortLevel: 'turbo' }),
      expect.not.objectContaining({ effortLevel: expect.anything() }),
    ]);
  });

  it('derives an omitted workOrderCount from planItems', async () => {
    const args = {
      title: 'Infer dispatch count',
      planItems: ['Persist approval', 'Dispatch after approval'],
      risks: [],
    };

    const result = await callSubmitPlan(args);
    expect(JSON.parse(result)).toEqual({
      ...args,
      workOrderCount: 2,
    });
    expect(submitPlan).toHaveBeenCalledWith('head-session', '/workspace', {
      ...args,
      workOrderCount: 2,
    });
  });

  it('attaches a correct writing example to every field validation error', async () => {
    await expect(callSubmitPlan({
      planItems: ['Inspect the current workspace'],
      workOrderCount: 1,
      risks: [],
    })).rejects.toThrow(/title is required.*"title": "Implement the approved plan"/);

    await expect(callSubmitPlan({
      title: 'Validate the plan',
      planItems: [],
      workOrderCount: 1,
      risks: [],
    })).rejects.toThrow(/planItems.*"planItems": \["Inspect the current workspace"\]/);

    await expect(callSubmitPlan({
      title: 'Validate the plan',
      planItems: ['Inspect the current workspace'],
      workOrderCount: '1',
      risks: [],
    })).rejects.toThrow(/workOrderCount.*"workOrderCount": 1/);

    await expect(callSubmitPlan({
      title: 'Validate the plan',
      planItems: ['Inspect the current workspace'],
      workOrderCount: 1,
    })).rejects.toThrow(/risks.*"risks": \[\]/);
  });

  it('lets a typical malformed first call succeed after one retry with the returned sample', async () => {
    const firstCall = {
      title: 'Fix submit plan ergonomics',
      planItems: ['Add the approval-card guardrail'],
    };
    const retry = {
      ...firstCall,
      risks: [],
    };
    const errors: string[] = [];
    let attempts = 0;
    let result: string | undefined;

    for (const args of [firstCall, retry]) {
      attempts += 1;
      try {
        result = await callSubmitPlan(args);
        break;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    expect(attempts).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"risks": []');
    expect(JSON.parse(result ?? '')).toEqual({
      ...retry,
      workOrderCount: 1,
    });
    expect(submitPlan).toHaveBeenCalledTimes(1);
  });
});

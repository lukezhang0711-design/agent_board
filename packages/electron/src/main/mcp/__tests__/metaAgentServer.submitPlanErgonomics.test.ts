import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/workspaceDetection', () => ({
  resolveProjectPath: (workspaceId: string) => workspaceId,
}));

import {
  dispatchMetaAgentTool,
  getMetaAgentOpenAITools,
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
    expect(schema).toMatchObject({
      properties: {
        title: { type: 'string' },
        planItems: { type: 'array', minItems: 1, items: { type: 'string' } },
        workOrderCount: { type: 'integer', minimum: 0 },
        risks: { type: 'array', minItems: 0, items: { type: 'string' } },
      },
      required: ['title', 'planItems', 'risks'],
    });
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

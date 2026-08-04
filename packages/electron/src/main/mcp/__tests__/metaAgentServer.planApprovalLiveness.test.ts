import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  setMetaAgentToolFns,
  shutdownMetaAgentServer,
  startMetaAgentServer,
} from '../metaAgentServer';
import { setMcpAuthTokenForTest } from '../mcpAuth';

const TEST_AUTH_TOKEN = 'plan-approval-liveness-test-token';

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type OriginalMcpCall = {
  requestId: string;
  resolveOriginalMcpCall: (result: string) => boolean;
};

function installToolFns(
  submitPlan: (
    args: Record<string, unknown>,
    mcpCall?: OriginalMcpCall,
  ) => Promise<string>,
): void {
  setMetaAgentToolFns({
    listWorktrees: async () => '[]',
    submitPlan: async (_sessionId, _workspaceId, args, _signal, mcpCall) =>
      submitPlan(args as Record<string, unknown>, mcpCall),
    createSession: async () => '{}',
    spawnSession: async () => '{}',
    getSessionStatus: async () => '{}',
    getSessionResult: async () => '{}',
    sendPrompt: async () => '{}',
    respondToPrompt: async () => '{}',
    listSpawnedSessions: async () => '[]',
    interruptSession: async () => '{}',
  });
}

describe('meta-agent submit_plan approval liveness', () => {
  afterEach(async () => {
    await shutdownMetaAgentServer();
    setMcpAuthTokenForTest(null);
  });

  it('keeps the original MCP call alive through a scaled six-minute approval and returns its result', async () => {
    // Scale one test millisecond to one production second: approval happens at
    // 360s, after the engine's 300s no-progress limit. The server must emit a
    // progress notification every scaled 30s while the original call is open.
    const approvalDelayMs = 360;
    const engineNoProgressTimeoutMs = 300;
    const progress: Array<{ progress: number; message?: string }> = [];
    let submitPlanCalls = 0;
    setMcpAuthTokenForTest(TEST_AUTH_TOKEN);
    installToolFns(async () => {
      submitPlanCalls += 1;
      await delay(approvalDelayMs);
      return JSON.stringify({ approved: true, planId: 'plan-six-minute-approval' });
    });

    const { httpServer } = await startMetaAgentServer(0, {
      planApprovalProgressIntervalMs: 30,
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Meta-agent test server did not expose a TCP port');
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${address.port}/mcp?sessionId=head-session&workspaceId=%2Fworkspace`,
      ),
      { requestInit: { headers: { Authorization: `Bearer ${TEST_AUTH_TOKEN}` } } },
    );
    const client = new Client(
      { name: 'approval-liveness-fixture', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    try {
      const result = await client.callTool(
        {
          name: 'submit_plan',
          arguments: {
            title: 'Six minute approval',
            planItems: ['Wait for user approval'],
            workOrderCount: 0,
            risks: 'The engine must not time out while the user reviews.',
          },
        },
        undefined,
        {
          timeout: engineNoProgressTimeoutMs,
          resetTimeoutOnProgress: true,
          onprogress: (event) => progress.push({
            progress: event.progress,
            ...(event.message ? { message: event.message } : {}),
          }),
        },
      );

      expect(result).toMatchObject({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ approved: true, planId: 'plan-six-minute-approval' }) }],
      });
      expect(progress.length).toBeGreaterThanOrEqual(10);
      expect(progress.every((event) => event.message === 'Waiting for user plan approval.')).toBe(true);
      // A timeout would make a Claude-like engine retry submit_plan and create
      // another approval card. The live original request needs exactly one call.
      expect(submitPlanCalls).toBe(1);
    } finally {
      await transport.close();
    }
  });

  it('returns through the original MCP call before its approval settlement finishes', async () => {
    const approvalResult = JSON.stringify({
      approved: true,
      planId: 'plan-original-mcp-call',
      deliveryMethod: 'direct',
    });
    let clientReceivedApprovalResult = false;
    setMcpAuthTokenForTest(TEST_AUTH_TOKEN);
    installToolFns(async (_args, mcpCall) => {
      expect(mcpCall?.requestId).toEqual(expect.any(String));
      expect(mcpCall?.resolveOriginalMcpCall(approvalResult)).toBe(true);

      // This represents transcript/lifecycle work after the original Claude
      // request was resolved. The client must already have its tool result.
      await delay(50);
      expect(clientReceivedApprovalResult).toBe(true);
      return approvalResult;
    });

    const { httpServer } = await startMetaAgentServer(0, {
      planApprovalProgressIntervalMs: 30,
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Meta-agent test server did not expose a TCP port');
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(
        'http://127.0.0.1:' + address.port + '/mcp?sessionId=head-session&workspaceId=%2Fworkspace',
      ),
      { requestInit: { headers: { Authorization: 'Bearer ' + TEST_AUTH_TOKEN } } },
    );
    const client = new Client(
      { name: 'approval-original-call-fixture', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    try {
      const result = await client.callTool(
        {
          name: 'submit_plan',
          arguments: {
            title: 'Original MCP response',
            planItems: ['Resolve the waiting tool call first'],
            workOrderCount: 0,
            risks: 'A transcript-only delivery would leave Claude waiting.',
          },
        },
      ).then((response) => {
        clientReceivedApprovalResult = true;
        return response;
      });

      expect(result).toMatchObject({
        isError: false,
        content: [{ type: 'text', text: approvalResult }],
      });
    } finally {
      await transport.close();
    }
  });

  it('keeps fast approvals unchanged and emits no heartbeat before the first cadence', async () => {
    const progress: Array<{ progress: number }> = [];
    const approvalResult = JSON.stringify({
      approved: true,
      planId: 'plan-fast-approval',
    });
    setMcpAuthTokenForTest(TEST_AUTH_TOKEN);
    installToolFns(async () => {
      await delay(10);
      return approvalResult;
    });

    const { httpServer } = await startMetaAgentServer(0, {
      planApprovalProgressIntervalMs: 30,
    });
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Meta-agent test server did not expose a TCP port');
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(
        'http://127.0.0.1:' + address.port + '/mcp?sessionId=head-session&workspaceId=%2Fworkspace',
      ),
      { requestInit: { headers: { Authorization: 'Bearer ' + TEST_AUTH_TOKEN } } },
    );
    const client = new Client(
      { name: 'approval-fast-fixture', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);

    try {
      const result = await client.callTool(
        {
          name: 'submit_plan',
          arguments: {
            title: 'Fast approval',
            planItems: ['Return before the heartbeat cadence'],
            workOrderCount: 0,
            risks: 'The quick path must stay unchanged.',
          },
        },
        undefined,
        {
          onprogress: (event) => progress.push({ progress: event.progress }),
        },
      );

      expect(result).toMatchObject({
        isError: false,
        content: [{ type: 'text', text: approvalResult }],
      });
      await delay(60);
      expect(progress).toEqual([]);
    } finally {
      await transport.close();
    }
  });
});

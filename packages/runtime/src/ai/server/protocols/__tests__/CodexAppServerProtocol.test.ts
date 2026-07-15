// Unit tests for CodexAppServerProtocol against a mock JSON-RPC peer.
//
// We stub `child_process.spawn` so the protocol talks to a fake codex
// app-server we can drive frame-by-frame. This locks in the request/response
// shape and notification translation that future codex upgrades might break.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// IMPORTANT: mock `node:child_process` BEFORE importing the protocol so the
// module under test picks up the stub.
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Stub binary resolution so we don't depend on @openai/codex being installed.
vi.mock('../codexAppServer/codexAppServerBinary', () => ({
  resolveCodexBinaryPath: () => '/fake/codex',
  resolveCodexBinaryFromModules: () => '/fake/codex',
  getCodexVendorPathEntries: () => [],
}));

import { CodexAppServerProtocol } from '../CodexAppServerProtocol';
import type { ProtocolEvent } from '../ProtocolInterface';
import {
  FakeCodexAppServer,
  nextWrittenMatching,
} from './fixtures/fakeCodexAppServer';

describe('CodexAppServerProtocol', () => {
  let child: FakeCodexAppServer;

  beforeEach(() => {
    child = new FakeCodexAppServer();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(child);
  });

  afterEach(() => {
    if (!child.killed) child.kill();
  });

  async function createActiveTurn(
    protocol: CodexAppServerProtocol,
    threadId = 'thread-interrupt',
    turnId = 'turn-interrupt',
  ) {
    child
      .scriptResult('initialize', {
        codexHome: '/fake',
        platformFamily: 'unix',
        platformOs: 'macos',
        userAgent: 'fake/0',
      })
      .scriptResult('thread/start', { thread: { id: threadId } })
      .scriptResult('turn/start', {
        turn: { id: turnId, items: [], status: 'inProgress' },
      });

    const session = await protocol.createSession({ workspacePath: '/tmp/ws' });
    const iterator = protocol.sendMessage(session, { content: 'keep working' })[Symbol.asyncIterator]();
    const firstEvent = iterator.next();
    await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ method: 'turn/started', params: { threadId, turnId } });
    await firstEvent;

    return { iterator, session };
  }

  it('spawns the codex binary, completes the initialize handshake, and starts a thread', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({
      workspacePath: '/tmp/ws',
    });

    // Initialize round trip
    const initReq = await nextWrittenMatching(child, 'initialize');
    expect(initReq.method).toBe('initialize');
    expect((initReq.params as { clientInfo: { name: string } }).clientInfo.name).toBe('nimbalyst');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });

    // initialized notification
    await new Promise((r) => setTimeout(r, 10));
    expect(child.writtenLines.some((l) => (l as { method?: string }).method === 'initialized')).toBe(true);

    // thread/start round trip
    const startReq = await nextWrittenMatching(child, 'thread/start');
    expect((startReq.params as { sandbox: string }).sandbox).toBe('workspace-write');
    expect((startReq.params as { approvalPolicy: string }).approvalPolicy).toBe('never');
    child.emitLine({ id: startReq.id, result: { thread: { id: 'thread-abc' } } });

    const session = await sessionPromise;
    expect(session.id).toBe('thread-abc');
    expect(session.platform).toBe('codex-app-server');

    // Spawn arguments
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args] = spawnMock.mock.calls[0];
    expect(bin).toBe('/fake/codex');
    expect(args).toEqual(['app-server', '--listen', 'stdio://']);

    protocol.cleanupSession(session);
  });

  it('streams agentMessage deltas as text events and emits complete on turn/completed', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({ workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    child.emitLine({ id: startReq.id, result: { thread: { id: 'thread-abc' } } });
    const session = await sessionPromise;

    const events: ProtocolEvent[] = [];
    const collector = (async () => {
      for await (const ev of protocol.sendMessage(session, { content: 'hi' })) {
        events.push(ev);
      }
    })();

    const turnReq = await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ id: turnReq.id, result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } });

    child.emitLine({ method: 'turn/started', params: { threadId: 'thread-abc', turnId: 'turn-1' } });
    child.emitLine({ method: 'item/agentMessage/delta', params: { threadId: 'thread-abc', turnId: 'turn-1', itemId: 'msg-1', delta: 'Hello' } });
    child.emitLine({ method: 'item/agentMessage/delta', params: { threadId: 'thread-abc', turnId: 'turn-1', itemId: 'msg-1', delta: ' world' } });
    child.emitLine({ method: 'turn/completed', params: { threadId: 'thread-abc', turn: { id: 'turn-1', status: 'completed' } } });

    await collector;

    const textEvents = events.filter((e) => e.type === 'text');
    expect(textEvents.map((e) => e.content).join('')).toBe('Hello world');
    expect(events[events.length - 1]).toMatchObject({ type: 'complete', content: 'Hello world' });

    protocol.cleanupSession(session);
  });

  it('translates fileChange item/completed into a tool_call event with diff-based baselines', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({ workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    child.emitLine({ id: startReq.id, result: { thread: { id: 't-1' } } });
    const session = await sessionPromise;

    const events: ProtocolEvent[] = [];
    const collector = (async () => {
      for await (const ev of protocol.sendMessage(session, { content: 'edit please' })) {
        events.push(ev);
      }
    })();

    const turnReq = await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ id: turnReq.id, result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } });

    child.emitLine({
      method: 'item/completed',
      params: {
        threadId: 't-1',
        turnId: 'turn-1',
        item: {
          id: 'call_abc',
          type: 'fileChange',
          status: 'completed',
          changes: [
            { path: '/tmp/ws/new.md', kind: { type: 'add' }, diff: 'fresh content\n' },
            { path: '/tmp/ws/old.md', kind: { type: 'update', move_path: null }, diff: '@@ -1,1 +1,1 @@\n-old\n+new\n' },
          ],
        },
      },
    });
    child.emitLine({ method: 'turn/completed', params: { threadId: 't-1', turn: { id: 'turn-1', status: 'completed' } } });

    await collector;

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls.length).toBe(1);
    const meta = toolCalls[0].metadata as { fileChangeBaselines: Array<{ path: string; kind: string; preEditContent: string | null | 'requires-post-edit-content' }> };
    expect(meta.fileChangeBaselines).toHaveLength(2);
    expect(meta.fileChangeBaselines[0]).toMatchObject({ kind: 'add', preEditContent: null });
    expect(meta.fileChangeBaselines[1]).toMatchObject({ kind: 'update', preEditContent: 'requires-post-edit-content' });

    protocol.cleanupSession(session);
  });

  it('surfaces turn/failed as an error event', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({ workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    child.emitLine({ id: startReq.id, result: { thread: { id: 't-1' } } });
    const session = await sessionPromise;

    const events: ProtocolEvent[] = [];
    const collector = (async () => {
      for await (const ev of protocol.sendMessage(session, { content: 'fail please' })) {
        events.push(ev);
      }
    })();

    const turnReq = await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ id: turnReq.id, result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } });
    child.emitLine({
      method: 'turn/completed',
      params: { threadId: 't-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'model unavailable' } } },
    });

    await collector;

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent?.error).toContain('model unavailable');

    protocol.cleanupSession(session);
  });

  it('passes MCP server config through ThreadStartParams.config', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({
      workspacePath: '/tmp/ws',
      raw: {
        codexConfigOverrides: {
          mcp_servers: {
            'nimbalyst-mcp': { command: 'node', args: ['/path/to/mcp.js'], env: { TOKEN: 'x' } },
          },
        },
      },
    } as never);
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    const params = startReq.params as { config: { mcp_servers: Record<string, unknown> } };
    expect(params.config).toBeDefined();
    expect(params.config.mcp_servers).toEqual({
      'nimbalyst-mcp': { command: 'node', args: ['/path/to/mcp.js'], env: { TOKEN: 'x' } },
    });
    child.emitLine({ id: startReq.id, result: { thread: { id: 't-mcp' } } });
    const session = await sessionPromise;
    protocol.cleanupSession(session);
  });

  it('resumes an existing thread via thread/resume', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.resumeSession('existing-thread-id', { workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const resumeReq = await nextWrittenMatching(child, 'thread/resume');
    expect((resumeReq.params as { threadId: string }).threadId).toBe('existing-thread-id');
    child.emitLine({ id: resumeReq.id, result: { thread: { id: 'existing-thread-id' } } });
    const session = await sessionPromise;
    expect(session.id).toBe('existing-thread-id');
    protocol.cleanupSession(session);
  });

  it('forwards mcp_servers and other thread config on thread/resume so the resumed agent has tools', async () => {
    // Each resume spawns a fresh codex app-server child; without re-attaching
    // mcp_servers (and the rest of the config we pass on first start), the
    // resumed agent has zero MCP tools available -- meaning every internal
    // Nimbalyst tool (developer_git_commit_proposal, AskUserQuestion, etc.)
    // silently disappears after the first user message in a session resumed
    // across a Nimbalyst restart.
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.resumeSession('thread-resume-tools', {
      workspacePath: '/tmp/ws',
      model: 'gpt-5.4',
      systemPrompt: 'be helpful',
      permissionMode: 'auto',
      raw: {
        codexConfigOverrides: {
          mcp_servers: {
            'nimbalyst-mcp': { command: 'npx', args: ['mcp-remote', 'http://127.0.0.1:3456/mcp?sessionId=s1'] },
          },
          show_raw_agent_reasoning: true,
        },
        effortLevel: 'high',
      },
    } as never);
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const resumeReq = await nextWrittenMatching(child, 'thread/resume');
    const params = resumeReq.params as {
      threadId: string;
      cwd: string;
      sandbox?: string;
      approvalPolicy?: string;
      developerInstructions?: string;
      model?: string;
      config?: { mcp_servers?: Record<string, unknown>; show_raw_agent_reasoning?: boolean; model_reasoning_effort?: string };
    };
    expect(params.threadId).toBe('thread-resume-tools');
    expect(params.cwd).toBe('/tmp/ws');
    expect(params.sandbox).toBe('workspace-write');
    expect(params.approvalPolicy).toBe('never');
    expect(params.developerInstructions).toBe('be helpful');
    expect(params.model).toBe('gpt-5.4');
    expect(params.config).toBeDefined();
    expect(params.config!.mcp_servers).toEqual({
      'nimbalyst-mcp': { command: 'npx', args: ['mcp-remote', 'http://127.0.0.1:3456/mcp?sessionId=s1'] },
    });
    expect(params.config!.show_raw_agent_reasoning).toBe(true);
    expect(params.config!.model_reasoning_effort).toBe('high');
    // ThreadResumeParams does NOT accept `ephemeral`; codex would reject the
    // params if we forwarded it. Verify we strip it.
    expect((params as Record<string, unknown>).ephemeral).toBeUndefined();
    child.emitLine({ id: resumeReq.id, result: { thread: { id: 'thread-resume-tools' } } });
    const session = await sessionPromise;
    protocol.cleanupSession(session);
  });

  it('emits a result-less tool_call on item/started for mcpToolCall so blocking widgets can render', async () => {
    // Custom widgets (developer_git_commit_proposal, AskUserQuestion) render
    // off the tool_call event with no result. If the protocol waits until
    // item/completed -- which only fires AFTER the MCP tool returns -- the
    // widget never appears and the user can't respond, deadlocking the turn.
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({ workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    child.emitLine({ id: startReq.id, result: { thread: { id: 't-blocking' } } });
    const session = await sessionPromise;

    const events: ProtocolEvent[] = [];
    const collector = (async () => {
      for await (const ev of protocol.sendMessage(session, { content: 'commit' })) {
        events.push(ev);
      }
    })();

    const turnReq = await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ id: turnReq.id, result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } });

    // Codex emits item/started for the MCP tool *before* the tool returns.
    child.emitLine({
      method: 'item/started',
      params: {
        threadId: 't-blocking',
        turnId: 'turn-1',
        item: {
          id: 'mcp_blocking_1',
          type: 'mcpToolCall',
          status: 'pending',
          server: 'nimbalyst-mcp',
          tool: 'developer_git_commit_proposal',
          arguments: { commitMessage: 'feat: x', filesToStage: ['a.ts'] },
        },
      },
    });

    // Verify the started-stage tool_call landed before any completed event.
    await new Promise((r) => setTimeout(r, 20));
    const toolCallsAtStart = events.filter((e) => e.type === 'tool_call');
    expect(toolCallsAtStart).toHaveLength(1);
    expect(toolCallsAtStart[0].toolCall?.name).toBe('mcp__nimbalyst-mcp__developer_git_commit_proposal');
    expect(toolCallsAtStart[0].toolCall?.result).toBeUndefined();
    expect((toolCallsAtStart[0].metadata as { stage?: string })?.stage).toBe('started');

    // Then item/completed arrives (after the user clicks through the widget,
    // the MCP tool returns, and codex emits the completion).
    child.emitLine({
      method: 'item/completed',
      params: {
        threadId: 't-blocking',
        turnId: 'turn-1',
        item: {
          id: 'mcp_blocking_1',
          type: 'mcpToolCall',
          status: 'completed',
          server: 'nimbalyst-mcp',
          tool: 'developer_git_commit_proposal',
          arguments: { commitMessage: 'feat: x', filesToStage: ['a.ts'] },
          result: { success: true },
        },
      },
    });
    child.emitLine({ method: 'turn/completed', params: { threadId: 't-blocking', turn: { id: 'turn-1', status: 'completed' } } });
    await collector;

    const allToolCalls = events.filter((e) => e.type === 'tool_call');
    expect(allToolCalls).toHaveLength(2);
    expect(allToolCalls[1].toolCall?.result).toBeDefined();
    protocol.cleanupSession(session);
  });

  it('emits mcpToolCall events with the canonical mcp__server__tool name format', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({ workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    child.emitLine({ id: startReq.id, result: { thread: { id: 't-mcp' } } });
    const session = await sessionPromise;

    const events: ProtocolEvent[] = [];
    const collector = (async () => {
      for await (const ev of protocol.sendMessage(session, { content: 'call mcp' })) {
        events.push(ev);
      }
    })();

    const turnReq = await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ id: turnReq.id, result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } });
    child.emitLine({
      method: 'item/completed',
      params: {
        threadId: 't-mcp',
        turnId: 'turn-1',
        item: {
          id: 'mcp_call_1',
          type: 'mcpToolCall',
          status: 'completed',
          server: 'nimbalyst-session-naming',
          tool: 'update_session_meta',
          arguments: { name: 'test' },
          result: 'ok',
        },
      },
    });
    child.emitLine({ method: 'turn/completed', params: { threadId: 't-mcp', turn: { id: 'turn-1', status: 'completed' } } });

    await collector;

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(1);
    // The provider's session-naming detector and AskUserQuestion router both
    // strip `mcp__<server>__` from the tool name. A dotted form like
    // `nimbalyst-session-naming.update_session_meta` would silently miss those
    // checks and break detection on the app-server transport.
    expect(toolCalls[0].toolCall?.name).toBe('mcp__nimbalyst-session-naming__update_session_meta');

    protocol.cleanupSession(session);
  });

  it('falls back to generic tool_call events for unknown tool-like app-server items', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({ workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    child.emitLine({ id: startReq.id, result: { thread: { id: 't-generic' } } });
    const session = await sessionPromise;

    const events: ProtocolEvent[] = [];
    const collector = (async () => {
      for await (const ev of protocol.sendMessage(session, { content: 'search the web' })) {
        events.push(ev);
      }
    })();

    const turnReq = await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ id: turnReq.id, result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } });

    child.emitLine({
      method: 'item/started',
      params: {
        threadId: 't-generic',
        turnId: 'turn-1',
        item: {
          id: 'web-1',
          type: 'webSearch',
          status: 'inProgress',
          query: 'claude code transcripts',
        },
      },
    });

    child.emitLine({
      method: 'item/completed',
      params: {
        threadId: 't-generic',
        turnId: 'turn-1',
        item: {
          id: 'web-1',
          type: 'webSearch',
          status: 'completed',
          query: 'claude code transcripts',
          result: { hits: 3 },
        },
      },
    });
    child.emitLine({ method: 'turn/completed', params: { threadId: 't-generic', turn: { id: 'turn-1', status: 'completed' } } });

    await collector;

    const toolCalls = events.filter((e) => e.type === 'tool_call');
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].toolCall).toMatchObject({
      id: 'web-1',
      name: 'webSearch',
      arguments: { query: 'claude code transcripts' },
    });
    expect(toolCalls[0].toolCall?.result).toBeUndefined();
    expect(toolCalls[1].toolCall).toMatchObject({
      id: 'web-1',
      name: 'webSearch',
      arguments: { query: 'claude code transcripts' },
      result: {
        success: true,
        result: { hits: 3 },
      },
    });

    protocol.cleanupSession(session);
  });

  it('does not duplicate notifications across multiple sendMessage calls on the same session', async () => {
    const protocol = new CodexAppServerProtocol();
    const sessionPromise = protocol.createSession({ workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    child.emitLine({ id: startReq.id, result: { thread: { id: 't-multi' } } });
    const session = await sessionPromise;

    // Turn 1.
    const events1: ProtocolEvent[] = [];
    const collector1 = (async () => {
      for await (const ev of protocol.sendMessage(session, { content: 'turn 1' })) {
        events1.push(ev);
      }
    })();
    const turnReq1 = await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ id: turnReq1.id, result: { turn: { id: 'turn-1', items: [], status: 'inProgress' } } });
    child.emitLine({ method: 'item/agentMessage/delta', params: { threadId: 't-multi', turnId: 'turn-1', itemId: 'msg-1', delta: 'one' } });
    child.emitLine({ method: 'turn/completed', params: { threadId: 't-multi', turn: { id: 'turn-1', status: 'completed' } } });
    await collector1;
    // Drain so `nextWrittenMatching` picks up turn 2's request rather than
    // re-finding turn 1's (the helper has no cursor and matches the first
    // entry in `writtenLines`).
    child.writtenLines.length = 0;

    // Turn 2 on the same ProtocolSession. If Turn 1's notification handler is
    // still attached, every notification will fan out twice (once into Turn 1's
    // dead queue, once into Turn 2's live queue). The dead one is silently
    // dropped but in the protocol's prior implementation the side-effects --
    // duplicate raw_event entries, duplicate tool_call from a single
    // item/completed -- showed up on Turn 2's stream.
    const events2: ProtocolEvent[] = [];
    const collector2 = (async () => {
      for await (const ev of protocol.sendMessage(session, { content: 'turn 2' })) {
        events2.push(ev);
      }
    })();
    const turnReq2 = await nextWrittenMatching(child, 'turn/start');
    child.emitLine({ id: turnReq2.id, result: { turn: { id: 'turn-2', items: [], status: 'inProgress' } } });
    child.emitLine({ method: 'item/agentMessage/delta', params: { threadId: 't-multi', turnId: 'turn-2', itemId: 'msg-2', delta: 'two' } });
    child.emitLine({ method: 'turn/completed', params: { threadId: 't-multi', turn: { id: 'turn-2', status: 'completed' } } });
    await collector2;

    // Exactly one raw_event per notification on turn 2 (turn/started would be
    // missing here -- we only sent agentMessage/delta + turn/completed).
    const rawEvents2 = events2.filter((e) => e.type === 'raw_event');
    expect(rawEvents2).toHaveLength(2);
    const textEvents2 = events2.filter((e) => e.type === 'text');
    expect(textEvents2).toHaveLength(1);
    expect(textEvents2[0].content).toBe('two');
    // Only one terminating complete on turn 2.
    expect(events2.filter((e) => e.type === 'complete')).toHaveLength(1);

    // Spawn count must still be 1: no extra child for the second turn.
    expect(spawnMock).toHaveBeenCalledTimes(1);

    protocol.cleanupSession(session);
  });

  it('routes file-change approval RPCs through the host binding', async () => {
    const approveFileChange = vi.fn().mockResolvedValue({ decision: 'denied' });
    const protocol = new CodexAppServerProtocol({ host: { approveFileChange } });
    const sessionPromise = protocol.createSession({ workspacePath: '/tmp/ws' });
    const initReq = await nextWrittenMatching(child, 'initialize');
    child.emitLine({ id: initReq.id, result: { codexHome: '/fake', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake/0' } });
    const startReq = await nextWrittenMatching(child, 'thread/start');
    child.emitLine({ id: startReq.id, result: { thread: { id: 't-1' } } });
    await sessionPromise;

    // Server-to-client request: file change approval.
    child.emitLine({
      id: 999,
      method: 'item/fileChange/requestApproval',
      params: { threadId: 't-1', turnId: 'turn-1', itemId: 'call_abc', changes: [] },
    });

    // Wait for the response written back by the protocol.
    await new Promise((r) => setTimeout(r, 20));
    const response = child.writtenLines.find((l) => (l as { id?: unknown }).id === 999);
    expect(response).toBeDefined();
    expect((response as { result?: { decision?: string } }).result?.decision).toBe('denied');
    expect(approveFileChange).toHaveBeenCalledTimes(1);
  });

  it('sends threadId and turnId and waits for interrupt confirmation', async () => {
    const protocol = new CodexAppServerProtocol();
    const { iterator, session } = await createActiveTurn(protocol);
    let releaseConfirmation!: () => void;
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });
    child.scriptResult('turn/interrupt', {}, { after: confirmationGate });

    try {
      let settled = false;
      const resultPromise = protocol.interruptTurn(session).then((result) => {
        settled = true;
        return result;
      });
      const interruptRequest = await nextWrittenMatching(child, 'turn/interrupt');

      expect(interruptRequest.params).toEqual({
        threadId: 'thread-interrupt',
        turnId: 'turn-interrupt',
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);

      releaseConfirmation();
      await expect(resultPromise).resolves.toEqual({ outcome: 'interrupted' });
    } finally {
      await iterator.return?.();
      protocol.cleanupSession(session);
    }
  });

  it('returns failed with the server rejection reason', async () => {
    const protocol = new CodexAppServerProtocol();
    const { iterator, session } = await createActiveTurn(protocol);
    child.scriptInterruptMissingTurnId();

    try {
      await expect(protocol.interruptTurn(session)).resolves.toEqual({
        outcome: 'failed',
        error: expect.stringContaining('missing field `turnId`'),
      });
    } finally {
      await iterator.return?.();
      protocol.cleanupSession(session);
    }
  });

  it('returns already-ended without a request when there is no active turn', async () => {
    child
      .scriptResult('initialize', {
        codexHome: '/fake',
        platformFamily: 'unix',
        platformOs: 'macos',
        userAgent: 'fake/0',
      })
      .scriptResult('thread/start', { thread: { id: 'thread-ended' } })
      .scriptResult('turn/interrupt', {});
    const protocol = new CodexAppServerProtocol();
    const session = await protocol.createSession({ workspacePath: '/tmp/ws' });

    try {
      await expect(protocol.interruptTurn(session)).resolves.toEqual({
        outcome: 'already-ended',
      });
      expect(child.requests('turn/interrupt')).toHaveLength(0);
    } finally {
      protocol.cleanupSession(session);
    }
  });

  it('ignores retrying errors and resolves when the active turn ends before confirmation', async () => {
    const protocol = new CodexAppServerProtocol();
    const { iterator, session } = await createActiveTurn(protocol);
    let releaseConfirmation!: () => void;
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });
    child.scriptResult('turn/interrupt', {}, { after: confirmationGate });
    let resultPromise: ReturnType<CodexAppServerProtocol['interruptTurn']> | undefined;

    try {
      let settled = false;
      resultPromise = protocol.interruptTurn(session).then((result) => {
        settled = true;
        return result;
      });
      await nextWrittenMatching(child, 'turn/interrupt');

      child.emitError({
        threadId: 'thread-interrupt',
        turnId: 'turn-interrupt',
        error: { message: 'temporary transport error' },
        willRetry: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);

      child.emitTurnCompleted({
        threadId: 'thread-interrupt',
        turn: { id: 'turn-interrupt', status: 'completed' },
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(true);
      await expect(resultPromise).resolves.toEqual({ outcome: 'already-ended' });
    } finally {
      releaseConfirmation();
      await resultPromise?.catch(() => undefined);
      await iterator.return?.();
      protocol.cleanupSession(session);
    }
  });

  it('keeps abortSession void while sending an interrupt request with both ids', async () => {
    const protocol = new CodexAppServerProtocol();
    const { iterator, session } = await createActiveTurn(protocol);
    child.scriptResult('turn/interrupt', {});

    try {
      expect(protocol.abortSession(session)).toBeUndefined();
      const interruptRequest = await nextWrittenMatching(child, 'turn/interrupt');
      expect(interruptRequest.id).toBeDefined();
      expect(interruptRequest.params).toEqual({
        threadId: 'thread-interrupt',
        turnId: 'turn-interrupt',
      });
    } finally {
      await iterator.return?.();
      protocol.cleanupSession(session);
    }
  });

  it('uses the waitable interrupt request for an aborted sendMessage turn', async () => {
    const abortController = new AbortController();
    abortController.abort();
    child
      .scriptResult('initialize', {
        codexHome: '/fake',
        platformFamily: 'unix',
        platformOs: 'macos',
        userAgent: 'fake/0',
      })
      .scriptResult('thread/start', { thread: { id: 'thread-signal' } })
      .scriptResult('turn/start', {
        turn: { id: 'turn-signal', items: [], status: 'inProgress' },
      })
      .scriptResult('turn/interrupt', {})
      .scriptResult('turn/interrupt', {});
    const protocol = new CodexAppServerProtocol();
    const session = await protocol.createSession({
      workspacePath: '/tmp/ws',
      abortSignal: abortController.signal,
    } as never);
    const collector = (async () => {
      for await (const _event of protocol.sendMessage(session, { content: 'stop now' })) {
        // Drain the turn so sendMessage runs its normal terminal cleanup.
      }
    })();

    try {
      const interruptRequest = await nextWrittenMatching(child, 'turn/interrupt');
      expect(interruptRequest.params).toEqual({
        threadId: 'thread-signal',
        turnId: 'turn-signal',
      });
    } finally {
      child.emitTurnCompleted({
        threadId: 'thread-signal',
        turn: { id: 'turn-signal', status: 'completed' },
      });
      await collector;
      protocol.cleanupSession(session);
    }
  });

  it('returns failed when the matching terminal event reports a turn failure', async () => {
    const protocol = new CodexAppServerProtocol();
    const { iterator, session } = await createActiveTurn(protocol);
    let releaseConfirmation!: () => void;
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });
    child.scriptResult('turn/interrupt', {}, { after: confirmationGate });
    const resultPromise = protocol.interruptTurn(session);

    try {
      await nextWrittenMatching(child, 'turn/interrupt');
      child.emitTurnCompleted({
        threadId: 'thread-interrupt',
        turn: {
          id: 'turn-interrupt',
          status: 'failed',
          error: { message: 'turn stopped with an error' },
        },
      });
      await expect(resultPromise).resolves.toEqual({
        outcome: 'failed',
        error: 'turn stopped with an error',
      });
    } finally {
      releaseConfirmation();
      await resultPromise.catch(() => undefined);
      await iterator.return?.();
      protocol.cleanupSession(session);
    }
  });

  it('returns failed for a non-retrying error on the active turn', async () => {
    const protocol = new CodexAppServerProtocol();
    const { iterator, session } = await createActiveTurn(protocol);
    let releaseConfirmation!: () => void;
    const confirmationGate = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });
    child.scriptResult('turn/interrupt', {}, { after: confirmationGate });
    const resultPromise = protocol.interruptTurn(session);

    try {
      await nextWrittenMatching(child, 'turn/interrupt');
      child.emitError({
        threadId: 'thread-interrupt',
        turnId: 'turn-interrupt',
        error: { message: 'fatal app-server error' },
        willRetry: false,
      });
      const observedResult = await Promise.race([
        resultPromise,
        new Promise<{ outcome: 'not-settled' }>((resolve) => {
          setTimeout(() => resolve({ outcome: 'not-settled' }), 20);
        }),
      ]);
      expect(observedResult).toEqual({
        outcome: 'failed',
        error: 'fatal app-server error',
      });
    } finally {
      releaseConfirmation();
      await resultPromise.catch(() => undefined);
      await iterator.return?.();
      protocol.cleanupSession(session);
    }
  });
});

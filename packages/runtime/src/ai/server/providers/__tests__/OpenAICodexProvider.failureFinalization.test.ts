// 施工单 GS 完整十二项行为验收测试
// 验证 Codex 失败收尾，不再追加起名请求
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICodexProvider } from '../OpenAICodexProvider';
import { AgentMessagesRepository } from '../../../../storage/repositories/AgentMessagesRepository';
import { AISessionsRepository } from '../../../../storage/repositories/AISessionsRepository';
import type { ProtocolEvent, ProtocolSession } from '../../protocols/ProtocolInterface';

afterEach(() => {
  OpenAICodexProvider.setSessionNamingServerPort(null);
  OpenAICodexProvider.setTrustChecker(null);
  AgentMessagesRepository.clearStore();
  AISessionsRepository.clearStore();
});

function setupCommonEnvironment() {
  OpenAICodexProvider.setTrustChecker(() => ({ trusted: true, mode: 'allow-all' }));
  OpenAICodexProvider.setSessionNamingServerPort(3457);
  AgentMessagesRepository.setStore({
    async create() {},
    async list() { return []; },
    async getMessageCounts() { return new Map(); },
  });
}

function countRequests(requests: string[]) {
  const mainRequests = requests.filter(r => !r.includes('update_session_meta')).length;
  const helperRequests = requests.filter(r => r.includes('update_session_meta')).length;
  return { mainRequests, helperRequests, total: requests.length };
}

describe('OpenAICodexProvider failure finalization (13 项完整行为验收)', () => {
  // 1 原故障：明确的终止错误，使用原 404 文本：主请求 1，辅助请求 0；对外仍有原错误。旧代码红，修复后绿。
  it('项 1 原故障：404 错误后停止，主请求 1，辅助请求 0，对外暴露原错误', async () => {
    setupCommonEnvironment();
    const requests: string[] = [];
    const sessionId = 'session-item-1-failure';
    const fake404 = 'unexpected status 404 Not Found: The model `gpt-5.5` does not exist or you do not have access to it.';

    const protocol = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-1', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requests.push(message.content);
        yield { type: 'error', error: fake404 } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    const chunks = [];
    try {
      for await (const chunk of provider.sendMessage('[GP-PROMPT-1]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunks.push(chunk);
      }
      const counts = countRequests(requests);
      const errorChunk = chunks.find(c => c.type === 'error');
      console.log(JSON.stringify({
        itemIndex: 1,
        itemName: '原故障',
        sessionId,
        mainRequests: counts.mainRequests,
        helperRequests: counts.helperRequests,
        originalError: errorChunk?.error,
        endState: 'error',
        eventsCount: chunks.length,
      }));

      expect(counts.mainRequests).toBe(1);
      expect(counts.helperRequests).toBe(0);
      expect(requests).toHaveLength(1);
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.error).toContain('404');
    } finally {
      provider.destroy();
    }
  });

  // 2 部分输出后失败：先有文本再报终止错误：不因“已经有文字”追加起名，辅助 0，错误不被吞。
  it('项 2 部分输出后失败：先输出文字再报错，辅助请求 0，文字与错误均正常输出', async () => {
    setupCommonEnvironment();
    const requests: string[] = [];
    const sessionId = 'session-item-2-partial';
    const fakeError = 'stream disconnected abruptly after partial text';

    const protocol = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-2', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requests.push(message.content);
        yield { type: 'text', content: 'Partial generated thoughts.' } as ProtocolEvent;
        yield { type: 'error', error: fakeError } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    const chunks = [];
    try {
      for await (const chunk of provider.sendMessage('[GP-PROMPT-2]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunks.push(chunk);
      }
      const counts = countRequests(requests);
      const textChunk = chunks.find(c => c.type === 'text');
      const errorChunk = chunks.find(c => c.type === 'error');
      console.log(JSON.stringify({
        itemIndex: 2,
        itemName: '部分输出后失败',
        sessionId,
        mainRequests: counts.mainRequests,
        helperRequests: counts.helperRequests,
        originalError: errorChunk?.error,
        endState: 'partial_then_error',
        eventsCount: chunks.length,
      }));

      expect(textChunk).toBeDefined();
      expect(textChunk?.content).toBe('Partial generated thoughts.');
      expect(errorChunk).toBeDefined();
      expect(errorChunk?.error).toBe(fakeError);
      expect(counts.mainRequests).toBe(1);
      expect(counts.helperRequests).toBe(0);
      expect(requests).toHaveLength(1);
    } finally {
      provider.destroy();
    }
  });

  // 3 异常断流：外部发送抛异常：辅助 0；原有清理成立，下一次显式发送不因旧活动状态被锁住。
  it('项 3 异常断流：协议发送抛异常后辅助 0，且下次显式发送不被锁', async () => {
    setupCommonEnvironment();
    const requests: string[] = [];
    const sessionId = 'session-item-3-exception';
    let shouldThrow = true;

    const protocol = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-3', platform: 'codex-app-server', raw: {} }; },
      async resumeSession(id: string) { return { id, platform: 'codex-app-server', raw: {} }; },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requests.push(message.content);
        if (shouldThrow) {
          throw new Error('network connection crashed mid-stream');
        } else {
          yield { type: 'complete', content: 'Second turn successful', usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } as ProtocolEvent;
        }
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    const chunksTurn1 = [];
    try {
      // 第一回合：抛异常
      for await (const chunk of provider.sendMessage('[TURN-1-FAIL]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunksTurn1.push(chunk);
      }
      const counts1 = countRequests(requests);
      const err1 = chunksTurn1.find(c => c.type === 'error');
      expect(err1?.error).toContain('network connection crashed');
      expect(counts1.mainRequests).toBe(1);
      expect(counts1.helperRequests).toBe(0);

      // 第二回合：再次显式发送，检查不会因旧活动状态被锁死
      shouldThrow = false;
      const chunksTurn2 = [];
      for await (const chunk of provider.sendMessage('[TURN-2-RETRY]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunksTurn2.push(chunk);
      }
      const counts2 = countRequests(requests);
      const complete2 = chunksTurn2.find(c => c.type === 'complete');
      expect(complete2).toBeDefined();

      console.log(JSON.stringify({
        itemIndex: 3,
        itemName: '异常断流',
        sessionId,
        mainRequests: counts2.mainRequests,
        helperRequests: counts2.helperRequests,
        originalError: err1?.error,
        endState: 'exception_recovered_on_retry',
        eventsCount: chunksTurn1.length + chunksTurn2.length,
      }));
    } finally {
      provider.destroy();
    }
  });

  // 4 未完成就结束：空流或有文字但无明确成功终态：辅助 0，不伪造成功或生成空标题。此项须有独立红转绿证据。
  it('项 4 未完成就结束：空流或有文字但无 complete，辅助 0', async () => {
    setupCommonEnvironment();
    const requestsA: string[] = [];
    const sessionIdA = 'session-item-4-empty';

    // 4a: 空流
    const protocolA = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-4a', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requestsA.push(message.content);
        // 空流：不 yield 任何事件直接结束
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionServiceA = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const providerA = new OpenAICodexProvider({}, { protocol: protocolA, permissionService: permissionServiceA, transport: 'app-server' } as never);
    await providerA.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const chunksA = [];
      for await (const chunk of providerA.sendMessage('[PROMPT-EMPTY]', undefined, sessionIdA, [], '/tmp/gp-fake')) {
        chunksA.push(chunk);
      }
      const countsA = countRequests(requestsA);
      expect(countsA.mainRequests).toBe(1);
      expect(countsA.helperRequests).toBe(0);
      expect(requestsA).toHaveLength(1);

      console.log(JSON.stringify({
        itemIndex: 4,
        itemName: '未完成就结束-空流',
        sessionId: sessionIdA,
        mainRequests: countsA.mainRequests,
        helperRequests: countsA.helperRequests,
        originalError: null,
        endState: 'empty_stream',
        eventsCount: chunksA.length,
      }));
    } finally {
      providerA.destroy();
    }

    // 4b: 有文字但无 complete 终态
    const requestsB: string[] = [];
    const sessionIdB = 'session-item-4-text-no-complete';
    const protocolB = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-4b', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requestsB.push(message.content);
        yield { type: 'text', content: 'Incomplete thoughts...' } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionServiceB = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const providerB = new OpenAICodexProvider({}, { protocol: protocolB, permissionService: permissionServiceB, transport: 'app-server' } as never);
    await providerB.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const chunksB = [];
      for await (const chunk of providerB.sendMessage('[PROMPT-NO-COMPLETE]', undefined, sessionIdB, [], '/tmp/gp-fake')) {
        chunksB.push(chunk);
      }
      const countsB = countRequests(requestsB);
      expect(countsB.mainRequests).toBe(1);
      expect(countsB.helperRequests).toBe(0);
      expect(requestsB).toHaveLength(1);

      console.log(JSON.stringify({
        itemIndex: 4,
        itemName: '未完成就结束-无complete',
        sessionId: sessionIdB,
        mainRequests: countsB.mainRequests,
        helperRequests: countsB.helperRequests,
        originalError: null,
        endState: 'text_without_complete',
        eventsCount: chunksB.length,
      }));
    } finally {
      providerB.destroy();
    }
  });

  // 5 真实取消入口：从实际公开停止/取消入口中断在途回合：辅助 0；真实中断调用发生，回合可结束；不只在测试里给布尔值赋值。
  it('项 5 真实取消入口：调用 cancelStream/interruptCurrentTurn 中断在途流，真实中断调用发生，辅助 0 且流正常终止', async () => {
    setupCommonEnvironment();
    const requests: string[] = [];
    const sessionId = 'session-item-5-cancel';

    const interruptTurnMock = vi.fn(async () => ({
      method: 'interrupt' as const,
      outcome: 'interrupted' as const,
    }));

    const protocol = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-5', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      interruptTurn: interruptTurnMock,
      async *sendMessage(_session: unknown, message: { content: string }) {
        requests.push(message.content);
        yield { type: 'text', content: 'Streaming in progress chunk 1...' } as ProtocolEvent;
        yield { type: 'text', content: 'Streaming in progress chunk 2...' } as ProtocolEvent;
        yield { type: 'complete', content: 'Should not reach completion if cancelled' } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const iterator = provider.sendMessage('[PROMPT-CANCEL]', undefined, sessionId, [], '/tmp/gp-fake');
      const firstChunk = await iterator.next();
      expect(firstChunk.value?.type).toBe('text');

      // 1. 调用真实公开中断入口：验证真实底层中断调用发生
      const interruptRes = await provider.interruptCurrentTurn();
      if (interruptRes.method === 'interrupt') {
        expect(interruptRes.outcome).toBe('interrupted');
      } else {
        expect(interruptRes.method).toBe('abort');
      }
      expect(interruptTurnMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'thread-item-5' }));

      // 2. 调用真实公开取消入口：中断流
      await provider.cancelStream(sessionId);

      // 3. 消费后续流，回合正常结束且不再继续派发起名
      const subsequentChunks = [];
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        subsequentChunks.push(next.value);
      }

      const counts = countRequests(requests);
      console.log(JSON.stringify({
        itemIndex: 5,
        itemName: '真实取消入口',
        sessionId,
        mainRequests: counts.mainRequests,
        helperRequests: counts.helperRequests,
        interruptCalled: interruptTurnMock.mock.calls.length,
        originalError: 'cancelled',
        endState: 'cancelled',
        eventsCount: 1 + subsequentChunks.length,
      }));

      expect(counts.mainRequests).toBe(1);
      expect(counts.helperRequests).toBe(0);
      expect(requests).toHaveLength(1);
      expect(interruptTurnMock).toHaveBeenCalled();
    } finally {
      provider.destroy();
    }
  });

  // 6 失败不可被后续标记洗绿：终止错误后又收到完成标记，及完成标记后又收到终止错误：均不追加起名。测试需消费完整流，不能只断言第一个事件。
  it('项 6 失败不可被后续标记洗绿：错误与完成混合时均不追加起名', async () => {
    setupCommonEnvironment();

    // 6a: error 后收到 complete
    const requestsA: string[] = [];
    const sessionIdA = 'session-item-6a-error-then-complete';
    const protocolA = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-6a', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requestsA.push(message.content);
        yield { type: 'error', error: 'early fatal error' } as ProtocolEvent;
        yield { type: 'complete', content: 'late complete attempt' } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };
    const permissionServiceA = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const providerA = new OpenAICodexProvider({}, { protocol: protocolA, permissionService: permissionServiceA, transport: 'app-server' } as never);
    await providerA.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const chunksA = [];
      for await (const chunk of providerA.sendMessage('[PROMPT-6A]', undefined, sessionIdA, [], '/tmp/gp-fake')) {
        chunksA.push(chunk);
      }
      const countsA = countRequests(requestsA);
      expect(countsA.mainRequests).toBe(1);
      expect(countsA.helperRequests).toBe(0);
      console.log(JSON.stringify({
        itemIndex: 6,
        itemName: '失败不可被洗绿-先错后完成',
        sessionId: sessionIdA,
        mainRequests: countsA.mainRequests,
        helperRequests: countsA.helperRequests,
        originalError: 'early fatal error',
        endState: 'error_then_complete',
        eventsCount: chunksA.length,
      }));
    } finally {
      providerA.destroy();
    }

    // 6b: complete 后收到 error
    const requestsB: string[] = [];
    const sessionIdB = 'session-item-6b-complete-then-error';
    const protocolB = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-6b', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requestsB.push(message.content);
        yield { type: 'complete', content: 'premature complete' } as ProtocolEvent;
        yield { type: 'error', error: 'post-complete error' } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };
    const permissionServiceB = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const providerB = new OpenAICodexProvider({}, { protocol: protocolB, permissionService: permissionServiceB, transport: 'app-server' } as never);
    await providerB.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const chunksB = [];
      for await (const chunk of providerB.sendMessage('[PROMPT-6B]', undefined, sessionIdB, [], '/tmp/gp-fake')) {
        chunksB.push(chunk);
      }
      const countsB = countRequests(requestsB);
      expect(countsB.mainRequests).toBe(1);
      expect(countsB.helperRequests).toBe(0);
      console.log(JSON.stringify({
        itemIndex: 6,
        itemName: '失败不可被洗绿-先完成出租',
        sessionId: sessionIdB,
        mainRequests: countsB.mainRequests,
        helperRequests: countsB.helperRequests,
        originalError: 'post-complete error',
        endState: 'complete_then_error',
        eventsCount: chunksB.length,
      }));
    } finally {
      providerB.destroy();
    }
  });

  // 7 正常成功：明确成功、首回合、有命名服务、未调用命名工具：主请求 1、辅助恰好 1；原正常对照仍绿。不能为修失败而关闭全部自动命名。
  it('项 7 正常成功：明确成功且满足条件，主请求 1，辅助恰好 1', async () => {
    setupCommonEnvironment();
    const requests: string[] = [];
    const sessionId = 'session-item-7-success';

    const protocol = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-7', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requests.push(message.content);
        yield {
          type: 'complete',
          content: 'Normal complete response',
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const chunks = [];
      for await (const chunk of provider.sendMessage('[GP-NORMAL-CONTROL]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunks.push(chunk);
      }
      const counts = countRequests(requests);
      console.log(JSON.stringify({
        itemIndex: 7,
        itemName: '正常成功',
        sessionId,
        mainRequests: counts.mainRequests,
        helperRequests: counts.helperRequests,
        originalError: null,
        endState: 'success',
        eventsCount: chunks.length,
      }));

      expect(counts.mainRequests).toBe(1);
      expect(counts.helperRequests).toBe(1);
      expect(requests).toHaveLength(2);
    } finally {
      provider.destroy();
    }
  });

  // 8 已起名与恢复会话：本回合已用命名工具，或确为恢复旧会话：分别辅助 0，保留现有行为。
  it('项 8 已起名与恢复会话：已用起名工具或恢复旧会话时辅助 0', async () => {
    setupCommonEnvironment();

    // 8a: 本回合已使用 naming tool
    const requestsA: string[] = [];
    const sessionIdA = 'session-item-8a-named';
    const protocolA = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-8a', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requestsA.push(message.content);
        yield {
          type: 'tool_call',
          toolCall: { id: 'call_1', name: 'mcp__nimbalyst-session-naming__update_session_meta', arguments: { title: 'Explicit Title' } },
        } as ProtocolEvent;
        yield {
          type: 'complete',
          content: 'I have named the session.',
        } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };
    const permissionServiceA = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const providerA = new OpenAICodexProvider({}, { protocol: protocolA, permissionService: permissionServiceA, transport: 'app-server' } as never);
    await providerA.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const chunksA = [];
      for await (const chunk of providerA.sendMessage('[PROMPT-8A]', undefined, sessionIdA, [], '/tmp/gp-fake')) {
        chunksA.push(chunk);
      }
      const countsA = countRequests(requestsA);
      expect(countsA.mainRequests).toBe(1);
      expect(countsA.helperRequests).toBe(0);
      console.log(JSON.stringify({
        itemIndex: 8,
        itemName: '已起名',
        sessionId: sessionIdA,
        mainRequests: countsA.mainRequests,
        helperRequests: countsA.helperRequests,
        originalError: null,
        endState: 'naming_tool_used',
        eventsCount: chunksA.length,
      }));
    } finally {
      providerA.destroy();
    }

    // 8b: 确为恢复旧会话
    const requestsB: string[] = [];
    const sessionIdB = 'session-item-8b-resumed';
    const protocolB = {
      platform: 'codex-app-server',
      async createSession() { throw new Error('unexpected create'); },
      async resumeSession(id: string) { return { id, platform: 'codex-app-server', raw: {} }; },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requestsB.push(message.content);
        yield { type: 'complete', content: 'Resumed response' } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };
    const permissionServiceB = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const providerB = new OpenAICodexProvider({}, { protocol: protocolB, permissionService: permissionServiceB, transport: 'app-server' } as never);
    await providerB.initialize({ model: 'openai-codex:gpt-5.5' });

    // 预置已有 session ID 标记为恢复旧会话
    (providerB as any).sessions.captureSessionId(sessionIdB, 'persisted-thread-old');

    try {
      const chunksB = [];
      for await (const chunk of providerB.sendMessage('[PROMPT-8B]', undefined, sessionIdB, [], '/tmp/gp-fake')) {
        chunksB.push(chunk);
      }
      const countsB = countRequests(requestsB);
      expect(countsB.mainRequests).toBe(1);
      expect(countsB.helperRequests).toBe(0);
      console.log(JSON.stringify({
        itemIndex: 8,
        itemName: '恢复旧会话',
        sessionId: sessionIdB,
        mainRequests: countsB.mainRequests,
        helperRequests: countsB.helperRequests,
        originalError: null,
        endState: 'resumed_thread',
        eventsCount: chunksB.length,
      }));
    } finally {
      providerB.destroy();
    }
  });

  // 9 起名自身失败：正常主回合后唯一一次辅助请求失败：不得递归、重发第三次，不能把主回合成功改写成失败或丢掉正文。
  it('项 9 起名自身失败：辅助请求失败不递归、不改写主回合成功状态、不丢弃正文', async () => {
    setupCommonEnvironment();
    const requests: string[] = [];
    const sessionId = 'session-item-9-helper-failure';
    let turnCount = 0;

    const protocol = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-9', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        turnCount++;
        requests.push(message.content);
        if (turnCount === 1) {
          // 主回合：正常成功并产出正文
          yield { type: 'text', content: 'Primary turn answer text.' } as ProtocolEvent;
          yield { type: 'complete', content: 'Primary turn answer text.' } as ProtocolEvent;
        } else {
          // 辅助起名回合：报错崩溃
          throw new Error('naming helper internal 500 failure');
        }
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const chunks = [];
      for await (const chunk of provider.sendMessage('[PROMPT-9]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunks.push(chunk);
      }
      const counts = countRequests(requests);
      const textChunk = chunks.find(c => c.type === 'text');
      const completeChunk = chunks.find(c => c.type === 'complete');
      const errorChunk = chunks.find(c => c.type === 'error');

      console.log(JSON.stringify({
        itemIndex: 9,
        itemName: '起名自身失败',
        sessionId,
        mainRequests: counts.mainRequests,
        helperRequests: counts.helperRequests,
        originalError: null,
        endState: 'main_success_helper_failed',
        eventsCount: chunks.length,
      }));

      // 验证：主请求 1，辅助仅 1 次，没有第 3 次递归
      expect(counts.mainRequests).toBe(1);
      expect(counts.helperRequests).toBe(1);
      expect(requests).toHaveLength(2);

      // 主回合正文与 complete 完整保留，且对外不暴露 error chunk
      expect(textChunk?.content).toBe('Primary turn answer text.');
      expect(completeChunk).toBeDefined();
      expect(errorChunk).toBeUndefined();
    } finally {
      provider.destroy();
    }
  });

  // 10 暂时重连后成功：协议已转换的 retrying 事件随后成功：不误判为最终失败，正常起名规则仍成立。终止错误与重连事件必须分开。
  it('项 10 暂时重连后成功：retrying 事件不作为终止错误，随后 complete 正常追加起名', async () => {
    setupCommonEnvironment();
    const requests: string[] = [];
    const sessionId = 'session-item-10-retrying';

    const protocol = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'thread-item-10', platform: 'codex-app-server', raw: {} }; },
      async resumeSession() { throw new Error('unexpected resume'); },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(_session: unknown, message: { content: string }) {
        requests.push(message.content);
        // 先产生协议转换后的 retrying 事件
        yield {
          type: 'retrying',
          metadata: { transport: 'app-server', lastError: 'reconnecting transient network', retryCount: 1 },
        } as ProtocolEvent;
        yield { type: 'text', content: 'Eventual response text.' } as ProtocolEvent;
        yield { type: 'complete', content: 'Eventual response text.' } as ProtocolEvent;
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      const chunks = [];
      for await (const chunk of provider.sendMessage('[PROMPT-10]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunks.push(chunk);
      }
      const counts = countRequests(requests);
      console.log(JSON.stringify({
        itemIndex: 10,
        itemName: '暂时重连后成功',
        sessionId,
        mainRequests: counts.mainRequests,
        helperRequests: counts.helperRequests,
        originalError: null,
        endState: 'retrying_then_success',
        eventsCount: chunks.length,
      }));

      expect(counts.mainRequests).toBe(1);
      expect(counts.helperRequests).toBe(1);
      expect(requests).toHaveLength(2);
    } finally {
      provider.destroy();
    }
  });

  // 11 后续显式重试：首回合失败后，用户在同一 Nimbalyst 会话显式续发：允许新主请求；保留原引擎会话标识和旧记录，不自动新建会话冒充恢复。是否追加起名仍按既有首回合规则。
  it('项 11 后续显式重试：首回合失败后同会话续发，保留引擎会话，且第二回合不误发起名', async () => {
    setupCommonEnvironment();
    const requests: string[] = [];
    const sessionId = 'session-item-11-explicit-retry';
    let turn = 0;
    let threadIdPassedToSendMessage: string | null = null;

    const protocol = {
      platform: 'codex-app-server',
      async createSession() { return { id: 'engine-thread-stable-11', platform: 'codex-app-server', raw: {} }; },
      async resumeSession(id: string) { return { id, platform: 'codex-app-server', raw: {} }; },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(session: ProtocolSession, message: { content: string }) {
        turn++;
        threadIdPassedToSendMessage = session.id;
        requests.push(message.content);
        if (turn === 1) {
          yield { type: 'error', error: '404 Not Found' } as ProtocolEvent;
        } else {
          yield { type: 'complete', content: 'Turn 2 success' } as ProtocolEvent;
        }
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      // 第一回合：失败
      const chunks1 = [];
      for await (const chunk of provider.sendMessage('[TURN-1]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunks1.push(chunk);
      }
      expect(requests).toHaveLength(1);
      expect(threadIdPassedToSendMessage).toBe('engine-thread-stable-11');

      // 第二回合：在同一 sessionId 显式续发
      const chunks2 = [];
      for await (const chunk of provider.sendMessage('[TURN-2-EXPLICIT]', undefined, sessionId, [], '/tmp/gp-fake')) {
        chunks2.push(chunk);
      }
      expect(threadIdPassedToSendMessage).toBe('engine-thread-stable-11');

      const counts = countRequests(requests);
      console.log(JSON.stringify({
        itemIndex: 11,
        itemName: '后续显式重试',
        sessionId,
        mainRequests: counts.mainRequests,
        helperRequests: counts.helperRequests,
        originalError: '404 Not Found',
        endState: 'explicit_retry_completed',
        eventsCount: chunks1.length + chunks2.length,
      }));

      // 验证：总共发起 2 个主请求，0 个辅助请求（因第二回合是 resumed thread）
      expect(counts.mainRequests).toBe(2);
      expect(counts.helperRequests).toBe(0);
      expect(requests).toHaveLength(2);
    } finally {
      provider.destroy();
    }
  });

  // 12 会话互不污染：两个会话分别失败和成功、同一实例不同回合：失败标记不能串给另一会话/下一回合；请求数、正文和清理逐一对账。
  it('项 12 会话互不污染：同实例下 Session A 失败不污染 Session B 成功与起名', async () => {
    setupCommonEnvironment();
    const requestsA: string[] = [];
    const requestsB: string[] = [];
    const sessionIdA = 'session-item-12-fail';
    const sessionIdB = 'session-item-12-success';

    const protocol = {
      platform: 'codex-app-server',
      async createSession(opts: { workspacePath?: string }) {
        const id = opts?.workspacePath?.includes('session-b') ? 'thread-b' : 'thread-a';
        return { id, platform: 'codex-app-server', raw: {} };
      },
      async resumeSession(id: string) { return { id, platform: 'codex-app-server', raw: {} }; },
      async forkSession() { throw new Error('unexpected fork'); },
      async *sendMessage(session: ProtocolSession, message: { content: string }) {
        if (session.id === 'thread-a') {
          requestsA.push(message.content);
          yield { type: 'error', error: 'Session A failed with 404' } as ProtocolEvent;
        } else {
          requestsB.push(message.content);
          yield { type: 'complete', content: 'Session B completed fine' } as ProtocolEvent;
        }
      },
      abortSession: vi.fn(),
      cleanupSession: vi.fn(),
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      // 1. Session A 失败
      const chunksA = [];
      for await (const chunk of provider.sendMessage('[MSG-A]', undefined, sessionIdA, [], '/tmp/session-a')) {
        chunksA.push(chunk);
      }
      const countsA = countRequests(requestsA);
      expect(countsA.mainRequests).toBe(1);
      expect(countsA.helperRequests).toBe(0);

      // 2. Session B 成功（必须正常获得 1 次辅助起名，不受 Session A 失败污染）
      const chunksB = [];
      for await (const chunk of provider.sendMessage('[MSG-B]', undefined, sessionIdB, [], '/tmp/session-b')) {
        chunksB.push(chunk);
      }
      const countsB = countRequests(requestsB);
      expect(countsB.mainRequests).toBe(1);
      expect(countsB.helperRequests).toBe(1);

      console.log(JSON.stringify({
        itemIndex: 12,
        itemName: '会话互不污染',
        sessionA: { id: sessionIdA, mainRequests: countsA.mainRequests, helperRequests: countsA.helperRequests },
        sessionB: { id: sessionIdB, mainRequests: countsB.mainRequests, helperRequests: countsB.helperRequests },
        originalError: 'Session A failed with 404',
        endState: 'session_a_failed_session_b_succeeded_isolated',
      }));
    } finally {
      provider.destroy();
    }
  });

  // 13 辅助失败后的下一句：同一实例、同一会话：主回合先成功，唯一一次起名失败；分别覆盖抛异常与终止错误。模拟需重新连接的故障，随后只发送一次用户新消息。已成功正文和终态保留，原 thread 不变，坏连接不再复用，下一句成功，命名累计仍仅 1 次、无自动重发主请求；另一会话不受清理影响。保持异常原文可查。
  it('项 13a 辅助失败后的下一句（抛异常）：起名抛出异常后保住正文与成功终态，坏连接被清理，下一次用户续聊恢复原 thread 并成功，另一会话不受影响', async () => {
    setupCommonEnvironment();
    const calls: Array<{ session: string; thread: string; connection: number; kind: string }> = [];
    let generation = 0;
    const sessionId = 'session-item-13a-crash';
    const otherSessionId = 'session-item-13a-other';

    const createSession = vi.fn(async (opts: { workspacePath?: string }) => {
      const isOther = opts?.workspacePath?.includes('other');
      return {
        id: isOther ? 'thread-13a-other' : 'thread-13a-stable',
        platform: 'codex-app-server',
        raw: { generation: ++generation, dead: false, isOther },
      };
    });
    const resumeSession = vi.fn(async (id: string) => ({
      id,
      platform: 'codex-app-server',
      raw: { generation: ++generation, dead: false },
    }));
    const cleanupSession = vi.fn();
    const originalErrorMsg = 'Codex child exited during naming (simulated 13a crash)';

    const protocol = {
      platform: 'codex-app-server',
      createSession,
      resumeSession,
      cleanupSession,
      abortSession: vi.fn(),
      async *sendMessage(session: any, message: { content: string }) {
        const isHelper = message.content.includes('update_session_meta');
        const sessName = session.raw.isOther ? 'other' : 'main';
        calls.push({
          session: sessName,
          thread: session.id,
          connection: session.raw.generation,
          kind: isHelper ? 'helper' : 'main',
        });
        if (session.raw.dead) {
          throw new Error('JsonRpcClient closed: child exited');
        }
        if (isHelper && !session.raw.isOther) {
          session.raw.dead = true;
          throw new Error(originalErrorMsg);
        }
        yield { type: 'text', content: `${sessName} answer preserved` } as ProtocolEvent;
        yield { type: 'complete', content: `${sessName} answer preserved` } as ProtocolEvent;
      },
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      // 1. 初始化 otherSession，确保其连接正常建立
      const otherChunks = [];
      for await (const c of provider.sendMessage('other-msg', undefined, otherSessionId, [], '/tmp/13a-other')) {
        otherChunks.push(c);
      }
      expect(otherChunks.some(c => c.type === 'complete')).toBe(true);
      const otherCleanedBefore = cleanupSession.mock.calls.length;

      // 2. 主会话第一回合：主回合成功，起名时抛异常
      const firstChunks = [];
      for await (const c of provider.sendMessage('first-msg', undefined, sessionId, [], '/tmp/13a-main')) {
        firstChunks.push(c);
      }

      // 验证第一回合：正文与成功终态保留，对外不发错误
      expect(firstChunks.some(c => c.type === 'error'), '第一回合不应包含 error 事件').toBe(false);
      expect(firstChunks.some(c => c.type === 'complete'), '第一回合应包含 complete 事件').toBe(true);
      const firstTextChunk = firstChunks.find(c => c.type === 'text');
      expect(firstTextChunk?.content).toBe('main answer preserved');

      // 验证坏连接已清理：cleanupSession 增加 1 次（针对坏连接），而 otherSession 未受影响
      const cleanedBeforeNext = cleanupSession.mock.calls.length;
      expect(cleanedBeforeNext - otherCleanedBefore, '主会话起名抛异常后应清理 1 次').toBe(1);

      // 3. 主会话第二回合：用户显式续聊
      const nextChunks = [];
      for await (const c of provider.sendMessage('explicit-next', undefined, sessionId, [], '/tmp/13a-main')) {
        nextChunks.push(c);
      }

      // 验证第二回合：不撞死亡连接，正文与完成正常产出
      expect(nextChunks.some(c => c.type === 'error'), '第二回合不应撞死亡连接').toBe(false);
      expect(nextChunks.some(c => c.type === 'complete'), '第二回合应正常完成').toBe(true);

      // 验证恢复行为：使用原 thread 标识 resumeSession，createSession 仅调用过最开始的次数
      expect(resumeSession).toHaveBeenCalledWith('thread-13a-stable', expect.anything());
      const mainSessCalls = calls.filter(c => c.session === 'main');
      expect(mainSessCalls).toHaveLength(3); // turn1 main, turn1 helper, turn2 main
      expect(mainSessCalls[0].connection).toBe(mainSessCalls[1].connection); // turn1 和 helper 使用 connection 1
      expect(mainSessCalls[2].connection).not.toBe(mainSessCalls[0].connection); // turn2 使用新 connection

      // 命名累计仅 1 次（第二回合未发辅助起名）
      const helperCalls = mainSessCalls.filter(c => c.kind === 'helper');
      expect(helperCalls).toHaveLength(1);

      // 无自动重发主请求（第二回合显式发送恰对应 1 个主请求）
      const turn2MainCalls = mainSessCalls.filter(c => c.kind === 'main');
      expect(turn2MainCalls).toHaveLength(2); // turn1 + turn2 仅各有 1 次主请求

      console.log(JSON.stringify({
        itemIndex: 13,
        subItem: '13a-throw-exception',
        itemName: '辅助失败后的下一句',
        sessionId,
        calls: mainSessCalls,
        cleanedBeforeNext,
        resumeCalls: resumeSession.mock.calls,
        firstEventsCount: firstChunks.length,
        nextEventsCount: nextChunks.length,
        originalError: originalErrorMsg,
        endState: 'helper_exception_evicted_and_resumed_successfully',
      }));
    } finally {
      provider.destroy();
    }
  });

  it('项 13b 辅助失败后的下一句（终止错误）：起名返回错误事件后保住正文与成功终态，坏连接被清理，下一次用户续聊恢复原 thread 并成功，另一会话不受影响', async () => {
    setupCommonEnvironment();
    const calls: Array<{ session: string; thread: string; connection: number; kind: string }> = [];
    let generation = 0;
    const sessionId = 'session-item-13b-error-event';
    const otherSessionId = 'session-item-13b-other';

    const createSession = vi.fn(async (opts: { workspacePath?: string }) => {
      const isOther = opts?.workspacePath?.includes('other');
      return {
        id: isOther ? 'thread-13b-other' : 'thread-13b-stable',
        platform: 'codex-app-server',
        raw: { generation: ++generation, dead: false, isOther },
      };
    });
    const resumeSession = vi.fn(async (id: string) => ({
      id,
      platform: 'codex-app-server',
      raw: { generation: ++generation, dead: false },
    }));
    const cleanupSession = vi.fn();
    const originalErrorMsg = 'Codex app-server error during naming (simulated 13b error event)';

    const protocol = {
      platform: 'codex-app-server',
      createSession,
      resumeSession,
      cleanupSession,
      abortSession: vi.fn(),
      async *sendMessage(session: any, message: { content: string }) {
        const isHelper = message.content.includes('update_session_meta');
        const sessName = session.raw.isOther ? 'other' : 'main';
        calls.push({
          session: sessName,
          thread: session.id,
          connection: session.raw.generation,
          kind: isHelper ? 'helper' : 'main',
        });
        if (session.raw.dead) {
          throw new Error('JsonRpcClient closed: child exited');
        }
        if (isHelper && !session.raw.isOther) {
          session.raw.dead = true;
          yield { type: 'error', error: originalErrorMsg } as ProtocolEvent;
          return;
        }
        yield { type: 'text', content: `${sessName} answer preserved` } as ProtocolEvent;
        yield { type: 'complete', content: `${sessName} answer preserved` } as ProtocolEvent;
      },
    };

    const permissionService = { resolvePermission: vi.fn(), rejectAllPending: vi.fn(), clearSessionCache: vi.fn() };
    const provider = new OpenAICodexProvider({}, { protocol, permissionService, transport: 'app-server' } as never);
    await provider.initialize({ model: 'openai-codex:gpt-5.5' });

    try {
      // 1. 初始化 otherSession
      const otherChunks = [];
      for await (const c of provider.sendMessage('other-msg', undefined, otherSessionId, [], '/tmp/13b-other')) {
        otherChunks.push(c);
      }
      expect(otherChunks.some(c => c.type === 'complete')).toBe(true);
      const otherCleanedBefore = cleanupSession.mock.calls.length;

      // 2. 主会话第一回合：主回合成功，起名返回终止错误事件
      const firstChunks = [];
      for await (const c of provider.sendMessage('first-msg', undefined, sessionId, [], '/tmp/13b-main')) {
        firstChunks.push(c);
      }

      // 验证第一回合：正文与成功终态保留，对外不发错误
      expect(firstChunks.some(c => c.type === 'error'), '第一回合不应包含 error 事件').toBe(false);
      expect(firstChunks.some(c => c.type === 'complete'), '第一回合应包含 complete 事件').toBe(true);
      const firstTextChunk = firstChunks.find(c => c.type === 'text');
      expect(firstTextChunk?.content).toBe('main answer preserved');

      // 验证坏连接已清理：cleanupSession 增加 1 次，otherSession 未受影响
      const cleanedBeforeNext = cleanupSession.mock.calls.length;
      expect(cleanedBeforeNext - otherCleanedBefore, '主会话起名返回错误事件后应清理 1 次').toBe(1);

      // 3. 主会话第二回合：用户显式续聊
      const nextChunks = [];
      for await (const c of provider.sendMessage('explicit-next', undefined, sessionId, [], '/tmp/13b-main')) {
        nextChunks.push(c);
      }

      // 验证第二回合：不撞死亡连接，正文与完成正常产出
      expect(nextChunks.some(c => c.type === 'error'), '第二回合不应撞死亡连接').toBe(false);
      expect(nextChunks.some(c => c.type === 'complete'), '第二回合应正常完成').toBe(true);

      // 验证恢复行为：使用原 thread 标识 resumeSession
      expect(resumeSession).toHaveBeenCalledWith('thread-13b-stable', expect.anything());
      const mainSessCalls = calls.filter(c => c.session === 'main');
      expect(mainSessCalls).toHaveLength(3);
      expect(mainSessCalls[0].connection).toBe(mainSessCalls[1].connection);
      expect(mainSessCalls[2].connection).not.toBe(mainSessCalls[0].connection);

      // 命名累计仅 1 次
      const helperCalls = mainSessCalls.filter(c => c.kind === 'helper');
      expect(helperCalls).toHaveLength(1);

      // 无自动重发主请求
      const turn2MainCalls = mainSessCalls.filter(c => c.kind === 'main');
      expect(turn2MainCalls).toHaveLength(2);

      console.log(JSON.stringify({
        itemIndex: 13,
        subItem: '13b-error-event',
        itemName: '辅助失败后的下一句',
        sessionId,
        calls: mainSessCalls,
        cleanedBeforeNext,
        resumeCalls: resumeSession.mock.calls,
        firstEventsCount: firstChunks.length,
        nextEventsCount: nextChunks.length,
        originalError: originalErrorMsg,
        endState: 'helper_error_event_evicted_and_resumed_successfully',
      }));
    } finally {
      provider.destroy();
    }
  });
});

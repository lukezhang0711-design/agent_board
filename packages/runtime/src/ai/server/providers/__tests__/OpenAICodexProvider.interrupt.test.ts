import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock('../../protocols/codexAppServer/codexAppServerBinary', () => ({
  resolveCodexBinaryPath: () => '/fake/codex',
  resolveCodexBinaryFromModules: () => '/fake/codex',
  getCodexVendorPathEntries: () => [],
}));

import { OpenAICodexProvider } from '../OpenAICodexProvider';
import { CodexAppServerProtocol } from '../../protocols/CodexAppServerProtocol';
import {
  FakeCodexAppServer,
  nextWrittenMatching,
} from '../../protocols/__tests__/fixtures/fakeCodexAppServer';

describe('OpenAICodexProvider interruption wiring', () => {
  let child: FakeCodexAppServer;
  let protocol: CodexAppServerProtocol;
  let provider: OpenAICodexProvider;

  beforeEach(async () => {
    child = new FakeCodexAppServer();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(child);

    OpenAICodexProvider.setTrustChecker(() => ({
      trusted: true,
      mode: 'allow-all' as const,
    }));
    OpenAICodexProvider.setPermissionPatternChecker(async () => false);
    OpenAICodexProvider.setPermissionPatternSaver(async () => {});
    OpenAICodexProvider.setSecurityLogger(() => {});
    OpenAICodexProvider.setMcpServerPort(null);
    OpenAICodexProvider.setSessionNamingServerPort(null);
    OpenAICodexProvider.setExtensionDevServerPort(null);
    OpenAICodexProvider.setSessionContextServerPort(null);
    OpenAICodexProvider.setMetaAgentServerPort(null);
    OpenAICodexProvider.setSettingsServerPort(null);
    OpenAICodexProvider.setMCPConfigLoader(null);
    OpenAICodexProvider.setClaudeSettingsEnvLoader(null);
    OpenAICodexProvider.setShellEnvironmentLoader(null);
    OpenAICodexProvider.setAdditionalDirectoriesLoader(null);
    OpenAICodexProvider.setCodexAuthGate(null);

    protocol = new CodexAppServerProtocol({
      apiKey: 'test-key',
      resolveCodexPathOverride: () => '/fake/codex',
    });
    provider = new OpenAICodexProvider(
      { apiKey: 'test-key' },
      { protocol, transport: 'app-server' },
    );
    await provider.initialize({
      apiKey: 'test-key',
      model: 'openai-codex:gpt-5',
    });
  });

  afterEach(() => {
    provider.destroy();
    if (!child.killed) child.kill();
  });

  async function startActiveProviderTurn() {
    child
      .scriptResult('initialize', {
        codexHome: '/fake',
        platformFamily: 'unix',
        platformOs: 'macos',
        userAgent: 'fake/0',
      })
      .scriptResult('thread/start', { thread: { id: 'thread-provider' } })
      .scriptResult('turn/start', {
        turn: { id: 'turn-provider', items: [], status: 'inProgress' },
      });

    const iterator = provider.sendMessage(
      'keep working',
      undefined,
      'session-provider',
      [],
      process.cwd(),
    )[Symbol.asyncIterator]();
    const firstChunkPromise = iterator.next();

    await nextWrittenMatching(child, 'turn/start');
    child.emitLine({
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-provider',
        turnId: 'turn-provider',
        itemId: 'message-provider',
        delta: 'working',
      },
    });
    await expect(firstChunkPromise).resolves.toMatchObject({
      done: false,
      value: { type: 'text', content: 'working' },
    });

    return iterator;
  }

  async function finishProviderTurn(
    iterator: AsyncIterator<unknown>,
  ): Promise<void> {
    child.emitTurnCompleted({
      threadId: 'thread-provider',
      turn: { id: 'turn-provider', status: 'completed' },
    });
    while (!(await iterator.next()).done) {
      // drain
    }
  }

  it('returns the app-server interrupt confirmation unchanged', async () => {
    const iterator = await startActiveProviderTurn();
    child.scriptResult('turn/interrupt', {});

    try {
      const resultPromise = provider.interruptCurrentTurn();
      const interruptRequest = await nextWrittenMatching(child, 'turn/interrupt');
      expect(interruptRequest.params).toEqual({
        threadId: 'thread-provider',
        turnId: 'turn-provider',
      });
      await expect(resultPromise).resolves.toEqual({
        method: 'interrupt',
        outcome: 'interrupted',
      });
    } finally {
      await finishProviderTurn(iterator);
    }
  });

  it('returns the app-server interrupt rejection reason unchanged', async () => {
    const iterator = await startActiveProviderTurn();
    child.scriptInterruptMissingTurnId();

    try {
      const resultPromise = provider.interruptCurrentTurn();
      await nextWrittenMatching(child, 'turn/interrupt');
      await expect(resultPromise).resolves.toEqual({
        method: 'interrupt',
        outcome: 'failed',
        error: expect.stringContaining('missing field `turnId`'),
      });
    } finally {
      await finishProviderTurn(iterator);
    }
  });

  it('returns already-ended when there is no active provider turn', async () => {
    await expect(provider.interruptCurrentTurn()).resolves.toEqual({
      method: 'interrupt',
      outcome: 'already-ended',
    });
    expect(child.requests('turn/interrupt')).toHaveLength(0);
  });

  it('delivers provider.abort() to the app server as a real interrupt frame', async () => {
    const iterator = await startActiveProviderTurn();
    child.scriptResult('turn/interrupt', {});

    provider.abort();
    const completion = (async () => {
      while (!(await iterator.next()).done) {
        // drain
      }
    })();

    try {
      const interruptRequest = await nextWrittenMatching(child, 'turn/interrupt', 100);
      expect(interruptRequest.params).toEqual({
        threadId: 'thread-provider',
        turnId: 'turn-provider',
      });
    } finally {
      child.emitTurnCompleted({
        threadId: 'thread-provider',
        turn: { id: 'turn-provider', status: 'completed' },
      });
      await completion;
    }
  });
});

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const execFileSyncMock = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
    execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  };
});

import { CopilotACPProtocol } from '../../protocols/CopilotACPProtocol';
import { CopilotCLIProvider } from '../CopilotCLIProvider';

type WrittenFrame = {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
};

class FakeCopilotACPProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly writtenFrames: WrittenFrame[] = [];
  killed = false;
  private inputBuffer = '';

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      this.inputBuffer += chunk.toString('utf8');
      let newlineIndex: number;
      while ((newlineIndex = this.inputBuffer.indexOf('\n')) >= 0) {
        const line = this.inputBuffer.slice(0, newlineIndex);
        this.inputBuffer = this.inputBuffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        const frame = JSON.parse(line) as WrittenFrame;
        this.writtenFrames.push(frame);
        this.respondToSetupRequest(frame);
      }
    });
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }

  completePrompt(): void {
    const promptRequest = this.writtenFrames.find((frame) => frame.method === 'session/prompt');
    if (promptRequest?.id === undefined) {
      throw new Error('No session/prompt request is pending');
    }
    this.emitLine({ jsonrpc: '2.0', id: promptRequest.id, result: { stopReason: 'cancelled' } });
  }

  private respondToSetupRequest(frame: WrittenFrame): void {
    if (frame.id === undefined) return;
    if (frame.method === 'initialize') {
      this.emitLine({ jsonrpc: '2.0', id: frame.id, result: {} });
    } else if (frame.method === 'session/new') {
      this.emitLine({
        jsonrpc: '2.0',
        id: frame.id,
        result: { sessionId: 'copilot-session-1' },
      });
    }
  }

  private emitLine(frame: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(frame)}\n`);
  }
}

async function nextWrittenFrame(
  child: FakeCopilotACPProcess,
  method: string,
  timeoutMs = 1000,
): Promise<WrittenFrame> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const frame = child.writtenFrames.find((candidate) => candidate.method === method);
    if (frame) return frame;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${method}; saw ${JSON.stringify(child.writtenFrames)}`);
}

describe('CopilotCLIProvider interruption wiring', () => {
  let child: FakeCopilotACPProcess;
  let provider: CopilotCLIProvider;

  beforeEach(async () => {
    child = new FakeCopilotACPProcess();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(child);
    execFileSyncMock.mockReset();
    execFileSyncMock.mockReturnValue(Buffer.from('1.0.0'));

    CopilotCLIProvider.setTrustChecker(() => ({ trusted: true, mode: 'allow-all' }));
    CopilotCLIProvider.setMcpServerPort(null);
    CopilotCLIProvider.setSessionNamingServerPort(null);
    CopilotCLIProvider.setExtensionDevServerPort(null);
    CopilotCLIProvider.setSessionContextServerPort(null);
    CopilotCLIProvider.setMetaAgentServerPort(null);
    CopilotCLIProvider.setSettingsServerPort(null);
    CopilotCLIProvider.setMCPConfigLoader(null);
    CopilotCLIProvider.setShellEnvironmentLoader(null);
    CopilotCLIProvider.setEnhancedPathLoader(null);
    CopilotCLIProvider.setCopilotPathLoader(() => '/fake/copilot');

    const protocol = new CopilotACPProtocol('/fake/copilot');
    provider = new CopilotCLIProvider({ protocol });
    await provider.initialize({ model: 'copilot-cli:default' });
  });

  afterEach(() => {
    provider.destroy();
    CopilotCLIProvider.setTrustChecker(null);
    CopilotCLIProvider.setCopilotPathLoader(null);
    if (!child.killed) child.kill();
  });

  it('writes a real session/cancel frame when provider.abort() stops an active turn', async () => {
    const collector = (async () => {
      for await (const _chunk of provider.sendMessage(
        'keep working',
        undefined,
        'nimbalyst-session-1',
        [],
        process.cwd(),
      )) {
        // Drain the turn so the provider runs its normal finally cleanup.
      }
    })();

    await nextWrittenFrame(child, 'session/prompt');

    try {
      provider.abort();
      const cancelFrame = await nextWrittenFrame(child, 'session/cancel', 100);

      expect(cancelFrame).toEqual({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: 'copilot-session-1' },
      });
    } finally {
      child.completePrompt();
      await collector;
    }
  });
});

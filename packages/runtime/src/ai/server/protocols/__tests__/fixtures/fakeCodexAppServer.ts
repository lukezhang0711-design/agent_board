import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type {
  ErrorNotification,
  TurnCompletedNotification,
} from '../../codexAppServer/types';

export interface FakeRpcError {
  code: number;
  message: string;
}

interface ScriptTiming {
  /** Hold the scripted response until this promise settles. */
  after?: Promise<unknown>;
}

type ScriptedResponse = (
  | { result: unknown }
  | { error: FakeRpcError }
) & ScriptTiming;

/**
 * In-process Codex app-server fake used at the JSON-RPC stdio seam.
 *
 * Queue request responses before invoking the protocol:
 * `server.scriptResult('turn/start', { turn: { id: 'turn-1' } })` or
 * `server.scriptError('turn/interrupt', { code: -32602, message: '...' })`.
 * Pass `{ after: gate.promise }` to delay a response and assert waiting
 * behavior. Requests without a queued response remain pending and can be
 * completed with `respond` / `reject`. Terminal and retry notifications are
 * emitted with `emitTurnCompleted` and `emitError`.
 */
export class FakeCodexAppServer extends EventEmitter {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  killed = false;
  /** Every JSON-RPC frame written by the protocol, in arrival order. */
  readonly writtenLines: unknown[] = [];

  private readonly scriptedResponses = new Map<string, ScriptedResponse[]>();

  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();

    let buffer = '';
    this.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;
        try {
          const frame = JSON.parse(line) as Record<string, unknown>;
          this.writtenLines.push(frame);
          this.applyScript(frame);
        } catch {
          this.writtenLines.push({ __unparseable: line });
        }
      }
    });
  }

  scriptResult(method: string, result: unknown, timing: ScriptTiming = {}): this {
    return this.queueResponse(method, { result, ...timing });
  }

  scriptError(method: string, error: FakeRpcError, timing: ScriptTiming = {}): this {
    return this.queueResponse(method, { error, ...timing });
  }

  /** Standard App Server validation rejection for a missing interrupt turn id. */
  scriptInterruptMissingTurnId(timing: ScriptTiming = {}): this {
    return this.scriptError(
      'turn/interrupt',
      { code: -32602, message: 'missing field `turnId`' },
      timing,
    );
  }

  respond(request: Record<string, unknown>, result: unknown = {}): void {
    this.emitLine({ id: request.id, result });
  }

  reject(request: Record<string, unknown>, error: FakeRpcError): void {
    this.emitLine({ id: request.id, error });
  }

  emitTurnCompleted(params: TurnCompletedNotification): void {
    this.emitLine({ method: 'turn/completed', params });
  }

  emitError(params: ErrorNotification): void {
    this.emitLine({ method: 'error', params });
  }

  /** Push an arbitrary server -> client JSON-RPC frame. */
  emitLine(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill(): boolean {
    if (this.killed) return false;
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }

  requests(method: string): Record<string, unknown>[] {
    return this.writtenLines.filter(
      (line): line is Record<string, unknown> => (
        !!line
        && typeof line === 'object'
        && (line as Record<string, unknown>).method === method
      ),
    );
  }

  private queueResponse(method: string, response: ScriptedResponse): this {
    const queue = this.scriptedResponses.get(method) ?? [];
    queue.push(response);
    this.scriptedResponses.set(method, queue);
    return this;
  }

  private applyScript(frame: Record<string, unknown>): void {
    const method = typeof frame.method === 'string' ? frame.method : undefined;
    if (!method || frame.id === undefined) return;
    const queue = this.scriptedResponses.get(method);
    const response = queue?.shift();
    if (!response) return;
    if (queue?.length === 0) this.scriptedResponses.delete(method);

    void Promise.resolve(response.after).then(() => {
      if ('error' in response) {
        this.reject(frame, response.error);
      } else {
        this.respond(frame, response.result);
      }
    });
  }
}

export function nextWrittenMatching(
  server: FakeCodexAppServer,
  method: string,
  timeoutMs = 1000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const request = server.requests(method)[0];
      if (request) {
        resolve(request);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(
          `timeout waiting for ${method}; saw: ${JSON.stringify(server.writtenLines)}`,
        ));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

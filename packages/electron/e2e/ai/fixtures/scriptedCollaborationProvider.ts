import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * The LM Studio provider defaults to this loopback port. Keeping the fake on
 * that exact port means every provider re-initialization remains inside this
 * deterministic test boundary.
 */
export const SCRIPTED_PROVIDER_PORT = 8234;

export const SCRIPTED_FINAL_SUMMARY =
  'Scripted collaboration summary: all dispatched work orders converged after stop-and-clear.';
export const SCRIPTED_REVIVE_SUMMARY =
  'Scripted revive continuation: the Head processed the durable approval response.';

export interface ScriptedProviderRequest {
  prompt: string;
  body: Record<string, unknown>;
}

interface HeldResponse {
  response: ServerResponse;
  text: string;
}

/**
 * A local, OpenAI-compatible provider used only by the collaboration E2E.
 * It accepts the real LM Studio provider protocol, records the input prompt,
 * and returns a fixed SSE script. No remote provider, model process, or
 * credentials are involved.
 */
export class ScriptedCollaborationProvider {
  private server: Server | null = null;
  private readonly requests: ScriptedProviderRequest[] = [];
  private readonly heldResponses = new Map<string, HeldResponse>();

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        this.server = null;
        reject(
          new Error(
            `Could not start scripted collaboration provider on 127.0.0.1:${SCRIPTED_PROVIDER_PORT}: ${error.message}`,
          ),
        );
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(SCRIPTED_PROVIDER_PORT, '127.0.0.1');
    });
  }

  async stop(): Promise<void> {
    for (const [key, held] of this.heldResponses) {
      this.heldResponses.delete(key);
      this.writeStreamingResponse(held.response, held.text);
    }

    const server = this.server;
    this.server = null;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  getRequests(): readonly ScriptedProviderRequest[] {
    return this.requests;
  }

  async waitForPrompt(fragment: string, timeoutMs = 10_000): Promise<ScriptedProviderRequest> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const request = this.requests.find((candidate) => candidate.prompt.includes(fragment));
      if (request) {
        return request;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Scripted provider never received prompt containing: ${fragment}`);
  }

  releaseHold(key: string): void {
    const held = this.heldResponses.get(key);
    if (!held) {
      throw new Error(`No scripted provider request is held for key: ${key}`);
    }
    this.heldResponses.delete(key);
    this.writeStreamingResponse(held.response, held.text);
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ id: 'scripted-collaboration-model' }] }));
      return;
    }

    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Unsupported scripted provider route' } }));
      return;
    }

    try {
      const body = await this.readJsonBody(request);
      const prompt = this.extractLatestUserPrompt(body);
      const scriptedRequest = { prompt, body };
      this.requests.push(scriptedRequest);

      const holdKey = this.extractHoldKey(prompt);
      const text = this.scriptedReply(prompt);
      if (holdKey) {
        this.heldResponses.set(holdKey, { response, text });
        response.once('close', () => {
          const held = this.heldResponses.get(holdKey);
          if (held?.response === response) {
            this.heldResponses.delete(holdKey);
          }
        });
        return;
      }

      this.writeStreamingResponse(response, text);
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
    }
  }

  private async readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected an object request body');
    }
    return parsed as Record<string, unknown>;
  }

  private extractLatestUserPrompt(body: Record<string, unknown>): string {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (const message of [...messages].reverse()) {
      if (!message || typeof message !== 'object') {
        continue;
      }
      const candidate = message as { role?: unknown; content?: unknown };
      if (candidate.role !== 'user') {
        continue;
      }
      if (typeof candidate.content === 'string') {
        return candidate.content;
      }
      if (Array.isArray(candidate.content)) {
        return candidate.content
          .map((part) => {
            if (!part || typeof part !== 'object') return '';
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          })
          .join('\n');
      }
    }
    return '';
  }

  private extractHoldKey(prompt: string): string | null {
    const match = prompt.match(/\[scripted:hold=([^\]]+)\]/);
    return match?.[1]?.trim() || null;
  }

  private scriptedReply(prompt: string): string {
    if (prompt.includes('[Plan approval response]')) {
      return SCRIPTED_REVIVE_SUMMARY;
    }
    if (prompt.includes('Produce final collaboration summary')) {
      return SCRIPTED_FINAL_SUMMARY;
    }
    return 'Scripted provider completed the requested collaboration turn.';
  }

  private writeStreamingResponse(response: ServerResponse, text: string): void {
    if (response.destroyed || response.writableEnded) {
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
    });
    response.write(`data: ${JSON.stringify({
      id: 'scripted-collaboration-turn',
      choices: [{ delta: { content: text }, index: 0 }],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      id: 'scripted-collaboration-turn',
      choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })}\n\n`);
    response.end('data: [DONE]\n\n');
  }
}

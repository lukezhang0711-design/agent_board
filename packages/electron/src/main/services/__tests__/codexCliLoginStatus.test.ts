import { describe, expect, it } from 'vitest';
import { classifyCodexCliLoginStatus } from '../codexCliLoginStatus';

describe('read-only Codex CLI login-status classifier', () => {
  it('recognizes the native ChatGPT and API-key summaries without exposing output', () => {
    expect(classifyCodexCliLoginStatus('Logged in using ChatGPT', '', 0)).toBe('chatgpt');
    expect(classifyCodexCliLoginStatus('Logged in using an API key', '', 0)).toBe('api-key');
  });

  it('reports an explicit CLI auth result as logged out', () => {
    expect(classifyCodexCliLoginStatus('', 'Not logged in', 1)).toBe('logged-out');
  });

  it('GREEN EO: keeps a launch or timeout failure unknown instead of inferring logout', () => {
    expect(classifyCodexCliLoginStatus('', '', undefined, 'spawn ENOENT')).toBe('unknown');
    expect(classifyCodexCliLoginStatus('', 'timed out', undefined, 'Command timed out')).toBe('unknown');
  });
});

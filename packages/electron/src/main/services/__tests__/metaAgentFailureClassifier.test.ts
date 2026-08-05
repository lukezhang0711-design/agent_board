import { describe, expect, it } from 'vitest';
import { classifyFailureReason } from '../metaAgentFailureClassifier';

describe('classifyFailureReason', () => {
  it.each([
    'request timed out after 30s',
    'fetch failed: ECONNRESET',
    'HTTP 429 too many requests',
    'engine process crashed with exit code 1',
  ])('classifies platform failure %s as infra', (reason) => {
    expect(classifyFailureReason(reason)).toBe('infra');
  });

  it.each([
    'Model identifier must be in "provider:model" format: haiku',
    'Model "missing-model" is not supported',
    'authentication failed: login expired',
    'invalid_request_error: context_length_exceeded',
  ])('classifies agent failure %s as agent', (reason) => {
    expect(classifyFailureReason(reason)).toBe('agent');
  });

  it('uses agent as the conservative fallback for unknown text', () => {
    expect(classifyFailureReason('a failure nobody has catalogued yet')).toBe('agent');
  });
});

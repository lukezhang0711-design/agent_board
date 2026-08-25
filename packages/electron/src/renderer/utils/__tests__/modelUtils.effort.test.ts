import { describe, expect, it } from 'vitest';
import { getEffortConfigurationForModel, getSupportedEffortLevelsForModel } from '../modelUtils';

describe('getSupportedEffortLevelsForModel', () => {
  it('keeps the Effort control visible when a model advertises levels without the legacy flag', () => {
    expect(getSupportedEffortLevelsForModel({
      claude: [{
        id: 'claude-code:haiku',
        supportedEffortLevels: ['low', 'medium', 'high'],
      }],
    }, 'claude-code:haiku')).toEqual(['low', 'medium', 'high']);
  });

  it('hides the Haiku control when its live declaration has no levels', () => {
    expect(getSupportedEffortLevelsForModel({
      claude: [{ id: 'claude-code:haiku', supportsEffort: false }],
    }, 'claude-code:haiku')).toEqual([]);
  });

  it('does not invent options while the live catalog is still loading', () => {
    expect(getSupportedEffortLevelsForModel({}, 'claude-code:haiku'))
      .toEqual([]);
  });

  it('hides the control when the selected model has no supported levels', () => {
    expect(getSupportedEffortLevelsForModel({
      claude: [{ id: 'claude-code:unknown' }],
    }, 'claude-code:unknown')).toEqual([]);
  });

  it('passes an unknown future engine level through to the selector', () => {
    expect(getSupportedEffortLevelsForModel({
      codex: [{ id: 'openai-codex:future', supportedEffortLevels: ['turbo', 'deep'] }],
    }, 'openai-codex:future')).toEqual(['turbo', 'deep']);
  });

  it('GREEN EO: returns the selected model default with its declared options', () => {
    expect(getEffortConfigurationForModel({
      codex: [{
        id: 'openai-codex:gpt-5.6-sol',
        supportedEffortLevels: ['low', 'turbo'],
        defaultEffortLevel: 'turbo',
      }],
    }, 'openai-codex:gpt-5.6-sol')).toEqual({
      supportedEffortLevels: ['low', 'turbo'],
      defaultEffortLevel: 'turbo',
    });
  });

  it('GREEN EO: Gemini rows with no separate declaration expose no effort control', () => {
    expect(getEffortConfigurationForModel({
      gemini: [{
        id: 'antigravity-gemini-agent:gemini-3.7-flash-high',
        supportedEffortLevels: [],
      }],
    }, 'antigravity-gemini-agent:gemini-3.7-flash-high')).toEqual({
      supportedEffortLevels: [],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { getSupportedEffortLevelsForModel } from '../modelUtils';

describe('getSupportedEffortLevelsForModel', () => {
  it('keeps the Effort control visible when a model advertises levels without the legacy flag', () => {
    expect(getSupportedEffortLevelsForModel({
      claude: [{
        id: 'claude-code:haiku',
        supportedEffortLevels: ['low', 'medium', 'high'],
      }],
    }, 'claude-code:haiku')).toEqual(['low', 'medium', 'high']);
  });

  it('keeps the Haiku control visible when the legacy catalog row has no levels', () => {
    expect(getSupportedEffortLevelsForModel({
      claude: [{ id: 'claude-code:haiku', supportsEffort: false }],
    }, 'claude-code:haiku')).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  });

  it('keeps Haiku visible while the live catalog is still loading', () => {
    expect(getSupportedEffortLevelsForModel({}, 'claude-code:haiku'))
      .toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  });

  it('hides the control when the selected model has no supported levels', () => {
    expect(getSupportedEffortLevelsForModel({
      claude: [{ id: 'claude-code:unknown' }],
    }, 'claude-code:unknown')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { getDescriptor, isSettingKey } from '../settings/keys';

describe('channel health startup setting', () => {
  it('persists the default-on startup switch in ai-settings without sharing a provider blob', () => {
    const key = 'ai.channelHealth.autoCheckOnStartup';
    expect(isSettingKey(key)).toBe(true);

    const descriptor = getDescriptor(key);
    expect(descriptor.defaultValue).toBe(true);
    expect(descriptor.storage).toEqual({
      store: 'ai-settings',
      path: 'channelHealth.autoCheckOnStartup',
    });
  });

  it('persists the default-off Claude CLI visibility switch independently', () => {
    const key = 'ai.showClaudeCliChannel';
    expect(isSettingKey(key)).toBe(true);

    const descriptor = getDescriptor(key);
    expect(descriptor.defaultValue).toBe(false);
    expect(descriptor.storage).toEqual({
      store: 'ai-settings',
      path: 'showClaudeCliChannel',
    });
  });
});

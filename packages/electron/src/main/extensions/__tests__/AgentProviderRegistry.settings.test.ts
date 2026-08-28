import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAgentProviderRegistry } from '../AgentProviderRegistry';
import { isSettingKey } from '../../../shared/settings/keys';

describe('AgentProviderRegistry settings registration', () => {
  afterEach(() => {
    getAgentProviderRegistry().__resetForTests();
  });

  it('automatically grants a registered extension provider a validated settings key', () => {
    const registry = getAgentProviderRegistry();
    registry.register({
      extensionId: 'com.example.fixture',
      contributionId: 'fixture-agent',
      manifest: {} as any,
      contribution: {} as any,
      backendModuleId: 'fixture-backend',
      extensionPath: '/fixture',
    });

    expect(isSettingKey('ai.provider.fixture-agent')).toBe(true);
    registry.clearAll('com.example.fixture');
    expect(isSettingKey('ai.provider.fixture-agent')).toBe(false);
  });

  it('RED FB-140: notifies listeners when extension agent providers are registered after startup', () => {
    const registry = getAgentProviderRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.onDidChange(listener);

    registry.register({
      extensionId: 'com.example.fixture',
      contributionId: 'fixture-agent',
      manifest: {} as any,
      contribution: { modelDiscovery: 'dynamic' } as any,
      backendModuleId: 'fixture-backend',
      extensionPath: '/fixture',
    });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'registered',
      entry: expect.objectContaining({ contributionId: 'fixture-agent' }),
    }));

    unsubscribe();
    registry.register({
      extensionId: 'com.example.fixture',
      contributionId: 'second-agent',
      manifest: {} as any,
      contribution: { modelDiscovery: 'dynamic' } as any,
      backendModuleId: 'fixture-backend',
      extensionPath: '/fixture',
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

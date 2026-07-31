import { afterEach, describe, expect, it } from 'vitest';

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
});

// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentFeaturesPanel } from '../AgentFeaturesPanel';

const invoke = vi.fn();

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (channel: string, key?: string) => {
    if (channel === 'app-settings:get' && key === 'metaAgentMaxParallel') return 7;
    if (channel === 'preferred-agent-language:get') return '';
    return undefined;
  });

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      invoke,
      claudeCode: {
        getSettings: vi.fn().mockResolvedValue({
          projectCommandsEnabled: false,
          userCommandsEnabled: false,
        }),
      },
      agentWorkflows: {
        getSettings: vi.fn().mockResolvedValue({
          sourceSettings: {
            workspaceClaudeCompatibilityEnabled: false,
            includeProjectClaudeSources: false,
            includeUserClaudeSources: false,
            extensionWorkflowsEnabled: false,
          },
          exportSettings: {
            codexEnabled: false,
            claudeGeneratedExtensionWorkflowsEnabled: false,
          },
        }),
        setSourceSettings: vi.fn(),
        setExportSettings: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentFeaturesPanel Meta Agent concurrency setting', () => {
  it('loads and writes metaAgentMaxParallel through the existing app-settings path', async () => {
    render(<AgentFeaturesPanel />);

    const input = await screen.findByLabelText('Max parallel child sessions') as HTMLInputElement;
    expect(input.value).toBe('7');
    expect(screen.getByText('New child sessions queue when all parallel slots are in use.')).toBeTruthy();

    fireEvent.change(input, { target: { value: '6' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('app-settings:set', 'metaAgentMaxParallel', 6);
    });
  });

  it('falls back to four when the entered value is invalid', async () => {
    render(<AgentFeaturesPanel />);

    const input = await screen.findByLabelText('Max parallel child sessions') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(input.value).toBe('4');
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('app-settings:set', 'metaAgentMaxParallel', 4);
    });
  });
});

// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentFeaturesPanel } from '../AgentFeaturesPanel';

const invoke = vi.fn();
const setSourceSettings = vi.fn();
const setExportSettings = vi.fn();

const workflowSourceSettings = {
  workspaceClaudeCompatibilityEnabled: false,
  includeProjectClaudeSources: false,
  includeUserClaudeSources: false,
  extensionWorkflowsEnabled: false,
};

const workflowExportSettings = {
  codexEnabled: false,
  claudeGeneratedExtensionWorkflowsEnabled: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));

beforeEach(() => {
  invoke.mockReset();
  setSourceSettings.mockReset();
  setExportSettings.mockReset();
  invoke.mockImplementation(async (channel: string, key?: string) => {
    if (channel === 'app-settings:get' && key === 'metaAgentMaxParallel') return 7;
    if (channel === 'preferred-agent-language:get') return '';
    return undefined;
  });
  setSourceSettings.mockImplementation(async (updates) => ({
    ...workflowSourceSettings,
    ...updates,
  }));
  setExportSettings.mockImplementation(async (updates) => ({
    ...workflowExportSettings,
    ...updates,
  }));

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
          sourceSettings: workflowSourceSettings,
          exportSettings: workflowExportSettings,
        }),
        setSourceSettings,
        setExportSettings,
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AgentFeaturesPanel Meta Agent concurrency setting', () => {
  it('keeps a saved value when the opening read returns a stale value', async () => {
    const openingRead = deferred<number>();
    let persistedValue = 4;
    let isOpeningRead = true;

    invoke.mockImplementation(async (channel: string, key?: string, value?: unknown) => {
      if (channel === 'app-settings:get' && key === 'metaAgentMaxParallel') {
        if (isOpeningRead) {
          isOpeningRead = false;
          return openingRead.promise;
        }
        return persistedValue;
      }
      if (channel === 'app-settings:set' && key === 'metaAgentMaxParallel') {
        persistedValue = value as number;
        return persistedValue;
      }
      if (channel === 'preferred-agent-language:get') return '';
      return undefined;
    });

    render(<AgentFeaturesPanel />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('app-settings:get', 'metaAgentMaxParallel');
    });
    const input = screen.getByLabelText('Max parallel child sessions') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('app-settings:set', 'metaAgentMaxParallel', 2);
    });
    expect(persistedValue).toBe(2);

    const metaSaveValues = () => invoke.mock.calls
      .filter(([channel, key]) => channel === 'app-settings:set' && key === 'metaAgentMaxParallel')
      .map(([, , value]) => value);
    expect(metaSaveValues()).toEqual([2]);

    await act(async () => {
      openingRead.resolve(4);
      await openingRead.promise;
    });
    expect(input.value).toBe('2');

    fireEvent.focus(input);
    fireEvent.blur(input);
    await waitFor(() => {
      expect(metaSaveValues()).toEqual([2, 2]);
    });
    expect(persistedValue).toBe(2);

    cleanup();
    render(<AgentFeaturesPanel />);
    const reopenedInput = await screen.findByLabelText('Max parallel child sessions') as HTMLInputElement;
    await waitFor(() => {
      expect(reopenedInput.value).toBe('2');
    });
  });

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

  it('keeps a neighboring workflow toggle independent of a Meta Agent save', async () => {
    render(<AgentFeaturesPanel />);

    const input = await screen.findByLabelText('Max parallel child sessions') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);

    const workflowToggle = screen.getByText('Workspace Claude compatibility')
      .parentElement?.parentElement?.querySelector('input') as HTMLInputElement;
    fireEvent.click(workflowToggle);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('app-settings:set', 'metaAgentMaxParallel', 2);
      expect(setSourceSettings).toHaveBeenCalledWith({ workspaceClaudeCompatibilityEnabled: true });
    });
    expect(input.value).toBe('2');
    expect(workflowToggle.checked).toBe(true);
  });

  it('falls back to four when the entered value is invalid', async () => {
    render(<AgentFeaturesPanel />);

    const input = await screen.findByLabelText('Max parallel child sessions') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('app-settings:set', 'metaAgentMaxParallel', 4);
    });
    await waitFor(() => {
      expect(input.value).toBe('4');
    });
  });
});

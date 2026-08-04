// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('@nimbalyst/runtime', () => ({ MaterialSymbol: () => null }));
vi.mock('../../../utils/modelUtils', () => ({
  getClaudeCodeModelLabel: (modelId: string) => modelId,
}));

import { AgentModelPicker } from '../AgentModelPicker';

afterEach(() => cleanup());

describe('AgentModelPicker', () => {
  it('does not offer the deprecated OpenAI Codex ACP provider for a new action', () => {
    const { container } = render(
      <AgentModelPicker
        models={[
          {
            id: 'openai-codex-acp:gpt-5.5',
            name: 'Codex ACP',
            provider: 'openai-codex-acp',
          },
          {
            id: 'openai-codex:gpt-5.5',
            name: 'Codex',
            provider: 'openai-codex',
          },
        ]}
        selectedModel="openai-codex:gpt-5.5"
        onModelChange={vi.fn()}
      />,
    );

    expect(container.querySelector('optgroup[label="OpenAI Codex (ACP)"]')).toBeNull();
    expect(container.querySelector('optgroup[label="OpenAI Codex"]')).toBeTruthy();
  });

  it('hides the Claude CLI provider while advanced channel visibility is off', () => {
    const { container } = render(
      <AgentModelPicker
        models={[
          { id: 'claude-code:sonnet', name: 'Claude Agent', provider: 'claude-code' },
          { id: 'claude-code-cli:sonnet', name: 'Claude CLI', provider: 'claude-code-cli' },
        ]}
        selectedModel="claude-code:sonnet"
        onModelChange={vi.fn()}
      />,
    );

    expect(container.querySelector('optgroup[label="Claude"]')).toBeTruthy();
    expect(container.querySelector('optgroup[label="Claude Code CLI"]')).toBeNull();
    expect(container.querySelector('option[value="claude-code-cli:sonnet"]')).toBeNull();
  });
});

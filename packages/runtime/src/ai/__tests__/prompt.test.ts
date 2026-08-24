import { describe, expect, it } from 'vitest';
import { buildClaudeCodeSystemPrompt, buildMetaAgentSystemPrompt, buildDevAgentSystemPrompt } from '../prompt';

describe('buildClaudeCodeSystemPrompt', () => {
  it('includes interactive input guidance for codex-style tool references', () => {
    const prompt = buildClaudeCodeSystemPrompt({
      toolReferenceStyle: 'codex',
    });

    expect(prompt).toContain('## Interactive User Input');
    expect(prompt).toContain('`AskUserQuestion` (server: `nimbalyst-mcp`)');
    expect(prompt).toContain('`PromptForUserInput` (server: `nimbalyst-mcp`)');
    expect(prompt).toContain('call an interactive tool instead');
    expect(prompt).toContain('Combine multiple questions into one multi-field prompt');
  });

  it('formats interactive input tool references for claude-style prompts', () => {
    const prompt = buildClaudeCodeSystemPrompt({
      toolReferenceStyle: 'claude',
    });

    expect(prompt).toContain('`mcp__nimbalyst-mcp__AskUserQuestion`');
    expect(prompt).toContain('`mcp__nimbalyst-mcp__PromptForUserInput`');
  });

  it('keeps plan-only sessions in planning', () => {
    const prompt = buildClaudeCodeSystemPrompt({
      toolReferenceStyle: 'codex',
      hasSessionNaming: true,
    });

    expect(prompt).toContain('Update phase for plan-only work: `{ "phase": "planning" }`');
    expect(prompt).toContain('If the session only produced a plan/design/research artifact, it stays "planning"');
    expect(prompt).toContain('Use "validating" only after implementation exists and is being tested or reviewed.');
  });
});

describe('extension agent self-identification (gemini)', () => {
  it('buildDevAgentSystemPrompt identifies by display name, not the internal id', () => {
    const prompt = buildDevAgentSystemPrompt({
      provider: 'antigravity-gemini-agent',
      model: 'gemini-3-flash-agent',
      modelDisplayName: 'Gemini 3.5 Flash (High)',
    });
    expect(prompt).toContain('You are Gemini 3.5 Flash (High),');
    expect(prompt).toContain('answer truthfully with that name');
    expect(prompt).not.toContain('You are running as provider');
    expect(prompt).not.toContain('gemini-3-flash-agent');
  });

  it('buildDevAgentSystemPrompt falls back to a generic identity without a display name', () => {
    const prompt = buildDevAgentSystemPrompt({ provider: 'antigravity-gemini-agent', model: 'gemini-3-flash-agent' });
    expect(prompt).toContain('You are an AI model served through the Antigravity language server.');
    expect(prompt).not.toContain('gemini-3-flash-agent');
  });

  it('buildMetaAgentSystemPrompt keeps the original identity for built-ins (no display name)', () => {
    const prompt = buildMetaAgentSystemPrompt('claude', 'default', { provider: 'claude-code', model: 'opus' });
    expect(prompt).toContain('You are running as provider `claude-code` with model `opus`.');
    expect(prompt).not.toContain('You are an AI model');
  });

  it('buildMetaAgentSystemPrompt identifies by display name but keeps ids for child spawning', () => {
    const prompt = buildMetaAgentSystemPrompt('codex', 'default', {
      provider: 'antigravity-gemini-agent',
      model: 'gemini-3-flash-agent',
      modelDisplayName: 'Gemini 3.5 Flash (High)',
    });
    expect(prompt).toContain('You are Gemini 3.5 Flash (High).');
    expect(prompt).toContain('answer truthfully with that name');
    expect(prompt).not.toContain('You are running as provider');
    // The raw ids remain in the spawn instruction so children inherit the same model.
    expect(prompt).toContain('gemini-3-flash-agent');
  });

  it('requires the Head to resume an interrupted child in place before re-dispatching', () => {
    const prompt = buildMetaAgentSystemPrompt('claude', 'default', {
      provider: 'claude-code',
      model: 'opus',
    });

    expect(prompt).toContain('Resume interrupted children in place');
    expect(prompt).toContain('Only create a replacement session when the original cannot be resumed');
  });

  it('makes Codex Head plan approval submit_plan-only without changing Claude wording', () => {
    const codexPrompt = buildMetaAgentSystemPrompt('codex', 'default', {
      provider: 'openai-codex',
      model: 'gpt-5.4-mini',
    });
    const claudePrompt = buildMetaAgentSystemPrompt('claude', 'default', {
      provider: 'claude-code',
      model: 'opus',
    });

    expect(codexPrompt).toContain('never use `PromptForUserInput` (server: `nimbalyst-mcp`) or `AskUserQuestion` (server: `nimbalyst-mcp`) to approve a plan');
    expect(claudePrompt).not.toContain('never use `PromptForUserInput` (server: `nimbalyst-mcp`) or `AskUserQuestion` (server: `nimbalyst-mcp`) to approve a plan');
  });

  it('gives low-cost Heads a concrete no-text-bypass plan-card template and counterexamples', () => {
    const prompt = buildMetaAgentSystemPrompt('claude', 'default', {
      provider: 'claude-code',
      model: 'haiku',
    });

    expect(prompt).toContain('## Plan Card Discipline — No Text Bypass');
    expect(prompt).toContain('Treat a plan written in chat as invalid');
    expect(prompt).toContain('"planItems": ["Bounded module with its deliverable and acceptance check"]');
    expect(prompt).toContain('After rejection, resubmit the revision with the same planId');
    expect(prompt).toContain('Ordinary questions, investigation findings, status updates, and failure reports do not need a plan card');
    expect(prompt).toContain('waiting for approval');
  });

  it('teaches Head to submit structured modules and candidates instead of serial prose', () => {
    const prompt = buildMetaAgentSystemPrompt('codex', 'default', {
      provider: 'openai-codex',
      model: 'gpt-5.4-mini',
    });

    expect(prompt).toContain('modules');
    expect(prompt).toContain('candidates');
    expect(prompt).toContain('选这个');
    expect(prompt).toContain('selectedCandidates');
    expect(prompt).toContain('方案文字保持简短');
    expect(prompt).toContain('不要把多个候选方案写成串行大段落');
    expect(prompt).toContain('one module card per module beneath a plan header');
    expect(prompt).toContain('stable 1-based moduleIndex');
    expect(prompt).toContain('全部批准');
    expect(prompt).toContain('same planId');
    expect(prompt).toContain("The boss can change a module's provider-qualified model and thinking effort directly on the approval card.");
    expect(prompt).toContain('Do not debate model choices in plan prose');
  });
});

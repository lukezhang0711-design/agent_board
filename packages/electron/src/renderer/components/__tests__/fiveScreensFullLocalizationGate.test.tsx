// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { SessionMeta } from '@nimbalyst/runtime';
import { noopInteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import type { CustomToolWidgetProps } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import { interactiveWidgetHostAtom } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/transcript/TranscriptProjector';
import { sessionRegistryAtom } from '../../store/atoms/sessions';

// 1. Screen 1: Plan Approval Widget
import {
  PlanApprovalWidget,
  RedispatchWorkOrderWidget,
  WorkspaceTrustChangeWidget,
} from '../UnifiedAI/PlanApprovalWidget';

// 2. Screen 2: Skill Library Panel
import { SkillLibraryPanel } from '../Settings/SkillLibraryPanel';

// 3. Screen 3: Channel Health Panel
import {
  ChannelHealthRow,
  type ChannelHealthResultView,
} from '../Settings/ChannelHealthPanel';

// 4. Screen 4: Session Kanban Board
import { SessionKanbanBoard } from '../TrackerMode/SessionKanbanBoard';

// 5. Screen 5: AI Usage Indicator & Popover
import { AIUsageIndicator } from '../UsageIndicator/AIUsageIndicator';
import { AIUsagePopover } from '../UsageIndicator/AIUsagePopover';
import { claudeUsageAtom } from '../../store/atoms/claudeUsageAtoms';
import { codexUsageAtom } from '../../store/atoms/codexUsageAtoms';
import { geminiUsageAtom } from '../../store/atoms/geminiUsageAtoms';
import type { ClaudeUsageData, CodexUsageData } from '../../../shared/usage';
import type { GeminiUsageData } from '../../store/atoms/geminiUsageAtoms';

// Mocks
vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
    <span data-material-icon={icon} className={className} />
  ),
  ProviderIcon: ({ provider }: { provider?: string }) => (
    <span data-provider-icon={provider} />
  ),
}));

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: () => null,
}));

vi.mock('posthog-js/react', () => ({
  usePostHog: () => null,
}));

vi.mock('../AgenticCoding/SessionContextMenu', () => ({
  SessionContextMenu: () => null,
}));

vi.mock('../AgentMode/ArchiveWorktreeDialog', () => ({
  ArchiveWorktreeDialog: () => null,
}));

vi.mock('../../hooks/useArchiveWorktreeDialog', () => ({
  useArchiveWorktreeDialog: () => ({
    dialogState: null,
    showDialog: vi.fn(),
    closeDialog: vi.fn(),
    confirmArchive: vi.fn(),
  }),
}));

vi.mock('../../hooks/useFloatingMenu', () => ({
  useFloatingMenu: () => ({
    refs: { setReference: vi.fn(), setFloating: vi.fn() },
    floatingStyles: {},
    getFloatingProps: () => ({}),
  }),
  FloatingPortal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../store/listeners/claudeUsageListeners', () => ({
  refreshClaudeUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../store/listeners/codexUsageListeners', () => ({
  refreshCodexUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../store/listeners/geminiUsageListeners', () => ({
  refreshGeminiUsage: vi.fn().mockResolvedValue(undefined),
}));

// ============================================================
// Whitelist and Gate Assertion
// ============================================================

const ALLOWED_EXEMPTIONS = new Set([
  // Engines & Models
  'claude',
  'codex',
  'gemini',
  'haiku',
  'sonnet',
  'opus',
  'gpt-4',
  'gpt-4o',
  'anthropic',
  'openai',
  'google',
  'cloud',
  'code',
  // Identifiers & technical terms
  'claude-code',
  'claude-code-cli',
  'openai-codex',
  'openai-codex-acp',
  'antigravity-gemini-agent',
  'streaming',
  'claude /login',
  'codex login',
  'antigravity auth login',
  // Domain terms & Acronyms
  'head',
  'token',
  'tokens',
  'mcp',
  'pdf',
  'diff',
  'git',
  'api',
  'ui',
  'cli',
  'esc',
  'tab',
  'enter',
  'url',
  'http',
  'https',
  'json',
  'prd',
  'issue',
  'agent',
  'v1',
  'v2',
  'v3',
]);

/**
 * Extracts visible texts, placeholders, and tooltips, then verifies that
 * no unexempted multi-word English phrase remains.
 */
function assertNoUnlocalizedEnglish(container: HTMLElement, customExemptions: string[] = []): void {
  const allExemptions = new Set([
    ...ALLOWED_EXEMPTIONS,
    ...customExemptions.flatMap((s) => s.toLowerCase().split(/[\s'-]+/).filter(Boolean)),
  ]);

  // Collect text contents from text nodes, placeholders, titles, aria-labels
  const texts: string[] = [];

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    // Skip script/style, material-symbol icons, and raw engine verbatim output
    if (
      parent &&
      !['SCRIPT', 'STYLE'].includes(parent.tagName) &&
      !parent.hasAttribute('data-material-icon') &&
      !parent.closest('[data-testid*="raw-output"]')
    ) {
      const val = node.nodeValue?.trim();
      if (val) texts.push(val);
    }
    node = walker.nextNode();
  }

  // Collect element attributes
  const elements = container.querySelectorAll('*');
  elements.forEach((el) => {
    if (el.closest('[data-testid*="raw-output"]')) return;
    const title = el.getAttribute('title')?.trim();
    if (title) texts.push(title);
    const placeholder = el.getAttribute('placeholder')?.trim();
    if (placeholder) texts.push(placeholder);
    const ariaLabel = el.getAttribute('aria-label')?.trim();
    if (ariaLabel) texts.push(ariaLabel);
  });

  const violations: string[] = [];

  // Match English phrases (2 or more English words)
  const englishPhraseRegex = /\b[A-Za-z]{2,}(?:[\s'-]+[A-Za-z]{2,})+\b/g;

  for (const text of texts) {
    const matches = text.match(englishPhraseRegex);
    if (!matches) continue;

    for (const match of matches) {
      const lower = match.trim().toLowerCase();
      // Check if entire phrase is exempted
      if (allExemptions.has(lower)) continue;

      // Check if every individual word in the phrase is exempted
      const words = lower.split(/[\s'-]+/).filter(Boolean);
      const allWordsExempted = words.every((w) => allExemptions.has(w));
      if (allWordsExempted) continue;

      violations.push(`Found unlocalized English: "${match}" inside text: "${text}"`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `[Gate Check Failed] Untranslated English detected on screen:\n${violations.join('\n')}`,
    );
  }
}

function makeMessage(
  arguments_: Record<string, unknown>,
  toolName = 'ExitPlanMode',
): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(),
    type: 'tool_call',
    subagentId: null,
    toolCall: {
      toolName,
      toolDisplayName: toolName,
      status: 'running',
      description: null,
      arguments: arguments_,
      targetFilePath: null,
      mcpServer: null,
      mcpTool: null,
      providerToolCallId: 'call-1',
      progress: [],
    },
  };
}

function makeCustomToolProps(message: TranscriptViewMessage): CustomToolWidgetProps {
  return {
    sessionId: 'test-session',
    message,
    isExpanded: true,
    onToggle: () => {},
  };
}

describe('Five Screens Full Localization Gate (整屏一致门禁)', () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
    store.set(interactiveWidgetHostAtom('test-session'), noopInteractiveWidgetHost);
    window.electronAPI = {
      openExternal: vi.fn(),
      aiGetModels: vi.fn().mockResolvedValue({ success: true, grouped: {}, catalogStatuses: {} }),
      invoke: vi.fn().mockImplementation(async (channel: string) => {
        if (channel === 'channel-health:get') {
          return { running: false, results: [] };
        }
        if (channel === 'ai:getModelCatalogStatus') {
          return { catalogs: {} };
        }
        if (channel === 'dispatch-skills:list') {
          return { skills: [] };
        }
        if (channel === 'app-settings:get') {
          return null;
        }
        if (channel === 'sessions:get') {
          return { success: true, session: { agentRole: 'standard' } };
        }
        return {};
      }),
      on: vi.fn().mockReturnValue(() => {}),
    } as unknown as typeof window.electronAPI;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ============================================================
  // Red Evidence Test
  // ============================================================
  it('RED evidence: gate assert throws on unlocalized English phrase', () => {
    const div = document.createElement('div');
    div.innerHTML = `
      <div>
        <h3>方案审批</h3>
        <p>Pending Approval</p>
      </div>
    `;

    expect(() => assertNoUnlocalizedEnglish(div)).toThrow(
      /Found unlocalized English: "Pending Approval"/,
    );
  });

  // ============================================================
  // Screen 1: 方案审批卡 (Plan Approval Widget & sub-cards)
  // ============================================================
  it('GREEN: Screen 1 - 方案审批卡 is 100% localized to Chinese', () => {
    const planMsg = makeMessage({
      plan_file_path: '/path/to/plan.md',
      plan_summary: '这是一个重构方案，将五屏文案统一汉化。',
      total_work_orders: 2,
      overall_risk: 'medium',
      work_orders: [
        {
          id: 'wo-1',
          name: '工单 1',
          engine: 'claude-code',
          task_description: '汉化方案审批卡',
        },
        {
          id: 'wo-2',
          name: '工单 2',
          engine: 'openai-codex',
          task_description: '汉化看板面板',
        },
      ],
    });

    const redispatchMsg = makeMessage(
      {
        work_order_id: 'wo-123',
        attempt_number: 2,
        reason: '需要重新尝试',
      },
      'RedispatchWorkOrder',
    );

    const trustMsg = makeMessage(
      {
        workspace_path: '/workspace',
        reason: '执行必要命令',
      },
      'WorkspaceTrustChange',
    );

    const { container } = render(
      <Provider store={store}>
        <div>
          <PlanApprovalWidget {...makeCustomToolProps(planMsg)} />
          <RedispatchWorkOrderWidget {...makeCustomToolProps(redispatchMsg)} />
          <WorkspaceTrustChangeWidget {...makeCustomToolProps(trustMsg)} />
        </div>
      </Provider>,
    );

    assertNoUnlocalizedEnglish(container);
  });

  // ============================================================
  // Screen 2: 技能库 (Skill Library Panel)
  // ============================================================
  it('GREEN: Screen 2 - 技能库 is 100% localized to Chinese', async () => {
    (window.electronAPI.invoke as any).mockImplementation(async (channel: string) => {
      if (channel === 'dispatch-skills:list') {
        return {
          skills: [
            {
              id: 'codex:user:implement',
              engine: 'codex',
              name: 'implement',
              source: 'user',
              scope: 'global',
              category: '开发实现',
              summaryZh: '依据需求编写代码实现',
              rawDescription: 'Detailed implementation skill',
              estimatedTokens: 120,
            },
            {
              id: 'claude:user:review',
              engine: 'claude',
              name: 'review',
              source: 'user',
              scope: 'project',
              category: '质量保障',
              summaryZh: '全面审查代码改动',
              rawDescription: 'Code review skill',
              estimatedTokens: 80,
            },
          ],
        };
      }
      if (channel === 'app-settings:get') {
        return {
          bundles: [{ id: 'b-1', name: '常用包', skillIds: ['codex:user:implement'] }],
          disabledSkillIds: [],
        };
      }
      return {};
    });

    const { container } = render(<SkillLibraryPanel workspacePath="/workspace" />);

    await waitFor(() => {
      expect(screen.getByText('技能库')).toBeTruthy();
    });

    assertNoUnlocalizedEnglish(container, [
      'implement',
      'review',
      'Detailed implementation skill',
      'Code review skill',
    ]);
  });

  // ============================================================
  // Screen 3: 通道体检 (Channel Health Panel)
  // ============================================================
  it('GREEN: Screen 3 - 通道体检 is 100% localized to Chinese', () => {
    const results: ChannelHealthResultView[] = [
      {
        id: 'claude-code',
        displayName: 'Claude（嵌入式）',
        transport: 'streaming',
        state: 'healthy',
        checkedAt: Date.now(),
        completionMs: 250,
      },
      {
        id: 'openai-codex',
        displayName: 'Codex',
        transport: 'streaming',
        state: 'failed',
        failureKind: 'not_logged_in',
        checkedAt: Date.now(),
        guidance: '请在终端运行登录命令完成认证',
        rawOutput: 'Error: not logged in',
      },
    ];

    const { container } = render(
      <div>
        <ChannelHealthRow result={results[0]} running={false} onRerun={vi.fn()} />
        <ChannelHealthRow result={results[1]} running={false} onRerun={vi.fn()} />
      </div>,
    );

    assertNoUnlocalizedEnglish(container);
  });

  // ============================================================
  // Screen 4: 看板 / Delegated 面板 (Session Kanban Board)
  // ============================================================
  it('GREEN: Screen 4 - 看板 is 100% localized to Chinese', () => {
    const metaList: SessionMeta[] = [
      {
        id: 's-1',
        title: '待办任务 1',
        provider: 'claude-code',
        sessionType: 'session',
        workspaceId: '/workspace',
        worktreeId: null,
        parentSessionId: null,
        childCount: 0,
        uncommittedCount: 2,
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 5,
        isArchived: false,
        isPinned: false,
        phase: 'backlog',
      } as SessionMeta,
      {
        id: 's-2',
        title: '规划中任务 2',
        provider: 'openai-codex',
        sessionType: 'session',
        workspaceId: '/workspace',
        worktreeId: null,
        parentSessionId: null,
        childCount: 3,
        uncommittedCount: 0,
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 5,
        isArchived: false,
        isPinned: false,
        phase: 'planning',
      } as SessionMeta,
    ];

    store.set(sessionRegistryAtom, new Map(metaList.map((m) => [m.id, m])));

    const { container } = render(
      <Provider store={store}>
        <SessionKanbanBoard />
      </Provider>,
    );

    assertNoUnlocalizedEnglish(container);
  });

  // ============================================================
  // Screen 5: 用量浮窗 (AI Usage Popover & Indicator)
  // ============================================================
  it('GREEN: Screen 5 - 用量浮窗 is 100% localized to Chinese', () => {
    const mockClaudeUsage: ClaudeUsageData = {
      provider: 'claude-code',
      lastUpdated: Date.now(),
      pools: {
        'claude-code:five_hour': {
          key: 'claude-code:five_hour',
          provider: 'claude-code',
          limitId: 'five_hour',
          name: '5-hour window',
          utilization: 42,
          resetsAt: new Date(Date.now() + 3600000).toISOString(),
          windowMinutes: 300,
          updatedAt: Date.now(),
          stale: false,
        },
      },
    };

    const mockCodexUsage: CodexUsageData = {
      provider: 'openai-codex',
      lastUpdated: Date.now(),
      pools: {
        'openai-codex:primary': {
          key: 'openai-codex:primary',
          provider: 'openai-codex',
          limitId: 'primary',
          name: 'primary',
          utilization: 75,
          resetsAt: null,
          windowMinutes: 300,
          updatedAt: Date.now(),
          stale: false,
        },
      },
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: 250,
      },
    };

    const mockGeminiUsage: GeminiUsageData = {
      fiveHour: { utilization: 20, resetsAt: null },
      sevenDay: { utilization: 10, resetsAt: null },
      limitsAvailable: true,
      available: true,
      lastUpdated: Date.now(),
      groups: [
        {
          groupName: 'Gemini Models',
          models: [
            {
              model: 'gemini-2.5-flash',
              label: 'Gemini 2.5 Flash',
              utilization: 25,
              resetsAt: '2026-08-31T20:00:00Z',
            },
          ],
        },
      ],
    };

    store.set(claudeUsageAtom, mockClaudeUsage);
    store.set(codexUsageAtom, mockCodexUsage);
    store.set(geminiUsageAtom, mockGeminiUsage);

    const { container } = render(
      <Provider store={store}>
        <AIUsageIndicator />
      </Provider>,
    );

    // Open popover
    fireEvent.click(screen.getByTestId('ai-usage-indicator'));

    assertNoUnlocalizedEnglish(container, [
      '5-hour window',
      'primary',
      'Gemini Models',
      'Gemini 2.5 Flash',
    ]);
  });
});

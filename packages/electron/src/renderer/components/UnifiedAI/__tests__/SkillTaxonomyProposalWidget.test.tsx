// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { noopInteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import { interactiveWidgetHostAtom } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';
import { SkillTaxonomyProposalWidget } from '../SkillTaxonomyProposalWidget';

const invoke = vi.fn();
const sessionId = 'head-session';

const proposal = {
  taxonomyProposalRequestId: 'taxonomy-request-1',
  categories: ['构建', '验收'],
  skills: [
    { name: 'implement', category: '构建', summaryZh: '按需求完成实现' },
    { name: 'review', category: '验收' },
  ],
  incremental: false,
};

function renderWidget(result?: unknown) {
  const store = createStore();
  store.set(interactiveWidgetHostAtom(sessionId), {
    ...noopInteractiveWidgetHost,
    workspacePath: '/workspace',
  });
  return render(
    <JotaiProvider store={store}>
      <SkillTaxonomyProposalWidget
        sessionId={sessionId}
        workspacePath="/workspace"
        isExpanded={false}
        onToggle={() => {}}
        message={{
          id: 1,
          sequence: 1,
          createdAt: new Date(),
          type: 'tool_call',
          subagentId: null,
          toolCall: {
            toolName: 'SkillTaxonomyProposal',
            toolDisplayName: 'SkillTaxonomyProposal',
            status: 'running',
            description: null,
            arguments: proposal,
            result,
            targetFilePath: null,
            mcpServer: null,
            mcpTool: null,
            providerToolCallId: proposal.taxonomyProposalRequestId,
            progress: [],
          },
        } as any}
      />
    </JotaiProvider>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ success: true });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { invoke },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SkillTaxonomyProposalWidget', () => {
  it('绿④: 显示分类数量，展开可看归类，并允许改名、增删分类和移动技能', () => {
    renderWidget();

    expect(screen.getByTestId('skill-taxonomy-group-0').textContent).toContain('1');
    expect(screen.getByTestId('skill-taxonomy-group-1').textContent).toContain('1');
    fireEvent.click(screen.getAllByText('查看归类')[0]);
    expect(screen.getByText('implement')).toBeTruthy();
    expect(screen.getByText('[未翻译]')).toBeTruthy();

    fireEvent.change(screen.getByTestId('skill-taxonomy-category-name-0'), {
      target: { value: '交付' },
    });
    expect((screen.getByTestId('skill-taxonomy-skill-select-implement') as HTMLSelectElement).value).toBe('交付');

    fireEvent.click(screen.getByTestId('skill-taxonomy-add-category'));
    expect(screen.getByTestId('skill-taxonomy-category-name-2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('skill-taxonomy-delete-category-2'));
    expect(screen.queryByTestId('skill-taxonomy-category-name-2')).toBeNull();

    fireEvent.change(screen.getByTestId('skill-taxonomy-skill-select-review'), {
      target: { value: '交付' },
    });
    expect((screen.getByTestId('skill-taxonomy-skill-select-review') as HTMLSelectElement).value).toBe('交付');
  });

  it('绿⑤: 只有批准按钮调用落盘 IPC；拒绝不会调用批准通道', async () => {
    renderWidget();
    fireEvent.click(screen.getByTestId('skill-taxonomy-reject'));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('meta-agent:reject-skill-taxonomy-proposal', expect.objectContaining({
        sessionId,
        requestId: proposal.taxonomyProposalRequestId,
      }));
    });
    expect(invoke).not.toHaveBeenCalledWith('meta-agent:approve-skill-taxonomy-proposal', expect.anything());

    cleanup();
    invoke.mockClear();
    renderWidget();
    fireEvent.click(screen.getByTestId('skill-taxonomy-approve'));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('meta-agent:approve-skill-taxonomy-proposal', expect.objectContaining({
        sessionId,
        requestId: proposal.taxonomyProposalRequestId,
        categories: proposal.categories,
        skills: proposal.skills,
      }));
    });
  });

  it('已决卡不再显示可操作按钮', () => {
    renderWidget(JSON.stringify({ approved: true }));

    expect(screen.getByTestId('skill-taxonomy-proposal-widget').getAttribute('data-state')).toBe('approved');
    expect(screen.queryByTestId('skill-taxonomy-approve')).toBeNull();
    expect(screen.queryByTestId('skill-taxonomy-reject')).toBeNull();
  });
});

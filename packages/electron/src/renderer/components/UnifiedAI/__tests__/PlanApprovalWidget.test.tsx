// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { createStore, Provider as JotaiProvider } from 'jotai';
import { noopInteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import type { CustomToolWidgetProps } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets';
import { interactiveWidgetHostAtom } from '@nimbalyst/runtime/store/atoms/interactiveWidgetHost';
import type { InteractiveWidgetHost } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/transcript/TranscriptProjector';
import { getTranscriptToolWidget } from '@nimbalyst/runtime/ui/AgentTranscript/contributions';
import {
  PlanApprovalWidget,
  formatPlanOutputPath,
  hasPendingSubmittedPlanApproval,
  registerPlanApprovalWidget,
  unregisterPlanApprovalWidget,
} from '../PlanApprovalWidget';

const sessionId = 'plan-approval-session';
const compositeRequestId =
  'nimtc|94471805-5eca-4d66-a448-56e438de6ab3|1784297999209|21431';

const liveModelCatalog = () => ({
  success: true,
  grouped: {
    'openai-codex': [
      {
        id: 'openai-codex:gpt-5.4-mini',
        name: 'gpt-5.4-mini',
        provider: 'openai-codex',
        supportedEffortLevels: ['low', 'medium', 'high'],
        defaultEffortLevel: 'medium',
      },
      {
        id: 'openai-codex:gpt-5.6-sol',
        name: 'gpt-5.6-sol',
        provider: 'openai-codex',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'turbo'],
        defaultEffortLevel: 'high',
      },
    ],
    'claude-code': [
      {
        id: 'claude-code:haiku',
        name: 'haiku',
        provider: 'claude-code',
        supportedEffortLevels: [],
      },
    ],
    'antigravity-gemini-agent': [
      {
        id: 'antigravity-gemini-agent:gemini-3.7-flash-high',
        name: 'gemini-3.7-flash-high',
        provider: 'antigravity-gemini-agent',
        supportedEffortLevels: [],
      },
    ],
  },
  catalogStatuses: {
    'openai-codex': { modelSource: 'runtime', verified: true, lastError: null },
    'claude-code': { modelSource: 'runtime', verified: true, lastError: null },
    'antigravity-gemini-agent': { modelSource: 'runtime', verified: true, lastError: null },
  },
});

function installModelCatalog(response: unknown = liveModelCatalog()): void {
  const rendererWindow = window as unknown as {
    electronAPI?: Record<string, unknown>;
  };
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      ...(rendererWindow.electronAPI ?? {}),
      aiGetModels: vi.fn().mockResolvedValue(response),
    },
  });
}

function makeMessage(
  arguments_: Record<string, unknown>,
  providerToolCallId: string | null = compositeRequestId,
): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(),
    type: 'tool_call',
    subagentId: null,
    toolCall: {
      toolName: 'ExitPlanMode',
      toolDisplayName: 'ExitPlanMode',
      status: 'running',
      description: null,
      arguments: arguments_,
      targetFilePath: null,
      mcpServer: null,
      mcpTool: null,
      providerToolCallId,
      progress: [],
    },
  };
}

function renderWidget(
  arguments_: Record<string, unknown>,
  hostOverrides: Partial<InteractiveWidgetHost> = {},
  providerToolCallId: string | null = compositeRequestId,
  widgetOverrides: Partial<CustomToolWidgetProps> = {},
) {
  const jotaiStore = createStore();
  jotaiStore.set(interactiveWidgetHostAtom(sessionId), {
    ...noopInteractiveWidgetHost,
    ...hostOverrides,
  });
  return render(
    <JotaiProvider store={jotaiStore}>
      <PlanApprovalWidget
        message={makeMessage(arguments_, providerToolCallId)}
        isExpanded={false}
        onToggle={() => {}}
        sessionId={sessionId}
        {...widgetOverrides}
      />
    </JotaiProvider>,
  );
}

const planArguments = {
  planId: 'plan-42',
  title: 'Review child-session plan',
  planItems: ['Inspect the durable response', 'Gate implementation dispatch'],
  workOrderCount: 3,
  risks: 'A stale response could approve the wrong plan.',
};

const structuredPlanArguments = {
  ...planArguments,
  modules: [
    {
      title: '审批卡片',
      outputFiles: [
        '/Users/lukezhang/Desktop/project/packages/electron/PlanApprovalWidget.tsx',
      ],
      inputs: ['现有审批卡片'],
      provider: 'openai-codex',
      model: 'gpt-5.4-mini',
      effortLevel: 'medium',
      doneCriteria: '矩阵、单选和审批参数均有测试。',
      candidates: [
        {
          name: '方案 A',
          approach: '用对齐矩阵展示候选方案。',
          pros: ['字段同一水平线', '窄屏可横向滚动'],
          cons: '需要增加候选选择状态。',
          risks: ['旧卡片格式需要继续兼容。'],
          provider: 'openai-codex',
          model: 'gpt-5.4-mini',
          effortLevel: 'low',
        },
        {
          name: '方案 B',
          approach: '把候选方案堆成串行长段落。',
          pros: '实现改动小。',
          cons: ['同字段不对齐', '阅读成本高'],
          risks: '窄窗口会难以比较。',
          provider: 'claude-code',
          model: 'haiku',
          effortLevel: 'high',
        },
      ],
    },
  ],
};

const multiModulePlanArguments = {
  ...planArguments,
  title: '三模块并行方案',
  modules: [1, 2, 3].map((moduleIndex) => ({
    title: `模块 ${moduleIndex}`,
    outputFiles: [`packages/example/module-${moduleIndex}.ts`],
    inputs: [`模块 ${moduleIndex} 的输入`],
    provider: 'openai-codex',
    model: 'gpt-5.4-mini',
    effortLevel: 'medium',
    doneCriteria: `模块 ${moduleIndex} 的完成标准`,
  })),
};

const modelPickerPlanArguments = {
  ...planArguments,
  title: '模型就地改选',
  modules: [
    {
      title: '模型可改模块',
      outputFiles: ['packages/electron/src/renderer/components/UnifiedAI/PlanApprovalWidget.tsx'],
      inputs: ['实时模型目录'],
      provider: 'openai-codex',
      model: 'openai-codex:gpt-5.6-sol',
      effortLevel: 'ultra',
      doneCriteria: '按老板改后的模型和强度派发。',
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('PlanApprovalWidget', () => {
  it('registers as the ExitPlanMode transcript override', () => {
    try {
      registerPlanApprovalWidget();
      expect(getTranscriptToolWidget('ExitPlanMode')).toBe(PlanApprovalWidget);
    } finally {
      unregisterPlanApprovalWidget();
    }
  });

  it('shows submitted plan details and plan-specific actions', () => {
    renderWidget(planArguments);

    expect(screen.getByText('Review child-session plan')).toBeTruthy();
    expect(screen.getByText('Inspect the durable response')).toBeTruthy();
    expect(screen.getByText('Gate implementation dispatch')).toBeTruthy();
    expect(screen.getByText('3 work orders')).toBeTruthy();
    expect(
      screen.getByText('A stale response could approve the wrong plan.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Request changes' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss plan' })).toBeTruthy();
    expect(screen.queryByText('Ready to exit planning mode?')).toBeNull();
  });

  it('renders structured module fields and an aligned candidate matrix', () => {
    renderWidget(structuredPlanArguments, {
      workspacePath: '/Users/lukezhang/Desktop/project',
    });

    expect(screen.getByTestId('plan-approval-modules')).toBeTruthy();
    expect(screen.getByText('审批卡片')).toBeTruthy();
    expect(
      screen.getByText('packages/electron/PlanApprovalWidget.tsx'),
    ).toBeTruthy();
    expect(screen.getByText('现有审批卡片')).toBeTruthy();
    expect(screen.getAllByText('gpt-5.4-mini').length).toBeGreaterThan(0);
    expect(screen.getByTestId('plan-candidate-matrix')).toBeTruthy();
    expect(screen.getByText('怎么干')).toBeTruthy();
    expect(screen.getByText('优势')).toBeTruthy();
    expect(screen.getByText('劣势')).toBeTruthy();
    expect(screen.getByText('风险')).toBeTruthy();
    expect(screen.getAllByText('模型').length).toBeGreaterThan(0);
    expect(screen.getAllByText('思考强度').length).toBeGreaterThan(0);
    expect(screen.getByTestId('plan-candidate-radio-0-方案 A')).toBeTruthy();
    expect(screen.getByTestId('plan-candidate-radio-0-方案 B')).toBeTruthy();
    expect(screen.getAllByText('选这个').length).toBe(2);
  });

  it("green FB-113: pages a multi-module plan one module at a time with synchronized status dots", () => {
    renderWidget(multiModulePlanArguments);

    const header = screen.getByTestId("plan-approval-header");
    expect(header).toBeTruthy();
    expect(header.className).toContain("sticky");
    expect(
      header.querySelector('[data-testid="plan-approval-approve-all"]')
    ).toBeNull();
    expect(
      screen.getByTestId("plan-approval-module-count").textContent
    ).toContain("3 个模块");
    expect(screen.getByTestId("plan-module-pagination").textContent).toContain(
      "第 1 个 / 共 3 个"
    );
    expect(screen.getAllByTestId(/^plan-module-card-/)).toHaveLength(1);
    expect(screen.getByTestId("plan-module-card-1").textContent).toContain(
      "模块 1"
    );
    expect(screen.queryByTestId("plan-module-card-2")).toBeNull();
    expect(
      screen.getByTestId("plan-module-previous").hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.getByTestId("plan-module-next").hasAttribute("disabled")
    ).toBe(false);
    expect(
      screen.getByTestId("plan-module-status-dot-1").getAttribute("data-status")
    ).toBe("pending");
    expect(
      screen
        .getByTestId("plan-module-status-dot-1")
        .getAttribute("data-current")
    ).toBe("true");
    expect(
      screen
        .getByTestId("plan-module-status-dot-2")
        .getAttribute("data-current")
    ).toBe("false");
    fireEvent.click(screen.getByTestId("plan-module-next"));
    fireEvent.click(screen.getByTestId("plan-module-next"));
    expect(screen.getByTestId("plan-module-pagination").textContent).toContain(
      "第 3 个 / 共 3 个"
    );
    expect(screen.getByTestId("plan-module-card-3")).toBeTruthy();
    expect(
      screen.getByTestId("plan-module-previous").hasAttribute("disabled")
    ).toBe(false);
    expect(
      screen.getByTestId("plan-module-next").hasAttribute("disabled")
    ).toBe(true);
    expect(screen.getByRole("button", { name: "全部批准" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "打回这一条" })).toHaveLength(
      1
    );
    const actions = screen.getByTestId("plan-approval-actions");
    expect(actions.className).toContain("sticky");
    expect(actions.className).toContain("bottom-0");
    expect(
      screen.getByRole("button", { name: "全部批准" }).className
    ).not.toContain("w-full");
  });

  it("green FB-113b: rejects only the currently paged module and keeps every dot state accurate", async () => {
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(multiModulePlanArguments, { exitPlanModeDeny });

    fireEvent.click(screen.getByTestId("plan-module-next"));
    expect(screen.getByTestId("plan-module-pagination").textContent).toContain(
      "第 2 个 / 共 3 个"
    );
    expect(screen.getAllByTestId(/^plan-module-card-/)).toHaveLength(1);
    expect(screen.getByTestId("plan-module-card-2").textContent).toContain(
      "模块 2"
    );

    fireEvent.click(screen.getByTestId("plan-module-request-changes-2"));
    fireEvent.change(screen.getByTestId("plan-module-feedback-input-2"), {
      target: { value: "模块二需要补充回滚验收。" },
    });
    fireEvent.click(screen.getByTestId("plan-module-submit-changes-2"));

    await waitFor(() => {
      expect(exitPlanModeDeny).toHaveBeenCalledWith(
        compositeRequestId,
        "模块二需要补充回滚验收。",
        2
      );
    });
    expect(screen.getByTestId("plan-module-status-2").textContent).toContain(
      "已打回·待修订"
    );
    expect(screen.getByTestId("plan-module-feedback-2").textContent).toContain(
      "模块二需要补充回滚验收。"
    );
    expect(
      screen.getByTestId("plan-module-status-dot-1").getAttribute("data-status")
    ).toBe("pending");
    expect(
      screen.getByTestId("plan-module-status-dot-2").getAttribute("data-status")
    ).toBe("rejected");
    expect(
      screen
        .getByTestId("plan-module-status-dot-2")
        .getAttribute("data-current")
    ).toBe("true");
    expect(
      screen.getByTestId("plan-module-status-dot-3").getAttribute("data-status")
    ).toBe("pending");
    expect(
      screen.getByTestId("plan-approval-revision-warning").textContent
    ).toContain("1 个模块待修订，Head 需重新递交");
  });

  it("green FB-113c: approves every non-rejected module from any page", async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    installModelCatalog();
    renderWidget(multiModulePlanArguments, { exitPlanModeApprove });

    await waitFor(() => {
      expect(
        (screen.getByTestId("plan-module-model-select-1") as HTMLSelectElement)
          .options.length
      ).toBeGreaterThan(1);
    });

    fireEvent.click(screen.getByTestId("plan-module-next"));
    expect(screen.getByTestId("plan-module-card-2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "全部批准" }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId);
    });
    expect(screen.getByTestId("plan-module-status-2").textContent).toContain(
      "已批准"
    );
    for (const moduleIndex of [1, 2, 3]) {
      expect(
        screen
          .getByTestId(`plan-module-status-dot-${moduleIndex}`)
          .getAttribute("data-status")
      ).toBe("approved");
    }
  });

  it("green FB-113d: keeps the fields single-column and the route selectors readable at 360px and 480px module widths", async () => {
    installModelCatalog();

    for (const width of [360, 480]) {
      const rendered = renderWidget(modelPickerPlanArguments);
      const card = screen.getByTestId("plan-module-card-1");
      card.style.width = `${width}px`;

      const modelSelect = screen.getByTestId(
        "plan-module-model-select-1"
      ) as HTMLSelectElement;
      await waitFor(() =>
        expect(modelSelect.options.length).toBeGreaterThan(1)
      );
      const effortSelect = screen.getByTestId(
        "plan-module-effort-select-1"
      ) as HTMLSelectElement;

      const fields = screen.getByTestId("plan-module-fields-1");
      expect(card.className).toContain("plan-module-card");
      expect(fields.className).toContain("plan-module-fields");
      expect(fields.className).not.toMatch(/(?:^|\\s)(?:sm|lg|xl):/);
      expect(
        screen.getByTestId("plan-module-model-field-1").className
      ).toContain("plan-module-model-field");
      expect(
        screen.getByTestId("plan-module-effort-field-1").className
      ).toContain("plan-module-effort-field");
      expect(modelSelect.className).toContain("w-full");
      expect(modelSelect.options[modelSelect.selectedIndex]?.textContent).toBe(
        "openai-codex:gpt-5.6-sol"
      );
      expect(
        effortSelect.options[effortSelect.selectedIndex]?.textContent
      ).toBe("ultra");

      rendered.unmount();
    }
  });

  it('sends the selected candidate with approval', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    installModelCatalog();
    renderWidget(structuredPlanArguments, { exitPlanModeApprove });

    await waitFor(() => {
      expect(
        (screen.getByTestId('plan-module-model-select-1') as HTMLSelectElement)
          .options.length,
      ).toBeGreaterThan(1);
    });

    fireEvent.click(screen.getByTestId('plan-candidate-radio-0-方案 B'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId, [
        {
          moduleIndex: 0,
          moduleTitle: '审批卡片',
          name: '方案 B',
          approach: '把候选方案堆成串行长段落。',
          pros: '实现改动小。',
          cons: ['同字段不对齐', '阅读成本高'],
          risks: '窄窗口会难以比较。',
          provider: 'claude-code',
          model: 'claude-code:haiku',
        },
      ]);
    });
  });

  it('green FB-114/115: renders only model controls for Haiku and Gemini, while preserving unknown declared tiers', async () => {
    installModelCatalog();
    renderWidget(modelPickerPlanArguments);

    const modelSelect = screen.getByTestId(
      'plan-module-model-select-1',
    ) as HTMLSelectElement;
    await waitFor(() => {
      expect(modelSelect.options.length).toBeGreaterThan(1);
    });
    const effortSelect = screen.getByTestId(
      'plan-module-effort-select-1',
    ) as HTMLSelectElement;
    expect(modelSelect.value).toBe('openai-codex:gpt-5.6-sol');
    expect(Array.from(modelSelect.options, (option) => option.value)).toEqual(
      expect.arrayContaining([
        'openai-codex:gpt-5.6-sol',
        'claude-code:haiku',
        'antigravity-gemini-agent:gemini-3.7-flash-high',
      ]),
    );
    expect(Array.from(effortSelect.options, (option) => option.value)).toContain(
      'ultra',
    );
    expect(Array.from(effortSelect.options, (option) => option.value)).toContain(
      'turbo',
    );

    fireEvent.change(modelSelect, { target: { value: 'claude-code:haiku' } });

    await waitFor(() => {
      expect(screen.queryByTestId('plan-module-effort-select-1')).toBeNull();
    });

    fireEvent.change(modelSelect, {
      target: { value: 'antigravity-gemini-agent:gemini-3.7-flash-high' },
    });
    expect(screen.queryByTestId('plan-module-effort-select-1')).toBeNull();
  });

  it('green EJ-2: approves with the owner-edited provider, model, and effort', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    installModelCatalog();
    renderWidget(modelPickerPlanArguments, { exitPlanModeApprove });

    const modelSelect = screen.getByTestId(
      'plan-module-model-select-1',
    ) as HTMLSelectElement;
    await waitFor(() => expect(modelSelect.options.length).toBeGreaterThan(1));
    const effortSelect = screen.getByTestId(
      'plan-module-effort-select-1',
    ) as HTMLSelectElement;

    fireEvent.change(modelSelect, {
      target: { value: 'openai-codex:gpt-5.4-mini' },
    });
    // Changing model begins at the new row's declared default rather than
    // carrying a coincidentally named tier from the previous model/engine.
    expect(effortSelect.value).toBe('medium');
    fireEvent.change(effortSelect, { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId, [
        expect.objectContaining({
          moduleIndex: 0,
          moduleTitle: '模型可改模块',
          provider: 'openai-codex',
          model: 'openai-codex:gpt-5.4-mini',
          effortLevel: 'high',
        }),
      ]);
    });
  });

  it("green EJ-3: leaves a missing model unselected and does not disable another module field", async () => {
    installModelCatalog();
    renderWidget({
      ...planArguments,
      modules: [
        {
          ...modelPickerPlanArguments.modules[0],
          title: "型号已消失模块",
          model: "openai-codex:retired-model",
        },
        {
          ...modelPickerPlanArguments.modules[0],
          title: "仍可审批模块",
          model: "claude-code:haiku",
          provider: "claude-code",
          effortLevel: "low",
        },
      ],
    });

    fireEvent.click(screen.getByTestId("plan-module-next"));
    const validModelSelect = screen.getByTestId(
      "plan-module-model-select-2"
    ) as HTMLSelectElement;
    await waitFor(() =>
      expect(validModelSelect.options.length).toBeGreaterThan(1)
    );

    expect(validModelSelect.value).toBe("claude-code:haiku");
    expect(validModelSelect.disabled).toBe(false);
    fireEvent.click(screen.getByTestId("plan-module-previous"));
    const restoredMissingModelSelect = screen.getByTestId(
      "plan-module-model-select-1"
    ) as HTMLSelectElement;
    expect(restoredMissingModelSelect.value).toBe("");
    expect(restoredMissingModelSelect.options[0]?.textContent).toBe(
      "请选择模型"
    );
    expect(restoredMissingModelSelect.disabled).toBe(false);
    expect(
      screen.getByRole("button", { name: "全部批准" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it('green ET-5: explains the original Head-reported model value when a persisted plan module is absent from the current catalog', async () => {
    installModelCatalog({
      success: true,
      grouped: {
        'claude-code': [
          { id: 'claude-code:default', provider: 'claude-code', supportedEffortLevels: [] },
          { id: 'claude-code:opus[1m]', provider: 'claude-code', supportedEffortLevels: [] },
          { id: 'claude-code:sonnet', provider: 'claude-code', supportedEffortLevels: [] },
        ],
      },
      catalogStatuses: {
        'claude-code': { modelSource: 'runtime', verified: true, lastError: null },
      },
    });
    renderWidget({
      ...planArguments,
      modules: [
        {
          ...modelPickerPlanArguments.modules[0],
          title: '模块一',
          provider: 'claude-code',
          model: 'claude-opus-5[1m]',
        },
        {
          ...modelPickerPlanArguments.modules[0],
          title: '模块二',
          provider: 'claude-code',
          model: 'claude-opus-5[1m]',
        },
        {
          ...modelPickerPlanArguments.modules[0],
          title: '模块三',
          provider: 'claude-code',
          model: 'claude-sonnet-5',
        },
      ],
    });

    const modelSelect = screen.getByTestId('plan-module-model-select-1') as HTMLSelectElement;
    await waitFor(() => expect(modelSelect.options.length).toBeGreaterThan(1));

    expect(modelSelect.value).toBe('');
    expect(screen.getByRole('button', { name: '全部批准' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('plan-module-model-invalid-1').textContent)
      .toContain('Head 报的型号 claude-opus-5[1m] 不在当前清单里，请选一个');
    expect(screen.queryByText('这个会话存的型号不在当前模型清单里，请重新选一个')).toBeNull();
  });

  it('green ET-6: marks a catalog-pending submitted module without mislabeling it as an invalid model', async () => {
    installModelCatalog({
      success: true,
      grouped: { 'claude-code': [] },
      catalogStatuses: {
        'claude-code': {
          modelSource: 'placeholder',
          verified: false,
          lastError: { message: 'Claude model discovery failed' },
        },
      },
    });
    renderWidget({
      ...planArguments,
      modules: [{
        ...modelPickerPlanArguments.modules[0],
        title: '目录待确认模块',
        provider: 'claude-code',
        model: 'claude-opus-5[1m]',
        modelCatalogPending: true,
      }],
    });

    await waitFor(() => {
      expect(screen.getByTestId('plan-module-model-catalog-pending-1').textContent)
        .toBe('目录未就绪，模型待确认');
    });
    expect(screen.queryByTestId('plan-module-model-invalid-1')).toBeNull();
  });

  it('green EJ-4: never offers cached models when the real-time catalog is red', async () => {
    installModelCatalog({
      success: true,
      grouped: {
        'openai-codex': [
          {
            id: 'openai-codex:gpt-5.6-sol',
            name: 'gpt-5.6-sol',
            provider: 'openai-codex',
            supportedEffortLevels: ['low', 'medium', 'high', 'ultra'],
            defaultEffortLevel: 'high',
          },
        ],
      },
      catalogStatuses: {
        'openai-codex': {
          modelSource: 'cache',
          verified: false,
          lastError: { message: 'catalog unavailable' },
        },
      },
    });
    renderWidget(modelPickerPlanArguments);

    const modelSelect = screen.getByTestId(
      'plan-module-model-select-1',
    ) as HTMLSelectElement;
    await waitFor(() => expect(modelSelect.options.length).toBe(1));

    expect(modelSelect.value).toBe('');
    expect(Array.from(modelSelect.options, (option) => option.value)).not.toContain(
      'openai-codex:gpt-5.6-sol',
    );
    expect(
      screen.getByRole('button', { name: 'Approve plan' }).hasAttribute('disabled'),
    ).toBe(true);
  });

  it('green EJ-5: renders no price, cheapness, or warning copy on a model picker card', async () => {
    installModelCatalog();
    const rendered = renderWidget(modelPickerPlanArguments);
    await waitFor(() => {
      expect(
        (screen.getByTestId('plan-module-model-select-1') as HTMLSelectElement)
          .options.length,
      ).toBeGreaterThan(1);
    });

    const cardText = screen.getByTestId('plan-module-card-1').textContent ?? '';
    expect(cardText).not.toContain('最贵');
    expect(cardText).not.toContain('便宜');
    expect(cardText).not.toContain('警告');
    expect(cardText).not.toContain('价格');
    expect(rendered.container.querySelector('[data-testid="plan-model-price-warning"]')).toBeNull();
  });

  it('keeps approval actions sticky while a long card scrolls', () => {
    renderWidget({
      ...planArguments,
      planItems: Array.from(
        { length: 30 },
        (_, index) => `Long plan item ${index + 1}`,
      ),
    });

    const actions = screen.getByTestId('plan-approval-actions');
    expect(actions.className).toContain('sticky');
    expect(actions.className).toContain('bottom-0');
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Request changes' }),
    ).toBeTruthy();
  });

  it('formats output paths relative to the project root without truncation', () => {
    expect(
      formatPlanOutputPath(
        '/Users/lukezhang/Desktop/project/packages/electron/PlanApprovalWidget.tsx',
        '/Users/lukezhang/Desktop/project',
      ),
    ).toBe('packages/electron/PlanApprovalWidget.tsx');
    expect(
      formatPlanOutputPath(
        '/desktop/generated/result.md',
        '/Users/lukezhang/Desktop/project',
      ),
    ).toBe('desktop/generated/result.md');
  });

  it('renders an unavailable submitted plan as an explicit invalid card', async () => {
    renderWidget(planArguments, {}, compositeRequestId, {
      workspacePath: '/workspace',
      getInteractivePromptStatus: vi.fn().mockResolvedValue({
        status: 'unavailable',
        reason: 'supplier gone',
      }),
    });

    await waitFor(() => {
      expect(
        screen.getByTestId('plan-approval-widget').getAttribute('data-state'),
      ).toBe('invalid');
    });
    expect(screen.getByText('已失效')).toBeTruthy();
    expect(screen.getByText('重新发送消息继续')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
  });

  it('states plainly when the submitted plan declares no risks', () => {
    renderWidget({
      ...planArguments,
      risks: [],
    });

    expect(screen.getByText('未申报风险')).toBeTruthy();
  });

  it('marks a submitted plan as a commander approval only for a meta-agent session', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      session: {
        id: sessionId,
        agentRole: 'meta-agent',
        isArchived: false,
      },
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });

    renderWidget(planArguments);

    expect(await screen.findByTestId('meta-agent-plan-marker')).toBeTruthy();
  });

  it('does not attach the commander marker to a standard submitted plan', async () => {
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      session: {
        id: sessionId,
        agentRole: 'standard',
        isArchived: false,
      },
    });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });

    renderWidget(planArguments);

    await waitFor(() => {
      expect(
        screen
          .getByTestId('plan-approval-widget')
          .getAttribute('data-agent-role'),
      ).toBe('standard');
    });
    expect(screen.queryByTestId('meta-agent-plan-marker')).toBeNull();
  });

  it('renders a native Claude Head plan summary in the existing approval card', () => {
    renderWidget({
      ...planArguments,
      planSummary:
        '完整中文方案\n1. 进入 durable 审批。\n2. 批准后带 planId 派发。',
    });

    expect(screen.getByTestId('plan-approval-summary')).toBeTruthy();
    expect(screen.getByText('完整中文方案', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeTruthy();
    expect(screen.queryByText('Ready to exit planning mode?')).toBeNull();
  });

  it('does not invent a response ID when the durable provider tool-call ID is missing', () => {
    renderWidget(planArguments, {}, null);

    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Request changes' }),
    ).toBeNull();
    expect(screen.getByText('Waiting for a durable approval ID…')).toBeTruthy();
  });

  it('reuses the existing approve response route with the composite request ID', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId);
    });
  });

  it('waits for the durable tool result before showing an approved completion state', async () => {
    const exitPlanModeApprove = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(exitPlanModeApprove).toHaveBeenCalledWith(compositeRequestId);
    });
    expect(
      screen.getByTestId('plan-approval-widget').getAttribute('data-state'),
    ).toBe('pending');
    expect(screen.getByText('Awaiting review')).toBeTruthy();
    expect(screen.queryByText('Plan approved')).toBeNull();
  });

  it('flips to changes requested as soon as the durable state reaches responded', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        state: { status: 'submitted', requestId: compositeRequestId },
      })
      .mockResolvedValue({
        success: true,
        state: {
          status: 'responded',
          requestId: compositeRequestId,
          decision: 'rejected',
        },
      });
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        invoke,
      },
    });
    renderWidget(planArguments, { workspacePath: '/workspace' });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        'ai:getPlanApprovalState',
        '/workspace',
        sessionId,
        compositeRequestId,
      );
    });

    await waitFor(
      () => {
        expect(
          screen.getByTestId('plan-approval-widget').getAttribute('data-state'),
        ).toBe('changes-requested');
        expect(screen.getByText('Changes requested')).toBeTruthy();
        expect(
          screen.getByText(
            'Response recorded. Head is preparing the revision…',
          ),
        ).toBeTruthy();
      },
      { timeout: 2_000 },
    );
  });

  it('keeps the approval action available when the existing response route fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitPlanModeApprove = vi
      .fn()
      .mockRejectedValue(new Error('persist failed'));
    renderWidget(planArguments, { exitPlanModeApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: 'Approve plan' })
          .hasAttribute('disabled'),
      ).toBe(false);
    });
    expect(
      screen.getByTestId('plan-approval-widget').getAttribute('data-state'),
    ).toBe('pending');
    expect(
      screen.queryByText(
        'Response submitted. Waiting for durable confirmation…',
      ),
    ).toBeNull();
  });

  it('sends requested changes through the existing deny plus feedback route', async () => {
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeDeny });

    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    fireEvent.change(screen.getByLabelText('Requested changes'), {
      target: { value: 'Split the persistence and dispatch work orders.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));

    await waitFor(() => {
      expect(exitPlanModeDeny).toHaveBeenCalledWith(
        compositeRequestId,
        'Split the persistence and dispatch work orders.',
      );
    });
  });

  it('keeps IME feedback from submitting on the composition commit key', async () => {
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeDeny });

    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    const feedback = screen.getByLabelText(
      'Requested changes',
    ) as HTMLTextAreaElement;
    fireEvent.compositionStart(feedback, { data: '' });
    fireEvent.compositionUpdate(feedback, { data: 'zhongwen' });
    fireEvent.change(feedback, { target: { value: 'zhongwen' } });

    const compositionCommit = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(compositionCommit, 'isComposing', { value: false });
    Object.defineProperty(compositionCommit, 'keyCode', { value: 0 });
    fireEvent(feedback, compositionCommit);

    expect(compositionCommit.defaultPrevented).toBe(false);
    expect(exitPlanModeDeny).not.toHaveBeenCalled();

    fireEvent.compositionEnd(feedback, { data: '中文反馈' });
    fireEvent.change(feedback, { target: { value: '中文反馈' } });
    fireEvent.keyDown(feedback, {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    await waitFor(() => {
      expect(exitPlanModeDeny).toHaveBeenCalledWith(
        compositeRequestId,
        '中文反馈',
      );
    });
  });

  it('dismisses a submitted plan through the durable denial route', async () => {
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeDeny });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss plan' }));

    await waitFor(() => {
      expect(exitPlanModeDeny).toHaveBeenCalledWith(
        compositeRequestId,
        'User dismissed the plan.',
      );
    });
  });

  it('recognizes only an unresolved submitted plan as an interrupt guard', () => {
    const pendingPlan = makeMessage(planArguments);
    const completedPlan = makeMessage(planArguments);
    completedPlan.toolCall!.result = JSON.stringify({ approved: false });
    const ordinaryExitPlanMode = makeMessage({ planFilePath: 'docs/plan.md' });

    expect(hasPendingSubmittedPlanApproval([pendingPlan])).toBe(true);
    expect(hasPendingSubmittedPlanApproval([completedPlan])).toBe(false);
    expect(hasPendingSubmittedPlanApproval([ordinaryExitPlanMode])).toBe(false);
  });

  it('shows a retryable failure when a submitted rejection is not durably confirmed', async () => {
    vi.useFakeTimers();
    const exitPlanModeDeny = vi.fn().mockResolvedValue(undefined);
    renderWidget(planArguments, { exitPlanModeDeny });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Requested changes'), {
        target: { value: 'Split the persistence and dispatch work orders.' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(exitPlanModeDeny).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(
      screen.getByText(
        'Response was saved, but confirmation did not arrive. Retry the response.',
      ),
    ).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('plan-approval-retry-response'));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(exitPlanModeDeny).toHaveBeenCalledTimes(2));
    expect(exitPlanModeDeny).toHaveBeenLastCalledWith(
      compositeRequestId,
      'Split the persistence and dispatch work orders.',
    );
  });

  it('leaves ordinary ExitPlanMode prompts unchanged when planId is absent', () => {
    renderWidget({ planFilePath: 'docs/plan.md' });

    expect(screen.getByText('Ready to exit planning mode?')).toBeTruthy();
    expect(screen.getByText('Would you like to proceed?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
    expect(screen.queryByTestId('meta-agent-plan-marker')).toBeNull();
  });
});

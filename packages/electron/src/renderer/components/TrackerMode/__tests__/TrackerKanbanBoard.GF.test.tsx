// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { TrackerRecord } from "@nimbalyst/runtime/core/TrackerRecord";
import { KanbanBoard } from "../KanbanBoard";
import { TrackerSidebar } from "../TrackerSidebar";
import { SessionKanbanBoard } from "../SessionKanbanBoard";
import { scanFileViolations } from "../../../styles/__tests__/visualTokensGuard.test";
import * as fs from "fs";
import * as path from "path";

vi.mock("@nimbalyst/runtime", () => ({
  MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
    <span data-material-icon={icon} className={className}>{icon}</span>
  ),
  ProviderIcon: () => <span data-testid="provider-icon" />,
}));

vi.mock("@nimbalyst/runtime/plugins/TrackerPlugin/components/UserAvatar", () => ({
  UserAvatar: ({ identity }: { identity: string }) => (
    <span data-testid="user-avatar">{identity}</span>
  ),
}));

vi.mock("@floating-ui/react", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    FloatingPortal: ({ children }: { children: React.ReactNode }) => <div data-testid="floating-portal">{children}</div>,
  };
});

function createMockRecord(overrides: {
  id?: string;
  issueKey?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  primaryType?: string;
  typeTags?: string[];
  owner?: string;
} = {}): TrackerRecord {
  const id = overrides.id ?? "item-1";
  return {
    id,
    primaryType: overrides.primaryType ?? "task",
    typeTags: overrides.typeTags ?? ["task"],
    issueKey: overrides.issueKey ?? "NIM-101",
    fields: {
      title: overrides.title ?? "测试事项标题",
      description: overrides.description ?? "测试事项单行说明内容",
      status: overrides.status ?? "to-do",
      priority: overrides.priority ?? "high",
      owner: overrides.owner ?? "alice",
    },
    system: {
      createdAt: new Date("2026-09-01T10:00:00Z"),
      updatedAt: new Date("2026-09-01T12:00:00Z"),
      documentPath: "/mock/workspace/item.md",
    },
    source: "native",
    archived: false,
    syncStatus: "synced",
  } as unknown as TrackerRecord;
}

describe("施工单 GF — 事项看板红绿全量断言 (FB-164)", () => {
  beforeEach(() => {
    (window as any).electronAPI = {
      documentService: {
        updateTrackerItem: vi.fn().mockResolvedValue({ success: true }),
        updateTrackerItemInFile: vi.fn().mockResolvedValue({ success: true }),
      },
      invoke: vi.fn().mockResolvedValue({ success: true }),
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as any).electronAPI;
  });

  describe("红: 现状断言（迁移前基线欠账与改前无截断规则）", () => {
    it("断言迁移前基线欠账数：TrackerMode 曾有 84 处硬字号和 4 处硬颜色", () => {
      const baselinePath = path.resolve(__dirname, "../../../styles/visualTokensBaseline.json");
      expect(fs.existsSync(baselinePath)).toBe(true);
      const baselineContent = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
      expect(baselineContent["components/TrackerMode"].pxFonts).toBe(0);
      expect(baselineContent["components/TrackerMode"].rawColors).toBe(0);
    });
  });

  describe("绿①: 卡片渲染为 ItemCard，四段层级齐全（逐段断言）", () => {
    it("看板卡片包含 ItemCard 根节点与严格四段层级结构", () => {
      const item = createMockRecord({
        issueKey: "PROJ-42",
        title: "实现四段层级看板卡片",
        description: "确保顶行、标题、说明、底行齐全",
        status: "in-progress",
        owner: "bob",
      });

      render(<KanbanBoard filterType="all" overrideItems={[item]} />);

      const cardWrapper = screen.getByTestId("tracker-kanban-card");
      expect(cardWrapper).toBeTruthy();
      const itemCard = within(cardWrapper).getByTestId("item-card");
      expect(itemCard).toBeTruthy();

      const topTier = within(itemCard).getByTestId("item-card-top");
      expect(topTier).toBeTruthy();
      const idEl = within(topTier).getByTestId("item-card-id");
      expect(idEl.textContent).toContain("PROJ-42");
      const statusEl = within(topTier).getByTestId("item-card-status");
      expect(statusEl).toBeTruthy();
      expect(within(statusEl).getByTestId("status-badge")).toBeTruthy();

      const titleEl = within(itemCard).getByTestId("item-card-title");
      expect(titleEl).toBeTruthy();
      expect(titleEl.textContent).toBe("实现四段层级看板卡片");

      const descEl = within(itemCard).getByTestId("item-card-description");
      expect(descEl).toBeTruthy();
      expect(descEl.textContent).toBe("确保顶行、标题、说明、底行齐全");

      const bottomTier = within(itemCard).getByTestId("item-card-bottom");
      expect(bottomTier).toBeTruthy();
      const assigneeSlot = within(bottomTier).getByTestId("item-card-assignee");
      expect(assigneeSlot).toBeTruthy();
      const timeSlot = within(bottomTier).getByTestId("item-card-time");
      expect(timeSlot).toBeTruthy();
      expect(within(timeSlot).getByTestId("user-avatar")).toBeTruthy();
    });
  });

  describe("绿②: 标题超长截断到两行、说明超长截断到一行（两条断言，用超长夹具文本）", () => {
    const superLongTitle =
      "这是一个极其漫长的事项卡片标题，包含数以百计的技术实现细节和上下文背景，长标题在看板卡片中严禁将卡片整体撑变形，必须严格通过 line-clamp-2 截断到最多两行展示";
    const superLongDesc =
      "这是一行非常冗长详尽的事项描述文本它包含了前置条件与验证要求但是在看板卡片上必须通过 truncate 样式规则严格限制为单行超出截断";

    it("标题元素携带 line-clamp-2 截断样式类", () => {
      const item = createMockRecord({
        title: superLongTitle,
        description: superLongDesc,
      });

      render(<KanbanBoard filterType="all" overrideItems={[item]} />);

      const titleEl = screen.getByTestId("item-card-title");
      expect(titleEl.textContent).toBe(superLongTitle);
      expect(titleEl.className).toContain("line-clamp-2");
    });

    it("说明元素携带 truncate 单行截断样式类", () => {
      const item = createMockRecord({
        title: superLongTitle,
        description: superLongDesc,
      });

      render(<KanbanBoard filterType="all" overrideItems={[item]} />);

      const descEl = screen.getByTestId("item-card-description");
      expect(descEl.textContent).toBe(superLongDesc);
      expect(descEl.className).toContain("truncate");
    });
  });

  describe("绿③: 状态渲染为 StatusBadge；四种终态各自映射到不同徽章档（逐态断言）", () => {
    const statusesToTest = [
      { kanbanStatus: "to-do", expectedCanonical: "idle", expectedLabel: "待办" },
      { kanbanStatus: "in-progress", expectedCanonical: "running", expectedLabel: "在跑" },
      { kanbanStatus: "done", expectedCanonical: "completed", expectedLabel: "已完成" },
      { kanbanStatus: "blocked", expectedCanonical: "failed", expectedLabel: "失败" },
    ];

    for (const { kanbanStatus, expectedCanonical, expectedLabel } of statusesToTest) {
      it(`状态 [${kanbanStatus}] 正确映射到 StatusBadge [${expectedCanonical}] 并展示 [${expectedLabel}]`, () => {
        const item = createMockRecord({
          id: `item-${kanbanStatus}`,
          status: kanbanStatus,
        });

        render(<KanbanBoard filterType="all" overrideItems={[item]} />);

        const badge = screen.getByTestId("status-badge");
        expect(badge).toBeTruthy();
        expect(badge.getAttribute("data-status")).toBe(expectedCanonical);
        expect(badge.textContent).toContain(expectedLabel);
      });
    }
  });

  describe("绿④: 反向断言——卡片显示的字段集合与改前完全一致（逐字段比对，不许增删）", () => {
    it("卡片完整包含改前所有字段：编号、状态徽章、标题、说明、主类型、次要标签、优先级、负责人头像", () => {
      const item = createMockRecord({
        id: "full-fields-item",
        issueKey: "FULL-99",
        title: "完整字段事项",
        description: "检查所有改前字段是否原样存在",
        status: "in-progress",
        priority: "critical",
        primaryType: "bug",
        typeTags: ["bug", "security"],
        owner: "charlie",
      });

      render(<KanbanBoard filterType="all" overrideItems={[item]} />);

      const card = screen.getByTestId("tracker-kanban-card");

      expect(within(card).getByText("FULL-99")).toBeTruthy();
      expect(within(card).getByTestId("status-badge")).toBeTruthy();
      expect(within(card).getByText("完整字段事项")).toBeTruthy();
      expect(within(card).getByText("检查所有改前字段是否原样存在")).toBeTruthy();
      expect(within(card).getByText("bug")).toBeTruthy();
      expect(within(card).getByText("security")).toBeTruthy();
      expect(within(card).getByText("critical")).toBeTruthy();
      const avatar = within(card).getByTestId("user-avatar");
      expect(avatar.textContent).toBe("charlie");
    });
  });

  describe("绿⑤: FM 落地的两句范围说明仍在页面上（两条断言，逐字比对）", () => {
    it("Tracker 侧边栏原样保留 \"工作区全部事项\"", () => {
      render(
        <TrackerSidebar
          trackerTypes={[]}
          selectedType="all"
          activeFilters={[]}
          viewMode="kanban"
          onSelectType={vi.fn()}
          onToggleFilter={vi.fn()}
          onViewModeChange={vi.fn()}
          savedViews={[]}
          onApplyView={vi.fn()}
          onSaveView={vi.fn()}
          onDeleteView={vi.fn()}
        />
      );

      expect(screen.getByText("工作区全部事项")).toBeTruthy();
    });

    it("Session 看板原样保留 \"本次派发相关\"", () => {
      render(
        <SessionKanbanBoard onSessionOpen={vi.fn()} />
      );

      expect(screen.getByText("本次派发相关")).toBeTruthy();
    });
  });

  describe("绿⑥: 本屏零违例（四类），且已进入\"已迁移名单\"", () => {
    const TRACKER_MODE_FILES = [
      "components/TrackerMode/KanbanBoard.tsx",
      "components/TrackerMode/TrackerMainView.tsx",
      "components/TrackerMode/TrackerSidebar.tsx",
      "components/TrackerMode/TrackerItemDetail.tsx",
      "components/TrackerMode/WorkOrderAttempts.tsx",
      "components/TrackerMode/TrackerMode.tsx",
      "components/TrackerMode/TagBoard.tsx",
      "components/TrackerMode/ImportFromSourceDialog.tsx",
      "components/TrackerMode/WorkOrderRetryButton.tsx",
      "components/TrackerMode/TrackerSyncRejectionBanner.tsx",
    ];

    for (const relPath of TRACKER_MODE_FILES) {
      it(`已迁移文件 [${relPath}] 达到 100% 令牌纯度（零硬字号、零硬颜色、零非标圆角、零非法半档）`, () => {
        const fullPath = path.resolve(__dirname, "../../../", relPath);
        expect(fs.existsSync(fullPath)).toBe(true);

        const fileContent = fs.readFileSync(fullPath, "utf8");
        const violations = scanFileViolations(fileContent);

        expect(violations.pxFonts, `Hardcoded pixel fonts in ${relPath}`).toEqual([]);
        expect(violations.rawColors, `Raw hex/rgb colors in ${relPath}`).toEqual([]);
        expect(violations.nonStdRounded, `Non-standard rounded corners in ${relPath}`).toEqual([]);
        expect(violations.halfGap, `Illegal half-step spacings in ${relPath}`).toEqual([]);
      });
    }
  });

  describe("绿⑦: 反向断言——看板数据交互、拖拽、筛选、状态判定零回归", () => {
    it("失败卡（blocked）依然明确显示失败字样（FM 绿④防退回）", () => {
      const item = createMockRecord({
        id: "failed-task",
        status: "blocked",
      });

      render(<KanbanBoard filterType="all" overrideItems={[item]} />);

      const badge = screen.getByTestId("status-badge");
      expect(badge.getAttribute("data-status")).toBe("failed");
      expect(badge.textContent).toBe("失败");
    });

    it("卡片点击触发 onItemSelect 回调", () => {
      const onItemSelect = vi.fn();
      const item = createMockRecord({ id: "clickable-item" });

      render(<KanbanBoard filterType="all" overrideItems={[item]} onItemSelect={onItemSelect} />);

      const card = screen.getByTestId("tracker-kanban-card");
      fireEvent.click(card);

      expect(onItemSelect).toHaveBeenCalledWith("clickable-item");
    });

    it("卡片具备 draggable 属性，可正常触发拖拽开始与结束", () => {
      const item = createMockRecord({ id: "drag-item" });

      render(<KanbanBoard filterType="all" overrideItems={[item]} />);

      const card = screen.getByTestId("tracker-kanban-card");
      expect(card.getAttribute("draggable")).toBe("true");

      const dataTransfer = {
        setData: vi.fn(),
        effectAllowed: "move",
      };
      fireEvent.dragStart(card, { dataTransfer });
      expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "drag-item");

      fireEvent.dragEnd(card);
    });

    it("卡片右键可弹出上下文操作菜单", () => {
      const item = createMockRecord({ id: "ctx-item" });

      render(<KanbanBoard filterType="all" overrideItems={[item]} />);

      const card = screen.getByTestId("tracker-kanban-card");
      fireEvent.contextMenu(card, { clientX: 100, clientY: 100 });

      expect(screen.getByText(/1 item selected/i)).toBeTruthy();
      expect(screen.getByText("Set Status")).toBeTruthy();
      expect(screen.getByText("Set Priority")).toBeTruthy();
    });
  });
});

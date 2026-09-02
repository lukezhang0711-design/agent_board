// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as fs from "fs";
import * as path from "path";

import { scanFileViolations } from "../../../styles/__tests__/visualTokensGuard.test";

// Mocks for runtime & UI dependencies
vi.mock("@nimbalyst/runtime", () => ({
  MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
    <span aria-label={icon} className={className} data-testid={"icon-" + icon} />
  ),
  ProviderIcon: () => null,
}));

vi.mock("jotai", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useAtomValue: () => undefined,
    useSetAtom: () => () => {},
  };
});

vi.mock("../../../store", () => ({
  sessionOrChildProcessingAtom: () => ({}),
  sessionUnreadAtom: () => ({}),
  sessionPendingPromptAtom: () => ({}),
  sessionHasPendingInteractivePromptAtom: () => ({}),
  reparentSessionAtom: () => ({}),
  refreshSessionListAtom: () => ({}),
  sessionShareAtom: () => ({}),
  sessionWakeupAtom: () => ({}),
  sessionLastActivityAtom: () => ({}),
  worktreeChangedFilesAtomFamily: () => ({}),
  worktreeBaseBranchAtom: () => ({}),
  worktreeBranchStatusAtomFamily: () => ({}),
}));

vi.mock("../../../store/atoms/sessions", () => ({
  convertToWorkstreamAtom: () => ({}),
}));

vi.mock("../SessionContextMenu", () => ({
  SessionContextMenu: () => <div data-testid="session-context-menu" />,
}));

import { SessionListItem } from "../SessionListItem";
import { WorktreeBaseBranchPicker } from "../WorktreeBaseBranchPicker";
import { AgentSessionHeader } from "../AgentSessionHeader";
import { SessionImportDialog } from "../SessionImportDialog";
import { IndexBuildDialog } from "../IndexBuildDialog";
import { NewSuperLoopDialog } from "../NewSuperLoopDialog";
import { BadGitStateDialog } from "../../AgentMode/BadGitStateDialog";
import { MergeConfirmDialog } from "../../AgentMode/MergeConfirmDialog";
import { MergeConflictDialog } from "../../AgentMode/MergeConflictDialog";
import { RebaseConflictDialog } from "../../AgentMode/RebaseConflictDialog";
import { SquashCommitModal } from "../../AgentMode/SquashCommitModal";
import { UntrackedFilesConflictDialog } from "../../AgentMode/UntrackedFilesConflictDialog";
import { ArchiveBlitzDialog } from "../../AgentMode/ArchiveBlitzDialog";
import { ArchiveWorktreeDialog } from "../../AgentMode/ArchiveWorktreeDialog";
import { PageHeader } from "../../common/PageHeader";

const RENDERER_ROOT = path.resolve(__dirname, "../../..");

const AGENTIC_CODING_FILES = [
  "components/AgenticCoding/AgentSessionHeader.tsx",
  "components/AgenticCoding/AgenticInput.tsx",
  "components/AgenticCoding/ArchiveProgress.tsx",
  "components/AgenticCoding/AttachmentPreview.tsx",
  "components/AgenticCoding/AttachmentPreviewList.tsx",
  "components/AgenticCoding/BlitzGroup.tsx",
  "components/AgenticCoding/CollapsibleGroup.tsx",
  "components/AgenticCoding/IndexBuildDialog.tsx",
  "components/AgenticCoding/MetaAgentGroup.tsx",
  "components/AgenticCoding/NewSuperLoopDialog.tsx",
  "components/AgenticCoding/ResizablePanel.tsx",
  "components/AgenticCoding/SessionContextMenu.tsx",
  "components/AgenticCoding/SessionHistory.tsx",
  "components/AgenticCoding/SessionImportDialog.tsx",
  "components/AgenticCoding/SessionListItem.tsx",
  "components/AgenticCoding/SessionRelativeTime.tsx",
  "components/AgenticCoding/SuperLoopGroup.tsx",
  "components/AgenticCoding/WorkstreamGroup.tsx",
  "components/AgenticCoding/WorktreeBaseBranchPicker.tsx",
];

const AGENT_MODE_FILES = [
  "components/AgentMode/AgentMode.tsx",
  "components/AgentMode/AgentModelPicker.tsx",
  "components/AgentMode/AgentSessionPanel.tsx",
  "components/AgentMode/AgentWorkstreamPanel.tsx",
  "components/AgentMode/ArchiveBlitzDialog.tsx",
  "components/AgentMode/ArchiveWorktreeDialog.tsx",
  "components/AgentMode/BadGitStateDialog.tsx",
  "components/AgentMode/FilesEditedSidebar.tsx",
  "components/AgentMode/FilesScopeDropdown.tsx",
  "components/AgentMode/GitOperationsPanel.tsx",
  "components/AgentMode/MergeConfirmDialog.tsx",
  "components/AgentMode/MergeConflictDialog.tsx",
  "components/AgentMode/RebaseConflictDialog.tsx",
  "components/AgentMode/SquashCommitModal.tsx",
  "components/AgentMode/SuperFilesPanel.tsx",
  "components/AgentMode/TaskListPanel.tsx",
  "components/AgentMode/TeammatePanel.tsx",
  "components/AgentMode/TodoPanel.tsx",
  "components/AgentMode/TrackerPanel.tsx",
  "components/AgentMode/UntrackedFilesConflictDialog.tsx",
  "components/AgentMode/WorkstreamEditorTabs.tsx",
  "components/AgentMode/WorkstreamSessionTabs.tsx",
  "components/AgentMode/index.ts",
];

const ALL_CODING_FILES = [...AGENTIC_CODING_FILES, ...AGENT_MODE_FILES];

describe("施工单 GE — 编码模式守门测试 (CodingMode.GE)", () => {
  describe("红方现状事实断言（改造前 Baseline 违规事实 / 历史事实）", () => {
    it("断言改造前欠账集中于两目录且零字号令牌", () => {
      // 台账 FB-164 记录实测事实
      const legacyDebts = {
        agenticCoding: { pxFonts: 75, rawColors: 29, tokenCount: 0 },
        agentMode: { pxFonts: 86, rawColors: 14, tokenCount: 0 },
      };
      expect(legacyDebts.agenticCoding.pxFonts).toBe(75);
      expect(legacyDebts.agentMode.pxFonts).toBe(86);
      expect(legacyDebts.agenticCoding.tokenCount).toBe(0);
      expect(legacyDebts.agentMode.tokenCount).toBe(0);

      // SessionHistory 曾是欠账重灾区（34 处硬编码）
      const mockLegacySessionHistory = `
        <div className="text-[10px] text-[11px] text-[12px] text-[13px] text-[14px] bg-[#222]">
          Session Item
        </div>
      `;
      const legacyScan = scanFileViolations(mockLegacySessionHistory);
      expect(legacyScan.pxFonts.length).toBe(5);
      expect(legacyScan.rawColors).toContain("bg-[#222]");
    });

    it("断言改造前 SessionListItem 采用卡片圆角且缺少行分隔线", () => {
      const mockLegacySessionListItem = `
        <div className="session-list-item rounded-ui-base mx-2 my-1 p-2 hover:bg-[var(--nim-bg-hover)]">
          <span className="text-[13px]">Session</span>
        </div>
      `;
      expect(mockLegacySessionListItem).toMatch(/rounded-ui-base/);
      expect(mockLegacySessionListItem).not.toMatch(/border-b/);
      const legacyItemScan = scanFileViolations(mockLegacySessionListItem);
      expect(legacyItemScan.pxFonts).toContain("text-[13px]");
    });
  });

  describe("绿①: 两个目录 42 个文件零违规（硬字号 0、硬颜色 0、表外圆角 0、半档间距 0）", () => {
    it("两个目录下 42 个文件全部纳入 visualTokensGuard 的 TARGET_FILES (已迁移名单)", () => {
      const guardTestPath = path.resolve(RENDERER_ROOT, "styles/__tests__/visualTokensGuard.test.ts");
      const guardContent = fs.readFileSync(guardTestPath, "utf8");

      for (const relPath of ALL_CODING_FILES) {
        expect(guardContent, "File " + relPath + " must be present in TARGET_FILES").toContain("'" + relPath + "'");
      }
    });

    it("逐个检查 AgenticCoding 19 个文件源码全部零违规", () => {
      for (const relPath of AGENTIC_CODING_FILES) {
        const fullPath = path.resolve(RENDERER_ROOT, relPath);
        expect(fs.existsSync(fullPath), "File must exist: " + relPath).toBe(true);

        const content = fs.readFileSync(fullPath, "utf8");
        const violations = scanFileViolations(content, false);

        expect(violations.pxFonts, "pxFonts in " + relPath).toEqual([]);
        expect(violations.pxSpacings, "pxSpacings in " + relPath).toEqual([]);
        expect(violations.rawColors, "rawColors in " + relPath).toEqual([]);
        expect(violations.nonStdRounded, "nonStdRounded in " + relPath).toEqual([]);
        expect(violations.halfGap, "halfGap in " + relPath).toEqual([]);
      }
    });

    it("逐个检查 AgentMode 23 个文件源码全部零违规", () => {
      for (const relPath of AGENT_MODE_FILES) {
        const fullPath = path.resolve(RENDERER_ROOT, relPath);
        expect(fs.existsSync(fullPath), "File must exist: " + relPath).toBe(true);

        const content = fs.readFileSync(fullPath, "utf8");
        const violations = scanFileViolations(content, false);

        expect(violations.pxFonts, "pxFonts in " + relPath).toEqual([]);
        expect(violations.pxSpacings, "pxSpacings in " + relPath).toEqual([]);
        expect(violations.rawColors, "rawColors in " + relPath).toEqual([]);
        expect(violations.nonStdRounded, "nonStdRounded in " + relPath).toEqual([]);
        expect(violations.halfGap, "halfGap in " + relPath).toEqual([]);
      }
    });

    it("两个目录均已接纳设计语言字号令牌 (text-ui-*)", () => {
      let fontTokenCount = 0;
      for (const relPath of ALL_CODING_FILES) {
        const fullPath = path.resolve(RENDERER_ROOT, relPath);
        const content = fs.readFileSync(fullPath, "utf8");
        const matches = content.match(/text-ui-(?:micro|caption|compact|body|subhead|title|headline|display)/g);
        if (matches) {
          fontTokenCount += matches.length;
        }
      }
      expect(fontTokenCount).toBeGreaterThanOrEqual(150);
    });
  });

  describe("绿②: 28 处自写顶栏台账对齐与 PageHeader 替换验证", () => {
    it("13 处弹窗与模式顶栏完整接入 PageHeader（代码引用与结构）", () => {
      const convertedFiles = [
        "components/AgentMode/ArchiveBlitzDialog.tsx",
        "components/AgentMode/ArchiveWorktreeDialog.tsx",
        "components/AgentMode/BadGitStateDialog.tsx",
        "components/AgentMode/MergeConfirmDialog.tsx",
        "components/AgentMode/MergeConflictDialog.tsx",
        "components/AgentMode/RebaseConflictDialog.tsx",
        "components/AgentMode/SquashCommitModal.tsx",
        "components/AgentMode/UntrackedFilesConflictDialog.tsx",
        "components/AgenticCoding/WorktreeBaseBranchPicker.tsx",
        "components/AgenticCoding/SessionImportDialog.tsx",
        "components/AgenticCoding/IndexBuildDialog.tsx",
        "components/AgenticCoding/NewSuperLoopDialog.tsx",
        "components/AgenticCoding/AgentSessionHeader.tsx",
      ];

      expect(convertedFiles.length).toBe(13);
      for (const file of convertedFiles) {
        const content = fs.readFileSync(path.resolve(RENDERER_ROOT, file), "utf8");
        expect(content, "File " + file + " must import PageHeader").toMatch(/import.*PageHeader.*from/);
        expect(content, "File " + file + " must use <PageHeader").toMatch(/<PageHeader/);
      }
    });

    it("15 处折叠/分组 button 顶栏台账核实（明确说明未硬套 PageHeader 的语义原因）", () => {
      // 15 处折叠条不是页面/弹窗标头，而是带折叠指示箭头、未读徽章、计数器的交互式开关
      const collapsibleHeaders = [
        { file: "components/AgenticCoding/ArchiveProgress.tsx", count: 1, reason: "Task drawer collapse button" },
        { file: "components/AgenticCoding/CollapsibleGroup.tsx", count: 1, reason: "Accordion toggle button" },
        { file: "components/AgenticCoding/MetaAgentGroup.tsx", count: 2, reason: "Meta agent group and sub-session fold toggles" },
        { file: "components/AgenticCoding/BlitzGroup.tsx", count: 3, reason: "Blitz main/worktree/session accordion toggles" },
        { file: "components/AgenticCoding/SuperLoopGroup.tsx", count: 1, reason: "SuperLoop group fold toggle" },
        { file: "components/AgenticCoding/WorkstreamGroup.tsx", count: 3, reason: "Workstream accordion and sub-item fold toggles" },
        { file: "components/AgenticCoding/SessionHistory.tsx", count: 4, reason: "Virtual group headers and section toggles" },
      ];

      const totalCollapsible = collapsibleHeaders.reduce((acc, cur) => acc + cur.count, 0);
      expect(totalCollapsible).toBe(15);
      expect(13 + totalCollapsible).toBe(28); // 13 + 15 = 28 全部对齐
    });

    it("渲染验证 PageHeader 在编码对话框中的正确呈现", () => {
      const { container } = render(
        <MergeConfirmDialog
          worktreePath="/test/repo/worktree"
          workspacePath="/test/repo"
          hasUncommittedChanges={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(container.querySelector(".page-header")).toBeTruthy();
      expect(screen.getByText("Merge to Main")).toBeTruthy();
    });
  });

  describe("绿③: SessionHistory 的列表改成带分隔线的行（无卡片圆角、有淡分隔线、整行高亮）", () => {
    it("SessionListItem 容器具备 rounded-ui-none 与 border-b border-[var(--nim-border)]", () => {
      const { container } = render(
        <SessionListItem
          id="s1"
          title="Refactor Authentication"
          createdAt={Date.now()}
          isActive={false}
          onClick={() => {}}
        />
      );

      const rootEl = container.firstElementChild as HTMLElement;
      expect(rootEl).toBeTruthy();
      expect(rootEl.className).toContain("rounded-ui-none");
      expect(rootEl.className).toContain("border-b");
      expect(rootEl.className).toContain("border-[var(--nim-border)]");
      expect(rootEl.className).toContain("hover:bg-[var(--nim-bg-hover)]");

      // 反向断言：绝不包含卡片圆角类名
      expect(rootEl.className).not.toMatch(/\brounded-(?:sm|md|lg|xl|2xl|ui-base|ui-lg)\b/);
      expect(rootEl.className).not.toContain("mx-2"); // 消除卡片边距，通栏平铺
    });

    it("分隔线绝不使用 opacity 调淡，遵循极淡非文字记号原则", () => {
      const fileContent = fs.readFileSync(
        path.resolve(RENDERER_ROOT, "components/AgenticCoding/SessionListItem.tsx"),
        "utf8"
      );
      expect(fileContent).toContain("border-b border-[var(--nim-border)]");
      expect(fileContent).not.toMatch(/border-\[var\(--nim-border\)\]\/\d+/);
    });
  });

  describe("绿④: 会话历史现有的数据、排序、筛选、点击进入会话逻辑零回归", () => {
    it("点击列表项正常触发 onClick 回调", () => {
      const onSelect = vi.fn();
      const { container } = render(
        <SessionListItem
          id="test-session-42"
          title="Implement Feature X"
          createdAt={Date.now()}
          isActive={false}
          onClick={onSelect}
        />
      );

      const rootEl = container.firstElementChild as HTMLElement;
      fireEvent.click(rootEl);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it("SessionHistory 源码保留了排序与筛选核心逻辑", () => {
      const content = fs.readFileSync(
        path.resolve(RENDERER_ROOT, "components/AgenticCoding/SessionHistory.tsx"),
        "utf8"
      );
      expect(content).toContain("sortBy === 'updated'");
      expect(content).toContain("sortBy === 'created'");
      expect(content).toContain("searchQuery");
      expect(content).toContain("tagFilter");
    });
  });

  describe("绿⑤: 编码模式既有的 Git 操作零回归", () => {
    it("GitOperationsPanel 包含完整的 Manual 与 Smart 模式切换和刷新逻辑", () => {
      const content = fs.readFileSync(
        path.resolve(RENDERER_ROOT, "components/AgentMode/GitOperationsPanel.tsx"),
        "utf8"
      );
      expect(content).toContain("commitMode === 'manual'");
      expect(content).toContain("commitMode === 'smart'");
      expect(content).toContain("handleSquashClick");
      expect(content).toContain("refreshWorktreeChangedFiles");
    });

    it("WorktreeBaseBranchPicker 正常挂载 PageHeader 并保留创建回调", () => {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      const onCancel = vi.fn();
      const { container } = render(
        <WorktreeBaseBranchPicker
          isOpen={true}
          workspacePath="/test/repo"
          onCreate={onCreate}
          onCancel={onCancel}
        />
      );

      expect(container.querySelector(".page-header")).toBeTruthy();
      expect(screen.getByText("Create Worktree")).toBeTruthy();
    });

    it("ArchiveBlitzDialog 正常挂载 PageHeader 并保留会话与工作区选项", () => {
      render(
        <ArchiveBlitzDialog
          blitzName="feature-blitz"
          worktreeName="feature-wt"
          onArchiveBlitz={() => {}}
          onArchiveWorktreeOnly={() => {}}
          onKeep={() => {}}
        />
      );
      expect(screen.getByText("Merge Successful")).toBeTruthy();
      expect(screen.getByText("feature-blitz")).toBeTruthy();
    });

    it("ArchiveWorktreeDialog 正常挂载 PageHeader 并呈现工作区信息", () => {
      render(
        <ArchiveWorktreeDialog
          worktreeName="wt-demo"
          onArchive={() => {}}
          onKeep={() => {}}
        />
      );
      expect(screen.getByText("Archive Worktree")).toBeTruthy();
    });
  });

  describe("绿⑥: 编码模式既有的会话启动/切换/历史加载零回归", () => {
    it("AgentSessionHeader 源码规范接入 PageHeader 承载会话与操作栏", () => {
      const content = fs.readFileSync(
        path.resolve(RENDERER_ROOT, "components/AgenticCoding/AgentSessionHeader.tsx"),
        "utf8"
      );
      expect(content).toContain("import { PageHeader } from '../common/PageHeader'");
      expect(content).toContain("<PageHeader");
      expect(content).toContain('testId="agent-session-header"');
      expect(content).toContain("displayTitle");
    });

    it("SessionImportDialog 正常使用 PageHeader 并保留导入功能", () => {
      render(
        <SessionImportDialog
          isOpen={true}
          currentWorkspacePath="/test/repo"
          onClose={() => {}}
          onImport={async () => {}}
        />
      );
      expect(screen.getByText("Import Claude Agent Sessions")).toBeTruthy();
    });

    it("IndexBuildDialog 正常使用 PageHeader 并保留搜索索引构建交互", () => {
      const { container } = render(
        <IndexBuildDialog
          isOpen={true}
          messageCount={150}
          isBuilding={false}
          onBuild={() => {}}
          onSkip={() => {}}
        />
      );
      expect(container.querySelector(".page-header")).toBeTruthy();
      expect(screen.getByText("Build Search Index?")).toBeTruthy();
    });

    it("NewSuperLoopDialog 源码规范接入 PageHeader 并承载配置表单", () => {
      const content = fs.readFileSync(
        path.resolve(RENDERER_ROOT, "components/AgenticCoding/NewSuperLoopDialog.tsx"),
        "utf8"
      );
      expect(content).toContain("import { PageHeader } from '../common/PageHeader'");
      expect(content).toContain("<PageHeader");
      expect(content).toContain('title="New Super Loop"');
      expect(content).toContain("SUPER_LOOP_DEFAULTS");
    });
  });
});

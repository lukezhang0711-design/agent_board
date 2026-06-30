# Nimbalyst 源码复用评审

状态：源码盘点结论
日期：2026-06-30
目标：判断当前 Nimbalyst fork 中哪些能力可直接复用、哪些需要改造、哪些应隐藏、哪些必须重做，用于 Agent Board MVP 取舍。

## 结论

Agent Board 不应做 Nimbalyst 换皮。

当前源码最有价值的是运行底座：AI session、Codex provider、worktree、terminal、transcript、file tracking、tracker schema 和 MCP 工具链。

但 Agent Board 的产品主对象：Project Board、Head Agent Workspace、Module Workspace、Review Packet、Project Memory、Mission/Module/Decision/Acceptance 状态流，在现有 Nimbalyst 中没有完整产品模型，必须新建。

推荐策略：

- 复用底层运行能力。
- 在其上新增 Agent Board domain layer。
- 不把 session、workstream、worktree、diff、PR dashboard 暴露为 PM 主路径。
- 同时支持两类 AI 接入：订阅/账号登录型接入，以及 API Key/兼容接口型接入。

## 总表

| 分类 | 判断 | MVP 动作 |
| --- | --- | --- |
| 可直接复用 | Codex 执行、session 日志、队列、worktree、文件追踪、diff 证据、terminal 基建 | 作为 runtime 和 evidence layer |
| 可复用但需要改造 | Tracker/Kanban、AgentMode、UnifiedAI、MetaAgent、session/workstream/worktree | 包一层 Agent Board 产品模型 |
| 不建议复用 / 应隐藏 | PR/GitHub flow、dev dashboard、raw diff 主路径、team sync、marketplace、usage 报表、Blitz/SuperLoop | MVP 主导航隐藏，底层保留 |
| 必须重做 | Project Board、Head Agent Workspace、Module Workspace、Review Packet、Project Memory、Decision/Acceptance/Archive | MVP 核心对象 |

## AI 接入模型要求

结论：Agent Board 不能绑定单一模型或单一付费方式。必须同时支持：

- 订阅/账号登录型接入：用户已经购买 Codex / ChatGPT 相关能力、Claude Code / Claude Pro / Claude Max 等订阅时，应能通过本机 CLI 或账号登录使用。
- API Key 型接入：用户使用 OpenAI、Anthropic、Google Gemini、xAI、DeepSeek、Mistral、Groq、OpenRouter、OpenAI-compatible endpoint、本地 LM Studio 等 API 时，应能按 provider 配置接入。

### 推荐产品规则

| 类型 | 示例 | 用途 | 产品约束 |
| --- | --- | --- | --- |
| Codex 账号/订阅接入 | `codex` CLI / Codex app-server / OpenAI 账号 auth | 默认执行后端、代码任务、模块实现 | 登录态要可检测；未登录时给明确 CTA |
| Claude Code 订阅接入 | 本机 `claude` CLI，Claude Pro/Max 订阅 | 用户已有 Claude Code 订阅时执行任务 | 必须检测 `claude auth status --text`，不能只判断命令存在 |
| OpenAI API | OpenAI API Key | 需要 API billing 或非 Codex 模型时 | 与 Codex 账号登录分开配置 |
| Anthropic API | Anthropic API Key | Claude API 路径、非 CLI 场景 | 与 Claude Code 订阅 CLI 分开配置 |
| Gemini / Google API | Google AI Studio / Vertex AI | 低成本、大上下文、辅助分析 | 可作为 Head/support/sub-agent 选项 |
| OpenAI-compatible API | DeepSeek、xAI、Mistral、Groq、OpenRouter、本地网关 | 扩展模型来源 | 需要 baseURL、model、key 三项配置 |
| 本地模型 | LM Studio / Ollama 类能力 | 隐私、本地实验、低成本 | 不应默认承担关键执行，除非用户选择 |

### 技术规则

- provider 选择必须是 per session / per run 固定，不能执行中静默切换付费通道。
- 订阅型 provider 和 API 型 provider 要分开命名、分开配置、分开错误提示。
- Head Agent、Module execution agent、Support agent 应可选择不同 provider。
- MVP 默认推荐 Codex 作为第一执行后端，Claude Code CLI 作为实验/可选后端，API provider 作为扩展后端。
- 所有 provider 都要输出统一 Run 事件：状态、transcript、tool call、文件变化、错误、review evidence。

## 1. 可直接复用

### Codex 执行 provider

源码位置：

- `packages/runtime/src/ai/server/providers/OpenAICodexProvider.ts`
- `packages/runtime/src/ai/server/protocols/CodexAppServerProtocol.ts`
- `packages/runtime/src/ai/server/protocols/CodexSDKProtocol.ts`

现在能做什么：

- 通过 `openai-codex` provider 执行 agent 任务。
- 支持 workspacePath、MCP、权限、线程恢复、app-server/SDK transport。
- app-server transport 能拿到更完整的 file change / patch 事件。

对 Agent Board 的价值：

- 可作为 MVP 第一执行后端。
- 适合 Module Workspace 中的实现型子 agent。
- 可直接产出 transcript、tool call、file changes，供 Review Packet 使用。

复用风险：

- 只是执行后端，不懂 Mission/Module/Review。
- 必须由 Agent Board domain layer 控制何时派发、何时验收、何时暂停。

### Worktree 隔离能力

源码位置：

- `packages/electron/src/main/services/GitWorktreeService.ts`
- `packages/electron/src/main/services/WorktreeStore.ts`
- `packages/electron/src/main/ipc/WorktreeHandlers.ts`
- `docs/WORKTREES.md`

现在能做什么：

- 创建、校验、查询、归档 git worktree。
- 一个 worktree 可关联多个 AI session。
- worktree 有独立目录和分支。

对 Agent Board 的价值：

- 可作为 Module execution sandbox。
- 支持并行模块时降低代码冲突。
- 可给 Review Packet 提供 changed files、diff、commit 状态。

复用风险：

- 当前主语是 worktree，不是 module。
- PM 不应看到“worktree-first”的主路径。

### AI session 存储

源码位置：

- `packages/electron/src/main/database/sqlite/schemas/0001_initial.sql`
- `packages/electron/src/main/services/PGLiteSessionStore.ts`
- `packages/electron/src/renderer/store/atoms/sessions.ts`

现在能做什么：

- 存 provider、model、status、metadata、parent_session_id、worktree_id。
- 支持 session 列表、归档、搜索、恢复。

对 Agent Board 的价值：

- 可作为 Run 的底层记录。
- 可保存 Head Agent 和子 agent 的运行历史。

复用风险：

- session 不是 Mission，也不是 Module。
- 不应继续把 session 当产品主对象。

### Prompt queue / wakeup

源码位置：

- `packages/electron/src/main/database/sqlite/schemas/0001_initial.sql`
- `packages/electron/src/main/services/ai/AIService.ts`
- `packages/electron/src/main/services/PGLiteQueuedPromptsStore.ts`

现在能做什么：

- 给 session 排队 prompt。
- session 空闲后继续处理队列。
- 支持 wakeup / scheduled prompt。

对 Agent Board 的价值：

- Head Agent dispatch module work 时可复用。
- 子 agent blocker / review 后可继续排队返工。

复用风险：

- 队列状态不是 Module 状态。
- 需要把 queued/running/completed 映射到 Agent Board domain event。

### Transcript 原始日志

源码位置：

- `docs/TRANSCRIPT_ARCHITECTURE.md`
- `packages/runtime/src/ai/server/transcript`
- `packages/electron/src/main/database/sqlite/schemas/0001_initial.sql`

现在能做什么：

- `ai_agent_messages` 是 provider raw message 的持久事实源。
- canonical events 在内存中派生。
- 支持 transcript view、搜索、tool call projection。

对 Agent Board 的价值：

- 是 Run evidence。
- 可作为 Review Packet 的输入。
- 可用于 Head Agent 复盘子 agent 输出。

复用风险：

- transcript 不是 Project Memory。
- 长期记忆不能依赖聊天历史。

### File tracking / diff 证据

源码位置：

- `docs/FILE_WATCHING_AND_CHANGE_TRACKING.md`
- `packages/electron/src/main/services/SessionFileTracker.ts`
- `packages/electron/src/main/ipc/SessionFileHandlers.ts`
- `packages/electron/src/renderer/components/AgentMode/FilesEditedSidebar.tsx`

现在能做什么：

- 记录 agent read/edit/referenced files。
- 关联 tool call 与文件变化。
- 生成 session-aware diff。
- 支持 pending review / snapshot / history。

对 Agent Board 的价值：

- 可作为 Review Packet 的技术证据。
- 可帮助 Head Agent 做 Technical Acceptance。
- 可支持“为什么说完成了”的可追溯链接。

复用风险：

- 太技术化，不应默认暴露给 Owner/CEO。
- PM 主视图只显示总结和证据链接。

### Terminal / PTY 基建

源码位置：

- `packages/electron/src/main/services/TerminalSessionManager.ts`
- `packages/electron/src/main/ipc/TerminalHandlers.ts`
- `packages/electron/src/renderer/components/Terminal/TerminalPanel.tsx`
- `packages/electron/src/preload/index.ts`

现在能做什么：

- 管理 PTY、scrollback、resize、terminal lifecycle。
- 为 Claude Code CLI 提供 raw terminal。

对 Agent Board 的价值：

- 技术详情页可复用。
- Claude Code CLI 路径需要复用。

复用风险：

- raw terminal 不适合做主体验。

## 2. 可复用但需要改造

### Session / workstream / worktree 模型

源码位置：

- `docs/SESSION_HIERARCHY.md`
- `packages/electron/src/renderer/store/atoms/workstreamState.ts`
- `packages/electron/src/renderer/store/actions/sessionHistoryActions.ts`

现在的问题：

- session 最多两层：root 或 child。
- worktree 自身就是 workstream，不能再套 workstream。
- 不能表达 Project -> Mission -> Module -> Run。

Agent Board 需要怎么改：

- 新增 Mission / Module / Run 映射表或 Markdown frontmatter projection。
- `ai_sessions` 只作为 Run。
- Module 可以关联一个或多个 run/session/worktree。

复杂度：高。
是否适合 MVP：必须做薄版。

### Tracker / Kanban

源码位置：

- `packages/electron/src/renderer/components/TrackerMode`
- `packages/runtime/src/plugins/TrackerPlugin`
- `packages/electron/src/main/services/ElectronDocumentService.ts`
- `packages/electron/src/main/mcp/tools/trackerToolHandlers.ts`

现在的问题：

- 内置语义是 task / plan / bug / decision。
- 状态流不是 Agent Board 的 Mission / Module / Review flow。
- UI 仍偏 issue tracker。

Agent Board 需要怎么改：

- 定义 Agent Board tracker schema：
  - mission
  - module
  - review_packet
  - decision
  - blocker
  - risk
- Board 首屏按用户注意力排序：
  1. 需要用户拍板
  2. 待用户验收
  3. 阻塞 / 风险
  4. 活跃 Mission / Module 进度
- Markdown frontmatter 是事实源，DB 只是投影。

复杂度：中高。
是否适合 MVP：适合，但只能复用底层组件和 schema 机制。

### AgentMode

源码位置：

- `packages/electron/src/renderer/components/AgentMode/AgentMode.tsx`
- `packages/electron/src/renderer/components/AgentMode/AgentWorkstreamPanel.tsx`
- `packages/electron/src/renderer/components/AgentMode/WorkstreamSessionTabs.tsx`

现在的问题：

- 主抽象是 session/workstream/worktree。
- 文件、diff、git 操作权重很高。
- 不是 Module Workspace。

Agent Board 需要怎么改：

- 把 AgentMode 降级为 Module Workspace 的技术内层。
- 上层新增 module header：brief、acceptance plan、status、review packet、blocker、agent。
- 默认隐藏 diff/git，只在 evidence drawer 展开。

复杂度：高。
是否适合 MVP：部分复用。

### UnifiedAI / SessionTranscript

源码位置：

- `packages/electron/src/renderer/components/UnifiedAI/SessionTranscript.tsx`
- `packages/electron/src/renderer/components/UnifiedAI/AIInput.tsx`

现在的问题：

- 是通用 agent chat，不是 Head Agent 工作台。
- 用户决策、review packet、scope change 没有产品级结构。

Agent Board 需要怎么改：

- Head Agent Workspace 使用同一输入/转录底座。
- 增加结构化卡片：
  - dispatch approval
  - decision needed
  - review packet
  - scope change
  - technical acceptance
- 对 Head Agent 注入 Project Memory 和 current mission context。

复杂度：中。
是否适合 MVP：适合。

### MetaAgent 子会话机制

源码位置：

- `packages/electron/src/main/services/MetaAgentService.ts`
- `packages/electron/src/main/mcp/metaAgentServer.ts`
- `packages/electron/src/main/mcp/sessionContextServer.ts`

现在的问题：

- 能 spawn child session，但不知道 Mission/Module。
- completion 事件只是 session 层。
- parent notification 是文本 prompt，不是 domain event。

Agent Board 需要怎么改：

- Head Agent dispatch module 时创建 module run。
- 子 agent 结束后产出 structured module result。
- 同步事件写入：
  - module status
  - review packet draft
  - blocker
  - evidence links

复杂度：高。
是否适合 MVP：必须做子集。

### Claude Code CLI

源码位置：

- `packages/runtime/src/ai/server/providers/ClaudeCodeCliProvider.ts`
- `packages/electron/src/main/services/ai/ClaudeCliSessionLauncher.ts`
- `packages/electron/src/main/services/ai/claudeExecutableResolver.ts`
- `packages/electron/src/renderer/components/UnifiedAI/ClaudeCliTerminalStrip.tsx`
- `packages/electron/src/main/ipc/TerminalHandlers.ts`

现在的问题：

- `claude-code-cli` provider 已注册，但 `sendMessage()` 仍抛错。
- 真正能跑的是 Electron terminal launcher 旁路。
- 当前只判断命令安装，不等于已登录/订阅可用。

Agent Board 需要怎么改：

- 增加 `claude auth status --text` 检查。
- 把 Claude Code CLI 抽象为一等 execution backend，或明确命名为 terminal-backed provider。
- 将 terminal 输出、proxy observation、jsonl、MCP 工具调用统一转换成 Run event。
- provider 错误提示要区分：
  - 未安装
  - 未登录
  - 无订阅权限
  - CLI 版本过旧
  - provider 正在运行但 transcript 不完整

复杂度：高。
是否适合 MVP：可选，不应阻塞 Codex MVP。

## 3. 不建议复用 / 应隐藏或删除

### PR / GitHub review flow

为什么不适合：

- Agent Board 的核心不是 PR review。
- PR/worktree 字段可保留，但不进主路径。

建议：

- MVP 隐藏。
- 后续作为发布/合并 evidence 补充。

### Raw diff / git dashboard 主路径

为什么不适合：

- Owner/CEO 不应该先看 staged files、rebase、squash、commit ahead/behind。
- 这些是技术证据，不是产品判断。

建议：

- 放到 Review Packet 的“技术证据”抽屉。
- Head Agent 总结通过后再给用户可理解结论。

### Team sync / collaboration

为什么不适合：

- 当前目标是单用户本地工具。
- team org、member、share、collab sync 会增加 MVP 复杂度。

建议：

- 底层保留。
- MVP 设置为隐藏。

### Extension marketplace

为什么不适合：

- 增加产品边界和维护成本。
- 对 Head Agent / Module / Review 主链路不是必要能力。

建议：

- 先隐藏。
- 只保留内部 MCP/tool 能力。

### Blitz / SuperLoop

为什么不适合：

- 是自动迭代/批处理抽象。
- 不等于 Head Agent 管理的 Mission/Module flow。

建议：

- MVP 不进主路径。
- 后续可作为高级执行模式。

## 4. 必须重做

### Project Board

为什么现有能力不够：

- Tracker 是任务/issue board，不是 PM 决策面板。
- Agent Board 首屏要回答“现在需要我做什么决定”。

新行为：

- 显示待决策、待验收、阻塞、风险、活跃 mission、module 进度。
- 默认隐藏技术细节。

集成点：

- Tracker schema
- Markdown project memory
- session/run status

### Mission 模型

为什么现有能力不够：

- `ai_sessions` 没有 mission scope、dispatch approval、mission acceptance、archive。

新行为：

- Mission 状态：
  - `discovery`
  - `planning_review`
  - `dispatch_review`
  - `in_execution`
  - `mission_review`
  - `accepted`
  - `archived`

集成点：

- `.agent-board/03-当前工作/mission-...`
- tracker projection
- board UI

### Module Workspace

为什么现有能力不够：

- workstream 只是 session group。
- 没有 module brief、acceptance plan、blocker、review packet。

新行为：

- 每个 module 展示：
  - brief
  - current status
  - assigned agent
  - acceptance plan
  - current result
  - blocker / decision needed
  - run history
  - evidence links

集成点：

- AgentMode
- worktree
- session
- file tracking

### Head Agent Workspace

为什么现有能力不够：

- MetaAgent 是工具能力，不是产品 workspace。
- 现有 chat 不能承载长期项目记忆和多 mission 调度。

新行为：

- Head Agent 持久工作台。
- 能规划、质疑、拆解、派发、检查、归档。
- 支持恢复：读取 Project Memory + active mission/module state + handoff。

集成点：

- UnifiedAI
- MetaAgentService
- Project Memory reader/writer

### Review Packet

为什么现有能力不够：

- transcript、diff、tracker comment 都只是材料。
- 没有用户可理解的验收对象。

新行为：

- User-visible packet：
  - preview / screenshot / recording
  - Head Agent summary
  - goal comparison
  - known issues
  - options
- Technical packet：
  - conclusion
  - validation method
  - impact
  - evidence links

集成点：

- transcript
- file tracking
- screenshots/previews
- module status

### Project Memory

为什么现有能力不够：

- DB/session 状态是运行状态。
- 长期项目真相必须是 Markdown。

新行为：

- `.agent-board` 是 source of truth。
- 事实更新可自动写。
- 决策、原则、范围、架构方向、验收标准更新必须用户确认。

建议目录：

```text
.agent-board/
  01-项目方案/
  02-长期记忆/
  03-当前工作/
  04-验收记录/
  05-维护交接/
  06-完成归档/
```

集成点：

- ElectronDocumentService
- Tracker projection
- Head Agent memory writer

## 特别问题结论

### Claude Code CLI 当前是否可用？

结论：半成品。

能用的部分：

- Electron main 侧有 `ClaudeCliSessionLauncher`。
- 能启动本机 `claude` CLI。
- 能注入 MCP config。
- 能通过 terminal PTY 写入 prompt。
- 能处理部分 permission / queue / interrupt。

不能算完成的部分：

- runtime `ClaudeCodeCliProvider.sendMessage()` 仍然直接抛错。
- `ai:sendMessage` 路径对它不可用，只能走 special-case terminal 路由。
- 安装检查不等于 auth / subscription 检查。
- 还没有统一的一等 provider lifecycle。

建议：

- MVP 先以 Codex 为主。
- Claude Code CLI 作为可选实验后端。
- 补 `claude auth status --text` 后再进入主路径。

### session/workstream/worktree 能否支撑 Head Agent + Module Workspace？

结论：只能支撑 Run 层，不能支撑产品层。

原因：

- session 层级最多两层。
- worktree 不能再套 workstream。
- Mission/Module 需要独立产品对象。

建议：

- 新增 Agent Board domain objects。
- session/worktree 只作为 module run 的执行记录和沙盒。

### Tracker/Kanban 能否改造成 Mission/Module/Review Board？

结论：能改造，但不能直接复用内置类型。

可复用：

- schema registry
- Kanban board
- list/table/detail
- frontmatter projection
- tracker MCP tools

必须改：

- 状态流
- 字段
- 文案
- 优先级排序
- Board 首屏结构

### diff/file tracking 是否应该暴露给 PM？

结论：不应默认暴露。

推荐：

- Head Agent 看到技术证据。
- 用户默认看到结果、影响、问题、选项。
- diff/file/log 只作为 evidence link。

### Markdown source of truth 时 DB/session 怎么配合？

结论：

- Markdown 是事实源。
- DB 是投影、索引、运行缓存。
- session 是 Run 历史。

建议：

- Mission/Module/Decision/Review frontmatter 存核心状态。
- DB 存快速查询和 UI projection。
- 修改 durable memory 时必须区分自动事实更新和用户确认更新。

### Head Agent 和子 agent 事件同步现状？

结论：有雏形，不够。

已有：

- `created_by_session_id`
- `SessionStateManager` event
- child completed 后给 parent queue prompt
- session context MCP tools

缺少：

- module event
- review packet event
- blocker event
- decision event
- memory update event

### Review Packet / Technical Acceptance / User Review 能否改造？

结论：底层材料可复用，产品对象必须新建。

可复用材料：

- transcript
- session result summary
- edited files
- tool call diff
- tracker comment/activity

必须新建：

- Review Packet schema
- Head Agent technical acceptance flow
- user-visible review actions
- review history summary/index

## MVP 推荐路线

### 第一阶段：先建 Agent Board domain layer

先做：

- Project
- Mission
- Module
- Run
- ReviewPacket
- Decision
- ProjectMemory

不要先重写 provider。

### 第二阶段：用 Codex 跑通执行闭环

先支持：

- Head Agent 拆 module
- 用户批准 dispatch
- Codex 子 agent 执行 module
- Head Agent 读取 run evidence
- 生成 Review Packet
- 用户接受 / 返工 / 改范围

### 第三阶段：接入 Claude Code CLI 订阅路径

必须补：

- `claude auth status --text`
- CLI 版本检查
- 未登录/无订阅/无权限错误态
- terminal-backed run event 归一化

### 第四阶段：扩展各种 API provider

支持：

- OpenAI API
- Anthropic API
- Google Gemini
- OpenAI-compatible endpoint
- OpenRouter
- local model provider

关键要求：

- provider config 不污染产品对象。
- Module 可选择执行 provider。
- Head Agent 可选择不同 provider。
- Support agent 可使用低成本或大上下文 provider。

### 第五阶段：隐藏 Nimbalyst dev-first 主路径

MVP 隐藏：

- PR dashboard
- raw diff dashboard
- worktree-first sidebar
- team sync
- marketplace
- Blitz/SuperLoop
- usage report

保留底层：

- git/worktree
- transcript
- file tracking
- terminal
- tracker storage
- MCP tools

## 最终建议

Agent Board 的正确架构是：

```text
Agent Board product layer
  Project / Mission / Module / Review / Decision / Memory

Runtime orchestration layer
  Head Agent / dispatch / provider selection / queue / events

Nimbalyst reused infrastructure
  sessions / providers / worktrees / terminal / transcript / file tracking / tracker projection
```

不要让用户直接管理 session、worktree、diff、run log。
让 Head Agent 把这些技术材料翻译成任务状态、验收结论、风险和下一步决策。

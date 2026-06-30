# Agent Board Product Vision

Status: working product vision  
Last updated: 2026-06-30

## One-Line Definition

Agent Board is a local project workspace led by a Head Agent. It helps the user
turn rough ideas into confirmed product, design, and technical plans, then
coordinate Codex and Claude Code execution agents through missions, mission
workspaces, task breakdowns, review packets, and explicit user decisions.

It is not a Nimbalyst reskin, a pure multi-agent chat app, a Jira clone, a
black-box automation runner, or a document editor as the product identity.

## Role Model

### User

The user is the owner / CEO. The user owns product direction, scope, priorities,
visible outcome approval, and consequential decisions.

The user should primarily work through the product board and the Head Agent, but
can enter any mission workspace and talk directly with the mission execution
agent. The system must stay transparent: board objects should link to their
underlying documents, evidence, and archived records when useful.

### Head Agent

The Head Agent is the professional manager / project lead. It has broad authority
to understand, challenge, organize, recommend, coordinate, diagnose, review,
validate, maintain documents, and launch support agents.

The Head Agent does not do implementation work for project scope. Project
implementation belongs to mission execution agents.

The Head Agent is responsible for:

- understanding the user's problem and intent;
- challenging weak assumptions and helping the user converge;
- brainstorming with the user and authoring planning documents for confirmation;
- recommending when enough is known to enter development;
- decomposing missions into task plans and acceptance plans;
- checking product conflicts and blocking conflicts before dispatch;
- recommending which execution agent should own each mission;
- keeping scope, dependency, risk, blocker, and handoff awareness;
- reviewing technical work that the user cannot judge directly;
- translating technical results into user-facing effects or decisions;
- asking the user for decisions when needed;
- maintaining project memory, file maps, summaries, indexes, and cleanup;
- archiving completed missions after acceptance.

### Mission Execution Agents

Mission execution agents are the implementation team. By default, one active
mission has one primary execution agent and one mission workspace. The mission
workspace contains the agent conversation, task breakdown, handoff, current
result, blockers, review state, and evidence links.

Mission execution agents change project results by implementing approved mission
scope. They may work through internal tasks, implementation modules, runs, or checklists, but
those are not separate PM-facing agent conversations by default.

If a mission is too large for one execution agent, the Head Agent should
recommend splitting it into multiple missions or explicitly ask the user to
approve a multi-agent execution plan.

### Support Agents

Support agents are launched by the Head Agent to provide judgment material:
diagnosis, review, validation, comparison, evidence gathering, or other
non-implementation work.

Support agents must not change project results. They help the Head Agent judge;
they do not own missions.

## Product Lifecycle

Agent Board should support the full project lifecycle, not only coding.

```text
Idea / problem
-> User and Head Agent brainstorm
-> Head Agent writes planning drafts
-> User confirms settled plans
-> Head Agent extracts settled conclusions into long-term memory
-> Head Agent proposes development readiness and mission breakdown
-> User gives dispatch approval
-> Mission execution agents implement approved mission work
-> Head Agent reviews technical work
-> User reviews visible impact work
-> Feedback becomes rework instructions or scope decisions
-> User accepts the mission when the combined result satisfies the goal
-> Head Agent archives the mission and cleans active work
```

The Head Agent changes mode across the lifecycle:

- co-creator during discovery;
- author during planning document creation;
- planner during project setup;
- coordinator during execution;
- reviewer during validation;
- translator during decisions and reporting;
- archivist during cleanup and handoff.

## Board State Flow

Agent Board should not expose a complex state machine to the user. The user sees
plain board states and clear next actions. Internally, those board states need a
small, explicit flow so the Head Agent, execution agents, and board agree on
what can happen next.

The state flow is the board's source of truth. It prevents draft plans from being
treated as confirmed, prevents execution before dispatch approval, and lets a
new Head Agent session resume without relying on chat memory.

### Mission Flow

User-facing board states:

```text
想法整理中 -> 方案待确认 -> 待批准开工 -> 执行中 -> 整体验收中 -> 已完成 -> 已归档
```

Internal states:

```text
discovery -> planning_review -> dispatch_review -> in_execution -> mission_review -> accepted -> archived
```

Transitions:

- `discovery -> planning_review`: Head Agent has produced planning material for
  user review.
- `planning_review -> dispatch_review`: user confirms the plan is settled enough
  to become the basis for a dispatch plan.
- `dispatch_review -> in_execution`: user approves the dispatch plan.
- `in_execution -> mission_review`: all required mission tasks have reached
  their review threshold.
- `mission_review -> accepted`: user confirms the combined result satisfies the
  mission.
- `accepted -> archived`: Head Agent creates the archive summary, updates
  durable records, and cleans active work.

Rules:

- execution agents cannot start implementation before `in_execution`;
- task completion does not automatically mean mission acceptance;
- mission acceptance always belongs to the user;
- archived missions stay traceable through summaries and retained evidence.

### Mission Task Flow

Tasks are slices inside a mission workspace. They help the Head Agent and
mission execution agent coordinate work, but they are not separate agent
workspaces by default.

User-facing task states:

```text
待派发 -> 排队中 -> 执行中 -> Head Agent 检查中 -> 待你验收 -> 返工中 -> 已通过
                                  \-> 阻塞
```

Internal states:

```text
planned -> queued -> working -> head_review -> user_review -> rework -> accepted
                                      \-> blocked
```

Transitions:

- `planned -> queued`: mission dispatch is approved and the Head Agent assigns
  the task inside the mission workspace.
- `queued -> working`: the mission execution agent starts work.
- `working -> head_review`: the mission execution agent submits a result or
  blocker package.
- `head_review -> accepted`: Head Agent accepts purely technical work that
  passes the acceptance plan and does not affect visible product behavior.
- `head_review -> user_review`: the result has visible impact or needs user
  judgment.
- `user_review -> accepted`: user accepts the visible result.
- `user_review -> rework`: user rejects or redirects the result.
- `rework -> working`: Head Agent turns feedback into a revised execution brief.
- `working/head_review/user_review -> blocked`: progress needs an external
  decision, dependency, or risk acceptance.

Rules:

- mission execution agents do not self-authorize implementation;
- visible impact work must pass through user review;
- Head Agent technical acceptance is task-level evidence, not mission
  acceptance;
- blocked tasks must explain the cause, options, impact, and recommended next
  decision.

### Decision And Review Flow

User-facing board states:

```text
需要你拍板 -> 等待确认 -> 已确认
              \-> 已拒绝 / 返工
```

Internal states:

```text
decision_needed -> pending_user_confirmation -> confirmed
                                      \-> rejected
confirmed -> superseded
```

Rules:

- changes to scope, product direction, acceptance standards, architecture
  direction, meaningful risk, publishing, merging, or stage transition create a
  decision item;
- user messages inside a mission workspace that change scope or acceptance must
  be summarized back to the Head Agent and converted into a decision item;
- confirmed decisions can update long-term memory;
- rejected results become rework or historical context, not product truth;
- later decisions may supersede earlier confirmed decisions, but the older
  decision remains traceable.

## Main Product Objects

### Project

The top-level container. It has long-term memory, active missions, mission
workspaces, active runs, review history, maintainer handoffs, and mission
archives.

### Mission

A mission is a user-approved work objective inside a project. A project may have
multiple active missions when they do not create blocking conflicts.

Missions are the main execution object. Each active mission normally has one
primary mission execution agent, one mission workspace, and one conversation the
user can enter from the board. Versions are not the main object; a version is
only a time label for a visible result, such as current effect, previous effect,
or discarded result.

Active missions should be shown as a flat list on the project board so the user
can see the current work without drilling through a hierarchy. If active mission
count grows beyond a small threshold, the board can collapse lower-priority or
inactive sections while keeping the focused mission visible.

Agent Board should not encourage many missions to run at once. In practice,
parallel missions are limited by file overlap, task overlap, product direction
conflicts, unresolved user decisions, and review burden. The Head Agent should
recommend parallel execution only when the work can proceed without blocking
conflicts.

### Mission Scope

Mission scope is the full set of functions and outcomes agreed during mission
breakdown. Agent Board should not split mission scope into required and optional
tasks by default. If the work was included when the mission was approved, it
belongs to the mission.

Changing scope after dispatch approval requires user approval.

### Mission Workspace

A mission workspace is the transparent execution room for one mission and its
primary mission execution agent. It is where the user can enter the mission,
talk to the agent, inspect progress, see the current result, and open review
packets or evidence.

Direct mission conversation must not bypass the Head Agent. If the conversation
changes mission scope, acceptance plan, priority, architecture direction, risk
acceptance, or cross-mission dependency, the mission execution agent must
summarize the change back to the Head Agent. The Head Agent then creates the
needed decision item, scope change proposal, or execution reslicing proposal
before more implementation proceeds.

Each mission workspace should show, by default:

- mission name;
- mission execution agent;
- current status;
- current visible result, if any;
- task breakdown;
- acceptance plan;
- blocker or decision needed, if any;
- Head Agent review state;
- link to the underlying mission document.

Expanded details can show:

- mission brief;
- task details;
- dependencies;
- conflict risks;
- handoff;
- run history;
- technical files, diff, logs, and validation evidence.

### Mission Tasks

Tasks are slices inside a mission workspace. The Head Agent may break a mission
down by functional boundary, technical layer, or a mixed boundary depending on
conflicts, dependencies, acceptance method, and execution efficiency.

Tasks should stay lightweight by default. They show what the mission agent is
doing and what remains, but they do not create separate PM-facing conversations
unless the Head Agent explicitly proposes a multi-agent plan and the user
approves it.

### Run

A run is a concrete agent execution. It can contain transcript, commands, files
changed, logs, preview output, errors, and validation evidence.

Runs are technical evidence, not the main PM-facing surface. Routine runtime
material should stay out of the user-facing document structure by default.

### Review Packet

A review packet is how completed or blocked work comes back for judgment.

For user-visible work, the packet focuses on effect:

- preview link or local entry point;
- screenshot or recording when available;
- Head Agent summary;
- comparison with the goal;
- known problems;
- options for next action.

For technical work, the packet focuses on Head Agent judgment:

- conclusion: passed, needs rework, risky, or blocked;
- short reason;
- validation method;
- product impact, if any;
- linked mission / task / run / files for traceability.

Long-term review history should keep summaries and pointers, not raw packets
dumped into permanent memory.

### Project Status Board

The current status surface is a product UI, not a required `status.md` file.

The board's first screen should answer what needs the user's attention now. The
default priority order is:

1. decisions waiting for the user;
2. visible results waiting for user review;
3. blockers or risks that need attention.

Below those attention items, the board can show active missions, mission agent
status, task progress, and the Head Agent's current summary.

The board can show:

- current project phase;
- active missions and focused mission;
- mission agent status and task progress;
- blockers, risks, bugs, and technical debt in context;
- pending review packets;
- pending user decisions;
- next recommended actions;
- links to related documents and evidence.

Issues are part of the progress board, attached to the mission or task they
affect. They are not a separate required top-level `issues.md` document.

Documents, handoffs, retained evidence, diff, and run history should be linked
from the relevant object detail instead of spread across the default board view.
The default board should not become a wall of agent state or technical evidence.

### Board Item Persistence

The board is the working surface, but important board items need a durable source
of truth. Decisions, blockers, risks, reviews, and action-needed items should be
stored on the mission or task record they belong to, not in a top-level
`issues.md` file and not only in transient UI state.

Example board item metadata:

```yaml
board_items:
  - id: bi_001
    type: decision | blocker | risk | review | action_needed
    status: open | resolved | superseded
    title: Should records be allowed without a category?
    owner: user | head_agent | execution_agent
    source: mission | task | run | review_packet
    linked_to:
      - docs/...
      - run:...
```

The user should primarily see these items through the board. Documents hold the
durable record so the project survives app restarts, machine changes, and Head
Agent session resets.

### Head Agent Workspace

The Head Agent workspace is a persistent workbench, not a single permanent chat
window. It should show:

- active missions and focused mission;
- current Head Agent session;
- latest state summary;
- latest Head Agent handoff;
- current recommendation;
- decisions needed from the user;
- progress and risk summary;
- pending review packets;
- project file map and document links.

When the Head Agent context window is exhausted, a new Head Agent session should
continue from project memory, project file map, and the latest handoff.

## Decision And Permission Model

The default rule is:

```text
The Head Agent recommends and coordinates.
The user decides consequential product matters.
Mission execution agents implement approved project scope.
Support agents provide judgment material without changing project results.
```

### Dispatch Approval

Implementation does not start just because the Head Agent decomposed a mission.
The user must approve the dispatch plan first.

Dispatch approval covers:

- mission scope;
- task breakdown;
- execution order;
- acceptance plan;
- known risks and conflicts.

### Execution Versus Decision

Execution can continue when it is inside approved scope and does not change
direction, standards, product meaning, or user-visible acceptance.

Decisions require the user. Examples:

- choosing between product directions;
- expanding or cutting scope;
- accepting visible product results;
- updating product principles;
- changing acceptance standards;
- entering a new project stage;
- changing architecture direction;
- accepting meaningful risk;
- publishing, merging, or adopting a result as final.

### Technical Acceptance

Purely technical work can be accepted by the Head Agent when it passes the
agreed acceptance plan and does not introduce user-facing change, scope change,
high-risk tradeoff, or architecture direction change.

If the work changes what the user can see, feel, understand, or rely on in the
product experience, it is visible impact work. The Head Agent must explain the
user-facing effect and ask the user to accept it.

### Conflict Model

Product conflicts warn the user but do not block local development by default.
For example, two active missions may affect the same user experience without
touching the same files. The Head Agent should flag the conflict and recommend
combined review when useful.

Blocking conflicts stop or delay execution. Examples:

- active missions would overwrite the same files or core module logic;
- an unresolved user direction choice is required;
- execution carries irreversible risk.

### Execution Reslicing

The Head Agent may recommend execution reslicing when the approved mission scope
stays the same. Reslicing can change task grouping, sequencing, or agent
ownership, but it must not change what the mission will deliver.

Execution reslicing is valid only when it:

- preserves the approved mission outcome;
- preserves the acceptance plan;
- does not add or remove user-visible functionality;
- does not change product direction or risk acceptance;
- only changes how the approved work is divided and sequenced.

Examples:

- splitting one login task into separate login UI and login API tasks;
- separating homepage visual polish from homepage data integration;
- moving a shared validation task from one mission task to another without changing
  the expected result.

Execution reslicing needs lightweight user confirmation because it changes how
the work will be managed and reviewed.

Scope change is different. A change is a scope change when it changes the final
deliverable, acceptance standard, product goal, user-visible behavior, or risk
profile. Scope changes require formal user approval before implementation
continues.

### High-Risk Decisions

High-risk decisions require clear warning and a second confirmation. Examples:

- deleting data;
- large refactors;
- changing core product direction;
- introducing a new technical stack;
- publishing or releasing;
- merging irreversible changes;
- removing important functionality;
- changing privacy, account, payment, or security behavior;
- significantly increasing development scope;
- making architecture decisions that affect multiple missions or major tasks.

## Review And Acceptance Model

### Review Flow

Review should feel like a simple product decision, not a technical audit. When a
mission agent result arrives, the Head Agent first translates it into a review
path.

```text
Mission agent submits result
-> Head Agent reviews and classifies the result
-> Purely technical work: Head Agent accepts, rejects, or marks risk
-> Visible impact work: Head Agent prepares a user review packet
-> User chooses an action
-> Head Agent converts the action into next execution, rework, scope, or archive steps
```

Default user actions on a visible review packet:

- `Accept`: the visible result is good enough for this mission or mission stage.
- `Keep improving`: the user gives feedback, and the Head Agent turns it into a
  rework brief.
- `Change goal / scope`: the feedback changes what the work is supposed to
  achieve, so the Head Agent creates a decision item before more execution.
- `Pause`: the work should stop until the user or Head Agent resolves the next
  question.
- `Explain`: the Head Agent explains what changed, why it matters, and what the
  options are in ordinary product language.

The board should not force the user to choose between technical states such as
task completion, mission acceptance, or technical acceptance. The Head Agent maps
user actions to the correct internal state.

### Task Completion

Task completion means one task inside a mission satisfies its acceptance plan. It
may happen before the mission is accepted so the mission can keep moving.

Task completion is only partial mission progress.

### Mission Acceptance

Mission acceptance means all task results defined during mission breakdown and
their combined effect satisfy the mission.

Mission acceptance belongs to the user.

### Review History

Review history is a cross-mission index of acceptance outcomes, rework, and risk
acceptance. It should summarize review history and point to mission archive
summaries or retained evidence.

It should not store every raw review packet in full.

## Document And Memory Model

### Product-Level Rules

Agent Board should include built-in operating rules for how the Head Agent,
mission execution agents, support agents, review, confirmation, and archiving
work.

These rules are product-level defaults, not a required per-project
`operating-plan.md`. If the user customizes the default rules for a project, the
project stores only the override.

### Collaborative Planning Documents

The user should not manually author project documents from a blank page. The
workflow is:

```text
User discusses ideas with the Head Agent
-> Head Agent writes planning drafts
-> User reviews and confirms
-> Settled conclusions can be extracted into long-term memory
```

Planning drafts may be saved before confirmation, but they must be clearly
marked as draft and must not be treated as settled project truth.

Planning documents should avoid keeping unresolved alternatives as durable
structure. Before planning content can drive development, memory extraction, or
agent operating rules, it must be confirmed by the user. Anything not confirmed
is pending, not project truth.

Minimum planning states:

- `draft`: Head Agent has written material for review, but it is not accepted.
- `pending`: the topic is known but not decided; it may be discussed, but agents
  must not treat it as settled.
- `confirmed`: the user has accepted the conclusion, and it can drive planning,
  dispatch, or memory extraction.

When a document contains both settled and unsettled material, the unsettled
parts should be marked pending. Head Agent may only extract confirmed
conclusions into long-term memory.

### Project Memory Updates

Project memory updates are split by risk:

- factual updates may be recorded automatically;
- decision updates require user confirmation.

Factual updates include task completion, review conclusions, blockers, and
file-map updates.

Decision updates include mission scope, product principles, architecture
direction, acceptance standards, and delegation or rule changes.

User confirmation should record the settled conclusion in the relevant document.
Agent Board should not require a heavy approval ledger.

### Confirmation Records

Agent Board should not maintain a standalone approval ledger. Confirmation is
recorded on the object being confirmed so the decision stays traceable without
creating a separate approval system.

Examples:

- planning confirmation is recorded on the planning document or confirmed
  section;
- dispatch approval is recorded on the mission brief;
- visible acceptance is recorded on the mission review record;
- technical acceptance is recorded on the Head Agent review summary;
- scope changes are recorded on the relevant decision record.

Minimum confirmation metadata:

```yaml
confirmation:
  status: confirmed
  confirmed_at: 2026-06-30T20:10:00+08:00
  confirmed_by: user
  source: chat | board_action
  summary: User confirmed the mission scope and acceptance plan.
```

The user should experience this as a decision receipt, not an approval workflow.
The board can show the receipt when useful, but it should not force the user to
manage confirmations as a separate task list.

### Planning Versus Long-Term Memory

Planning documents capture working product, design, and technical plans while
they are being shaped. They may contain draft or pending content, but pending
content cannot drive execution or long-term memory.

Long-term memory documents store settled background, principles, decisions, file
maps, and rule overrides. They summarize durable truth rather than duplicating
full planning drafts.

When a plan settles, the Head Agent should extract durable conclusions into
long-term memory and ask the user to confirm the extracted summary.

### Maintainer Handoffs

Maintainer handoffs are durable, non-required but always-present documents for
future maintainers and future agents. They store:

- background context;
- code structure guidance;
- investigation entry points;
- reasons important choices were made;
- links to relevant code areas and records.

They may be organized by functional area as long as each handoff clearly points
to related code areas and investigation entry points.

### Runtime Material

Runtime material includes sessions, logs, screenshots, recordings, preview
cache, and local state. It should not appear in the user-facing project document
structure by default.

Retained evidence can be opened through review, archive, or handoff links when
needed.

### Evidence Retention

After mission or task work completes, the Head Agent decides which evidence is
necessary to preserve. Necessary screenshots, logs, recordings, run outputs, or
review materials should be retained or archived. Routine agent-facing runtime
material can be cleaned up.

### Mission Archival

After mission acceptance, the Head Agent should automatically:

- create a mission archive summary;
- retain necessary evidence;
- update review history;
- update maintainer handoffs when useful;
- clean the active work area;
- show the user an archival summary.

Mission archives should be organized by mission summary, not by raw folder dump.

## Standard Project Document Template

Agent Board should include a standard document template for new projects. The
Head Agent may add, remove, or adapt folders and documents for the actual
project, with user approval for meaningful durable structure changes.

The standard folders should be created because they are project assets that
agents and future maintainers need. However, the user should not be asked to
work from the document tree by default. The product surface should show a visual
project view: missions, mission agents, task progress, review needs, blockers,
and current outcomes. Documents are the durable source and traceability layer,
entered from board objects when the user wants to inspect or edit them.

The user-facing document structure should use clear Chinese folder and document
names. Numbering is the default because it keeps reading order stable.

System prompts, model-facing rules, and technical implementation files may stay
in English when that is clearer for agents or tooling.

Default user-facing structure:

```text
.agent-board/
  01-项目方案/
    产品愿景.md
    产品需求.md
    设计方案.md
    技术方案.md

  02-长期记忆/
    项目背景.md
    产品原则.md
    设计原则.md
    技术原则.md
    决策记录.md
    文件地图.md
    规则覆盖.md        # only when the user customizes default rules

  03-当前工作/
    mission-短ID-中文标题/
      mission-brief.md
      acceptance-plan.md
      tasks/
        task-短ID-中文标题.md

  04-验收记录/
    验收历史.md
    返工记录.md

  05-维护交接/
    index.md
    功能块交接文档.md

  06-完成归档/
    index.md
    missions/
      mission-短ID-中文标题-summary.md
```

Not in the user-facing structure by default:

- `status.md`: current status is the product board;
- `issues.md`: issues live inside the progress board;
- `runtime/`: runtime material is internal and reached through evidence links;
- `operating-plan.md`: operating rules are built-in defaults, with overrides only
  when the user customizes them.

## Board Shape

The main interface should have three visible layers.

### Project Board

Shows the phase, active missions, focused mission, mission agents, task
progress, review requests, blockers, risks, decisions, and current effect
status.

### Head Agent Panel

Shows the Head Agent conversation, current judgment, recommended next steps,
handoff status, document links, and decision requests.

### Mission Workspaces

Each mission opens into a mini-workspace with the mission execution agent
conversation, current task breakdown, current output, review state, handoff, and
optional technical evidence.

Technical details such as diff, files, commands, git status, and worktrees are
available when needed but hidden from the default PM-facing view.

## Communication Style

The Head Agent should communicate like a concise management report:

```text
Background
Problem
Options
Impact
Recommendation
Decision needed
```

Technical language must be translated into ordinary product meaning.

When disagreeing with the user, the Head Agent should:

1. state the disagreement clearly;
2. explain concrete risk or tradeoff;
3. recommend a better path;
4. ask for confirmation;
5. proceed if the user insists, except for hard safety/legal constraints.

For high-risk disagreements, it may ask for a second confirmation.

## Nimbalyst Reuse Strategy

Agent Board should be a new product shape on top of selected Nimbalyst assets,
not a cosmetic reskin.

Likely reusable:

- workspace and file access;
- session infrastructure;
- Codex provider;
- parts of Claude CLI launcher / queue / terminal infrastructure;
- terminal and transcript surfaces;
- worktree and git support;
- file tracking and review infrastructure;
- selected tracker / kanban concepts.

Likely hidden or removed from the main path:

- mobile sync;
- Stytch / team collaboration;
- extension marketplace;
- broad custom editor ecosystem;
- PR review mode;
- usage-report dashboards;
- feedback / Discord / public release flows;
- document editor as the primary product identity.

Must be rebuilt or heavily redesigned:

- Claude Code CLI provider;
- Head Agent workspace;
- mission workspace model;
- project memory writer / reader;
- user decision and delegation model;
- review packet model;
- PM-facing progress board;
- mission archival and document governance flows.

## Near-Term Next Step

Convert this vision into a product requirements document and then split it into
independently implementable issues. The PRD should define:

- object model;
- board states;
- document template and memory schema;
- dispatch approval flow;
- conflict model;
- review packet format;
- mission archival flow;
- initial Nimbalyst reuse boundaries.

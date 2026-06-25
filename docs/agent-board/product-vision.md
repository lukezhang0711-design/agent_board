# Agent Board Product Vision

Status: working product vision  
Last updated: 2026-06-25

## One-Line Definition

Agent Board is a local project workspace led by a Head Agent. It helps the user
turn a rough idea into durable product / design / technical documents, then
coordinate Codex and Claude Code sub-agents through module workspaces, visible
review packets, and explicit user decisions.

It is not a Nimbalyst reskin, a pure multi-agent chat app, or a black-box
automation runner.

## Role Model

### User

The user is the owner / CEO. The user owns product direction, scope, priorities,
visible outcome approval, and any consequential decision.

The user can talk to the Head Agent and can also enter any module workspace to
talk directly with the sub-agent. The system must stay transparent.

### Head Agent

The Head Agent is the professional manager / project lead. It has judgment,
recommendation, organization, review, translation, and coordination authority.
It does not have autonomous decision authority.

The Head Agent is responsible for:

- understanding the user's problem and intent;
- challenging weak assumptions and helping the user converge;
- turning rough thinking into product, design, technical, and operating docs;
- deciding whether enough is known to propose entering development;
- decomposing missions into modules and tasks;
- recommending which sub-agent should do what;
- keeping conflict, scope, dependency, and handoff awareness;
- reviewing technical work that the user cannot judge directly;
- translating technical results into user-facing effects or decisions;
- asking the user for decisions when needed;
- keeping the project board and project memory coherent.

### Sub-Agents

Sub-agents are the execution team. They work inside module workspaces and should
receive clear task briefs, context, constraints, expected outputs, and review
criteria.

The user can talk directly to sub-agents. Important sub-agent events are
summarized and synced back to the Head Agent by default so the Head Agent does
not lose project awareness.

## Product Lifecycle

Agent Board should support the full lifecycle, not just the coding phase.

```text
Idea / problem
-> Head Agent asks, challenges, and brainstorms with the user
-> Product / design / technical / operating docs are created
-> Head Agent proposes a development readiness report
-> User confirms entering development
-> Head Agent decomposes missions into module workspaces
-> Sub-agents execute approved work
-> Head Agent reviews technical work
-> User reviews visible effects
-> Feedback becomes rework instructions
-> Project memory and handoffs keep the work resumable
```

The Head Agent changes mode across the lifecycle:

- co-creator during discovery;
- planner during project setup;
- coordinator during execution;
- reviewer during validation;
- translator during decisions and reporting.

## Main Product Objects

### Project

The top-level container. It has long-term memory, current missions, module
workspaces, active runs, and review history.

### Mission / Goal

The main product object. A mission answers: what are we trying to achieve now?

Versions are not the main object. A version is only a time label for a visible
result, such as current effect, previous effect, or discarded result.

### Head Agent Workspace

The Head Agent workspace is a persistent workbench, not a single chat window.
It should show:

- current mission;
- current Head Agent session;
- latest state summary;
- latest handoff;
- current recommendation;
- decisions needed from the user;
- progress and risk summary;
- pending review packets.

When the Head Agent context window is exhausted, a new Head Agent session should
continue from project memory and the latest handoff.

### Module Workspace

Each module is a mini-workspace. It should show, by default:

- module name;
- current status;
- current visible result, if any;
- current sub-agent;
- what the user needs to do next, if anything.

Expanded details can show:

- module brief;
- task scope;
- dependencies;
- conflict risks;
- handoff;
- run history;
- technical files / diff / logs.

Module cards should stay lightweight by default. They must not become a Jira
clone or a technical diff dashboard.

### Run

A run is a concrete sub-agent execution. It can contain transcript, commands,
files changed, logs, preview output, errors, and validation evidence. Runs are
technical evidence, not the main PM-facing surface.

### Review Packet

A review packet is how work comes back to the user or Head Agent.

For user-visible work, the packet should focus on effect:

- preview link or local entry point;
- screenshot or recording when available;
- Head Agent summary;
- comparison with the goal;
- known problems;
- options for next action.

For technical work, the packet should focus on Head Agent judgment:

- conclusion: passed, needs rework, risky, or blocked;
- short reason;
- validation method;
- product impact;
- linked module / task / run / files for traceability.

## Permission And Decision Model

The default rule is conservative:

```text
The Head Agent can propose.
The user decides.
Sub-agents execute approved work.
```

The Head Agent must not make consequential decisions and directly execute them.
It may produce reviewable work inside an already approved scope, but it must not
finalize product direction, scope, standards, stage transitions, or acceptance
without the user.

### Execution Versus Decision

Execution can continue when it is inside an approved scope and does not change
direction, standards, or product meaning.

Decisions require the user. Examples:

- choosing between product directions;
- expanding or cutting scope;
- accepting visible product results;
- updating product principles;
- entering a new project stage;
- changing architecture direction;
- accepting meaningful risk;
- publishing, merging, or adopting a result as final.

If something is simple, reversible, and non-blocking, an agent may implement a
reviewable output. If it is not accepted, the user's feedback becomes rework.
Rejected outputs are history, not new product state.

### Delegation Rules

The user may explicitly delegate a class of decisions. Delegations should be
written into project memory and remain visible. Without explicit delegation, the
Head Agent asks.

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
- making architecture decisions that affect multiple modules.

## Review Model

### User Review

The user reviews visible effects: UI, interaction, copy, workflow, product
behavior, and design direction.

The Head Agent should translate technical details into plain product impact.

### Head Agent Technical Review

The Head Agent reviews non-visible technical work: backend, data, refactors,
tests, infrastructure, build systems, and internal architecture.

It reports concise conclusions to the user and only asks when there is a product
decision, risk acceptance, scope change, or blocker.

### Decision Review

When judgment belongs to the user, the Head Agent should present:

- background;
- problem;
- options;
- impact of each option;
- recommendation;
- exact decision requested.

The Head Agent should challenge weak assumptions and recommend a path, but the
user makes the decision.

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

## Project Memory

Project memory is the durable source of truth. It should be Markdown-first and
live in the project repo so it can travel across machines and be read by agents
and humans.

Suggested layout:

```text
.agent-board/
  memory/
    product-spec.md
    design-principles.md
    technical-plan.md
    agent-operating-rules.md
    decision-log.md
    module-index.md
  modules/
    <module-name>/
      module-brief.md
      handoff.md
      review-log.md
  runtime/
    sessions/
    logs/
    screenshots/
    preview-cache/
    local-state.json
```

The `memory/` and long-lived module documents should usually be committed to
git. They are work artifacts that agents need.

The `runtime/` directory should stay local by default. It can hold transient
session ids, logs, screenshots, preview caches, and UI state.

The board is a projection of project memory plus live runtime state. The app
database may cache and index state, but it should not be the only source of
truth for long-term project context.

## Board Shape

The main interface should have three visible layers:

### Project Board

Shows the mission, phase, modules, review requests, blockers, decisions, and
current effect status.

### Head Agent Panel

Shows the Head Agent conversation, current judgment, recommended next steps,
handoff status, and decision requests.

### Module Workspaces

Each module opens into a mini-workspace with sub-agent conversation, current
task, current output, review state, handoff, and optional technical evidence.

Technical details such as diff, files, commands, git status, and worktrees are
available when needed but hidden from the default PM-facing view.

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
- module workspace model;
- project memory writer / reader;
- user decision and delegation model;
- review packet model;
- PM-facing progress board.

## Open Product Questions

- What is the first concrete project type Agent Board should support best:
  visual frontend apps, document-heavy planning work, or codebase refactors?
- How much of project memory should be generated during kickoff versus evolved
  during execution?
- What is the smallest useful Head Agent handoff format?
- How should user-to-sub-agent messages be summarized back to the Head Agent?
- What is the right lightweight format for technical review summaries?
- How should project memory updates be proposed and approved in the UI?

## Near-Term Next Step

Before implementation, convert this vision into a product requirements document
and then split it into independently implementable issues. The PRD should define
the object model, project memory schema, stage gates, review packet format, and
initial Nimbalyst reuse boundaries.

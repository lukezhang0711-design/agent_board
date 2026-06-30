# Agent Board

This repository is Luke's personal fork of Nimbalyst for building Agent Board:
a local project workspace led by a Head Agent. Agent Board helps a user turn a
rough product idea into durable project documents, mission workspaces, visible
review packets, and coordinated execution by Codex / Claude Code mission agents.

## Upstream

- Upstream project: https://github.com/Nimbalyst/nimbalyst
- Personal remote: https://github.com/lukezhang0711-design/agent_board

## Product Direction

- Treat the user as the owner / CEO. The Head Agent can recommend, challenge,
  organize, review, and translate, but it cannot make consequential decisions
  without user approval.
- Make the Head Agent a workspace, not a single permanent chat. It must survive
  context-window resets through project memory, handoffs, and concise state.
- Make each mission a mini-workspace with its own execution agent, task
  breakdown, handoff, current result, review state, and technical details.
- Store long-term project memory as Markdown in the repo. The board is a visual
  projection of those documents plus live run state.
- Prefer visible product outcomes for user review. Technical evidence remains
  available but hidden by default.
- Keep Nimbalyst's useful workspace pieces: files, sessions, tasks, terminals,
  worktrees, and review infrastructure.
- Keep Codex support as a first-class execution backend.
- Replace the brittle Claude Code integration with a direct adapter around the
  working local Claude Code CLI.
- Add Head Agent and mission workspace layers that coordinate scoped work across
  Codex and Claude Code sessions.
- Show mission progress, task status, blocked decisions, review packets, and
  handoff health in one board.
- Reduce or remove features that are not needed for a single-user local tool.

For the current product vision, see
[`docs/agent-board/product-vision.md`](docs/agent-board/product-vision.md).

For the current flow audit, see
[`docs/agent-board/flow-audit.md`](docs/agent-board/flow-audit.md).

For the current interaction demo, open
[`docs/agent-board/demo/index.html`](docs/agent-board/demo/index.html).

## Initial Technical Priorities

1. Build and run the upstream Electron app locally.
2. Trace the current AI provider, session, task, and worktree boundaries.
3. Replace Claude login checks with `claude auth status --text`.
4. Add a Claude Code CLI runner that uses the user's installed `claude` binary.
5. Make the default Claude model conservative, starting with Sonnet.
6. Add the first commander flow: plan, dispatch, monitor, review.

## Sync Workflow

- `origin` points to Luke's GitHub repository.
- `upstream` points to the official Nimbalyst repository.
- After each useful change: inspect the diff, run the relevant checks, commit,
  and push to `origin`.
- Pull upstream intentionally and resolve conflicts in small batches.

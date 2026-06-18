# Agent Board

This repository is Luke's personal fork of Nimbalyst for building a local
multi-agent command board.

## Upstream

- Upstream project: https://github.com/Nimbalyst/nimbalyst
- Personal remote: https://github.com/lukezhang0711-design/agent_board

## Product Direction

- Keep Nimbalyst's useful workspace pieces: files, sessions, diffs, tasks,
  worktrees, terminals, and visual review.
- Keep Codex support as a first-class execution backend.
- Replace the brittle Claude Code integration with a direct adapter around the
  working local Claude Code CLI.
- Add a "commander" layer that lets the user talk to one coordinator while the
  tool dispatches scoped work to Codex and Claude Code sessions.
- Show module-level progress, blocked states, file changes, and review status in
  one board.
- Reduce or remove features that are not needed for a single-user local tool.

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

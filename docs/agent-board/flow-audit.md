# Agent Board Flow Audit

Status: product flow review
Last updated: 2026-06-30

## Conclusion

The default execution model is:

```text
Project -> Head Agent -> Mission -> Mission Agent Workspace -> Mission Tasks -> Review Packet -> Mission Acceptance
```

One active mission normally has one primary mission execution agent and one
mission workspace. Tasks inside the mission show progress, but they are not
separate PM-facing agent conversations by default.

If a mission is too large for one execution agent, the Head Agent must recommend
splitting it into multiple missions or ask the user to approve an explicit
multi-agent execution plan.

## Closed Flow Map

| Flow | User-facing entry | Owner | Exit condition | Closed? |
| --- | --- | --- | --- | --- |
| Idea shaping | Head Agent conversation | Head Agent + user | confirmed planning summary | Yes |
| Dispatch | mission proposal on board | user decides, Head Agent prepares | user approves mission brief, task breakdown, acceptance plan | Yes |
| Execution | active mission card | Mission Agent | task results or blocker submitted to Head Agent | Yes |
| Mission chat | click mission card | Mission Agent | answer, progress update, rework input, or escalation | Yes |
| Scope/risk change | mission chat or board decision card | Head Agent + user | user confirms, rejects, or asks for a new proposal | Yes |
| Technical-only result | Head Agent review summary | Head Agent | accepted, rejected, risky, or blocked | Yes |
| Visible result | review packet | user decides, Head Agent translates | accept, keep improving, change scope, pause, or explain | Yes |
| Blocker/conflict | attention card on board | Head Agent | user decision or Head Agent technical resolution | Yes |
| Context reset | Head Agent / mission handoff | Head Agent | next session resumes from memory and handoff | Yes |
| Completion | mission review | user accepts | archive summary, evidence retention, review history update | Yes |

## Product Rules Confirmed

- The Head Agent is the manager, not the implementation worker.
- The Head Agent cannot start implementation without user dispatch approval.
- A mission is the default unit of execution, conversation, and review.
- Mission tasks are progress structure, not default child agents.
- Direct mission-agent conversation is allowed, but it cannot bypass the Head
  Agent for scope, acceptance, priority, architecture, risk, or cross-mission
  dependency changes.
- The board is the default work surface; documents are the durable source and
  traceability layer.
- The user should review visible effects, not raw worktrees, diffs, or logs.
- Technical evidence stays linked behind Head Agent summaries and review
  packets.

## Removed Ambiguity

The earlier wording implied:

```text
Mission -> Modules -> one sub-agent per module
```

That model is too heavy for a PM-facing personal tool. It makes the user manage
many agents instead of managing outcomes.

The corrected model is:

```text
Mission -> one mission agent -> tasks/checkpoints inside the workspace
```

Tasks can still map to files, runs, checks, or internal implementation modules,
but that is execution detail unless the Head Agent needs the user to decide.

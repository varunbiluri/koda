# Koda Desktop — Product Definition

## Positioning

**Koda Desktop is a local-first AI engineering workspace.**

Inspired by Codex-style agent workflows, Koda combines repository intelligence, context-efficient execution, transparent benchmarking, and bring-your-own-model flexibility in a desktop experience designed for real software engineering work.

Review plans, inspect diffs, monitor tool execution, track token usage, and supervise autonomous coding tasks — all while keeping your repository, credentials, tools, and models under your control.

This is **not**:

```
Koda Desktop = GUI for CLI
Open-source Codex clone
```

This **is**:

```
Koda Desktop = Local-first Codex-style command center
```

---

## Architecture contrast

| OpenAI Codex (direction) | Koda (opportunity) |
|--------------------------|-------------------|
| Worktrees | Local-first, optional worktrees (P2) |
| Multi-agent orchestration | Single-agent excellence first |
| Cloud tasks | Local `koda serve` + BYOM |
| Remote execution | Local filesystem + local tools |
| Long-running cloud agents | Long-running local threads |

**Koda's stack:**

```
Codex UX
+ Local-first architecture
+ BYOM (bring your own model)
+ Open source (MIT)
+ Repository intelligence
+ Context efficiency (KEI, ref rate)
```

---

## P0 — Mandatory (Codex parity)

### Sidebar

```
Projects
Threads
Sessions
```

Work is organized as **threads**, not chats.

### Tool cards

```
READ | SEARCH | WRITE | RUN | VERIFY | COMMIT
```

Trust comes from visibility. Raw `INFO` logs belong in the terminal drawer, not the main thread.

### Plan panel

Show agent intent as numbered steps before and during execution.

### Diff panel

Diff review is more important than chat. File list with `+/-` line counts.

### Terminal drawer

`⌘J` — raw command output and agent logs for developers who want full visibility.

---

## P1 — Koda differentiators

### Metrics panel

Codex does not strongly market context efficiency. Koda should.

```
KEI          Context efficiency score
Ref Rate     % tool output via references
Tokens       Prompt + completion
Tools        Tool call count
Provider     azure / openai / …
Model        gpt-4.1, etc.
```

### Context panel

Show repository intelligence visually:

```
Files loaded
Symbols retrieved
Retrieved paths
Tool references
```

### Approval center

Centralized trust workflow:

```
Approve write
Approve command
Approve commit
```

---

## P2 — After adoption

- **Worktrees** — parallel isolated agents (Codex pattern)
- **Multi-agent dashboard** — only after single-agent UX is excellent

---

## Explicitly out of scope (for now)

Do **not** replicate:

- Browser automation
- Computer use
- Cloud environments
- Remote sandboxes

Koda's advantage is **local repo, local filesystem, local tools, local models**.

---

## Implementation status

| P0 / P1 surface | Status |
|-----------------|--------|
| Sidebar threads (persisted) | Done — `.koda/desktop/threads.json` |
| Structured tool cards | Done — SSE `tool` events |
| Plan panel with active step | Done |
| Diff panel (+/- counts) | Done |
| Terminal drawer ⌘J | Done — SSE `terminal` events |
| Metrics (KEI, ref rate, tokens) | Done — SSE `done` |
| Context (files, symbols, chunks) | Done — SSE `context` |
| Approval center | Done — POST `/api/approvals/:id` |
| Worktrees / multi-agent | P2 — not started |

---

## Product maturity (internal)

| Area | Status |
|------|--------|
| CLI | Mature beta |
| Repo intelligence | Strong |
| Context efficiency | Strong |
| Benchmarking | Implemented (live run pending) |
| Desktop UX | Agent Workspace |
| Diff review | Needs polish |
| Release readiness | Close |

---

## Post v0.1.3 roadmap

1. **Diff viewer quality** — Ask → Plan → Tools → Diff → Approve
2. **Thread history** — task, diff, metrics per thread
3. **Metrics timeline** — KEI over last N tasks
4. **Benchmark panel** — KCB-10 in-app

---

## One-line pitch

> Local-first AI engineering workspace — repository intelligence, context efficiency, transparent benchmarking, BYOM, human-in-the-loop approvals.

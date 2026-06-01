# Koda Desktop UI — Agreed Spec

Status: **Approved direction** (local-first Codex-style command center)

See [`PRODUCT_DESKTOP.md`](PRODUCT_DESKTOP.md) for full positioning.

## Product statement

> Koda Desktop is a local-first AI engineering workspace. Inspired by Codex-style agent workflows, Koda combines repository intelligence, context-efficient execution, transparent benchmarking, and bring-your-own-model flexibility — with your repo, credentials, tools, and models under your control.

## P0 components

| Component | Requirement |
|-----------|-------------|
| Sidebar | Projects, threads, sessions |
| Tool cards | READ, SEARCH, WRITE, RUN, VERIFY, COMMIT |
| Plan panel | Numbered execution steps |
| Diff panel | File changes with +/- counts |
| Terminal drawer | ⌘J raw visibility |

## P1 differentiators (Koda-only)

| Component | Requirement |
|-----------|-------------|
| Metrics panel | KEI, ref rate, tokens, provider, model |
| Context panel | Files, symbols, paths, tool references |
| Approval center | Write / command / commit approval |

## P2 (later)

- Worktrees
- Multi-agent dashboard

## Out of scope

Browser automation, computer use, cloud environments, remote sandboxes.

## SSE → UI mapping

| Event | UI target |
|-------|-----------|
| `token` | Assistant bubble |
| `stage` | Tool card (+ terminal) |
| `plan` | Plan panel |
| `context` | Context panel |
| `diff` | Diff panel + Approvals |
| `done.metrics` | Metrics panel |
| `error` | Error banner |

## Repo paths

```
apps/desktop/ui/index.html
apps/desktop/main.cjs
src/serve/http-server.ts
src/product/metrics.ts
```

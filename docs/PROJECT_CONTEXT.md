# Koda — Project Context

Engineering context for contributors, AI assistants, and release planning.

**Koda** is an open-source, terminal-native coding agent focused on **repository intelligence** and **context efficiency**, with built-in benchmarking and transparent token telemetry.

Not: *"another Claude Code clone."*  
Yes: *"measurable context efficiency as the moat."*

---

## North star

```text
% Tool Output Via References (refRate)
```

High ref rate → smaller context → fewer tokens → lower cost/latency → better local-model viability → higher KEI.

Track on every autonomous run in `.koda/metrics.json` and via `/cost` in the REPL.

---

## KEI (Koda Efficiency Index)

```text
KEI = 100 × (baseline_median_tokens / koda_median_tokens)
```

- Default baseline: **52,000 tokens** (`DEFAULT_KEI_BASELINE_TOKENS`)
- Benchmark harness: **KCB-10** (`benchmarks/kcb-10/`)
- Leaderboard: [benchmarks/kcb-10/leaderboard.md](../benchmarks/kcb-10/leaderboard.md)

Every context optimization should move **refRate ↑** and **median tokens ↓** without breaking success rate.

---

## Product freeze (current phase)

**Do not prioritize:** more providers, MCP features, slash commands, agents, orchestration layers.

**Do prioritize:** measurement, reference-first context, KCB-10 live results, publishing proof.

Koda already ships: REPL, MCP, 4 providers, Ollama, LSP, VS Code extension, autonomous workflows. Adding features won't change adoption as much as **published benchmark numbers**.

---

## Architecture (summary)

| Layer | Path |
|-------|------|
| Agent loop | `src/ai/reasoning/reasoning-engine.ts` |
| Reference-first injection | `src/runtime/tool-result-injection.ts` |
| Retrieval bootstrap | `src/intelligence/retrieval-context.ts` |
| Context trim | `src/ai/context/context-trimmer.ts` |
| Metrics v2 | `src/product/metrics.ts` |
| REPL | `src/cli/session/conversation-engine.ts` |
| Benchmark | `benchmarks/kcb-10/` |

**Stateless REPL:** each turn rebuilds context from the repo index — no full transcript memory by design.

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the full stack.

---

## Context efficiency stack

1. **Reference-first tool results** — ref + preview at ≥200 chars; `get_tool_result(ref)`
2. **Symbol-aware bootstrap** — paths + symbols, no code excerpts in system prompt
3. **Prompt split** — static cacheable core + dynamic per-turn block
4. **Persistent disk cache** — `.koda/cache/tool-results.json`
5. **`read_file` line ranges** — partial reads via `startLine` / `endLine`
6. **trimContext** — counts `tool_calls`; caps tool messages at 800 chars

---

## Measurement

**ProductMetrics v2** → `.koda/metrics.json`

Per task: `promptTokens`, `completionTokens`, `toolCalls`, `refRate`, `route`, `diffAccepted`, `contextPeakChars`, `provider`, `model`.

**Wired on:** `koda fix`, `koda add`, `koda auto`, REPL turns (`persistTurnMetrics`), `/cost`.

---

## KCB-10 benchmark

```bash
pnpm benchmark:kcb10        # mock (CI-safe)
pnpm benchmark:kcb10:live   # real provider (koda login + koda init required)
```

**Mock results are not marketing claims.** Only live runs belong in README release notes.

---

## Positioning

> Koda is an open-source coding agent focused on repository intelligence and context efficiency, with built-in benchmarking and transparent token telemetry.

Product Hunt / HN headline (after live KCB-10 only):

> Koda completes KCB-10 tasks with measurable token efficiency — see live benchmark results.

---

## Success criteria for v0.1.3

Release gates — all must pass before Product Hunt / public launch:

| Gate | Status |
|------|--------|
| All tests pass (`pnpm test`) | Required |
| TypeScript builds (`pnpm build`) | Required |
| ProductMetrics v2 enabled on autonomous + REPL paths | ✅ Done |
| Reference-first + `get_tool_result` landed | ✅ Done |
| `/cost` shows real session telemetry (not WIP) | ✅ Done |
| `package.json` license = MIT (matches LICENSE) | ✅ Done |
| **KCB-10 live benchmark executed** | ⏳ Pending |
| README contains **live** KCB-10 results (not mock) | ⏳ Pending |
| `benchmarks/kcb-10/leaderboard.md` updated from live run | ⏳ Pending |
| No major success-rate regression vs prior baseline | ⏳ Verify on live run |
| Tagged release `v0.1.3` (not from huge uncommitted branch) | ⏳ Pending |

---

## Immediate next steps

1. `pnpm benchmark:kcb10:live` — collect real numbers
2. Update README **Live Benchmark Results** from live scorecard
3. Commit efficiency sprint + tag **v0.1.3**
4. Product Hunt only after live leaderboard is public

---

## Dev commands

```bash
pnpm build && pnpm test
pnpm benchmark:kcb10
pnpm benchmark:kcb10:live
koda init && koda login && koda
```

---

## Instructions for AI assistants

- Default to **context efficiency and measurement**, not new features
- Never invent KEI or token numbers — cite `.koda/metrics.json` or KCB-10 leaderboard
- Preserve stateless REPL design unless explicitly asked to change it
- Label WIP honestly; do not claim mock benchmark results as live proof
- Run `pnpm build && pnpm test` before proposing merges

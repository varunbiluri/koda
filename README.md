# Koda — Agentic Coding in Your Terminal

**Open-source coding agent — repository intelligence, context efficiency, built-in benchmarking.**

[![CI](https://github.com/varunbiluri/koda/actions/workflows/ci.yml/badge.svg)](https://github.com/varunbiluri/koda/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-1279%20passing-brightgreen)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Free](https://img.shields.io/badge/free-forever-green)](#)

```bash
npm install -g @varunbilluri/koda
koda init
koda          # interactive agent session (like Claude Code)
```

---

![Koda — terminal agent demo: fix bug, /commit, /help](assets/demo.gif)

---

## What Koda is

Koda is an **open-source coding agent** focused on **repository intelligence** and **context efficiency**, with built-in benchmarking and transparent token telemetry. It runs in your terminal, uses tools (read, edit, grep, shell, git), and executes tasks through natural language.

| Claude Code | Koda |
|-------------|------|
| Terminal agent REPL | `koda` → interactive session |
| Slash commands (`/diff`, `/doctor`, `/compact`) | Same pattern — type `/help` |
| Tool loop (read, edit, bash) | Full tool registry + permission gates |
| Vendor-locked | **Free** — Azure, OpenAI, Anthropic, or Ollama |

**You describe. Koda executes. You review the diff.**

See [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) for architecture, metrics, and v0.1.3 release gates.

---

## Live benchmark results (KCB-10)

[KCB-10](benchmarks/kcb-10/) — 10 fixed tasks measuring success rate, median tokens, ref rate, and **KEI**.

| Run | Success | KEI | Median tokens | Ref rate |
|-----|---------|-----|---------------|----------|
| Mock (CI) | 70% | 140* | 37,200 | 59% |

\*Mock fixture data — not a marketing claim. **Live results pending.**

```bash
pnpm benchmark:kcb10        # mock (no API key)
pnpm benchmark:kcb10:live   # real provider — updates leaderboard.md
```

Full history: [benchmarks/kcb-10/leaderboard.md](benchmarks/kcb-10/leaderboard.md)

---

## Works today / Roadmap

We ship honestly. Slash commands marked **`[wip]`** in `/help` are guidance-only or not fully implemented yet.

### Works today

| Area | Status |
|------|--------|
| Interactive REPL (`koda`) | Natural language + tool loop |
| Providers | Azure, OpenAI, Anthropic, Ollama |
| Repo indexing + hybrid search | `koda init` |
| Tool loop (read, edit, grep, shell, git) | With permission gates |
| MCP servers | `/mcp`, `koda mcp` |
| **`/commit`** | Staged diff → AI message → approval → commit |
| One-shot workflows | `koda fix`, `koda add`, `koda auto` |
| Multi-agent routing | Simple / medium / complex tasks |
| Workspace memory | `.koda/workspace-memory.json` |
| Context trimming + tool result index | Reference-first @ 200 chars + `get_tool_result` |
| KCB-10 benchmark + task telemetry | `pnpm benchmark:kcb10` · live via `--live` |
| `/cost`, `/budget` | Session tokens, ref rate, KEI |
| Repository intelligence bootstrap | Symbol-aware retrieval + disk tool cache |
| VS Code extension + LSP | `koda start-lsp` |
| Tests | 1279+ passing |

### Roadmap / partial

| Area | Notes |
|------|--------|
| `/resume`, `/rewind`, `/undo` | Guidance only — use git + stateless turns |
| `/history` | Placeholder (stateless engine) |
| `/vim`, `/theme`, `/desktop`, `/mobile` | Not native integrations yet |
| Full chat transcript memory | By design: repo-native context instead |
| `SafeProvider` hardening | In progress |

---

## Quick start

```bash
npm install -g @varunbilluri/koda
cd your-project
koda login    # or /login inside session
koda init     # index repo (~10s)
koda          # start agent — ask anything
```

Inside the session:

```
> fix the login bug after password reset
> explain src/auth/service.ts
> /diff
> /commit
> /doctor
> /help
```

One-shot shortcuts still work:

```bash
koda fix "users can't log in after password reset"
koda add "rate limiting middleware"
```

---

## Real example

```bash
$ koda fix "users can't log in after password reset"
```

```
Koda — Autonomous Bug Fix
   users can't log in after password reset

── Step 1 / 3 ──────────────────────────────
   Searching for password reset flow...
   Found: src/auth/reset-service.ts
   Root cause: token not invalidated after use
   Patching src/auth/reset-service.ts
   Verifying — running pnpm test...
   Fix verified in 1 step

Done in 14.2s

  Koda fixed this automatically.
     If this saved you time, share it: github.com/varunbiluri/koda
```

---

## What Koda does differently

Most AI tools **suggest** code. You still paste it, run tests, and fix what broke.

Koda **executes the full loop**:

| Step | Other tools | Koda |
|------|------------|------|
| Find root cause | You | Autonomous |
| Write the fix | Suggests | Applies |
| Run tests | You | Autonomous |
| Self-correct on failure | Never | Up to 3 loops |
| Impact analysis | Never | Before every write |
| Learn from this repo | Never | Every session |

---

## Three primary workflows

### Fix a bug
```bash
koda fix "null pointer in auth middleware"
koda fix "race condition in message queue handler"
koda fix "memory leak after connection pool exhausted"
```

### Add a feature
```bash
koda add "rate limiting middleware with Redis"
koda add "password strength validation on signup"
koda add "export users to CSV endpoint"
```

### Refactor a module
```bash
koda refactor src/auth/
koda refactor src/database/connection.ts
```

All three: plan → implement → test → self-correct → diff.

---

## First-run experience

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Welcome to Koda — your autonomous engineer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  What I found:
    Runtime:     Node.js
    Framework:   Express/Fastify
    Tests:       vitest
    Files:       847 indexed

  What I can do:
    1. Fix bugs — describe the problem, I find the cause and patch it
    2. Add features — describe what you need, I plan, implement, and verify
    3. Refactor — point me at a module, I restructure it safely

  Why I'm different:
    - I execute tasks — not just suggest them
    - I fix my own mistakes — autonomous retry with verification
    - I learn from this repo — gets smarter each session

  Suggested first task:
    koda fix "describe your bug here"
```

---

## Safety model

| Tier | Examples | Behaviour |
|------|----------|-----------|
| **AUTO** | `read_file`, `search_code`, `git_log` | Always approved — zero friction |
| **ASK** | `write_file`, `git_commit`, `run_terminal` | Prompts before every state change |
| **BLOCK** | `rm -rf`, `git push --force`, `DROP TABLE` | Unconditionally blocked — forever |

- All edits are unified diffs, never blind overwrites
- Confidence scoring — stops and asks when unsure, never guesses
- Impact analysis warns before touching high-dependency files

---

## Configuration

```bash
koda login   # pick provider, endpoint, key, model
```

| Provider | Models |
|----------|--------|
| **Azure AI Foundry** | gpt-4o, gpt-4o-mini, o1, o3-mini |
| **OpenAI** | gpt-4o, gpt-4-turbo, gpt-3.5-turbo |
| **Anthropic** | claude-3-5-sonnet, claude-3-haiku |
| **Ollama** | llama3, mistral, codellama (local, free) |

---

## All commands

```
Core:
  koda fix  "<bug>"       Fix a bug end-to-end
  koda add  "<feature>"   Add a feature with tests
  koda auto "<task>"      Fully autonomous mode

Analysis:
  koda ask      "<question>"   Ask about the codebase
  koda explain  "<symbol>"     Explain any symbol
  koda review                  Code quality + security scan
  koda plan     "<task>"       Plan without writing

Indexing:
  koda init           Index your repo (one time, ~10s)
  koda status         Index stats
  koda symbols <q>    Search the symbol index

Maintenance:
  koda update         Check for updates + install
  koda feedback       Submit feedback or bug report
  koda doctor         Health check

Developer platform:
  koda watch          Watch for changes + background agents
  koda start-lsp      LSP server (VS Code / Neovim)
  koda improve        Run all agents, preview patches
```

---

## Requirements

- **Node.js 18+**
- An AI provider (Azure, OpenAI, Anthropic, or Ollama for free local)
- A project with `pnpm`, `npm`, `yarn`, `cargo test`, `go test`, or `pytest`

---

## Build from source

```bash
git clone https://github.com/varunbiluri/koda
cd koda
pnpm install && pnpm build
pnpm test   # 1279+ tests
pnpm link --global
```

---

## Something broken?

```bash
koda feedback --broke "what happened"
```

Or open an issue — I read every one.

---

## License

[MIT](LICENSE) — free to use, modify, and distribute.

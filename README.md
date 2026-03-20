# Koda — Autonomous AI Engineer

**Give Koda a task. Come back to a working diff.**

Koda fixes bugs, adds features, and refactors code — end-to-end. It verifies
the result with your tests and self-corrects when it fails. No hand-holding.

[![CI](https://github.com/varunbiluri/koda/actions/workflows/ci.yml/badge.svg)](https://github.com/varunbiluri/koda/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-1219%20passing-brightgreen)](#)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

---

![Koda — autonomous bug fix demo](assets/demo.gif)

---

## 3 commands to start

```bash
npm install -g @varunbilluri/koda   # 1. install
koda init                            # 2. index your repo (10s)
koda login                           # 3. configure AI provider
```

Then fix your first bug:

```bash
koda fix "users can't log in after password reset"
```

```
⚡ Koda — Autonomous Bug Fix
   users can't log in after password reset

── Step 1 / 3 ──────────────────────────────
   ○ Searching for password reset flow...
   ○ Root cause: token not invalidated after use
   ○ Patching src/auth/reset-service.ts
   ○ Verifying — running pnpm test...
   ✓ Fix verified in 1 step

✓ Done in 14.2s
  3/4 tasks completed (75%) · ~1.2h saved
```

---

## What Koda does differently

Most AI coding tools **suggest** code. You still have to read it, evaluate it,
paste it, and run the tests yourself.

Koda **executes**:

| Step | Other tools | Koda |
|------|------------|------|
| Find root cause | You | ✅ Autonomous |
| Write the fix | Suggests | ✅ Applies |
| Run tests | You | ✅ Autonomous |
| Self-correct on failure | Never | ✅ Up to 3 loops |
| Impact analysis | Never | ✅ Before every write |
| Learn from this repo | Never | ✅ Every session |

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

All three workflows: plan → implement → run tests → self-correct if needed → present diff.

---

## First-run experience

`koda init` detects your stack and walks you through setup on the first run:

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
    ①  Fix bugs — describe the problem, I find the cause and patch it
    ②  Add features — describe what you need, I plan, implement, and verify
    ③  Refactor — point me at a module, I restructure it safely

  Why I'm different:
    →  I execute tasks — not just suggest them
    →  I fix my own mistakes — autonomous retry with verification
    →  I learn from this repo — gets smarter each session
```

---

## Safety model

Koda never does something destructive without your explicit go-ahead:

| Tier | Examples | Behaviour |
|------|----------|-----------|
| **AUTO** | `read_file`, `search_code`, `git_log` | Always approved — zero friction |
| **ASK** | `write_file`, `git_commit`, `run_terminal` | Prompts before every state change |
| **BLOCK** | `rm -rf`, `git push --force`, `DROP TABLE` | Unconditionally blocked — forever |

Additional safeguards:
- All edits are unified diffs, never blind overwrites
- Confidence scoring — stops and asks when unsure (not guesses)
- Impact analysis warns before touching high-dependency files
- Token budgets cap runaway usage per agent and globally

---

## Configuration

```bash
koda login   # interactive — picks provider, endpoint, key, model
```

Config stored at `.koda/config.json`. Supported providers:

| Provider | Models |
|----------|--------|
| **Azure AI Foundry** | gpt-4o, gpt-4o-mini, o1, o3-mini |
| **OpenAI** | gpt-4o, gpt-4-turbo, gpt-3.5-turbo |
| **Anthropic** | claude-3-5-sonnet, claude-3-haiku |
| **Ollama** | llama3, mistral, codellama (local) |

Switch model without re-configuring:
```bash
koda use gpt-4o-mini
```

---

## All commands

```
Core workflows:
  koda fix  "<bug>"       Fix a bug end-to-end
  koda add  "<feature>"   Add a feature with tests
  koda auto "<task>"      Fully autonomous mode (plan → execute → verify)

Analysis:
  koda ask      "<question>"   Ask about the codebase
  koda explain  "<symbol>"     Deep explanation of any symbol
  koda review                  Code quality + security scan
  koda plan     "<task>"       Generate an execution plan (no writes)

Indexing:
  koda init [--force]     Index / re-index the repository
  koda status             Index statistics
  koda symbols "<query>"  Search the symbol index

Configuration:
  koda login              Configure AI provider interactively
  koda models             List available models
  koda use <model>        Switch model
  koda config             Show / update config

Developer platform:
  koda watch              Watch for changes, run background agents
  koda start-lsp          Start LSP server (VS Code / Neovim)
  koda improve            Run all agents, preview patches

Observability:
  koda doctor             Health check — diagnose problems
  koda history            View past executions
  koda feedback           Submit feedback or bug report
```

---

## Requirements

- **Node.js 18+**
- An AI provider (Azure, OpenAI, Anthropic, or Ollama)
- Your project uses `pnpm`, `npm`, `yarn`, `cargo test`, `go test`, or `pytest`

---

## Build from source

```bash
git clone https://github.com/varunbiluri/koda
cd koda
pnpm install
pnpm build
pnpm link --global
pnpm test        # 1219 tests, should all pass
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports → [GitHub Issues](https://github.com/varunbiluri/koda/issues).

Found something broken? `koda feedback` opens an issue template pre-filled
with your session context.

---

## License

[ISC](LICENSE) — free to use, modify, and distribute.

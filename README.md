# Koda — Autonomous AI Engineer

**I built an AI that fixes bugs in your codebase end-to-end — for free.**

[![CI](https://github.com/varunbiluri/koda/actions/workflows/ci.yml/badge.svg)](https://github.com/varunbiluri/koda/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-1240%20passing-brightgreen)](#)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Free](https://img.shields.io/badge/free-forever-green)](#)

```bash
npm install -g @varunbilluri/koda
koda init
koda fix "your bug here"
```

---

![Koda — autonomous bug fix demo](assets/demo.gif)

---

## What this does

Describe a bug. Koda:

1. Reads your codebase and finds the root cause
2. Writes the patch
3. Runs your tests
4. If they fail — classifies the error, adjusts, tries again
5. Presents a verified diff for you to review

**You describe. Koda executes. You commit.**

---

## Real example

```bash
$ koda fix "users can't log in after password reset"
```

```
⚡ Koda — Autonomous Bug Fix
   users can't log in after password reset

── Step 1 / 3 ──────────────────────────────
   ○ Searching for password reset flow...
   ○ Found: src/auth/reset-service.ts
   ○ Root cause: token not invalidated after use
   ○ Patching src/auth/reset-service.ts
   ○ Verifying — running pnpm test...
   ✓ Fix verified in 1 step

✓ Done in 14.2s

  🚀 Koda fixed this automatically.
     If this saved you time, share it: github.com/varunbiluri/koda
```

---

## What Koda does differently

Most AI tools **suggest** code. You still paste it, run tests, and fix what broke.

Koda **executes the full loop**:

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
    ①  Fix bugs — describe the problem, I find the cause and patch it
    ②  Add features — describe what you need, I plan, implement, and verify
    ③  Refactor — point me at a module, I restructure it safely

  Why I'm different:
    →  I execute tasks — not just suggest them
    →  I fix my own mistakes — autonomous retry with verification
    →  I learn from this repo — gets smarter each session

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
pnpm test   # 1240 tests, all passing
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

[ISC](LICENSE) — free to use, modify, and distribute.

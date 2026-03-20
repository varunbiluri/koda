# Koda — Product Hunt Launch

## Tagline

> Give Koda a task. Come back to a working diff.

---

## Description (up to 260 characters)

Koda is an autonomous AI engineer. Describe a bug or feature in plain English —
Koda reads your codebase, writes the patch, runs your tests, self-corrects when
they fail, and delivers a verified diff to review.

Not a copilot. A junior engineer that never sleeps.

**Works with:** Node.js · Python · Go · Rust
**AI providers:** Azure · OpenAI · Anthropic · Ollama
**License:** ISC — free forever

---

## First Comment (founder's note)

Hey Product Hunt! I'm Varun, the solo dev behind Koda.

I built Koda because I kept running into the same wall: AI coding tools are
amazing at *suggesting* code, but the loop is still manual — paste the
suggestion, run the tests, fix what broke, repeat. That's still work.

Koda closes the loop. You describe the task; Koda executes it end-to-end,
including the part where it fails and has to try again.

**Three things I'm proudest of:**

1. **Self-correction loop** — when tests fail, Koda classifies the error
   (compile error vs test failure vs missing dep), adjusts its approach, and
   retries. Up to 3 iterations by default.

2. **Safety gates** — `rm -rf`, `git push --force`, and `DROP TABLE` are
   unconditionally blocked. The LLM cannot override this. I got burned early
   in development and hard-coded the block list.

3. **Impact analysis** — before touching a file with many dependents, Koda
   shows you the blast radius and asks if you want to proceed. Refactors don't
   silently break 40 files.

**Honest caveat:** Koda works best on well-tested codebases. If your test
coverage is low, it can't verify its own work. `koda add --generate-tests`
helps, but there's a chicken-and-egg problem I'm still solving.

Try it on a bug you've been putting off. Run `koda feedback` if something
goes wrong — I read every report.

```bash
npm install -g @varunbilluri/koda
koda init
koda fix "describe the bug"
```

GitHub: https://github.com/varunbiluri/koda

---

## Gallery captions

1. `koda fix` — root-cause analysis, patch, test verification in one command
2. `koda add` — feature implementation with automatic test generation
3. Self-correction loop — Koda retries with a different approach when tests fail
4. Three-tier permission gate — reads auto, writes ask, destructive never
5. Onboarding wizard — detects your stack and suggests first task automatically

---

## Topics / Tags

`developer-tools` · `artificial-intelligence` · `productivity` · `open-source`
· `typescript` · `autonomous-agents` · `code-quality`

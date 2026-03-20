# Koda — Launch Posts

Copy-paste ready posts for Reddit, Hacker News, and Twitter/X.

---

## Reddit — r/programming · r/webdev · r/ExperiencedDevs

**Title:**
> I built an AI that fixes bugs in your repo automatically (free + open source)

**Body:**
```
I got tired of AI tools that paste code into chat and leave me to do
the rest — read the suggestion, evaluate it, paste it, run the tests,
fix what broke, repeat. That's still work.

So I built Koda: you describe the bug, it finds the root cause, patches
the file, runs your tests, and self-corrects if they fail. You just
review the diff at the end.

Demo: [gif — koda fix completes in 14 seconds]

**Three commands:**

npm install -g @varunbilluri/koda
koda init       # index your repo in ~10s
koda fix "describe the bug"

**What makes it different from copilots:**
- Executes the full loop, not just suggests code
- If tests fail, it classifies the error and tries again (up to 3x)
- Impact analysis warns before touching high-dependency files
- Learns which fix strategies work in your repo session over session
- rm -rf, git push --force, DROP TABLE — unconditionally blocked

Works with Node/TS, Python, Go, Rust.
Supports Azure, OpenAI, Anthropic, Ollama (free local models work).

GitHub: https://github.com/varunbiluri/koda
Completely free. ISC license.

Would love to hear what breaks in your codebase. Run koda feedback
and it pre-fills a bug report with your session context.
```

---

## Hacker News — Show HN

**Title:**
> Show HN: Koda – autonomous AI engineer that fixes code end-to-end (free, open source)

**Text:**
```
I've been building Koda for the past several months. The pitch: describe
a bug or feature, Koda reads your codebase, writes the patch, runs your
tests, self-corrects on failure, and delivers a verified diff.

The thing I kept hitting with existing tools is the loop is still manual.
The AI suggests; you validate, paste, run tests, fix what it missed.
Koda tries to close that loop completely.

**Technical architecture:**

- Parallel DAG scheduler — tasks run concurrently where the graph allows
- Failure classifier — distinguishes compile_error / test_failure /
  missing_dep / runtime_error and routes each to a different retry strategy
- Content-hash AST cache — second run on unchanged files is O(1)
- Learning loop — records which fix strategies work; future retries on
  the same repo use them automatically
- Three-tier permission gate: read=auto, write=ask, destructive=never
- Token budget governor — per-agent and global caps to prevent runaway cost

**Self-correction loop in detail:**
When verification fails, the failure is classified, a targeted re-prompt
is built (e.g. "compile error at line 42: X — fix this specific issue"),
the strategy hint from the learning loop is appended, and the engine
re-runs. Up to 3 iterations by default.

**Safety:**
The LLM will sometimes generate destructive commands. I hard-coded a
block list: rm -rf, git push --force, DROP TABLE, and similar patterns
are intercepted before execution regardless of what the model says.
Impact analysis shows blast radius before touching any file with >5 deps.

It's open source under ISC. Node.js 18+, your own AI API key.
Also works with Ollama for fully local, free execution.

GitHub: https://github.com/varunbiluri/koda

Happy to answer technical questions on the architecture.
```

---

## Twitter / X thread

**Tweet 1 (hook):**
```
I built an AI that fixes bugs in your codebase end-to-end.

Not "here's some code" — it runs the full loop:

find root cause → patch → run tests → self-correct if they fail

For free. Open source. Works in 5 minutes.

↓ thread
```

**Tweet 2 (demo):**
```
Real example:

$ koda fix "users can't log in after password reset"

  ○ Searching for password reset flow...
  ○ Root cause: token not invalidated after use
  ○ Patching src/auth/reset-service.ts
  ○ Verifying — running pnpm test...
  ✓ Done in 14.2s

[attach demo.gif]
```

**Tweet 3 (differentiation):**
```
Most AI coding tools: suggest code, you do the rest.

Koda:
→ Reads your codebase (not a chat window)
→ Finds the root cause
→ Writes and applies the patch
→ Runs your tests
→ If they fail → classifies the error → adjusts → tries again
→ Shows you a verified diff

You describe the bug. You review the diff. That's it.
```

**Tweet 4 (why free):**
```
Why free?

I want developers to actually use it.
I want to hear what breaks.
I want to fix what breaks.

The most useful thing I can build right now is a tool that
developers actually run on real codebases.

Stars and PRs are worth more than $20/mo right now.
```

**Tweet 5 (try it):**
```
Three commands:

npm install -g @varunbilluri/koda
koda init
koda fix "describe your bug"

Works with Node, Python, Go, Rust.
Azure / OpenAI / Anthropic / Ollama (local, free).

→ github.com/varunbiluri/koda

If it saved you time, share this. That's the whole ask.
```

---

## Discord / Slack announcement

```
Hey 👋

I just open-sourced Koda — an autonomous AI engineer that fixes bugs
and adds features end-to-end.

The idea: describe a bug, Koda finds the root cause, patches the file,
runs your tests, and self-corrects if they fail. You review the diff.

Three commands:
  npm install -g @varunbilluri/koda
  koda init
  koda fix "describe the bug"

Works with Node/TS, Python, Go, Rust.
Supports Azure, OpenAI, Anthropic, Ollama (local = free).
100% free, ISC license.

→ github.com/varunbiluri/koda

Would love to hear if it handles your bugs — or spectacularly fails 🙂
Run `koda feedback` and it pre-fills a bug report automatically.
```

---

## Product Hunt

**Tagline:**
> I built an AI that fixes your bugs end-to-end — for free.

**Description:**
```
Koda is a free, open-source autonomous AI engineer. Describe a bug or
feature — Koda reads your codebase, writes the code, runs your tests,
self-corrects if they fail, and delivers a verified diff.

Unlike copilots that suggest code into a chat window, Koda executes
the full loop: find root cause → patch → test → self-correct.

Core workflows:
• koda fix "bug description" — autonomous bug fixing
• koda add "feature description" — implementation with tests
• koda refactor src/module/ — safe restructuring

Key differentiators:
• Self-correction loop — retries with a new strategy when tests fail
• Failure classification — routes compile errors, test failures,
  missing deps, and runtime errors to different fix approaches
• Impact analysis — warns before touching high-dependency files
• Hard safety gates — rm -rf, force push, DROP TABLE: blocked forever

Node.js 18+. Azure / OpenAI / Anthropic / Ollama.
Free. No limits. ISC license.
```

---

## Metrics to watch (week 1)

| Signal | Green | Yellow |
|--------|-------|--------|
| GitHub stars | >50 | <20 |
| npm installs | >100 | <30 |
| Issues opened | >5 | 0 |
| `koda feedback` reports | >10 | 0 |
| HN points | >50 | <10 |

**Where the first 50 stars will come from:**
1. HN "Show HN" — highest ceiling, 24h window, architects and senior devs
2. r/programming — slower burn, long-tail discoverability
3. Twitter/X — needs the demo GIF, high share-per-impression
4. Discord/Slack (AI dev communities) — targeted, high-intent

**The only thing that matters:** did the user complete their first task?
Track that with `koda feedback` reports. Everything else is vanity.

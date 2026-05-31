# Koda — Product Hunt Launch

## Tagline

> We label what's not done yet — an honest, open-source terminal coding agent.

---

## Description (up to 260 characters)

Koda: agentic coding in your terminal. Repo-native context, tool loop, slash commands, MCP.
Azure, OpenAI, Anthropic, or Ollama offline. `/commit` with AI messages + approval gates.
Free & MIT. Claude Code–style UX without vendor lock-in.

---

## First Comment (founder's note)

Hey Product Hunt! I'm Varun, the solo dev behind Koda.

**We label what's not done yet** — slash commands marked `[wip]` in `/help` are guidance-only until they ship. No silent no-ops. That honesty is the product.

Claude Code showed what's possible: a terminal agent that reads your repo, runs tools, edits code, and uses git. Koda is the **open-source, bring-your-own-model** version:

- **Terminal-first** — `koda` REPL with natural language + 40+ slash commands
- **Repo-native context** — local index, hybrid search, bounded tool outputs (not an ever-growing chat log)
- **Full tool loop** — read, grep, edit, terminal, git — with AUTO / ASK / BLOCK permission tiers
- **MCP** — connect external tools via `/mcp` or `koda mcp`
- **`/commit`** — staged diff → AI commit message → you approve → `git commit`
- **Offline / private** — run **Ollama locally** (`ollama pull llama3`, `koda login`) — no cloud API required. Rare among terminal agents; great for firewalls and privacy-conscious teams.
- **One-shot modes** — `koda fix` and `koda add` when you don't want a session

```bash
npm install -g @varunbilluri/koda
koda login      # Azure, OpenAI, Anthropic, or Ollama
koda init
koda            # interactive agent
git add -p && koda   # then /commit inside session
```

GitHub: https://github.com/varunbiluri/koda · Architecture: [ARCHITECTURE.md](https://github.com/varunbiluri/koda/blob/main/ARCHITECTURE.md)

---

## Works today / Roadmap

Slash commands marked **`[wip]`** in `/help` are not fully implemented yet.

### Works today

| Area | Status |
|------|--------|
| Interactive REPL (`koda`) | ✅ Natural language + tool loop |
| Providers | ✅ Azure, OpenAI, Anthropic, **Ollama (local/offline)** |
| Repo indexing + hybrid search | ✅ `koda init` |
| Tool loop (read, edit, grep, shell, git) | ✅ Permission gates |
| MCP servers | ✅ `/mcp`, `koda mcp` |
| **`/commit`** | ✅ Staged diff → AI message → approval → commit |
| One-shot workflows | ✅ `koda fix`, `koda add`, `koda auto` |
| Multi-agent routing | ✅ Simple / medium / complex tasks |
| Workspace memory | ✅ `.koda/workspace-memory.json` |
| Context trimming + ToolResultIndex | ✅ Bounded LLM context |
| VS Code extension + LSP | ✅ `koda start-lsp` |
| Tests | ✅ 1255+ passing |
| License | ✅ MIT |

### Roadmap / partial

| Area | Notes |
|------|--------|
| `/resume`, `/rewind`, `/undo` | Guidance only — use git + stateless turns |
| `/cost`, `/history` | Basic / placeholder (stateless engine) |
| `/vim`, `/theme`, `/desktop`, `/mobile` | Not native integrations yet |
| Full chat transcript memory | By design: repo-native context instead |

---

## Gallery captions

1. `koda` — interactive agent (natural language + slash commands)
2. Tool loop — READ, SEARCH, WRITE, RUN with live stages
3. **`/commit`** — AI-generated message from staged diff, approve before write
4. `/diff` and permission prompts before every file change
5. **Ollama offline** — local models, no cloud API key
6. `koda fix` — one-shot autonomous bug fix with test verification

---

## Topics / Tags

`developer-tools` · `artificial-intelligence` · `productivity` · `open-source`
· `typescript` · `autonomous-agents` · `claude-code-alternative` · `terminal`
· `ollama` · `local-ai` · `mcp`

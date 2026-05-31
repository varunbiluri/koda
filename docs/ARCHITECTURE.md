# Koda Architecture

Map of how Koda works — for contributors and anyone comparing it to Claude Code.

## Overview

Koda is a **terminal-first coding agent**. The primary UX is an interactive REPL (`koda`) that runs a **tool-calling loop** against your repository, with optional one-shot commands (`koda fix`, `koda add`).

Design philosophy:

1. **Repo-native context** — rebuild understanding from the index each turn, not from an ever-growing chat log.
2. **Bounded LLM input** — trim messages, externalize large tool outputs.
3. **Safety by default** — permission tiers (AUTO / ASK / BLOCK), diff-before-write.
4. **Bring your own model** — Azure, OpenAI, Anthropic, or Ollama via a shared `AIProvider` interface.

```
User → SessionManager (REPL)
         → ConversationEngine (routing)
              → ReasoningEngine | PlanExecutor | GraphScheduler
                   → ToolRegistry + MCP tools
                   → AIProvider
         → Index / HybridRetrieval / WorkspaceIntelligence
```

## Entry points

| Path | Module | Role |
|------|--------|------|
| `koda` (no args) | `src/cli/session/session-manager.ts` | Interactive agent session |
| `koda fix/add/auto` | `src/cli/commands/*.ts` | One-shot autonomous workflows |
| `koda init` | `src/cli/commands/init.ts` | Repository indexing |
| `koda mcp` | `src/cli/commands/mcp.ts` | MCP server management |

Global bootstrap: `src/index.ts` — error handlers, delegates to CLI.

## Context stack (core differentiator)

Unlike products that rely primarily on conversational memory, Koda assembles context in layers:

### 1. Repository index (`src/indexing/`, `src/store/`)

- `koda init` chunks and indexes the repo into `.koda/`
- Symbol index (`src/symbols/`) for structural queries
- Metadata: file count, dependencies, timestamps

### 2. Retrieval (`src/search/`)

- `QueryEngine` — TF-IDF search over chunks
- `HybridRetrieval` — optional embedding search when configured
- Automatic retrieval on each user message in `ReasoningEngine.chat()`

### 3. System prompt assembly (`src/ai/reasoning/reasoning-engine.ts`)

Built per turn from:

- Repo metadata (name, branch, file count)
- Detected stack (`src/analysis/dependency-detector.ts`)
- `AGENTS.md` (truncated)
- Workspace memory (`src/memory/workspace-intelligence.ts`)
- Retrieved code chunks

### 4. Context trimming (`src/ai/context/context-trimmer.ts`)

- Soft limit ~80k characters
- Always keeps system messages; drops oldest conversation turns
- Called via `trimContext()` before every LLM request in the tool loop

### 5. Tool output externalization (`src/runtime/tool-result-index.ts`)

- Large tool outputs stored out-of-band with IDs (`result_N`)
- LLM receives previews + references, not full file contents or test logs
- Cache reuse within a session (TTL) to avoid redundant reads

### 6. Stateless turns

`ReasoningEngine.chat()` intentionally **does not** consume rolling chat history. Each user message triggers a fresh context build from the repo. Cross-session learning lives in `.koda/workspace-memory.json`, not transcript replay.

## Agent loop

`ReasoningEngine.chat()` (`src/ai/reasoning/reasoning-engine.ts`):

1. Parallel init: AGENTS.md, dependencies, workspace memory, hybrid retrieval, MCP connect
2. Optional planning step for action-verb queries
3. Tool loop (capped rounds):
   - `trimContext(loopMessages)` → `sendChatCompletion` with tools
   - Execute tool calls (built-in + `mcp__*` tools)
   - Loop detection on identical repeated results
   - Permission gate + diff approval for writes
4. Return metrics (tools, tokens, duration)

Task routing (`src/orchestrator/task-router.ts`):

| Complexity | Path |
|------------|------|
| SIMPLE | `ReasoningEngine.chat()` |
| MEDIUM | Planning → `PlanExecutor` → verification |
| COMPLEX | `TaskGraphBuilder` → `GraphScheduler` (multi-agent) |

## Tools

`ToolRegistry` (`src/tools/tool-registry.ts`) exposes built-in tools to the LLM:

- Read: `read_file`, `search_code`, `list_files`, `fetch_url`
- Write: `write_file`, `edit_file`, `apply_patch` (with diff approval)
- Exec: `run_terminal` (ASK tier)
- Git: `git_status`, `git_diff`, `git_commit`, etc.

Permission gate: `src/runtime/permission-gate.ts` — AUTO / ASK / BLOCK.

MCP: `src/mcp/mcp-manager.ts` — connects stdio MCP servers, exposes tools as `mcp__{server}__{tool}`.

## AI providers

`src/ai/providers/`:

| Provider | File |
|----------|------|
| Azure OpenAI | `azure-provider.ts` |
| OpenAI | `openai-provider.ts` |
| Anthropic | `anthropic-provider.ts` (tool format conversion) |
| Ollama | `ollama-provider.ts` (OpenAI-compatible local API) |

Factory: `provider-factory.ts` — `createProvider(config)`.

Setup wizard: `provider-setup.ts` — `koda login` / `/login`.

Config: `~/.koda/config.json`.

## Session UX

- **Slash commands**: `src/cli/session/slash/` — registry + router; `[wip]` marks incomplete commands in `/help`
- **`/commit`**: `slash/commit-handler.ts` — staged diff → LLM message → `permissionGate` → `git commit`
- **UI**: `src/cli/session/ui-renderer.ts` — header, tool stages, diff preview, help
- **MCP CLI**: `src/mcp/cli-handlers.ts` — shared by `/mcp` and `koda mcp`

## Developer platform (Phase 7)

| Module | Purpose |
|--------|---------|
| `src/lsp/` | LSP server for editor integration |
| `src/watcher/` | File system watcher + event bus |
| `src/background/` | Agents on save/commit (test, security, perf) |
| `src/preview/` | Patch approve/reject workflow |
| `extensions/vscode/` | VS Code extension |

## Testing

```bash
pnpm build   # TypeScript compile
pnpm test    # Vitest (~1255 tests)
```

Key suites: `tests/cli/session/`, `tests/ai/`, `tests/mcp/`.

## Related docs

- [CLAUDE.md](CLAUDE.md) — phase overview and CLI reference
- [AGENTS.md](AGENTS.md) — auto-generated repo map for AI agents
- `README.md` — user-facing quick start + **Works today / Roadmap**

## License

[MIT](LICENSE)

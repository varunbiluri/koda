# Koda — AI Software Engineer

Koda is an autonomous AI software engineer for your codebase. It indexes repositories, reasons over code, and executes multi-agent workflows.

## Development

```bash
pnpm build        # TypeScript compile (zero errors required)
pnpm test         # Run all tests with Vitest
pnpm dev          # Run via tsx (no compile step)
```

## Architecture

Koda is built across 7 phases:

| Phase | Description | Key Modules |
|-------|-------------|-------------|
| 1 | Repository Indexing | `src/engine/`, `src/indexing/` |
| 2 | AI Reasoning | `src/ai/`, `src/search/` |
| 3 | Multi-Agent Execution | `src/agents/`, `src/orchestrator/` |
| 4 | Self-Improvement & Observability | `src/memory/`, `src/observability/` |
| 5 | Hierarchical Intelligence | `src/hierarchy/`, `src/skills/` |
| 6 | Enterprise-Scale Symbol Intelligence | `src/symbols/`, `src/distributed/` |
| 7 | Developer Platform & IDE Integration | `src/lsp/`, `src/watcher/`, `src/background/`, `src/preview/`, `extensions/vscode/` |

## Phase 7 — Developer Platform

### LSP Server (`src/lsp/`)

- `server.ts` — LSP server over stdio (JSON-RPC)
- `connection-manager.ts` — Content-Length framing
- `document-store.ts` — Open document tracking
- `symbol-provider.ts` — Symbol lookup for LSP
- `hover-provider.ts` — Hover at cursor position
- `code-action-provider.ts` — Koda code actions

Start: `node dist/index.js start-lsp`

### Repository Watcher (`src/watcher/`)

- `repo-watcher.ts` — File system event service
- `event-dispatcher.ts` — Typed event bus

Start: `node dist/index.js watch`

### Background Agents (`src/background/`)

Built-in agents triggered on file save, git commit, or pull request:
- `test-coverage-agent`
- `security-scan-agent`
- `performance-analysis-agent`
- `dead-code-agent`

Results stored in `.koda/background-results/`

### Patch Preview (`src/preview/`)

- `patch-preview.ts` — Approve/reject patch workflow
- `diff-renderer.ts` — Terminal and Markdown diff rendering

### VS Code Extension (`extensions/vscode/`)

- `extension.ts` — LanguageClient connecting to `koda start-lsp`
- Commands: `koda.explainCode`, `koda.refactorCode`, `koda.generateTests`, `koda.optimizeFile`

## CLI Commands

| Command | Description |
|---------|-------------|
| `koda init` | Index the repository |
| `koda ask <question>` | Ask about the codebase |
| `koda explain <symbol>` | Explain a symbol |
| `koda watch` | Watch for changes + background agents |
| `koda improve` | Run all agents, show patch preview |
| `koda start-lsp` | Start LSP server (for editors) |
| `koda symbols <query>` | Query symbol index |
| `koda plan <task>` | Generate execution plan |

## Configuration

AI provider config stored in `.koda/config.json`:

```json
{
  "provider": "azure",
  "endpoint": "https://your-endpoint.openai.azure.com",
  "apiKey": "...",
  "model": "gpt-4o"
}
```

Run `koda login` to configure interactively.

## Testing

```bash
pnpm test                          # all tests
pnpm test tests/lsp/               # LSP tests
pnpm test tests/background/        # background agent tests
pnpm test tests/extensions/        # patch preview tests
```

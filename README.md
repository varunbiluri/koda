# Koda

**An autonomous AI software engineer for your codebase.**

Koda indexes your repository, reasons over code with Azure AI, and executes multi-agent workflows to build features, fix bugs, and refactor code — all from the terminal.

---

## Installation

### npm (recommended)

```bash
npm install -g @varunbilluri/koda
```

Then run:

```bash
koda
```

**Requirements:** Node.js 18+

### One-line install (curl)

```bash
curl -fsSL https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh | bash
```

### Build from source

```bash
git clone https://github.com/varunbiluri/koda
cd koda
pnpm install
pnpm build
pnpm link --global
```

**Requirements:** Node.js 18+, pnpm 8+

---

## Quick start

```bash
# 1. Index your repository
koda init

# 2. Start the conversational session
koda

# 3. Ask questions or give tasks in plain English
> explain how authentication works
> add a password reset endpoint
> fix the login redirect loop
```

---

## CLI commands

| Command | Description |
|---------|-------------|
| `koda` | Start conversational session (natural language) |
| `koda init` | Index the repository |
| `koda ask <question>` | Ask a question about the codebase |
| `koda explain <symbol>` | Explain a symbol in depth |
| `koda build <task>` | Build a new feature |
| `koda fix <task>` | Fix a bug |
| `koda refactor <task>` | Refactor code |
| `koda login` | Configure Azure AI credentials |
| `koda status` | Show index stats |
| `koda symbols <query>` | Search the symbol index |
| `koda plan <task>` | Generate an execution plan |
| `koda watch` | Watch for changes and run background agents |
| `koda improve` | Run all agents and show patch preview |
| `koda start-lsp` | Start LSP server (for editor integrations) |
| `koda doctor` | Run health checks |
| `koda history` | View past executions |

---

## Configuration

Run `koda login` to set up Azure AI credentials interactively. Koda will:

1. Prompt for your Azure endpoint
2. Prompt for your API key (hidden input)
3. Fetch your available deployments
4. Let you select a model with arrow keys

Config is stored in `~/.koda/config.json`.

---

## Architecture

```
src/
├── ai/               # Azure AI provider, reasoning engine, config
├── agents/           # 50+ specialized agents (planning, coding, testing, debugging)
├── background/       # Background agents triggered on file save / git commit
├── cli/              # Commands, session manager, intent detection
├── distributed/      # Worker pool and task dispatcher
├── engine/           # AST parsing, repository indexing
├── execution/        # Multi-agent execution engine
├── hierarchy/        # Hierarchical agent intelligence
├── indexing/         # Incremental indexer, repo watcher
├── lsp/              # Language Server Protocol server
├── memory/           # Workspace memory and execution history
├── observability/    # Logging, metrics, event tracking
├── orchestrator/     # Agent registry and orchestration
├── patch/            # Diff generation and application
├── preview/          # Patch preview and diff rendering
├── search/           # TF-IDF vector search, query engine
├── skills/           # Skill registry
├── store/            # Index persistence
├── symbols/          # Symbol index and call graph
├── watcher/          # File event dispatcher
└── extensions/vscode # VS Code extension
```

---

## IDE integration

Start the LSP server and connect your editor:

```bash
koda start-lsp
```

The bundled VS Code extension (in `extensions/vscode/`) connects automatically and provides:

- Hover: symbol type, definition location, AI explanation
- Go-to-definition and find-references via the symbol index
- Code actions: Explain, Refactor, Generate Tests, Optimize

---

## Background agents

Running `koda watch` starts background agents that trigger on file changes:

| Agent | Trigger |
|-------|---------|
| `test-coverage-agent` | File save |
| `security-scan-agent` | File save |
| `performance-analysis-agent` | Git commit |
| `dead-code-agent` | Pull request |

Results are written to `.koda/background-results/`.

---

## Development

```bash
pnpm build        # Compile TypeScript (zero errors required)
pnpm test         # Run all tests (Vitest)
pnpm dev          # Run via tsx without compiling
```

### Running specific tests

```bash
pnpm test tests/lsp/
pnpm test tests/background/
pnpm test tests/cli/session/
pnpm test tests/extensions/
```

---

## Safety

- **Patch-based edits** — unified diffs, never full rewrites
- **Preview mode** — `--dry-run` on any execution command
- **File locking** — prevents concurrent agent modifications
- **Verification loops** — build, test, and lint checks after each iteration
- **Budget limits** — configurable token limits per agent and globally

---

## License

MIT

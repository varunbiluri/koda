# Changelog

All notable changes to Koda are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Task Execution Graph (TEG) runtime — DAG-based stateful agent execution replacing the linear reasoning loop
- `ExecutionGraph` — directed acyclic graph with per-node state machine (`pending → running → completed | failed | retrying | skipped`)
- `GraphScheduler` — parallel dependency-aware node executor with `Promise.race()` scheduling
- `TaskGraphBuilder` — LLM-powered task-to-DAG converter with cycle detection and fallback graph
- `ToolResultIndex` — out-of-band tool output storage; LLM receives reference IDs instead of raw content
- `ExecutionStateStore` — disk-persistent execution state with crash-resume via `findResumable()`
- Context isolation per graph node — each node executes with its own fresh conversation history
- Dynamic failure recovery — `FailureAnalyzer` classifies errors and inserts recovery nodes into the live graph
- `RepositoryExplorer` — deterministic LLM-free filesystem walker producing structured repository context
- `ContextSummarizer` — loop-message summarizer (threshold: 40 messages, keeps last 10)
- `ToolPlanner` — pre-execution tool sequence planner integrated into `PlanExecutor`
- Explorer context caching in `RepoIntelligenceCache` (10-minute TTL)
- Worker agent tool preference constraints (ordered tool lists per agent type)
- 92 new unit tests across 8 test files

---

## [0.1.2]

### Added
- Phase 7: Developer Platform
  - LSP server (`src/lsp/`) — Language Server Protocol over stdio
  - Repository Watcher (`src/watcher/`) — file-system event service
  - Background Agents (`src/background/`) — triggered on save, commit, or PR
  - Patch Preview (`src/preview/`) — approve/reject workflow with diff rendering
  - VS Code Extension (`extensions/vscode/`) — LanguageClient + 4 commands
- CLI commands: `review`, `test`, `graph`, `skills`, `index-status`, `workers`, `config`, `models`, `use`, `replay`, `repl`
- `ReviewAgent` — codebase quality and security analysis
- `TestAgent` — scans for untested functions and generates Vitest scaffolding

### Changed
- Supervisor agent integrates `RepositoryExplorer` and `ToolPlanner` for complex tasks

---

## [0.1.1]

### Added
- Phase 5 & 6: Hierarchical Intelligence + Symbol Intelligence
  - `src/hierarchy/` — hierarchical agent orchestration
  - `src/skills/` — reusable skill registry
  - `src/symbols/` — enterprise-scale symbol index
  - `src/distributed/` — distributed execution primitives

---

## [0.1.0]

### Added
- Initial release of Koda — Autonomous AI Software Engineer CLI
- Phase 1: Repository Indexing (`src/engine/`, `src/indexing/`)
- Phase 2: AI Reasoning (`src/ai/`, `src/search/`)
- Phase 3: Multi-Agent Execution (`src/agents/`, `src/orchestrator/`)
- Phase 4: Self-Improvement & Observability (`src/memory/`, `src/observability/`)
- CLI commands: `init`, `ask`, `explain`, `watch`, `improve`, `start-lsp`, `symbols`, `plan`
- Azure OpenAI and OpenAI provider support
- `koda login` interactive configuration

[Unreleased]: https://github.com/varunbiluri/koda/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/varunbiluri/koda/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/varunbiluri/koda/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/varunbiluri/koda/releases/tag/v0.1.0

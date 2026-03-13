# Koda - AI Software Engineer

<p align="center">
  <em>An autonomous AI software engineer that understands, builds, and improves your codebase</em>
</p>

---

## 🚀 Overview

Koda is a multi-phase AI software engineering system that combines repository intelligence, AI reasoning, multi-agent execution, and self-improvement capabilities to autonomously handle complex software engineering tasks.

### Key Features

- 🔍 **Repository Intelligence** - Deep AST-based code indexing with semantic search
- 🤖 **AI Reasoning** - Azure AI Foundry integration with streaming responses
- 👥 **Multi-Agent System** - 50+ specialized agents across 6 categories
- 🔄 **Iterative Verification** - Automatic testing, building, and fixing
- 📊 **Observability** - Comprehensive logging, metrics, and execution tracking
- 🧠 **Self-Learning** - Learns from past executions to improve future performance
- 💰 **Budget Control** - Token limits and cost management
- 🔐 **Safe Execution** - File locking, patch-based edits, and preview mode

---

## 📦 Installation

### ⚡ One-Line Install (Recommended)

Install Koda with a single command using curl:

```bash
curl -fsSL https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh | bash
```

Or using wget:

```bash
wget -qO- https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh | bash
```

**What this does:** Downloads, builds, and installs Koda to `~/.koda` with automatic PATH setup.

See [CURL_INSTALL.md](./CURL_INSTALL.md) for details and security considerations.

---

### 🔧 Manual Install (Alternative)

```bash
# 1. Install dependencies
pnpm install

# 2. Build the project
pnpm build

# 3. Install globally
pnpm link --global

# 4. Verify installation
koda --version
```

### Prerequisites

- **Node.js** 18+
- **pnpm** 8+
- **TypeScript** 5+

### Installation Methods

**Global Installation (Recommended):**
- Installs `koda` command globally
- Use from any directory
- See [INSTALL.md](./INSTALL.md) for detailed guide

**Local Development:**
- Use `pnpm dev <command>`
- No global installation needed
- Good for testing changes

**Troubleshooting:**
- Command not found? Add pnpm global bin to PATH
- Permission errors? See [INSTALL.md](./INSTALL.md) troubleshooting
- Build errors? Check [INSTALL.md](./INSTALL.md) platform notes

---

## 🎯 Quick Start

### 1. Initialize Your Repository

Index your codebase for intelligent search and analysis:

```bash
koda init
```

This creates a `.koda/` directory with:
- AST-parsed code chunks
- TF-IDF vector embeddings
- Dependency graph
- File metadata

### 2. Check Status

View your repository index:

```bash
koda status
```

### 3. Ask Questions

Query your codebase using natural language:

```bash
koda ask "How does authentication work?"
```

### 4. Configure AI (Optional)

Set up Azure AI Foundry for advanced reasoning:

```bash
koda login
koda models
koda use <model-name>
```

### 5. Execute Tasks

Let Koda's agents handle complex tasks:

```bash
# Build the project with verification
koda build "implement user registration"

# Fix bugs automatically
koda fix "login page redirect loop"

# Refactor code safely
koda refactor "extract duplicate validation logic"
```

---

## 🏗️ Architecture

### Phase 1: Repository Intelligence Engine

**Components:**
- **AST Parsing** - tree-sitter for TypeScript & Python
- **Code Chunking** - Semantic code segmentation
- **Vector Search** - TF-IDF + cosine similarity
- **Dependency Graph** - Import/export relationship tracking

**CLI Commands:**
- `koda init` - Index repository
- `koda status` - View index stats
- `koda ask <query>` - Search codebase

### Phase 2: AI Reasoning Integration

**Components:**
- **Azure AI Provider** - Streaming chat completions
- **Context Builder** - Smart context selection with token limits
- **Reasoning Engine** - Search → AI → Response pipeline
- **Configuration** - Model selection and credentials

**CLI Commands:**
- `koda login` - Configure Azure credentials
- `koda models` - List available models
- `koda use <model>` - Select active model

### Phase 3: Multi-Agent Execution System

**Agent Categories:**
1. **Planning** (6 agents) - Architecture, task breakdown, analysis
2. **Coding** (12 agents) - Backend, frontend, API, database, etc.
3. **Testing** (13 agents) - Unit, integration, E2E, verification
4. **Debugging** (8 agents) - Runtime, memory, async issues
5. **Review** (8 agents) - Security, performance, style
6. **Optimization** (5 agents) - Performance, bundle size, queries
7. **Infrastructure** (3 agents) - Docker, CI/CD, deployment

**Orchestration:**
- Task decomposition
- Wave-based parallel execution
- Dependency resolution
- Agent registry with 50+ specialized agents

**CLI Commands:**
- `koda build <task>` - Execute with build agents
- `koda fix <task>` - Execute with debugging agents
- `koda refactor <task>` - Execute with review agents

### Phase 4: Self-Improving Autonomous System

**Components:**

**Verification Engine:**
- Type checking (TypeScript)
- Build verification
- Lint checking
- Test execution
- Error parsing and reporting

**Patch System:**
- Unified diff generation
- Content verification before apply
- Revert capability
- Safer than full file rewrites

**File Lock Manager:**
- Prevents concurrent modifications
- Timeout-based lock acquisition
- Per-agent lock tracking

**Budget System:**
- Token estimation (~4 chars/token)
- Per-agent limits (calls + tokens)
- Global token budget
- Cost control and reporting

**Execution History:**
- Persistent execution records
- Success/failure tracking
- Agent usage patterns
- File modification history

**Learning Engine:**
- Pattern recognition from history
- Agent combination suggestions
- Common pitfall identification
- File hotspot detection

**Observability:**
- Event logging (13 event types)
- Real-time metrics tracking
- Detailed execution reports
- Performance monitoring

**Enhanced Execution:**
- Iterative verification loops (max 3 iterations)
- Auto-retry on failure
- Learning from past executions
- Full integration of all Phase 4 systems

**CLI Commands:**
- `koda doctor` - Health check and verification
- `koda history [options]` - View execution history
- `koda replay <id>` - Replay past execution

---

## 📚 Usage Examples

### Repository Indexing

```bash
# Initialize with default settings
koda init

# Force re-index
koda init --force

# Check index status
koda status
```

### Querying Your Codebase

```bash
# Find authentication code
koda ask "where is user authentication implemented?"

# Understand dependencies
koda ask "what external APIs does this project use?"

# Find specific patterns
koda ask "show me all database queries"
```

### AI-Powered Development

```bash
# Build new features
koda build "add password reset functionality"

# Fix bugs with context
koda fix "users can't upload files larger than 10MB"

# Refactor safely
koda refactor "move validation logic to separate module"
```

### Execution History

```bash
# View recent executions
koda history

# View statistics
koda history --stats

# Filter by success/failure
koda history --success
koda history --failed

# Search by task
koda history --task "authentication"

# Replay with learning
koda replay <execution-id> --with-suggestions
```

### Health Checks

```bash
# Run full health check
koda doctor

# Skip tests during check
koda doctor --skip-tests

# Skip build during check
koda doctor --skip-build
```

### Interactive Mode

```bash
# Start REPL
koda

# Interactive commands:
/init          # Initialize repository
/ask <query>   # Query codebase
/status        # Show stats
/quit          # Exit
```

---

## ⚙️ Configuration

### Directory Structure

```
.koda/
├── meta.json              # Index metadata
├── files.json             # File information
├── chunks.json            # Code chunks with content
├── vectors.json           # TF-IDF vectors
├── graph.json             # Dependency graph
├── vocabulary.json        # Search vocabulary
└── execution-history.json # Past executions
```

### Azure AI Configuration

Stored in `~/.koda-config.json`:

```json
{
  "azure": {
    "endpoint": "https://your-endpoint.openai.azure.com",
    "apiKey": "your-api-key",
    "deployment": "gpt-4"
  }
}
```

### Budget Configuration

Default limits (configurable):

```typescript
{
  globalMaxTokens: 500000,    // 500K tokens total
  perAgentMaxCalls: 20,       // Max 20 AI calls per agent
  perAgentMaxTokens: 50000    // Max 50K tokens per agent
}
```

---

## 🧪 Testing

### Run All Tests

```bash
pnpm test
```

### Run Specific Test Suite

```bash
pnpm test tests/unit/engine
pnpm test tests/integration
pnpm test tests/agents
```

### Test Coverage

- **176 tests** across 21 test files
- Unit tests for all core components
- Integration tests for CLI commands
- Agent behavior tests

---

## 🏛️ Project Structure

```
koda/
├── src/
│   ├── agents/           # Multi-agent system
│   │   ├── planning/     # Architecture & analysis agents
│   │   ├── coding/       # Implementation agents
│   │   ├── testing/      # Test & verification agents
│   │   └── verification/ # Build, lint, type-check agents
│   ├── ai/              # AI integration
│   │   ├── providers/   # Azure AI provider
│   │   ├── reasoning/   # Reasoning engine
│   │   └── prompts/     # Prompt templates
│   ├── budget/          # Token & cost management
│   ├── cli/             # Command-line interface
│   ├── engine/          # Indexing & AST parsing
│   ├── evaluation/      # Verification system
│   ├── execution/       # Execution engine
│   ├── locks/           # File locking
│   ├── memory/          # Workspace & history
│   ├── observability/   # Logging & metrics
│   ├── orchestrator/    # Agent orchestration
│   ├── patch/           # Patch generation & application
│   ├── search/          # Query engine
│   ├── store/           # Index storage
│   ├── tools/           # Filesystem, git, terminal tools
│   └── utils/           # Utilities
├── tests/               # Comprehensive test suite
└── bin/                 # CLI entry point
```

---

## 🔧 Development

### Build in Watch Mode

```bash
pnpm build --watch
```

### Run in Development

```bash
pnpm dev <command>
```

### Linting

```bash
pnpm lint
```

### Type Checking

```bash
pnpm type-check
```

---

## 🛡️ Safety Features

### Preview Mode

All execution commands support `--dry-run` for previewing changes:

```bash
koda build "add feature" --dry-run
```

### File Locking

Prevents concurrent agent modifications to the same file.

### Patch-Based Edits

Uses unified diffs instead of full file rewrites for safer modifications.

### Verification Loops

Automatic build, test, and lint verification after each iteration.

### Budget Limits

Prevents runaway costs with configurable token limits.

---

## 📊 Observability

### Event Types Tracked

- `agent_started` / `agent_finished`
- `tool_called`
- `file_modified`
- `verification_started` / `verification_passed` / `verification_failed`
- `iteration_started` / `iteration_completed`
- `budget_exceeded`
- `lock_acquired` / `lock_released`

### Metrics Collected

- Total agents executed
- Success/failure rates
- Files modified
- Tests run
- Token usage
- Execution duration
- Iteration counts

---

## 🤝 Contributing

### Adding New Agents

1. Implement the `Agent` interface in `src/agents/`
2. Register in `src/orchestrator/agent-registry.ts`
3. Add tests in `tests/agents/`

### Adding New CLI Commands

1. Create command file in `src/cli/commands/`
2. Register in `src/cli/index.ts`
3. Add tests

---

## 📝 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- **tree-sitter** - AST parsing
- **natural** - TF-IDF implementation
- **Azure AI Foundry** - AI reasoning
- **Commander.js** - CLI framework
- **Vitest** - Testing framework

---

## 📞 Support

For issues, questions, or contributions:
- GitHub Issues: [Create an issue]
- Documentation: See `/docs` directory

---

<p align="center">
  <strong>Built with TypeScript, powered by AI, designed for developers</strong>
</p>

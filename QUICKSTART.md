# Koda Quick Start Guide

Get up and running with Koda in 5 minutes.

---

## ⚡ Installation (3 commands)

```bash
pnpm install         # Install dependencies
pnpm build          # Build project
pnpm link --global  # Install CLI globally
```

**Verify:**
```bash
koda --version  # Should show: 0.1.0
```

**Troubleshooting:** If `koda` command not found, see [INSTALL.md](./INSTALL.md)

---

## 🎯 Basic Usage (Your First Commands)

### 1. Initialize Repository

```bash
cd your-project
koda init
```

**What this does:** Indexes your codebase (parses files, builds search index)

### 2. Query Your Code

```bash
koda ask "how does authentication work?"
koda ask "where is the database connection configured?"
koda ask "show me all API endpoints"
```

**What this does:** Searches your indexed code using semantic search

### 3. Check Status

```bash
koda status
```

**What this does:** Shows index stats (files, chunks, last update)

---

## 🤖 AI-Powered Features (Optional)

### Configure Azure AI

```bash
koda login
# Enter your Azure endpoint and API key

koda models
# See available models

koda use gpt-4
# Select a model
```

### Use AI Agents

```bash
# Build new features
koda build "add user registration with email verification"

# Fix bugs automatically
koda fix "login form doesn't validate passwords"

# Refactor code
koda refactor "extract validation logic into separate module"
```

---

## 📊 Monitoring & History

### Health Check

```bash
koda doctor
# Runs: type check, build, lint, tests
```

### View History

```bash
koda history
# See past executions

koda history --stats
# See statistics

koda replay <execution-id>
# Replay a past execution
```

---

## 🎮 Interactive Mode

```bash
koda
# Starts REPL

# Available commands:
/init          # Initialize repository
/ask <query>   # Query codebase
/status        # Show stats
/quit          # Exit
```

---

## 📚 Command Reference

| Command | Description | Example |
|---------|-------------|---------|
| `koda init` | Index repository | `koda init` |
| `koda status` | Show index stats | `koda status` |
| `koda ask` | Query codebase | `koda ask "auth flow"` |
| `koda build` | Build feature with agents | `koda build "add login"` |
| `koda fix` | Fix bugs with agents | `koda fix "broken link"` |
| `koda refactor` | Refactor with agents | `koda refactor "cleanup"` |
| `koda doctor` | Health check | `koda doctor` |
| `koda history` | View past executions | `koda history --stats` |
| `koda replay` | Replay execution | `koda replay exec-123` |
| `koda login` | Configure Azure AI | `koda login` |
| `koda models` | List AI models | `koda models` |
| `koda use` | Select AI model | `koda use gpt-4` |

---

## 🔥 Common Workflows

### Workflow 1: Understand New Codebase

```bash
cd new-project
koda init
koda ask "what is the project structure?"
koda ask "how does the authentication work?"
koda ask "what are the main API endpoints?"
```

### Workflow 2: Add New Feature

```bash
koda build "add password reset functionality"
# Preview changes with --dry-run
koda build "add password reset" --dry-run
```

### Workflow 3: Debug & Fix

```bash
koda fix "users can't upload files larger than 5MB"
koda doctor  # Verify the fix
koda history  # See what was changed
```

### Workflow 4: Code Refactoring

```bash
koda refactor "move validation logic to validators/"
koda doctor  # Ensure tests still pass
```

---

## 💡 Pro Tips

1. **Use descriptive task names** for better AI understanding
2. **Run `koda doctor`** regularly to catch issues early
3. **Check `koda history`** to learn from past executions
4. **Use `--dry-run`** to preview changes before applying
5. **Re-run `koda init --force`** after major code changes

---

## 🆘 Need Help?

```bash
koda --help              # General help
koda <command> --help    # Command-specific help
```

**Documentation:**
- Full guide: [README.md](./README.md)
- Installation: [INSTALL.md](./INSTALL.md)
- Issues: GitHub Issues

---

## 🚀 What's Next?

- ✅ Index your repository: `koda init`
- ✅ Try querying: `koda ask "your question"`
- ✅ Run health check: `koda doctor`
- ✅ Configure AI: `koda login` (optional)
- ✅ Build something: `koda build "your feature"`

**Happy coding with Koda! 🎉**

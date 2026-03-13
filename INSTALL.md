# Koda Installation Guide

Complete guide to installing Koda CLI globally on your system.

---

## Prerequisites

Before installing Koda, ensure you have:

- **Node.js** 18.0.0 or higher
- **pnpm** 8.0.0 or higher

### Check Your Versions

```bash
node --version   # Should be v18+
pnpm --version   # Should be 8+
```

### Install pnpm (if needed)

```bash
npm install -g pnpm
```

---

## Installation Methods

### Method 1: Global Installation (Recommended)

Install Koda globally so you can use the `koda` command anywhere:

#### Step 1: Clone or Download

```bash
cd /path/to/koda
```

#### Step 2: Install Dependencies

```bash
pnpm install
```

This will:
- Install all npm dependencies
- Build native tree-sitter bindings
- Set up development dependencies

#### Step 3: Build the Project

```bash
pnpm build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

#### Step 4: Link Globally

```bash
pnpm link --global
```

This creates a global symlink to the `koda` command.

#### Step 5: Verify Installation

```bash
koda --version
# Output: 0.1.0

koda --help
# Shows available commands
```

✅ **Success!** You can now use `koda` from any directory.

---

### Method 2: Local Development

Use Koda without global installation (for development):

#### Install Dependencies

```bash
pnpm install
pnpm build
```

#### Run Commands

```bash
# Using pnpm
pnpm dev init
pnpm dev ask "your query"
pnpm dev build "your task"

# Or using node directly
node bin/koda.js init
node bin/koda.js --help
```

---

### Method 3: NPM Package (Future)

Once published to npm:

```bash
npm install -g koda
# or
pnpm add -g koda
```

---

## Verifying Installation

After installation, test these commands:

```bash
# Check version
koda --version

# View help
koda --help

# Initialize in a test project
cd /path/to/your/project
koda init
koda status
```

---

## First-Time Setup

### 1. Initialize Your First Repository

```bash
cd /path/to/your/project
koda init
```

This creates a `.koda/` directory with indexed code.

### 2. Configure Azure AI (Optional)

If you want AI-powered features:

```bash
# Set up Azure credentials
koda login

# List available models
koda models

# Select a model
koda use gpt-4
```

Your config is stored in `~/.koda-config.json`

### 3. Test Basic Commands

```bash
# Query your codebase
koda ask "how does authentication work?"

# Check repository status
koda status

# Run health check
koda doctor
```

---

## Troubleshooting

### Command Not Found

If `koda: command not found` appears after `pnpm link --global`:

**Check pnpm global bin directory:**
```bash
pnpm bin -g
```

**Add to your PATH** (in `~/.bashrc`, `~/.zshrc`, or `~/.profile`):
```bash
export PATH="$(pnpm bin -g):$PATH"
```

Then reload your shell:
```bash
source ~/.zshrc  # or ~/.bashrc
```

### Permission Errors

If you get permission errors during `pnpm link --global`:

**Option 1: Use sudo (not recommended)**
```bash
sudo pnpm link --global
```

**Option 2: Configure pnpm prefix (recommended)**
```bash
# Set pnpm global directory to your home
pnpm config set store-dir ~/.pnpm-store
pnpm config set global-bin-dir ~/.pnpm-global/bin

# Add to PATH
export PATH="$HOME/.pnpm-global/bin:$PATH"

# Re-link
pnpm link --global
```

### Tree-sitter Build Errors

If tree-sitter native modules fail to build:

**On macOS:**
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Rebuild
pnpm rebuild
```

**On Linux:**
```bash
# Install build essentials
sudo apt-get install build-essential

# Rebuild
pnpm rebuild
```

**On Windows:**
```bash
# Install Windows Build Tools
npm install -g windows-build-tools

# Rebuild
pnpm rebuild
```

### TypeScript Errors

If you see TypeScript compilation errors:

```bash
# Clean and rebuild
rm -rf dist node_modules
pnpm install
pnpm build
```

---

## Uninstallation

### Remove Global Installation

```bash
pnpm uninstall -g koda
```

### Clean Local Project

```bash
# Remove dependencies
rm -rf node_modules

# Remove build artifacts
rm -rf dist

# Remove .koda index (if desired)
rm -rf .koda
```

---

## Updating Koda

### Update Global Installation

```bash
cd /path/to/koda
git pull  # If using git
pnpm install
pnpm build
pnpm link --global
```

### Check Current Version

```bash
koda --version
```

---

## Platform-Specific Notes

### macOS

- Requires Xcode Command Line Tools for tree-sitter
- pnpm global bin: Usually `~/.local/share/pnpm/global/bin`

### Linux

- Requires `build-essential` package
- pnpm global bin: Usually `~/.local/share/pnpm/global/bin`

### Windows

- Requires Windows Build Tools
- Use PowerShell or Git Bash for commands
- pnpm global bin: Usually `%LOCALAPPDATA%\pnpm`

---

## Advanced Configuration

### Custom Installation Directory

```bash
# Set custom pnpm directory
pnpm config set global-dir /custom/path

# Install there
pnpm link --global
```

### Development Mode

For active development with auto-rebuild:

```bash
# Terminal 1: Watch and rebuild
pnpm build --watch

# Terminal 2: Test commands
pnpm dev <command>
```

---

## Getting Help

If you encounter issues:

1. Check this guide's Troubleshooting section
2. Run `koda doctor` to diagnose problems
3. Check GitHub Issues
4. Review logs in `.koda/` directory

---

## Next Steps

After installation:

1. ✅ Read the [README.md](./README.md) for usage examples
2. ✅ Run `koda init` in your project
3. ✅ Try `koda ask` to query your code
4. ✅ Explore agent capabilities with `koda build`, `koda fix`, etc.
5. ✅ Check execution history with `koda history`

---

**Happy coding with Koda! 🚀**

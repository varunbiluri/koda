# All Installation Methods for Koda

Complete reference for every way to install Koda CLI.

---

## 🚀 Quick Comparison

| Method | Ease | Speed | Use Case |
|--------|------|-------|----------|
| **curl/wget** | ⭐⭐⭐⭐⭐ | Fast | Production users |
| **Automated script** | ⭐⭐⭐⭐ | Fast | Local installation |
| **Manual pnpm** | ⭐⭐⭐ | Medium | Developers |
| **Development mode** | ⭐⭐ | Slow | Active development |
| **npm package** | ⭐⭐⭐⭐⭐ | Fast | Future (not yet published) |

---

## Method 1: One-Line Curl Install ⚡ (RECOMMENDED)

**Best for:** End users, quick setup, automated deployments

### Using curl

```bash
curl -fsSL https://raw.githubusercontent.com/your-org/koda/main/scripts/install-remote.sh | bash
```

### Using wget

```bash
wget -qO- https://raw.githubusercontent.com/your-org/koda/main/scripts/install-remote.sh | bash
```

**What happens:**
- ✅ Auto-checks Node.js 18+ and pnpm
- ✅ Installs to `~/.koda/koda`
- ✅ Creates symlink in `~/.local/bin`
- ✅ Adds to PATH automatically
- ✅ No sudo required

**Time:** ~2-3 minutes

**See:** [CURL_INSTALL.md](./CURL_INSTALL.md) for full guide

---

## Method 2: Local Automated Script

**Best for:** Local installation without internet, testing

```bash
./install.sh
```

**Prerequisites:**
- You've cloned/downloaded the repo
- Node.js 18+ and pnpm installed

**What happens:**
- ✅ Same as curl install but runs locally
- ✅ Checks prerequisites
- ✅ Installs dependencies
- ✅ Builds project
- ✅ Links globally

**Time:** ~2-3 minutes

---

## Method 3: Manual Installation with pnpm

**Best for:** Developers, contributors, customization

```bash
# Step 1: Install dependencies
pnpm install

# Step 2: Build the project
pnpm build

# Step 3: Link globally
pnpm link --global

# Step 4: Verify
koda --version
```

**Locations:**
- Install: Current directory
- Global bin: `$(pnpm bin -g)`

**Time:** ~3-4 minutes

**See:** [INSTALL.md](./INSTALL.md) for troubleshooting

---

## Method 4: Development Mode (No Global Install)

**Best for:** Active development, testing changes

```bash
# Install and build
pnpm install
pnpm build

# Run commands without global install
pnpm dev init
pnpm dev ask "query"
pnpm dev --help

# Or use node directly
node bin/koda.js init
```

**Advantages:**
- ✅ No global installation needed
- ✅ Test changes immediately
- ✅ Multiple versions possible

**Disadvantages:**
- ❌ Must use `pnpm dev` prefix
- ❌ Only works in project directory

**Time:** ~2 minutes

---

## Method 5: NPM Package (Future)

**Best for:** Simple, standard npm workflow

```bash
# Global install
npm install -g koda

# Or with pnpm
pnpm add -g koda

# Verify
koda --version
```

**Status:** 🚧 Not yet published to npm

**Once available:** This will be the simplest method

---

## Method 6: Homebrew (Future - macOS/Linux)

**Best for:** macOS users, system package management

```bash
# Add tap (once available)
brew tap your-org/koda

# Install
brew install koda

# Update
brew upgrade koda
```

**Status:** 🚧 Not yet available

**Platform:** macOS, Linux

---

## Method 7: Docker (Advanced)

**Best for:** Containerized environments, CI/CD

```bash
# Pull image
docker pull your-org/koda:latest

# Run
docker run -it -v $(pwd):/workspace your-org/koda init

# Alias for convenience
alias koda='docker run -it -v $(pwd):/workspace your-org/koda'
```

**Status:** 🚧 Not yet built

**See:** Future Docker documentation

---

## 🧪 Testing Curl Install Locally

Before publishing, test the curl installation:

```bash
# Start local server
./scripts/test-curl-install.sh

# In another terminal, install from localhost
curl -fsSL http://localhost:8000/scripts/install-remote.sh | bash
```

---

## 🔄 Updating Koda

### Curl Install

Re-run the installation command:

```bash
curl -fsSL https://url/install-remote.sh | bash
```

### Manual Install

```bash
cd ~/.koda/koda  # or your install location
git pull
pnpm install
pnpm build
```

### pnpm Global

```bash
cd /path/to/koda
git pull
pnpm install
pnpm build
pnpm link --global
```

---

## 🗑️ Uninstalling

### Curl Install

```bash
curl -fsSL https://url/install-remote.sh | bash -s uninstall
```

### Manual Uninstall

```bash
# Remove global command
pnpm uninstall -g koda
# or
rm -f ~/.local/bin/koda

# Remove installation directory
rm -rf ~/.koda/koda

# Remove from PATH (edit ~/.zshrc or ~/.bashrc)
# Delete the "# Koda CLI" section
```

---

## 🎯 Which Method Should I Use?

### For End Users:
→ **Curl Install** (Method 1)
- Simplest one-liner
- Automatic setup
- No git/repo knowledge needed

### For Developers:
→ **Manual pnpm** (Method 3) or **Dev Mode** (Method 4)
- Full control
- Easy to modify
- Can test changes

### For CI/CD:
→ **Curl Install** (Method 1) or **Docker** (Method 7, future)
- Reproducible
- Scriptable
- No manual steps

### For System Admins:
→ **Homebrew** (Method 6, future) or **Package Manager**
- Standard tools
- Easy updates
- System-wide management

---

## 📍 Installation Locations by Method

| Method | Location | Binary | Config |
|--------|----------|--------|--------|
| Curl | `~/.koda/koda` | `~/.local/bin/koda` | `~/.koda-config.json` |
| Local script | Current directory | `$(pnpm bin -g)/koda` | `~/.koda-config.json` |
| Manual pnpm | Current directory | `$(pnpm bin -g)/koda` | `~/.koda-config.json` |
| Dev mode | Current directory | N/A (run with pnpm) | `~/.koda-config.json` |
| NPM | `$(npm prefix -g)/lib/node_modules/koda` | `$(npm bin -g)/koda` | `~/.koda-config.json` |

---

## 🔧 Troubleshooting by Method

### Curl Install Issues

**Command not found after install:**
```bash
source ~/.zshrc  # or ~/.bashrc
```

**Permission denied:**
```bash
# The script should NOT require sudo
# Check ownership of ~/.local/bin
ls -la ~/.local/bin
```

### Manual Install Issues

**pnpm link fails:**
```bash
# Try with sudo
sudo pnpm link --global

# Or configure pnpm prefix
pnpm config set global-bin-dir ~/.pnpm-global/bin
export PATH="$HOME/.pnpm-global/bin:$PATH"
```

**Build errors:**
```bash
# Clean and rebuild
rm -rf node_modules dist
pnpm install
pnpm build
```

---

## 🌐 Platform-Specific Notes

### macOS

**Recommended:** Curl install or Homebrew (future)

**Requirements:**
- Xcode Command Line Tools
- Install: `xcode-select --install`

### Linux

**Recommended:** Curl install or system package (future)

**Ubuntu/Debian:**
```bash
sudo apt-get install build-essential
```

**CentOS/RHEL:**
```bash
sudo yum install gcc-c++ make
```

### Windows

**Recommended:** WSL2 + curl install

**Native Windows:**
- Use Git Bash or PowerShell
- Install windows-build-tools
- Some features may be limited

---

## 📚 Documentation by Method

- **Curl install:** [CURL_INSTALL.md](./CURL_INSTALL.md)
- **Manual install:** [INSTALL.md](./INSTALL.md)
- **Quick start:** [QUICKSTART.md](./QUICKSTART.md)
- **Full docs:** [README.md](./README.md)
- **Setup guide:** [SETUP.txt](./SETUP.txt)

---

## ✅ Verification (All Methods)

After installation, verify with:

```bash
# Check version
koda --version

# Check location
which koda

# Test basic command
koda --help

# Try in a project
cd your-project
koda init
koda status
```

---

**Choose your method and get started! 🚀**

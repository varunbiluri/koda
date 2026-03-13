# Curl-Based Installation for Koda

One-line remote installation using curl or wget.

---

## 🚀 Quick Install (One Command)

### Using curl (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh | bash
```

### Using wget

```bash
wget -qO- https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh | bash
```

---

## 📋 What This Does

The installation script automatically:

1. ✅ Checks for Node.js 18+ and pnpm
2. ✅ Creates `~/.koda` directory
3. ✅ Clones the Koda repository
4. ✅ Installs dependencies with pnpm
5. ✅ Builds the project
6. ✅ Creates symlink in `~/.local/bin/koda`
7. ✅ Adds to PATH in your shell config
8. ✅ Verifies installation

---

## 🔧 Installation Options

### Standard Installation

```bash
curl -fsSL https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh | bash
```

### Preview Before Installing

Download and review the script first:

```bash
# Download
curl -fsSL https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh > install-koda.sh

# Review
cat install-koda.sh

# Run
bash install-koda.sh
```

### Custom Installation Directory

```bash
INSTALL_DIR="$HOME/custom/path" curl -fsSL https://raw.githubusercontent.com/.../install-remote.sh | bash
```

---

## 🧪 Local Testing (Before Publishing)

For testing the curl installation locally:

### Option 1: Using Python's HTTP Server

```bash
# In the Koda directory
cd /path/to/koda

# Start local server
python3 -m http.server 8000

# In another terminal, install using local URL
curl -fsSL http://localhost:8000/scripts/install-remote.sh | bash
```

### Option 2: Using Node's HTTP Server

```bash
# Install http-server
npm install -g http-server

# Serve the directory
http-server -p 8000

# Install from local server
curl -fsSL http://localhost:8000/scripts/install-remote.sh | bash
```

### Option 3: Direct Execution (Simplest)

```bash
# Run the script directly
bash scripts/install-remote.sh
```

---

## 🔍 Step-by-Step (What Happens)

When you run the curl command:

```bash
curl -fsSL https://url/install-remote.sh | bash
```

**1. curl flags explained:**
- `-f` : Fail silently on server errors
- `-s` : Silent mode (no progress bar)
- `-S` : Show errors even in silent mode
- `-L` : Follow redirects

**2. The script:**
- Downloads to memory (not saved to disk)
- Pipes directly to bash
- Runs with your user permissions

**3. Installation process:**
```
Checking prerequisites
  ✓ Node.js 18+
  ✓ pnpm 8+

Creating directories
  ✓ ~/.koda/
  ✓ ~/.local/bin/

Downloading Koda
  ✓ Git clone repository
  ✓ pnpm install
  ✓ pnpm build

Setting up PATH
  ✓ Add ~/.local/bin to PATH
  ✓ Update shell config

Verification
  ✓ koda --version
```

---

## 🛡️ Security Considerations

### Before Running Any Curl Installation

**Always review scripts before piping to bash:**

```bash
# View the script first
curl -fsSL https://url/install-remote.sh

# Or download and inspect
curl -fsSL https://url/install-remote.sh > install.sh
cat install.sh
bash install.sh  # Run after review
```

### What the Script Does NOT Do

- ❌ Requires sudo/root (runs as user)
- ❌ Modifies system files
- ❌ Installs system packages
- ❌ Sends data to external servers
- ❌ Downloads binaries from untrusted sources

### What the Script DOES

- ✅ Installs to `~/.koda` (user directory)
- ✅ Creates symlink in `~/.local/bin`
- ✅ Updates PATH in shell config
- ✅ Uses official npm packages (pnpm)
- ✅ All source code is visible in repo

---

## 🔄 Updating Koda

### Re-run Installation Script

The script detects existing installations and updates:

```bash
curl -fsSL https://url/install-remote.sh | bash
```

### Manual Update

```bash
cd ~/.koda/koda
git pull
pnpm install
pnpm build
```

---

## 🗑️ Uninstallation

### Using the Install Script

```bash
curl -fsSL https://url/install-remote.sh | bash -s uninstall
```

### Manual Uninstall

```bash
# Remove binary
rm -f ~/.local/bin/koda

# Remove installation directory
rm -rf ~/.koda/koda

# Remove PATH entry from shell config
# Edit ~/.zshrc or ~/.bashrc and remove the Koda PATH line
```

---

## 📍 Installation Locations

After installation:

```
~/.koda/koda/               # Main installation
~/.local/bin/koda           # Symlink to executable
~/.zshrc or ~/.bashrc       # PATH configuration
```

---

## ❓ Troubleshooting

### "curl: command not found"

**Install curl:**

```bash
# macOS
brew install curl

# Ubuntu/Debian
sudo apt-get install curl

# CentOS/RHEL
sudo yum install curl
```

### "Permission denied" Error

**Don't use sudo** - the script installs to user directories.

If you have permission issues:

```bash
# Ensure ~/.local/bin exists and is writable
mkdir -p ~/.local/bin
chmod u+w ~/.local/bin
```

### "koda: command not found" After Install

**Reload your shell config:**

```bash
# Bash
source ~/.bashrc

# Zsh
source ~/.zshrc

# Or restart terminal
```

**Check if PATH was updated:**

```bash
echo $PATH | grep ".local/bin"
```

### Installation Hangs

**Check your internet connection:**

```bash
curl -I https://github.com
```

**Increase timeout:**

```bash
curl -fsSL --max-time 300 https://url/install-remote.sh | bash
```

---

## 🌐 Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| macOS (Intel) | ✅ Supported | Requires Xcode CLI tools |
| macOS (Apple Silicon) | ✅ Supported | Native arm64 support |
| Linux (Ubuntu/Debian) | ✅ Supported | |
| Linux (CentOS/RHEL) | ✅ Supported | |
| Linux (Arch) | ✅ Supported | |
| Windows (WSL2) | ✅ Supported | Use WSL2 Ubuntu |
| Windows (Native) | ⚠️ Limited | Use WSL2 recommended |

---

## 🔗 Alternative Installation Methods

If curl installation doesn't work:

1. **Manual Installation:** See [INSTALL.md](./INSTALL.md)
2. **Local Script:** Run `./install.sh` from repo
3. **NPM (Future):** `npm install -g koda`
4. **Homebrew (Future):** `brew install koda`

---

## 📝 Publishing the Installation Script

### For Repository Owners

Once you publish to GitHub:

**1. Push the script:**
```bash
git add scripts/install-remote.sh
git commit -m "Add remote installation script"
git push origin main
```

**2. Create a short URL (optional):**
```bash
# Example with GitHub raw URL
https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh

# Or create a custom redirect
https://koda.dev/install.sh → redirects to GitHub raw URL
```

**3. Update documentation:**
- ✅ Repository is configured for `varunbiluri/koda`
- ✅ REPO_URL updated in install-remote.sh
- Test the installation

**4. Announce:**
```bash
# One-liner installation
curl -fsSL https://koda.dev/install.sh | bash
```

---

## 🎯 Quick Reference

```bash
# Install
curl -fsSL https://url/install.sh | bash

# Update
curl -fsSL https://url/install.sh | bash

# Uninstall
curl -fsSL https://url/install.sh | bash -s uninstall

# Verify
koda --version

# Get help
koda --help
```

---

**🚀 Ready to install? Run the one-liner above!**

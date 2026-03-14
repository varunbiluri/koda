#!/bin/bash
# Koda Remote Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/varunbiluri/koda/main/scripts/install-remote.sh | bash

set -e

# Configuration
REPO_URL="https://github.com/varunbiluri/koda"
INSTALL_DIR="$HOME/.koda"
BIN_DIR="$HOME/.local/bin"

# Detect install vs update
if [ -f "$INSTALL_DIR/koda/bin/koda.js" ]; then
    UPDATED=true
else
    UPDATED=false
fi

# Uninstall
if [ "$1" = "--uninstall" ] || [ "$1" = "uninstall" ]; then
    rm -f "$BIN_DIR/koda"
    rm -rf "$INSTALL_DIR/koda"
    echo "Koda uninstalled"
    exit 0
fi

# Check prerequisites
if ! command -v node &> /dev/null; then
    echo "Koda installation failed"
    echo "Node.js is not installed. Please install Node.js 18+ from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "Koda installation failed"
    echo "Node.js version $NODE_VERSION is too old. Please upgrade to Node.js 18+."
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo "Koda installation failed"
    echo "Git is not installed. Please install git first."
    exit 1
fi

# Install pnpm silently if missing
if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm --silent >/dev/null 2>&1 || { echo "Koda installation failed"; exit 1; }
fi

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$BIN_DIR"

# Clone or update
cd "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/koda" ]; then
    cd koda
    git pull >/dev/null 2>&1 || { echo "Koda installation failed"; exit 1; }
else
    git clone "$REPO_URL" koda >/dev/null 2>&1 || { echo "Koda installation failed"; exit 1; }
    cd koda
fi

# Install dependencies and build
pnpm install --silent >/dev/null 2>&1 || { echo "Koda installation failed"; exit 1; }
pnpm build >/dev/null 2>&1 || { echo "Koda installation failed"; exit 1; }

# Create symlink
ln -sf "$INSTALL_DIR/koda/bin/koda.js" "$BIN_DIR/koda"
chmod +x "$BIN_DIR/koda"
chmod +x "$INSTALL_DIR/koda/bin/koda.js"

# Setup PATH
SHELL_NAME=$(basename "$SHELL")
case "$SHELL_NAME" in
    bash) SHELL_RC="$HOME/.bashrc" ;;
    zsh)  SHELL_RC="$HOME/.zshrc" ;;
    fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
    *)    SHELL_RC="$HOME/.profile" ;;
esac

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    if [ "$SHELL_NAME" = "fish" ]; then
        echo "set -gx PATH $BIN_DIR \$PATH" >> "$SHELL_RC"
    else
        echo "" >> "$SHELL_RC"
        echo "# Koda CLI" >> "$SHELL_RC"
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
    fi
    export PATH="$BIN_DIR:$PATH"
fi

# Print result
VERSION=$(koda --version 2>/dev/null || echo "0.1.0")

if [ "$UPDATED" = true ]; then
    echo "Koda updated successfully"
else
    echo "Koda installed successfully"
fi

echo "Version: $VERSION"

#!/bin/bash
# Koda Installation Script
# Automates the installation process for Koda CLI

set -e  # Exit on error

echo "🚀 Installing Koda - AI Software Engineer"
echo "=========================================="
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version is too old. Please upgrade to 18+."
    echo "   Current: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v)"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo "⚠️  pnpm is not installed. Installing now..."
    npm install -g pnpm
fi

echo "✅ pnpm $(pnpm -v)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"
echo ""

# Build project
echo "🔨 Building project..."
pnpm build

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"
echo ""

# Link globally
echo "🔗 Installing Koda globally..."
pnpm link --global

if [ $? -ne 0 ]; then
    echo "⚠️  Global link failed. Trying with sudo..."
    sudo pnpm link --global
fi

echo "✅ Global installation complete"
echo ""

# Get pnpm global bin directory
PNPM_BIN=$(pnpm bin -g 2>/dev/null || echo "")

# Verify installation
echo "🧪 Verifying installation..."
if command -v koda &> /dev/null; then
    echo "✅ Koda installed successfully!"
    echo ""
    koda --version
    echo ""
    echo "🎉 Installation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Navigate to a project directory"
    echo "  2. Run: koda init"
    echo "  3. Run: koda ask \"your question\""
    echo ""
    echo "For help: koda --help"
else
    echo "⚠️  Warning: 'koda' command not found in PATH"
    echo ""
    echo "Add this to your ~/.zshrc or ~/.bashrc:"
    if [ -n "$PNPM_BIN" ]; then
        echo "  export PATH=\"$PNPM_BIN:\$PATH\""
    else
        echo "  export PATH=\"\$(pnpm bin -g):\$PATH\""
    fi
    echo ""
    echo "Then run: source ~/.zshrc  (or ~/.bashrc)"
    echo ""
    echo "Or install manually:"
    echo "  cd $(pwd)"
    echo "  pnpm link --global"
fi

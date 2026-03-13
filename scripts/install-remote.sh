#!/bin/bash
# Koda Remote Installation Script
# Usage: curl -fsSL https://koda.dev/install.sh | bash
# Or with wget: wget -qO- https://koda.dev/install.sh | bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/varunbiluri/koda"  # Update with actual repo
VERSION="latest"
INSTALL_DIR="$HOME/.koda"
BIN_DIR="$HOME/.local/bin"

# Print colored output
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_header() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                    KODA INSTALLATION                         ║"
    echo "║              AI Software Engineer for Your Terminal          ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)     OS=linux;;
        Darwin*)    OS=macos;;
        MINGW*)     OS=windows;;
        *)          OS=unknown;;
    esac
}

# Check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        echo "Please install Node.js 18+ from: https://nodejs.org/"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version $NODE_VERSION is too old"
        echo "Please upgrade to Node.js 18+"
        exit 1
    fi

    print_success "Node.js $(node -v)"

    # Check for pnpm, install if missing
    if ! command -v pnpm &> /dev/null; then
        print_warning "pnpm not found. Installing..."
        npm install -g pnpm
    fi

    print_success "pnpm $(pnpm -v)"
}

# Create directories
create_directories() {
    print_info "Creating installation directories..."
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$BIN_DIR"
    print_success "Directories created"
}

# Download and install
install_koda() {
    print_info "Downloading Koda..."

    cd "$INSTALL_DIR"

    # Clone or download the repository
    if command -v git &> /dev/null; then
        if [ -d "$INSTALL_DIR/koda" ]; then
            print_info "Updating existing installation..."
            cd koda
            git pull
        else
            git clone "$REPO_URL" koda
            cd koda
        fi
    else
        print_error "Git not found. Please install git first."
        exit 1
    fi

    print_success "Downloaded Koda"

    # Install dependencies
    print_info "Installing dependencies..."
    pnpm install
    print_success "Dependencies installed"

    # Build
    print_info "Building Koda..."
    pnpm build
    print_success "Build complete"

    # Create symlink
    print_info "Creating symlink..."
    ln -sf "$INSTALL_DIR/koda/bin/koda.js" "$BIN_DIR/koda"
    chmod +x "$BIN_DIR/koda"
    chmod +x "$INSTALL_DIR/koda/bin/koda.js"
    print_success "Symlink created"
}

# Setup PATH
setup_path() {
    print_info "Configuring PATH..."

    # Detect shell
    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
        bash)
            SHELL_RC="$HOME/.bashrc"
            ;;
        zsh)
            SHELL_RC="$HOME/.zshrc"
            ;;
        fish)
            SHELL_RC="$HOME/.config/fish/config.fish"
            ;;
        *)
            SHELL_RC="$HOME/.profile"
            ;;
    esac

    # Check if already in PATH
    if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
        print_info "Adding $BIN_DIR to PATH in $SHELL_RC"

        if [ "$SHELL_NAME" = "fish" ]; then
            echo "set -gx PATH $BIN_DIR \$PATH" >> "$SHELL_RC"
        else
            echo "" >> "$SHELL_RC"
            echo "# Koda CLI" >> "$SHELL_RC"
            echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_RC"
        fi

        export PATH="$BIN_DIR:$PATH"
        print_success "PATH updated"
        print_warning "Run 'source $SHELL_RC' or restart your terminal"
    else
        print_success "PATH already configured"
    fi
}

# Verify installation
verify_installation() {
    print_info "Verifying installation..."

    if command -v koda &> /dev/null; then
        VERSION=$(koda --version 2>/dev/null || echo "unknown")
        print_success "Koda installed successfully!"
        echo ""
        echo "  Version: $VERSION"
        echo "  Location: $BIN_DIR/koda"
        echo ""
        return 0
    else
        print_warning "Installation complete but 'koda' not found in PATH"
        echo ""
        echo "To use Koda, add this to your PATH:"
        echo "  export PATH=\"$BIN_DIR:\$PATH\""
        echo ""
        echo "Or run:"
        echo "  source $SHELL_RC"
        return 1
    fi
}

# Post-install instructions
show_next_steps() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                    INSTALLATION COMPLETE                     ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Next steps:"
    echo ""
    echo "  1. ${GREEN}Source your shell config:${NC}"
    echo "     source $SHELL_RC"
    echo ""
    echo "  2. ${GREEN}Initialize a project:${NC}"
    echo "     cd your-project"
    echo "     koda init"
    echo ""
    echo "  3. ${GREEN}Try your first query:${NC}"
    echo "     koda ask \"how does authentication work?\""
    echo ""
    echo "  4. ${GREEN}Run health check:${NC}"
    echo "     koda doctor"
    echo ""
    echo "For help: koda --help"
    echo "Documentation: https://github.com/varunbiluri/koda"
    echo ""
}

# Uninstall function
uninstall() {
    print_info "Uninstalling Koda..."

    rm -f "$BIN_DIR/koda"
    rm -rf "$INSTALL_DIR/koda"

    print_success "Koda uninstalled"
    print_info "You may want to remove the PATH entry from $SHELL_RC"
}

# Main installation flow
main() {
    # Check if uninstall flag
    if [ "$1" = "--uninstall" ] || [ "$1" = "uninstall" ]; then
        uninstall
        exit 0
    fi

    print_header

    detect_os
    print_info "Detected OS: $OS"

    check_prerequisites
    create_directories
    install_koda
    setup_path

    if verify_installation; then
        show_next_steps
    else
        echo ""
        print_warning "Please restart your terminal or run: source $SHELL_RC"
        show_next_steps
    fi
}

# Run main function
main "$@"

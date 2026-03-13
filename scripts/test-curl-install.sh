#!/bin/bash
# Test curl installation locally before publishing

echo "🧪 Testing Curl-Based Installation Locally"
echo "=========================================="
echo ""

# Check if http-server is available
if ! command -v http-server &> /dev/null; then
    echo "📦 Installing http-server..."
    npm install -g http-server
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "📂 Project directory: $PROJECT_DIR"
echo ""

# Start HTTP server in background
echo "🌐 Starting local HTTP server on port 8000..."
cd "$PROJECT_DIR"
http-server -p 8000 --silent &
SERVER_PID=$!

# Wait for server to start
sleep 2

echo "✅ Server started (PID: $SERVER_PID)"
echo ""

# Display the curl command
echo "📋 To test the installation, run this in another terminal:"
echo ""
echo "   curl -fsSL http://localhost:8000/scripts/install-remote.sh | bash"
echo ""
echo "Or download and inspect first:"
echo ""
echo "   curl -fsSL http://localhost:8000/scripts/install-remote.sh > /tmp/koda-install.sh"
echo "   cat /tmp/koda-install.sh"
echo "   bash /tmp/koda-install.sh"
echo ""

# Keep server running
echo "🔄 Server is running. Press Ctrl+C to stop."
echo ""

# Wait for interrupt
trap "echo ''; echo '🛑 Stopping server...'; kill $SERVER_PID 2>/dev/null; echo '✅ Server stopped'; exit 0" INT TERM

wait $SERVER_PID

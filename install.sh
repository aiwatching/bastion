#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${BASTION_INSTALL_DIR:-$HOME/.bastion/app}"
BIN_DIR="${BASTION_BIN_DIR:-/usr/local/bin}"
REPO_URL="${BASTION_REPO_URL:-https://github.com/your-org/bastion.git}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}==>${NC} $*"; }
error() { echo -e "${RED}==>${NC} $*" >&2; exit 1; }

# --- Pre-checks ---
command -v node >/dev/null 2>&1 || error "Node.js is required. Install it first: https://nodejs.org"
command -v npm  >/dev/null 2>&1 || error "npm is required. Install it with Node.js."

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js 18+ required (found v$(node -v))"
fi
if [ $(( NODE_MAJOR % 2 )) -ne 0 ]; then
  warn "Node.js v${NODE_MAJOR} is an odd-numbered (non-LTS) release."
  warn "Native modules like better-sqlite3 may lack prebuilt binaries."
  warn "Recommended: use Node.js 22 LTS from https://nodejs.org"
fi

info "Installing Bastion AI Gateway..."

# --- Download / Update ---
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only
elif [ -d "$INSTALL_DIR/package.json" ] || [ -f "$INSTALL_DIR/package.json" ]; then
  info "Using existing source at $INSTALL_DIR"
  cd "$INSTALL_DIR"
else
  # Check if running from the repo directory (piped from local file or curl)
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
  if [ -f "$SCRIPT_DIR/package.json" ] && grep -q "bastion-ai-gateway" "$SCRIPT_DIR/package.json" 2>/dev/null; then
    info "Installing from local source: $SCRIPT_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    cp -r "$SCRIPT_DIR" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  else
    info "Cloning repository..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
fi

# --- Install & Build ---
info "Installing dependencies..."
npm install 2>&1 | tail -1

info "Building..."
npm run build 2>&1 | tail -1

# --- Create wrapper script ---
WRAPPER="$INSTALL_DIR/bin/bastion"
mkdir -p "$INSTALL_DIR/bin"
cat > "$WRAPPER" << 'WRAPPER_EOF'
#!/usr/bin/env bash
BASTION_ROOT="$(dirname "$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")")")"
exec node "$BASTION_ROOT/dist/cli/index.js" "$@"
WRAPPER_EOF
chmod +x "$WRAPPER"

# --- Symlink to PATH ---
if [ -w "$BIN_DIR" ]; then
  ln -sf "$WRAPPER" "$BIN_DIR/bastion"
  info "Linked: $BIN_DIR/bastion"
else
  info "Linking to $BIN_DIR (requires sudo)..."
  sudo ln -sf "$WRAPPER" "$BIN_DIR/bastion"
  info "Linked: $BIN_DIR/bastion"
fi

# --- Verify ---
if command -v bastion >/dev/null 2>&1; then
  echo ""
  info "Bastion AI Gateway installed successfully!"
  echo ""
  echo "  Quick start:"
  echo "    bastion start          # Start the gateway"
  echo "    bastion wrap claude    # Run Claude Code through Bastion"
  echo "    bastion wrap <cmd>     # Run any tool through Bastion"
  echo ""
  echo "  Dashboard: http://127.0.0.1:8420/dashboard"
  echo ""
else
  warn "Installed but 'bastion' not found in PATH."
  warn "Add $BIN_DIR to your PATH or run directly: $WRAPPER"
fi

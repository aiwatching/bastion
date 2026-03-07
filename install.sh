#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${BASTION_INSTALL_DIR:-$HOME/.bastion/app}"
BIN_DIR="${BASTION_BIN_DIR:-/usr/local/bin}"
REPO_URL="${BASTION_REPO_URL:-https://github.com/aiwatching/bastion.git}"
LOCAL_SOURCE=""
REMOTE_BRANCH=""
INSTALL_PLUGINS=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -local|--local)
      if [[ -n "${2:-}" && "$2" != -* ]]; then
        LOCAL_SOURCE="$(cd "$2" && pwd)"
        shift 2
      else
        # Default: use the directory where install.sh lives
        LOCAL_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
        shift
      fi
      ;;
    -remote|--remote)
      if [[ -n "${2:-}" && "$2" != -* ]]; then
        REMOTE_BRANCH="$2"
        shift 2
      else
        echo "Error: -remote requires a branch name" >&2
        exit 1
      fi
      ;;
    -plugins|--plugins)
      if [[ -n "${2:-}" && "$2" != -* ]]; then
        INSTALL_PLUGINS="$(cd "$2" && pwd)"
        shift 2
      else
        # Default: look for bastion-plugin-api sibling directory
        SCRIPT_DIR_P="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
        PARENT_DIR="$(dirname "$SCRIPT_DIR_P")"
        if [ -d "$PARENT_DIR/bastion-plugin-api" ] && [ -f "$PARENT_DIR/bastion-plugin-api/package.json" ]; then
          INSTALL_PLUGINS="$PARENT_DIR/bastion-plugin-api"
        else
          echo "Error: cannot find bastion-plugin-api sibling directory. Specify path: --plugins <path>" >&2
          exit 1
        fi
        shift
      fi
      ;;
    -h|--help)
      echo "Usage: install.sh [options]"
      echo ""
      echo "Options:"
      echo "  -local [path]       Install from local source directory"
      echo "  -remote <branch>    Install from a specific git branch"
      echo "  -plugins [path]     Also install optional plugin pack (bastion-plugin-api)"
      echo "  -h, --help          Show this help message"
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}==>${NC} $*"; }
error() { echo -e "${RED}==>${NC} $*" >&2; exit 1; }

# --- Pre-checks ---

# macOS: ensure Xcode Command Line Tools are installed (provides git, clang, etc.)
if [ "$(uname)" = "Darwin" ]; then
  if ! xcode-select -p >/dev/null 2>&1; then
    info "Installing Xcode Command Line Tools (required for git)..."
    info "A system dialog may appear — click 'Install' and wait for it to finish."
    xcode-select --install 2>/dev/null || true
    # Wait for installation to complete
    until xcode-select -p >/dev/null 2>&1; do
      sleep 5
    done
    info "Xcode Command Line Tools installed."
  fi
fi

command -v git  >/dev/null 2>&1 || error "git is required. Install it first: https://git-scm.com"
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
if [ -n "$LOCAL_SOURCE" ]; then
  # -local mode: use local source directory directly
  if [ ! -f "$LOCAL_SOURCE/package.json" ]; then
    error "Not a valid Bastion source directory: $LOCAL_SOURCE (no package.json found)"
  fi
  if [ "$LOCAL_SOURCE" = "$INSTALL_DIR" ]; then
    info "Local source is already the install directory"
  else
    info "Installing from local source: $LOCAL_SOURCE"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    rm -rf "$INSTALL_DIR"
    rsync -a --exclude node_modules --exclude .git "$LOCAL_SOURCE/" "$INSTALL_DIR/"
  fi
  cd "$INSTALL_DIR"
elif [ -n "$REMOTE_BRANCH" ]; then
  # -remote mode: clone or fetch, then checkout specified branch
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Fetching and switching to branch: $REMOTE_BRANCH"
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$REMOTE_BRANCH" 2>/dev/null || git checkout -b "$REMOTE_BRANCH" "origin/$REMOTE_BRANCH"
    git reset --hard "origin/$REMOTE_BRANCH"
  else
    info "Cloning repository (branch: $REMOTE_BRANCH)..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    rm -rf "$INSTALL_DIR"
    git clone -b "$REMOTE_BRANCH" "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
elif [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation..."
  cd "$INSTALL_DIR"
  git fetch origin
  branch=$(git rev-parse --abbrev-ref HEAD)
  git reset --hard "origin/$branch"
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

# --- Install optional plugins ---
if [ -n "$INSTALL_PLUGINS" ]; then
  if [ ! -f "$INSTALL_PLUGINS/package.json" ]; then
    warn "Plugin directory not valid: $INSTALL_PLUGINS (no package.json)"
  else
    PLUGINS_DEST="$INSTALL_DIR/plugins"
    info "Installing optional plugins from: $INSTALL_PLUGINS"
    mkdir -p "$PLUGINS_DEST"
    rsync -a --exclude node_modules --exclude .git --exclude dist "$INSTALL_PLUGINS/" "$PLUGINS_DEST/"

    # Rewrite @aion0/bastion-plugin-api dependency to point to installed package
    cd "$PLUGINS_DEST"
    PLUGIN_API_REL="$(node -e "const p=require('path'); console.log(p.relative('$PLUGINS_DEST','$INSTALL_DIR/packages/bastion-plugin-api'))")"
    # Replace any version spec (semver or file: path) with the correct relative file: path
    node -e "
      const fs=require('fs');
      const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
      if(pkg.dependencies&&pkg.dependencies['@aion0/bastion-plugin-api']){
        pkg.dependencies['@aion0/bastion-plugin-api']='file:${PLUGIN_API_REL}';
        fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');
      }
    "
    info "Rewrote plugin-api path to: file:${PLUGIN_API_REL}"
    # Install plugin deps (including onnxruntime-node)
    npm install 2>&1 | tail -1
    npm run build 2>&1 | tail -1
    cd "$INSTALL_DIR"

    # Auto-configure external plugin in config.yaml
    USER_CONFIG="$HOME/.bastion/config.yaml"
    if [ -f "$USER_CONFIG" ]; then
      if ! grep -q '/plugins"' "$USER_CONFIG"; then
        info "Adding @aion0/bastion-plugin-api to config.yaml"
        # Replace "external: []" with the actual plugin entry (must stay inside plugins: block)
        if grep -q 'external: \[\]' "$USER_CONFIG"; then
          sed -i.bak 's|  external: \[\]|  external:\n    - package: "'"$PLUGINS_DEST"'"\n      enabled: true\n      config: {}|' "$USER_CONFIG"
          rm -f "${USER_CONFIG}.bak"
        else
          # No external key yet — insert before retention: line
          sed -i.bak '/^retention:/i\
  external:\
    - package: "'"$PLUGINS_DEST"'"\
      enabled: true\
      config: {}' "$USER_CONFIG"
          rm -f "${USER_CONFIG}.bak"
        fi
      else
        info "Plugin already configured in config.yaml"
      fi
    fi

    info "Optional plugins installed"
  fi
fi

# --- Config migration ---
USER_CONFIG="$HOME/.bastion/config.yaml"
if [ -f "$USER_CONFIG" ]; then
  # Migrate hardcoded branch (e.g. "v0.1.0") to "auto"
  if grep -qE 'branch:\s*v[0-9]+\.[0-9]+\.[0-9]+' "$USER_CONFIG"; then
    sed -i.bak -E 's/(branch:\s*)v[0-9]+\.[0-9]+\.[0-9]+/\1auto/' "$USER_CONFIG"
    rm -f "${USER_CONFIG}.bak"
    info "Migrated config: remotePatterns.branch → auto"
  fi
fi

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

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="${SCRIPT_DIR}/openclaw-src"
IMAGE_NAME="openclaw:local"
INSTANCES_DIR="${SCRIPT_DIR}/instances"
DEFAULT_PORT=18789

# ── helpers ──────────────────────────────────────────────────────────────────

usage() {
    cat <<EOF
Usage: $(basename "$0") <command> [options]

Commands:
  build    [--tag TAG]          Build Docker image from source
  create   <name> [--port PORT] Create instance and run interactive onboarding
  start    <name>               Start the gateway
  stop     <name>               Stop the gateway
  destroy  <name>               Remove instance containers (data dirs preserved)
  status                        List all instances
  logs     <name> [ARGS...]     Show gateway logs (extra args forwarded to docker compose logs)
  cli      <name> [ARGS...]     Run openclaw CLI inside the running gateway
  dashboard <name>              Print dashboard URL with token

Examples:
  $(basename "$0") build
  $(basename "$0") create work --port 18789
  $(basename "$0") start work
  $(basename "$0") status
  $(basename "$0") logs work -f
  $(basename "$0") cli work channels login
  $(basename "$0") dashboard work
  $(basename "$0") stop work
  $(basename "$0") destroy work
EOF
    exit 1
}

die() { echo "Error: $*" >&2; exit 1; }

generate_token() {
    if command -v openssl &>/dev/null; then
        openssl rand -hex 32
    else
        python3 -c "import secrets; print(secrets.token_hex(32))"
    fi
}

instance_dir() { echo "${INSTANCES_DIR}/$1"; }

# Run docker compose scoped to an instance
dc() {
    local name="$1"; shift
    local dir
    dir="$(instance_dir "${name}")"
    [[ -d "${dir}" ]] || die "Instance '${name}' does not exist. Run '$(basename "$0") create ${name}' first."
    docker compose \
        -f "${SCRIPT_DIR}/docker-compose.yml" \
        --env-file "${dir}/.env" \
        -p "openclaw-${name}" \
        "$@"
}

# Read a value from an instance's .env
env_val() {
    local name="$1" key="$2"
    grep "^${key}=" "$(instance_dir "${name}")/.env" | cut -d= -f2-
}

# Sync .env token with the token in openclaw.json (onboard may change it)
sync_token() {
    local name="$1"
    local config_dir
    config_dir="$(env_val "${name}" OPENCLAW_CONFIG_DIR)"
    local config_file="${config_dir}/openclaw.json"
    local env_file
    env_file="$(instance_dir "${name}")/.env"

    [[ -f "${config_file}" ]] || return 0

    local config_token
    config_token="$(python3 -c "
import json, sys
try:
    cfg = json.load(open('${config_file}'))
    print(cfg['gateway']['auth']['token'])
except (KeyError, json.JSONDecodeError):
    sys.exit(1)
" 2>/dev/null)" || return 0

    local env_token
    env_token="$(env_val "${name}" OPENCLAW_GATEWAY_TOKEN)"

    if [[ "${config_token}" != "${env_token}" ]]; then
        sed -i.bak "s/^OPENCLAW_GATEWAY_TOKEN=.*/OPENCLAW_GATEWAY_TOKEN=${config_token}/" "${env_file}"
        rm -f "${env_file}.bak"
        echo "    (synced .env token with onboard config)"
    fi
}

# Ensure gateway.bind=lan in config (required for Docker networking)
fix_bind() {
    local name="$1"
    local config_dir
    config_dir="$(env_val "${name}" OPENCLAW_CONFIG_DIR)"
    local config_file="${config_dir}/openclaw.json"

    [[ -f "${config_file}" ]] || return 0

    python3 -c "
import json
cfg = json.load(open('${config_file}'))
if cfg.get('gateway', {}).get('bind') != 'lan':
    cfg.setdefault('gateway', {})['bind'] = 'lan'
    json.dump(cfg, open('${config_file}', 'w'), indent=2)
    print('    (fixed gateway.bind to lan for Docker)')
" 2>/dev/null || true
}

# Approve all pending device pairing requests
approve_devices() {
    local name="$1"
    local config_dir
    config_dir="$(env_val "${name}" OPENCLAW_CONFIG_DIR)"
    local pending="${config_dir}/devices/pending.json"
    local paired="${config_dir}/devices/paired.json"

    [[ -f "${pending}" ]] || return 0

    python3 -c "
import json, time, os

with open('${pending}') as f:
    pend = json.load(f)
if not pend:
    exit(0)

paired = {}
if os.path.exists('${paired}'):
    with open('${paired}') as f:
        paired = json.load(f)

count = 0
for req_id, dev in pend.items():
    paired[dev['deviceId']] = {
        'deviceId': dev['deviceId'],
        'publicKey': dev['publicKey'],
        'platform': dev['platform'],
        'clientId': dev['clientId'],
        'clientMode': dev.get('clientMode', 'webchat'),
        'role': dev.get('role', 'operator'),
        'roles': dev.get('roles', ['operator']),
        'scopes': dev.get('scopes', []),
        'pairedAt': int(time.time() * 1000),
    }
    count += 1

with open('${paired}', 'w') as f:
    json.dump(paired, f, indent=2)
with open('${pending}', 'w') as f:
    json.dump({}, f)

print(f'    (auto-approved {count} pending device(s))')
" 2>/dev/null || true
}

# ── build ────────────────────────────────────────────────────────────────────

cmd_build() {
    local tag="main"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --tag) tag="$2"; shift 2 ;;
            *) die "Unknown option: $1" ;;
        esac
    done

    echo "==> Preparing source (branch/tag: ${tag})..."

    if [[ -d "${SRC_DIR}" ]]; then
        echo "    Source directory exists, fetching latest..."
        git -C "${SRC_DIR}" fetch --all --tags
        git -C "${SRC_DIR}" checkout "${tag}"
        git -C "${SRC_DIR}" pull --ff-only 2>/dev/null || true
    else
        echo "    Cloning openclaw repository..."
        git clone --branch "${tag}" https://github.com/openclaw/openclaw.git "${SRC_DIR}"
    fi

    echo "==> Building Docker image '${IMAGE_NAME}'..."
    docker build -t "${IMAGE_NAME}" -f "${SRC_DIR}/Dockerfile" "${SRC_DIR}"

    echo "==> Build complete: ${IMAGE_NAME}"
}

# ── create ───────────────────────────────────────────────────────────────────

cmd_create() {
    [[ $# -lt 1 ]] && die "Instance name required. Usage: $(basename "$0") create <name> [--port PORT]"
    local name="$1"; shift
    local port="${DEFAULT_PORT}"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --port) port="$2"; shift 2 ;;
            *) die "Unknown option: $1" ;;
        esac
    done

    local dir
    dir="$(instance_dir "${name}")"
    [[ -d "${dir}" ]] && die "Instance '${name}' already exists at ${dir}"
    [[ -f "${SRC_DIR}/docker-compose.yml" ]] || \
        die "Source not found. Run '$(basename "$0") build' first."

    local config_dir="${HOME}/.openclaw-${name}"
    local workspace_dir="${HOME}/openclaw-${name}/workspace"
    local bridge_port=$((port + 1))

    mkdir -p "${dir}" "${config_dir}" "${workspace_dir}" "${config_dir}/devices"

    # Generate token
    local token
    token="$(generate_token)"

    # Write .env (matches variables used in official docker-compose.yml)
    cat > "${dir}/.env" <<EOF
OPENCLAW_IMAGE=${IMAGE_NAME}
OPENCLAW_CONFIG_DIR=${config_dir}
OPENCLAW_WORKSPACE_DIR=${workspace_dir}
OPENCLAW_GATEWAY_TOKEN=${token}
OPENCLAW_GATEWAY_PORT=${port}
OPENCLAW_BRIDGE_PORT=${bridge_port}
OPENCLAW_GATEWAY_BIND=lan
CLAUDE_AI_SESSION_KEY=
CLAUDE_WEB_SESSION_KEY=
CLAUDE_WEB_COOKIE=
EOF

    echo "==> Instance '${name}' created (gateway: ${port}, bridge: ${bridge_port})"

    # Set gateway.mode=local so gateway can start before onboarding
    echo "==> Initializing gateway config..."
    dc "${name}" run --rm openclaw-cli config set gateway.mode local

    # Start gateway — onboard needs it running
    echo "==> Starting gateway..."
    dc "${name}" up -d openclaw-gateway
    sleep 3

    # Run onboarding inside gateway container (shares loopback with gateway process)
    echo ""
    echo "==> Running interactive onboarding..."
    echo "    When prompted for gateway token, use: ${token}"
    echo ""
    dc "${name}" exec openclaw-gateway node dist/index.js onboard --no-install-daemon

    # Post-onboard fixes: sync token, fix bind, approve devices
    echo ""
    echo "==> Applying post-onboard fixes..."
    sync_token "${name}"
    fix_bind "${name}"

    # Restart gateway to pick up synced config
    echo "==> Restarting gateway..."
    dc "${name}" restart openclaw-gateway
    sleep 3

    # Auto-approve any pending browser device pairing requests
    approve_devices "${name}"

    # Restart once more to load approved devices
    dc "${name}" restart openclaw-gateway
    sleep 2

    local final_token
    final_token="$(env_val "${name}" OPENCLAW_GATEWAY_TOKEN)"

    echo ""
    echo "==> Instance '${name}' is ready!"
    echo ""
    echo "    Dashboard: http://127.0.0.1:${port}/?token=${final_token}"
    echo ""
    echo "    Open the URL above in your browser."
    echo "    If prompted to pair, refresh the page — devices are auto-approved."
    echo ""
}

# ── start ────────────────────────────────────────────────────────────────────

cmd_start() {
    [[ $# -lt 1 ]] && die "Instance name required."
    local name="$1"

    # Ensure config consistency before starting
    sync_token "${name}"
    fix_bind "${name}"

    echo "==> Starting gateway for '${name}'..."
    dc "${name}" up -d openclaw-gateway
    sleep 3

    # Auto-approve any pending devices
    approve_devices "${name}"

    local port token
    port="$(env_val "${name}" OPENCLAW_GATEWAY_PORT)"
    token="$(env_val "${name}" OPENCLAW_GATEWAY_TOKEN)"

    echo "==> Gateway is running."
    echo ""
    echo "    Dashboard: http://127.0.0.1:${port}/?token=${token}"
    echo ""
}

# ── stop ─────────────────────────────────────────────────────────────────────

cmd_stop() {
    [[ $# -lt 1 ]] && die "Instance name required."
    echo "==> Stopping '${1}'..."
    dc "$1" down
    echo "==> Stopped."
}

# ── destroy ──────────────────────────────────────────────────────────────────

cmd_destroy() {
    [[ $# -lt 1 ]] && die "Instance name required."
    local name="$1"
    local dir
    dir="$(instance_dir "${name}")"

    echo "==> Destroying instance '${name}'..."
    dc "${name}" down -v 2>/dev/null || true
    rm -rf "${dir}"
    echo "==> Instance removed."
    echo "    Data directories preserved (delete manually if needed):"
    echo "      ${HOME}/.openclaw-${name}/"
    echo "      ${HOME}/openclaw-${name}/"
}

# ── logs ─────────────────────────────────────────────────────────────────────

cmd_logs() {
    [[ $# -lt 1 ]] && die "Instance name required."
    local name="$1"; shift
    dc "${name}" logs "$@" openclaw-gateway
}

# ── cli ──────────────────────────────────────────────────────────────────────

cmd_cli() {
    [[ $# -lt 1 ]] && die "Instance name required."
    local name="$1"; shift
    # exec into the running gateway container so CLI shares its network/loopback
    dc "${name}" exec openclaw-gateway node dist/index.js "$@"
}

# ── dashboard ────────────────────────────────────────────────────────────────

cmd_dashboard() {
    [[ $# -lt 1 ]] && die "Instance name required."
    local name="$1"
    local dir
    dir="$(instance_dir "${name}")"
    [[ -d "${dir}" ]] || die "Instance '${name}' does not exist."

    local port token
    port="$(env_val "${name}" OPENCLAW_GATEWAY_PORT)"
    token="$(env_val "${name}" OPENCLAW_GATEWAY_TOKEN)"
    echo "http://127.0.0.1:${port}/?token=${token}"
}

# ── status ───────────────────────────────────────────────────────────────────

cmd_status() {
    if [[ ! -d "${INSTANCES_DIR}" ]] || [[ -z "$(ls -A "${INSTANCES_DIR}" 2>/dev/null)" ]]; then
        echo "(no instances found)"
        return
    fi

    printf "%-15s %-12s %-8s %-8s %s\n" "INSTANCE" "STATUS" "GATEWAY" "BRIDGE" "DASHBOARD"
    printf "%-15s %-12s %-8s %-8s %s\n" "--------" "------" "-------" "------" "---------"

    for dir in "${INSTANCES_DIR}"/*/; do
        [[ -d "${dir}" ]] || continue
        local name port bridge_port token state dashboard
        name="$(basename "${dir}")"
        port="$(env_val "${name}" OPENCLAW_GATEWAY_PORT 2>/dev/null || echo "-")"
        bridge_port="$(env_val "${name}" OPENCLAW_BRIDGE_PORT 2>/dev/null || echo "-")"
        token="$(env_val "${name}" OPENCLAW_GATEWAY_TOKEN 2>/dev/null || echo "")"

        state="$(dc "${name}" ps --format '{{.State}}' openclaw-gateway 2>/dev/null || echo "stopped")"
        [[ -z "${state}" ]] && state="stopped"

        dashboard="-"
        if [[ -n "${port}" && "${port}" != "-" && -n "${token}" ]]; then
            dashboard="http://127.0.0.1:${port}/?token=${token}"
        fi

        printf "%-15s %-12s %-8s %-8s %s\n" "${name}" "${state}" "${port}" "${bridge_port}" "${dashboard}"
    done
}

# ── main ─────────────────────────────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

command="$1"; shift
case "${command}" in
    build)     cmd_build "$@" ;;
    create)    cmd_create "$@" ;;
    start)     cmd_start "$@" ;;
    stop)      cmd_stop "$@" ;;
    destroy)   cmd_destroy "$@" ;;
    logs)      cmd_logs "$@" ;;
    cli)       cmd_cli "$@" ;;
    dashboard) cmd_dashboard "$@" ;;
    status)    cmd_status "$@" ;;
    help|-h|--help) usage ;;
    *) die "Unknown command: ${command}. Run '$(basename "$0") help' for usage." ;;
esac

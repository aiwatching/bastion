# OpenClaw Docker + Bastion Integration

Route OpenClaw's LLM traffic through Bastion for DLP scanning, metrics, and audit — without modifying OpenClaw itself.

## How It Works

```
OpenClaw (Docker)
  → HTTPS_PROXY = host.docker.internal:8420
    → Bastion MITM decrypts claude.ai traffic
      → DLP scan (request + response)
      → Metrics & cost tracking
      → Audit logging
    → Forward to real claude.ai
```

Bastion intercepts `claude.ai` via HTTPS proxy. The container trusts Bastion's CA certificate through a read-only volume mount. Two session IDs (`openclaw-gw`, `openclaw-cli`) allow separate tracking in the Bastion dashboard.

## Prerequisites

- Bastion installed and working (`bastion start`)
- Docker and Docker Compose available

## Quick Start

The `openclaw.sh` script manages the full lifecycle: build, create, start, stop, and multi-instance support.

```bash
# 1. Build OpenClaw image from source
bastion openclaw build                    # Basic image
bastion openclaw build --brew             # + Homebrew for brew-based skills
bastion openclaw build --browser          # + Chromium for browser automation
bastion openclaw build --docker-cli       # + Docker CLI for sandbox
bastion openclaw build --brew --browser --docker-cli   # All optional components

# 2. Create and start an instance
bastion start
bastion openclaw docker up work --port 18789
```

You can also use `./openclaw.sh` directly for standalone usage (without the bastion CLI):

```bash
./openclaw.sh build --brew --browser
./openclaw.sh create work --port 18789
./openclaw.sh start work
```

### Existing OpenClaw Setup

If you already have a running OpenClaw instance with a `.env` file:

```bash
# 1. Stop existing OpenClaw containers
docker compose down

# 2. Start Bastion
bastion start

# 3. Restart with Bastion-integrated compose (point --env-file to your existing .env)
docker compose \
  -f /path/to/bastion/integration/openclaw-docker/docker-compose.yml \
  --env-file .env \
  up -d
```

Your data, config, and sessions are preserved — only environment variables and a CA cert volume are added.

### Script Commands

| Command | Description |
|---------|-------------|
| `build [--tag TAG] [--brew] [--browser]` | Clone OpenClaw repo and build Docker image. `--brew` adds Homebrew (~500MB), `--browser` adds Chromium (~300MB) |
| `create <name> [--port PORT]` | Create instance, generate .env, run onboarding |
| `start <name>` | Start gateway (auto-syncs config, approves devices) |
| `stop <name>` | Stop gateway |
| `destroy <name>` | Remove containers (data dirs preserved) |
| `status` | List all instances with status and dashboard URLs |
| `logs <name> [-f]` | Show gateway logs |
| `cli <name> [ARGS...]` | Run OpenClaw CLI inside the gateway container |
| `dashboard <name>` | Print dashboard URL with token |

## What Changed vs. Original Compose

Three environment variables and one volume added per service:

```yaml
# ── Bastion proxy ──
HTTPS_PROXY: "http://openclaw-gw@host.docker.internal:8420"
NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/bastion-ca.crt"
NO_PROXY: "localhost,127.0.0.1,host.docker.internal"
```

```yaml
volumes:
  - ~/.bastion/ca.crt:/etc/ssl/certs/bastion-ca.crt:ro
```

| Setting | Purpose |
|---------|---------|
| `HTTPS_PROXY` | Routes all HTTPS traffic through Bastion. `openclaw-gw@` is the session ID for dashboard tracking |
| `NODE_EXTRA_CA_CERTS` | Node.js trusts Bastion's CA cert (required for MITM decryption) |
| `NO_PROXY` | Excludes local addresses from proxying |
| CA cert volume | Mounts host's `~/.bastion/ca.crt` into container (read-only) |

## Bastion Configuration

Bastion must bind to `0.0.0.0` (not `127.0.0.1`) for Docker containers to reach it:

```yaml
# ~/.bastion/config.yaml
server:
  host: "0.0.0.0"
```

Or via environment variable:

```bash
BASTION_HOST=0.0.0.0 bastion start
```

## Verification

1. Start Bastion and OpenClaw
2. Open Bastion dashboard: `http://127.0.0.1:8420/dashboard`
3. Send a message through OpenClaw
4. Check the **Overview** tab for `claude-web` provider requests
5. Check the **DLP** tab for any findings — click a request ID to see full detail

## Troubleshooting

**Port already allocated**
```
Bind for 0.0.0.0:18789 failed: port is already allocated
```
Stop the old container first: `docker ps | grep 18789` then `docker stop <id>`

**`.env` variables not set**
```
The "OPENCLAW_CONFIG_DIR" variable is not set
```
Use `--env-file` to point to your `.env`: `docker compose -f docker-compose.yml --env-file /path/to/.env up -d`

**Container can't reach Bastion**
Ensure Bastion is bound to `0.0.0.0`, not `127.0.0.1`. On macOS Docker Desktop, `host.docker.internal` resolves to the host. On Linux, use `--add-host=host.docker.internal:host-gateway` or `network_mode: host`.

**TLS/certificate errors**
Verify `~/.bastion/ca.crt` exists: `ls -la ~/.bastion/ca.crt`. If missing, run `bastion start` once to generate it.

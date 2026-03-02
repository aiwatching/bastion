**English** | [中文](openclaw-docker.zh.md)

# OpenClaw Docker Compose Integration

Run OpenClaw via Docker Compose with all AI traffic automatically routed through the Bastion proxy.

---

## Prerequisites

- Bastion is installed (the `bastion` command is available)
- Docker Desktop is installed and running
- The OpenClaw Docker image is ready

```bash
# Verify Bastion is available
bastion --version

# Verify Docker is available
docker info
```

---

## Scenario 1: Fresh Install

Create an OpenClaw Docker instance from scratch. Bastion handles all configuration automatically.

### 1. Start Bastion

```bash
bastion start
bastion health   # Confirm it's running
```

### 2. Prepare the Docker Image

```bash
# Option A: Build from source (recommended)
bastion openclaw build                    # Basic image
bastion openclaw build --brew             # + Homebrew for brew-based skills (1password-cli, signal-cli, etc.)
bastion openclaw build --browser          # + Chromium for browser automation
bastion openclaw build --brew --browser   # All optional components

# Specify a git tag/branch or custom image name
bastion openclaw build --tag v2.0 --image openclaw:v2.0

# Use existing local source instead of cloning
bastion openclaw build --src ~/my-openclaw-fork

# Option B: Use an existing image
docker images | grep openclaw
```

### 3. Create and Start an Instance

```bash
bastion openclaw docker up mywork \
  --port 18789 \
  --image openclaw:local \
  --config-dir ~/openclaw-data/mywork/config \
  --workspace ~/openclaw-data/mywork/workspace
```

Parameter reference:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<name>` | Instance name, used to distinguish multiple instances | Required |
| `--port` | Gateway port (bridge port is automatically +1) | 18789 |
| `--image` | Docker image name | openclaw:local |
| `--config-dir` | OpenClaw config directory (openclaw.json, devices/) | `~/.openclaw-<name>` |
| `--workspace` | OpenClaw workspace directory | `~/openclaw-<name>/workspace` |

### 4. Interactive Onboarding

After running the command, an interactive setup flow begins:

1. A random token is printed on screen -- **copy it**
2. Enter the token when prompted to complete gateway authentication
3. Once done, Bastion automatically performs post-onboard fixes:
   - Syncs the token (onboarding may have changed it)
   - Sets `gateway.bind=lan` (required for Docker networking)
   - Auto-approves all pending device pairings
   - Restarts the gateway to load the configuration

### 5. Access the Dashboard

After onboarding completes, a Dashboard URL is printed:

```
http://127.0.0.1:18789/?token=<your-token>
```

Open it in your browser. If prompted for pairing, simply refresh the page (devices have already been auto-approved).

### 6. Multiple Instances

Run multiple instances by using different ports:

```bash
# Second instance
bastion openclaw docker up dev2 \
  --port 18800 \
  --image openclaw:local \
  --config-dir ~/openclaw-data/dev2/config \
  --workspace ~/openclaw-data/dev2/workspace

# Third instance
bastion openclaw docker up staging \
  --port 18810 \
  --image openclaw:v2.0 \
  --config-dir ~/openclaw-data/staging/config \
  --workspace ~/openclaw-data/staging/workspace
```

View all instances:

```bash
bastion openclaw docker status
```

Output:

```
INSTANCE   STATUS   GATEWAY  BRIDGE  DASHBOARD
mywork     running  18789    18790   http://127.0.0.1:18789/?token=abc...
dev2       running  18800    18801   http://127.0.0.1:18800/?token=def...
staging    stopped  18810    18811   http://127.0.0.1:18810/?token=ghi...
```

---

## Scenario 2: Existing Docker Compose Setup

You already have a running OpenClaw Docker Compose environment and just need to route traffic through Bastion.

### Option A: Modify docker-compose.yml (Recommended)

Add three Bastion proxy environment variables and mount the CA certificate in the `environment` section of your `docker-compose.yml`:

```yaml
services:
  openclaw-gateway:
    image: openclaw:local
    environment:
      # ... your existing config ...
      # ── Add the following Bastion proxy config ──
      HTTPS_PROXY: "http://openclaw-gw@host.docker.internal:${BASTION_PORT:-8420}"
      NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/bastion-ca.crt"
      NO_PROXY: "localhost,127.0.0.1,host.docker.internal"
    volumes:
      # ... your existing volumes ...
      # ── Add CA certificate mount ──
      - ~/.bastion/ca.crt:/etc/ssl/certs/bastion-ca.crt:ro
```

If your Bastion port is not 8420, add the following to your `.env` file:

```env
BASTION_PORT=9000
```

Then restart:

```bash
docker compose down
docker compose up -d
```

### Option B: Launch Directly with the bastion Command

If you already have a `docker-compose.yml` and `.env` file, you can launch directly with Bastion, which will automatically inject the `BASTION_PORT` environment variable:

```bash
bastion openclaw docker run \
  --compose /path/to/your/docker-compose.yml \
  --env-file /path/to/your/.env \
  -p my-openclaw
```

Parameter reference:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--compose` | Path to docker-compose.yml | Auto-searches current directory |
| `--env-file` | Path to .env file | None |
| `-p` | Docker Compose project name | openclaw |

### Option C: Via Docker Desktop UI

1. Ensure your `docker-compose.yml` already includes the Bastion proxy configuration (see Option A)
2. Start it directly from the Docker Desktop UI
3. Bastion just needs to be running (`bastion start`)

---

## Daily Management

```bash
# View all Docker instances
bastion openclaw docker status

# Start (idempotent -- existing instances are brought up without re-onboarding)
bastion openclaw docker up mywork

# Stop
bastion openclaw docker stop mywork

# View logs
bastion openclaw docker logs mywork
bastion openclaw docker logs mywork -f   # Follow in real time

# Inject proxy into any running container
bastion openclaw docker attach <container-name>
bastion openclaw docker attach <container-name> --restart   # Rebuild container with env vars baked in
```

---

## Configuration Management

The OpenClaw config file is located at `/home/node/.openclaw/openclaw.json` inside the container, mapped to the host's `--config-dir` directory via a volume mount.

### Method 1: Via bastion exec (requires gateway running + device paired)

```bash
# Read configuration
bastion openclaw docker exec mywork config get gateway
bastion openclaw docker exec mywork config get channels.telegram

# Modify configuration
bastion openclaw docker exec mywork config set gateway.mode local
bastion openclaw docker exec mywork config set channels.telegram.botToken "123456:AAH..."
```

### Method 2: Edit Host Files Directly (Recommended)

When the gateway is not running, devices are not paired, or onboarding failed, you can operate on config files directly on the host:

```bash
# View full configuration
cat ~/openclaw-data/mywork/config/openclaw.json | python3 -m json.tool

# View a specific config section (e.g., Telegram)
python3 -c "
import json
cfg = json.load(open('$HOME/openclaw-data/mywork/config/openclaw.json'))
print(json.dumps(cfg.get('channels', {}).get('telegram', {}), indent=2))
"

# Modify configuration (e.g., update Telegram bot token)
python3 -c "
import json
path = '$HOME/openclaw-data/mywork/config/openclaw.json'
cfg = json.load(open(path))
cfg.setdefault('channels', {}).setdefault('telegram', {})['botToken'] = '123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'
json.dump(cfg, open(path, 'w'), indent=2)
print('Updated.')
"
```

Restart the gateway for changes to take effect:

```bash
bastion openclaw docker stop mywork
bastion openclaw docker up mywork
```

### Device Pairing

If you encounter a `pairing required` error (onboarding incomplete or device not approved), you can manipulate device files directly:

```bash
# View pending devices
cat ~/openclaw-data/mywork/config/devices/pending.json | python3 -m json.tool

# Manually approve all pending devices
python3 -c "
import json, os, time

config_dir = os.path.expanduser('~/openclaw-data/mywork/config')
pending_path = os.path.join(config_dir, 'devices', 'pending.json')
paired_path = os.path.join(config_dir, 'devices', 'paired.json')

pending = json.load(open(pending_path))
if not pending:
    print('No pending devices.')
    exit()

paired = json.load(open(paired_path)) if os.path.exists(paired_path) else {}

for req_id, dev in pending.items():
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

json.dump(paired, open(paired_path, 'w'), indent=2)
json.dump({}, open(pending_path, 'w'))
print(f'Approved {len(pending)} device(s).')
"
```

Restart after approving:

```bash
bastion openclaw docker stop mywork
bastion openclaw docker up mywork
```

### Rebuilding an Instance

If onboarding went wrong and you need to start over completely:

```bash
# 1. Destroy the instance (container + bastion config)
bastion openclaw docker destroy mywork

# 2. Clean up data directory (optional)
rm -rf ~/openclaw-data/mywork

# 3. Recreate
bastion openclaw docker up mywork \
  --port 18789 \
  --image openclaw:local \
  --config-dir ~/openclaw-data/mywork/config \
  --workspace ~/openclaw-data/mywork/workspace
```

---

## Generated Directory Structure

```
~/.bastion/openclaw/docker/
  └── <name>/
      ├── .env                    # Environment variables (token, port, image, BASTION_PORT, etc.)
      └── docker-compose.yml      # Generated Compose file

~/openclaw-data/<name>/           # Or whatever you specified via --config-dir / --workspace
  ├── config/
  │   ├── openclaw.json           # OpenClaw gateway config (written during onboarding)
  │   └── devices/
  │       ├── pending.json        # Pending device approvals
  │       └── paired.json         # Paired devices
  └── workspace/                  # OpenClaw workspace
```

---

## How Bastion Proxying Works

OpenClaw inside the Docker container connects to Bastion as follows:

```
OpenClaw (inside container)
    │
    │  HTTPS_PROXY=http://host.docker.internal:<bastion-port>
    │
    ▼
Bastion (on host)
    │
    │  DLP scan → Metrics collection → Audit logging → Cache
    │
    ▼
LLM Provider (api.anthropic.com / api.openai.com / ...)
```

- `host.docker.internal` -- A Docker-provided hostname that resolves to the host machine, allowing the container to reach Bastion running on the host
- CA certificate mount -- The container trusts Bastion's MITM certificate via `NODE_EXTRA_CA_CERTS`
- `NO_PROXY` -- Excludes localhost and Docker internal addresses to prevent routing loops

---

## Troubleshooting

### Container Cannot Connect to Bastion

```bash
# 1. Confirm Bastion is running
bastion health

# 2. Confirm the port
bastion proxy status

# 3. Test connectivity from inside the container
docker exec <container> curl -v http://host.docker.internal:8420/api/stats
```

### Onboarding Failed

When onboarding fails midway, core configuration (model, channels) is usually already saved to `openclaw.json`. You can simply restart:

```bash
bastion openclaw docker stop <name>
bastion openclaw docker up <name>
```

If you need to start over completely, use `destroy` and clean up the data directory:

```bash
bastion openclaw docker destroy <name>
rm -rf ~/openclaw-data/<name>
bastion openclaw docker up <name> --port ... --image ... --config-dir ... --workspace ...
```

> **Note:** `bastion openclaw docker up <name>` for an existing instance only runs `docker compose up -d` -- it does not re-onboard. You must `destroy` first to rebuild.

### pairing required

If the `exec` command or browser access reports `pairing required`, it means devices have not been approved. See the "Configuration Management > Device Pairing" section above to approve them manually.

### Telegram Bot 404

A `404: Not Found` from the Telegram API usually means the bot token is invalid or incomplete. The Telegram token format is `123456789:AAH...` (number + colon + hash). See "Configuration Management > Method 2" to edit the token directly on the host.

### CA Certificate Does Not Exist

```bash
# Bastion auto-generates the CA certificate on first start
bastion start
ls ~/.bastion/ca.crt
```

---

## DLP Alert Notifications

Bastion can detect sensitive data (API keys, credentials, PII) in AI traffic and OpenClaw can notify you in real time through its messaging channels (Telegram, Discord, Slack, etc.).

### How It Works

```
OpenClaw (container)                    Bastion (host)
    │                                      │
    │  GET /api/dlp/recent?since=...  ────►│
    │  ◄──── new DLP findings              │
    │                                      │
    ├─→ Telegram alert                     │
    ├─→ Discord alert                      │
    └─→ Slack alert                        │
```

OpenClaw polls Bastion's DLP API every 60 seconds via a skill/prompt. When new findings are detected, it formats an alert and sends it through configured channels.

### API Endpoint

```
GET http://host.docker.internal:<bastion-port>/api/dlp/recent?since=<iso-timestamp>&limit=100
```

| Parameter | Description |
|-----------|-------------|
| `since` | ISO 8601 timestamp — only return findings after this time |
| `limit` | Max results (default: 50) |

The response includes `pattern_name`, `action` (block/redact/warn), `direction`, `provider`, `model`, `session_id`, `session_label`, and `original_snippet` for each finding.

### Quick Test

```bash
# From inside the OpenClaw container
curl http://host.docker.internal:8420/api/dlp/recent?limit=3

# From the host
curl http://127.0.0.1:8420/api/dlp/recent?limit=3
```

### Setup

Feed the integration prompt [`docs/openclaw-integration.md`](openclaw-integration.md) into an OpenClaw chat session. It will automatically create the DLP alert skill, add a cron job (polls every minute), and set up cursor persistence.

See [OpenClaw DLP Alert Integration](openclaw-dlp-skill.md) for full details, customization options, and alert message format.

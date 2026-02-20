**English** | [中文](openclaw-local.zh.md)

# OpenClaw Local Installation

Run the OpenClaw process directly on your local machine (without Docker), proxying all AI traffic through Bastion.

---

## Prerequisites

- Bastion is installed (the `bastion` command is available)
- OpenClaw is installed locally (the `openclaw` command is available, or you know the binary path)
- Node.js 18+

```bash
# Verify Bastion
bastion --version

# Verify OpenClaw
which openclaw
# or
~/.openclaw/bin/openclaw --version
```

---

## Quick Start

### 1. Start Bastion

```bash
bastion start
bastion health
```

### 2. Start OpenClaw (daemon mode)

```bash
bastion openclaw local start mywork \
  --port 18789 \
  --config-dir ~/openclaw-data/mywork/config \
  --workspace ~/openclaw-data/mywork/workspace
```

Output:

```
Starting OpenClaw 'mywork' on port 18789 (daemon)...
  PID:       12345
  Binary:    /usr/local/bin/openclaw
  Port:      18789
  Config:    /Users/you/openclaw-data/mywork/config
  Workspace: /Users/you/openclaw-data/mywork/workspace
  Proxy:     127.0.0.1:8420
  Log:       /Users/you/.bastion/openclaw/local/mywork.log

Dashboard: http://127.0.0.1:18789/
```

### 3. Foreground mode (for debugging)

```bash
bastion openclaw local start mywork \
  --port 18789 \
  --foreground
```

Logs are printed directly to the terminal. Press Ctrl+C to stop.

---

## Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `<name>` | Instance name | Required |
| `--port` | Gateway port | 18789 |
| `--bin` | OpenClaw binary path | Auto-searches PATH / `~/.openclaw/bin/` |
| `--config-dir` | Configuration directory | `~/.openclaw-<name>` |
| `--workspace` | Workspace directory | `~/openclaw-<name>/workspace` |
| `--foreground` | Run in foreground (no daemon) | Daemon by default |

---

## Day-to-Day Management

```bash
# List all local instances
bastion openclaw local status

# Stop an instance
bastion openclaw local stop mywork

# View logs
bastion openclaw local logs mywork
bastion openclaw local logs mywork -f   # follow in real time
```

### Example status output

```bash
bastion openclaw local status
```

```
INSTANCE   STATUS   PORT   PID    DASHBOARD
mywork     running  18789  12345  http://127.0.0.1:18789/
dev2       stopped  18800  -      http://127.0.0.1:18800/
```

---

## Multiple Instances

```bash
bastion openclaw local start dev1 --port 18789
bastion openclaw local start dev2 --port 18800
bastion openclaw local start dev3 --port 18810 --bin ~/custom/openclaw

bastion openclaw local status
```

---

## How the Proxy Works

In local mode, Bastion injects the proxy via environment variables:

```
OpenClaw (local process)
    │
    │  HTTPS_PROXY=http://openclaw-local-mywork@127.0.0.1:8420
    │  NODE_EXTRA_CA_CERTS=~/.bastion/ca.crt
    │  NO_PROXY=127.0.0.1,localhost
    │
    ▼
Bastion (local process)
    │
    │  DLP scan → Metrics collection → Audit log → Cache
    │
    ▼
LLM Provider (api.anthropic.com / api.openai.com / ...)
```

Bastion automatically:
1. Reads the currently configured host and port
2. Injects `HTTPS_PROXY` (including the instance name as a session identifier)
3. Injects `NODE_EXTRA_CA_CERTS` pointing to the Bastion CA certificate
4. Launches `openclaw gateway --port <port> --bind localhost` in daemon or foreground mode

---

## Data Directory

```
~/.bastion/openclaw/local/
  ├── mywork.pid          # PID file (exists while running)
  ├── mywork.json         # Metadata (port, paths, start time)
  └── mywork.log          # Log file (daemon mode)

~/openclaw-data/mywork/   # or your custom path
  ├── config/             # OpenClaw configuration
  └── workspace/          # Workspace
```

---

## Docker vs Local Comparison

| | Docker | Local |
|---|---|---|
| Isolation | Fully isolated, no impact on host | Shares host environment |
| Installation | Only needs a Docker image | Requires installing the OpenClaw binary |
| Networking | Connects via `host.docker.internal` | Direct `127.0.0.1` |
| Multiple instances | Each instance is a separate container | Each instance is a separate process |
| Performance | Docker overhead | Native performance |
| Best for | Production, consistent team environments | Development, debugging, rapid iteration |
| Bastion command | `bastion openclaw docker ...` | `bastion openclaw local ...` |

---

## Troubleshooting

### OpenClaw binary not found

```bash
# Check PATH
which openclaw

# Specify the path manually
bastion openclaw local start mywork --bin /path/to/openclaw

# Common install locations
ls ~/.openclaw/bin/openclaw
ls /usr/local/bin/openclaw
```

### Port conflict

```bash
# Check what is using the port
lsof -i :18789

# Use a different port
bastion openclaw local start mywork --port 19000
```

### Process exited but PID file remains

```bash
# status automatically cleans up stale PIDs
bastion openclaw local status

# Or remove manually
rm ~/.bastion/openclaw/local/mywork.pid
```

# Bastion AI Gateway

Local-first proxy for LLM providers (Anthropic, OpenAI, Gemini). Provides DLP scanning, usage metrics, cost tracking, and response caching — all running on your machine.

## Install

One-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/your-org/bastion/main/install.sh | bash
```

Or from local source:

```bash
cd bastion && bash install.sh
```

Requires Node.js 18+. Installs to `~/.bastion/app/`, links `bastion` command to `/usr/local/bin/`.

## Quick Start

```bash
# Start the gateway
bastion start

# Option A: Wrap a single command (proxy scoped to that process only)
bastion wrap claude
bastion wrap python my_app.py

# Option B: Global proxy (all terminals, all new processes, GUI apps)
eval $(bastion proxy on)
```

## Usage

### `bastion start`

Start the gateway (daemon mode by default).

```bash
bastion start              # Background daemon
bastion start --foreground # Foreground (see logs in real-time)
bastion start -p 9000      # Custom port
```

### `bastion stop`

```bash
bastion stop
```

### `bastion proxy on/off/status`

Global proxy mode — routes **all** AI traffic through Bastion, including background processes and GUI apps.

```bash
eval $(bastion proxy on)       # Enable: shell profile + macOS system proxy + current shell
eval $(bastion proxy off)      # Disable: undo everything
bastion proxy status           # Check current proxy state
```

What `bastion proxy on` does:
1. Writes proxy exports to shell profile (`~/.zshrc`) — new terminals auto-inherit
2. Sets macOS system HTTPS proxy — GUI apps also route through Bastion
3. Outputs `export` commands to stdout — current shell takes effect immediately via `eval`

Environment variables set:

| Variable | Purpose |
|----------|---------|
| `HTTPS_PROXY` | Standard proxy (curl, Python, Go, etc.) |
| `NO_PROXY` | Excludes OAuth/auth domains |
| `NODE_EXTRA_CA_CERTS` | Node.js tools trust Bastion CA cert |
| `ANTHROPIC_BASE_URL` | Anthropic SDK direct connection |
| `OPENAI_BASE_URL` | OpenAI SDK direct connection |
| `GOOGLE_AI_BASE_URL` | Google AI SDK direct connection |

Options:
- `--no-system` — Skip setting macOS system proxy
- `--trust-ca` — Add CA cert to macOS system keychain (requires sudo)

> **Note:** `bastion stop` automatically removes the macOS system proxy if it points to Bastion, preventing network disruption.

### `bastion wrap <command>`

Run a single command with AI traffic routed through Bastion. Proxy settings are scoped to that process only.

```bash
bastion wrap claude
bastion wrap python app.py
bastion wrap node server.js
```

Options:
- `--base-url` — Use `ANTHROPIC_BASE_URL` mode instead of `HTTPS_PROXY` (simpler but breaks OAuth)
- `--label <name>` — Human-readable session label for dashboard tracking

### `bastion env`

Print shell exports for manual proxy setup.

```bash
eval $(bastion env)          # Set proxy vars in current shell
eval $(bastion env --unset)  # Remove all proxy vars
```

### `bastion stats`

View usage statistics (requests, cost, tokens, latency).

```bash
bastion stats
```

### `bastion health`

Check if the gateway is running.

```bash
bastion health
```

### `bastion trust-ca`

Display CA certificate info for manual trust configuration.

```bash
bastion trust-ca
```

## Dashboard

Open `http://127.0.0.1:8420/dashboard` in a browser while the gateway is running.

5 tabs: **Overview** (metrics, per-session/per-key stats), **DLP** (findings with before/after snippets), **Optimizer** (cache hit rate, tokens saved), **Audit** (request/response content viewer), **Settings** (toggle plugins at runtime without restart).

## How It Works

Bastion operates as an HTTPS proxy with selective MITM (Man-in-the-Middle) interception:

- **API domains** (`api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com`) — Traffic is decrypted, processed through the plugin pipeline (DLP, metrics, caching), then forwarded to the real upstream.
- **All other domains** — Plain TCP tunnel, no inspection. OAuth flows, browser traffic, etc. pass through unmodified.

A local CA certificate (`~/.bastion/ca.crt`) is generated automatically. Node.js tools trust it via `NODE_EXTRA_CA_CERTS`.

## Plugins

### Metrics Collector
Records every API request: provider, model, tokens, cost, latency. Data stored in SQLite (`~/.bastion/bastion.db`).

### DLP Scanner
Scans outgoing requests for sensitive data (AWS keys, GitHub tokens, credit cards, SSNs, etc.).

Configure in `~/.bastion/config.yaml`:
```yaml
plugins:
  dlp:
    action: "warn"    # pass | warn | redact | block
    patterns:
      - "high-confidence"
      - "validated"
```

### Token Optimizer
- **Response cache** — Exact-match cache for identical requests (AES-256-GCM encrypted)
- **Whitespace trimming** — Collapses excessive whitespace to save tokens

### Audit Logger
Stores request/response content (encrypted at rest) for review in the dashboard. Configurable retention period with automatic purge.

## Configuration

Default config: `config/default.yaml`. Override by creating `~/.bastion/config.yaml`:

```yaml
server:
  host: "127.0.0.1"
  port: 8420

logging:
  level: "info"       # debug | info | warn | error

plugins:
  metrics:
    enabled: true
  dlp:
    enabled: true
    action: "block"    # block sensitive data instead of just warning
    patterns:
      - "high-confidence"
      - "validated"
      - "context-aware"
  optimizer:
    enabled: true
    cache: true
    trimWhitespace: true
  audit:
    enabled: true
    retentionHours: 168  # 7 days

timeouts:
  upstream: 120000     # 2 minutes
  plugin: 50           # 50ms per plugin
```

Environment variable overrides:
```bash
BASTION_PORT=9000 bastion start
BASTION_HOST=0.0.0.0 bastion start
BASTION_LOG_LEVEL=debug bastion start
```

## Data Storage

All data stored locally in `~/.bastion/`:

```
~/.bastion/
  bastion.db    # SQLite database (metrics, cache, DLP events, audit log)
  config.yaml   # User config overrides (created by bastion proxy on / dashboard settings)
  ca.key        # CA private key
  ca.crt        # CA certificate
  certs/        # Generated host certificates
  .key          # AES encryption key for cache & audit
  bastion.pid   # Daemon PID file
  bastion.log   # Daemon log file
```

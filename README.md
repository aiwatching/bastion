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

# Run Claude Code through Bastion
bastion wrap claude

# Run any other tool through Bastion
bastion wrap ~/.accord/accord-hub.sh --hub-dir accord_hub
bastion wrap python my_app.py
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

### `bastion wrap <command>`

Run any command with AI traffic routed through Bastion. Sets `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS` automatically.

```bash
bastion wrap claude
bastion wrap python app.py
bastion wrap node server.js
bastion wrap ~/.accord/accord-hub.sh --hub-dir accord_hub
```

Options:
- `--base-url` — Use `ANTHROPIC_BASE_URL` mode instead of `HTTPS_PROXY` (simpler but breaks OAuth)

### `bastion env`

Print shell exports for manual proxy setup. Use when `bastion wrap` is not suitable.

```bash
eval $(bastion env)          # Set proxy vars in current shell
eval $(bastion env --unset)  # Remove all proxy vars
```

Options:
- `--base-url` — Output `ANTHROPIC_BASE_URL`/`OPENAI_BASE_URL`/`GOOGLE_AI_BASE_URL` instead
- `--fish` — Fish shell syntax
- `--powershell` — PowerShell syntax

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

Open `http://127.0.0.1:8420/dashboard` in a browser while the gateway is running. Auto-refreshes every 3 seconds.

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
  bastion.db    # SQLite database (metrics, cache, DLP events)
  ca.key        # CA private key
  ca.crt        # CA certificate
  certs/        # Generated host certificates
  .key          # AES encryption key for cache
  bastion.pid   # Daemon PID file
  bastion.log   # Daemon log file
```

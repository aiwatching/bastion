**English** | [中文](agent-monitoring.zh.md)

# AI Agent Monitoring

Monitor any locally running AI agent (Claude Code, Cursor, Aider, custom Python/Node apps, etc.) through Bastion proxy, enabling DLP scanning, usage statistics, cost tracking, and audit logging.

---

## How It Works

Bastion acts as an HTTPS proxy, intercepting all traffic destined for AI providers:

```
AI Agent (any process)
    │
    │  HTTPS_PROXY → Bastion
    │
    ▼
Bastion Gateway (127.0.0.1:8420)
    │
    ├─ DLP scanning (sensitive data detection)
    ├─ Metrics collection (token usage, cost)
    ├─ Audit logging (request/response recording)
    ├─ Response caching (optional)
    │
    ▼
LLM Provider (Anthropic / OpenAI / Gemini / ...)
```

---

## Three Ways to Connect

### Option 1: `bastion wrap` (single process, recommended)

The simplest approach. The proxy only applies to the specified command and its child processes:

```bash
# Claude Code
bastion wrap claude

# Cursor opening a project
bastion wrap cursor /path/to/project

# Python app
bastion wrap python my_agent.py

# Node.js app
bastion wrap node server.js

# With a label (displayed in Dashboard)
bastion wrap --label "code-review" claude
bastion wrap --label "data-pipeline" python etl.py
```

Each `bastion wrap` invocation generates a unique session ID. Sessions are grouped in the Dashboard for easy viewing.

### Option 2: `bastion proxy on` (system-wide proxy)

All terminals, all new processes, and GUI applications go through Bastion:

```bash
eval $(bastion proxy on)              # bash/zsh
bastion proxy on | Invoke-Expression  # PowerShell
```

To disable:

```bash
eval $(bastion proxy off)             # bash/zsh
bastion proxy off | Invoke-Expression # PowerShell
```

Best for: running multiple AI tools simultaneously with unified monitoring.

### Option 3: Manually setting environment variables

For special scenarios, inject the environment variables manually:

```bash
export HTTPS_PROXY="http://127.0.0.1:8420"
export NODE_EXTRA_CA_CERTS="$HOME/.bastion/ca.crt"
export NO_PROXY="127.0.0.1,localhost"

# Then run your agent
python my_agent.py
```

Or set them in code (Python example):

```python
import os
os.environ["HTTPS_PROXY"] = "http://127.0.0.1:8420"
os.environ["SSL_CERT_FILE"] = os.path.expanduser("~/.bastion/ca.crt")
```

---

## Common AI Agent Configurations

### Claude Code

```bash
bastion wrap claude
```

Claude Code natively supports `HTTPS_PROXY` -- no additional configuration needed.

### Cursor

```bash
bastion wrap cursor .
```

Alternatively, set `http://127.0.0.1:8420` in Cursor Settings -> Proxy.

### Aider

```bash
bastion wrap aider --model claude-3-5-sonnet
```

### OpenAI Python SDK

```bash
bastion wrap python my_app.py
```

Python `httpx` (the underlying HTTP library for the OpenAI SDK) automatically reads `HTTPS_PROXY`.

For CA certificate trust, set:

```bash
export SSL_CERT_FILE="$HOME/.bastion/ca.crt"
# or
export REQUESTS_CA_BUNDLE="$HOME/.bastion/ca.crt"
```

### Go Applications

Go's `net/http` automatically reads `HTTPS_PROXY`:

```bash
bastion wrap go run ./cmd/myagent
```

### Agent in Docker Container

Refer to the [OpenClaw Docker documentation](openclaw-docker.md) for details. The key configuration is:

```yaml
environment:
  HTTPS_PROXY: "http://host.docker.internal:8420"
  NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/bastion-ca.crt"
  NO_PROXY: "localhost,127.0.0.1,host.docker.internal"
volumes:
  - ~/.bastion/ca.crt:/etc/ssl/certs/bastion-ca.crt:ro
```

---

## Dashboard Monitoring

After starting Bastion, open the Dashboard:

```
http://127.0.0.1:8420/dashboard
```

### Overview Tab

- **Request volume**: grouped by provider / model / session
- **Token usage**: input + output tokens, real-time statistics
- **Cost tracking**: automatically calculated based on per-model pricing
- **Latency**: upstream response time for each request

### DLP Tab

- **Config**: manage detection patterns (19 built-in + custom), toggle in real time
- **Findings**: detected sensitive data, categorized by direction (request/response)
- **Test**: standalone scanner testing -- paste text for instant detection

### Audit Tab

- **Session Timeline**: request timeline grouped by session
- **DLP flags**: entries with sensitive data hits are highlighted
- **Request details**: full request/response content viewer

### Optimizer Tab

- **Cache hit rate**: caching effectiveness for identical requests
- **Token savings**: tokens saved through whitespace compression

---

## Stats API

Retrieve monitoring data via the API (suitable for integrating into custom dashboards):

```bash
# Overall statistics
curl http://127.0.0.1:8420/api/stats

# Filter by session
curl "http://127.0.0.1:8420/api/stats?session_id=<uuid>"

# Last 24 hours
curl "http://127.0.0.1:8420/api/stats?hours=24"

# Session list
curl http://127.0.0.1:8420/api/sessions

# Audit records
curl http://127.0.0.1:8420/api/audit/recent?limit=20

# DLP detection records
curl http://127.0.0.1:8420/api/dlp/recent?limit=20
```

---

## Monitoring Multiple Agents Simultaneously

Bastion natively supports proxying multiple processes at the same time, distinguishing each by session ID:

```bash
# Terminal 1
bastion wrap --label "claude-code" claude

# Terminal 2
bastion wrap --label "python-agent" python agent.py

# Terminal 3
bastion wrap --label "data-pipeline" node pipeline.js
```

The Dashboard groups sessions so you can view independent statistics for each agent.

---

## DLP Protection

Bastion's DLP engine works automatically at the proxy layer -- no modifications needed on the agent side:

| Action | Description |
|--------|-------------|
| `pass` | Log only, no intervention |
| `warn` | Log + Dashboard warning |
| `redact` | Automatically replace sensitive data with `[REDACTED]` |
| `block` | Block the entire request from being sent |

Configuration:

```yaml
# ~/.bastion/config.yaml
plugins:
  dlp:
    enabled: true
    action: "warn"        # pass | warn | redact | block
```

Detects 19 built-in patterns: AWS keys, GitHub tokens, credit card numbers, SSNs, emails, IP addresses, and more. See the [DLP documentation](dlp.md) for details.

---

## Troubleshooting

### Agent cannot connect to the API

```bash
# 1. Check if Bastion is running
bastion health

# 2. Manually test the proxy
curl -x http://127.0.0.1:8420 https://api.anthropic.com/v1/messages \
  --cacert ~/.bastion/ca.crt \
  -H "x-api-key: test" \
  -d '{}'
```

### SSL certificate errors

```bash
# Verify the CA certificate exists
ls ~/.bastion/ca.crt

# Node.js apps
export NODE_EXTRA_CA_CERTS="$HOME/.bastion/ca.crt"

# Python apps
export SSL_CERT_FILE="$HOME/.bastion/ca.crt"
export REQUESTS_CA_BUNDLE="$HOME/.bastion/ca.crt"

# System-level trust (macOS / Linux / Windows)
bastion proxy on --trust-ca
```

### Dashboard shows no data

```bash
# Verify the metrics plugin is enabled
curl http://127.0.0.1:8420/api/config | python3 -m json.tool

# Verify the agent is actually going through Bastion
bastion stats
```

### Excluding certain domains from the proxy

Bastion only intercepts AI API domains by default. OAuth, authentication, and similar domains are excluded via `NO_PROXY`.

To customize the exclusion list:

```bash
export NO_PROXY="127.0.0.1,localhost,internal.company.com"
```

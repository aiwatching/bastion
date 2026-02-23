**English** | [中文](openclaw-dlp-skill.zh.md)

# OpenClaw DLP Alert Integration

Let OpenClaw periodically poll Bastion's DLP findings API and notify users through social media channels (Telegram, Discord, Slack, etc.).

---

## How It Works

```
Bastion (host)                         OpenClaw (Docker / local)
    │                                      │
    │  Proxies AI traffic                  │
    │  DLP scanner detects findings        │
    │  Stores in SQLite                    │
    │                                      │
    │  GET /api/dlp/recent?since=...  ◄────│  Polls every 60s (cron)
    │  Returns new findings                │
    │                                      │
    │                                      ├─→ Telegram
    │                                      ├─→ Discord
    │                                      └─→ Slack / other channels
```

OpenClaw runs a cron job that:
1. Calls Bastion's `/api/dlp/recent?since=<last_check>` API every minute
2. If new findings exist, formats them into a human-readable alert
3. Sends the alert through configured messaging channels

---

## Quick Setup

Bastion provides a ready-to-use integration prompt at [`docs/openclaw-integration.md`](openclaw-integration.md). Feed this prompt to OpenClaw and it will automatically:

1. **Create the DLP alert skill** — writes `SKILL.md` to the OpenClaw workspace
2. **Add a cron job** — appends a job to `cron/jobs.json` that polls every minute
3. **Set up cursor persistence** — uses a cursor file to track `lastChecked` timestamp

### Docker Mode

```bash
# Copy the prompt into the OpenClaw container and execute it
docker exec -it <container> cat /path/to/openclaw-integration.md
# Or paste the prompt content directly into an OpenClaw chat session
```

The prompt expects Bastion at `http://host.docker.internal:8420`. If your Bastion port differs, edit the prompt before applying.

### Local Mode

For local OpenClaw instances, change the Bastion URL in the prompt from `host.docker.internal` to `127.0.0.1`:

```
http://127.0.0.1:<bastion-port>
```

### Customization

Before feeding the prompt to OpenClaw, you can adjust:

| Field | Default | Description |
|-------|---------|-------------|
| `expr` in cron job | `*/1 * * * *` | Polling frequency (e.g., `*/5 * * * *` for every 5 min) |
| `channel` in delivery | `telegram` | Target channel (`telegram`, `discord`, `slack`, etc.) |
| `to` in delivery | `<TELEGRAM_USER_ID_HERE>` | Recipient ID for the target channel |
| Bastion port | `8420` | Change if Bastion runs on a different port |

---

## API Reference

```
GET http://host.docker.internal:<bastion-port>/api/dlp/recent?since=<iso-timestamp>&limit=100
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `since` | ISO 8601 timestamp | Only return findings after this time |
| `limit` | number | Max results to return (default: 50) |

**Response:**

```json
[
  {
    "id": "uuid",
    "request_id": "uuid",
    "pattern_name": "aws-access-key",
    "pattern_category": "high-confidence",
    "action": "block",
    "match_count": 1,
    "original_snippet": "...AKIA1234567890ABCDEF...",
    "direction": "request",
    "created_at": "2026-02-22T10:30:00.000Z",
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "session_id": "abc123",
    "session_label": "my-project"
  }
]
```

When using `since`, results are sorted ascending (oldest first) so you can use the last item's `created_at` as the next `since` value.

---

## What Gets Created

After OpenClaw processes the integration prompt, the following files are created:

```
~/.openclaw/
  ├── workspace/
  │   ├── skills/dlp-alert/SKILL.md     # DLP alert skill definition
  │   └── memory/dlp-cursor.json        # Polling cursor (auto-managed)
  └── cron/jobs.json                    # Cron job added (polls every minute)
```

---

## Alert Message Format

```
🚨 DLP Alert — 2 finding(s) detected

🔴 [BLOCKED] aws-access-key (high-confidence)
   Direction: request (outgoing)
   Session: my-project
   Provider: anthropic / claude-sonnet-4-20250514
   Time: 2026-02-22 10:30:00 UTC
   Snippet: ...AKIA12345678****...

🟠 [WARNING] email-address (context-aware)
   Direction: response (incoming)
   Session: dev-work
   Provider: openai / gpt-4o
   Time: 2026-02-22 10:31:15 UTC
   Snippet: ...user@exam****...

📊 Dashboard: http://127.0.0.1:8420/dashboard → DLP tab
```

Severity mapping:
- `block` → 🔴 BLOCKED — request was rejected
- `redact` → 🟡 REDACTED — sensitive data was masked
- `warn` → 🟠 WARNING — detected but allowed through

---

## Verify Connectivity

```bash
# From inside Docker container
curl http://host.docker.internal:8420/api/dlp/recent?limit=1

# From local
curl http://127.0.0.1:8420/api/dlp/recent?limit=1
```

---

## Advanced: Filter by Session

To receive alerts only for a specific project, filter by `session_label` or `session_id` in the response. Add a filter instruction to the cron job's `message` field:

```
Only alert on findings where session_label is "my-project". Ignore all others.
```

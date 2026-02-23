k**English** | [中文](openclaw-dlp-skill.zh.md)

# OpenClaw DLP Alert Skill

This document provides a ready-to-use skill/prompt for OpenClaw to periodically poll Bastion's DLP findings API and notify users through social media channels (Telegram, Discord, Slack, etc.).

---

## How It Works

```
Bastion (host)                         OpenClaw (Docker / local)
    │                                      │
    │  Proxies AI traffic                  │
    │  DLP scanner detects findings        │
    │  Stores in SQLite                    │
    │                                      │
    │  GET /api/dlp/recent?since=...  ◄────│  Polls every 60s
    │  Returns new findings                │
    │                                      │
    │                                      ├─→ Telegram
    │                                      ├─→ Discord
    │                                      └─→ Slack / other channels
```

OpenClaw runs a scheduled skill that:
1. Calls Bastion's `/api/dlp/recent?since=<last_check>` API
2. If new findings exist, formats them into a human-readable alert
3. Sends the alert through configured messaging channels

---

## API Endpoint

```
GET http://host.docker.internal:<bastion-port>/api/dlp/recent?since=<iso-timestamp>&limit=100
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `since` | ISO 8601 timestamp | Only return findings after this time (e.g., `2026-02-22T10:00:00.000Z`) |
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

**Note:** When using `since`, results are sorted ascending (oldest first) so you can use the last item's `created_at` as the next `since` value.

---

## Skill Prompt

Copy the following prompt into your OpenClaw skill configuration. Adjust the `BASTION_URL` and polling interval as needed.

```
You are a DLP (Data Loss Prevention) alert monitor. Your job is to periodically check the Bastion AI Gateway for new sensitive data findings and alert the user immediately.

## Configuration

- Bastion API: http://host.docker.internal:8420/api/dlp/recent
- Poll interval: every 60 seconds
- Alert threshold: all findings with action "block", "redact", or "warn"

## Behavior

1. Every 60 seconds, call:
   GET http://host.docker.internal:8420/api/dlp/recent?since=<last_checked_timestamp>&limit=100

   On the first run, use the current time minus 5 minutes as the initial "since" value.

2. If the response is an empty array [], do nothing — no new findings.

3. If findings exist, send an alert message with this format:

   🚨 DLP Alert — <count> finding(s) detected

   For each finding:
   - Type: <pattern_name> (<pattern_category>)
   - Action: <action>
   - Direction: <direction> (request = outgoing, response = incoming)
   - Session: <session_label or session_id>
   - Provider: <provider> / <model>
   - Time: <created_at>
   - Snippet: <original_snippet> (first 40 chars, masked)

   Footer:
   Dashboard: http://127.0.0.1:8420/dashboard → DLP tab for details.

4. Update your "since" timestamp to the created_at of the last finding received.

5. Severity mapping for message formatting:
   - "block" → 🔴 BLOCKED — request was rejected
   - "redact" → 🟡 REDACTED — sensitive data was masked
   - "warn" → 🟠 WARNING — detected but allowed through

## Example Alert Message

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

📊 Dashboard: http://127.0.0.1:8420/dashboard
```

---

## Setup Guide

### Docker Mode

If OpenClaw runs in a Docker container managed by Bastion (`bastion openclaw docker up`), the Bastion API is accessible at:

```
http://host.docker.internal:<bastion-port>
```

The Bastion port is injected as `BASTION_PORT` env var (default: 8420).

### Local Mode

If OpenClaw runs locally (`bastion openclaw local start`), Bastion is at:

```
http://127.0.0.1:<bastion-port>
```

### Verify Connectivity

```bash
# From inside Docker container
curl http://host.docker.internal:8420/api/dlp/recent?limit=1

# From local
curl http://127.0.0.1:8420/api/dlp/recent?limit=1
```

---

## Advanced: Filter by Session

If you want alerts only for a specific session/project, filter client-side by `session_id` or `session_label` in the response:

```
GET /api/dlp/recent?since=...&limit=100
→ filter where session_label == "my-project"
```

---

## Advanced: Webhook-Style (Reverse Direction)

If you prefer OpenClaw to receive push notifications instead of polling, you can set up a simple bridge:

```bash
# Run as a cron job or background loop
while true; do
  findings=$(curl -s "http://127.0.0.1:8420/api/dlp/recent?since=$(date -u -v-1M +%Y-%m-%dT%H:%M:%S.000Z)&limit=100")
  if [ "$(echo "$findings" | jq length)" -gt 0 ]; then
    echo "$findings" | curl -s -X POST http://localhost:18789/api/notify \
      -H "Content-Type: application/json" \
      -d @-
  fi
  sleep 60
done
```

This approach is only needed if OpenClaw has a `/api/notify` endpoint. The skill-based polling approach above is simpler and recommended.

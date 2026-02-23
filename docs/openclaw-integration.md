
You are running inside a Bastion + OpenClaw environment. Set up an automatic “Bastion DLP Real‑Time Alerts” configuration with the following behavior:

Goal:
- Periodically call Bastion’s DLP findings API:
  - GET http://host.docker.internal:8420/api/dlp/recent?since=<iso-timestamp>&limit=100
- Aggregate new findings into a readable alert
- Push alerts proactively via a chat channel (Telegram by default)

--------------------------------
STEP 1: Create the dlp-alert Skill
--------------------------------

Create (or overwrite) this file:

- /home/node/.openclaw/workspace/skills/dlp-alert/SKILL.md

The content MUST be exactly the following Markdown:

---
name: dlp-alert
description: Monitor Bastion DLP `/api/dlp/recent` and send chat alerts when new findings appear. Use when setting up or maintaining periodic DLP alert checks against a Bastion AI Gateway.
---

# DLP Alert Skill

You are a DLP (Data Loss Prevention) alert monitor. Your job is to periodically check the Bastion AI Gateway for new sensitive data findings and alert the user immediately.

## API

Default (Docker mode):

- Base URL: `http://host.docker.internal:<bastion-port>` (usually `8420`)
- Endpoint: `/api/dlp/recent`

Example request:

```http
GET http://host.docker.internal:8420/api/dlp/recent?since=<iso-timestamp>&limit=100
```

Example response:

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

Results are sorted ascending by `created_at`. Use the last item's `created_at` as the next `since` cursor.

## Behavior

When this skill is used to monitor Bastion:

1. Maintain a `last_checked_timestamp` cursor (ISO 8601, UTC).
   - On the first run, initialize it to "now - 5 minutes".

2. On each polling cycle, call:

   ```http
   GET http://host.docker.internal:8420/api/dlp/recent?since=<last_checked_timestamp>&limit=100
   ```

3. If the response is an empty array `[]`, there are no new findings for this window; do nothing.

4. If findings exist, build an alert message with this structure:

   Header:

   ```text
   🚨 DLP Alert — <count> finding(s) detected
   ```

   For each finding, include a block like:

   ```text
   <severity_emoji> [<SEVERITY_LABEL>] <pattern_name> (<pattern_category>)
   Direction: <direction> (request = outgoing, response = incoming)
   Session: <session_label or session_id>
   Provider: <provider> / <model>
   Time: <created_at> (UTC)
   Snippet: <masked_snippet>
   ```

   Where severity mapping is:

   - action == `block`  → `🔴 [BLOCKED]`  — request was rejected
   - action == `redact` → `🟡 [REDACTED]` — sensitive data was masked
   - action == `warn`   → `🟠 [WARNING]`  — detected but allowed through

   The `masked_snippet` should:

   - Take at most the first ~40 visible characters of `original_snippet`
   - Mask obvious secrets (e.g. middle of access keys, emails) with `*`

   Footer:

   ```text
   📊 Dashboard: http://127.0.0.1:8420/dashboard → DLP tab for details.
   ```

5. After sending the alert, update `last_checked_timestamp` to the `created_at` of the last finding returned.

## Environment Modes

- **Docker mode** (OpenClaw inside a Bastion-managed Docker container):
  - Use `http://host.docker.internal:<bastion-port>`
  - Default port is often `8420` but may be provided via a `BASTION_PORT` env var.

- **Local mode** (OpenClaw running directly on the host):
  - Use `http://127.0.0.1:<bastion-port>`

## Optional: Session Filtering

If only certain projects/sessions should trigger alerts, filter client-side by `session_label` or `session_id`:

- Ignore findings where `session_label` / `session_id` do not match the configured allowlist.

Document any such filters alongside this skill if you enable them.

(End of SKILL.md content.)

-----------------------------------------
STEP 2: Add a DLP cron job to OpenClaw
-----------------------------------------

Edit the file:

- /home/node/.openclaw/cron/jobs.json

Keep all existing jobs. Append a new job object to the `jobs` array like this (adjust values as needed):

{
  "id": "5c3f8e3d-3a7b-4c1e-9b2d-dlp-alert-0001",
  "name": "Bastion DLP Real-Time Alerts",
  "enabled": true,
  "createdAtMs": <current time in milliseconds>,
  "updatedAtMs": <same as above>,
  "schedule": {
    "kind": "cron",
    "expr": "*/1 * * * *",
    "tz": "UTC"
  },
  "sessionTarget": "isolated",
  "wakeMode": "now",
  "payload": {
    "kind": "agentTurn",
    "message": "You are a DLP (Data Loss Prevention) alert monitoring assistant.\\n\\nTask: Every minute, poll Bastion's DLP findings API. If there are new sensitive-data findings, send a short alert message to the user in natural language.\\n\\nSkill usage:\\n- First, read /home/node/.openclaw/workspace/skills/dlp-alert/SKILL.md and follow the API and formatting rules described there.\\n\\nPolling logic:\\n1. Cursor file: /home/node/.openclaw/workspace/memory/dlp-cursor.json\\n   - If the file does not exist: initialize `lastChecked` to current time minus 5 minutes (ISO8601, UTC).\\n   - If it exists: read the `lastChecked` field (ISO8601).\\n\\n2. Call the Bastion API (Docker default):\\n   GET http://host.docker.internal:8420/api/dlp/recent?since=<lastChecked>&limit=100\\n\\n3. If the response is []:\\n   - Do not send any alert. Optionally update `lastChecked` to the current time.\\n\\n4. If the response contains findings:\\n   - Summarize them into a SINGLE alert message (do NOT send one message per finding).\\n   - Use the alert format from the dlp-alert skill: severity emoji + label, pattern name/category, direction, session_label or session_id, time (UTC), truncated+masked snippet.\\n   - Start with a header like: \\\"🚨 DLP Alert — N new finding(s)\\\".\\n   - End with a dashboard link line: \\\"📊 Dashboard: http://127.0.0.1:8420/dashboard → DLP tab\\\".\\n\\n5. After processing, write the `created_at` of the LAST finding in this batch back to /home/node/.openclaw/workspace/memory/dlp-cursor.json as:\\n   { \\\\\"lastChecked\\\\\": \\\\\"<last created_at>\\\\\" }\\n\\nNotes:\\n- Always display times in UTC.\\n- Never show full secrets; mask the middle parts with `*`.\\n- If the API call fails, send a short error message including the HTTP status code or error text."
  },
  "delivery": {
    "mode": "announce",
    "channel": "telegram",
    "to": "<TELEGRAM_USER_ID_HERE>"
  }
}

Requirements:

1. The resulting jobs.json must be valid JSON. Do not remove existing jobs.
2. You may adjust:
   - `expr` for a different frequency (e.g. `*/5 * * * *` = every 5 minutes)
   - `channel` / `to` to target other providers (discord, slack, etc.)
   - the Bastion port if it is not 8420.
3. Make sure changes are written to disk, not just described in conversation.

-----------------------------------------
STEP 3: Verify that it works
-----------------------------------------

- Ensure the OpenClaw cron service is running.
- When Bastion records new DLP findings, you should receive a single aggregated DLP alert message in the configured chat channel, following the format defined in the dlp-alert skill.
```
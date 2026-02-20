# Remote Signature Patterns -- Development Guide

**English** | [中文](remote-signatures.zh.md)

Bastion supports syncing DLP detection rules (signatures) from a remote Git repository, independently of Bastion's own version updates.

---

## Architecture Overview

```
┌──────────────────────────────────┐
│  bastion_signature (Git repo)    │
│                                  │
│  signature.yaml   ← manifest    │
│  patterns/                       │
│    high-confidence.yaml          │
│    validated.yaml                │
│    context-aware.yaml            │
│    (extensible with more .yaml)  │
└──────────┬───────────────────────┘
           │ git clone / pull
           ▼
┌──────────────────────────────────┐
│  ~/.bastion/signatures/          │
│                                  │
│  .meta.json  ← local metadata   │
│  signature.yaml                  │
│  patterns/*.yaml                 │
└──────────┬───────────────────────┘
           │ YAML parse → upsert
           ▼
┌──────────────────────────────────┐
│  SQLite: dlp_patterns table      │
│                                  │
│  id = "remote-{name}"           │
│  is_builtin = 0                  │
│  (coexists with builtin-*/       │
│   custom-*)                      │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Dashboard / API                 │
│                                  │
│  Version badge: Signatures #1    │
│  Update notice: #2 available     │
│  Manual sync:   Sync button      │
└──────────────────────────────────┘
```

## Versioning Strategy

There are two independent version numbers:

| Version | Meaning | Location | Update Frequency |
|---------|---------|----------|-----------------|
| **Git branch name** | Bastion compatibility version | Repository branch `v0.1.0` | On Bastion major version upgrades |
| **Signature version** | Signature revision number (incrementing integer) | `signature.yaml → version` | On each pattern add/remove/modify |

### Why Separate?

- The pattern format in Bastion 0.1.0 may differ from 0.2.0 (new fields, validator changes, etc.)
- Within the same Bastion version, patterns can be updated independently multiple times (#1 → #2 → #3)
- `branch: "auto"` reads Bastion's `VERSION` file and automatically maps to the `v0.1.0` branch

---

## Repository Structure (bastion_signature)

```
bastion_signature/
├── signature.yaml              # Version manifest (required)
├── README.md
├── LICENSE
└── patterns/
    ├── schema.yaml             # Pattern format reference (not loaded as patterns)
    ├── high-confidence.yaml    # High-confidence patterns
    ├── validated.yaml          # Patterns with validators
    └── context-aware.yaml      # Context-aware patterns
```

### signature.yaml Format

```yaml
version: 1                    # Integer, incremented on each update
updatedAt: "2026-02-20"       # Last update date
patternCount: 27              # Total pattern count

changelog:
  - version: 1
    date: "2026-02-20"
    changes:
      - "Initial release"
      - "27 patterns across 3 categories"
```

### Pattern YAML Format

```yaml
patterns:
  - name: my-pattern-name       # Unique identifier (kebab-case)
    category: high-confidence    # high-confidence | validated | context-aware | custom
    regex: 'sk-[A-Za-z0-9]{40}' # Regular expression (string, no delimiters)
    flags: g                     # Optional, defaults to "g"
    description: My Pattern      # Human-readable description
    validator: luhn              # Optional, built-in validators: luhn, ssn
    requireContext:              # Optional, context keywords
      - keyword1
      - keyword2
```

**Notes:**
- `name` must be globally unique; stored in the DB with id = `remote-{name}`
- If a `name` collides with a built-in pattern (e.g., `aws-access-key`), the different id prefixes (`builtin-` vs `remote-`) avoid id conflicts, but the DB's `UNIQUE(name)` constraint will block the insert -- built-in patterns take precedence
- `schema.yaml` is automatically skipped during parsing
- Any `.yaml` or `.yml` file will be parsed (in alphabetical order)

---

## Key Files on the Bastion Side

| File | Responsibility |
|------|---------------|
| `src/dlp/remote-sync.ts` | Core sync engine: git clone/pull, YAML parsing, version checking |
| `src/config/schema.ts` | `remotePatterns` config type definition |
| `src/config/paths.ts` | `signaturesDir` = `~/.bastion/signatures/` |
| `config/default.yaml` | Default config (empty url = disabled) |
| `src/storage/repositories/dlp-patterns.ts` | `upsertRemote()` method |
| `src/plugins/builtin/dlp-scanner.ts` | Calls sync on startup + starts periodic timer |
| `src/dashboard/api-routes.ts` | API endpoints: `/api/dlp/signature`, `/api/dlp/signature/sync` |
| `src/dashboard/page.ts` | Dashboard UI: version badge, update notice, Sync button |

---

## Core Flows

### 1. Startup Sync (syncOnStart)

```
Bastion starts
  → createDlpScannerPlugin()
    → seedBuiltins()           # Write built-in patterns to DB
    → syncRemotePatterns()     # Sync remote patterns
      → resolveBranch("auto")  # Read VERSION → "v0.1.0"
      → syncRepo()             # git clone / pull
      → loadPatternFiles()     # Parse patterns/*.yaml
      → upsertPatterns()       # Write to DB (id = "remote-{name}")
      → readSignatureYaml()    # Read signature.yaml
      → writeMetaFile()        # Save .meta.json
    → startPeriodicSync()      # If syncIntervalMinutes > 0
```

### 2. Update Check (checkForUpdates)

```
Dashboard opens DLP tab
  → GET /api/dlp/signature?check=true
    → checkForUpdates()
      → git fetch origin              # Fetch only, no pull
      → git show origin/v0.1.0:signature.yaml  # Read remote version
      → Compare local.version vs remote.version
      → Return { local, remote, updateAvailable }
```

### 3. Manual Sync

```
User clicks "Sync" button / clicks "#2 available"
  → POST /api/dlp/signature/sync
    → syncRemotePatterns()   # Full sync flow
    → Return { ok, synced, signature }
  → refreshPatterns()        # UI refreshes pattern list
  → refreshSignature()       # UI refreshes version badge
```

### 4. Pattern Write Logic (upsertRemote)

```sql
-- New pattern: enabled state determined by category
INSERT INTO dlp_patterns (id, name, ..., enabled)
VALUES ('remote-xxx', 'xxx', ..., 1)

-- Existing pattern: update regex/description etc., but preserve enabled state
ON CONFLICT(id) DO UPDATE SET
  regex_source = @regex_source,
  description = @description,
  ...
  -- Note: does NOT overwrite the enabled field
```

This ensures that patterns manually disabled by the user in the Dashboard will not be re-enabled on the next sync.

---

## Configuration

```yaml
# ~/.bastion/config.yaml
plugins:
  dlp:
    remotePatterns:
      url: "https://github.com/aiwatching/bastion_signature.git"
      branch: "auto"            # "auto" | "v0.1.0" | "main" | ...
      syncOnStart: true         # Pull on startup
      syncIntervalMinutes: 0    # 0 = startup only, >0 = periodic sync (minutes)
```

- `url: ""` → Completely disables remote signatures
- `branch: "auto"` → Reads the `VERSION` file → `v{version}`
- `syncIntervalMinutes: 60` → Automatically pulls once per hour

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dlp/signature` | Returns local signature version info |
| `GET` | `/api/dlp/signature?check=true` | Same as above + checks if a remote update is available |
| `POST` | `/api/dlp/signature/sync` | Manually triggers sync, returns sync result |

### GET /api/dlp/signature?check=true Response

```json
{
  "local": {
    "version": "1",
    "updatedAt": "2026-02-20",
    "patternCount": 27,
    "syncedAt": "2026-02-20T15:00:00.000Z",
    "repoUrl": "https://github.com/aiwatching/bastion_signature.git",
    "branch": "v0.1.0",
    "changelog": [...]
  },
  "remote": {
    "version": "2",
    "updatedAt": "2026-02-25",
    "patternCount": 30
  },
  "updateAvailable": true
}
```

### POST /api/dlp/signature/sync Response

```json
{
  "ok": true,
  "synced": 30,
  "signature": {
    "version": "2",
    "updatedAt": "2026-02-25",
    "patternCount": 30,
    "syncedAt": "2026-02-20T16:00:00.000Z",
    "repoUrl": "...",
    "branch": "v0.1.0"
  }
}
```

---

## Development Guide

### Adding New Patterns to the Signature Repository

```bash
# 1. Clone the repository
git clone -b v0.1.0 https://github.com/aiwatching/bastion_signature.git
cd bastion_signature

# 2. Edit or add patterns/*.yaml
vim patterns/high-confidence.yaml

# 3. Update signature.yaml
#    - Increment version
#    - Update patternCount
#    - Add changelog entry
vim signature.yaml

# 4. Commit and push
git add -A
git commit -m "Add discord-bot-token pattern (#2)"
git push origin v0.1.0
```

### Creating a New Bastion Version Branch

When Bastion upgrades to a new version (e.g., 0.2.0), a corresponding branch must be created in the signature repository:

```bash
cd bastion_signature
git checkout v0.1.0
git checkout -b v0.2.0

# If the pattern format has changed, make modifications here
# Reset signature version to 1 or continue incrementing (continuing is recommended)
vim signature.yaml

git push -u origin v0.2.0
```

### Testing Sync Locally

```bash
# 1. Configure Bastion to point to a local or test repository
# ~/.bastion/config.yaml
plugins:
  dlp:
    remotePatterns:
      url: "https://github.com/aiwatching/bastion_signature.git"
      branch: "v0.1.0"
      syncOnStart: true

# 2. Restart Bastion
bastion stop && bastion start

# 3. Check logs
tail -f ~/.bastion/bastion.log | grep remote-sync

# 4. Verify via API
curl http://127.0.0.1:8420/api/dlp/signature
curl http://127.0.0.1:8420/api/dlp/signature?check=true
curl -X POST http://127.0.0.1:8420/api/dlp/signature/sync
```

### FAQ

**Q: What happens if a remote pattern name duplicates a built-in pattern name?**

The DB has a `UNIQUE` constraint on `name`. Since built-in patterns are seeded first (id = `builtin-{name}`), the remote pattern's `upsertRemote` uses `ON CONFLICT(id)` which won't trigger a name conflict -- but the `INSERT` will fail due to the duplicate name. Solution: remote patterns should use different names, or `upsertRemote` should be changed to use an `ON CONFLICT(name)` strategy.

> **TODO**: In the current implementation, remote patterns with names that match built-in patterns are silently skipped (the INSERT failure is swallowed by try-catch). If "remote overrides built-in" semantics are needed, the upsert strategy must be modified.

**Q: What if git is unavailable or the network is down?**

Sync failures only produce a warning log and do not affect Bastion startup. Existing local patterns (built-in + previously synced remote patterns) continue to function.

**Q: Does periodic sync block request processing?**

`syncRemotePatterns()` is a synchronous call (`execSync`) executed in a timer callback. A git pull typically takes < 1s (shallow clone), and YAML parsing plus DB upsert are also fast. However, if the network is slow (timeout 30s), it will briefly block.

> **TODO**: Consider switching to async (worker thread or child process) to avoid blocking the main thread.

---

## File Storage

```
~/.bastion/
  signatures/               # Git-cloned signature repository
    .git/
    .meta.json              # Local version metadata
    signature.yaml          # Remote manifest
    patterns/
      high-confidence.yaml
      validated.yaml
      context-aware.yaml
      schema.yaml
  bastion.db                # SQLite: dlp_patterns table stores final patterns
```

Pattern ids in the `dlp_patterns` table use prefixes to distinguish their source:

| Prefix | Source | Deletable |
|--------|--------|-----------|
| `builtin-` | Built-in (source code) | Cannot delete, can disable |
| `remote-` | Remote signature repository | Cannot delete, can disable |
| `custom-` | User-added manually | Can delete |

**English** | [中文](dlp.zh.md)

# DLP Engine — Detection Pipeline

Bastion's DLP engine uses a tiered funnel architecture. Each layer only processes candidates passed down from the layer above, filtering progressively — the deeper the layer, the more precise and more expensive it is.

```
Input Text
    │
    ▼
┌──────────────────────┐
│  Layer 0: Structure  │  Parse JSON / extract key-value pairs
│  (structure.ts)      │  Output: StructuredField[]
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Layer 1: Entropy    │  Shannon entropy calculation, filter low-entropy values
│  (entropy.ts)        │  Threshold: >= 3.5 bits/char
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Layer 2: Regex      │  Format-specific regex matching
│  (patterns/*.ts)     │  high-confidence / validated / context-aware
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Layer 3: Semantics  │  Field name semantic analysis
│  (semantics.ts)      │  Sensitive field + high entropy → generic-secret
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Layer 4: AI         │  LLM false-positive filtering (optional)
│  (ai-validator.ts)   │  Anthropic / OpenAI API
└──────────────────────┘
```

---

## Layer 0: Structure-aware Parsing

**File**: `src/dlp/structure.ts`

Parses the structure of the input text and extracts key-value field pairs.

### Processing Modes

1. **JSON Parsing** — Recursively traverses the JSON object tree, collecting all string values and their paths
   - Input: `{"credentials": {"api_key": "sk-abc..."}}`
   - Output: `{key: "api_key", path: "credentials.api_key", value: "sk-abc..."}`

2. **Inline Assignment Extraction** — For long string content (e.g., message content), scans for `KEY=VALUE` and `KEY: VALUE` patterns
   - Input: `"Please set OPENAI_KEY=sk-abc123def456"`
   - Output: `{key: "OPENAI_KEY", value: "sk-abc123def456"}`

3. **Non-JSON Fallback** — When input is not valid JSON, directly extracts assignment patterns

### Limits

- Maximum text size 512KB; structural analysis is skipped for larger inputs
- Minimum value length 6 characters
- Inline assignment minimum value length 8 characters

---

## Layer 1: Entropy Pre-filter

**File**: `src/dlp/entropy.ts`

Calculates the Shannon entropy of strings to distinguish random keys from natural language.

### Shannon Entropy Formula

```
H(X) = -Σ p(xᵢ) × log₂(p(xᵢ))
```

Where `p(xᵢ)` is the frequency of character `xᵢ`.

### Typical Entropy Values

| Type | Entropy (bits/char) | Example |
|------|----------------|------|
| Pure digits | ~3.3 | `1234567890` |
| English text | ~3.5–4.0 | `the quick brown fox` |
| Hexadecimal | ~3.7–4.0 | `a1b2c3d4e5f6a7b8` |
| API Key | ~4.5–5.5 | `sk-proj-abc123XYZ` |
| Random Base64 | ~5.0–6.0 | `aGVsbG8gd29ybGQ=` |

### Parameters

- **Threshold**: `>= 3.5` bits/char (default)
- **Minimum length**: 8 characters
- **Maximum length**: 200 characters (longer strings are typically text content rather than individual keys)

---

## Layer 2: Regex Pattern Matching

**File**: `src/dlp/engine.ts`, `src/dlp/patterns/*.ts`

Uses regular expressions to match known formats of sensitive data. Divided into three categories:

### high-confidence

Patterns with extremely low false-positive rates — a match is sensitive data:

| Pattern | Description | Example |
|------|------|------|
| `aws-access-key` | AWS Access Key ID | `AKIA1234567890ABCDEF` |
| `github-token` | GitHub PAT | `ghp_xxxxxxxxxxxx...` |
| `openai-api-key` | OpenAI / DeepSeek etc. sk- prefix | `sk-proj-abc123...` |
| `anthropic-api-key` | Anthropic API Key | `sk-ant-abc123...` |
| `private-key` | PEM private key header | `-----BEGIN PRIVATE KEY-----` |
| `password-assignment` | Password/secret assignment | `password=hunter2` |
| ... | More LLM provider API keys | |

Some high-confidence patterns still require context confirmation (`requireContext`), e.g., `aws-secret-key` requires "aws" or "secret" to appear nearby.

### validated

Regex match + algorithmic validation:

| Pattern | Validator | Description |
|------|--------|------|
| `credit-card` | Luhn checksum | Visa/MC/Amex/Discover |
| `ssn` | Area/group number validation | US Social Security Number |

### context-aware

Only triggered when context keywords appear nearby (within 200 characters):

| Pattern | Context Words | Description |
|------|----------|------|
| `email-address` | email, contact, user... | Email address |
| `phone-number` | phone, call, tel... | US phone number |
| `ip-address` | ip, server, host... | IPv4 address |
| `drivers-license` | driver, license, DL... | Driver's license number |
| `passport-number` | passport | Passport number |

### Timeout Protection

Each regex pattern has a 10ms timeout limit to prevent ReDoS.

---

## Layer 3: Field-name Semantics

**File**: `src/dlp/semantics.ts`

Leverages semantic information from JSON field names to detect generic secrets not covered by regex.

### Detection Logic

A `generic-secret` finding is generated when all three conditions are met simultaneously:

1. **Sensitive field name** — The field name matches patterns such as `password`, `secret`, `token`, `api_key`, `auth`, `credential`, `private_key`, etc.
2. **High entropy** — The field value's Shannon entropy >= 3.5 bits/char
3. **Not covered by regex** — The value was not matched by any Layer 2 regex pattern

### Example

```json
{
  "my_custom_secret": "xK9#mP2$vL5@nR8!qW4&jB7"
}
```

- Layer 0 extraction: `{key: "my_custom_secret", value: "xK9#mP2$vL5@nR8!qW4&jB7"}`
- Layer 1: entropy = ~4.7 bits/char → high entropy
- Layer 2: no regex match (custom format)
- Layer 3: "my_custom_secret" contains "secret" → sensitive field + high entropy + no regex coverage → hit `generic-secret`

### Known Non-sensitive Field Names

To avoid false positives, the following field names are excluded: `role`, `model`, `content`, `type`, `name`, `id`, `max_tokens`, `temperature`, and other common LLM API fields.

### Dynamic Configuration

Sensitive field name patterns and non-sensitive names can be dynamically modified via the Settings UI without restarting:

```yaml
dlp:
  semantics:
    sensitivePatterns: ["\\bcert\\b", "my_custom_key"]  # Additional sensitive patterns (regex)
    nonSensitiveNames: ["my_safe_field"]                 # Additional non-sensitive names
```

- **Built-in rules are immutable** — The default `BUILTIN_SENSITIVE` and `BUILTIN_NON_SENSITIVE` in code are always active
- **User rules are additive** — Rules added via configuration are merged with built-in rules, not overridden
- **Hot reload** — Changes take effect immediately via `ConfigManager.onChange`

---

## Layer 4: AI Validation (Optional)

**File**: `src/dlp/ai-validator.ts`

Uses the LLM API to perform secondary confirmation on Layer 2/3 detection results, filtering out false positives.

### How It Works

1. For each finding, extract context around the matched text (200 characters before and after)
2. Partially mask the matched text before sending it to the LLM
3. The LLM determines whether it is truly sensitive data (`sensitive`) or a false positive (`false_positive`)
4. Built-in LRU cache to avoid redundant API calls

### Configuration

```yaml
dlp:
  aiValidation:
    enabled: false        # Disabled by default
    provider: "anthropic" # Or "openai"
    model: "claude-haiku-4-5-20241022"
    apiKey: ""
    timeoutMs: 5000
    cacheSize: 500
```

### Failure Policy

On AI call failure, a fail-closed policy is applied: the match is treated as truly sensitive data (not allowed through).

---

## Message-level Cache

**File**: `src/dlp/message-cache.ts`

LLM API requests carry the full conversation history in a `messages[]` array. Without caching, every turn re-scans ALL previous messages — O(N²) cumulative work across a conversation.

### How It Works

```
Turn 1: [msg₁]              → scan msg₁ (1 scan)
Turn 2: [msg₁, msg₂, msg₃]  → msg₁ cache hit, scan msg₂ + msg₃ (2 scans)
Turn 3: [msg₁–₃, msg₄, msg₅] → msg₁–₃ cache hits, scan msg₄ + msg₅ (2 scans)
...
Turn N: N-1 cache hits + 2 scans → O(1) new work per turn
```

The cache uses content-addressed hashing (SHA-256) on individual message content. No session tracking is needed — identical messages always produce the same hash regardless of which conversation or agent they come from.

### Cache Architecture

- **LRU eviction** — Default capacity 5000 entries; least-recently-used messages are evicted first
- **System prompt caching** — The Anthropic `system` field is also individually cached
- **Multimodal support** — Content block arrays (text + image) are serialized and hashed
- **Cross-agent sharing** — A single `DlpMessageCache` instance is shared across all conversations; common system prompts only need to be scanned once

### CachedDlpResult

The cache distinguishes between first-time detections and repeated detections:

```typescript
interface CachedDlpResult extends DlpResult {
  newFindings: DlpFinding[];    // First-time detection (new messages)
  cachedFindings: DlpFinding[]; // Already detected in a previous request
}
```

The `dlp-scanner` plugin uses this distinction to:

| Aspect | newFindings | cachedFindings |
|--------|------------|----------------|
| DLP event recording | Recorded to database | Skipped (already recorded) |
| AI validation (Layer 4) | Sent for validation | Skipped (already validated) |
| block / redact action | Applied | Applied (security not compromised) |
| Audit log | Written | Skipped |
| dlpHit context flag | Sets `true` | Does not set `true` |

### Performance

Simulated 10-turn conversation (2 messages per turn):

| Metric | Without cache | With cache | Reduction |
|--------|--------------|------------|-----------|
| Messages scanned | 110 | 20 | 82% |
| Cache hit rate (turn 10) | — | 90% | — |

### Diagnostic Logging

Each request produces per-message detail logs:

```
msg[0] user HIT          bytes=142 hash=a1b2c3d4 preview="Hello, can you..."
msg[1] assistant HIT     bytes=89  hash=e5f6a7b8 preview="Sure, I can..."
msg[2] user SCAN+FINDING bytes=256 hash=c9d0e1f2 findings=["aws-access-key"]
```

Tags: `HIT` (cache hit, no findings), `HIT+FINDING` (cache hit, has findings), `SCAN` (new scan, no findings), `SCAN+FINDING` (new scan, found sensitive data), `SKIP` (empty message).

---

## False Positive Suppression

### password-assignment Pattern

The `password-assignment` pattern detects `key=value` assignments where the key suggests a secret. Three mechanisms prevent false positives, especially in agent/code scenarios:

**1. Keyword precision — no bare suffixes**

Keywords are categorized by false-positive risk:

| Level | Keywords | In pattern? |
|-------|----------|-------------|
| Strong | `password`, `passwd`, `pwd`, `credential` | Yes (high-confidence) |
| Medium | `secret_key`, `auth_token`, `access_token`, `api_key`, `apikey` | Yes (compound words, low FP) |
| Weak | `_key`, `_secret`, `_token` | **Removed** (too broad in code) |

Bare suffixes like `_key` match `sort_key`, `primary_key`, `cache_key`, `encryption_key` etc. — all common in agent-generated code. These field names are instead covered by Layer 3 (semantic analysis) which cross-checks entropy.

**2. Code-pattern negative lookahead**

The regex value part excludes values that start with JavaScript built-in objects or language keywords:

```
localStorage, document, window, console, JSON, Object, Array,
Math, Date, String, Number, Boolean, null, undefined, true, false,
function, new, this., self., require, import, export, return, typeof, void
```

This prevents matches like `auth_token=localStorage.getItem(...)` or `secret_key=Object.keys(config)`.

**3. Function call exclusion**

The captured value character class `[^\s'"(]{6,}` excludes `(`, so method calls like `key(i)` or `getElementById(...)` are not captured as secret values.

### Design Principle: Prefer False Negatives Over False Positives

In agent scenarios, a false positive (blocking or redacting legitimate code) breaks the entire agent workflow and may render the user's environment unusable. A false negative (missing a secret) is recoverable — it can be caught by audit logs or discovered later.

Therefore, DLP patterns are tuned conservatively:
- High-confidence patterns (API key prefixes, PEM headers) are precise and rarely false-positive
- Broad patterns (`password-assignment`) are restricted to compound keywords only
- Generic secrets are handled by Layer 3 (field name semantics + entropy) which has structural context

---

## Full Call Flow

```
dlp-scanner plugin
  │
  ├─ messageCache.scanWithCache(body, parsedBody, patterns, action)
  │    │
  │    ├─ Has messages[]? ─── No ──→ scanText(body) full scan
  │    │         │
  │    │        Yes
  │    │         │
  │    │    ├─ For each message: hash → cache lookup
  │    │    │    ├─ Cache HIT  → collect cachedFindings
  │    │    │    └─ Cache MISS → scanText(messageText) → store in cache
  │    │    │         │
  │    │    │         ├─ Layer 2: Regex matching
  │    │    │         │    ├─ requireContext? → hasNearbyContext()
  │    │    │         │    ├─ validator? → Luhn / SSN
  │    │    │         │    └─ code-pattern lookahead filtering
  │    │    │         │
  │    │    │         ├─ Layer 0: extractStructuredFields
  │    │    │         ├─ Layer 1: isHighEntropy
  │    │    │         └─ Layer 3: isSensitiveFieldName → generic-secret
  │    │    │
  │    │    └─ Return CachedDlpResult { newFindings, cachedFindings }
  │    │
  │    ├─ Layer 4: aiValidator.validate(newFindings only) [optional]
  │    │
  │    ├─ Record DLP events (newFindings only)
  │    │
  │    └─ Apply action: block / redact (all findings)
```

## Real-world Examples

### Web chat (OpenClaw)

DLP scanning a web chat session — an API key embedded in the conversation is detected and flagged:

![OpenClaw Web DLP Detection](openclaw-web.png "DLP detection in OpenClaw web chat")

### Telegram bot

DLP scanning a Telegram bot message — sensitive credentials in the message body are caught before forwarding:

![Telegram DLP Detection](telegram.png "DLP detection in Telegram bot messages")

---

## File Index

| File | Layer | Responsibility |
|------|------|------|
| `src/dlp/structure.ts` | Layer 0 | JSON structure parsing, key-value extraction |
| `src/dlp/entropy.ts` | Layer 1 | Shannon entropy calculation |
| `src/dlp/patterns/high-confidence.ts` | Layer 2 | High-confidence regex patterns |
| `src/dlp/patterns/validated.ts` | Layer 2 | Algorithmically validated regex patterns |
| `src/dlp/patterns/context-aware.ts` | Layer 2 | Context-aware regex patterns |
| `src/dlp/engine.ts` | Layer 2+3 | Engine core, pipeline orchestration |
| `src/dlp/semantics.ts` | Layer 3 | Field name semantic analysis |
| `src/dlp/validators.ts` | Layer 2 | Luhn / SSN validators |
| `src/dlp/ai-validator.ts` | Layer 4 | LLM false-positive filtering |
| `src/dlp/message-cache.ts` | — | Message-level LRU cache for deduplication |
| `src/dlp/actions.ts` | — | Type definitions |

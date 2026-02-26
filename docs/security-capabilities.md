# Bastion Security Capabilities Overview

> A comprehensive summary of all DLP, Prompt Injection, and Tool Guard capabilities currently implemented and deployed.

---

## 1. DLP Scanner — Data Loss Prevention

### 1.1 Detection Pipeline Architecture

5-layer pipeline, executed sequentially:

```
Request/Response Body
  → L0 Structure Parsing (JSON/YAML/env key-value extraction)
  → L1 Entropy Analysis (Shannon entropy filters high-randomness strings)
  → L2 Regex Matching (62 built-in rules + remote signatures)
  → L3 Semantic Analysis (field name sensitivity detection)
  → L4 AI Validation (optional, LLM-based false positive filtering)
  → Action: pass / warn / redact / block
```

### 1.2 Action Modes

| Action | Behavior | Can Block | Can Redact |
|--------|----------|:---------:|:----------:|
| `pass` | Allow through, no processing | - | - |
| `warn` | Allow through, record event to DB | - | - |
| `redact` | Replace matched content with `[PATTERN_REDACTED]`, modify body | - | ✓ |
| `block` | Reject request/response, return 403 | ✓ | - |

### 1.3 Bidirectional Scanning

| Direction | Hook | Can Block | Notes |
|-----------|------|:---------:|-------|
| Request (→LLM) | `onRequest` | ✓ | Scans before sending, supports block/redact |
| Response (non-streaming) | `onResponse` | ✓ | Scans before returning to client, supports block/redact |
| Response (streaming SSE) | `onResponseComplete` | ✗ | Post-send scan, forced warn, audit only |

### 1.4 Remote Signature Sync

- Syncs additional DLP rules from a Git repository (default `aiwatching/bastion_signature`)
- Automatic branch selection (`auto` = `v{MAJOR_VERSION}` or `main`)
- Supports sync on startup + periodic sync
- Signature version management + changelog tracking
- Does not override user's enable/disable settings

### 1.5 AI Validation Layer (L4, Optional)

- Supports Anthropic / OpenAI providers
- LRU cache (default 500 entries) to avoid redundant API calls
- Masks matched text (first 4 + last 4 characters visible)
- Verdict: `sensitive` (real sensitive data) / `false_positive` (example/placeholder/test data)
- Fail-closed: API timeout or error treated as sensitive data

---

## 2. DLP Built-in Rules (62 Rules)

### 2.1 High-Confidence (19 Rules)

High precision, low false positive rules that require no additional context.

| # | Rule Name | Detection Target | Requires Context |
|---|-----------|-----------------|:----------------:|
| 1 | `aws-access-key` | AWS Access Key ID (AKIA...) | - |
| 2 | `aws-secret-key` | AWS Secret Access Key (40-char base64) | ✓ aws/secret/AWS_SECRET |
| 3 | `github-token` | GitHub Personal Access Token (ghp_/gho_/ghs_/ghr_) | - |
| 4 | `github-fine-grained-token` | GitHub Fine-grained PAT (github_pat_) | - |
| 5 | `slack-token` | Slack Token (xoxb-/xoxp-/xoxs-/xoxa-) | - |
| 6 | `stripe-secret-key` | Stripe Secret Key (sk_live_/sk_test_) | - |
| 7 | `private-key` | PEM Private Key Header (-----BEGIN ... PRIVATE KEY-----) | - |
| 8 | `openai-api-key` | OpenAI API Key (sk-proj-/sk-..., also matches DeepSeek/Moonshot sk- prefix) | - |
| 9 | `anthropic-api-key` | Anthropic API Key (sk-ant-) | - |
| 10 | `google-ai-api-key` | Google AI / Gemini API Key (AIzaSy...) | - |
| 11 | `huggingface-token` | Hugging Face Token (hf_...) | - |
| 12 | `replicate-api-token` | Replicate API Token (r8_...) | - |
| 13 | `groq-api-key` | Groq API Key (gsk_...) | - |
| 14 | `perplexity-api-key` | Perplexity API Key (pplx-...) | - |
| 15 | `xai-api-key` | xAI (Grok) API Key (xai-...) | - |
| 16 | `cohere-api-key` | Cohere / Mistral / Together AI Key (40-char) | ✓ cohere/mistral/together |
| 17 | `azure-openai-api-key` | Azure OpenAI API Key (32-char hex) | ✓ azure/AZURE_OPENAI |
| 18 | `telegram-bot-token` | Telegram Bot Token (digits:alpha mix) | - |
| 19 | `password-assignment` | Password assignment (password/secret/api_key = "value") | - |

### 2.2 Validated (2 Rules)

Rules that require additional structural validation.

| # | Rule Name | Detection Target | Validator |
|---|-----------|-----------------|-----------|
| 1 | `credit-card` | Credit Card Number (Visa/MC/Amex/Discover) | Luhn checksum |
| 2 | `ssn` | US Social Security Number (XXX-XX-XXXX) | Area/group/serial range validation |

### 2.3 Context-Aware (5 Rules)

Only trigger when context keywords appear within 200 characters of the match.

| # | Rule Name | Detection Target | Context Keywords |
|---|-----------|-----------------|-----------------|
| 1 | `email-address` | Email Address | email, contact, user, customer, address, send to, mailto |
| 2 | `phone-number` | US Phone Number | phone, call, tel, mobile, cell, fax, contact |
| 3 | `ip-address` | IPv4 Address | ip, server, host, address, connect, network |
| 4 | `drivers-license` | Driver License Number (letter + 7-12 digits) | driver, license, licence, DL, driving |
| 5 | `passport-number` | Passport Number | passport |

### 2.4 Entropy Detection (L1 Layer)

Non-rule-based detection using information entropy to automatically discover unknown secrets:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Entropy Threshold | 3.5 bits/char | Natural language typically 3.0-4.0, secrets typically 4.5-6.0 |
| Min Length | 8 characters | Below this length, entropy analysis is skipped |
| Max Length | 200 characters | Above this length, treated as content rather than secret |

### 2.5 Semantic Analysis (L3 Layer)

Field name-based automatic sensitivity detection:

**Built-in Sensitive Field Name Patterns** (16 regex patterns):

`password`, `passwd`, `secret`, `token`, `api_key`, `apikey`, `auth`, `credential`, `private_key`, `access_key`, `secret_key`, `cipher`, `salt`, `connection_string`, `dsn`, `signing`, `bearer`, `authorization`

**Built-in Non-Sensitive Field Names** (45, fast rejection):

`role`, `model`, `content`, `type`, `name`, `id`, `version`, `method`, `path`, `url`, `status`, `message`, `description`, `format`, `language`, `encoding`, `timestamp`, `created`, `max_tokens`, `temperature`, `top_p`, `stream`, `stop`, `n`, `presence_penalty`, `frequency_penalty`, `text`, `index`, `object`, `finish_reason`, `logprobs`, `usage`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `system_fingerprint`, `created_at`, `updated_at`, `choices`, `response_format`, `seed`, `tool_choice`, `function_call`, `safety_ratings`, `candidates`

### 2.6 Structure Parsing (L0 Layer)

- Automatically identifies JSON body and recursively traverses to extract all string values
- Falls back to `KEY=VALUE` / `KEY: VALUE` pattern extraction for non-JSON content
- Max processing size: 512 KB

---

## 3. Prompt Injection Detection Rules (36 Rules)

All rules belong to the DLP Scanner's `prompt-injection` category and execute in the L2 regex matching layer.

### 3.1 Instruction Override (6 Rules)

| # | Rule Name | Detection Target |
|---|-----------|-----------------|
| 1 | `pi-ignore-prev` | "ignore all previous instructions" |
| 2 | `pi-disregard` | "disregard previous/system instructions" |
| 3 | `pi-forget` | "forget your instructions/rules/training" |
| 4 | `pi-new-instructions` | "new instructions:" directive |
| 5 | `pi-do-not-follow` | "do not follow your rules" |
| 6 | `pi-stop-being` | "stop being safe/helpful/ethical" |

### 3.2 Role Injection (5 Rules)

| # | Rule Name | Detection Target | Requires Context |
|---|-----------|-----------------|:----------------:|
| 7 | `pi-you-are-now` | "you are now a/an..." | ✓ |
| 8 | `pi-pretend` | "pretend to be..." | ✓ |
| 9 | `pi-no-restrictions` | "act as if no restrictions/rules" | - |
| 10 | `pi-from-now-on` | "from now on you will..." | ✓ |
| 11 | `pi-entering-mode` | "entering unrestricted/god/admin/sudo mode" | - |

Context keywords: ignore, instruction, system, pretend, override, jailbreak

### 3.3 System Manipulation (6 Rules)

| # | Rule Name | Detection Target |
|---|-----------|-----------------|
| 12 | `pi-system-bracket` | Fake `[SYSTEM UPDATE]` / `[SYSTEM NOTE]` tags |
| 13 | `pi-system-xml` | Fake `<system>` / `<instruction>` XML tags |
| 14 | `pi-inst-token` | Model-specific tokens: `[INST]`, `<<SYS>>`, `<\|im_start\|>` |
| 15 | `pi-markdown-system` | Markdown heading `## system` / `## instruction` |
| 16 | `pi-codeblock-system` | Code block containing system/instruction tags |
| 17 | `pi-assistant-prefix` | Fake "assistant:" prefix (requires context) |

### 3.4 Prompt Leaking (5 Rules)

| # | Rule Name | Detection Target |
|---|-----------|-----------------|
| 18 | `pi-reveal-prompt` | "reveal your system prompt/instructions" |
| 19 | `pi-show-prompt` | "show me your prompt/instructions" |
| 20 | `pi-repeat-above` | "repeat everything above/before" |
| 21 | `pi-output-prompt` | "output full/complete prompt" |
| 22 | `pi-print-above` | "print/display everything above" |

### 3.5 Jailbreak (7 Rules)

| # | Rule Name | Detection Target |
|---|-----------|-----------------|
| 23 | `pi-jailbreak-keyword` | Keyword "jailbreak" |
| 24 | `pi-dan-mode` | "DAN mode" (Do Anything Now) |
| 25 | `pi-dan-phrase` | "do anything now" phrase |
| 26 | `pi-developer-mode` | "developer mode activation" |
| 27 | `pi-override-safety` | "override safety/content/security filters" |
| 28 | `pi-bypass-filter` | "bypass safety/content filter" |
| 29 | `pi-no-rules` | "without/remove restrictions/rules/safety" |

### 3.6 Encoding Obfuscation (3 Rules)

| # | Rule Name | Detection Target |
|---|-----------|-----------------|
| 30 | `pi-zero-width` | Zero-width characters (U+200B, U+200D, U+FEFF, etc.) |
| 31 | `pi-bidi-override` | Bidirectional text override characters (U+202A-202E, U+2066-2069) |
| 32 | `pi-control-chars` | Unexpected control characters (U+00-08, U+0B-0C, U+0E-1F, U+7F) |

### 3.7 Delimiter Injection (2 Rules)

| # | Rule Name | Detection Target |
|---|-----------|-----------------|
| 33 | `pi-newline-injection` | Triple newline followed by override keywords |
| 34 | `pi-separator-injection` | Separator lines (---, ===) followed by system/instruction |

### 3.8 Indirect Injection (2 Rules)

| # | Rule Name | Detection Target |
|---|-----------|-----------------|
| 35 | `pi-html-comment` | HTML comment containing injection payload |
| 36 | `pi-hidden-tag` | `[hidden instruction]` / `[system prompt]` tags |

---

## 4. Tool Guard — Tool Call Monitoring

### 4.1 Architecture

- **Multi-Provider Support**: Parses Anthropic (`tool_use`), OpenAI (`tool_calls`), Gemini (`functionCall`) formats
- **Streaming Interception**: `StreamingToolGuard` buffers SSE tool_use blocks in real-time, evaluates before forwarding
- **Alert System**: Desktop notifications + Webhook push

### 4.2 Action Modes

| Action | Behavior |
|--------|----------|
| `audit` | Record all tool calls, no blocking |
| `block` | Block when rule matches and severity >= `blockMinSeverity` |

Configurable parameters:
- `blockMinSeverity`: Minimum severity to trigger blocking (default `critical`)
- `alertMinSeverity`: Minimum severity to trigger alerts (default `high`)
- `recordAll`: Whether to record all tool calls including unmatched (default `true`)
- `alertDesktop`: Desktop notification toggle
- `alertWebhookUrl`: Webhook alert URL

### 4.3 Severity Levels

| Level | Weight | Description |
|-------|:------:|-------------|
| `critical` | 4 | Can cause irreversible damage |
| `high` | 3 | Credential leakage, data overwrite |
| `medium` | 2 | Requires attention but risk is manageable |
| `low` | 1 | Informational, low risk |

---

## 5. Tool Guard Built-in Rules (26 Rules)

### 5.1 Destructive File Operations — destructive-fs (5 Rules)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 1 | `fs-rm-rf-root` | **CRITICAL** | `rm -rf /` / `rm -rf ~` / `rm -rf /home` |
| 2 | `fs-rm-rf-wildcard` | **CRITICAL** | `rm -rf .` / `rm -rf *` / `rm -rf /*` |
| 3 | `fs-chmod-777` | **HIGH** | `chmod 777` dangerous permissions |
| 4 | `fs-mkfs` | **CRITICAL** | `mkfs` format filesystem |
| 5 | `fs-dd-device` | **CRITICAL** | `dd of=/dev/...` write to block device |

### 5.2 Code Execution — code-execution (4 Rules)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 6 | `exec-curl-pipe` | **CRITICAL** | `curl ... \| bash/sh/python` remote code execution |
| 7 | `exec-wget-pipe` | **CRITICAL** | `wget ... \| bash/sh/python` remote code execution |
| 8 | `exec-eval` | **HIGH** | `eval()` dynamic code execution |
| 9 | `exec-base64-decode-pipe` | **CRITICAL** | `base64 -d \| bash` decode and execute |

### 5.3 Credential Access — credential-access (4 Rules)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 10 | `cred-env-read` | **HIGH** | Read `.env` files |
| 11 | `cred-private-key` | **HIGH** | Read `id_rsa` / `.pem` / `private_key` |
| 12 | `cred-aws-credentials` | **HIGH** | Read `.aws/credentials` / `.aws/config` |
| 13 | `cred-secret-env-var` | **HIGH** | echo `$AWS_SECRET` / `$API_KEY` / `$DB_PASSWORD` |

### 5.4 Network Exfiltration — network-exfil (2 Rules)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 14 | `net-curl-post-data` | **MEDIUM** | `curl -X POST -d` send data externally |
| 15 | `net-exfil-to-ip` | **HIGH** | `curl/wget/nc` send to raw IP address |

### 5.5 Git Destructive — git-destructive (3 Rules)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 16 | `git-force-push` | **HIGH** | `git push --force` / `git push -f` |
| 17 | `git-reset-hard` | **HIGH** | `git reset --hard` |
| 18 | `git-clean-force` | **MEDIUM** | `git clean -f` |

### 5.6 Package Publishing — package-publish (2 Rules)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 19 | `pkg-npm-publish` | **MEDIUM** | `npm publish` |
| 20 | `pkg-pip-upload` | **MEDIUM** | `twine upload` / `pip upload` |

### 5.7 System Configuration — system-config (3 Rules)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 21 | `sys-sudo` | **MEDIUM** | `sudo` privilege escalation |
| 22 | `sys-iptables` | **MEDIUM** | `iptables` firewall modification |
| 23 | `sys-systemctl` | **MEDIUM** | `systemctl start/stop/enable/disable/restart` |

### 5.8 File Deletion — file-delete (1 Rule)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 24 | `fs-rm` | **MEDIUM** | `rm` delete files/directories |

### 5.9 Sensitive Path Writes — file-write-outside (2 Rules)

| # | Rule ID | Severity | Detection Target |
|---|---------|:--------:|-----------------|
| 25 | `write-etc` | **LOW** | Write to `/etc/` system config directory |
| 26 | `write-usr` | **LOW** | Write to `/usr/` system binaries directory |

---

## 6. Statistics Summary

### Rule Counts

| Category | Count |
|----------|:-----:|
| DLP High-Confidence | 19 |
| DLP Validated | 2 |
| DLP Context-Aware | 5 |
| DLP Entropy Detection | 1 layer (automatic) |
| DLP Semantic Analysis | 16 sensitive field patterns + 45 exclusions |
| Prompt Injection | 36 |
| Tool Guard | 26 |
| **Total** | **~105 detection rules** |

### Tool Guard Severity Distribution

| Severity | Count |
|----------|:-----:|
| CRITICAL | 6 |
| HIGH | 8 |
| MEDIUM | 10 |
| LOW | 2 |

### OWASP Coverage

| OWASP ID | Threat | Bastion Coverage |
|----------|--------|:----------------:|
| LLM01 | Prompt Injection | DLP Scanner (36 PI rules) |
| LLM02 | Sensitive Information Disclosure | DLP Scanner (5-layer pipeline) |
| LLM05 | Improper Output Handling | Tool Guard |
| LLM06 | Excessive Agency | Tool Guard |
| LLM07 | System Prompt Leakage | DLP (partial coverage) |
| LLM10 | Unbounded Consumption | Metrics (detection only) |
| ASI02 | Tool Misuse & Exploitation | Tool Guard |
| ASI05 | Unexpected Code Execution | Tool Guard |
| ASI09 | Human-Agent Trust Exploitation | Audit Logger |
| ASI10 | Rogue Agents | Audit + Tool Guard |

---

## 7. Configuration Reference

```yaml
plugins:
  dlp:
    enabled: true
    action: "warn"                      # pass | warn | redact | block
    patterns:
      - "high-confidence"
      - "validated"
      - "context-aware"
      - "prompt-injection"
    remotePatterns:
      url: "https://github.com/aiwatching/bastion_signature.git"
      branch: "auto"
      syncOnStart: true
      syncIntervalMinutes: 0
    aiValidation:
      enabled: false
      provider: "anthropic"             # anthropic | openai
      model: "claude-haiku-4-5-20241022"
      apiKey: ""
      timeoutMs: 5000
      cacheSize: 500
    semantics:
      sensitivePatterns: []             # Custom sensitive field names
      nonSensitiveNames: []             # Custom exclusion field names

  toolGuard:
    enabled: true
    action: "audit"                     # audit | block
    recordAll: true
    blockMinSeverity: "critical"
    alertMinSeverity: "high"
    alertDesktop: true
    alertWebhookUrl: ""

  audit:
    enabled: true
    rawData: true
    rawMaxBytes: 524288                 # 512 KB
    summaryMaxBytes: 1024

retention:
  requestsHours: 720                   # 30 days
  dlpEventsHours: 720
  toolCallsHours: 720
  auditLogHours: 24                    # 1 day
```

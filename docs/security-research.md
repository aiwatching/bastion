[English](security-research.md) | [中文](security-research.zh.md)

# AI Agent Security Research & Bastion Capabilities

> Research date: February 2026. This document surveys the current AI agent security landscape and maps Bastion's existing capabilities against known threats.

## Table of Contents

- [1. Threat Landscape](#1-threat-landscape)
  - [1.1 Real-World Security Incidents](#11-real-world-security-incidents)
  - [1.2 OWASP Top 10 for LLM Applications (2025)](#12-owasp-top-10-for-llm-applications-2025)
  - [1.3 OWASP Top 10 for Agentic Applications (2026)](#13-owasp-top-10-for-agentic-applications-2026)
- [2. Key Attack Vectors](#2-key-attack-vectors)
  - [2.1 Prompt Injection](#21-prompt-injection)
  - [2.2 Tool Use & MCP Security](#22-tool-use--mcp-security)
  - [2.3 Data Exfiltration](#23-data-exfiltration)
  - [2.4 Supply Chain Attacks](#24-supply-chain-attacks)
- [3. Bastion Current Capabilities](#3-bastion-current-capabilities)
  - [3.1 Coverage Matrix](#31-coverage-matrix)
  - [3.2 DLP Scanner — Data Leakage Prevention](#32-dlp-scanner--data-leakage-prevention)
  - [3.3 Tool Guard — Tool Call Monitoring & Blocking](#33-tool-guard--tool-call-monitoring--blocking)
  - [3.4 Audit Logger — Encrypted Forensic Trail](#34-audit-logger--encrypted-forensic-trail)
  - [3.5 Metrics & Cost Tracking](#35-metrics--cost-tracking)
  - [3.6 OpenClaw Integration Security](#36-openclaw-integration-security)
- [4. Known Gaps & Planned Features](#4-known-gaps--planned-features)
  - [4.1 Gap Analysis](#41-gap-analysis)
  - [4.2 Competitive Comparison](#42-competitive-comparison)
  - [4.3 Roadmap Priorities](#43-roadmap-priorities)
- [5. Design Principles](#5-design-principles)
- [References](#references)

---

## 1. Threat Landscape

### 1.1 Real-World Security Incidents

AI coding agents and AI-powered tools have been involved in several high-profile security incidents since 2025:

**Cursor IDE — CurXecute & MCPoison (CVE-2025-54135, CVE-2025-54136)**
An externally-hosted prompt injection could rewrite `~/.cursor/mcp.json` to enable remote code execution. Once an MCP tool was approved, attackers could repeatedly inject malicious commands without user awareness. A separate case-sensitivity flaw (CVE-2025-59944) allowed bypassing file protections.

**GitHub Copilot — YOLO Mode RCE (CVE-2025-53773, CVSS 7.8)**
Malicious instructions embedded in source code comments or GitHub issues could set `"chat.tools.autoApprove": true` in `.vscode/settings.json`, disabling all user confirmations. Payloads used invisible Unicode characters to evade detection.

**Rules File Backdoor (March 2025)**
Pillar Security discovered that hidden instructions in `.cursorrules` and `.github/copilot-instructions.md` files could silently influence all AI code generation for every developer on a project. Survives forking and propagates downstream.

**GTG-1002 AI-Orchestrated Espionage (September 2025)**
Anthropic disclosed a Chinese state-sponsored group that used Claude Code as an autonomous operator, targeting 30 entities. The AI executed 80-90% of tactical operations independently.

**GitHub MCP Vulnerability (May 2025)**
Malicious commands embedded in public repository Issues could hijack developers' AI agents, enabling exfiltration of private repository source code and cryptographic keys.

### 1.2 OWASP Top 10 for LLM Applications (2025)

| ID | Threat | Bastion Coverage |
|----|--------|:---:|
| LLM01 | Prompt Injection | Planned |
| LLM02 | Sensitive Information Disclosure | **DLP Scanner** |
| LLM03 | Supply Chain (plugins, packages) | Partial |
| LLM04 | Data Poisoning | — |
| LLM05 | Improper Output Handling | **Tool Guard** |
| LLM06 | Excessive Agency | **Tool Guard** |
| LLM07 | System Prompt Leakage | DLP (partial) |
| LLM08 | Vector & Embedding Weaknesses | — |
| LLM09 | Misinformation | — |
| LLM10 | Unbounded Consumption | Metrics (detection only) |

### 1.3 OWASP Top 10 for Agentic Applications (2026)

Released December 2025, peer-reviewed by 100+ experts, specifically for autonomous AI agent systems:

| ID | Threat | Bastion Coverage |
|----|--------|:---:|
| ASI01 | Agent Goal Hijack | Planned |
| ASI02 | Tool Misuse & Exploitation | **Tool Guard** |
| ASI03 | Identity & Privilege Abuse | — |
| ASI04 | Agentic Supply Chain Vulnerabilities | Partial (DLP signatures) |
| ASI05 | Unexpected Code Execution | **Tool Guard** |
| ASI06 | Memory & Context Poisoning | — |
| ASI07 | Insecure Inter-Agent Communication | — |
| ASI08 | Cascading Failures | — |
| ASI09 | Human-Agent Trust Exploitation | **Audit Logger** |
| ASI10 | Rogue Agents | **Audit + Tool Guard** |

---

## 2. Key Attack Vectors

### 2.1 Prompt Injection

**Current state: all known defenses can be bypassed.** A landmark ACL NAACL 2025 paper evaluated eight defenses against indirect prompt injection and bypassed all of them, consistently achieving attack success rates over 50%.

Key attack types:
- **Direct injection** — Crafted user inputs override system instructions
- **Indirect injection** — Malicious content in external data (web pages, emails, documents, GitHub issues)
- **Multimodal injection** — Instructions hidden in images
- **Tool-mediated injection** — Malicious content returned by MCP servers or APIs

**The "Agents Rule of Two" (Meta AI, November 2025):** An agent must satisfy no more than two of: (1) process untrusted inputs, (2) access sensitive data, (3) change external state. If all three are needed, human-in-the-loop is required.

> This principle directly supports Bastion's Tool Guard design — monitoring and controlling the "change external state" dimension.

### 2.2 Tool Use & MCP Security

The MCP ecosystem has emerged as a critical attack surface with 11 identified risk categories:

- **The "God-Mode" problem** — MCP tools come with significant, unvetted privileges. The agent acts as a "privileged deputy."
- **Supply chain "rug pull"** — A previously trusted MCP tool can be updated with malicious code overnight.
- **Privilege escalation** — In multi-agent systems, a low-privilege agent can trick a higher-privilege agent into performing unauthorized actions (documented in a real ServiceNow incident).
- **Audit gap** — The MCP ecosystem lacks standardized audit logging, making forensic analysis nearly impossible.

Known CVEs:
- Anthropic Git MCP (CVE-2025-68143/68145/68144) — `git_init` could create repos in `~/.ssh`, enabling SSH key exfiltration
- Microsoft 365 Copilot "EchoLeak" (CVE-2025-32711) — Hidden prompts in Word documents caused silent data exfiltration

### 2.3 Data Exfiltration

- **77% of enterprise employees** who use AI have pasted company data into chatbot queries
- **22% of those instances** included confidential personal or financial data
- The fastest AI-assisted intrusions now reach exfiltration in as little as **4 minutes**
- **Zero-click exfiltration** — Hidden instructions in images/documents trigger data exfiltration without user interaction

### 2.4 Supply Chain Attacks

**Slopsquatting:** LLMs hallucinate non-existent but plausible package names. Of 756,000 AI-generated code samples, ~20% recommended non-existent packages. 43% of hallucinated packages were consistent across queries, making them predictable targets for attackers to pre-register with malicious payloads.

**Rules file poisoning:** Configuration files committed to repositories silently influence all AI code generation, propagating through forks and affecting entire teams.

---

## 3. Bastion Current Capabilities

### 3.1 Coverage Matrix

| Security Domain | Feature | Status | Mode |
|-----------------|---------|--------|------|
| Data Leakage Prevention | DLP Scanner (5-layer pipeline) | **Shipped** | Bidirectional |
| | Remote signature sync | **Shipped** | Auto-update |
| | AI validation (LLM false-positive filtering) | **Shipped** | Optional |
| | Generic secret detection (entropy + semantics) | **Shipped** | Always-on |
| Tool Call Security | Tool Guard (26 built-in rules) | **Shipped** | Audit / Block |
| | Streaming SSE interception | **Shipped** | Real-time |
| | Custom rules via Dashboard | **Shipped** | Hot-reload |
| | Desktop notifications + webhook alerts | **Shipped** | Configurable |
| Audit & Forensics | Encrypted audit log (AES-256-GCM) | **Shipped** | Always-on for DLP hits |
| | Session-based timeline | **Shipped** | Dashboard |
| | Full request/response capture | **Shipped** | Configurable |
| Cost Control | Per-provider/model/session metrics | **Shipped** | Always-on |
| | Cost calculation with pricing table | **Shipped** | Always-on |
| Caching & Optimization | Response cache (AES-256-GCM encrypted) | **Shipped** | Optional |
| | Whitespace trimming | **Shipped** | Optional |
| OpenClaw Integration | Proxy injection (Docker + local) | **Shipped** | Automatic |
| | Messaging platform DLP (Telegram/Discord/Slack) | **Shipped** | Bidirectional |
| | DLP alert push (cron-based skill) | **Shipped** | Polling |

### 3.2 DLP Scanner — Data Leakage Prevention

Addresses **OWASP LLM02 (Sensitive Information Disclosure)** and **LLM07 (System Prompt Leakage)**.

**Architecture:** 5-layer detection pipeline:

| Layer | Name | Description |
|-------|------|-------------|
| L0 | Structure Parser | Extracts key-value pairs from JSON, YAML, XML, .env formats |
| L1 | Entropy Filter | Shannon entropy scoring to detect high-randomness secrets |
| L2 | Regex Matcher | 20+ built-in patterns (AWS keys, GitHub PATs, credit cards, etc.) |
| L3 | Semantic Analyzer | Field-name sensitivity detection (`password`, `secret`, `api_key`) |
| L4 | AI Validator | Optional LLM-based false-positive filtering with LRU cache |

**Bidirectional scanning:** Both outgoing requests (user → LLM) and incoming responses (LLM → user) are inspected. Non-streaming responses can be blocked/redacted before reaching the client. Streaming responses are scanned post-send (detection + audit).

**Remote signatures:** DLP patterns can be synced from a remote Git repository with independent versioning, automatic update detection, and changelog tracking.

**Action modes:** `pass` | `warn` | `redact` | `block`

### 3.3 Tool Guard — Tool Call Monitoring & Blocking

Addresses **OWASP LLM05 (Improper Output Handling)**, **LLM06 (Excessive Agency)**, **ASI02 (Tool Misuse)**, and **ASI05 (Unexpected Code Execution)**.

**Multi-provider support:** Inspects tool calls across Anthropic (`tool_use`), OpenAI (`tool_calls`), and Gemini (`functionCall`) response formats.

**26 built-in rules** across 9 categories:

| Category | Examples | Severity |
|----------|----------|----------|
| destructive-fs | `rm -rf /`, `mkfs`, `dd of=/dev/` | critical |
| code-execution | `curl | bash`, `eval()`, base64 decode+execute | critical / high |
| credential-access | Read `.env`, private keys, AWS credentials | high |
| network-exfil | `curl POST` to external, data transfer to raw IP | medium / high |
| git-destructive | `git push --force`, `git reset --hard` | high / medium |
| package-publish | `npm publish`, `twine upload` | medium |
| system-config | `sudo`, `iptables`, `systemctl` | medium |
| file-delete | `rm` | medium |
| file-write-outside | Write to `/etc/`, `/usr/` | low |

**Streaming interception:** For streaming responses (SSE), a `StreamingToolGuard` buffers tool_use blocks, evaluates them against rules before forwarding, and replaces dangerous calls with text warnings — all in real-time without breaking the SSE stream.

**Action modes:** `audit` (record only) | `block` (real-time interception)

**Configurable severity threshold:** `blockMinSeverity` controls the minimum severity level that triggers blocking.

### 3.4 Audit Logger — Encrypted Forensic Trail

Addresses **ASI09 (Human-Agent Trust Exploitation)** and **ASI10 (Rogue Agents)** by providing a complete forensic trail.

- **AES-256-GCM encryption** at rest for all stored request/response content
- **Automatic DLP tagging** — Any DLP hit creates an audit entry regardless of Audit Logger plugin state
- **Tool Guard tagging** — Flagged tool calls are marked in audit entries
- **Session-based timeline** — Dashboard groups audit entries by session for investigation
- **Configurable retention** with automatic purge

### 3.5 Metrics & Cost Tracking

Partial coverage for **OWASP LLM10 (Unbounded Consumption)**:

- Per-request recording: provider, model, input/output tokens, cost, latency
- Per-session and per-API-key aggregation
- Dashboard visualization with per-provider/model/session breakdowns

> **Gap:** Currently detection-only. No budget caps, rate limiting, or automatic blocking when spending exceeds a threshold.

### 3.6 OpenClaw Integration Security

**Proxy injection:** Bastion automatically configures OpenClaw instances (Docker and local) to route all LLM and messaging traffic through the gateway. A runtime monkey-patch (`proxy-bootstrap.mjs`) intercepts `fetch` and `https.globalAgent` to ensure coverage.

**Messaging platform DLP:** Traffic to Telegram, Discord, Slack, WhatsApp, and LINE APIs is intercepted and scanned by the DLP pipeline. Bot tokens in URL paths are automatically redacted in logs.

**DLP alert push:** A cron-based OpenClaw skill polls the Bastion DLP API and pushes findings to configured notification channels (Telegram, Discord, Slack).

**Known limitations:**
- The proxy-bootstrap monkey-patch can be bypassed if dependencies use `undici` directly or create new `https.Agent` instances
- Non-Node.js subprocesses inside Docker containers won't trust the Bastion CA certificate (only `NODE_EXTRA_CA_CERTS` is set)

---

## 4. Known Gaps & Planned Features

### 4.1 Gap Analysis

| Gap | Severity | OWASP Mapping | Notes |
|-----|----------|---------------|-------|
| **No API/Dashboard authentication** | Critical | — | Any process on the host can read audit logs, modify config, disable plugins |
| **No rate limiting or budget caps** | High | LLM10, ASI08 | No spending limits; unbounded consumption possible |
| **No prompt injection detection** | High | LLM01, ASI01, ASI06 | No scanning for injection patterns in requests or responses |
| **Fail-open on plugin errors** | Medium | ASI08 | Uncaught exceptions continue processing; no fail-closed option |
| **No API key management** | Medium | ASI03 | No whitelist, quota, rotation, or anomaly detection for API keys |
| **Polling requests skip DLP** | Medium | LLM02 | Telegram `getUpdates` etc. are exempted from scanning; responses may contain sensitive user messages |
| **GET requests bypass plugin pipeline** | Low | LLM02 | Non-POST requests are forwarded directly without plugin processing |

### 4.2 Competitive Comparison

| Feature | Bastion | LiteLLM | Portkey.ai | Helicone |
|---------|:-------:|:-------:|:----------:|:--------:|
| DLP scanning | 5-layer + remote signatures | Presidio (basic) | Basic guardrails | — |
| Tool call monitoring | 26 rules + streaming block | — | — | — |
| Audit encryption | AES-256-GCM | — | Cloud-managed | Cloud-managed |
| Rate limiting | **—** | Per-key | Per-user/team | Per-key |
| API authentication | **—** | API key | OAuth + RBAC | API key |
| Budget caps | **—** | Per-key budgets | Per-app budgets | Per-key |
| Prompt injection guard | **—** | — | Guardrails | — |
| Multi-tenant | Session-level only | Virtual keys | Organizations | Yes |
| Local-first | **Core advantage** | Optional | SaaS only | SaaS only |
| Open source | **Yes** | Yes | Partial | No |

**Bastion's differentiators:** Local-first architecture, deep DLP with 5-layer pipeline, Tool Guard with real-time streaming interception, encrypted audit trail. These are unique capabilities not found in any competitor.

**Key gaps vs. competitors:** Authentication, rate limiting, budget caps — foundational infrastructure that competitors all provide.

### 4.3 Roadmap Priorities

#### P0 — Foundation

| Feature | Description | Complexity |
|---------|-------------|:----------:|
| API authentication | Bearer token auth for all `/api/*` and `/dashboard` endpoints | Low |
| Rate limiting | Sliding-window per session/key; configurable limits for LLM requests and API endpoints | Medium |
| Budget caps & alerts | Per-session/key spending limits with warning and hard-stop thresholds | Medium |
| Fail-closed mode | `failMode: closed` option — reject requests when plugin pipeline errors | Low |

#### P1 — Threat Detection

| Feature | Description | Complexity |
|---------|-------------|:----------:|
| Prompt injection detection | Pattern-based detection of known injection techniques in requests and responses; integration with DLP pipeline as L5 layer | Medium |
| API key management | Whitelist, per-key quotas, anomaly detection (sudden provider switch, burst usage) | Medium |
| OpenClaw device pairing audit | Configurable auto-approve with `--auto-approve` flag; default to manual confirmation | Low |

#### P2 — Defense in Depth

| Feature | Description | Complexity |
|---------|-------------|:----------:|
| Session-level security policies | Different DLP/Tool Guard strictness per OpenClaw instance or session | Medium |
| Messaging platform DLP enhancement | Full DLP scanning of polling responses (Telegram `getUpdates`, etc.) | Medium |
| OpenClaw-specific Tool Guard rules | Detect agent self-modification (config files, cron jobs, devices directory) | Low |
| Request source verification | HMAC signing between Bastion and OpenClaw to prevent spoofing | Medium |

#### P3 — Enterprise

| Feature | Description | Complexity |
|---------|-------------|:----------:|
| Audit log integrity (chain hashing) | Each record includes hash of previous record; tamper-evident | Medium |
| SIEM/log export | Syslog, Splunk, Elasticsearch integration | Medium |
| Network isolation detection | Alert on non-whitelisted outbound connections | High |
| Multi-tenant isolation | Per-instance DB partitions, config spaces, access control | High |

---

## 5. Design Principles

Bastion's security architecture follows these principles:

1. **Local-first** — All data stays on the user's machine. No cloud dependencies, no third-party data sharing. This is the fundamental trust model.

2. **Defense in depth** — Multiple overlapping layers (DLP + Tool Guard + Audit). No single point of failure in the detection pipeline.

3. **Fail-open by default, fail-closed optional** — Currently fail-open to avoid disrupting workflows. A fail-closed mode is planned for high-security environments.

4. **Transparency** — Every detection, block, and audit action is logged and visible in the Dashboard. Users always know what Bastion did and why.

5. **Hot-reload** — Security policies (DLP patterns, Tool Guard rules, action modes) can be changed at runtime without restarting the gateway.

6. **Agent-agnostic** — Works with any AI agent (Claude Code, Cursor, OpenClaw, custom apps) that makes HTTPS requests to supported LLM providers.

---

## References

### Standards & Frameworks
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [Meta AI: Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/)

### Incidents & CVEs
- [Tenable: CurXecute & MCPoison (Cursor)](https://www.tenable.com/blog/faq-cve-2025-54135-cve-2025-54136-vulnerabilities-in-cursor-curxecute-mcpoison)
- [Embrace The Red: GitHub Copilot RCE](https://embracethered.com/blog/posts/2025/github-copilot-remote-code-execution-via-prompt-injection/)
- [Pillar Security: Rules File Backdoor](https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents)
- [Lakera: Cursor CVE-2025-59944](https://www.lakera.ai/blog/cursor-vulnerability-cve-2025-59944)
- [Anthropic: GTG-1002 Disclosure](https://assets.anthropic.com/m/ec212e6566a0d47/original/Disrupting-the-first-reported-AI-orchestrated-cyber-espionage-campaign.pdf)

### Research
- [ACL NAACL 2025: Adaptive Attacks Break Defenses](https://aclanthology.org/2025.findings-naacl.395/)
- [arXiv: Fault-Tolerant Sandboxing for AI Coding Agents](https://arxiv.org/abs/2512.12806)
- [arXiv: CELLMATE — Sandboxing Browser AI Agents](https://arxiv.org/abs/2512.12594)
- [Checkmarx: 11 MCP Security Risks](https://checkmarx.com/zero-post/11-emerging-ai-security-risks-with-mcp-model-context-protocol/)
- [Microsoft: Copilot Studio Agent Security Top 10](https://www.microsoft.com/en-us/security/blog/2026/02/12/copilot-studio-agent-security-top-10-risks-detect-prevent/)

### Industry Analysis
- [CrowdStrike 2026 Global Threat Report](https://www.bisinfotech.com/crowdstrike-2026-global-threat-report-ai-accelerates-adversaries-and-reshapes-the-attack-surface/)
- [Trend Micro: Slopsquatting](https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/slopsquatting-when-ai-agents-hallucinate-malicious-packages)
- [CSA: How to Build AI Prompt Guardrails](https://cloudsecurityalliance.org/blog/2025/12/10/how-to-build-ai-prompt-guardrails-an-in-depth-guide-for-securing-enterprise-genai)

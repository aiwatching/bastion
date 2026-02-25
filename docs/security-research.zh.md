[English](security-research.md) | **中文**

# AI Agent 安全调研与 Bastion 能力分析

> 调研时间：2026 年 2 月。本文梳理当前 AI Agent 安全态势，并将 Bastion 已有能力与已知威胁进行映射。

## 目录

- [1. 威胁态势](#1-威胁态势)
  - [1.1 真实安全事件](#11-真实安全事件)
  - [1.2 OWASP LLM 应用 Top 10 (2025)](#12-owasp-llm-应用-top-10-2025)
  - [1.3 OWASP Agent 应用 Top 10 (2026)](#13-owasp-agent-应用-top-10-2026)
- [2. 主要攻击向量](#2-主要攻击向量)
  - [2.1 Prompt 注入](#21-prompt-注入)
  - [2.2 工具调用与 MCP 安全](#22-工具调用与-mcp-安全)
  - [2.3 数据泄露](#23-数据泄露)
  - [2.4 供应链攻击](#24-供应链攻击)
- [3. Bastion 当前能力](#3-bastion-当前能力)
  - [3.1 覆盖矩阵](#31-覆盖矩阵)
  - [3.2 DLP Scanner — 数据泄露防护](#32-dlp-scanner--数据泄露防护)
  - [3.3 Tool Guard — 工具调用监控与阻断](#33-tool-guard--工具调用监控与阻断)
  - [3.4 Audit Logger — 加密审计日志](#34-audit-logger--加密审计日志)
  - [3.5 指标与费用追踪](#35-指标与费用追踪)
  - [3.6 OpenClaw 集成安全](#36-openclaw-集成安全)
- [4. 已知缺口与规划功能](#4-已知缺口与规划功能)
  - [4.1 缺口分析](#41-缺口分析)
  - [4.2 竞品对比](#42-竞品对比)
  - [4.3 路线图优先级](#43-路线图优先级)
- [5. 设计原则](#5-设计原则)
- [参考资料](#参考资料)

---

## 1. 威胁态势

### 1.1 真实安全事件

2025 年以来，AI 编程助手和 AI 工具已卷入多起高知名度安全事件：

**Cursor IDE — CurXecute 与 MCPoison（CVE-2025-54135、CVE-2025-54136）**
外部托管的 prompt 注入可改写 `~/.cursor/mcp.json`，实现远程代码执行。一旦 MCP 工具被批准，攻击者可在用户毫不知情的情况下反复注入恶意命令。另一个大小写敏感缺陷（CVE-2025-59944）允许绕过文件保护。

**GitHub Copilot — YOLO 模式 RCE（CVE-2025-53773，CVSS 7.8）**
嵌入在源代码注释或 GitHub Issue 中的恶意指令可将 `"chat.tools.autoApprove": true` 写入 `.vscode/settings.json`，禁用所有用户确认。攻击载荷使用不可见 Unicode 字符规避检测。

**规则文件后门（2025 年 3 月）**
Pillar Security 发现，隐藏在 `.cursorrules` 和 `.github/copilot-instructions.md` 中的恶意指令可以悄无声息地影响项目中所有开发者的 AI 代码生成。这种后门可以跨 fork 传播。

**GTG-1002 AI 编排的网络间谍活动（2025 年 9 月）**
Anthropic 披露了一个中国国家支持的组织利用 Claude Code 作为自主操作员，针对 30 个实体发起攻击。AI 独立执行了 80-90% 的战术操作。

**GitHub MCP 漏洞（2025 年 5 月）**
嵌入在公共仓库 Issue 中的恶意命令可劫持开发者的 AI Agent，泄露私有仓库源代码和加密密钥。

### 1.2 OWASP LLM 应用 Top 10 (2025)

| ID | 威胁 | Bastion 覆盖 |
|----|------|:---:|
| LLM01 | Prompt 注入 | 规划中 |
| LLM02 | 敏感信息泄露 | **DLP Scanner** |
| LLM03 | 供应链（插件、包） | 部分 |
| LLM04 | 数据投毒 | — |
| LLM05 | 不当输出处理 | **Tool Guard** |
| LLM06 | 过度授权 | **Tool Guard** |
| LLM07 | 系统提示词泄露 | DLP（部分） |
| LLM08 | 向量与嵌入弱点 | — |
| LLM09 | 错误信息 | — |
| LLM10 | 无限制消耗 | 指标（仅检测） |

### 1.3 OWASP Agent 应用 Top 10 (2026)

2025 年 12 月发布，由 100+ 专家评审，专门针对自主 AI Agent 系统：

| ID | 威胁 | Bastion 覆盖 |
|----|------|:---:|
| ASI01 | Agent 目标劫持 | 规划中 |
| ASI02 | 工具滥用与利用 | **Tool Guard** |
| ASI03 | 身份与权限滥用 | — |
| ASI04 | Agent 供应链漏洞 | 部分（DLP 签名库） |
| ASI05 | 非预期代码执行 | **Tool Guard** |
| ASI06 | 内存与上下文投毒 | — |
| ASI07 | Agent 间不安全通信 | — |
| ASI08 | 级联故障 | — |
| ASI09 | 人类对 Agent 的过度信任 | **Audit Logger** |
| ASI10 | 失控 Agent | **Audit + Tool Guard** |

---

## 2. 主要攻击向量

### 2.1 Prompt 注入

**当前状态：所有已知防御都可被绕过。** ACL NAACL 2025 的一篇里程碑论文评估了 8 种间接 prompt 注入防御方案，全部被自适应攻击突破，攻击成功率始终超过 50%。

主要攻击类型：
- **直接注入** — 精心设计的用户输入覆盖系统指令
- **间接注入** — 外部数据中的恶意内容（网页、邮件、文档、GitHub Issue）
- **多模态注入** — 图片中隐藏的指令
- **工具介导注入** — MCP 服务器或 API 返回的恶意内容

**"Agent 二选二规则"（Meta AI，2025 年 11 月）：** Agent 最多只能同时满足以下三个属性中的两个：（1）处理不可信输入、（2）访问敏感数据、（3）改变外部状态。如果三个都需要，必须有人类在回路中审批。

> 这一原则直接支持了 Bastion Tool Guard 的设计思路——监控和控制"改变外部状态"这一维度。

### 2.2 工具调用与 MCP 安全

MCP 生态已成为关键攻击面，已识别出 11 类风险：

- **"上帝模式"问题** — MCP 工具带有大量未经审核的权限，Agent 充当"特权代理人"
- **供应链"跑路"风险** — 之前可信的 MCP 工具可能一夜之间被更新为恶意代码
- **权限提升** — 在多 Agent 系统中，低权限 Agent 可欺骗高权限 Agent 执行未授权操作（ServiceNow 实际事件已证实）
- **审计缺口** — MCP 生态缺乏标准化审计日志，事后取证几乎不可能

已知 CVE：
- Anthropic Git MCP（CVE-2025-68143/68145/68144）— `git_init` 可在 `~/.ssh` 创建仓库，泄露 SSH 密钥
- Microsoft 365 Copilot "EchoLeak"（CVE-2025-32711）— Word 文档中的隐藏提示词导致静默数据泄露

### 2.3 数据泄露

- **77% 的企业员工**将公司数据粘贴到 AI 聊天工具中
- **22% 的案例**涉及机密个人或财务数据
- 最快的 AI 辅助入侵从发起到数据泄露仅需 **4 分钟**
- **零点击泄露** — 图片/文档中的隐藏指令在无用户交互的情况下触发数据泄露

### 2.4 供应链攻击

**Slopsquatting（虚假包攻击）：** LLM 会幻觉出不存在但看似合理的包名。在 756,000 个 AI 生成的代码样本中，约 20% 推荐了不存在的包。43% 的幻觉包名在多次查询中保持一致，使攻击者可以预测性地预注册恶意包。

**规则文件投毒：** 提交到仓库的配置文件会悄无声息地影响所有 AI 代码生成，通过 fork 传播，影响整个团队。

---

## 3. Bastion 当前能力

### 3.1 覆盖矩阵

| 安全领域 | 功能 | 状态 | 模式 |
|---------|------|------|------|
| 数据泄露防护 | DLP Scanner（5 层检测管线） | **已发布** | 双向 |
| | 远程签名库同步 | **已发布** | 自动更新 |
| | AI 验证（LLM 误报过滤） | **已发布** | 可选 |
| | 通用密钥检测（熵 + 语义） | **已发布** | 常开 |
| 工具调用安全 | Tool Guard（26 条内置规则） | **已发布** | 审计 / 阻断 |
| | SSE 流式拦截 | **已发布** | 实时 |
| | Dashboard 自定义规则 | **已发布** | 热加载 |
| | 桌面通知 + Webhook 告警 | **已发布** | 可配置 |
| 审计与取证 | 加密审计日志（AES-256-GCM） | **已发布** | DLP 命中自动记录 |
| | 基于会话的时间线 | **已发布** | Dashboard |
| | 完整请求/响应捕获 | **已发布** | 可配置 |
| 费用控制 | 按提供商/模型/会话的指标 | **已发布** | 常开 |
| | 费用计算（含定价表） | **已发布** | 常开 |
| 缓存与优化 | 响应缓存（AES-256-GCM 加密） | **已发布** | 可选 |
| | 空白压缩 | **已发布** | 可选 |
| OpenClaw 集成 | 代理注入（Docker + 本地） | **已发布** | 自动 |
| | 消息平台 DLP（Telegram/Discord/Slack） | **已发布** | 双向 |
| | DLP 告警推送（cron 轮询技能） | **已发布** | 轮询 |

### 3.2 DLP Scanner — 数据泄露防护

覆盖 **OWASP LLM02（敏感信息泄露）** 和 **LLM07（系统提示词泄露）**。

**架构：** 5 层检测管线：

| 层级 | 名称 | 描述 |
|------|------|------|
| L0 | 结构解析器 | 从 JSON、YAML、XML、.env 格式中提取键值对 |
| L1 | 熵过滤器 | Shannon 熵评分，检测高随机性密钥 |
| L2 | 正则匹配器 | 20+ 内置模式（AWS 密钥、GitHub PAT、信用卡等） |
| L3 | 语义分析器 | 字段名敏感性检测（`password`、`secret`、`api_key`） |
| L4 | AI 验证器 | 可选的 LLM 误报过滤，带 LRU 缓存 |

**双向扫描：** 同时检查发出的请求（用户 → LLM）和收到的响应（LLM → 用户）。非流式响应可在到达客户端之前被阻止/脱敏。流式响应在发送后扫描（检测 + 审计）。

**远程签名库：** DLP 模式可从远程 Git 仓库同步，支持独立版本控制、自动更新检测和变更日志追踪。

**动作模式：** `pass` | `warn` | `redact` | `block`

### 3.3 Tool Guard — 工具调用监控与阻断

覆盖 **OWASP LLM05（不当输出处理）**、**LLM06（过度授权）**、**ASI02（工具滥用）** 和 **ASI05（非预期代码执行）**。

**多提供商支持：** 检查 Anthropic（`tool_use`）、OpenAI（`tool_calls`）和 Gemini（`functionCall`）响应格式中的工具调用。

**26 条内置规则**，覆盖 9 个类别：

| 类别 | 示例 | 严重级别 |
|------|------|----------|
| destructive-fs | `rm -rf /`、`mkfs`、`dd of=/dev/` | critical |
| code-execution | `curl \| bash`、`eval()`、base64 解码执行 | critical / high |
| credential-access | 读取 `.env`、私钥、AWS 凭证 | high |
| network-exfil | `curl POST` 到外部、向裸 IP 传输数据 | medium / high |
| git-destructive | `git push --force`、`git reset --hard` | high / medium |
| package-publish | `npm publish`、`twine upload` | medium |
| system-config | `sudo`、`iptables`、`systemctl` | medium |
| file-delete | `rm` | medium |
| file-write-outside | 写入 `/etc/`、`/usr/` | low |

**流式拦截：** 对于流式响应（SSE），`StreamingToolGuard` 缓冲 tool_use 块，在转发前评估规则，将危险调用替换为文本警告——全部实时完成，不中断 SSE 流。

**动作模式：** `audit`（仅记录）| `block`（实时拦截）

**可配置严重级别阈值：** `blockMinSeverity` 控制触发阻断的最低严重级别。

### 3.4 Audit Logger — 加密审计日志

覆盖 **ASI09（人类对 Agent 的过度信任）** 和 **ASI10（失控 Agent）**，提供完整的取证链。

- **AES-256-GCM 加密**存储所有请求/响应内容
- **自动 DLP 标记** — 任何 DLP 命中都会创建审计条目，无论 Audit Logger 插件是否启用
- **Tool Guard 标记** — 标记的工具调用在审计条目中有标识
- **基于会话的时间线** — Dashboard 按会话分组审计条目，便于调查
- **可配置保留期限**，自动清理

### 3.5 指标与费用追踪

部分覆盖 **OWASP LLM10（无限制消耗）**：

- 逐请求记录：提供商、模型、输入/输出 token、费用、延迟
- 按会话和 API Key 聚合
- Dashboard 可视化，按提供商/模型/会话分类统计

> **缺口：** 目前仅检测。无预算上限、速率限制或超额自动阻断。

### 3.6 OpenClaw 集成安全

**代理注入：** Bastion 自动配置 OpenClaw 实例（Docker 和本地），将所有 LLM 和消息平台流量路由通过网关。运行时 monkey-patch（`proxy-bootstrap.mjs`）拦截 `fetch` 和 `https.globalAgent` 确保覆盖。

**消息平台 DLP：** 到 Telegram、Discord、Slack、WhatsApp 和 LINE API 的流量被拦截并通过 DLP 管线扫描。URL 路径中的 Bot Token 在日志中自动脱敏。

**DLP 告警推送：** 基于 cron 的 OpenClaw 技能轮询 Bastion DLP API，将发现推送到配置的通知渠道（Telegram、Discord、Slack）。

**已知限制：**
- 如果依赖直接使用 `undici` 或创建新的 `https.Agent` 实例，proxy-bootstrap monkey-patch 会被绕过
- Docker 容器内的非 Node.js 子进程不会信任 Bastion CA 证书（仅设置了 `NODE_EXTRA_CA_CERTS`）

---

## 4. 已知缺口与规划功能

### 4.1 缺口分析

| 缺口 | 严重性 | OWASP 映射 | 说明 |
|------|--------|-----------|------|
| **Dashboard/API 无认证** | 严重 | — | 主机上任何进程都可读取审计日志、修改配置、禁用插件 |
| **无速率限制或预算上限** | 高 | LLM10, ASI08 | 无消费限制；可能被无限消耗 |
| **无 prompt 注入检测** | 高 | LLM01, ASI01, ASI06 | 不扫描请求或响应中的注入模式 |
| **插件出错时 fail-open** | 中 | ASI08 | 未捕获异常继续处理；无 fail-closed 选项 |
| **无 API Key 管理** | 中 | ASI03 | 无白名单、配额、轮换或异常检测 |
| **轮询请求跳过 DLP** | 中 | LLM02 | Telegram `getUpdates` 等被豁免扫描；响应可能包含敏感用户消息 |
| **GET 请求绕过插件管线** | 低 | LLM02 | 非 POST 请求直接转发，不经插件处理 |

### 4.2 竞品对比

| 功能 | Bastion | LiteLLM | Portkey.ai | Helicone |
|------|:-------:|:-------:|:----------:|:--------:|
| DLP 扫描 | 5 层 + 远程签名库 | Presidio（基础） | 基础 guardrails | — |
| 工具调用监控 | 26 规则 + 流式阻断 | — | — | — |
| 审计加密 | AES-256-GCM | — | 云端托管 | 云端托管 |
| 速率限制 | **—** | 按 Key | 按用户/团队 | 按 Key |
| API 认证 | **—** | API Key | OAuth + RBAC | API Key |
| 预算上限 | **—** | 按 Key 预算 | 按应用预算 | 按 Key |
| Prompt 注入防护 | **—** | — | Guardrails | — |
| 多租户 | 仅会话级 | 虚拟 Key | 组织级 | 支持 |
| 本地优先 | **核心优势** | 可选 | 仅 SaaS | 仅 SaaS |
| 开源 | **是** | 是 | 部分 | 否 |

**Bastion 差异化优势：** 本地优先架构、5 层 DLP 深度检测管线、Tool Guard 实时流式拦截、加密审计日志。这些是竞品中均不具备的独特能力。

**相比竞品的关键缺口：** 认证、速率限制、预算上限——竞品都具备的基础设施。

### 4.3 路线图优先级

#### P0 — 基础设施

| 功能 | 描述 | 复杂度 |
|------|------|:------:|
| API 认证 | 所有 `/api/*` 和 `/dashboard` 端点的 Bearer Token 认证 | 低 |
| 速率限制 | 按会话/Key 的滑动窗口；可配置 LLM 请求和 API 端点限制 | 中 |
| 预算上限与告警 | 按会话/Key 的消费限制，支持预警和硬性阈值 | 中 |
| Fail-closed 模式 | `failMode: closed` 选项——插件管线出错时拒绝请求 | 低 |

#### P1 — 威胁检测

| 功能 | 描述 | 复杂度 |
|------|------|:------:|
| Prompt 注入检测 | 基于模式的注入技术检测，集成到 DLP 管线作为 L5 层 | 中 |
| API Key 管理 | 白名单、按 Key 配额、异常检测（突然切换提供商、突发大量请求） | 中 |
| OpenClaw 设备配对审核 | 可配置自动批准（`--auto-approve` 标志）；默认需手动确认 | 低 |

#### P2 — 纵深防御

| 功能 | 描述 | 复杂度 |
|------|------|:------:|
| 会话级安全策略 | 不同 OpenClaw 实例或会话可配置不同 DLP/Tool Guard 严格程度 | 中 |
| 消息平台 DLP 增强 | 对轮询响应（Telegram `getUpdates` 等）进行完整 DLP 扫描 | 中 |
| OpenClaw 专用 Tool Guard 规则 | 检测 Agent 自我修改（配置文件、cron 任务、设备目录） | 低 |
| 请求来源验证 | Bastion 与 OpenClaw 间 HMAC 签名，防止伪装 | 中 |

#### P3 — 企业级

| 功能 | 描述 | 复杂度 |
|------|------|:------:|
| 审计日志完整性（链式哈希） | 每条记录包含前一条的哈希；防篡改 | 中 |
| SIEM/日志导出 | Syslog、Splunk、Elasticsearch 集成 | 中 |
| 网络隔离检测 | 非白名单出站连接告警 | 高 |
| 多租户隔离 | 按实例的 DB 分区、配置空间、访问控制 | 高 |

---

## 5. 设计原则

Bastion 的安全架构遵循以下原则：

1. **本地优先** — 所有数据留在用户机器上。无云依赖，无第三方数据共享。这是根本的信任模型。

2. **纵深防御** — 多层重叠（DLP + Tool Guard + Audit）。检测管线无单点故障。

3. **默认 fail-open，可选 fail-closed** — 当前默认 fail-open 以避免中断工作流。为高安全环境规划 fail-closed 模式。

4. **透明性** — 每一次检测、阻断和审计操作都记录日志并在 Dashboard 中可见。用户始终知道 Bastion 做了什么以及为什么。

5. **热加载** — 安全策略（DLP 模式、Tool Guard 规则、动作模式）可在运行时修改，无需重启网关。

6. **Agent 无关性** — 适用于任何发出 HTTPS 请求的 AI Agent（Claude Code、Cursor、OpenClaw、自定义应用）。

---

## 参考资料

### 标准与框架
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [Meta AI: Agents Rule of Two](https://ai.meta.com/blog/practical-ai-agent-security/)

### 事件与 CVE
- [Tenable: CurXecute & MCPoison (Cursor)](https://www.tenable.com/blog/faq-cve-2025-54135-cve-2025-54136-vulnerabilities-in-cursor-curxecute-mcpoison)
- [Embrace The Red: GitHub Copilot RCE](https://embracethered.com/blog/posts/2025/github-copilot-remote-code-execution-via-prompt-injection/)
- [Pillar Security: Rules File Backdoor](https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents)
- [Lakera: Cursor CVE-2025-59944](https://www.lakera.ai/blog/cursor-vulnerability-cve-2025-59944)
- [Anthropic: GTG-1002 Disclosure](https://assets.anthropic.com/m/ec212e6566a0d47/original/Disrupting-the-first-reported-AI-orchestrated-cyber-espionage-campaign.pdf)

### 学术研究
- [ACL NAACL 2025: Adaptive Attacks Break Defenses](https://aclanthology.org/2025.findings-naacl.395/)
- [arXiv: Fault-Tolerant Sandboxing for AI Coding Agents](https://arxiv.org/abs/2512.12806)
- [arXiv: CELLMATE — Sandboxing Browser AI Agents](https://arxiv.org/abs/2512.12594)
- [Checkmarx: 11 MCP Security Risks](https://checkmarx.com/zero-post/11-emerging-ai-security-risks-with-mcp-model-context-protocol/)
- [Microsoft: Copilot Studio Agent Security Top 10](https://www.microsoft.com/en-us/security/blog/2026/02/12/copilot-studio-agent-security-top-10-risks-detect-prevent/)

### 行业分析
- [CrowdStrike 2026 Global Threat Report](https://www.bisinfotech.com/crowdstrike-2026-global-threat-report-ai-accelerates-adversaries-and-reshapes-the-attack-surface/)
- [Trend Micro: Slopsquatting](https://www.trendmicro.com/vinfo/us/security/news/cybercrime-and-digital-threats/slopsquatting-when-ai-agents-hallucinate-malicious-packages)
- [CSA: How to Build AI Prompt Guardrails](https://cloudsecurityalliance.org/blog/2025/12/10/how-to-build-ai-prompt-guardrails-an-in-depth-guide-for-securing-enterprise-genai)

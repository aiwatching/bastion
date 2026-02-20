[English](dlp.md) | **中文**

# DLP 引擎 — 检测管线

Bastion 的 DLP 引擎采用分层漏斗（tiered funnel）架构，每一层只处理上一层传递下来的候选数据，逐层过滤，越往下越精确、越昂贵。

```
Input Text
    │
    ▼
┌──────────────────────┐
│  Layer 0: Structure  │  解析 JSON / 提取 key-value
│  (structure.ts)      │  输出: StructuredField[]
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Layer 1: Entropy    │  Shannon 熵计算，过滤低熵值
│  (entropy.ts)        │  阈值: >= 3.5 bits/char
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Layer 2: Regex      │  特定格式正则匹配
│  (patterns/*.ts)     │  high-confidence / validated / context-aware
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Layer 3: Semantics  │  字段名语义分析
│  (semantics.ts)      │  敏感字段 + 高熵值 → generic-secret
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Layer 4: AI         │  LLM 误报过滤（可选）
│  (ai-validator.ts)   │  Anthropic / OpenAI API
└──────────────────────┘
```

---

## Layer 0: Structure-aware Parsing

**文件**: `src/dlp/structure.ts`

解析输入文本的结构，提取 key-value 字段对。

### 处理方式

1. **JSON 解析** — 递归遍历 JSON 对象树，收集所有字符串值及其路径
   - 输入: `{"credentials": {"api_key": "sk-abc..."}}`
   - 输出: `{key: "api_key", path: "credentials.api_key", value: "sk-abc..."}`

2. **内联赋值提取** — 对长字符串内容（如 message content），扫描 `KEY=VALUE` 和 `KEY: VALUE` 模式
   - 输入: `"请设置 OPENAI_KEY=sk-abc123def456"`
   - 输出: `{key: "OPENAI_KEY", value: "sk-abc123def456"}`

3. **非 JSON 回退** — 输入不是合法 JSON 时，直接提取赋值模式

### 限制

- 最大文本 512KB，超过跳过结构分析
- 最小值长度 6 字符
- 内联赋值值最小 8 字符

---

## Layer 1: Entropy Pre-filter

**文件**: `src/dlp/entropy.ts`

计算字符串的 Shannon 信息熵，用于区分随机密钥和自然语言。

### Shannon 熵公式

```
H(X) = -Σ p(xᵢ) × log₂(p(xᵢ))
```

其中 `p(xᵢ)` 是字符 `xᵢ` 出现的频率。

### 典型熵值

| 类型 | 熵 (bits/char) | 示例 |
|------|----------------|------|
| 纯数字 | ~3.3 | `1234567890` |
| 英文文本 | ~3.5–4.0 | `the quick brown fox` |
| 十六进制 | ~3.7–4.0 | `a1b2c3d4e5f6a7b8` |
| API Key | ~4.5–5.5 | `sk-proj-abc123XYZ` |
| Base64 随机 | ~5.0–6.0 | `aGVsbG8gd29ybGQ=` |

### 参数

- **阈值**: `>= 3.5` bits/char（默认）
- **最小长度**: 8 字符
- **最大长度**: 200 字符（更长的通常是文本内容而非单个密钥）

---

## Layer 2: Regex Pattern Matching

**文件**: `src/dlp/engine.ts`, `src/dlp/patterns/*.ts`

使用正则表达式匹配已知格式的敏感数据。分为三个类别：

### high-confidence（高置信度）

极低误报率的模式，匹配即为敏感数据：

| 模式 | 描述 | 示例 |
|------|------|------|
| `aws-access-key` | AWS Access Key ID | `AKIA1234567890ABCDEF` |
| `github-token` | GitHub PAT | `ghp_xxxxxxxxxxxx...` |
| `openai-api-key` | OpenAI / DeepSeek 等 sk- 前缀 | `sk-proj-abc123...` |
| `anthropic-api-key` | Anthropic API Key | `sk-ant-abc123...` |
| `private-key` | PEM 私钥头 | `-----BEGIN PRIVATE KEY-----` |
| `password-assignment` | 密码/密钥赋值 | `password=hunter2` |
| ... | 更多 LLM 提供商 API Key | |

部分 high-confidence 模式仍需上下文确认（`requireContext`），如 `aws-secret-key` 需要附近出现 "aws" 或 "secret"。

### validated（结构验证）

正则匹配 + 算法验证：

| 模式 | 验证器 | 描述 |
|------|--------|------|
| `credit-card` | Luhn 校验 | Visa/MC/Amex/Discover |
| `ssn` | 区域/组号校验 | 美国社会安全号 |

### context-aware（上下文感知）

仅在附近（200 字符内）出现上下文关键词时才触发：

| 模式 | 上下文词 | 描述 |
|------|----------|------|
| `email-address` | email, contact, user... | 电子邮件 |
| `phone-number` | phone, call, tel... | 美国电话 |
| `ip-address` | ip, server, host... | IPv4 地址 |
| `drivers-license` | driver, license, DL... | 驾照号 |
| `passport-number` | passport | 护照号 |

### 超时保护

每个正则模式有 10ms 超时限制，防止 ReDoS。

---

## Layer 3: Field-name Semantics

**文件**: `src/dlp/semantics.ts`

利用 JSON 字段名的语义信息检测未被正则覆盖的通用密钥。

### 检测逻辑

当同时满足以下三个条件时，生成 `generic-secret` finding：

1. **敏感字段名** — 字段名匹配 `password`, `secret`, `token`, `api_key`, `auth`, `credential`, `private_key` 等模式
2. **高熵值** — 字段值的 Shannon 熵 >= 3.5 bits/char
3. **未被正则覆盖** — 该值没有被 Layer 2 的任何正则模式命中

### 示例

```json
{
  "my_custom_secret": "xK9#mP2$vL5@nR8!qW4&jB7"
}
```

- Layer 0 提取: `{key: "my_custom_secret", value: "xK9#mP2$vL5@nR8!qW4&jB7"}`
- Layer 1: 熵 = ~4.7 bits/char → 高熵
- Layer 2: 无正则匹配（自定义格式）
- Layer 3: "my_custom_secret" 包含 "secret" → 敏感字段 + 高熵 + 无正则覆盖 → 命中 `generic-secret`

### 已知非敏感字段名

为避免误报，以下字段名被排除：`role`, `model`, `content`, `type`, `name`, `id`, `max_tokens`, `temperature` 等常见 LLM API 字段。

### 动态配置

敏感字段名模式和非敏感名称支持通过 Settings UI 动态修改，无需重启：

```yaml
dlp:
  semantics:
    sensitivePatterns: ["\\bcert\\b", "my_custom_key"]  # 额外敏感模式（正则）
    nonSensitiveNames: ["my_safe_field"]                 # 额外非敏感名称
```

- **内置规则不可修改** — 代码中的默认 `BUILTIN_SENSITIVE` 和 `BUILTIN_NON_SENSITIVE` 始终生效
- **用户规则为增量** — 通过配置添加的规则与内置规则合并，不覆盖
- **热更新** — 修改后通过 `ConfigManager.onChange` 立即生效

---

## Layer 4: AI Validation（可选）

**文件**: `src/dlp/ai-validator.ts`

使用 LLM API 对 Layer 2/3 的检测结果进行二次确认，过滤误报。

### 工作方式

1. 对每个 finding，提取匹配文本的上下文（前后 200 字符）
2. 将匹配文本部分遮盖后发送给 LLM
3. LLM 判断是否为真正的敏感数据（`sensitive`）或误报（`false_positive`）
4. 内置 LRU 缓存，避免重复调用

### 配置

```yaml
dlp:
  aiValidation:
    enabled: false        # 默认关闭
    provider: "anthropic" # 或 "openai"
    model: "claude-haiku-4-5-20241022"
    apiKey: ""
    timeoutMs: 5000
    cacheSize: 500
```

### 失败策略

AI 调用失败时采用 fail-closed 策略：将匹配视为真正的敏感数据（不放行）。

---

## 完整调用流程

```
dlp-scanner plugin
  │
  ├─ scanText(text, patterns, action)
  │    │
  │    ├─ Layer 2: Regex 匹配 (对每个 pattern 循环)
  │    │    ├─ requireContext? → hasNearbyContext() 近邻检查
  │    │    ├─ validator? → Luhn / SSN 验证
  │    │    └─ 收集 findings + 应用 redact
  │    │
  │    ├─ Layer 0: extractStructuredFields(text)
  │    ├─ Layer 1: isHighEntropy(field.value)
  │    └─ Layer 3: isSensitiveFieldName(field.key) → generic-secret
  │
  ├─ Layer 4: aiValidator.validate(findings) [可选]
  │
  └─ 返回 DlpResult { action, findings, redactedBody? }
```

## 文件清单

| 文件 | 层级 | 职责 |
|------|------|------|
| `src/dlp/structure.ts` | Layer 0 | JSON 结构解析，key-value 提取 |
| `src/dlp/entropy.ts` | Layer 1 | Shannon 熵计算 |
| `src/dlp/patterns/high-confidence.ts` | Layer 2 | 高置信度正则模式 |
| `src/dlp/patterns/validated.ts` | Layer 2 | 算法验证正则模式 |
| `src/dlp/patterns/context-aware.ts` | Layer 2 | 上下文感知正则模式 |
| `src/dlp/engine.ts` | Layer 2+3 | 引擎核心，管线编排 |
| `src/dlp/semantics.ts` | Layer 3 | 字段名语义分析 |
| `src/dlp/validators.ts` | Layer 2 | Luhn / SSN 验证器 |
| `src/dlp/ai-validator.ts` | Layer 4 | LLM 误报过滤 |
| `src/dlp/actions.ts` | — | 类型定义 |

# 重复扫描问题讨论记录

> 状态：**讨论中，尚未实现**
> 最后更新：2026-02-27

---

## 问题描述

对于多轮 Agent 对话，客户端每次请求都会带上完整的历史消息：

```
Turn 1: [user₁]
Turn 2: [user₁, assistant₁, user₂]
Turn 3: [user₁, assistant₁, user₂, assistant₂, user₃]
```

历史消息在之前的 turn 里已经以 request 或 response 的形式被 DLP / Tool Guard 扫过，但代理不知道这一点，每次都对整个 payload 重新扫描，导致：

- **DLP**：同一段敏感内容在每个后续 turn 的 request body 里都触发告警，产生大量重复 findings
- **Tool Guard**：历史中的危险工具调用（作为 assistant message 出现）被反复检测
- **Audit Log**：同一内容重复写入数据库，产生冗余记录
- **性能**：随对话轮数增加，每次扫描的内容量线性增长

---

## 讨论过的方案及否决原因

### 方案 A：Session 级别去重

**思路**：记录每个 session 已命中的 (rule_id, content_hash)，同 session 内跳过重复告警。

**问题**：Session 追踪不可靠。同一对话在不同 turn 可能使用不同连接、不同 session ID，尤其是 OAuth 场景（如 chatgpt.com）。依赖 session 会漏掉大量重复，或在 session 识别错误时引入新问题。

**结论**：否决。

---

### 方案 B：结构感知扫描（只扫最后一条 user message）

**思路**：解析 `messages[]` 数组，识别最后一条 user message 为"新内容"，跳过历史。

**问题**：
1. 不是所有 client 都发累积历史——有的 client 每次只发最新消息，历史不带。如果跳过"非最后"的消息，对这类 client 反而会漏扫。
2. 无法判断当前请求是否跟上一次请求属于同一对话——两个完全无关的请求，messages[-1] 的位置含义不同。
3. Client 可能修改历史消息，改动会被漏检。

**结论**：假设前提不成立，否决。

---

## 当前倾向方案：内容指纹缓存

### 核心思路

不依赖会话关联，不依赖消息结构，只依赖**内容本身**：

```
hash(content_block) → 已知结果? → 命中则跳过扫描，未命中则扫并缓存
```

### 流程

1. 把请求 body 拆成可扫描单元（每条 message 的 content block）
2. 对每个单元计算 hash（如 SHA-256 前 8 字节，足够去重）
3. 查内存缓存（LRU + TTL，约 20 分钟）
4. **命中** → 直接用缓存的扫描结果，跳过重扫
5. **未命中** → 正常扫描，结果写入缓存

### 为什么不需要会话关联

- 重复出现的历史消息 → hash 命中 → 跳过 ✓
- 全新的消息 → hash 未命中 → 正常扫 ✓
- 非累积型 client（每次只发最新消息）→ 大概率未命中 → 正常扫，无损失 ✓
- 不同会话碰巧内容相同 → 命中 → 跳过，DLP 结论仍然正确（内容确定性）✓

### 规则更新处理

缓存 key 加规则集版本号，规则变更后旧缓存自动失效：

```
key = hash(content) + ":" + rules_version
```

### 已知限制

| 限制 | 说明 |
|------|------|
| 首次仍需全量扫 | 只解决重复，不解决首次开销 |
| 内存占用 | 需要 LRU 上限控制 |
| 跨进程不共享 | 多实例场景缓存独立（单机部署无影响） |
| TTL 期间规则变更 | 用 rules_version 在 key 里解决 |

---

## 待讨论 / 待决定

- [ ] 扫描单元的粒度：整条 message vs. 每个 content block
- [ ] DLP 是否需要上下文（跨 block 模式匹配）？如果需要，粒度不能太细
- [ ] Tool Guard 在 response 侧已经是 new-only，是否需要处理
- [ ] LRU 缓存大小和 TTL 的合理值
- [ ] 实现位置：DLP plugin 的 `onRequest` 前，还是更底层的扫描引擎层

---

## 相关代码位置

- DLP 扫描入口：`src/plugins/builtin/dlp-scanner.ts`
- Tool Guard 扫描入口：`src/plugins/builtin/tool-guard.ts`
- Tool Guard streaming 扫描：`src/tool-guard/streaming-guard.ts`
- Audit Log：`src/storage/repositories/audit-log.ts`

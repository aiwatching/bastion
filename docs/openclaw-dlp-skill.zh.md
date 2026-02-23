[English](openclaw-dlp-skill.md) | **中文**

# OpenClaw DLP 告警集成

让 OpenClaw 定期轮询 Bastion 的 DLP Findings API，通过社交媒体渠道（Telegram、Discord、Slack 等）实时通知用户。

---

## 工作原理

```
Bastion (宿主机)                        OpenClaw (Docker / 本地)
    │                                      │
    │  代理 AI 流量                         │
    │  DLP 扫描器检测敏感数据                │
    │  存储到 SQLite                        │
    │                                      │
    │  GET /api/dlp/recent?since=...  ◄────│  每 60 秒轮询 (cron)
    │  返回新的 findings                    │
    │                                      │
    │                                      ├─→ Telegram
    │                                      ├─→ Discord
    │                                      └─→ Slack / 其他频道
```

OpenClaw 运行一个 cron 任务：
1. 每分钟调用 Bastion 的 `/api/dlp/recent?since=<上次检查时间>` API
2. 如果有新的 findings，格式化为人类可读的告警消息
3. 通过已配置的消息频道发送告警

---

## 快速配置

Bastion 提供了一个开箱即用的集成 prompt，位于 [`docs/openclaw-integration.md`](openclaw-integration.md)。将这个 prompt 输入 OpenClaw，它会自动完成：

1. **创建 DLP 告警 skill** — 在 OpenClaw workspace 中写入 `SKILL.md`
2. **添加 cron 任务** — 在 `cron/jobs.json` 中追加每分钟轮询的任务
3. **设置游标持久化** — 使用游标文件记录 `lastChecked` 时间戳

### Docker 模式

```bash
# 将 prompt 复制到 OpenClaw 容器中执行
docker exec -it <container> cat /path/to/openclaw-integration.md
# 或直接将 prompt 内容粘贴到 OpenClaw 聊天会话中
```

Prompt 默认使用 `http://host.docker.internal:8420` 访问 Bastion。如果你的 Bastion 端口不同，请在应用前修改 prompt。

### 本地模式

本地运行的 OpenClaw 实例，需要将 prompt 中的 Bastion URL 从 `host.docker.internal` 改为 `127.0.0.1`：

```
http://127.0.0.1:<bastion-port>
```

### 自定义

在将 prompt 输入 OpenClaw 之前，可以调整以下参数：

| 字段 | 默认值 | 说明 |
|------|--------|------|
| cron 任务中的 `expr` | `*/1 * * * *` | 轮询频率（如 `*/5 * * * *` 表示每 5 分钟） |
| delivery 中的 `channel` | `telegram` | 目标频道（`telegram`、`discord`、`slack` 等） |
| delivery 中的 `to` | `<TELEGRAM_USER_ID_HERE>` | 目标频道的接收者 ID |
| Bastion 端口 | `8420` | 如果 Bastion 使用其他端口，请修改 |

---

## API 参考

```
GET http://host.docker.internal:<bastion-port>/api/dlp/recent?since=<iso-timestamp>&limit=100
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `since` | ISO 8601 时间戳 | 只返回此时间之后的 findings |
| `limit` | number | 最大返回数量（默认 50） |

**响应：**

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

使用 `since` 参数时，结果按时间正序排列（最早的在前），以便将最后一条的 `created_at` 作为下次查询的 `since` 值。

---

## 创建的文件

OpenClaw 处理集成 prompt 后，会创建以下文件：

```
~/.openclaw/
  ├── workspace/
  │   ├── skills/dlp-alert/SKILL.md     # DLP 告警 skill 定义
  │   └── memory/dlp-cursor.json        # 轮询游标（自动管理）
  └── cron/jobs.json                    # 添加的 cron 任务（每分钟轮询）
```

---

## 告警消息格式

```
🚨 DLP 告警 — 检测到 2 条敏感数据

🔴 [已拦截] aws-access-key (high-confidence)
   方向：request（外发请求）
   会话：my-project
   提供商：anthropic / claude-sonnet-4-20250514
   时间：2026-02-22 10:30:00 UTC
   片段：...AKIA12345678****...

🟠 [警告] email-address (context-aware)
   方向：response（收到的响应）
   会话：dev-work
   提供商：openai / gpt-4o
   时间：2026-02-22 10:31:15 UTC
   片段：...user@exam****...

📊 Dashboard: http://127.0.0.1:8420/dashboard → DLP 标签页
```

严重性映射：
- `block` → 🔴 已拦截 — 请求已被拒绝
- `redact` → 🟡 已脱敏 — 敏感数据已遮蔽
- `warn` → 🟠 警告 — 已检测但放行

---

## 验证连通性

```bash
# 从 Docker 容器内
curl http://host.docker.internal:8420/api/dlp/recent?limit=1

# 从本地
curl http://127.0.0.1:8420/api/dlp/recent?limit=1
```

---

## 进阶：按会话过滤

如果只需要特定项目的告警，在 cron 任务的 `message` 字段中添加过滤指令：

```
Only alert on findings where session_label is "my-project". Ignore all others.
```

[English](openclaw-dlp-skill.md) | **中文**

# OpenClaw DLP 告警 Skill

本文档提供一个开箱即用的 skill/提示词，让 OpenClaw 定期轮询 Bastion 的 DLP Findings API，并通过社交媒体渠道（Telegram、Discord、Slack 等）通知用户。

---

## 工作原理

```
Bastion (宿主机)                        OpenClaw (Docker / 本地)
    │                                      │
    │  代理 AI 流量                         │
    │  DLP 扫描器检测敏感数据                │
    │  存储到 SQLite                        │
    │                                      │
    │  GET /api/dlp/recent?since=...  ◄────│  每 60 秒轮询
    │  返回新的 findings                    │
    │                                      │
    │                                      ├─→ Telegram
    │                                      ├─→ Discord
    │                                      └─→ Slack / 其他频道
```

OpenClaw 运行一个定时 skill：
1. 调用 Bastion 的 `/api/dlp/recent?since=<上次检查时间>` API
2. 如果有新的 findings，格式化为人类可读的告警消息
3. 通过已配置的消息频道发送告警

---

## API 端点

```
GET http://host.docker.internal:<bastion-port>/api/dlp/recent?since=<iso-timestamp>&limit=100
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `since` | ISO 8601 时间戳 | 只返回此时间之后的 findings（如 `2026-02-22T10:00:00.000Z`） |
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

**注意：** 使用 `since` 参数时，结果按时间正序排列（最早的在前），以便将最后一条的 `created_at` 作为下次查询的 `since` 值。

---

## Skill 提示词

将以下提示词复制到你的 OpenClaw skill 配置中。根据实际情况调整 `BASTION_URL` 和轮询间隔。

```
你是一个 DLP（数据泄露防护）告警监控器。你的工作是定期检查 Bastion AI Gateway 的敏感数据发现，并立即通知用户。

## 配置

- Bastion API: http://host.docker.internal:8420/api/dlp/recent
- 轮询间隔：每 60 秒
- 告警阈值：所有 action 为 "block"、"redact" 或 "warn" 的发现

## 行为

1. 每 60 秒调用一次：
   GET http://host.docker.internal:8420/api/dlp/recent?since=<上次检查的时间戳>&limit=100

   首次运行时，使用当前时间减去 5 分钟作为初始 "since" 值。

2. 如果响应为空数组 []，不做任何操作——没有新发现。

3. 如果有发现，发送如下格式的告警消息：

   🚨 DLP 告警 — 检测到 <数量> 条敏感数据

   每条发现：
   - 类型：<pattern_name>（<pattern_category>）
   - 动作：<action>
   - 方向：<direction>（request = 外发请求，response = 收到的响应）
   - 会话：<session_label 或 session_id>
   - 提供商：<provider> / <model>
   - 时间：<created_at>
   - 片段：<original_snippet>（前 40 字符，脱敏显示）

   页脚：
   Dashboard: http://127.0.0.1:8420/dashboard → DLP 标签页查看详情。

4. 将 "since" 时间戳更新为收到的最后一条发现的 created_at。

5. 消息格式中的严重性映射：
   - "block" → 🔴 已拦截 — 请求已被拒绝
   - "redact" → 🟡 已脱敏 — 敏感数据已遮蔽
   - "warn" → 🟠 警告 — 已检测但放行

## 告警消息示例

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

📊 Dashboard: http://127.0.0.1:8420/dashboard
```

---

## 配置指南

### Docker 模式

如果 OpenClaw 通过 Bastion 管理的 Docker 容器运行（`bastion openclaw docker up`），Bastion API 地址为：

```
http://host.docker.internal:<bastion-port>
```

Bastion 端口通过 `BASTION_PORT` 环境变量注入（默认 8420）。

### 本地模式

如果 OpenClaw 本地运行（`bastion openclaw local start`），Bastion 地址为：

```
http://127.0.0.1:<bastion-port>
```

### 验证连通性

```bash
# 从 Docker 容器内
curl http://host.docker.internal:8420/api/dlp/recent?limit=1

# 从本地
curl http://127.0.0.1:8420/api/dlp/recent?limit=1
```

---

## 进阶：按会话过滤

如果只需要特定会话/项目的告警，在响应中按 `session_id` 或 `session_label` 过滤：

```
GET /api/dlp/recent?since=...&limit=100
→ 过滤 session_label == "my-project" 的结果
```

---

## 进阶：Webhook 方式（反向推送）

如果你希望 OpenClaw 接收推送通知而非轮询，可以搭建一个简单的桥接：

```bash
# 作为 cron 任务或后台循环运行
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

此方式仅在 OpenClaw 有 `/api/notify` 端点时可用。推荐使用上面基于 skill 的轮询方式，更简单。

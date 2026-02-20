# AI Agent Monitoring

通过 Bastion 代理监控任意本地运行的 AI Agent（Claude Code、Cursor、Aider、自定义 Python/Node 应用等），实现 DLP 扫描、用量统计、成本追踪和审计日志。

---

## 核心原理

Bastion 作为 HTTPS 代理，拦截所有发往 AI Provider 的流量：

```
AI Agent (任意进程)
    │
    │  HTTPS_PROXY → Bastion
    │
    ▼
Bastion Gateway (127.0.0.1:8420)
    │
    ├─ DLP 扫描（敏感数据检测）
    ├─ 指标采集（token 用量、成本）
    ├─ 审计日志（请求/响应记录）
    ├─ 响应缓存（可选）
    │
    ▼
LLM Provider (Anthropic / OpenAI / Gemini / ...)
```

---

## 三种接入方式

### 方式一：`bastion wrap`（单进程，推荐）

最简单，代理仅作用于该命令及其子进程：

```bash
# Claude Code
bastion wrap claude

# Cursor 打开项目
bastion wrap cursor /path/to/project

# Python 应用
bastion wrap python my_agent.py

# Node.js 应用
bastion wrap node server.js

# 带 label 标识（Dashboard 中显示）
bastion wrap --label "code-review" claude
bastion wrap --label "data-pipeline" python etl.py
```

每次 `bastion wrap` 生成唯一 session ID，Dashboard 中按 session 分组查看。

### 方式二：`bastion proxy on`（全局代理）

所有终端、所有新进程、GUI 应用都经过 Bastion：

```bash
eval $(bastion proxy on)
```

关闭：

```bash
eval $(bastion proxy off)
```

适合：同时运行多个 AI 工具，希望统一监控。

### 方式三：手动设置环境变量

对于特殊场景，手动注入环境变量：

```bash
export HTTPS_PROXY="http://127.0.0.1:8420"
export NODE_EXTRA_CA_CERTS="$HOME/.bastion/ca.crt"
export NO_PROXY="127.0.0.1,localhost"

# 然后运行你的 agent
python my_agent.py
```

或在代码中设置（Python 示例）：

```python
import os
os.environ["HTTPS_PROXY"] = "http://127.0.0.1:8420"
os.environ["SSL_CERT_FILE"] = os.path.expanduser("~/.bastion/ca.crt")
```

---

## 常见 AI Agent 配置

### Claude Code

```bash
bastion wrap claude
```

Claude Code 原生支持 `HTTPS_PROXY`，无需额外配置。

### Cursor

```bash
bastion wrap cursor .
```

或在 Cursor Settings → Proxy 中设置 `http://127.0.0.1:8420`。

### Aider

```bash
bastion wrap aider --model claude-3-5-sonnet
```

### OpenAI Python SDK

```bash
bastion wrap python my_app.py
```

Python `httpx`（OpenAI SDK 底层）自动读取 `HTTPS_PROXY`。

对于 CA 证书信任，设置：

```bash
export SSL_CERT_FILE="$HOME/.bastion/ca.crt"
# 或
export REQUESTS_CA_BUNDLE="$HOME/.bastion/ca.crt"
```

### Go 应用

Go 的 `net/http` 自动读取 `HTTPS_PROXY`：

```bash
bastion wrap go run ./cmd/myagent
```

### Docker 容器中的 Agent

参考 [OpenClaw Docker 文档](openclaw-docker.md) 中的方式，核心是：

```yaml
environment:
  HTTPS_PROXY: "http://host.docker.internal:8420"
  NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/bastion-ca.crt"
  NO_PROXY: "localhost,127.0.0.1,host.docker.internal"
volumes:
  - ~/.bastion/ca.crt:/etc/ssl/certs/bastion-ca.crt:ro
```

---

## Dashboard 监控

启动 Bastion 后，打开 Dashboard：

```
http://127.0.0.1:8420/dashboard
```

### Overview Tab

- **请求量**：按 provider / model / session 分组
- **Token 用量**：input + output tokens，实时统计
- **成本追踪**：基于各 model 定价自动计算
- **延迟**：每个请求的 upstream 响应时间

### DLP Tab

- **Config**：管理检测模式（19 种内置 + 自定义），实时开关
- **Findings**：检测到的敏感数据，按方向（请求/响应）分类
- **Test**：独立测试扫描器，粘贴文本即时检测

### Audit Tab

- **Session Timeline**：按 session 分组的请求时间线
- **DLP 标记**：敏感数据命中的条目高亮显示
- **请求详情**：完整的 request/response 内容查看

### Optimizer Tab

- **缓存命中率**：相同请求的缓存效果
- **Token 节省**：空白压缩节省的 token 数

---

## 统计 API

通过 API 获取监控数据（适合集成到自定义看板）：

```bash
# 总体统计
curl http://127.0.0.1:8420/api/stats

# 按 session 筛选
curl "http://127.0.0.1:8420/api/stats?session_id=<uuid>"

# 最近 24 小时
curl "http://127.0.0.1:8420/api/stats?hours=24"

# Session 列表
curl http://127.0.0.1:8420/api/sessions

# 审计记录
curl http://127.0.0.1:8420/api/audit/recent?limit=20

# DLP 检测记录
curl http://127.0.0.1:8420/api/dlp/recent?limit=20
```

---

## 多 Agent 同时监控

Bastion 天然支持多进程同时代理，每个进程通过 session ID 区分：

```bash
# 终端 1
bastion wrap --label "claude-code" claude

# 终端 2
bastion wrap --label "python-agent" python agent.py

# 终端 3
bastion wrap --label "data-pipeline" node pipeline.js
```

Dashboard 中按 session 分组查看每个 agent 的独立统计。

---

## DLP 保护

Bastion 的 DLP 引擎在代理层自动工作，无需 agent 侧修改：

| 动作 | 说明 |
|------|------|
| `pass` | 仅记录，不干预 |
| `warn` | 记录 + Dashboard 警告 |
| `redact` | 自动替换敏感数据为 `[REDACTED]` |
| `block` | 阻止整个请求发送 |

配置：

```yaml
# ~/.bastion/config.yaml
plugins:
  dlp:
    enabled: true
    action: "warn"        # pass | warn | redact | block
```

检测 19 种内置模式：AWS 密钥、GitHub Token、信用卡号、SSN、邮箱、IP 地址等。详见 [DLP 文档](dlp.md)。

---

## 故障排查

### Agent 无法连接 API

```bash
# 1. Bastion 是否在跑
bastion health

# 2. 手动测试代理
curl -x http://127.0.0.1:8420 https://api.anthropic.com/v1/messages \
  --cacert ~/.bastion/ca.crt \
  -H "x-api-key: test" \
  -d '{}'
```

### SSL 证书错误

```bash
# 确认 CA 证书存在
ls ~/.bastion/ca.crt

# Node.js 应用
export NODE_EXTRA_CA_CERTS="$HOME/.bastion/ca.crt"

# Python 应用
export SSL_CERT_FILE="$HOME/.bastion/ca.crt"
export REQUESTS_CA_BUNDLE="$HOME/.bastion/ca.crt"

# 系统级信任（macOS）
bastion proxy on --trust-ca
```

### Dashboard 看不到数据

```bash
# 确认 metrics 插件启用
curl http://127.0.0.1:8420/api/config | python3 -m json.tool

# 确认 agent 确实经过 Bastion
bastion stats
```

### 某些域名不想走代理

Bastion 默认只拦截 AI API 域名。OAuth、认证等域名通过 `NO_PROXY` 排除。

如需自定义排除列表：

```bash
export NO_PROXY="127.0.0.1,localhost,internal.company.com"
```

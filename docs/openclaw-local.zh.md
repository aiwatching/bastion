[English](openclaw-local.md) | **中文**

# OpenClaw 本地安装

在本地直接运行 OpenClaw 进程（不使用 Docker），通过 Bastion 代理所有 AI 流量。

---

## 前置条件

- Bastion 已安装（`bastion` 命令可用）
- OpenClaw 已在本地安装（`openclaw` 命令可用，或知道二进制路径）
- Node.js 18+

```bash
# 确认 Bastion
bastion --version

# 确认 OpenClaw
which openclaw
# 或
~/.openclaw/bin/openclaw --version
```

---

## 快速开始

### 1. 启动 Bastion

```bash
bastion start
bastion health
```

### 2. 启动 OpenClaw（daemon 模式）

```bash
bastion openclaw local start mywork \
  --port 18789 \
  --config-dir ~/openclaw-data/mywork/config \
  --workspace ~/openclaw-data/mywork/workspace
```

输出：

```
Starting OpenClaw 'mywork' on port 18789 (daemon)...
  PID:       12345
  Binary:    /usr/local/bin/openclaw
  Port:      18789
  Config:    /Users/you/openclaw-data/mywork/config
  Workspace: /Users/you/openclaw-data/mywork/workspace
  Proxy:     127.0.0.1:8420
  Log:       /Users/you/.bastion/openclaw/local/mywork.log

Dashboard: http://127.0.0.1:18789/
```

### 3. 前台模式（调试用）

```bash
bastion openclaw local start mywork \
  --port 18789 \
  --foreground
```

日志直接输出到终端，Ctrl+C 停止。

---

## 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<name>` | 实例名称 | 必填 |
| `--port` | 网关端口 | 18789 |
| `--bin` | OpenClaw 二进制路径 | 自动搜索 PATH / `~/.openclaw/bin/` |
| `--config-dir` | 配置目录 | `~/.openclaw-<name>` |
| `--workspace` | 工作区目录 | `~/openclaw-<name>/workspace` |
| `--foreground` | 前台运行（不 daemon） | 默认 daemon |

---

## 日常管理

```bash
# 查看所有本地实例
bastion openclaw local status

# 停止
bastion openclaw local stop mywork

# 查看日志
bastion openclaw local logs mywork
bastion openclaw local logs mywork -f   # 实时跟踪
```

### 状态输出示例

```bash
bastion openclaw local status
```

```
INSTANCE   STATUS   PORT   PID    DASHBOARD
mywork     running  18789  12345  http://127.0.0.1:18789/
dev2       stopped  18800  -      http://127.0.0.1:18800/
```

---

## 多实例

```bash
bastion openclaw local start dev1 --port 18789
bastion openclaw local start dev2 --port 18800
bastion openclaw local start dev3 --port 18810 --bin ~/custom/openclaw

bastion openclaw local status
```

---

## 代理原理

本地模式下，Bastion 通过环境变量注入代理：

```
OpenClaw (本地进程)
    │
    │  HTTPS_PROXY=http://openclaw-local-mywork@127.0.0.1:8420
    │  NODE_EXTRA_CA_CERTS=~/.bastion/ca.crt
    │  NO_PROXY=127.0.0.1,localhost
    │
    ▼
Bastion (本地进程)
    │
    │  DLP 扫描 → 指标采集 → 审计日志 → 缓存
    │
    ▼
LLM Provider (api.anthropic.com / api.openai.com / ...)
```

Bastion 自动：
1. 读取当前配置的 host + port
2. 注入 `HTTPS_PROXY`（包含实例名作为 session 标识）
3. 注入 `NODE_EXTRA_CA_CERTS` 指向 Bastion CA 证书
4. 以 daemon 或前台方式启动 `openclaw gateway --port <port> --bind localhost`

---

## 数据目录

```
~/.bastion/openclaw/local/
  ├── mywork.pid          # PID 文件（运行时存在）
  ├── mywork.json         # 元数据（端口、路径、启动时间）
  └── mywork.log          # 日志文件（daemon 模式）

~/openclaw-data/mywork/   # 或你指定的路径
  ├── config/             # OpenClaw 配置
  └── workspace/          # 工作区
```

---

## Docker vs Local 对比

| | Docker | Local |
|---|---|---|
| 隔离性 | 完全隔离，不影响宿主 | 共享宿主环境 |
| 安装 | 只需 Docker 镜像 | 需要安装 OpenClaw 二进制 |
| 网络 | 通过 `host.docker.internal` 连接 | 直接 `127.0.0.1` |
| 多实例 | 每个实例独立容器 | 每个实例独立进程 |
| 性能 | 有 Docker 开销 | 原生性能 |
| 适用场景 | 生产环境、团队统一环境 | 开发调试、快速迭代 |
| Bastion 命令 | `bastion openclaw docker ...` | `bastion openclaw local ...` |

---

## 故障排查

### OpenClaw 二进制找不到

```bash
# 检查 PATH
which openclaw

# 手动指定路径
bastion openclaw local start mywork --bin /path/to/openclaw

# 常见安装位置
ls ~/.openclaw/bin/openclaw
ls /usr/local/bin/openclaw
```

### 端口冲突

```bash
# 检查端口占用
lsof -i :18789

# 使用其他端口
bastion openclaw local start mywork --port 19000
```

### 进程已退出但 PID 文件残留

```bash
# status 会自动清理 stale PID
bastion openclaw local status

# 或手动删除
rm ~/.bastion/openclaw/local/mywork.pid
```

---

## DLP 告警通知

OpenClaw 可以轮询 Bastion 的 DLP API，当检测到 AI 流量中的敏感数据时，通过消息频道（Telegram、Discord、Slack）通知你。

本地模式下，API 端点为：

```
GET http://127.0.0.1:<bastion-port>/api/dlp/recent?since=<iso-timestamp>&limit=100
```

```bash
# 快速测试
curl http://127.0.0.1:8420/api/dlp/recent?limit=3
```

将集成 prompt [`docs/openclaw-integration.md`](openclaw-integration.md) 输入 OpenClaw 即可自动配置告警。完整说明请参见 [OpenClaw DLP 告警集成](openclaw-dlp-skill.zh.md)。

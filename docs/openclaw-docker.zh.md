[English](openclaw-docker.md) | **中文**

# OpenClaw Docker Compose 集成

通过 Docker Compose 运行 OpenClaw，并自动路由所有 AI 流量经过 Bastion 代理。

---

## 前置条件

- Bastion 已安装（`bastion` 命令可用）
- Docker Desktop 已安装并运行
- OpenClaw Docker 镜像已准备好

```bash
# 确认 Bastion 可用
bastion --version

# 确认 Docker 可用
docker info
```

---

## 场景一：全新安装

从零开始创建 OpenClaw Docker 实例，Bastion 自动处理所有配置。

### 1. 启动 Bastion

```bash
bastion start
bastion health   # 确认 running
```

### 2. 准备 Docker 镜像

```bash
# 方式 A：从源码构建（推荐）
bastion openclaw build                    # 基础镜像
bastion openclaw build --brew             # + Homebrew，支持 brew 类 skill（1password-cli、signal-cli 等）
bastion openclaw build --browser          # + Chromium，支持浏览器自动化
bastion openclaw build --docker-cli       # + Docker CLI，支持 sandbox 容器管理
bastion openclaw build --brew --browser --docker-cli   # 包含所有可选组件

# 额外 apt 包
bastion openclaw build --brew --apt-packages "ffmpeg,imagemagick"

# 指定 git 分支/标签或自定义镜像名
bastion openclaw build --tag v2.0 --image openclaw:v2.0

# 使用本地已有源码（跳过 clone）
bastion openclaw build --src ~/my-openclaw-fork

# 方式 B：使用已有镜像
docker images | grep openclaw
```

### 3. 创建并启动实例

```bash
bastion openclaw docker up mywork \
  --port 18789 \
  --image openclaw:local \
  --config-dir ~/openclaw-data/mywork/config \
  --workspace ~/openclaw-data/mywork/workspace
```

参数说明：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<name>` | 实例名称，用于区分多个实例 | 必填 |
| `--port` | 网关端口（bridge 端口自动 +1） | 18789 |
| `--image` | Docker 镜像名 | openclaw:local |
| `--config-dir` | OpenClaw 配置目录（openclaw.json、devices/） | `~/.openclaw-<name>` |
| `--workspace` | OpenClaw 工作区目录 | `~/openclaw-<name>/workspace` |

### 4. 交互式 Onboarding

命令执行后会进入交互式配置流程：

1. 屏幕上会打印一个随机 token，**复制它**
2. 按提示输入 token 完成网关认证
3. 完成后 Bastion 自动执行 post-onboard 修复：
   - 同步 token（onboard 可能会修改）
   - 设置 `gateway.bind=lan`（Docker 网络必需）
   - 自动审批所有待配对设备
   - 重启网关加载配置

### 5. 访问 Dashboard

onboarding 完成后输出 Dashboard URL：

```
http://127.0.0.1:18789/?token=<your-token>
```

在浏览器中打开。如果提示配对，刷新页面即可（设备已自动审批）。

### 6. 多实例

端口错开即可运行多个实例：

```bash
# 第二个实例
bastion openclaw docker up dev2 \
  --port 18800 \
  --image openclaw:local \
  --config-dir ~/openclaw-data/dev2/config \
  --workspace ~/openclaw-data/dev2/workspace

# 第三个实例
bastion openclaw docker up staging \
  --port 18810 \
  --image openclaw:v2.0 \
  --config-dir ~/openclaw-data/staging/config \
  --workspace ~/openclaw-data/staging/workspace
```

查看所有实例：

```bash
bastion openclaw docker status
```

输出：

```
INSTANCE   STATUS   GATEWAY  BRIDGE  DASHBOARD
mywork     running  18789    18790   http://127.0.0.1:18789/?token=abc...
dev2       running  18800    18801   http://127.0.0.1:18800/?token=def...
staging    stopped  18810    18811   http://127.0.0.1:18810/?token=ghi...
```

---

## 场景二：已有 Docker Compose

你已经有一个运行中的 OpenClaw Docker Compose 环境，只需要接入 Bastion 代理。

### 方式 A：修改 docker-compose.yml（推荐）

在你的 `docker-compose.yml` 的 environment 中添加三个 Bastion 代理变量，并挂载 CA 证书：

```yaml
services:
  openclaw-gateway:
    image: openclaw:local
    environment:
      # ... 你已有的配置 ...
      # ── 添加以下 Bastion 代理配置 ──
      HTTPS_PROXY: "http://openclaw-gw@host.docker.internal:${BASTION_PORT:-8420}"
      NODE_EXTRA_CA_CERTS: "/etc/ssl/certs/bastion-ca.crt"
      NO_PROXY: "localhost,127.0.0.1,host.docker.internal"
    volumes:
      # ... 你已有的 volumes ...
      # ── 添加 CA 证书挂载 ──
      - ~/.bastion/ca.crt:/etc/ssl/certs/bastion-ca.crt:ro
```

如果你的 Bastion 端口不是 8420，在 `.env` 文件中添加：

```env
BASTION_PORT=9000
```

然后重启：

```bash
docker compose down
docker compose up -d
```

### 方式 B：使用 bastion 命令直接启动

如果你已有 `docker-compose.yml` 和 `.env` 文件，可以直接用 Bastion 启动，它会自动注入 `BASTION_PORT` 环境变量：

```bash
bastion openclaw docker run \
  --compose /path/to/your/docker-compose.yml \
  --env-file /path/to/your/.env \
  -p my-openclaw
```

参数说明：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--compose` | docker-compose.yml 路径 | 自动搜索当前目录 |
| `--env-file` | .env 文件路径 | 无 |
| `-p` | Docker Compose 项目名 | openclaw |

### 方式 C：通过 Docker Desktop UI

1. 确保 `docker-compose.yml` 中已有 Bastion 代理配置（见方式 A）
2. 在 Docker Desktop UI 中直接点击启动
3. Bastion 只需保持运行即可（`bastion start`）

---

## 日常管理

```bash
# 查看所有 Docker 实例
bastion openclaw docker status

# 启动（幂等，已存在的实例直接 up，不重新 onboard）
bastion openclaw docker up mywork

# 停止
bastion openclaw docker stop mywork

# 查看日志
bastion openclaw docker logs mywork
bastion openclaw docker logs mywork -f   # 实时跟踪

# 注入代理到任意运行中的容器
bastion openclaw docker attach <container-name>
bastion openclaw docker attach <container-name> --restart   # 重建容器并 bake in 环境变量
```

---

## 配置管理

OpenClaw 的配置文件在容器内路径为 `/home/node/.openclaw/openclaw.json`，通过 volume mount 映射到宿主机的 `--config-dir` 目录。

### 方式一：通过 bastion exec（需网关运行 + 设备已配对）

```bash
# 读取配置
bastion openclaw docker exec mywork config get gateway
bastion openclaw docker exec mywork config get channels.telegram

# 修改配置
bastion openclaw docker exec mywork config set gateway.mode local
bastion openclaw docker exec mywork config set channels.telegram.botToken "123456:AAH..."
```

### 方式二：直接编辑宿主机文件（推荐）

当网关未运行、设备未配对、或 onboarding 失败时，可以直接在宿主机上操作配置文件：

```bash
# 查看完整配置
cat ~/openclaw-data/mywork/config/openclaw.json | python3 -m json.tool

# 查看某个配置段（如 Telegram）
python3 -c "
import json
cfg = json.load(open('$HOME/openclaw-data/mywork/config/openclaw.json'))
print(json.dumps(cfg.get('channels', {}).get('telegram', {}), indent=2))
"

# 修改配置（如修改 Telegram bot token）
python3 -c "
import json
path = '$HOME/openclaw-data/mywork/config/openclaw.json'
cfg = json.load(open(path))
cfg.setdefault('channels', {}).setdefault('telegram', {})['botToken'] = '123456:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'
json.dump(cfg, open(path, 'w'), indent=2)
print('Updated.')
"
```

修改后重启网关生效：

```bash
bastion openclaw docker stop mywork
bastion openclaw docker up mywork
```

### 设备配对

如果遇到 `pairing required` 错误（onboarding 未完成或设备未审批），可以直接操作设备文件：

```bash
# 查看待审批设备
cat ~/openclaw-data/mywork/config/devices/pending.json | python3 -m json.tool

# 手动审批所有待配对设备
python3 -c "
import json, os, time

config_dir = os.path.expanduser('~/openclaw-data/mywork/config')
pending_path = os.path.join(config_dir, 'devices', 'pending.json')
paired_path = os.path.join(config_dir, 'devices', 'paired.json')

pending = json.load(open(pending_path))
if not pending:
    print('No pending devices.')
    exit()

paired = json.load(open(paired_path)) if os.path.exists(paired_path) else {}

for req_id, dev in pending.items():
    paired[dev['deviceId']] = {
        'deviceId': dev['deviceId'],
        'publicKey': dev['publicKey'],
        'platform': dev['platform'],
        'clientId': dev['clientId'],
        'clientMode': dev.get('clientMode', 'webchat'),
        'role': dev.get('role', 'operator'),
        'roles': dev.get('roles', ['operator']),
        'scopes': dev.get('scopes', []),
        'pairedAt': int(time.time() * 1000),
    }

json.dump(paired, open(paired_path, 'w'), indent=2)
json.dump({}, open(pending_path, 'w'))
print(f'Approved {len(pending)} device(s).')
"
```

审批后重启：

```bash
bastion openclaw docker stop mywork
bastion openclaw docker up mywork
```

### 实例重建

如果 onboarding 出错需要完全重来：

```bash
# 1. 销毁实例（容器 + bastion 配置）
bastion openclaw docker destroy mywork

# 2. 清理数据目录（可选）
rm -rf ~/openclaw-data/mywork

# 3. 重新创建
bastion openclaw docker up mywork \
  --port 18789 \
  --image openclaw:local \
  --config-dir ~/openclaw-data/mywork/config \
  --workspace ~/openclaw-data/mywork/workspace
```

---

## 生成的目录结构

```
~/.bastion/openclaw/docker/
  └── <name>/
      ├── .env                    # 环境变量（token、端口、镜像、BASTION_PORT 等）
      └── docker-compose.yml      # 生成的 Compose 文件

~/openclaw-data/<name>/           # 或你指定的 --config-dir / --workspace
  ├── config/
  │   ├── openclaw.json           # OpenClaw 网关配置（onboarding 写入）
  │   └── devices/
  │       ├── pending.json        # 待审批设备
  │       └── paired.json         # 已配对设备
  └── workspace/                  # OpenClaw 工作区
```

---

## Bastion 代理原理

Docker 容器内的 OpenClaw 通过以下方式连接 Bastion：

```
OpenClaw (容器内)
    │
    │  HTTPS_PROXY=http://host.docker.internal:<bastion-port>
    │
    ▼
Bastion (宿主机)
    │
    │  DLP 扫描 → 指标采集 → 审计日志 → 缓存
    │
    ▼
LLM Provider (api.anthropic.com / api.openai.com / ...)
```

- `host.docker.internal` — Docker 提供的宿主机地址，容器内访问宿主机上的 Bastion
- CA 证书挂载 — 容器内通过 `NODE_EXTRA_CA_CERTS` 信任 Bastion 的 MITM 证书
- `NO_PROXY` — 排除 localhost 和 Docker 内部地址，避免回环

---

## 故障排查

### 容器无法连接 Bastion

```bash
# 1. 确认 Bastion 在跑
bastion health

# 2. 确认端口
bastion proxy status

# 3. 从容器内测试连通性
docker exec <container> curl -v http://host.docker.internal:8420/api/stats
```

### Onboarding 失败

onboarding 中途失败时，核心配置（model、channels）通常已保存到 `openclaw.json`，可以直接重启使用：

```bash
bastion openclaw docker stop <name>
bastion openclaw docker up <name>
```

如果需要完全重来，使用 `destroy` + 清理数据目录：

```bash
bastion openclaw docker destroy <name>
rm -rf ~/openclaw-data/<name>
bastion openclaw docker up <name> --port ... --image ... --config-dir ... --workspace ...
```

> **注意：** `bastion openclaw docker up <name>` 对已存在的实例只会 `docker compose up -d`，不会重新 onboard。必须先 `destroy` 才能重建。

### pairing required

`exec` 命令或浏览器访问时报 `pairing required`，说明设备未审批。参见上方「配置管理 → 设备配对」章节手动审批。

### Telegram Bot 404

Telegram API 返回 `404: Not Found` 通常表示 bot token 无效或不完整。Telegram token 格式为 `123456789:AAH...`（数字 + 冒号 + hash）。参见「配置管理 → 方式二」直接在宿主机修改 token。

### CA 证书不存在

```bash
# Bastion 首次启动时自动生成 CA 证书
bastion start
ls ~/.bastion/ca.crt
```

---

## DLP 告警通知

Bastion 可以检测 AI 流量中的敏感数据（API 密钥、凭证、PII），OpenClaw 可以通过社交媒体渠道（Telegram、Discord、Slack 等）实时通知你。

### 工作原理

```
OpenClaw (容器内)                       Bastion (宿主机)
    │                                      │
    │  GET /api/dlp/recent?since=...  ────►│
    │  ◄──── 新的 DLP findings             │
    │                                      │
    ├─→ Telegram 告警                      │
    ├─→ Discord 告警                       │
    └─→ Slack 告警                         │
```

OpenClaw 通过 skill/提示词每 60 秒轮询 Bastion 的 DLP API。当检测到新的 findings 时，格式化告警消息并通过已配置的频道发送。

### API 端点

```
GET http://host.docker.internal:<bastion-port>/api/dlp/recent?since=<iso-timestamp>&limit=100
```

| 参数 | 说明 |
|------|------|
| `since` | ISO 8601 时间戳 — 只返回此时间之后的 findings |
| `limit` | 最大返回数量（默认 50） |

响应包含每条 finding 的 `pattern_name`、`action`（block/redact/warn）、`direction`、`provider`、`model`、`session_id`、`session_label` 和 `original_snippet`。

### 快速测试

```bash
# 从 OpenClaw 容器内
curl http://host.docker.internal:8420/api/dlp/recent?limit=3

# 从宿主机
curl http://127.0.0.1:8420/api/dlp/recent?limit=3
```

### 配置方法

将集成 prompt [`docs/openclaw-integration.md`](openclaw-integration.md) 输入 OpenClaw 聊天会话。它会自动创建 DLP 告警 skill、添加 cron 任务（每分钟轮询）并设置游标持久化。

完整说明、自定义选项和告警消息格式请参见 [OpenClaw DLP 告警集成](openclaw-dlp-skill.zh.md)。

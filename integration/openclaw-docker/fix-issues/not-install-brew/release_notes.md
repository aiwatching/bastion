# Fix: Docker 镜像不安装 Homebrew 导致 brew 类 skill 安装失败

## 问题

OpenClaw Docker 镜像（`Dockerfile`）默认不安装 Linuxbrew。容器内存在一个 `brew-shim` 脚本，将 `brew install X` 转发为 `apt-get install X`，导致依赖 Homebrew 的 skill（如 `1password-cli`、`signal-cli`）安装失败：

```
Install failed (exit 100): E: Unable to locate package 1password-cli
```

### 根因分析

1. **brew-shim 伪装**：容器内 `/home/linuxbrew/.linuxbrew/Homebrew/bin/brew` 是一个 shell 脚本，将 brew 命令映射为 apt-get，而非真正的 Homebrew
2. **docker-setup.sh 未传递 build arg**：即使 Dockerfile 支持 `OPENCLAW_INSTALL_BREW`，`docker-setup.sh` 没有将该参数传递给 `docker build`
3. **HOMEBREW_PREFIX 误检测**：安装真正的 Homebrew 后，`/usr/local/bin/brew` 符号链接导致 Homebrew 将 prefix 误检测为 `/usr/local`（而非 `/home/linuxbrew/.linuxbrew`），触发权限错误

## 修复方案

### Dockerfile 改动

在 Chromium 可选安装之后、`COPY . .` 之前，新增可选 Linuxbrew 安装：

- 通过 `--build-arg OPENCLAW_INSTALL_BREW=1` 启用，默认不安装
- 以 `linuxbrew` 用户执行官方安装脚本，再将所有权转给 `node` 用户
- **不创建** `/usr/local/bin/brew` 符号链接（避免 prefix 误检测）
- 设置三个 ENV 变量确保 Homebrew 正确识别路径：
  - `HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew`
  - `HOMEBREW_CELLAR=/home/linuxbrew/.linuxbrew/Cellar`
  - `HOMEBREW_REPOSITORY=/home/linuxbrew/.linuxbrew/Homebrew`

### docker-setup.sh 改动

- 新增 `OPENCLAW_INSTALL_BREW` 环境变量导出
- `docker build` 命令传递 `--build-arg OPENCLAW_INSTALL_BREW`
- `.env` 持久化中包含 `OPENCLAW_INSTALL_BREW`

## 使用方式

```bash
# 通过 Bastion 集成脚本构建（推荐）
./openclaw.sh build --brew

# 或直接使用 docker-setup.sh
OPENCLAW_INSTALL_BREW=1 ./docker-setup.sh

# 或手动 docker build
docker build --build-arg OPENCLAW_INSTALL_BREW=1 -t openclaw:local .
```

## 影响

- 不带 `--brew` 构建：镜像无变化，行为不变
- 带 `--brew` 构建：镜像增大约 500MB，支持 brew 类 skill 安装（uv、go、signal-cli、1password-cli 等）

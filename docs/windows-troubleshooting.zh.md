[English](windows-troubleshooting.md) | **中文**

# Windows 故障排除

Bastion 支持 Windows（PowerShell），但在安装和启动过程中可能遇到一些平台特定的问题。本指南涵盖最常见的问题及解决方案。

## 前置要求

- **Node.js 22 LTS**（强烈推荐）
- npm（随 Node.js 一起安装）
- Git（用于远程签名同步）

> **为什么要用 Node.js 22 LTS？** Bastion 使用 `better-sqlite3`，这是一个原生 C++ 模块，仅为偶数版本（LTS）的 Node.js 提供预编译二进制文件。奇数版本（如 23、25）需要从源码编译，这需要安装 Visual Studio Build Tools——额外 4GB 以上的下载。使用 Node 22 LTS 可以完全避免此问题。

## 常见问题

### 1. `better-sqlite3` 编译失败（非 LTS Node.js）

**现象：**

```
npm ERR! gyp ERR! find VS
npm ERR! gyp ERR! Could not find any Visual Studio installation to use
```

或者：

```
npm ERR! MSBuild.exe ENOENT
```

**原因：** 使用了奇数版本的 Node.js（如 v23、v25），没有 `better-sqlite3` 的预编译二进制文件。npm 回退到从 C++ 源码编译，需要 Visual Studio Build Tools。

**解决方案（二选一）：**

**方案 A — 切换到 Node.js 22 LTS（推荐）**

从 [https://nodejs.org](https://nodejs.org)（LTS 标签页）下载。有预编译二进制文件，无需 C++ 编译器。

```powershell
# 验证版本
node -v   # 应显示 v22.x.x
```

**方案 B — 安装 Visual Studio Build Tools**

如果必须使用非 LTS 版本的 Node：

1. 下载 [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. 在安装程序中，选择 **"使用 C++ 的桌面开发"** 工作负载
3. 安装完成后，重启 PowerShell 并重新运行：

```powershell
npm install
```

### 2. PowerShell 中 `npm install` 因 stderr 警告而失败

**现象：**

```
npm warn install Usage of the `--production` option is deprecated.
```

安装脚本退出，但实际上 npm 已经成功。

**原因：** PowerShell 的 `$ErrorActionPreference = "Stop"` 将任何 stderr 输出（包括 npm 的非致命警告）视为终止错误。

**解决方案：** 此问题已在最新的 `install.ps1` 中修复。如果是旧版本，请重新下载或更新：

```powershell
git pull
powershell -ExecutionPolicy Bypass -File install.ps1
```

### 3. CA 证书生成失败

**现象：**

```
Error: spawn openssl ENOENT
```

或者：

```
'openssl' is not recognized as an internal or external command
```

**原因：** 旧版本的 Bastion 使用 `openssl` 命令行工具生成证书，而 Windows 默认未安装此工具。

**解决方案：** 此问题已修复——Bastion 现在使用 `node-forge`（纯 JavaScript）进行所有证书操作，无需任何外部工具。

如果之前尝试启动 Bastion 时生成了损坏的证书文件，请删除后重新启动：

```powershell
Remove-Item "$env:USERPROFILE\.bastion\ca.key" -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.bastion\ca.crt" -ErrorAction SilentlyContinue
bastion start
```

### 4. 系统代理未生效

**现象：** 运行 `bastion proxy on` 后，部分应用仍然绕过代理。

**原因：** Windows 系统代理（通过注册表设置）仅影响遵循 WinINET 代理设置的应用。许多命令行工具（Node.js、Python、curl）使用自己的代理环境变量。

**解决方案：** 对于命令行工具，使用环境变量方式：

```powershell
# 在当前 PowerShell 会话中应用代理
bastion proxy on | Invoke-Expression

# 或包裹单个命令
bastion wrap claude
bastion wrap python app.py
```

`bastion proxy on` 命令同时执行两个操作——设置系统代理（用于浏览器等 GUI 应用）和写入 PowerShell profile（用于新终端会话）。

### 5. 浏览器不信任 CA 证书

**现象：** 通过 Bastion 访问 AI 提供商 API 时，浏览器显示 `NET::ERR_CERT_AUTHORITY_INVALID`。

**解决方案：** 将 CA 证书添加到 Windows 信任存储：

```powershell
# 方式 A：通过 bastion 命令（自动检测平台）
bastion proxy on --trust-ca

# 方式 B：手动添加
certutil -addstore -user Root "$env:USERPROFILE\.bastion\ca.crt"
```

### 6. 安装后找不到 `bastion` 命令

**现象：**

```
bastion : The term 'bastion' is not recognized
```

**原因：** 安装目录（`~/.bastion/app/bin`）未添加到 PATH，或者当前终端未重启。

**解决方案：**

```powershell
# 重启 PowerShell，或手动添加到当前会话：
$env:Path += ";$env:USERPROFILE\.bastion\app\bin"

# 验证
bastion --version
```

## 推荐安装步骤

```powershell
# 1. 确认 Node.js 22 LTS
node -v   # v22.x.x

# 2. 安装
cd bastion
powershell -ExecutionPolicy Bypass -File install.ps1

# 3. 启动网关
bastion start

# 4. 启用代理（当前会话 + 永久生效）
bastion proxy on | Invoke-Expression

# 5. 信任 CA 证书（一次性操作，用于浏览器访问）
bastion proxy on --trust-ca
```

**English** | [中文](windows-troubleshooting.zh.md)

# Windows Troubleshooting

Bastion supports Windows (PowerShell), but some platform-specific issues may arise during installation and startup. This guide covers the most common problems and their solutions.

## Prerequisites

- **Node.js 22 LTS** (strongly recommended)
- npm (included with Node.js)
- Git (for remote signature sync)

> **Why Node.js 22 LTS?** Bastion uses `better-sqlite3`, a native C++ module that ships prebuilt binaries only for even-numbered (LTS) Node.js releases. Odd-numbered versions (e.g., 23, 25) require compiling from source, which needs Visual Studio Build Tools — an extra 4+ GB install. Using Node 22 LTS avoids this entirely.

## Common Issues

### 1. `better-sqlite3` build failure (non-LTS Node.js)

**Symptom:**

```
npm ERR! gyp ERR! find VS
npm ERR! gyp ERR! Could not find any Visual Studio installation to use
```

Or:

```
npm ERR! MSBuild.exe ENOENT
```

**Cause:** You are using an odd-numbered Node.js version (e.g., v23, v25) that lacks prebuilt binaries for `better-sqlite3`. npm falls back to compiling from C++ source, which requires Visual Studio Build Tools.

**Solutions (choose one):**

**Option A — Switch to Node.js 22 LTS (recommended)**

Download from [https://nodejs.org](https://nodejs.org) (LTS tab). Prebuilt binaries are available and no C++ compiler is needed.

```powershell
# Verify version
node -v   # Should show v22.x.x
```

**Option B — Install Visual Studio Build Tools**

If you must use a non-LTS Node version:

1. Download [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. In the installer, select the **"Desktop development with C++"** workload
3. After installation, restart PowerShell and re-run:

```powershell
npm install
```

### 2. PowerShell `npm install` fails on stderr warnings

**Symptom:**

```
npm warn install Usage of the `--production` option is deprecated.
```

The install script exits even though npm actually succeeded.

**Cause:** PowerShell's `$ErrorActionPreference = "Stop"` treats any stderr output (including npm's non-fatal warnings) as a terminating error.

**Solution:** This has been fixed in the latest `install.ps1`. If you have an older version, re-download or update:

```powershell
git pull
powershell -ExecutionPolicy Bypass -File install.ps1
```

### 3. CA certificate generation fails

**Symptom:**

```
Error: spawn openssl ENOENT
```

Or:

```
'openssl' is not recognized as an internal or external command
```

**Cause:** Older versions of Bastion used the `openssl` command-line tool for certificate generation, which is not installed by default on Windows.

**Solution:** This has been fixed — Bastion now uses `node-forge` (pure JavaScript) for all certificate operations. No external tools are needed.

If you previously attempted to start Bastion and have corrupted certificate files, delete them and restart:

```powershell
Remove-Item "$env:USERPROFILE\.bastion\ca.key" -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.bastion\ca.crt" -ErrorAction SilentlyContinue
bastion start
```

### 4. System proxy not taking effect

**Symptom:** After running `bastion proxy on`, some applications still bypass the proxy.

**Cause:** Windows system proxy (set via registry) only affects applications that respect the WinINET proxy settings. Many CLI tools (Node.js, Python, curl) use their own proxy environment variables instead.

**Solution:** For CLI tools, use the environment variable approach:

```powershell
# Apply proxy to current PowerShell session
bastion proxy on | Invoke-Expression

# Or wrap individual commands
bastion wrap claude
bastion wrap python app.py
```

The `bastion proxy on` command does both — sets the system proxy (for GUI apps like browsers) and writes to your PowerShell profile (for new terminal sessions).

### 5. CA certificate not trusted by browsers

**Symptom:** Browser shows `NET::ERR_CERT_AUTHORITY_INVALID` when accessing AI provider APIs through Bastion.

**Solution:** Add the CA certificate to Windows trust store:

```powershell
# Option A: Via bastion command (auto-detects platform)
bastion proxy on --trust-ca

# Option B: Manual
certutil -addstore -user Root "$env:USERPROFILE\.bastion\ca.crt"
```

### 6. `bastion` command not found after install

**Symptom:**

```
bastion : The term 'bastion' is not recognized
```

**Cause:** The install directory (`~/.bastion/app/bin`) was not added to PATH, or the current terminal was not restarted.

**Solution:**

```powershell
# Restart PowerShell, or manually add to current session:
$env:Path += ";$env:USERPROFILE\.bastion\app\bin"

# Verify
bastion --version
```

## Recommended Setup

```powershell
# 1. Ensure Node.js 22 LTS
node -v   # v22.x.x

# 2. Install
cd bastion
powershell -ExecutionPolicy Bypass -File install.ps1

# 3. Start gateway
bastion start

# 4. Enable proxy (current session + permanent)
bastion proxy on | Invoke-Expression

# 5. Trust CA cert (one-time, for browser access)
bastion proxy on --trust-ca
```

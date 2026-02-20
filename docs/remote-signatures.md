# Remote Signature Patterns — Development Guide

Bastion 支持从远程 Git 仓库同步 DLP 检测规则（signatures），独立于 Bastion 自身版本更新。

---

## 架构概览

```
┌──────────────────────────────────┐
│  bastion_signature (Git repo)    │
│                                  │
│  signature.yaml   ← 版本清单     │
│  patterns/                       │
│    high-confidence.yaml          │
│    validated.yaml                │
│    context-aware.yaml            │
│    (可扩展更多 .yaml 文件)        │
└──────────┬───────────────────────┘
           │ git clone / pull
           ▼
┌──────────────────────────────────┐
│  ~/.bastion/signatures/          │
│                                  │
│  .meta.json  ← 本地版本元数据     │
│  signature.yaml                  │
│  patterns/*.yaml                 │
└──────────┬───────────────────────┘
           │ YAML 解析 → upsert
           ▼
┌──────────────────────────────────┐
│  SQLite: dlp_patterns 表          │
│                                  │
│  id = "remote-{name}"           │
│  is_builtin = 0                  │
│  (与 builtin-* / custom-* 共存)  │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│  Dashboard / API                 │
│                                  │
│  版本 badge: Signatures #1       │
│  更新提醒:   #2 available        │
│  手动同步:   Sync 按钮            │
└──────────────────────────────────┘
```

## 版本策略

有两个独立的版本号：

| 版本 | 含义 | 存放位置 | 更新频率 |
|------|------|----------|---------|
| **Git 分支名** | Bastion 兼容版本 | 仓库分支 `v0.1.0` | Bastion 大版本升级时 |
| **Signature version** | 签名修订号（整数递增） | `signature.yaml → version` | 每次 pattern 增删改 |

### 为什么分开？

- Bastion 0.1.0 的 pattern 格式可能和 0.2.0 不同（新增字段、validator 变更等）
- 同一个 Bastion 版本下，patterns 可以独立更新多次（#1 → #2 → #3）
- `branch: "auto"` 会读取 Bastion 的 `VERSION` 文件，自动映射到 `v0.1.0` 分支

---

## 仓库结构 (bastion_signature)

```
bastion_signature/
├── signature.yaml              # 版本清单（必须）
├── README.md
├── LICENSE
└── patterns/
    ├── schema.yaml             # Pattern 格式说明（不会被加载为 patterns）
    ├── high-confidence.yaml    # 高置信度 patterns
    ├── validated.yaml          # 带验证器的 patterns
    └── context-aware.yaml      # 上下文感知 patterns
```

### signature.yaml 格式

```yaml
version: 1                    # 整数，每次更新递增
updatedAt: "2026-02-20"       # 最后更新日期
patternCount: 27              # 总 pattern 数量

changelog:
  - version: 1
    date: "2026-02-20"
    changes:
      - "Initial release"
      - "27 patterns across 3 categories"
```

### Pattern YAML 格式

```yaml
patterns:
  - name: my-pattern-name       # 唯一标识符（kebab-case）
    category: high-confidence    # high-confidence | validated | context-aware | custom
    regex: 'sk-[A-Za-z0-9]{40}' # 正则表达式（字符串，不含分隔符）
    flags: g                     # 可选，默认 "g"
    description: My Pattern      # 人类可读描述
    validator: luhn              # 可选，内置验证器：luhn, ssn
    requireContext:              # 可选，上下文关键词
      - keyword1
      - keyword2
```

**注意事项：**
- `name` 全局唯一，存入 DB 时 id = `remote-{name}`
- 如果 `name` 与内置 pattern 同名（如 `aws-access-key`），由于 id 前缀不同（`builtin-` vs `remote-`），不会冲突，但 DB 的 `UNIQUE(name)` 约束会阻止插入 — 内置 pattern 优先
- `schema.yaml` 文件会被自动跳过不解析
- 任何 `.yaml` 或 `.yml` 文件都会被解析（按字母序）

---

## Bastion 端关键文件

| 文件 | 职责 |
|------|------|
| `src/dlp/remote-sync.ts` | 核心同步引擎：git clone/pull、YAML 解析、版本检查 |
| `src/config/schema.ts` | `remotePatterns` 配置类型定义 |
| `src/config/paths.ts` | `signaturesDir` = `~/.bastion/signatures/` |
| `config/default.yaml` | 默认配置（url 为空 = 禁用） |
| `src/storage/repositories/dlp-patterns.ts` | `upsertRemote()` 方法 |
| `src/plugins/builtin/dlp-scanner.ts` | 启动时调用 sync + 启动定时器 |
| `src/dashboard/api-routes.ts` | API 端点：`/api/dlp/signature`, `/api/dlp/signature/sync` |
| `src/dashboard/page.ts` | Dashboard UI：版本 badge、更新提醒、Sync 按钮 |

---

## 核心流程

### 1. 启动同步 (syncOnStart)

```
Bastion 启动
  → createDlpScannerPlugin()
    → seedBuiltins()           # 内置 patterns 写入 DB
    → syncRemotePatterns()     # 远程 patterns 同步
      → resolveBranch("auto")  # 读 VERSION → "v0.1.0"
      → syncRepo()             # git clone / pull
      → loadPatternFiles()     # 解析 patterns/*.yaml
      → upsertPatterns()       # 写入 DB (id = "remote-{name}")
      → readSignatureYaml()    # 读 signature.yaml
      → writeMetaFile()        # 保存 .meta.json
    → startPeriodicSync()      # 如果 syncIntervalMinutes > 0
```

### 2. 更新检查 (checkForUpdates)

```
Dashboard 打开 DLP tab
  → GET /api/dlp/signature?check=true
    → checkForUpdates()
      → git fetch origin              # 只 fetch，不 pull
      → git show origin/v0.1.0:signature.yaml  # 读远程版本
      → 比较 local.version vs remote.version
      → 返回 { local, remote, updateAvailable }
```

### 3. 手动同步

```
用户点击 "Sync" 按钮 / 点击 "#2 available"
  → POST /api/dlp/signature/sync
    → syncRemotePatterns()   # 完整同步流程
    → 返回 { ok, synced, signature }
  → refreshPatterns()        # UI 刷新 pattern 列表
  → refreshSignature()       # UI 刷新版本 badge
```

### 4. Pattern 写入逻辑 (upsertRemote)

```sql
-- 新 pattern：按 category 决定 enabled 状态
INSERT INTO dlp_patterns (id, name, ..., enabled)
VALUES ('remote-xxx', 'xxx', ..., 1)

-- 已存在的 pattern：更新 regex/description 等内容，但保留 enabled 状态
ON CONFLICT(id) DO UPDATE SET
  regex_source = @regex_source,
  description = @description,
  ...
  -- 注意：不覆盖 enabled 字段
```

这确保用户在 Dashboard 手动 disable 的 pattern 不会在下次同步时被重新 enable。

---

## 配置

```yaml
# ~/.bastion/config.yaml
plugins:
  dlp:
    remotePatterns:
      url: "https://github.com/aiwatching/bastion_signature.git"
      branch: "auto"            # "auto" | "v0.1.0" | "main" | ...
      syncOnStart: true         # 启动时拉取
      syncIntervalMinutes: 0    # 0 = 仅启动时，>0 = 定时同步（分钟）
```

- `url: ""` → 完全禁用远程签名
- `branch: "auto"` → 读取 `VERSION` 文件 → `v{version}`
- `syncIntervalMinutes: 60` → 每小时自动拉取一次

---

## API

| Method | Endpoint | 说明 |
|--------|----------|------|
| `GET` | `/api/dlp/signature` | 返回本地签名版本信息 |
| `GET` | `/api/dlp/signature?check=true` | 同上 + 检查远程是否有更新 |
| `POST` | `/api/dlp/signature/sync` | 手动触发同步，返回同步结果 |

### GET /api/dlp/signature?check=true 响应

```json
{
  "local": {
    "version": "1",
    "updatedAt": "2026-02-20",
    "patternCount": 27,
    "syncedAt": "2026-02-20T15:00:00.000Z",
    "repoUrl": "https://github.com/aiwatching/bastion_signature.git",
    "branch": "v0.1.0",
    "changelog": [...]
  },
  "remote": {
    "version": "2",
    "updatedAt": "2026-02-25",
    "patternCount": 30
  },
  "updateAvailable": true
}
```

### POST /api/dlp/signature/sync 响应

```json
{
  "ok": true,
  "synced": 30,
  "signature": {
    "version": "2",
    "updatedAt": "2026-02-25",
    "patternCount": 30,
    "syncedAt": "2026-02-20T16:00:00.000Z",
    "repoUrl": "...",
    "branch": "v0.1.0"
  }
}
```

---

## 开发指南

### 添加新 Pattern 到签名仓库

```bash
# 1. Clone 仓库
git clone -b v0.1.0 https://github.com/aiwatching/bastion_signature.git
cd bastion_signature

# 2. 编辑或新增 patterns/*.yaml
vim patterns/high-confidence.yaml

# 3. 更新 signature.yaml
#    - version +1
#    - patternCount 更新
#    - changelog 添加条目
vim signature.yaml

# 4. 提交推送
git add -A
git commit -m "Add discord-bot-token pattern (#2)"
git push origin v0.1.0
```

### 新建 Bastion 版本分支

当 Bastion 升级到新版本（如 0.2.0），需要在签名仓库创建对应分支：

```bash
cd bastion_signature
git checkout v0.1.0
git checkout -b v0.2.0

# 如果 pattern 格式有变化，在这里修改
# 重置 signature version 到 1 或继续递增（推荐继续递增）
vim signature.yaml

git push -u origin v0.2.0
```

### 本地测试同步

```bash
# 1. 配置 Bastion 指向本地或测试仓库
# ~/.bastion/config.yaml
plugins:
  dlp:
    remotePatterns:
      url: "https://github.com/aiwatching/bastion_signature.git"
      branch: "v0.1.0"
      syncOnStart: true

# 2. 重启 Bastion
bastion stop && bastion start

# 3. 检查日志
tail -f ~/.bastion/bastion.log | grep remote-sync

# 4. 通过 API 验证
curl http://127.0.0.1:8420/api/dlp/signature
curl http://127.0.0.1:8420/api/dlp/signature?check=true
curl -X POST http://127.0.0.1:8420/api/dlp/signature/sync
```

### 常见问题

**Q: 远程 pattern name 与内置 pattern name 重复怎么办？**

DB 中 `name` 有 UNIQUE 约束。由于内置 patterns 先 seed（id = `builtin-{name}`），远程 pattern 的 `upsertRemote` 使用 `ON CONFLICT(id)` 不会触发 name 冲突 — 但 `INSERT` 时会因为 name 重复而失败。解决方案：远程 pattern 应使用不同的 name，或在 `upsertRemote` 中改用 `ON CONFLICT(name)` 策略。

> **TODO**: 当前实现中，远程 pattern 如果与内置 pattern 同名会被静默跳过（INSERT 失败被 try-catch 吞掉）。如果需要"远程覆盖内置"语义，需要修改 upsert 策略。

**Q: git 不可用或网络不通怎么办？**

同步失败只打 warn 日志，不影响 Bastion 启动。已有的本地 patterns（内置 + 之前同步的远程）继续生效。

**Q: 定时同步会阻塞请求处理吗？**

`syncRemotePatterns()` 是同步调用（`execSync`），在定时器回调中执行。git pull 通常 < 1s（shallow clone），YAML 解析和 DB upsert 也很快。但如果网络慢（timeout 30s），会短暂阻塞。

> **TODO**: 可以考虑改为异步（worker thread 或 child process）避免阻塞主线程。

---

## 文件存储

```
~/.bastion/
  signatures/               # git clone 的签名仓库
    .git/
    .meta.json              # 本地版本元数据
    signature.yaml          # 远程清单
    patterns/
      high-confidence.yaml
      validated.yaml
      context-aware.yaml
      schema.yaml
  bastion.db                # SQLite: dlp_patterns 表存储最终 patterns
```

`dlp_patterns` 表中 pattern 的 id 前缀区分来源：

| 前缀 | 来源 | 可删除 |
|------|------|--------|
| `builtin-` | 内置（源码） | 不可删除，可禁用 |
| `remote-` | 远程签名仓库 | 不可删除，可禁用 |
| `custom-` | 用户手动添加 | 可删除 |

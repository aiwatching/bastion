# Tool Guard 误报修复记录

> 状态：**已实现**
> 实现日期：2026-02-27

---

## 问题描述

Tool Guard 对几乎所有请求都触发 block，包括正常的工具调用。根因分析发现三个层面的问题：

### 1. `shouldAlert` 边界 bug（最严重）

```typescript
// 修复前
export function shouldAlert(severity: string, minSeverity: string): boolean {
  return (SEVERITY_RANK[severity] ?? 0) >= (SEVERITY_RANK[minSeverity] ?? 0);
}
```

当 `minSeverity` 为无效值（空字符串、`"none"`、`undefined` 被强制转换等）时，`SEVERITY_RANK[minSeverity] ?? 0 = 0`，而任何有效 severity 的 rank >= 1，导致所有规则命中都触发 block。

### 2. 规则没有 Tool Name 上下文

所有规则对所有工具一视同仁，`write_file`、`str_replace_editor`、`search` 等工具的 input 内容里只要出现 `rm`、`sudo`、`curl -d` 等字样就会命中，产生大量误报。

典型误报场景：
```
write_file(path="/tmp/setup.sh", content="#!/bin/bash\nrm -rf /tmp/old_build\n")
```
→ 命中 `fs-rm` 规则 → 误 block（写文件，不是执行命令）

### 3. `git-force-push` 正则错误

```
pattern: /git\s+push\s+[^\n]*(?:--force|-f\b)/i
```

`--force` 没有边界限定，`--force-with-lease`（安全操作）也会命中。

---

## 修复方案

### A — 加 Tool Name 约束（`src/tool-guard/rules.ts`）

新增 `SHELL_TOOL_PATTERN` 常量，匹配确实会执行 shell 命令的工具名：

```typescript
const SHELL_TOOL_PATTERN = /bash|shell|exec|terminal|computer|repl/i;
```

对所有 exec / fs / credential / network / git / package / system 类规则（共 24 条）加上：

```typescript
match: { toolName: SHELL_TOOL_PATTERN, inputPattern: /.../ }
```

**效果**：`write_file`、`read_file`、`str_replace_editor`、`search`、`browser` 等工具不再触发这些规则，因为它们的名字不包含执行类关键词。

**例外**：`write-etc` 和 `write-usr` 两条规则不加 toolName 约束，写入系统路径无论用什么工具都应该检测。

### C1 — 修复 `shouldAlert` 边界处理（`src/tool-guard/alert.ts`）

```typescript
export function shouldAlert(severity: string, minSeverity: string): boolean {
  const minRank = SEVERITY_RANK[minSeverity];
  if (minRank === undefined) return false; // 无效配置 → 不 block，而非全 block
  return (SEVERITY_RANK[severity] ?? 0) >= minRank;
}
```

无效 `minSeverity` 时行为从"全 block"改为"不 block"，配置错误不再导致全量拦截。

### C2 — 修复 `git-force-push` 正则（`src/tool-guard/rules.ts`）

```typescript
// 修复前
inputPattern: /git\s+push\s+[^\n]*(?:--force|-f\b)/i

// 修复后（加负向前瞻）
inputPattern: /git\s+push\s+[^\n]*(?:--force(?!-with-lease)|-f\b)/i
```

`--force-with-lease` 不再误报，`--force` 和 `-f` 仍然正常检测。

### DB — `seedBuiltins` 改为 UPSERT（`src/storage/repositories/tool-guard-rules.ts`）

原来是 `INSERT OR IGNORE`，已启动的实例不会拿到规则定义的变更（如新增的 `tool_name_pattern`）。改为：

```sql
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  severity = excluded.severity,
  tool_name_pattern = excluded.tool_name_pattern,
  ...
  -- enabled 字段不更新，保留用户在 Dashboard 里的开关状态
```

每次启动自动同步最新规则定义，用户的启用/禁用状态不受影响。

---

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/tool-guard/alert.ts` | `shouldAlert` 无效 minSeverity 时返回 false |
| `src/tool-guard/rules.ts` | 新增 `SHELL_TOOL_PATTERN`；24 条规则加 `toolName` 约束；修复 git-force-push 正则 |
| `src/storage/repositories/tool-guard-rules.ts` | `seedBuiltins` 改为 UPSERT，保留 enabled 状态 |

---

## 未解决 / 后续优化

- `SHELL_TOOL_PATTERN` 使用子串匹配，自定义工具名若不含上述关键词则不受保护（如工具名为 `do_action`）；可考虑允许用户在配置中自定义可信工具名白名单
- `write-etc` / `write-usr` 的 inputPattern 包含 `write_file` 关键词，但实际上 `write_file` 工具写 `/etc/` 路径不会被捕获（JSON 序列化后 path 字段前没有匹配前缀）——规则存在漏洞，待修

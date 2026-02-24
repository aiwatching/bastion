export interface ToolGuardRule {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  match: {
    toolName?: RegExp;
    inputPattern?: RegExp;
  };
}

export const BUILTIN_RULES: ToolGuardRule[] = [
  // ── destructive-fs (critical) ──
  {
    id: 'fs-rm-rf-root',
    name: 'Recursive delete root/home',
    description: 'rm -rf targeting / or ~ or /home',
    severity: 'critical',
    category: 'destructive-fs',
    match: { inputPattern: /rm\s+-[^\n]*r[^\n]*f[^\n]*\s+(?:\/(?:\s|"|$)|\/*(?:\s|"|$)|~\/?(?:\s|"|$)|~\/?\*|\/home)/i },
  },
  {
    id: 'fs-rm-rf-wildcard',
    name: 'Recursive delete with wildcard',
    description: 'rm -rf with dangerous wildcard patterns',
    severity: 'critical',
    category: 'destructive-fs',
    match: { inputPattern: /rm\s+-[^\n]*rf\s+(?:\.\s|\.\*|\*\s|\/\*)/i },
  },
  {
    id: 'fs-chmod-777',
    name: 'chmod 777 on sensitive paths',
    description: 'Making files world-writable',
    severity: 'high',
    category: 'destructive-fs',
    match: { inputPattern: /chmod\s+(?:-[^\n]*)?\s*777/i },
  },
  {
    id: 'fs-mkfs',
    name: 'Format filesystem',
    description: 'mkfs on a block device',
    severity: 'critical',
    category: 'destructive-fs',
    match: { inputPattern: /mkfs\b/i },
  },
  {
    id: 'fs-dd-device',
    name: 'dd to block device',
    description: 'dd writing directly to a device',
    severity: 'critical',
    category: 'destructive-fs',
    match: { inputPattern: /dd\s+[^\n]*of=\/dev\//i },
  },

  // ── code-execution (critical) ──
  {
    id: 'exec-curl-pipe',
    name: 'curl pipe to shell',
    description: 'Piping remote content directly to a shell interpreter',
    severity: 'critical',
    category: 'code-execution',
    match: { inputPattern: /curl\s+[^\n|]*\|\s*(?:bash|sh|zsh|python|perl|ruby|node)/i },
  },
  {
    id: 'exec-wget-pipe',
    name: 'wget pipe to shell',
    description: 'Piping wget output to a shell interpreter',
    severity: 'critical',
    category: 'code-execution',
    match: { inputPattern: /wget\s+[^\n|]*\|\s*(?:bash|sh|zsh|python|perl|ruby|node)/i },
  },
  {
    id: 'exec-eval',
    name: 'eval() on dynamic input',
    description: 'Using eval on variables or external input',
    severity: 'high',
    category: 'code-execution',
    match: { inputPattern: /\beval\s*\(/i },
  },
  {
    id: 'exec-base64-decode-pipe',
    name: 'base64 decode and execute',
    description: 'Decoding base64 content and piping to shell',
    severity: 'critical',
    category: 'code-execution',
    match: { inputPattern: /base64\s+(?:-d|--decode)[^\n|]*\|\s*(?:bash|sh|zsh)/i },
  },

  // ── credential-access (high) ──
  {
    id: 'cred-env-read',
    name: 'Read .env file',
    description: 'Reading environment files that may contain secrets',
    severity: 'high',
    category: 'credential-access',
    match: { inputPattern: /(?:cat|less|more|head|tail|bat|type|get-content)\s+[^\n]*\.env\b/i },
  },
  {
    id: 'cred-private-key',
    name: 'Access private key',
    description: 'Reading SSH or TLS private key files',
    severity: 'high',
    category: 'credential-access',
    match: { inputPattern: /(?:cat|less|more|head|tail|bat|type|get-content)\s+[^\n]*(?:id_rsa|id_ed25519|\.pem|private[_-]?key)/i },
  },
  {
    id: 'cred-aws-credentials',
    name: 'Access AWS credentials',
    description: 'Reading AWS credentials or config files',
    severity: 'high',
    category: 'credential-access',
    match: { inputPattern: /(?:cat|less|more|head|tail|bat|type|get-content)\s+[^\n]*(?:\.aws\/credentials|\.aws\/config)/i },
  },
  {
    id: 'cred-secret-env-var',
    name: 'Echo secret environment variable',
    description: 'Printing sensitive environment variables',
    severity: 'high',
    category: 'credential-access',
    match: { inputPattern: /(?:echo|printf|print)\s+[^\n]*\$(?:AWS_SECRET|PRIVATE_KEY|API_KEY|SECRET_KEY|DATABASE_URL|DB_PASSWORD)/i },
  },

  // ── network-exfil (high) ──
  {
    id: 'net-curl-post-data',
    name: 'curl POST with data',
    description: 'Sending data via curl POST to an external endpoint',
    severity: 'medium',
    category: 'network-exfil',
    match: { inputPattern: /curl\s+[^\n]*(?:-X\s*POST|-d\s|--data)/i },
  },
  {
    id: 'net-exfil-to-ip',
    name: 'Data transfer to raw IP',
    description: 'Sending data to a raw IP address (potential exfiltration)',
    severity: 'high',
    category: 'network-exfil',
    match: { inputPattern: /(?:curl|wget|nc|ncat)\s+[^\n]*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i },
  },

  // ── git-destructive (high) ──
  {
    id: 'git-force-push',
    name: 'git force push',
    description: 'Force pushing can overwrite remote history',
    severity: 'high',
    category: 'git-destructive',
    match: { inputPattern: /git\s+push\s+[^\n]*(?:--force|-f\b)/i },
  },
  {
    id: 'git-reset-hard',
    name: 'git reset --hard',
    description: 'Hard reset discards uncommitted changes',
    severity: 'high',
    category: 'git-destructive',
    match: { inputPattern: /git\s+reset\s+--hard/i },
  },
  {
    id: 'git-clean-force',
    name: 'git clean -f',
    description: 'Force-cleaning untracked files',
    severity: 'medium',
    category: 'git-destructive',
    match: { inputPattern: /git\s+clean\s+[^\n]*-[^\n]*f/i },
  },

  // ── package-publish (medium) ──
  {
    id: 'pkg-npm-publish',
    name: 'npm publish',
    description: 'Publishing package to npm registry',
    severity: 'medium',
    category: 'package-publish',
    match: { inputPattern: /npm\s+publish/i },
  },
  {
    id: 'pkg-pip-upload',
    name: 'pip/twine upload',
    description: 'Uploading package to PyPI',
    severity: 'medium',
    category: 'package-publish',
    match: { inputPattern: /(?:twine\s+upload|pip\s+.*upload)/i },
  },

  // ── system-config (medium) ──
  {
    id: 'sys-sudo',
    name: 'sudo command',
    description: 'Executing command with elevated privileges',
    severity: 'medium',
    category: 'system-config',
    match: { inputPattern: /\bsudo\s+/i },
  },
  {
    id: 'sys-iptables',
    name: 'iptables modification',
    description: 'Modifying firewall rules',
    severity: 'medium',
    category: 'system-config',
    match: { inputPattern: /\biptables\s+/i },
  },
  {
    id: 'sys-systemctl',
    name: 'systemctl service control',
    description: 'Starting/stopping/enabling system services',
    severity: 'medium',
    category: 'system-config',
    match: { inputPattern: /\bsystemctl\s+(?:start|stop|enable|disable|restart)/i },
  },

  // ── file-write-outside (low) ──
  {
    id: 'write-etc',
    name: 'Write to /etc/',
    description: 'Writing to system configuration directory',
    severity: 'low',
    category: 'file-write-outside',
    match: { inputPattern: /(?:>|tee|write_file|Write)\s*[^\n]*\/etc\//i },
  },
  {
    id: 'write-usr',
    name: 'Write to /usr/',
    description: 'Writing to system binaries directory',
    severity: 'low',
    category: 'file-write-outside',
    match: { inputPattern: /(?:>|tee|write_file|Write)\s*[^\n]*\/usr\//i },
  },
];

export interface RuleMatch {
  rule: ToolGuardRule;
  matchedText: string;
}

export function matchRules(
  toolName: string,
  toolInput: Record<string, unknown> | string,
  rules: ToolGuardRule[] = BUILTIN_RULES,
): RuleMatch | null {
  const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);

  for (const rule of rules) {
    // Check tool name pattern if specified
    if (rule.match.toolName && !rule.match.toolName.test(toolName)) continue;

    // Check input pattern
    if (rule.match.inputPattern) {
      const m = rule.match.inputPattern.exec(inputStr);
      if (m) {
        return { rule, matchedText: m[0] };
      }
    }
  }

  return null;
}

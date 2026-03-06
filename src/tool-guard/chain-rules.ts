export interface ToolChainRule {
  id: string;
  name: string;
  description: string;
  sequence: string[];      // category sequence: ['credential-access', 'network-exfil']
  windowSeconds: number;   // time window for the full sequence
  action: 'warn' | 'block';
}

export const BUILTIN_CHAIN_RULES: ToolChainRule[] = [
  {
    id: 'chain-exfil-after-cred',
    name: 'Exfiltration after credential access',
    description: 'Network data transfer detected after credential file access within 5 minutes',
    sequence: ['credential-access', 'network-exfil'],
    windowSeconds: 300,
    action: 'block',
  },
  {
    id: 'chain-destruct-after-exec',
    name: 'Destructive action after code execution',
    description: 'Destructive filesystem operation detected after remote code execution within 3 minutes',
    sequence: ['code-execution', 'destructive-fs'],
    windowSeconds: 180,
    action: 'warn',
  },
  {
    id: 'chain-publish-after-cred',
    name: 'Package publish after credential access',
    description: 'Package publish detected after credential access within 10 minutes',
    sequence: ['credential-access', 'package-publish'],
    windowSeconds: 600,
    action: 'block',
  },
];

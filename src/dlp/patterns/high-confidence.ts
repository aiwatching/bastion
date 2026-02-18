import type { DlpPattern } from '../engine.js';

/** High-confidence patterns: very low false positive rate */
export const highConfidencePatterns: DlpPattern[] = [
  {
    name: 'aws-access-key',
    category: 'high-confidence',
    regex: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g,
    description: 'AWS Access Key ID',
  },
  {
    name: 'aws-secret-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
    description: 'AWS Secret Access Key (40-char base64)',
    // This is broad — only used when near "aws" or "secret" context
    requireContext: ['aws', 'secret', 'AWS_SECRET'],
  },
  {
    name: 'github-token',
    category: 'high-confidence',
    regex: /ghp_[A-Za-z0-9]{36}/g,
    description: 'GitHub Personal Access Token',
  },
  {
    name: 'github-fine-grained-token',
    category: 'high-confidence',
    regex: /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/g,
    description: 'GitHub Fine-grained PAT',
  },
  {
    name: 'slack-token',
    category: 'high-confidence',
    regex: /xox[bporas]-[0-9]{10,13}-[A-Za-z0-9-]{20,}/g,
    description: 'Slack Token',
  },
  {
    name: 'stripe-secret-key',
    category: 'high-confidence',
    regex: /sk_live_[A-Za-z0-9]{24,}/g,
    description: 'Stripe Secret Key',
  },
  {
    name: 'private-key',
    category: 'high-confidence',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    description: 'Private Key Header',
  },
];

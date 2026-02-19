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
    regex: /(?<![A-Za-z0-9/+=_-])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=_-])/g,
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

  // ── LLM Provider API Keys ──

  {
    name: 'openai-api-key',
    category: 'high-confidence',
    regex: /sk-(?!ant-)[A-Za-z0-9_-]{40,}/g,
    description: 'OpenAI API Key (also matches DeepSeek, Moonshot, Tongyi, and other sk- prefixed keys)',
  },
  {
    name: 'anthropic-api-key',
    category: 'high-confidence',
    regex: /sk-ant-[A-Za-z0-9_-]{36,}/g,
    description: 'Anthropic API Key',
  },
  {
    name: 'google-ai-api-key',
    category: 'high-confidence',
    regex: /AIzaSy[A-Za-z0-9_-]{33}/g,
    description: 'Google AI / Gemini API Key',
  },
  {
    name: 'huggingface-token',
    category: 'high-confidence',
    regex: /hf_[A-Za-z0-9]{20,}/g,
    description: 'Hugging Face Access Token',
  },
  {
    name: 'replicate-api-token',
    category: 'high-confidence',
    regex: /r8_[A-Za-z0-9]{37,}/g,
    description: 'Replicate API Token',
  },
  {
    name: 'groq-api-key',
    category: 'high-confidence',
    regex: /gsk_[A-Za-z0-9]{48,}/g,
    description: 'Groq API Key',
  },
  {
    name: 'perplexity-api-key',
    category: 'high-confidence',
    regex: /pplx-[A-Za-z0-9]{48,}/g,
    description: 'Perplexity API Key',
  },
  {
    name: 'xai-api-key',
    category: 'high-confidence',
    regex: /xai-[A-Za-z0-9]{48,}/g,
    description: 'xAI (Grok) API Key',
  },
  {
    name: 'cohere-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])[A-Za-z0-9]{40}(?![A-Za-z0-9_-])/g,
    description: 'Cohere / Mistral / Together AI API Key (40-char token)',
    requireContext: ['cohere', 'CO_API_KEY', 'mistral', 'MISTRAL_API_KEY', 'together', 'TOGETHER_API_KEY'],
  },
  {
    name: 'azure-openai-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])[a-f0-9]{32}(?![A-Za-z0-9_-])/g,
    description: 'Azure OpenAI API Key (32-char hex)',
    requireContext: ['azure', 'AZURE_OPENAI', 'openai.azure.com'],
  },
];

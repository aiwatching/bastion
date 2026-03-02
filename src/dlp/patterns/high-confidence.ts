import type { DlpPattern } from '../engine.js';

/** High-confidence patterns: very low false positive rate */
export const highConfidencePatterns: DlpPattern[] = [
  {
    name: 'aws-access-key',
    category: 'high-confidence',
    regex: /(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])/g,
    description: 'AWS Access Key ID',
    contextVerify: {
      confirmPatterns: [/(?:aws|amazon|iam|access.?key|secret.?key|credential)/i],
    },
  },
  {
    name: 'aws-secret-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9/+_-])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+_-])/g,
    description: 'AWS Secret Access Key (40-char base64)',
    // This is broad — only used when near "aws" or "secret" context
    requireContext: ['aws', 'AWS_SECRET', 'AWS_SECRET_ACCESS_KEY'],
    contextVerify: { minEntropy: 3.5 },
  },
  {
    name: 'github-token',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{36}(?![A-Za-z0-9_-])/g,
    description: 'GitHub Personal Access Token (ghp_/gho_/ghs_/ghr_)',
  },
  {
    name: 'github-fine-grained-token',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}(?![A-Za-z0-9_-])/g,
    description: 'GitHub Fine-grained PAT',
  },
  {
    name: 'slack-token',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])xox[bporas]-[0-9]{10,13}-[A-Za-z0-9-]{20,}(?![A-Za-z0-9_-])/g,
    description: 'Slack Token',
  },
  {
    name: 'stripe-secret-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])sk_(?:live|test)_[A-Za-z0-9]{24,}(?![A-Za-z0-9_-])/g,
    description: 'Stripe Secret Key (sk_live_/sk_test_)',
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
    regex: /(?<![A-Za-z0-9_-])sk-(?!ant-)[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g,
    description: 'OpenAI API Key (also matches DeepSeek, Moonshot, Tongyi, and other sk- prefixed keys)',
    contextVerify: {
      confirmPatterns: [/(?:api|key|token|secret|openai|deepseek|moonshot|credential|bearer)/i],
      minEntropy: 3.5,
    },
  },
  {
    name: 'anthropic-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{36,}(?![A-Za-z0-9_-])/g,
    description: 'Anthropic API Key',
  },
  {
    name: 'google-ai-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])AIzaSy[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])/g,
    description: 'Google AI / Gemini API Key',
  },
  {
    name: 'huggingface-token',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])hf_[A-Za-z0-9]{20,}(?![A-Za-z0-9_-])/g,
    description: 'Hugging Face Access Token',
  },
  {
    name: 'replicate-api-token',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])r8_[A-Za-z0-9]{37,}(?![A-Za-z0-9_-])/g,
    description: 'Replicate API Token',
    requireContext: ['replicate', 'REPLICATE', 'REPLICATE_API_TOKEN'],
  },
  {
    name: 'groq-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])gsk_[A-Za-z0-9]{48,}(?![A-Za-z0-9_-])/g,
    description: 'Groq API Key',
  },
  {
    name: 'perplexity-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])pplx-[A-Za-z0-9]{48,}(?![A-Za-z0-9_-])/g,
    description: 'Perplexity API Key',
  },
  {
    name: 'xai-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])xai-[A-Za-z0-9]{48,}(?![A-Za-z0-9_-])/g,
    description: 'xAI (Grok) API Key',
  },
  {
    name: 'cohere-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])[A-Za-z0-9]{40}(?![A-Za-z0-9_-])/g,
    description: 'Cohere / Mistral / Together AI API Key (40-char token)',
    requireContext: ['cohere', 'CO_API_KEY', 'mistral', 'MISTRAL_API_KEY', 'TOGETHER_API_KEY', 'TOGETHER_AI'],
    contextVerify: { minEntropy: 3.5 },
  },
  {
    name: 'azure-openai-api-key',
    category: 'high-confidence',
    regex: /(?<![A-Za-z0-9_-])[a-f0-9]{32}(?![A-Za-z0-9_-])/g,
    description: 'Azure OpenAI API Key (32-char hex)',
    requireContext: ['azure', 'AZURE_OPENAI', 'openai.azure.com'],
    contextVerify: { minEntropy: 3.5 },
  },
  {
    name: 'telegram-bot-token',
    category: 'high-confidence',
    regex: /\b\d{8,10}:AA[A-Za-z0-9_-]{33,35}\b/g,
    description: 'Telegram Bot Token',
  },
  {
    name: 'password-assignment',
    category: 'high-confidence',
    regex: /(?:password|passwd|pwd|pass_?word|secret_?key|auth_?token|access_?token|api_?key|apikey|credential)[\s]*=\s*['"]?(?!(?:localStorage|document|window|console|JSON|Object|Array|Math|Date|String|Number|Boolean|null\b|undefined\b|true\b|false\b|function\b|new |this\.|self\.|require|import|export|return |typeof |void |os\.|config\.|process\.env|getenv|settings\.|env\[|environ|\$\{|System\.))([^\s'"(]{6,})/gi,
    description: 'Password or secret assignment (key=value pattern)',
    contextVerify: {
      antiPatterns: [/(?:example|placeholder|your[_-]?|xxx|test[_-]?|sample|dummy|changeme)/i],
    },
  },
];

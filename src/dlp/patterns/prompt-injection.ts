import type { DlpPattern } from '../engine.js';

/** Prompt injection detection patterns (OWASP LLM01) */
export const promptInjectionPatterns: DlpPattern[] = [
  // ── instruction-override (6) ──
  {
    name: 'pi-ignore-prev',
    category: 'prompt-injection',
    regex: /ignore\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|rules?|context)/gi,
    description: 'Instruction override: ignore previous instructions',
  },
  {
    name: 'pi-disregard',
    category: 'prompt-injection',
    regex: /disregard\s+(all|any|your|the)\s+(previous|prior|system|above)/gi,
    description: 'Instruction override: disregard previous',
  },
  {
    name: 'pi-forget',
    category: 'prompt-injection',
    regex: /forget\s+(everything|all|your)\s+(previous\s+)?(instructions?|rules?|training|guidelines)/gi,
    description: 'Instruction override: forget instructions',
  },
  {
    name: 'pi-new-instructions',
    category: 'prompt-injection',
    regex: /new\s+instructions?\s*:/gi,
    description: 'Instruction override: new instructions directive',
    requireContext: ['ignore', 'system', 'override', 'jailbreak', 'pretend', 'forget', 'disregard', 'you are'],
  },
  {
    name: 'pi-do-not-follow',
    category: 'prompt-injection',
    regex: /do\s+not\s+follow\s+(your|the|any)\s+(rules|guidelines|instructions|safety)/gi,
    description: 'Instruction override: do not follow rules',
  },
  {
    name: 'pi-stop-being',
    category: 'prompt-injection',
    regex: /stop\s+being\s+(a|an)?\s*(helpful|safe|responsible|ethical)\s*(assistant|AI)?/gi,
    description: 'Instruction override: stop being safe/helpful',
  },

  // ── role-injection (5) ──
  {
    name: 'pi-you-are-now',
    category: 'prompt-injection',
    regex: /you\s+are\s+now\s+(a|an|the|in)\s+/gi,
    description: 'Role injection: you are now...',
    requireContext: ['ignore', 'instruction', 'system', 'pretend', 'override', 'jailbreak'],
  },
  {
    name: 'pi-pretend',
    category: 'prompt-injection',
    regex: /pretend\s+(you\s+are|to\s+be|you're|that\s+you)\s+/gi,
    description: 'Role injection: pretend to be...',
    requireContext: ['ignore', 'instruction', 'system', 'override', 'jailbreak', 'bypass', 'disregard', 'forget'],
  },
  {
    name: 'pi-no-restrictions',
    category: 'prompt-injection',
    regex: /act\s+as\s+if\s+(you\s+have\s+)?no\s+(restrictions|rules|limits|boundaries)/gi,
    description: 'Role injection: act without restrictions',
  },
  {
    name: 'pi-from-now-on',
    category: 'prompt-injection',
    regex: /from\s+now\s+on\s+you\s+(are|will|must|should)\s+/gi,
    description: 'Role injection: from now on you will...',
    requireContext: ['ignore', 'instruction', 'system', 'pretend', 'override', 'jailbreak'],
  },
  {
    name: 'pi-entering-mode',
    category: 'prompt-injection',
    regex: /entering\s+(?:unrestricted|god|admin|root|sudo)\s+mode/gi,
    description: 'Role injection: entering unrestricted/god/admin mode',
  },

  // ── system-manipulation (6) ──
  {
    name: 'pi-system-bracket',
    category: 'prompt-injection',
    regex: /\[SYSTEM\s*(?:UPDATE|NOTE|OVERRIDE|PROMPT)\s*\]/gi,
    description: 'System manipulation: fake [SYSTEM] bracket tag',
  },
  {
    name: 'pi-system-xml',
    category: 'prompt-injection',
    regex: /<\s*\/?(?:system|SYSTEM|instruction|INSTRUCTION)\s*>/gi,
    description: 'System manipulation: fake <system>/<instruction> XML tag',
    contextVerify: { rejectInCodeBlock: true },
  },
  {
    name: 'pi-inst-token',
    category: 'prompt-injection',
    regex: /\[INST\]|\[\/INST\]|<<SYS>>|<\|(?:im_start|im_end|system|user|assistant)\|>/gi,
    description: 'System manipulation: model-specific instruction tokens',
    contextVerify: { rejectInCodeBlock: true },
  },
  {
    name: 'pi-markdown-system',
    category: 'prompt-injection',
    regex: /^#{1,3}\s*(?:system|instruction|directive)\s*(?:prompt|override)?/gim,
    description: 'System manipulation: markdown heading system/instruction',
    requireContext: ['ignore', 'override', 'jailbreak', 'bypass', 'pretend', 'forget', 'disregard'],
    contextVerify: { rejectInCodeBlock: true },
  },
  {
    name: 'pi-codeblock-system',
    category: 'prompt-injection',
    regex: /```\s*(?:system|instruction)/gi,
    description: 'System manipulation: code block with system/instruction label',
    requireContext: ['ignore', 'override', 'jailbreak', 'bypass', 'pretend', 'forget', 'disregard'],
  },
  {
    name: 'pi-assistant-prefix',
    category: 'prompt-injection',
    regex: /^assistant\s*:/gim,
    description: 'System manipulation: fake assistant: prefix',
    requireContext: ['ignore', 'instruction', 'system', 'pretend', 'override', 'jailbreak'],
  },

  // ── prompt-leaking (5) ──
  {
    name: 'pi-reveal-prompt',
    category: 'prompt-injection',
    regex: /reveal\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules|configuration)/gi,
    description: 'Prompt leaking: reveal your prompt/instructions',
  },
  {
    name: 'pi-show-prompt',
    category: 'prompt-injection',
    regex: /show\s+(?:me\s+)?(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules)/gi,
    description: 'Prompt leaking: show me your prompt',
  },
  {
    name: 'pi-repeat-above',
    category: 'prompt-injection',
    regex: /repeat\s+(?:everything|all|the\s+text)\s+(?:above|before|prior)/gi,
    description: 'Prompt leaking: repeat everything above',
  },
  {
    name: 'pi-output-prompt',
    category: 'prompt-injection',
    regex: /output\s+(?:the\s+)?(?:full|complete|entire)\s+(?:prompt|instructions?)/gi,
    description: 'Prompt leaking: output full prompt/instructions',
  },
  {
    name: 'pi-print-above',
    category: 'prompt-injection',
    regex: /(?:print|type|write|display)\s+(?:everything|all|the\s+text)\s+(?:above|before)/gi,
    description: 'Prompt leaking: print/display everything above',
  },

  // ── jailbreak (7) ──
  {
    name: 'pi-jailbreak-keyword',
    category: 'prompt-injection',
    regex: /\bjailbreak\b/gi,
    description: 'Jailbreak: keyword "jailbreak"',
    requireContext: ['ignore', 'instruction', 'system', 'override', 'bypass', 'AI', 'LLM', 'chatbot', 'GPT', 'prompt'],
  },
  {
    name: 'pi-dan-mode',
    category: 'prompt-injection',
    regex: /\bDAN\s+(?:mode|prompt)\b/g,
    description: 'Jailbreak: DAN mode (Do Anything Now)',
  },
  {
    name: 'pi-dan-phrase',
    category: 'prompt-injection',
    regex: /do\s+anything\s+now/gi,
    description: 'Jailbreak: "do anything now" phrase',
  },
  {
    name: 'pi-developer-mode',
    category: 'prompt-injection',
    regex: /(?:you\s+are\s+now\s+in\s+)?developer\s+mode/gi,
    description: 'Jailbreak: developer mode activation',
    requireContext: ['ignore', 'instruction', 'system', 'override', 'jailbreak', 'bypass', 'pretend', 'disregard'],
  },
  {
    name: 'pi-override-safety',
    category: 'prompt-injection',
    regex: /override\s+(?:safety|content|security)\s+(?:filter|policy|rules|checks)/gi,
    description: 'Jailbreak: override safety filters/policy',
  },
  {
    name: 'pi-bypass-filter',
    category: 'prompt-injection',
    regex: /bypass\s+(?:the\s+)?(?:safety|content|security|ethical)\s+(?:filter|check|guard)/gi,
    description: 'Jailbreak: bypass safety/content filter',
  },
  {
    name: 'pi-no-rules',
    category: 'prompt-injection',
    regex: /(?:without|remove)\s+(?:any\s+)?(?:restrictions|rules|limits|safety|filters|censorship)/gi,
    description: 'Jailbreak: remove restrictions/rules/safety',
    requireContext: ['ignore', 'instruction', 'system', 'override', 'jailbreak', 'bypass', 'pretend', 'respond'],
  },

  // ── encoding-obfuscation (3) ──
  {
    name: 'pi-zero-width',
    category: 'prompt-injection',
    regex: /[\u200B\u200C\uFEFF\u2060-\u2064]/g,
    description: 'Encoding obfuscation: zero-width characters (excludes ZWJ used in emoji)',
  },
  {
    name: 'pi-bidi-override',
    category: 'prompt-injection',
    regex: /[\u202A-\u202E\u2066-\u2069]/g,
    description: 'Encoding obfuscation: bidirectional text override characters',
  },
  {
    name: 'pi-control-chars',
    category: 'prompt-injection',
    regex: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
    description: 'Encoding obfuscation: unexpected control characters',
  },

  // ── delimiter-injection (2) ──
  {
    name: 'pi-newline-injection',
    category: 'prompt-injection',
    regex: /\n{3,}\s*(?:ignore|forget|disregard|system|instruction|override)/gi,
    description: 'Delimiter injection: multiple newlines followed by instruction override',
  },
  {
    name: 'pi-separator-injection',
    category: 'prompt-injection',
    regex: /(?:---{3,}|==={3,})\s*\n\s*(?:system|instruction|ignore|forget)/gi,
    description: 'Delimiter injection: separator line followed by system/instruction keyword',
  },

  // ── indirect-injection (2) ──
  {
    name: 'pi-html-comment',
    category: 'prompt-injection',
    regex: /<!--\s*(?:ignore|disregard|forget|override|system|instruction|you\s+are)/gi,
    description: 'Indirect injection: HTML comment with injection payload',
  },
  {
    name: 'pi-hidden-tag',
    category: 'prompt-injection',
    regex: /\[(?:hidden|secret|system)\s*(?:instruction|prompt|directive)\]/gi,
    description: 'Indirect injection: [hidden instruction] / [system prompt] tag',
  },
];

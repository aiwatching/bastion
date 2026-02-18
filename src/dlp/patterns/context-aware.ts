import type { DlpPattern } from '../engine.js';

/** Context-aware patterns: only flag when surrounding text confirms the match */
export const contextAwarePatterns: DlpPattern[] = [
  {
    name: 'email-address',
    category: 'context-aware',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    description: 'Email Address',
    requireContext: ['email', 'contact', 'user', 'customer', 'address', 'send to', 'mailto'],
  },
  {
    name: 'phone-number',
    category: 'context-aware',
    regex: /\b(?:\+1[-.\s]?)?(?:\(?[0-9]{3}\)?[-.\s]?)?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    description: 'US Phone Number',
    requireContext: ['phone', 'call', 'tel', 'mobile', 'cell', 'fax', 'contact'],
  },
  {
    name: 'ip-address',
    category: 'context-aware',
    regex: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    description: 'IPv4 Address',
    requireContext: ['ip', 'server', 'host', 'address', 'connect', 'network'],
  },
];

import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from '../config/paths.js';

const LICENSE_SECRET = 'bastion-pro-license-key-2026';
const LICENSE_PREFIX = 'BST';
const VALID_PLANS = new Map<string, ProLicenseInfo['plan']>([
  ['PRO', 'pro'],
  ['ENT', 'enterprise'],
]);

export interface ProLicenseInfo {
  valid: boolean;
  plan: 'pro' | 'enterprise' | null;
  expiresAt: Date | null;
  error?: string;
}

function computeSignature(plan: string, expiry: string): string {
  return createHmac('sha256', LICENSE_SECRET)
    .update(plan + expiry)
    .digest('hex')
    .slice(0, 12);
}

function parseExpiry(raw: string): Date | null {
  if (raw.length !== 8) return null;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6));
  const d = Number(raw.slice(6, 8));
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null;
  const date = new Date(y, m - 1, d, 23, 59, 59, 999);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

const INVALID = (error: string): ProLicenseInfo => ({
  valid: false,
  plan: null,
  expiresAt: null,
  error,
});

export function validateProLicense(key: string): ProLicenseInfo {
  if (!key) return INVALID('No license key provided');

  if (key === '__DEV__') {
    return { valid: true, plan: 'enterprise', expiresAt: new Date('2099-12-31') };
  }

  const parts = key.split('-');
  if (parts.length !== 4 || parts[0] !== LICENSE_PREFIX) {
    return INVALID('Invalid license format');
  }

  const [, planRaw, expiryRaw, signature] = parts;

  const plan = VALID_PLANS.get(planRaw);
  if (!plan) return INVALID(`Unknown plan: ${planRaw}`);

  const expiresAt = parseExpiry(expiryRaw);
  if (!expiresAt) return INVALID('Invalid expiry date');

  const expected = computeSignature(planRaw, expiryRaw);
  if (signature !== expected) return INVALID('Invalid signature');

  if (expiresAt.getTime() < Date.now()) return INVALID('License expired');

  return { valid: true, plan, expiresAt };
}

export function saveLicenseKey(key: string): void {
  mkdirSync(dirname(paths.licenseFile), { recursive: true });
  writeFileSync(paths.licenseFile, key.trim() + '\n', 'utf-8');
}

export function removeLicenseKey(): void {
  if (existsSync(paths.licenseFile)) {
    unlinkSync(paths.licenseFile);
  }
}

export function readLicenseKey(): string | null {
  // 1. Environment variable
  if (process.env.BASTION_LICENSE_KEY) return process.env.BASTION_LICENSE_KEY.trim();

  // 2. Dev mode
  if (process.env.BASTION_DEV === '1') return '__DEV__';

  // 3. License file
  if (existsSync(paths.licenseFile)) {
    return readFileSync(paths.licenseFile, 'utf-8').trim() || null;
  }

  return null;
}

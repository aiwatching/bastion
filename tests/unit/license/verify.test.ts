import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyLicenseToken } from '../../../src/license/verify.js';

// Generate a throwaway Ed25519 keypair for testing
const { publicKey: testPub, privateKey: testPriv } = crypto.generateKeyPairSync('ed25519');

function signToken(payload: Record<string, unknown>, priv: crypto.KeyObject): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.sign(null, Buffer.from(payloadB64, 'base64'), priv);
  return payloadB64 + '.' + sig.toString('base64');
}

describe('verifyLicenseToken', () => {
  it('rejects non-string input', () => {
    expect(verifyLicenseToken(undefined).valid).toBe(false);
    expect(verifyLicenseToken(null).valid).toBe(false);
    expect(verifyLicenseToken(123).valid).toBe(false);
    expect(verifyLicenseToken({ valid: true }).valid).toBe(false);
  });

  it('rejects string without dot separator', () => {
    const r = verifyLicenseToken('nodothere');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('malformed token');
  });

  it('rejects token signed with wrong key', () => {
    // Sign with our test key, but verify.ts uses the embedded production key
    const token = signToken({ plan: 'pro', expiresAt: '2099-01-01', features: [] }, testPriv);
    const r = verifyLicenseToken(token);
    expect(r.valid).toBe(false);
    // Should fail at signature verification, not at parsing
    expect(r.reason).toBe('invalid signature');
  });

  it('rejects forged payload with garbage signature', () => {
    const payload = Buffer.from(JSON.stringify({ plan: 'enterprise', features: ['all'] })).toString('base64');
    const token = payload + '.' + Buffer.from('fakesig').toString('base64');
    const r = verifyLicenseToken(token);
    expect(r.valid).toBe(false);
  });

  it('rejects a boolean valid:true set by a rogue plugin', () => {
    // This is the exact attack vector: plugin sets { valid: true } instead of a signed token
    const r = verifyLicenseToken(true);
    expect(r.valid).toBe(false);
  });
});

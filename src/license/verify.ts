import crypto from 'node:crypto';

/**
 * Bastion Pro license verification.
 *
 * License token format: base64(JSON payload) + '.' + base64(Ed25519 signature)
 *
 * The Pro plugin sets a signed token; we verify it here with the embedded
 * public key so a forged plugin cannot simply claim `valid: true`.
 */

// Ed25519 public key (PEM) — only Bastion can sign with the corresponding private key.
// Replace this with the real production key before shipping.
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAPlr2YjKxlMzVGOZ2WFmYOFCT3JHaFz8rECPFwbzVSXg=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  plan: string;
  expiresAt: string;
  features: string[];
}

export interface LicenseResult {
  valid: boolean;
  payload?: LicensePayload;
  reason?: string;
}

/**
 * Verify a signed license token.
 *
 * Returns { valid: true, payload } on success,
 * or { valid: false, reason } on failure.
 */
export function verifyLicenseToken(token: unknown): LicenseResult {
  if (typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'malformed token' };
  }

  const dotIndex = token.lastIndexOf('.');
  const payloadB64 = token.slice(0, dotIndex);
  const signatureB64 = token.slice(dotIndex + 1);

  // Verify signature
  let signatureValid: boolean;
  try {
    const key = crypto.createPublicKey(LICENSE_PUBLIC_KEY);
    signatureValid = crypto.verify(
      null, // Ed25519 does not use a separate hash algorithm
      Buffer.from(payloadB64, 'base64'),
      key,
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return { valid: false, reason: 'signature verification error' };
  }

  if (!signatureValid) {
    return { valid: false, reason: 'invalid signature' };
  }

  // Decode payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8'));
  } catch {
    return { valid: false, reason: 'invalid payload' };
  }

  // Check expiry
  if (typeof payload.expiresAt === 'string') {
    const exp = new Date(payload.expiresAt);
    if (exp.getTime() < Date.now()) {
      return { valid: false, reason: 'license expired' };
    }
  }

  return {
    valid: true,
    payload: {
      plan: (payload.plan as string) ?? 'pro',
      expiresAt: (payload.expiresAt as string) ?? '',
      features: (payload.features as string[]) ?? [],
    },
  };
}

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import forge from 'node-forge';
import { paths } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('certs');

const CA_KEY_PATH = join(paths.bastionDir, 'ca.key');
const CA_CERT_PATH = join(paths.bastionDir, 'ca.crt');
const CERTS_DIR = join(paths.bastionDir, 'certs');
const IS_WIN = platform() === 'win32';

export function getCACertPath(): string {
  return CA_CERT_PATH;
}

/**
 * Get path to a combined CA bundle (system roots + bastion CA).
 * Used for SSL_CERT_FILE so non-Node.js TLS stacks (Rust, Go, Python)
 * can trust both public CAs and bastion's MITM CA.
 */
const CA_BUNDLE_PATH = join(paths.bastionDir, 'ca-bundle.pem');

export function getCABundlePath(): string {
  if (existsSync(CA_BUNDLE_PATH)) return CA_BUNDLE_PATH;
  buildCABundle();
  return CA_BUNDLE_PATH;
}

export function buildCABundle(): void {
  // macOS: export system root certificates
  let systemCerts = '';
  try {
    const { execSync } = require('node:child_process');
    if (platform() === 'darwin') {
      systemCerts = execSync(
        'security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain',
        { encoding: 'utf-8', timeout: 10000 },
      );
    } else if (platform() === 'linux') {
      // Common Linux CA bundle paths
      const linuxPaths = ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt', '/etc/ssl/ca-bundle.pem'];
      for (const p of linuxPaths) {
        if (existsSync(p)) { systemCerts = readFileSync(p, 'utf-8'); break; }
      }
    }
  } catch {
    log.warn('Could not export system root certificates for CA bundle');
  }

  const bastionCA = existsSync(CA_CERT_PATH) ? readFileSync(CA_CERT_PATH, 'utf-8') : '';
  writeFileSync(CA_BUNDLE_PATH, systemCerts + '\n' + bastionCA);
  log.info('CA bundle created', { path: CA_BUNDLE_PATH });
}

export function ensureCA(): { key: string; cert: string } {
  mkdirSync(paths.bastionDir, { recursive: true });

  if (existsSync(CA_KEY_PATH) && existsSync(CA_CERT_PATH)) {
    return {
      key: readFileSync(CA_KEY_PATH, 'utf-8'),
      cert: readFileSync(CA_CERT_PATH, 'utf-8'),
    };
  }

  log.info('Generating local CA certificate');

  // Use Node's native crypto for fast RSA key generation
  const { privateKey: keyPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  // Use node-forge to create the X.509 CA certificate
  const privateKey = forge.pki.privateKeyFromPem(keyPem);
  const publicKey = forge.pki.publicKeyFromPem(pubPem);

  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = randomBytes(16).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + 825);

  const attrs = [
    { name: 'commonName', value: 'Bastion Local CA' },
    { name: 'organizationName', value: 'Bastion AI Gateway' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, cRLSign: true },
  ]);

  cert.sign(privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);

  writeFileSync(CA_KEY_PATH, keyPem);
  if (!IS_WIN) chmodSync(CA_KEY_PATH, 0o600);
  writeFileSync(CA_CERT_PATH, certPem);

  log.info('CA certificate created', { path: CA_CERT_PATH });

  // Rebuild CA bundle with new cert
  buildCABundle();

  return { key: keyPem, cert: certPem };
}

// In-memory cache for generated host certs
const certCache = new Map<string, { key: string; cert: string }>();

export function getHostCert(hostname: string): { key: string; cert: string } {
  const cached = certCache.get(hostname);
  if (cached) return cached;

  mkdirSync(CERTS_DIR, { recursive: true });

  // Generate host key pair (native crypto — fast)
  const { privateKey: hostKeyPem, publicKey: hostPubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  // Load CA key + cert
  const caKey = forge.pki.privateKeyFromPem(readFileSync(CA_KEY_PATH, 'utf-8'));
  const caCert = forge.pki.certificateFromPem(readFileSync(CA_CERT_PATH, 'utf-8'));

  // Create host certificate signed by CA
  const hostKey = forge.pki.publicKeyFromPem(hostPubPem);
  const cert = forge.pki.createCertificate();
  cert.publicKey = hostKey;
  cert.serialNumber = randomBytes(16).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notAfter.getDate() + 825);

  cert.setSubject([{ name: 'commonName', value: hostname }]);
  cert.setIssuer(caCert.subject.attributes);

  cert.setExtensions([
    { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] },
  ]);

  cert.sign(caKey, forge.md.sha256.create());

  const result = {
    key: hostKeyPem,
    cert: forge.pki.certificateToPem(cert),
  };

  // Optionally cache to disk (for debugging), always cache in memory
  const keyPath = join(CERTS_DIR, `${hostname}.key`);
  const certPath = join(CERTS_DIR, `${hostname}.crt`);
  writeFileSync(keyPath, result.key);
  writeFileSync(certPath, result.cert);

  certCache.set(hostname, result);
  log.debug('Generated host certificate', { hostname });

  return result;
}

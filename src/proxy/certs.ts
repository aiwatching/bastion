import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../config/paths.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('certs');

const CA_KEY_PATH = join(paths.bastionDir, 'ca.key');
const CA_CERT_PATH = join(paths.bastionDir, 'ca.crt');
const CERTS_DIR = join(paths.bastionDir, 'certs');

export function getCACertPath(): string {
  return CA_CERT_PATH;
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

  // Generate CA private key
  execSync(`openssl genrsa -out "${CA_KEY_PATH}" 2048 2>/dev/null`);
  execSync(`chmod 600 "${CA_KEY_PATH}"`);

  // Generate CA certificate
  execSync(
    `openssl req -new -x509 -key "${CA_KEY_PATH}" -out "${CA_CERT_PATH}" ` +
    `-days 825 -subj "/CN=Bastion Local CA/O=Bastion AI Gateway" 2>/dev/null`
  );

  log.info('CA certificate created', { path: CA_CERT_PATH });

  return {
    key: readFileSync(CA_KEY_PATH, 'utf-8'),
    cert: readFileSync(CA_CERT_PATH, 'utf-8'),
  };
}

// In-memory cache for generated host certs
const certCache = new Map<string, { key: string; cert: string }>();

export function getHostCert(hostname: string): { key: string; cert: string } {
  const cached = certCache.get(hostname);
  if (cached) return cached;

  mkdirSync(CERTS_DIR, { recursive: true });
  const keyPath = join(CERTS_DIR, `${hostname}.key`);
  const certPath = join(CERTS_DIR, `${hostname}.crt`);
  const csrPath = join(CERTS_DIR, `${hostname}.csr`);
  const extPath = join(CERTS_DIR, `${hostname}.ext`);

  // Generate host key
  execSync(`openssl genrsa -out "${keyPath}" 2048 2>/dev/null`);

  // Generate CSR
  execSync(
    `openssl req -new -key "${keyPath}" -out "${csrPath}" ` +
    `-subj "/CN=${hostname}" 2>/dev/null`
  );

  // Write extension file for SAN
  writeFileSync(extPath, `subjectAltName=DNS:${hostname}\n`);

  // Sign with CA
  execSync(
    `openssl x509 -req -in "${csrPath}" -CA "${CA_CERT_PATH}" -CAkey "${CA_KEY_PATH}" ` +
    `-CAcreateserial -out "${certPath}" -days 825 -extfile "${extPath}" 2>/dev/null`
  );

  const result = {
    key: readFileSync(keyPath, 'utf-8'),
    cert: readFileSync(certPath, 'utf-8'),
  };

  certCache.set(hostname, result);
  log.debug('Generated host certificate', { hostname });

  return result;
}

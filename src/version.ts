import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Version from package.json, e.g. "0.1.0" */
export function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/** Major.minor version for DLP signature branch, e.g. "0.1.2" → "0.1" */
export function getMajorVersion(): string {
  const v = getVersion();
  const m = v.match(/^(\d+\.\d+)/);
  return m ? m[1] : '0.0';
}

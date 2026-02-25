import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Full version string from VERSION file, e.g. "0.1.0-2" */
export function getVersion(): string {
  try {
    return readFileSync(join(__dirname, '..', 'VERSION'), 'utf-8').trim();
  } catch {
    return '0.0.0';
  }
}

/** Major version for DLP signature branch, e.g. "0.1.0-2" → "0.1.0" */
export function getMajorVersion(): string {
  const v = getVersion();
  // Strip patch suffix: "0.1.0-2" → "0.1.0"
  return v.replace(/-.*$/, '');
}

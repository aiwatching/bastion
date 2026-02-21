import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { paths } from '../config/paths.js';

export function writePidFile(pid: number): void {
  mkdirSync(dirname(paths.pidFile), { recursive: true });
  writeFileSync(paths.pidFile, pid.toString(), 'utf-8');
}

export function readPidFile(): number | null {
  if (!existsSync(paths.pidFile)) return null;
  const content = readFileSync(paths.pidFile, 'utf-8').trim();
  const pid = parseInt(content, 10);
  return isNaN(pid) ? null : pid;
}

export function removePidFile(): void {
  if (existsSync(paths.pidFile)) {
    unlinkSync(paths.pidFile);
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getDaemonStatus(): { running: boolean; pid: number | null } {
  const pid = readPidFile();
  if (pid === null) return { running: false, pid: null };
  if (isProcessRunning(pid)) return { running: true, pid };
  // Stale PID file
  removePidFile();
  return { running: false, pid: null };
}

export function spawnDaemon(): number {
  const entryPoint = resolve(join(__dirname, '..', 'index.js'));

  // Use tsx for development, node for production
  const isTs = entryPoint.endsWith('.ts');
  const command = isTs ? 'npx' : 'node';
  const args = isTs ? ['tsx', entryPoint] : [entryPoint];

  mkdirSync(dirname(paths.logFile), { recursive: true });

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, BASTION_DAEMON: '1' },
    // Prevent a console window from popping up on Windows
    ...(process.platform === 'win32' ? { windowsHide: true } : {}),
  });

  child.unref();
  const pid = child.pid!;
  writePidFile(pid);
  return pid;
}

export function stopDaemon(): boolean {
  const { running, pid } = getDaemonStatus();
  if (!running || pid === null) return false;

  try {
    process.kill(pid, 'SIGTERM');
    removePidFile();
    return true;
  } catch {
    removePidFile();
    return false;
  }
}

import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { createLogger } from '../utils/logger.js';
import type { RuleMatch } from './rules.js';

const log = createLogger('tool-guard-alert');

export interface AlertConfig {
  /** Minimum severity to trigger alerts: 'critical' | 'high' | 'medium' | 'low' */
  minSeverity: string;
  /** macOS Notification Center */
  desktop: boolean;
  /** Webhook URL for POST alerts (Slack, Discord, etc.) */
  webhookUrl: string;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function shouldAlert(severity: string, minSeverity: string): boolean {
  const minRank = SEVERITY_RANK[minSeverity];
  // Unknown minSeverity (empty string, 'none', undefined coerced to string, etc.) →
  // treat as "never block" rather than defaulting to rank 0 which would match everything.
  if (minRank === undefined) return false;
  return (SEVERITY_RANK[severity] ?? 0) >= minRank;
}

export interface AlertPayload {
  toolName: string;
  ruleName: string;
  ruleId: string;
  severity: string;
  category: string;
  matchedText: string;
  requestId: string;
  sessionId?: string;
  timestamp: string;
}

function buildPayload(
  toolName: string,
  ruleMatch: RuleMatch,
  requestId: string,
  sessionId?: string,
): AlertPayload {
  return {
    toolName,
    ruleName: ruleMatch.rule.name,
    ruleId: ruleMatch.rule.id,
    severity: ruleMatch.rule.severity,
    category: ruleMatch.rule.category,
    matchedText: ruleMatch.matchedText,
    requestId,
    sessionId,
    timestamp: new Date().toISOString(),
  };
}

// ── Desktop notification (macOS) ──

function sendDesktopNotification(payload: AlertPayload): void {
  if (platform() !== 'darwin') return;

  const title = `Bastion: ${payload.severity.toUpperCase()} tool call`;
  const message = `${payload.toolName}: ${payload.ruleName}\\n${payload.matchedText.slice(0, 100)}`;

  execFile('osascript', [
    '-e',
    `display notification "${message}" with title "${title}" sound name "Purr"`,
  ], (err) => {
    if (err) log.debug('Desktop notification failed', { error: err.message });
  });
}

// ── Webhook ──

async function sendWebhook(url: string, payload: AlertPayload): Promise<void> {
  try {
    const body = JSON.stringify({
      text: `[Bastion Tool Guard] **${payload.severity.toUpperCase()}**: \`${payload.toolName}\` — ${payload.ruleName}\nMatched: \`${payload.matchedText.slice(0, 200)}\`\nRequest: ${payload.requestId}`,
      ...payload,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.debug('Webhook response not OK', { status: res.status });
    }
  } catch (err) {
    log.debug('Webhook send failed', { error: (err as Error).message });
  }
}

// ── In-memory alert queue for dashboard ──

export interface AlertEntry extends AlertPayload {
  id: string;
  acknowledged: boolean;
}

const recentAlerts: AlertEntry[] = [];
const MAX_ALERTS = 100;

export function getRecentAlerts(): AlertEntry[] {
  return recentAlerts;
}

export function getUnacknowledgedCount(): number {
  return recentAlerts.filter(a => !a.acknowledged).length;
}

export function acknowledgeAlerts(): void {
  for (const a of recentAlerts) a.acknowledged = true;
}

// ── Main dispatch ──

export function dispatchAlert(
  config: AlertConfig,
  toolName: string,
  ruleMatch: RuleMatch,
  requestId: string,
  sessionId?: string,
): void {
  if (!shouldAlert(ruleMatch.rule.severity, config.minSeverity)) return;

  const payload = buildPayload(toolName, ruleMatch, requestId, sessionId);

  // Always add to in-memory queue
  recentAlerts.unshift({
    ...payload,
    id: crypto.randomUUID(),
    acknowledged: false,
  });
  if (recentAlerts.length > MAX_ALERTS) recentAlerts.length = MAX_ALERTS;

  // Desktop notification
  if (config.desktop) {
    sendDesktopNotification(payload);
  }

  // Webhook
  if (config.webhookUrl) {
    sendWebhook(config.webhookUrl, payload).catch(() => {});
  }

  log.info('Alert dispatched', {
    severity: payload.severity,
    toolName: payload.toolName,
    rule: payload.ruleId,
  });
}

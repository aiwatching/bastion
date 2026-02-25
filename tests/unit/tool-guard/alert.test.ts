import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldAlert,
  dispatchAlert,
  getRecentAlerts,
  getUnacknowledgedCount,
  acknowledgeAlerts,
  type AlertConfig,
} from '../../../src/tool-guard/alert.js';
import type { RuleMatch } from '../../../src/tool-guard/rules.js';

const makeRuleMatch = (severity: 'critical' | 'high' | 'medium' | 'low'): RuleMatch => ({
  rule: {
    id: `test-${severity}`,
    name: `Test ${severity} rule`,
    description: 'test',
    severity,
    category: 'test-category',
    match: { inputPattern: /test/ },
  },
  matchedText: 'test match',
});

const silentConfig: AlertConfig = {
  minSeverity: 'high',
  desktop: false,
  webhookUrl: '',
};

describe('shouldAlert', () => {
  it('alerts when severity >= minSeverity', () => {
    expect(shouldAlert('critical', 'high')).toBe(true);
    expect(shouldAlert('high', 'high')).toBe(true);
    expect(shouldAlert('critical', 'critical')).toBe(true);
    expect(shouldAlert('medium', 'low')).toBe(true);
  });

  it('does not alert when severity < minSeverity', () => {
    expect(shouldAlert('medium', 'high')).toBe(false);
    expect(shouldAlert('low', 'high')).toBe(false);
    expect(shouldAlert('low', 'medium')).toBe(false);
    expect(shouldAlert('high', 'critical')).toBe(false);
  });
});

describe('dispatchAlert + in-memory queue', () => {
  beforeEach(() => {
    // Clear queue by acknowledging all
    acknowledgeAlerts();
    // Dispatch enough to push old ones out (max 100)
    // Actually we just need to test from current state
  });

  it('adds alert to queue when severity meets threshold', () => {
    const before = getRecentAlerts().length;
    dispatchAlert(silentConfig, 'bash', makeRuleMatch('critical'), 'req-1', 'sess-1');
    expect(getRecentAlerts().length).toBe(before + 1);

    const latest = getRecentAlerts()[0];
    expect(latest.toolName).toBe('bash');
    expect(latest.severity).toBe('critical');
    expect(latest.acknowledged).toBe(false);
  });

  it('does not add alert when severity below threshold', () => {
    const before = getRecentAlerts().length;
    dispatchAlert(silentConfig, 'bash', makeRuleMatch('low'), 'req-2');
    expect(getRecentAlerts().length).toBe(before);
  });

  it('tracks unacknowledged count', () => {
    const beforeUnack = getUnacknowledgedCount();
    dispatchAlert(silentConfig, 'bash', makeRuleMatch('high'), 'req-3');
    expect(getUnacknowledgedCount()).toBe(beforeUnack + 1);
  });

  it('acknowledgeAlerts marks all as acknowledged', () => {
    dispatchAlert(silentConfig, 'bash', makeRuleMatch('critical'), 'req-4');
    expect(getUnacknowledgedCount()).toBeGreaterThan(0);
    acknowledgeAlerts();
    expect(getUnacknowledgedCount()).toBe(0);
  });

  it('alert payload has correct fields', () => {
    dispatchAlert(silentConfig, 'rm_tool', makeRuleMatch('high'), 'req-5', 'sess-5');
    const alert = getRecentAlerts()[0];
    expect(alert.toolName).toBe('rm_tool');
    expect(alert.ruleId).toBe('test-high');
    expect(alert.ruleName).toBe('Test high rule');
    expect(alert.category).toBe('test-category');
    expect(alert.requestId).toBe('req-5');
    expect(alert.sessionId).toBe('sess-5');
    expect(alert.id).toBeTruthy();
    expect(alert.timestamp).toBeTruthy();
  });
});

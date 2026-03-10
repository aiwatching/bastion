import type { Plugin, RequestContext, PluginRequestResult, ResponseCompleteContext } from '../types.js';
import type { PluginEventBus } from '../event-bus.js';
import { extractMetrics } from '../../metrics/collector.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('rate-limiter');

export interface RateLimiterConfig {
  enabled: boolean;
  requestsPerMinute: number;
  tokensPerHour: number;
  maxCostPerHour: number;
  maxCostPerDay: number;
  maxCostPerMonth: number;
  action: 'block' | 'warn';
  warningThreshold: number;
}

interface UsageState {
  // RPM: sliding window of request timestamps (epoch ms)
  requestTimestamps: number[];
  // Hourly counters
  costHour: number;
  tokensHour: number;
  hourStart: number;
  // Daily counter
  costDay: number;
  dayStart: number;
  // Monthly counter
  costMonth: number;
  monthStart: number;
  // Stats
  recentBlocks: number;
}

function getHourStart(now: number): number {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function getDayStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getMonthStart(now: number): number {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface RateLimiterState {
  limits: Record<string, { limit: number; current: number; percentage: number }>;
  action: string;
  recentBlocks: number;
}

export function createRateLimiterPlugin(
  db: Database.Database,
  getLiveConfig: () => RateLimiterConfig,
  eventBus: PluginEventBus,
): Plugin {
  const now = Date.now();
  const state: UsageState = {
    requestTimestamps: [],
    costHour: 0,
    tokensHour: 0,
    hourStart: getHourStart(now),
    costDay: 0,
    dayStart: getDayStart(now),
    costMonth: 0,
    monthStart: getMonthStart(now),
    recentBlocks: 0,
  };

  // Recover counters from DB on startup
  try {
    const hourAgo = new Date(state.hourStart).toISOString();
    const dayAgo = new Date(state.dayStart).toISOString();
    const monthAgo = new Date(state.monthStart).toISOString();

    const hourRow = db.prepare(
      `SELECT COALESCE(SUM(cost_usd),0) as cost, COALESCE(SUM(input_tokens + output_tokens),0) as tokens FROM requests WHERE created_at >= ?`
    ).get(hourAgo) as { cost: number; tokens: number };

    const dayRow = db.prepare(
      `SELECT COALESCE(SUM(cost_usd),0) as cost FROM requests WHERE created_at >= ?`
    ).get(dayAgo) as { cost: number };

    const monthRow = db.prepare(
      `SELECT COALESCE(SUM(cost_usd),0) as cost FROM requests WHERE created_at >= ?`
    ).get(monthAgo) as { cost: number };

    state.costHour = hourRow.cost;
    state.tokensHour = hourRow.tokens;
    state.costDay = dayRow.cost;
    state.costMonth = monthRow.cost;

    log.info('Recovered rate-limiter counters from DB', {
      costHour: state.costHour.toFixed(4),
      tokensHour: state.tokensHour,
      costDay: state.costDay.toFixed(4),
      costMonth: state.costMonth.toFixed(4),
    });
  } catch (err) {
    log.warn('Failed to recover rate-limiter counters', { error: (err as Error).message });
  }

  function rollPeriods(): void {
    const now = Date.now();
    const newHourStart = getHourStart(now);
    if (newHourStart > state.hourStart) {
      state.costHour = 0;
      state.tokensHour = 0;
      state.hourStart = newHourStart;
    }
    const newDayStart = getDayStart(now);
    if (newDayStart > state.dayStart) {
      state.costDay = 0;
      state.dayStart = newDayStart;
    }
    const newMonthStart = getMonthStart(now);
    if (newMonthStart > state.monthStart) {
      state.costMonth = 0;
      state.monthStart = newMonthStart;
    }
  }

  function cleanRpmWindow(): number {
    const cutoff = Date.now() - 60_000;
    state.requestTimestamps = state.requestTimestamps.filter(t => t > cutoff);
    return state.requestTimestamps.length;
  }

  function checkWarning(cfg: RateLimiterConfig, type: string, current: number, limit: number): void {
    if (limit <= 0) return;
    const pct = current / limit;
    if (pct >= cfg.warningThreshold && pct < 1.0) {
      eventBus.emit('rate-limit:warning', { type, current, limit, percentage: pct });
      log.warn('Rate limit warning', { type, current, limit, percentage: Math.round(pct * 100) + '%' });
    }
  }

  // Public state accessor for dashboard API
  function getState(): RateLimiterState {
    rollPeriods();
    const cfg = getLiveConfig();
    const currentRpm = cleanRpmWindow();
    const limits: Record<string, { limit: number; current: number; percentage: number }> = {};

    if (cfg.requestsPerMinute > 0) {
      limits.requestsPerMinute = {
        limit: cfg.requestsPerMinute,
        current: currentRpm,
        percentage: currentRpm / cfg.requestsPerMinute,
      };
    }
    if (cfg.tokensPerHour > 0) {
      limits.tokensPerHour = {
        limit: cfg.tokensPerHour,
        current: state.tokensHour,
        percentage: state.tokensHour / cfg.tokensPerHour,
      };
    }
    if (cfg.maxCostPerHour > 0) {
      limits.maxCostPerHour = {
        limit: cfg.maxCostPerHour,
        current: state.costHour,
        percentage: state.costHour / cfg.maxCostPerHour,
      };
    }
    if (cfg.maxCostPerDay > 0) {
      limits.maxCostPerDay = {
        limit: cfg.maxCostPerDay,
        current: state.costDay,
        percentage: state.costDay / cfg.maxCostPerDay,
      };
    }
    if (cfg.maxCostPerMonth > 0) {
      limits.maxCostPerMonth = {
        limit: cfg.maxCostPerMonth,
        current: state.costMonth,
        percentage: state.costMonth / cfg.maxCostPerMonth,
      };
    }

    return { limits, action: cfg.action, recentBlocks: state.recentBlocks };
  }

  // Expose state via a property on the plugin object
  const plugin: Plugin & { getState: () => RateLimiterState } = {
    name: 'rate-limiter',
    priority: 2, // After metrics-collector (1), before DLP (3) and threat-scorer (4)
    version: '1.0.0',
    apiVersion: 2,
    source: 'builtin',

    getState,

    async onRequest(_context: RequestContext): Promise<PluginRequestResult | void> {
      rollPeriods();
      const cfg = getLiveConfig();

      // 1. Check RPM
      const currentRpm = cleanRpmWindow();
      if (cfg.requestsPerMinute > 0) {
        checkWarning(cfg, 'requestsPerMinute', currentRpm, cfg.requestsPerMinute);
        if (currentRpm >= cfg.requestsPerMinute) {
          const reason = `Rate limit exceeded: ${currentRpm}/${cfg.requestsPerMinute} requests per minute`;
          state.recentBlocks++;
          eventBus.emit('rate-limit:exceeded', {
            type: 'requestsPerMinute', current: currentRpm, limit: cfg.requestsPerMinute, action: cfg.action,
          });
          if (cfg.action === 'block') {
            log.warn(reason);
            return { blocked: { reason } };
          }
          log.warn('Rate limit exceeded (warn mode)', { type: 'requestsPerMinute' });
        }
      }

      // 2. Check tokens per hour
      if (cfg.tokensPerHour > 0) {
        checkWarning(cfg, 'tokensPerHour', state.tokensHour, cfg.tokensPerHour);
        if (state.tokensHour >= cfg.tokensPerHour) {
          const reason = `Rate limit exceeded: ${state.tokensHour}/${cfg.tokensPerHour} tokens per hour`;
          state.recentBlocks++;
          eventBus.emit('rate-limit:exceeded', {
            type: 'tokensPerHour', current: state.tokensHour, limit: cfg.tokensPerHour, action: cfg.action,
          });
          if (cfg.action === 'block') {
            log.warn(reason);
            return { blocked: { reason } };
          }
          log.warn('Rate limit exceeded (warn mode)', { type: 'tokensPerHour' });
        }
      }

      // 3. Check cost per hour
      if (cfg.maxCostPerHour > 0) {
        checkWarning(cfg, 'maxCostPerHour', state.costHour, cfg.maxCostPerHour);
        if (state.costHour >= cfg.maxCostPerHour) {
          const reason = `Budget exceeded: $${state.costHour.toFixed(4)}/$${cfg.maxCostPerHour} per hour`;
          state.recentBlocks++;
          eventBus.emit('rate-limit:exceeded', {
            type: 'maxCostPerHour', current: state.costHour, limit: cfg.maxCostPerHour, action: cfg.action,
          });
          if (cfg.action === 'block') {
            log.warn(reason);
            return { blocked: { reason } };
          }
          log.warn('Budget exceeded (warn mode)', { type: 'maxCostPerHour' });
        }
      }

      // 4. Check cost per day
      if (cfg.maxCostPerDay > 0) {
        checkWarning(cfg, 'maxCostPerDay', state.costDay, cfg.maxCostPerDay);
        if (state.costDay >= cfg.maxCostPerDay) {
          const reason = `Budget exceeded: $${state.costDay.toFixed(4)}/$${cfg.maxCostPerDay} per day`;
          state.recentBlocks++;
          eventBus.emit('rate-limit:exceeded', {
            type: 'maxCostPerDay', current: state.costDay, limit: cfg.maxCostPerDay, action: cfg.action,
          });
          if (cfg.action === 'block') {
            log.warn(reason);
            return { blocked: { reason } };
          }
          log.warn('Budget exceeded (warn mode)', { type: 'maxCostPerDay' });
        }
      }

      // 5. Check cost per month
      if (cfg.maxCostPerMonth > 0) {
        checkWarning(cfg, 'maxCostPerMonth', state.costMonth, cfg.maxCostPerMonth);
        if (state.costMonth >= cfg.maxCostPerMonth) {
          const reason = `Budget exceeded: $${state.costMonth.toFixed(4)}/$${cfg.maxCostPerMonth} per month`;
          state.recentBlocks++;
          eventBus.emit('rate-limit:exceeded', {
            type: 'maxCostPerMonth', current: state.costMonth, limit: cfg.maxCostPerMonth, action: cfg.action,
          });
          if (cfg.action === 'block') {
            log.warn(reason);
            return { blocked: { reason } };
          }
          log.warn('Budget exceeded (warn mode)', { type: 'maxCostPerMonth' });
        }
      }

      // Record timestamp for RPM window
      state.requestTimestamps.push(Date.now());
    },

    async onResponseComplete(context: ResponseCompleteContext): Promise<void> {
      rollPeriods();

      const metrics = extractMetrics(context);
      const totalTokens = metrics.inputTokens + metrics.outputTokens;

      state.tokensHour += totalTokens;
      state.costHour += metrics.costUsd;
      state.costDay += metrics.costUsd;
      state.costMonth += metrics.costUsd;

      log.debug('Rate-limiter counters updated', {
        cost: metrics.costUsd.toFixed(6),
        tokens: totalTokens,
        costHour: state.costHour.toFixed(4),
        costDay: state.costDay.toFixed(4),
        costMonth: state.costMonth.toFixed(4),
      });
    },
  };

  return plugin;
}

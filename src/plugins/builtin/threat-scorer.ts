import type { Plugin, RequestContext, PluginRequestResult } from '../types.js';
import type { PluginEventBus } from '../event-bus.js';
import type { BastionConfig } from '../../config/schema.js';
import { ThreatScoresRepository } from '../../storage/repositories/threat-scores.js';
import { ThreatScoreEventsRepository } from '../../storage/repositories/threat-score-events.js';
import { ToolChainDetectionsRepository } from '../../storage/repositories/tool-chain-detections.js';
import { TaintMarksRepository } from '../../storage/repositories/taint-marks.js';
import { ChainDetector } from '../../tool-guard/chain-detector.js';
import { TaintTracker } from '../../tool-guard/taint-tracker.js';
import { BUILTIN_CHAIN_RULES, type ToolChainRule } from '../../tool-guard/chain-rules.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('threat-scorer');

type ThreatLevel = 'normal' | 'elevated' | 'high' | 'critical';

interface ThreatState {
  score: number;
  level: ThreatLevel;
  eventCount: number;
  lastEventAt: number;
}

interface ScoringConfig {
  piWeight: number;
  dlpWeight: number;
  toolGuardWeights: { critical: number; high: number; medium: number; low: number };
  toolChainWeight: number;
  decayPerMinute: number;
}

interface ThresholdConfig {
  elevated: number;
  high: number;
  critical: number;
}

interface ThreatIntelConfig {
  enabled: boolean;
  scoring: ScoringConfig;
  thresholds: ThresholdConfig;
  toolChain: { enabled: boolean; maxWindowSize: number };
  taintTracking: { enabled: boolean; ttlMinutes: number };
}

function getDefaults(): ThreatIntelConfig {
  return {
    enabled: true,
    scoring: {
      piWeight: 30,
      dlpWeight: 10,
      toolGuardWeights: { critical: 25, high: 15, medium: 5, low: 2 },
      toolChainWeight: 40,
      decayPerMinute: 0.5,
    },
    thresholds: { elevated: 20, high: 50, critical: 80 },
    toolChain: { enabled: true, maxWindowSize: 20 },
    taintTracking: { enabled: true, ttlMinutes: 60 },
  };
}

function mergeConfig(config: BastionConfig): ThreatIntelConfig {
  const defaults = getDefaults();
  const ti = config.plugins?.threatIntelligence;
  if (!ti) return defaults;
  return {
    enabled: ti.enabled ?? defaults.enabled,
    scoring: {
      piWeight: ti.scoring?.piWeight ?? defaults.scoring.piWeight,
      dlpWeight: ti.scoring?.dlpWeight ?? defaults.scoring.dlpWeight,
      toolGuardWeights: {
        critical: ti.scoring?.toolGuardWeights?.critical ?? defaults.scoring.toolGuardWeights.critical,
        high: ti.scoring?.toolGuardWeights?.high ?? defaults.scoring.toolGuardWeights.high,
        medium: ti.scoring?.toolGuardWeights?.medium ?? defaults.scoring.toolGuardWeights.medium,
        low: ti.scoring?.toolGuardWeights?.low ?? defaults.scoring.toolGuardWeights.low,
      },
      toolChainWeight: ti.scoring?.toolChainWeight ?? defaults.scoring.toolChainWeight,
      decayPerMinute: ti.scoring?.decayPerMinute ?? defaults.scoring.decayPerMinute,
    },
    thresholds: {
      elevated: ti.thresholds?.elevated ?? defaults.thresholds.elevated,
      high: ti.thresholds?.high ?? defaults.thresholds.high,
      critical: ti.thresholds?.critical ?? defaults.thresholds.critical,
    },
    toolChain: {
      enabled: ti.toolChain?.enabled ?? defaults.toolChain.enabled,
      maxWindowSize: ti.toolChain?.maxWindowSize ?? defaults.toolChain.maxWindowSize,
    },
    taintTracking: {
      enabled: ti.taintTracking?.enabled ?? defaults.taintTracking.enabled,
      ttlMinutes: ti.taintTracking?.ttlMinutes ?? defaults.taintTracking.ttlMinutes,
    },
  };
}

function computeLevel(score: number, thresholds: ThresholdConfig): ThreatLevel {
  if (score >= thresholds.critical) return 'critical';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.elevated) return 'elevated';
  return 'normal';
}

export function createThreatScorerPlugin(
  config: BastionConfig,
  db: Database.Database,
  eventBus: PluginEventBus,
): Plugin {
  const tiConfig = mergeConfig(config);
  const scoresRepo = new ThreatScoresRepository(db);
  const eventsRepo = new ThreatScoreEventsRepository(db);
  const chainDetectionsRepo = new ToolChainDetectionsRepository(db);
  const taintMarksRepo = new TaintMarksRepository(db);

  const chainDetector = new ChainDetector(tiConfig.toolChain.maxWindowSize);
  const taintTracker = new TaintTracker(tiConfig.taintTracking.ttlMinutes);

  // In-memory threat state per session
  const sessions = new Map<string, ThreatState>();

  const chainRules: ToolChainRule[] = [...BUILTIN_CHAIN_RULES];

  function getOrCreateState(sessionId: string): ThreatState {
    let state = sessions.get(sessionId);
    if (!state) {
      // Try loading from DB
      const record = scoresRepo.get(sessionId);
      if (record) {
        state = {
          score: record.score,
          level: record.level as ThreatLevel,
          eventCount: record.event_count,
          lastEventAt: record.last_event_at ? new Date(record.last_event_at).getTime() : 0,
        };
      } else {
        state = { score: 0, level: 'normal', eventCount: 0, lastEventAt: 0 };
      }
      sessions.set(sessionId, state);
    }
    return state;
  }

  function applyDecay(state: ThreatState): void {
    if (state.score <= 0 || state.lastEventAt === 0) return;
    const elapsedMinutes = (Date.now() - state.lastEventAt) / 60000;
    if (elapsedMinutes <= 0) return;
    // Exponential decay: score *= exp(-decayRate * elapsed)
    state.score *= Math.exp(-tiConfig.scoring.decayPerMinute * elapsedMinutes);
    if (state.score < 0.1) state.score = 0;
  }

  function addPoints(sessionId: string, points: number, eventType: string, sourceEvent: string): void {
    const state = getOrCreateState(sessionId);
    applyDecay(state);

    state.score += points;
    state.eventCount++;
    state.lastEventAt = Date.now();
    state.level = computeLevel(state.score, tiConfig.thresholds);

    sessions.set(sessionId, state);

    // Persist to DB
    try {
      scoresRepo.upsert({
        session_id: sessionId,
        score: state.score,
        level: state.level,
        event_count: state.eventCount,
        last_event_at: new Date(state.lastEventAt).toISOString(),
      });

      eventsRepo.insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        event_type: eventType,
        source_event: sourceEvent,
        points,
        score_after: state.score,
        level_after: state.level,
      });
    } catch (err) {
      log.warn('Failed to persist threat score', { error: (err as Error).message });
    }

    if (state.level !== 'normal') {
      log.warn('Session threat level changed', {
        sessionId,
        level: state.level,
        score: Math.round(state.score * 100) / 100,
        eventType,
      });

      eventBus.emit('threat:level-change', {
        sessionId,
        level: state.level,
        score: state.score,
        eventType,
      });
    }
  }

  // ── Event listeners ──

  eventBus.on('pi:detected', (data: unknown) => {
    const event = data as { sessionId?: string; severity?: string } | undefined;
    if (!event?.sessionId) return;
    addPoints(event.sessionId, tiConfig.scoring.piWeight, 'pi', `pi:detected severity=${event.severity ?? 'unknown'}`);
  });

  eventBus.on('dlp:finding', (data: unknown) => {
    const event = data as { requestId?: string; sessionId?: string; patternName?: string; direction?: string; matchCount?: number } | undefined;
    if (!event?.sessionId) return;
    addPoints(event.sessionId, tiConfig.scoring.dlpWeight, 'dlp', `dlp:finding pattern=${event.patternName ?? 'unknown'}`);

    // Taint tracking: mark DLP findings for later tool input checks
    if (tiConfig.taintTracking.enabled && event.patternName && event.requestId) {
      const fingerprint = taintTracker.markTaint(
        event.sessionId, event.requestId, event.patternName,
        `${event.patternName}:${event.requestId}`,
      );
      try {
        taintMarksRepo.insert({
          id: crypto.randomUUID(),
          session_id: event.sessionId,
          request_id: event.requestId,
          pattern_name: event.patternName,
          direction: event.direction ?? 'request',
          fingerprint,
        });
      } catch (err) {
        log.warn('Failed to persist taint mark', { error: (err as Error).message });
      }
    }
  });

  eventBus.on('toolguard:alert', (data: unknown) => {
    const event = data as {
      requestId?: string; sessionId?: string;
      severity?: string; category?: string;
      ruleName?: string; action?: string;
    } | undefined;
    if (!event?.sessionId) return;

    const severity = event.severity ?? 'medium';
    const weights = tiConfig.scoring.toolGuardWeights;
    const points = (weights as Record<string, number>)[severity] ?? weights.medium;
    addPoints(event.sessionId, points, 'toolguard', `toolguard:alert rule=${event.ruleName ?? 'unknown'} severity=${severity}`);

    // Tool chain detection: record the category and check chains
    if (tiConfig.toolChain.enabled && event.category) {
      chainDetector.recordToolCall(event.sessionId, event.category);
      const match = chainDetector.checkChains(event.sessionId, chainRules);
      if (match) {
        addPoints(event.sessionId, tiConfig.scoring.toolChainWeight, 'toolchain',
          `chain:${match.rule.id} sequence=${match.matchedSequence.join('→')}`);

        try {
          chainDetectionsRepo.insert({
            id: crypto.randomUUID(),
            session_id: event.sessionId,
            rule_id: match.rule.id,
            matched_sequence: JSON.stringify(match.matchedSequence),
            action: match.rule.action,
          });
        } catch (err) {
          log.warn('Failed to persist chain detection', { error: (err as Error).message });
        }

        eventBus.emit('toolchain:detected', {
          sessionId: event.sessionId,
          ruleId: match.rule.id,
          ruleName: match.rule.name,
          sequence: match.matchedSequence,
          action: match.rule.action,
        });
      }
    }
  });

  return {
    name: 'threat-scorer',
    priority: 4, // Runs before tool-guard (5) to set context._threatLevel
    version: '1.0.0',
    apiVersion: 2,
    source: 'builtin',

    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      if (!context.sessionId) return;

      const state = getOrCreateState(context.sessionId);
      applyDecay(state);

      // Update level after decay
      state.level = computeLevel(state.score, tiConfig.thresholds);
      sessions.set(context.sessionId, state);

      // Set threat level on context for downstream plugins (tool-guard reads this)
      context._threatLevel = state.level;
      context._threatScore = state.score;

      if (state.level !== 'normal') {
        log.debug('Request threat context', {
          sessionId: context.sessionId,
          level: state.level,
          score: Math.round(state.score * 100) / 100,
        });
      }

      // Taint check: scan tool inputs in request body for tainted content
      if (tiConfig.taintTracking.enabled) {
        const taints = taintTracker.getActiveTaints(context.sessionId);
        if (taints.length > 0 && context.body) {
          const match = taintTracker.checkToolInput(context.sessionId, context.body);
          if (match) {
            addPoints(context.sessionId, tiConfig.scoring.dlpWeight, 'taint',
              `taint:detected pattern=${match.patternName} fingerprint=${match.fingerprint}`);
            log.warn('Tainted data detected in tool input', {
              sessionId: context.sessionId,
              requestId: context.id,
              patternName: match.patternName,
            });
          }
        }
      }
    },
  };
}

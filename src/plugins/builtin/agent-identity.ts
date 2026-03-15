import crypto from 'node:crypto';
import type { Plugin, RequestContext, PluginRequestResult } from '../types.js';
import type { PluginEventBus } from '../event-bus.js';
import type { BastionConfig } from '../../config/schema.js';
import { AgentsRepository, type AgentRecord, type AgentTrustLevel } from '../../storage/repositories/agents.js';
import { encrypt, decrypt } from '../../storage/encryption.js';
import { createLogger } from '../../utils/logger.js';
import type Database from 'better-sqlite3';

const log = createLogger('agent-identity');

const HEADER_AGENT_ID = 'x-bastion-agent-id';
const HEADER_HMAC_SIGNATURE = 'x-bastion-agent-signature';
const HEADER_HMAC_TIMESTAMP = 'x-bastion-agent-timestamp';

const LRU_MAX = 100;

interface AgentCacheEntry {
  record: AgentRecord;
  cachedAt: number;
}

/** Simple LRU cache backed by a Map (insertion order). */
class AgentCache {
  private map = new Map<string, AgentCacheEntry>();
  private ttlMs: number;

  constructor(ttlMs: number = 30_000) {
    this.ttlMs = ttlMs;
  }

  get(key: string): AgentRecord | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.record;
  }

  set(key: string, record: AgentRecord): void {
    this.map.delete(key); // Remove if exists to refresh order
    if (this.map.size >= LRU_MAX) {
      // Evict oldest (first entry)
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, { record, cachedAt: Date.now() });
  }

  invalidate(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

function verifyHmac(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  signature: string,
): boolean {
  const payload = `${timestamp}\n${method}\n${path}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

function decryptSecret(encryptedBase64: string): string {
  const buf = Buffer.from(encryptedBase64, 'base64');
  // Format: iv (12) + authTag (16) + ciphertext (rest)
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  return decrypt({ encrypted, iv, authTag });
}

export function encryptSecret(plaintext: string): string {
  const { encrypted, iv, authTag } = encrypt(plaintext);
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function generateAgentSecret(): { secret: string; hash: string; encrypted: string } {
  const secret = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16);
  const encrypted = encryptSecret(secret);
  return { secret, hash, encrypted };
}

export function createAgentIdentityPlugin(
  db: Database.Database,
  getLiveConfig: () => BastionConfig,
  eventBus: PluginEventBus,
): Plugin {
  const agentsRepo = new AgentsRepository(db);
  const cache = new AgentCache();

  // Pre-register agents from config on first call
  let configSeeded = false;

  function seedConfigAgents(): void {
    if (configSeeded) return;
    configSeeded = true;
    const config = getLiveConfig();
    const agentConfig = config.plugins?.agentIdentity;
    if (!agentConfig?.agents?.length) return;

    for (const a of agentConfig.agents) {
      const existing = agentsRepo.getByName(a.name);
      if (existing) continue;
      const id = crypto.randomUUID();
      agentsRepo.insert({
        id,
        name: a.name,
        description: a.description,
        owner: a.owner,
        trust_level: a.trustLevel ?? agentConfig.defaultTrustLevel ?? 'standard',
        tool_scope: a.toolScope,
      });
      log.info('Pre-registered agent from config', { name: a.name, id });
    }
  }

  function lookupAgent(agentId: string): AgentRecord | null {
    // Try cache first
    let record = cache.get(agentId);
    if (record) return record;

    // DB lookup — try by id first, then by name
    record = agentsRepo.get(agentId);
    if (!record) {
      record = agentsRepo.getByName(agentId);
    }
    if (record) {
      cache.set(record.id, record);
      if (record.name !== record.id) cache.set(record.name, record);
    }
    return record;
  }

  return {
    name: 'agent-identity',
    priority: 0, // Runs first, before all other plugins
    version: '1.0.0',
    apiVersion: 2,
    source: 'builtin',

    async onRequest(context: RequestContext): Promise<PluginRequestResult | void> {
      seedConfigAgents();

      const config = getLiveConfig();
      const agentConfig = config.plugins?.agentIdentity;
      if (!agentConfig?.enabled) return;

      const agentIdHeader = context.headers[HEADER_AGENT_ID];
      if (!agentIdHeader) return; // No agent header — fully backward compatible

      let agent = lookupAgent(agentIdHeader);

      if (!agent) {
        if (agentConfig.mode === 'strict') {
          log.warn('Unknown agent rejected (strict mode)', { agentId: agentIdHeader });
          eventBus.emit('agent:rejected', { agentId: agentIdHeader, reason: 'unknown' });
          return {
            shortCircuit: {
              statusCode: 403,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ error: 'Unknown agent', agentId: agentIdHeader }),
            },
          };
        }

        // Auto-register
        const id = crypto.randomUUID();
        agentsRepo.insert({
          id,
          name: agentIdHeader,
          trust_level: agentConfig.defaultTrustLevel ?? 'standard',
        });
        agent = agentsRepo.get(id);
        if (agent) {
          cache.set(agent.id, agent);
          cache.set(agent.name, agent);
          log.info('Auto-registered agent', { name: agentIdHeader, id });
          eventBus.emit('agent:registered', { agentId: id, name: agentIdHeader });
        }
      }

      if (!agent) return; // Should not happen

      // Check status
      if (agent.status === 'suspended' || agent.status === 'revoked') {
        log.warn('Agent request rejected', { agentId: agent.id, name: agent.name, status: agent.status });
        eventBus.emit('agent:rejected', { agentId: agent.id, name: agent.name, reason: agent.status });
        return {
          shortCircuit: {
            statusCode: 403,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: `Agent ${agent.status}`, agentId: agent.id }),
          },
        };
      }

      // HMAC verification (if agent has a secret)
      if (agent.encrypted_secret) {
        const signature = context.headers[HEADER_HMAC_SIGNATURE];
        const timestamp = context.headers[HEADER_HMAC_TIMESTAMP];

        if (!signature || !timestamp) {
          if (agentConfig.hmacRequired) {
            log.warn('Missing HMAC signature', { agentId: agent.id });
            eventBus.emit('agent:rejected', { agentId: agent.id, reason: 'missing-signature' });
            return {
              shortCircuit: {
                statusCode: 403,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ error: 'HMAC signature required', agentId: agent.id }),
              },
            };
          }
          // Not required — skip verification
        } else {
          // Verify timestamp freshness (5 minute window)
          const ts = parseInt(timestamp, 10);
          if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
            log.warn('HMAC timestamp expired', { agentId: agent.id });
            eventBus.emit('agent:rejected', { agentId: agent.id, reason: 'timestamp-expired' });
            return {
              shortCircuit: {
                statusCode: 403,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ error: 'HMAC timestamp expired', agentId: agent.id }),
              },
            };
          }

          try {
            const secret = decryptSecret(agent.encrypted_secret);
            const valid = verifyHmac(secret, timestamp, context.method, context.path, signature);
            if (!valid) {
              log.warn('HMAC verification failed', { agentId: agent.id });
              eventBus.emit('agent:rejected', { agentId: agent.id, reason: 'invalid-signature' });
              return {
                shortCircuit: {
                  statusCode: 403,
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ error: 'Invalid HMAC signature', agentId: agent.id }),
                },
              };
            }
          } catch (err) {
            log.warn('HMAC verification error', { agentId: agent.id, error: (err as Error).message });
            eventBus.emit('agent:rejected', { agentId: agent.id, reason: 'hmac-error' });
            return {
              shortCircuit: {
                statusCode: 403,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ error: 'HMAC verification failed', agentId: agent.id }),
              },
            };
          }
        }
      }

      // Set agent context
      context.agentId = agent.id;
      context.agentTrustLevel = agent.trust_level as AgentTrustLevel;

      // Parse and set tool scope
      if (agent.tool_scope) {
        try {
          context._agentToolScope = JSON.parse(agent.tool_scope) as string[];
        } catch {
          context._agentToolScope = null;
        }
      } else {
        context._agentToolScope = null; // null = all allowed
      }

      // Touch last_seen
      agentsRepo.touch(agent.id);

      log.debug('Agent identified', {
        agentId: agent.id,
        name: agent.name,
        trustLevel: agent.trust_level,
        toolScope: context._agentToolScope ? context._agentToolScope.length + ' tools' : 'all',
      });

      eventBus.emit('agent:identified', {
        agentId: agent.id,
        name: agent.name,
        trustLevel: agent.trust_level,
      });
    },
  };
}

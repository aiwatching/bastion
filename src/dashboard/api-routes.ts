import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { RequestsRepository } from '../storage/repositories/requests.js';
import { DlpEventsRepository } from '../storage/repositories/dlp-events.js';
import { OptimizerEventsRepository } from '../storage/repositories/optimizer-events.js';
import { AuditLogRepository } from '../storage/repositories/audit-log.js';
import { CacheRepository } from '../storage/repositories/cache.js';
import { SessionsRepository } from '../storage/repositories/sessions.js';
import { DlpPatternsRepository } from '../storage/repositories/dlp-patterns.js';
import type { ConfigManager } from '../config/manager.js';
import type { PluginManager } from '../plugins/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('api-routes');

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}

function sendJson(res: ServerResponse, data: unknown, status: number = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function bufferBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function createApiRouter(
  db: Database.Database,
  configManager: ConfigManager,
  pluginManager: PluginManager,
): (req: IncomingMessage, res: ServerResponse) => boolean {
  const requestsRepo = new RequestsRepository(db);
  const dlpRepo = new DlpEventsRepository(db);
  const optimizerRepo = new OptimizerEventsRepository(db);
  const auditRepo = new AuditLogRepository(db);
  const cacheRepo = new CacheRepository(db);
  const sessionsRepo = new SessionsRepository(db);
  const dlpPatternsRepo = new DlpPatternsRepository(db);

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const url = parseUrl(req);
    const path = url.pathname;

    // GET /api/stats — Enhanced with filters
    if (req.method === 'GET' && path === '/api/stats') {
      const sessionId = url.searchParams.get('session_id') ?? undefined;
      const apiKeyHash = url.searchParams.get('api_key_hash') ?? undefined;
      const hours = url.searchParams.get('hours');
      const sinceHours = hours ? parseInt(hours, 10) : undefined;

      const stats = requestsRepo.getStats({ sinceHours, sessionId, apiKeyHash });
      const recent = requestsRepo.getRecent(20);
      const cacheStats = cacheRepo.getStats();
      const dlpStats = dlpRepo.getStats();

      sendJson(res, {
        stats,
        recent,
        cache: cacheStats,
        dlp: dlpStats,
        uptime: process.uptime(),
        memory: process.memoryUsage().rss,
      });
      return true;
    }

    // GET /api/sessions
    if (req.method === 'GET' && path === '/api/sessions') {
      sendJson(res, requestsRepo.getSessions());
      return true;
    }

    // GET /api/dlp/recent
    if (req.method === 'GET' && path === '/api/dlp/recent') {
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
      sendJson(res, dlpRepo.getRecent(limit));
      return true;
    }

    // GET /api/optimizer/stats
    if (req.method === 'GET' && path === '/api/optimizer/stats') {
      sendJson(res, optimizerRepo.getStats());
      return true;
    }

    // GET /api/optimizer/recent
    if (req.method === 'GET' && path === '/api/optimizer/recent') {
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
      sendJson(res, optimizerRepo.getRecent(limit));
      return true;
    }

    // GET /api/audit/recent
    if (req.method === 'GET' && path === '/api/audit/recent') {
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
      sendJson(res, auditRepo.getRecent(limit));
      return true;
    }

    // GET /api/audit/sessions — list sessions with audit data
    if (req.method === 'GET' && path === '/api/audit/sessions') {
      sendJson(res, auditRepo.getAuditSessions());
      return true;
    }

    // GET /api/audit/session/:sessionId — full parsed timeline for a session
    if (req.method === 'GET' && path.startsWith('/api/audit/session/')) {
      const sessionId = path.slice('/api/audit/session/'.length);
      if (!sessionId) {
        sendJson(res, { error: 'Missing session ID' }, 400);
        return true;
      }
      const timeline = auditRepo.getParsedSession(sessionId);
      if (timeline.length === 0) {
        sendJson(res, { error: 'No audit entries for this session' }, 404);
        return true;
      }
      const session = sessionsRepo.get(sessionId) ?? null;
      sendJson(res, { session, timeline });
      return true;
    }

    // GET /api/audit/:requestId — single request parsed
    if (req.method === 'GET' && path.startsWith('/api/audit/') && !path.includes('/session')) {
      const requestId = path.slice('/api/audit/'.length);
      if (!requestId) {
        sendJson(res, { error: 'Missing request ID' }, 400);
        return true;
      }
      const parsed = auditRepo.getParsedByRequestId(requestId);
      if (!parsed) {
        sendJson(res, { error: 'Audit entry not found' }, 404);
        return true;
      }
      sendJson(res, parsed);
      return true;
    }

    // GET /api/config
    if (req.method === 'GET' && path === '/api/config') {
      const config = configManager.get();
      const pluginStatus: Record<string, boolean> = {};
      for (const p of pluginManager.getPlugins()) {
        pluginStatus[p.name] = !pluginManager.isDisabled(p.name);
      }
      sendJson(res, { config, pluginStatus });
      return true;
    }

    // PUT /api/config
    if (req.method === 'PUT' && path === '/api/config') {
      bufferBody(req).then((body) => {
        try {
          const update = JSON.parse(body);

          // Handle plugin enable/disable
          if (update.pluginStatus) {
            for (const [name, enabled] of Object.entries(update.pluginStatus)) {
              if (enabled) {
                pluginManager.enable(name);
              } else {
                pluginManager.disable(name);
              }
            }
            delete update.pluginStatus;
          }

          // Apply remaining config changes
          if (Object.keys(update).length > 0) {
            configManager.update(update);
          }

          const config = configManager.get();
          const pluginStatus: Record<string, boolean> = {};
          for (const p of pluginManager.getPlugins()) {
            pluginStatus[p.name] = !pluginManager.isDisabled(p.name);
          }
          sendJson(res, { config, pluginStatus });
        } catch (err) {
          sendJson(res, { error: (err as Error).message }, 400);
        }
      }).catch((err) => {
        sendJson(res, { error: (err as Error).message }, 500);
      });
      return true;
    }

    // GET /api/dlp/patterns — all patterns for UI listing
    if (req.method === 'GET' && path === '/api/dlp/patterns') {
      sendJson(res, dlpPatternsRepo.getAll());
      return true;
    }

    // POST /api/dlp/patterns — add custom pattern
    if (req.method === 'POST' && path === '/api/dlp/patterns') {
      bufferBody(req).then((body) => {
        try {
          const data = JSON.parse(body);
          if (!data.name || !data.regex_source) {
            sendJson(res, { error: 'name and regex_source are required' }, 400);
            return;
          }
          // Validate regex
          try {
            new RegExp(data.regex_source, data.regex_flags ?? 'g');
          } catch {
            sendJson(res, { error: 'Invalid regex' }, 400);
            return;
          }
          const id = `custom-${crypto.randomUUID()}`;
          dlpPatternsRepo.upsert({
            id,
            name: data.name,
            category: data.category ?? 'custom',
            regex_source: data.regex_source,
            regex_flags: data.regex_flags ?? 'g',
            description: data.description ?? null,
            validator: data.validator ?? null,
            require_context: data.require_context ?? null,
            enabled: data.enabled !== false,
          });
          sendJson(res, { id }, 201);
        } catch (err) {
          sendJson(res, { error: (err as Error).message }, 400);
        }
      }).catch((err) => {
        sendJson(res, { error: (err as Error).message }, 500);
      });
      return true;
    }

    // PUT /api/dlp/patterns/:id — update pattern (toggle enabled, edit fields)
    if (req.method === 'PUT' && path.startsWith('/api/dlp/patterns/')) {
      const id = decodeURIComponent(path.slice('/api/dlp/patterns/'.length));
      if (!id) {
        sendJson(res, { error: 'Missing pattern ID' }, 400);
        return true;
      }
      bufferBody(req).then((body) => {
        try {
          const data = JSON.parse(body);
          // If just toggling enabled
          if (data.enabled !== undefined && Object.keys(data).length === 1) {
            dlpPatternsRepo.toggle(id, Boolean(data.enabled));
            sendJson(res, { ok: true });
            return;
          }
          // Validate regex if provided
          if (data.regex_source) {
            try {
              new RegExp(data.regex_source, data.regex_flags ?? 'g');
            } catch {
              sendJson(res, { error: 'Invalid regex' }, 400);
              return;
            }
          }
          // Full upsert for custom patterns
          if (data.name && data.regex_source) {
            dlpPatternsRepo.upsert({ id, ...data });
          } else if (data.enabled !== undefined) {
            dlpPatternsRepo.toggle(id, Boolean(data.enabled));
          }
          sendJson(res, { ok: true });
        } catch (err) {
          sendJson(res, { error: (err as Error).message }, 400);
        }
      }).catch((err) => {
        sendJson(res, { error: (err as Error).message }, 500);
      });
      return true;
    }

    // DELETE /api/dlp/patterns/:id — delete custom pattern only
    if (req.method === 'DELETE' && path.startsWith('/api/dlp/patterns/')) {
      const id = decodeURIComponent(path.slice('/api/dlp/patterns/'.length));
      if (!id) {
        sendJson(res, { error: 'Missing pattern ID' }, 400);
        return true;
      }
      try {
        dlpPatternsRepo.remove(id);
        sendJson(res, { ok: true });
      } catch (err) {
        sendJson(res, { error: (err as Error).message }, 400);
      }
      return true;
    }

    return false;
  };
}

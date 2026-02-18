import type Database from 'better-sqlite3';
import { encrypt, decrypt } from '../encryption.js';

export interface AuditLogRecord {
  id: string;
  request_id: string;
  encrypted_content: Buffer | null;
  iv: Buffer;
  auth_tag: Buffer;
  request_length: number;
  response_length: number;
  created_at: string;
}

export interface AuditLogMeta {
  id: string;
  request_id: string;
  request_length: number;
  response_length: number;
  created_at: string;
}

export class AuditLogRepository {
  private db: Database.Database;
  private insertStmt: Database.Statement;

  constructor(db: Database.Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO audit_log (id, request_id, encrypted_content, iv, auth_tag, request_length, response_length)
      VALUES (@id, @request_id, @encrypted_content, @iv, @auth_tag, @request_length, @response_length)
    `);
  }

  insert(record: {
    id: string;
    request_id: string;
    requestBody: string;
    responseBody: string;
  }): void {
    const MAX_BODY = 100 * 1024;
    const reqBody = record.requestBody.length > MAX_BODY
      ? record.requestBody.slice(0, MAX_BODY)
      : record.requestBody;
    const resBody = record.responseBody.length > MAX_BODY
      ? record.responseBody.slice(0, MAX_BODY)
      : record.responseBody;

    const content = JSON.stringify({ request: reqBody, response: resBody });
    const { encrypted, iv, authTag } = encrypt(content);

    this.insertStmt.run({
      id: record.id,
      request_id: record.request_id,
      encrypted_content: encrypted,
      iv,
      auth_tag: authTag,
      request_length: record.requestBody.length,
      response_length: record.responseBody.length,
    });
  }

  getByRequestId(requestId: string): { request: string; response: string } | null {
    const row = this.db.prepare(
      'SELECT * FROM audit_log WHERE request_id = ? LIMIT 1'
    ).get(requestId) as AuditLogRecord | undefined;

    if (!row || !row.encrypted_content) return null;

    const decrypted = decrypt({
      encrypted: row.encrypted_content,
      iv: row.iv,
      authTag: row.auth_tag,
    });

    return JSON.parse(decrypted) as { request: string; response: string };
  }

  getRecent(limit: number = 20): AuditLogMeta[] {
    return this.db.prepare(`
      SELECT id, request_id, request_length, response_length, created_at
      FROM audit_log ORDER BY created_at DESC LIMIT ?
    `).all(limit) as AuditLogMeta[];
  }

  purgeOlderThan(hours: number): number {
    const result = this.db.prepare(
      `DELETE FROM audit_log WHERE created_at < datetime('now', '-' || ? || ' hours')`
    ).run(hours);
    return result.changes;
  }
}

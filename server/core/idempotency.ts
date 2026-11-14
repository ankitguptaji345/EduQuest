import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from './database.ts';
import { AppError } from './errors.ts';
import type { AuthenticatedRequest } from './security.ts';

function canonicalize(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalize(item)).join(',')}]`;
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize((obj as Record<string, unknown>)[k])}`);
  return `{${sorted.join(',')}}`;
}

export function hashRequestPayload(method: string, path: string, body: unknown): string {
  return crypto
    .createHash('sha256')
    .update(`${method}:${path}:${canonicalize(body ?? {})}`)
    .digest('hex');
}

export function idempotent(requireKey = true) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    const keyHeader = req.headers['idempotency-key'];
    const key = typeof keyHeader === 'string' ? keyHeader.trim() : '';

    if (!key) {
      if (requireKey) {
        next(new AppError(400, 'MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required.'));
        return;
      }
      next();
      return;
    }

    const db = getDb();
    const endpoint = `${req.method}:${req.baseUrl}${req.path}`;
    const requestHash = hashRequestPayload(req.method, endpoint, req.body);

    const existing = db
      .prepare(
        `SELECT request_hash, response_status, response_body, expires_at
         FROM idempotency_keys WHERE user_id = ? AND key = ?`,
      )
      .get(authReq.userId, key) as
      | {
          request_hash: string;
          response_status: number;
          response_body: string;
          expires_at: string;
        }
      | undefined;

    if (existing) {
      if (new Date(existing.expires_at).getTime() > Date.now()) {
        if (existing.request_hash !== requestHash) {
          next(
            new AppError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Idempotency-Key was already used with a different request payload.',
            ),
          );
          return;
        }
        res.status(existing.response_status).json(JSON.parse(existing.response_body));
        return;
      }
      db.prepare('DELETE FROM idempotency_keys WHERE user_id = ? AND key = ?').run(
        authReq.userId,
        key,
      );
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 500) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        try {
          db.prepare(
            `INSERT OR REPLACE INTO idempotency_keys
             (user_id, key, endpoint, request_hash, response_status, response_body, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            authReq.userId,
            key,
            endpoint,
            requestHash,
            res.statusCode,
            JSON.stringify(body),
            expiresAt,
          );
        } catch (err) {
          console.error('Failed to persist idempotency key:', err);
        }
      }
      return originalJson(body);
    }) as Response['json'];

    next();
  };
}

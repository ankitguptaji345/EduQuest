import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config } from './config.ts';
import { AppError } from './errors.ts';
import { getDb } from './database.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userTimezone?: string;
      requestId?: string;
    }
  }
}

export interface AuthenticatedRequest extends Request<Record<string, string>> {
  userId: string;
  userEmail: string;
  userTimezone: string;
  requestId: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signJwt(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email, aud: 'authenticated' }, config.jwtSecret, {
    expiresIn: '7d',
  });
}

export function verifyJwt(token: string): { sub: string; email: string } {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { audience: 'authenticated' }) as {
      sub?: string;
      email?: string;
    };
    if (!decoded.sub) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid authentication token.');
    }
    return { sub: decoded.sub, email: decoded.email || '' };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_TOKEN', 'Missing, invalid, or expired authentication token.');
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHORIZED', 'Authentication bearer token required.'));
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  const payload = verifyJwt(token);
  const db = getDb();
  const profile = db
    .prepare('SELECT id, email, timezone, deletion_requested_at FROM profiles WHERE id = ?')
    .get(payload.sub) as
    | { id: string; email: string; timezone: string; deletion_requested_at: string | null }
    | undefined;

  if (!profile) {
    next(new AppError(401, 'USER_NOT_FOUND', 'User session is no longer valid.'));
    return;
  }

  const authReq = req as AuthenticatedRequest;
  authReq.userId = profile.id;
  authReq.userEmail = profile.email;
  authReq.userTimezone = profile.timezone || 'UTC';
  next();
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers['x-request-id']
    ? String(req.headers['x-request-id'])
    : crypto.randomUUID();
  (req as AuthenticatedRequest).requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

// Prompt injection delimiter fencing (Blueprint C24)
export function sanitizeAndFence(untrustedText: string, tag: string): string {
  const safeClose = new RegExp(`</${tag}>`, 'gi');
  const cleaned = untrustedText.replace(safeClose, `[/${tag}]`);
  return `<${tag}>\n${cleaned}\n</${tag}>`;
}

// Simple in-memory burst rate limiter (Blueprint C14)
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests = 120, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip || 'local'}:${req.path.startsWith('/api/auth') ? 'auth' : 'api'}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > maxRequests) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      next(
        new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests. Please slow down.', {
          retry_after_seconds: retryAfter,
        }),
      );
      return;
    }
    next();
  };
}

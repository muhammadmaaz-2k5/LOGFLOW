import crypto from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { TeamRole } from '@logflow/shared';
import { config } from '../config.js';
import { getDb } from '../db/postgres.js';

export interface AuthUserPayload {
  id: string;
  email: string;
  name: string;
  role: TeamRole;
}

export interface ApiKeyContext {
  id: string;
  project_id: string;
  name: string;
  rate_limit_per_min: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUserPayload;
    apiKey?: ApiKeyContext;
  }
}

const JWT_ISSUER = 'logflow-api';
const JWT_AUDIENCE = 'logflow-web';

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function generateApiKey(): { rawKey: string; prefix: string; hash: string } {
  const randomPart = crypto.randomBytes(24).toString('hex');
  const rawKey = `lf_live_${randomPart}`;
  const prefix = rawKey.slice(0, 14);
  const hash = hashApiKey(rawKey);
  return { rawKey, prefix, hash };
}

export function signJwt(payload: AuthUserPayload): string {
  return jwt.sign(
    {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role
    },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: '24h',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }
  );
}

export async function requireJwt(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  const queryToken = (request.query as Record<string, string | undefined>)?.token;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;

  if (!token) {
    reply.code(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Provide a valid Bearer token.'
      }
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }) as AuthUserPayload;

    // Verify user still exists and load authoritative role from database
    const db = await getDb();
    const userRes = await db.query<{
      id: string;
      email: string;
      name: string;
      role: TeamRole;
    }>(`SELECT id, email, name, role FROM users WHERE id = $1`, [decoded.id]);

    const currentUser = userRes.rows[0];
    if (!currentUser) {
      reply.code(401).send({
        error: {
          code: 'USER_REVOKED',
          message: 'User account no longer exists.'
        }
      });
      return;
    }

    request.user = {
      id: currentUser.id,
      email: currentUser.email,
      name: currentUser.name,
      role: currentUser.role
    };
  } catch {
    reply.code(401).send({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired JWT token.'
      }
    });
  }
}

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const rawKey = request.headers['x-api-key'];
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim().length < 16 || rawKey.length > 256) {
    reply.code(401).send({
      error: {
        code: 'MISSING_API_KEY',
        message: 'Missing or malformed X-API-Key header.'
      }
    });
    return;
  }

  const keyHash = hashApiKey(rawKey.trim());
  const db = await getDb();
  const res = await db.query<{
    id: string;
    project_id: string;
    name: string;
    rate_limit_per_min: number;
    revoked_at: string | null;
  }>(
    `SELECT id, project_id, name, rate_limit_per_min, revoked_at
     FROM api_keys
     WHERE key_hash = $1`,
    [keyHash]
  );

  const keyRecord = res.rows[0];
  if (!keyRecord) {
    reply.code(401).send({
      error: {
        code: 'INVALID_API_KEY',
        message: 'The provided X-API-Key is invalid.'
      }
    });
    return;
  }

  if (keyRecord.revoked_at) {
    reply.code(403).send({
      error: {
        code: 'REVOKED_API_KEY',
        message: 'The provided X-API-Key has been revoked.'
      }
    });
    return;
  }

  await db.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [keyRecord.id]);
  request.apiKey = {
    id: keyRecord.id,
    project_id: keyRecord.project_id,
    name: keyRecord.name,
    rate_limit_per_min: Number(keyRecord.rate_limit_per_min)
  };
}

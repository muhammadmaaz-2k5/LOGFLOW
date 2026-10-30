import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginSchema, RegisterSchema, TeamRole } from '@logflow/shared';
import { getDb, hydrateMetadataFromMongo } from '../db/postgres.js';
import { requireJwt, signJwt } from '../middleware/auth.js';

// Precomputed dummy hash to mitigate user-enumeration timing attacks on login
const DUMMY_BCRYPT_HASH = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

const authAttemptBuckets = new Map<string, { windowStartMs: number; count: number }>();

function checkAuthRateLimit(request: FastifyRequest, reply: FastifyReply): boolean {
  const ip = request.ip || 'unknown';
  const now = Date.now();
  const existing = authAttemptBuckets.get(ip);

  if (!existing || now - existing.windowStartMs >= 60_000) {
    authAttemptBuckets.set(ip, { windowStartMs: now, count: 1 });
    return true;
  }

  if (existing.count >= 20) {
    reply.code(429).send({
      error: {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many authentication attempts. Please try again in a minute.'
      }
    });
    return false;
  }

  existing.count += 1;
  return true;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/auth/register', async (request, reply) => {
    if (!checkAuthRateLimit(request, reply)) return;

    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Invalid registration data.',
          details: parsed.error.flatten()
        }
      });
    }

    const { email, password, name } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const db = await getDb();

    const existing = await db.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [
      normalizedEmail
    ]);
    if (existing.rows.length > 0) {
      return reply.code(409).send({
        error: {
          code: 'EMAIL_EXISTS',
          message: 'An account with this email already exists.'
        }
      });
    }

    // Only the first user in an empty workspace becomes admin; subsequent self-registrations are members
    const countRes = await db.query<{ cnt: string | number }>(`SELECT COUNT(*) AS cnt FROM users`);
    const assignedRole: TeamRole = Number(countRes.rows[0]?.cnt ?? 0) === 0 ? 'admin' : 'member';

    const passwordHash = await bcrypt.hash(password, 12);
    const id = `usr_${crypto.randomUUID().slice(0, 10)}`;
    const nowIso = new Date().toISOString();

    await db.query(
      `INSERT INTO users (id, email, password_hash, name, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, normalizedEmail, passwordHash, name, assignedRole, nowIso]
    );

    const user = {
      id,
      email: normalizedEmail,
      name,
      role: assignedRole,
      created_at: nowIso
    };

    const token = signJwt(user);
    return reply.code(201).send({ token, user });
  });

  app.post('/v1/auth/login', async (request, reply) => {
    if (!checkAuthRateLimit(request, reply)) return;

    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Valid email and password are required.',
          details: parsed.error.flatten()
        }
      });
    }

    const { email, password } = parsed.data;
    const db = await getDb();

    let res = await db.query<{
      id: string;
      email: string;
      password_hash: string;
      name: string;
      role: TeamRole;
      created_at: string;
    }>(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]);

    let userRow = res.rows[0];
    let ok = userRow ? await bcrypt.compare(password, userRow.password_hash) : false;

    if (!ok) {
      // Refresh from MongoDB Atlas in case seed ran in another process while API was open
      await hydrateMetadataFromMongo(db);
      res = await db.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
      userRow = res.rows[0];
      ok = userRow ? await bcrypt.compare(password, userRow.password_hash) : false;
    }

    if (!userRow) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return reply.code(401).send({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        }
      });
    }

    if (!ok) {
      return reply.code(401).send({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        }
      });
    }

    const user = {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      role: userRow.role,
      created_at: new Date(userRow.created_at).toISOString()
    };

    const token = signJwt(user);
    return reply.send({ token, user });
  });

  app.get('/v1/auth/me', { preHandler: [requireJwt] }, async (request, reply) => {
    const db = await getDb();
    const res = await db.query<{
      id: string;
      email: string;
      name: string;
      role: TeamRole;
      created_at: string;
    }>(`SELECT id, email, name, role, created_at FROM users WHERE id = $1`, [request.user!.id]);

    const user = res.rows[0];
    if (!user) {
      return reply.code(404).send({
        error: { code: 'USER_NOT_FOUND', message: 'User not found.' }
      });
    }

    return reply.send({
      user: {
        ...user,
        created_at: new Date(user.created_at).toISOString()
      }
    });
  });
}

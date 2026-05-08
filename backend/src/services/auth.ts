import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Pool, PoolClient } from 'pg';
import { getConfig } from '../config';
import { getPool } from '../db/pool';
import { Errors } from '../errors';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  timezone: string;
  daily_cap_eur: string;
  created_at: Date;
  deleted_at: Date | null;
}

export interface PublicUser {
  id: string;
  email: string;
  timezone: string;
  dailyCapEur: number;
  createdAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface AccessClaims extends JwtPayload {
  sub: string;
  jti: string;
}

export function hashPassword(password: string, cost = getConfig().BCRYPT_COST): Promise<string> {
  return bcrypt.hash(password, cost);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signAccessToken(userId: string): string {
  const cfg = getConfig();
  return jwt.sign({}, cfg.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: cfg.JWT_ACCESS_TTL_SECONDS,
    jwtid: randomBytes(16).toString('hex'),
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const cfg = getConfig();
  try {
    const decoded = jwt.verify(token, cfg.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !decoded.sub) {
      throw Errors.unauthorized('Invalid token');
    }
    return decoded as AccessClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw Errors.unauthorized('Token expired');
    if (err instanceof jwt.JsonWebTokenError) throw Errors.unauthorized('Invalid token');
    throw err;
  }
}

/** Refresh tokens are random 32-byte values, returned to the client base64url-encoded. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function publicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    timezone: row.timezone,
    dailyCapEur: Number(row.daily_cap_eur),
    createdAt: row.created_at.toISOString(),
  };
}

interface ServiceDeps {
  pool?: Pool;
}

function poolOf(deps?: ServiceDeps): Pool {
  return deps?.pool ?? getPool();
}

async function insertRefreshToken(client: PoolClient, userId: string, token: string): Promise<void> {
  const cfg = getConfig();
  const expiresAt = new Date(Date.now() + cfg.JWT_REFRESH_TTL_SECONDS * 1000);
  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashRefreshToken(token), expiresAt],
  );
}

export async function signup(
  emailRaw: string,
  password: string,
  deps?: ServiceDeps,
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const pool = poolOf(deps);
  const email = emailRaw.trim().toLowerCase();
  const client = await pool.connect();
  try {
    const exists = await client.query<UserRow>(
      `SELECT id FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`,
      [email],
    );
    if (exists.rowCount && exists.rowCount > 0) {
      throw Errors.conflict('Email already registered');
    }
    const passwordHash = await hashPassword(password);
    const inserted = await client.query<UserRow>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *`,
      [email, passwordHash],
    );
    const row = inserted.rows[0];
    if (!row) throw Errors.internal('Failed to create user');
    const accessToken = signAccessToken(row.id);
    const refreshToken = generateRefreshToken();
    await insertRefreshToken(client, row.id, refreshToken);
    return { user: publicUser(row), tokens: { accessToken, refreshToken } };
  } finally {
    client.release();
  }
}

export async function login(
  emailRaw: string,
  password: string,
  deps?: ServiceDeps,
): Promise<{ user: PublicUser; tokens: TokenPair }> {
  const pool = poolOf(deps);
  const email = emailRaw.trim().toLowerCase();
  const client = await pool.connect();
  try {
    const r = await client.query<UserRow>(
      `SELECT * FROM users WHERE lower(email) = $1 AND deleted_at IS NULL`,
      [email],
    );
    const row = r.rows[0];
    if (!row) throw Errors.unauthorized('Invalid email or password');
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) throw Errors.unauthorized('Invalid email or password');
    const accessToken = signAccessToken(row.id);
    const refreshToken = generateRefreshToken();
    await insertRefreshToken(client, row.id, refreshToken);
    return { user: publicUser(row), tokens: { accessToken, refreshToken } };
  } finally {
    client.release();
  }
}

/**
 * Rotate a refresh token. The presented refresh token is verified, marked used,
 * and a new pair is issued. If the same refresh token is presented twice, the
 * second attempt fails (single-use).
 */
export async function rotateRefresh(
  presentedToken: string,
  deps?: ServiceDeps,
): Promise<TokenPair> {
  const pool = poolOf(deps);
  const presentedHash = hashRefreshToken(presentedToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, user_id, expires_at, used_at FROM refresh_tokens
       WHERE token_hash = $1 FOR UPDATE`,
      [presentedHash],
    );
    const row = r.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      throw Errors.unauthorized('Invalid refresh token');
    }
    if (row.used_at) {
      // Reuse detected — invalidate all of this user's refresh tokens.
      await client.query(
        `UPDATE refresh_tokens SET used_at = now()
         WHERE user_id = $1 AND used_at IS NULL`,
        [row.user_id],
      );
      await client.query('COMMIT');
      throw Errors.unauthorized('Refresh token reuse detected');
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      throw Errors.unauthorized('Refresh token expired');
    }
    const newRefresh = generateRefreshToken();
    const newHash = hashRefreshToken(newRefresh);
    await client.query(
      `UPDATE refresh_tokens SET used_at = now(), replaced_by_token_hash = $2 WHERE id = $1`,
      [row.id, newHash],
    );
    await insertRefreshToken(client, row.user_id, newRefresh);
    await client.query('COMMIT');
    const accessToken = signAccessToken(row.user_id);
    return { accessToken, refreshToken: newRefresh };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeRefresh(presentedToken: string, deps?: ServiceDeps): Promise<void> {
  const pool = poolOf(deps);
  const hash = hashRefreshToken(presentedToken);
  await pool.query(
    `UPDATE refresh_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL`,
    [hash],
  );
}

export async function getUserById(userId: string, deps?: ServiceDeps): Promise<PublicUser | null> {
  const pool = poolOf(deps);
  const r = await pool.query<UserRow>(
    `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  const row = r.rows[0];
  return row ? publicUser(row) : null;
}

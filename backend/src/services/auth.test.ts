import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from './auth';
import { resetConfigCache } from '../config';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  process.env.JWT_ACCESS_TTL_SECONDS = '900';
  process.env.JWT_REFRESH_TTL_SECONDS = '604800';
  process.env.BCRYPT_COST = '4'; // fast in tests
  resetConfigCache();
});

describe('auth service — pure helpers', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple', 4);
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('issues and verifies an access token', () => {
    const token = signAccessToken('user-123');
    expect(typeof token).toBe('string');
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe('user-123');
    expect(claims.jti).toBeDefined();
    expect(typeof claims.exp).toBe('number');
  });

  it('rejects a token signed with a different secret', () => {
    const token = signAccessToken('user-123');
    process.env.JWT_SECRET = 'different-secret-different-secret-different';
    resetConfigCache();
    expect(() => verifyAccessToken(token)).toThrow(/Invalid token/);
    process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
    resetConfigCache();
  });

  it('rejects an expired token', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign({}, process.env.JWT_SECRET as string, {
      algorithm: 'HS256',
      subject: 'user-123',
      expiresIn: -1,
    });
    expect(() => verifyAccessToken(token)).toThrow(/expired/);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyAccessToken('not-a-token')).toThrow(/Invalid token/);
  });

  it('generates random refresh tokens and consistent sha256 hashes', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    const ha = hashRefreshToken(a);
    expect(ha).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(a)).toBe(ha);
    expect(hashRefreshToken(b)).not.toBe(ha);
  });
});

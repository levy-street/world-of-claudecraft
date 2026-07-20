import { beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

// Real NextRequest objects through the real gates — only env is fixtured.

const ENV_FIXTURE = {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
  KEY_ENCRYPTION_KEY: 'a'.repeat(64),
  INTERNAL_SHARED_SECRET: 'internal-secret-0123456789',
  ADMIN_TOKEN: 'admin-token-123',
};

let requireInternalSecret: typeof import('@/lib/auth').requireInternalSecret;
let requireAdminToken: typeof import('@/lib/auth').requireAdminToken;
let clientIp: typeof import('@/lib/auth').clientIp;

beforeAll(async () => {
  Object.assign(process.env, ENV_FIXTURE);
  const { resetEnvCache } = await import('@/lib/env');
  resetEnvCache();
  ({ requireInternalSecret, requireAdminToken, clientIp } = await import('@/lib/auth'));
});

function req(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/test', { headers });
}

describe('requireInternalSecret', () => {
  it('admits the exact shared secret', () => {
    expect(requireInternalSecret(req({ 'x-internal-secret': ENV_FIXTURE.INTERNAL_SHARED_SECRET }))).toBeNull();
  });

  it('rejects a wrong, empty, or missing secret with 401', () => {
    const cases: Record<string, string>[] = [
      { 'x-internal-secret': 'wrong-secret-0123456789' },
      { 'x-internal-secret': '' },
      {},
    ];
    for (const headers of cases) {
      const res = requireInternalSecret(req(headers));
      expect(res?.status).toBe(401);
    }
  });

  it('rejects the admin token used as the internal secret (no cross-privilege)', () => {
    expect(requireInternalSecret(req({ 'x-internal-secret': ENV_FIXTURE.ADMIN_TOKEN }))?.status).toBe(401);
  });
});

describe('requireAdminToken', () => {
  it('admits the exact admin token', () => {
    expect(requireAdminToken(req({ 'x-admin-token': ENV_FIXTURE.ADMIN_TOKEN }))).toBeNull();
  });

  it('rejects wrong or missing tokens with 401', () => {
    expect(requireAdminToken(req({ 'x-admin-token': 'nope' }))?.status).toBe(401);
    expect(requireAdminToken(req())?.status).toBe(401);
  });

  it('rejects a token that is a prefix of the real one', () => {
    expect(requireAdminToken(req({ 'x-admin-token': ENV_FIXTURE.ADMIN_TOKEN.slice(0, -1) }))?.status).toBe(401);
  });
});

describe('clientIp', () => {
  it('takes the first x-forwarded-for hop', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }))).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip, then "unknown"', () => {
    expect(clientIp(req({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(req())).toBe('unknown');
  });
});

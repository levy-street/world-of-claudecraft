process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_new_endpoint_scaffold';

import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compose } from '../../server/http/compose';
import { resetReferralProgramConfigForTests } from '../../server/referral_program';
import { resetReferralsDbForTests, routes, setReferralsDbForTests } from '../../server/referrals';
import { fakeCtx } from './helpers';

interface FakeResShape {
  statusCode: number;
  body: string;
}

function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeResShape;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

// Full AccountModerationStatus fixtures for the guard's moderation gate.
function okStatus() {
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
  };
}
function bannedStatus() {
  return {
    locked: true,
    banned: true,
    suspendedUntil: null,
    reason: 'banned',
    message: 'This account has been banned.',
    chatMutedUntil: null,
    chatStrikes: 0,
  };
}

const VALID_BEARER = `Bearer ${'a'.repeat(64)}`;

// Facts fixtures against the default gates (7 days, level 20).
function eligibleFacts() {
  return {
    accountAgeDays: 30,
    maxCharacterLevel: 20,
    activeReferrals: 2,
    completedThisSeason: 1,
    completedTotal: 3,
  };
}
function ineligibleFacts() {
  return {
    accountAgeDays: 1,
    maxCharacterLevel: 5,
    activeReferrals: 0,
    completedThisSeason: 0,
    completedTotal: 0,
  };
}

function authedDb(overrides: Parameters<typeof setReferralsDbForTests>[0] = {}) {
  setReferralsDbForTests({
    accountAndScopeForToken: async () => ({ accountId: 7, scope: 'full' }),
    moderationStatusForAccount: async () => okStatus(),
    ...overrides,
  });
}

function runRoute(ctx: Parameters<(typeof routes)[0]['handler']>[0]): Promise<void> {
  const route = routes[0];
  return compose([...(route.middleware ?? [])])(ctx, async () => {
    await route.handler(ctx);
  });
}

afterEach(() => {
  resetReferralsDbForTests();
  resetReferralProgramConfigForTests();
});

describe('GET /api/referral-code', () => {
  it('mints and returns the code for an eligible caller', async () => {
    const mint = vi.fn(async (_accountId: number, _rng: () => number) => 'abcd2345');
    authedDb({
      referrerProgramFacts: async () => eligibleFacts(),
      getOrMintReferralCode: mint,
    });
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/referral-code',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    const readout = body as Record<string, unknown>;
    expect(readout.eligible).toBe(true);
    expect(readout.code).toBe('abcd2345');
    expect(String(readout.url)).toContain('/?ref=abcd2345');
    expect(readout.activeReferrals).toBe(2);
    expect(readout.completedReferrals).toBe(3);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint.mock.calls[0][0]).toBe(7);
  });

  it('returns eligible:false with reasons and never mints for an ineligible caller', async () => {
    const mint = vi.fn(async (_accountId: number, _rng: () => number) => 'abcd2345');
    authedDb({
      referrerProgramFacts: async () => ineligibleFacts(),
      getOrMintReferralCode: mint,
    });
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/referral-code',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx);
    const { status, body } = captured(ctx.res);
    expect(status).toBe(200);
    const readout = body as Record<string, unknown>;
    expect(readout.eligible).toBe(false);
    expect(readout.code).toBeNull();
    expect(readout.url).toBeNull();
    expect(readout.reasons).toEqual(['account_too_new', 'level_too_low']);
    expect(mint).not.toHaveBeenCalled();
  });

  it('401s without a bearer token', async () => {
    const ctx = fakeCtx({ method: 'GET', url: '/api/referral-code' });
    await runRoute(ctx);
    expect(captured(ctx.res).status).toBe(401);
  });

  it('403s a banned account (moderation gate)', async () => {
    authedDb({ moderationStatusForAccount: async () => bannedStatus() });
    const ctx = fakeCtx({
      method: 'GET',
      url: '/api/referral-code',
      headers: { authorization: VALID_BEARER },
    });
    await runRoute(ctx);
    expect(captured(ctx.res).status).toBe(403);
  });
});

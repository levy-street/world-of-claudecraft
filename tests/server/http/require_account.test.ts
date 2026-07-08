// Tests for the bearer-token auth + moderation gate middleware
// (server/http/middleware/require_account.ts). requireAccount is driven
// directly (no compose/onion runtime): call it with a fakeCtx/makeReq and a
// nextGuard, injecting stub lookupToken/moderationStatus so no DB is touched.

import { describe, expect, it } from 'vitest';
import { mapError } from '../../../server/http/errors';
import { requireAccount } from '../../../server/http/middleware/require_account';
import { fakeCtx, nextGuard } from '../helpers/fake_ctx';
import { makeReq } from '../helpers/fake_http';

const VALID_TOKEN = 'a'.repeat(64);

function authHeader(raw: string): Record<string, string> {
  return { authorization: `Bearer ${raw}` };
}

const NOT_LOCKED = {
  locked: false,
  banned: false,
  suspendedUntil: null,
  reason: '',
  message: '',
  chatMutedUntil: null,
  chatStrikes: 0,
};
const BANNED = { ...NOT_LOCKED, locked: true, banned: true, reason: 'banned', message: 'banned' };
const SUSPENDED_UNTIL = {
  ...NOT_LOCKED,
  locked: true,
  suspendedUntil: '2026-07-01T00:00:00.000Z',
  reason: 'suspended',
  message: 'suspended',
};
const SUSPENDED_INDEFINITE = {
  ...NOT_LOCKED,
  locked: true,
  reason: 'suspended',
  message: 'suspended',
};
// A self-deactivated account: locked, not banned, no suspension end date. The
// real moderationStatusForAccount (server/db.ts) surfaces exactly this shape for
// a deactivated account and sets the deactivated discriminator.
const DEACTIVATED = {
  ...NOT_LOCKED,
  locked: true,
  deactivated: true,
  message: 'This account has been deactivated.',
};

describe('requireAccount: missing or invalid token', () => {
  it('throws auth.token_missing when the Authorization header is absent', async () => {
    const ctx = fakeCtx({ req: makeReq({}) });
    const middleware = requireAccount({ scope: 'full' });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 401,
      code: 'auth.token_missing',
    });
  });

  it('serializes the 401 with a WWW-Authenticate header via mapError', async () => {
    const ctx = fakeCtx({ req: makeReq({}) });
    const middleware = requireAccount({ scope: 'full' });
    try {
      await middleware(ctx, nextGuard());
      throw new Error('expected requireAccount to reject');
    } catch (err) {
      const serialized = mapError(err, fakeCtx(), { surface: 'problem' });
      expect(serialized.status).toBe(401);
      expect(JSON.parse(serialized.body).code).toBe('auth.token_missing');
      expect(serialized.headers['WWW-Authenticate']).toBe('Bearer');
    }
  });

  it('throws auth.token_missing for a present but malformed (non 64-hex) Authorization header', async () => {
    const ctx = fakeCtx({
      req: makeReq({ headers: { authorization: 'Bearer not-a-valid-token' } }),
    });
    const middleware = requireAccount({ scope: 'full' });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 401,
      code: 'auth.token_missing',
    });
  });

  it('throws auth.token_invalid when the token is well-formed but unknown', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({ scope: 'full', lookupToken: async () => null });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 401,
      code: 'auth.token_invalid',
    });
  });

  it('serializes the token_invalid 401 with the invalid_token WWW-Authenticate challenge', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({ scope: 'full', lookupToken: async () => null });
    try {
      await middleware(ctx, nextGuard());
      throw new Error('expected requireAccount to reject');
    } catch (err) {
      const serialized = mapError(err, fakeCtx(), { surface: 'problem' });
      expect(serialized.status).toBe(401);
      expect(JSON.parse(serialized.body).code).toBe('auth.token_invalid');
      expect(serialized.headers['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
    }
  });
});

describe('requireAccount: scope gate', () => {
  it('throws auth.forbidden for a full-scope route hit with a read-scope token', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({
      scope: 'full',
      lookupToken: async () => ({ accountId: 1, scope: 'read' }),
      moderationStatus: async () => NOT_LOCKED,
    });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 403,
      code: 'auth.forbidden',
    });
  });
});

describe('requireAccount: moderation gate', () => {
  it('throws moderation.banned for a locked and banned account', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({
      scope: 'full',
      lookupToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatus: async () => BANNED,
    });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 403,
      code: 'moderation.banned',
    });
  });

  it('throws moderation.suspended_until with the date param for a timed suspension', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({
      scope: 'full',
      lookupToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatus: async () => SUSPENDED_UNTIL,
    });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 403,
      code: 'moderation.suspended_until',
      params: { date: SUSPENDED_UNTIL.suspendedUntil },
    });
  });

  it('throws moderation.suspended for a locked account with no suspendedUntil date', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({
      scope: 'full',
      lookupToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatus: async () => SUSPENDED_INDEFINITE,
    });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 403,
      code: 'moderation.suspended',
    });
  });

  it('throws account.deactivated for a self-deactivated (locked, not banned, no suspension) account', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({
      scope: 'full',
      lookupToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatus: async () => DEACTIVATED,
    });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 403,
      code: 'account.deactivated',
    });
  });

  it('applies the moderation gate on a read-scope route too (the bearer-gap coverage)', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({
      scope: 'read',
      lookupToken: async () => ({ accountId: 1, scope: 'read' }),
      moderationStatus: async () => BANNED,
    });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 403,
      code: 'moderation.banned',
    });
  });
});

describe('requireAccount: success', () => {
  it('sets ctx.account and calls next() for a valid, unlocked full token', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    let nextRan = false;
    const middleware = requireAccount({
      scope: 'full',
      lookupToken: async () => ({ accountId: 1, scope: 'full' }),
      moderationStatus: async () => NOT_LOCKED,
    });
    await middleware(
      ctx,
      nextGuard(() => {
        nextRan = true;
      }),
    );
    expect(ctx.account).toEqual({ accountId: 1, scope: 'full' });
    expect(nextRan).toBe(true);
  });
});

// The public-read authz-gap-close mode: a route serves anonymously when NO token is
// present, but a token that IS present is still validated (an invalid token is
// rejected, never silently treated as anonymous). Only the absent-header branch
// changes; everything past it is the required-mode behavior.
describe('requireAccount: optional (anonymous-friendly) mode', () => {
  it('serves anonymously (next() runs, ctx.account undefined) when no Authorization header is present', async () => {
    const ctx = fakeCtx({ req: makeReq({}) });
    let nextRan = false;
    const middleware = requireAccount({ scope: 'read', optional: true });
    await middleware(
      ctx,
      nextGuard(() => {
        nextRan = true;
      }),
    );
    expect(nextRan).toBe(true);
    expect(ctx.account).toBeUndefined();
  });

  it('still rejects a present-but-malformed Authorization header (a present token is validated)', async () => {
    const ctx = fakeCtx({
      req: makeReq({ headers: { authorization: 'Bearer not-a-valid-token' } }),
    });
    const middleware = requireAccount({ scope: 'read', optional: true });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 401,
      code: 'auth.token_missing',
    });
  });

  it('still rejects a present, well-formed, but unknown token as auth.token_invalid', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({
      scope: 'read',
      optional: true,
      lookupToken: async () => null,
    });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 401,
      code: 'auth.token_invalid',
    });
  });

  it('sets ctx.account for a valid present token (a caller who authenticates still gets identified)', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    let nextRan = false;
    const middleware = requireAccount({
      scope: 'read',
      optional: true,
      lookupToken: async () => ({ accountId: 9, scope: 'read' }),
      moderationStatus: async () => NOT_LOCKED,
    });
    await middleware(
      ctx,
      nextGuard(() => {
        nextRan = true;
      }),
    );
    expect(ctx.account).toEqual({ accountId: 9, scope: 'read' });
    expect(nextRan).toBe(true);
  });

  it('still applies the moderation gate to a present valid token (banned -> 403)', async () => {
    const ctx = fakeCtx({ req: makeReq({ headers: authHeader(VALID_TOKEN) }) });
    const middleware = requireAccount({
      scope: 'read',
      optional: true,
      lookupToken: async () => ({ accountId: 1, scope: 'read' }),
      moderationStatus: async () => BANNED,
    });
    await expect(middleware(ctx, nextGuard())).rejects.toMatchObject({
      status: 403,
      code: 'moderation.banned',
    });
  });
});

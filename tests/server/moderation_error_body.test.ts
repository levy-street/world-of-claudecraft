// Unit coverage for moderationErrorBody (server/http_util.ts): the coded
// legacy-body moderation formatter. It rides the additive machine `code` (and, for
// a timed suspension, the machine-readable `date`) alongside the UNTOUCHED legacy
// prose, deriving the code from the status fields EXACTLY as the problem+json
// requireAccount mapping does (server/http/middleware/require_account.ts). This
// pins all four branches, the precedence order, the date-only-on-suspension rule,
// and that the prose is passed through byte-for-byte.

import { describe, expect, it } from 'vitest';
import { requireAccount } from '../../server/http/middleware/require_account';
import { moderationErrorBody } from '../../server/http_util';
import { fakeCtx, nextGuard } from './helpers/fake_ctx';
import { makeReq } from './helpers/fake_http';

const SUSPENDED_ISO = '2026-08-01T00:00:00.000Z';

describe('moderationErrorBody', () => {
  it('maps a ban to moderation.banned with no date', () => {
    expect(
      moderationErrorBody({
        message: 'This account has been banned.',
        banned: true,
        suspendedUntil: null,
        deactivated: false,
      }),
    ).toEqual({ error: 'This account has been banned.', code: 'moderation.banned' });
  });

  it('maps an active suspension to moderation.suspended_until with the ISO date param', () => {
    expect(
      moderationErrorBody({
        message: `This account is suspended until ...`,
        banned: false,
        suspendedUntil: SUSPENDED_ISO,
        deactivated: false,
      }),
    ).toEqual({
      error: 'This account is suspended until ...',
      code: 'moderation.suspended_until',
      date: SUSPENDED_ISO,
    });
  });

  it('maps a self-deactivation to account.deactivated with no date', () => {
    expect(
      moderationErrorBody({
        message: 'This account has been deactivated.',
        banned: false,
        suspendedUntil: null,
        deactivated: true,
      }),
    ).toEqual({ error: 'This account has been deactivated.', code: 'account.deactivated' });
  });

  it('falls back to moderation.suspended for a locked-but-unclassified status', () => {
    expect(
      moderationErrorBody({
        message: 'this account is suspended.',
        banned: false,
        suspendedUntil: null,
        deactivated: false,
      }),
    ).toEqual({ error: 'this account is suspended.', code: 'moderation.suspended' });
  });

  it('lets a ban outrank an active suspension AND a deactivation (banned checked first)', () => {
    // A banned+suspended+deactivated row must surface the ban, mirroring the
    // moderationStatusForAccount branch order and require_account precedence.
    expect(
      moderationErrorBody({
        message: 'This account has been banned.',
        banned: true,
        suspendedUntil: SUSPENDED_ISO,
        deactivated: true,
      }),
    ).toEqual({ error: 'This account has been banned.', code: 'moderation.banned' });
  });

  it('prefers the timed-suspension code over deactivation when both are set', () => {
    expect(
      moderationErrorBody({
        message: 'suspended',
        banned: false,
        suspendedUntil: SUSPENDED_ISO,
        deactivated: true,
      }),
    ).toEqual({ error: 'suspended', code: 'moderation.suspended_until', date: SUSPENDED_ISO });
  });

  it('passes the prose message through byte-for-byte and never adds a date off a suspension', () => {
    const body = moderationErrorBody({
      message: 'literal PROSE stays 100% unchanged',
      banned: false,
      suspendedUntil: null,
      deactivated: false,
    });
    expect(body.error).toBe('literal PROSE stays 100% unchanged');
    expect('date' in body).toBe(false);
  });
});

// The header comment on moderationErrorBody promises it mirrors the problem+json
// requireAccount mapping EXACTLY; each path is literal-pinned above and in
// tests/server/http/require_account.test.ts, but nothing cross-checked the two, so an
// edit to either mapping could drift silently past both suites. This drives the SAME
// moderation status through BOTH emitters and asserts they derive the same code and
// the same date param.
describe('moderationErrorBody mirrors the require_account problem+json mapping', () => {
  const VALID_TOKEN = 'a'.repeat(64);
  const LOCKED_BASE = {
    locked: true,
    banned: false,
    suspendedUntil: null as string | null,
    deactivated: false,
    reason: '',
    message: 'locked',
    chatMutedUntil: null,
    chatStrikes: 0,
  };
  const MIRROR_CASES = [
    {
      label: 'banned account',
      status: { ...LOCKED_BASE, banned: true, message: 'This account has been banned.' },
    },
    {
      label: 'timed suspension',
      status: { ...LOCKED_BASE, suspendedUntil: SUSPENDED_ISO, message: 'suspended until ...' },
    },
    {
      label: 'self-deactivation',
      status: {
        ...LOCKED_BASE,
        deactivated: true,
        message: 'This account has been deactivated.',
      },
    },
    {
      label: 'locked-but-unclassified fallback',
      status: { ...LOCKED_BASE, message: 'this account is suspended.' },
    },
  ];

  for (const { label, status } of MIRROR_CASES) {
    it(`derives the same code and date as requireAccount for a ${label}`, async () => {
      const legacy = moderationErrorBody(status);
      const middleware = requireAccount({
        scope: 'full',
        lookupToken: async () => ({ accountId: 1, scope: 'full' }),
        moderationStatus: async () => status,
      });
      const ctx = fakeCtx({
        req: makeReq({ headers: { authorization: `Bearer ${VALID_TOKEN}` } }),
      });
      let thrown: { status?: number; code?: string; params?: Record<string, unknown> } | undefined;
      try {
        await middleware(ctx, nextGuard());
      } catch (err) {
        thrown = err as typeof thrown;
      }
      expect(thrown, 'requireAccount must reject a locked account').toBeDefined();
      expect(thrown?.status).toBe(403);
      expect(thrown?.code).toBe(legacy.code);
      // Date parity holds in BOTH directions: the timed suspension carries the same
      // machine ISO date on each path, and every other shape carries none on either.
      expect(thrown?.params?.date).toBe(legacy.date);
    });
  }
});

// The pure auth-guard core (server/auth_guard_core.ts): the fail-closed token
// verdict and the moderation decision ladder, driven branch by branch with
// plain rows and an explicit clock. These are the security computes BOTH the
// direct db.ts reads and the marketplace guard cache share, so the exact
// output shapes (including the byte-exact lock messages) are pinned here
// once, and the row-not-result rule (a verdict must move with the clock over
// one unchanged row) is proven at the unit level in both directions.
import { describe, expect, it } from 'vitest';
import {
  type AccountModerationRow,
  type AuthTokenRow,
  computeModerationStatus,
  tokenInfoFromRow,
} from '../../server/auth_guard_core';

const NOW = 1_820_000_000_000;

function tokenRow(over: Partial<AuthTokenRow> = {}): AuthTokenRow {
  return { accountId: 7, scope: 'full', expiresAtMs: NOW + 60_000, ...over };
}

function modRow(over: Partial<AccountModerationRow> = {}): AccountModerationRow {
  return {
    banned_at: null,
    suspended_until: null,
    moderation_reason: null,
    chat_muted_until: null,
    chat_strikes: 0,
    deactivated_at: null,
    messages: null,
    window_minutes: null,
    ...over,
  };
}

describe('tokenInfoFromRow', () => {
  it('answers null for a missing row', () => {
    expect(tokenInfoFromRow(null, NOW)).toBeNull();
  });

  it.each([
    ['full', { accountId: 7, scope: 'full' }],
    ['read', { accountId: 7, scope: 'read' }],
  ])('promotes the allowlisted scope %j', (scope, expected) => {
    expect(tokenInfoFromRow(tokenRow({ scope }), NOW)).toEqual(expected);
  });

  it.each([['write'], ['FULL'], [''], ['admin']])(
    'fails closed on the unrecognized scope %j',
    (scope) => {
      expect(tokenInfoFromRow(tokenRow({ scope }), NOW)).toBeNull();
    },
  );

  it('refuses a row at exactly its expiry instant (strictly-greater bound)', () => {
    expect(tokenInfoFromRow(tokenRow({ expiresAtMs: NOW }), NOW)).toBeNull();
    expect(tokenInfoFromRow(tokenRow({ expiresAtMs: NOW + 1 }), NOW)).not.toBeNull();
  });

  it('refuses the same unchanged row once the clock passes its expiry', () => {
    const row = tokenRow({ expiresAtMs: NOW + 5_000 });
    expect(tokenInfoFromRow(row, NOW)).toEqual({ accountId: 7, scope: 'full' });
    expect(tokenInfoFromRow(row, NOW + 5_000)).toBeNull();
  });

  it('fails closed on a NaN expiry (a row with no parseable expires_at)', () => {
    expect(tokenInfoFromRow(tokenRow({ expiresAtMs: Number.NaN }), NOW)).toBeNull();
  });
});

describe('computeModerationStatus', () => {
  it('answers the unlocked default for a missing row, a fresh object per call', () => {
    const a = computeModerationStatus(null, NOW);
    expect(a).toEqual({
      locked: false,
      banned: false,
      suspendedUntil: null,
      reason: '',
      message: '',
      chatMutedUntil: null,
      chatStrikes: 0,
      generalChatRateLimit: null,
    });
    // Callers may hold or decorate the status: a shared constant would alias
    // one request's mutation into every later request.
    expect(computeModerationStatus(null, NOW)).not.toBe(a);
  });

  it('locks a banned account with the exact legacy message', () => {
    const status = computeModerationStatus(
      modRow({ banned_at: '2026-01-01T00:00:00Z', moderation_reason: 'rmt' }),
      NOW,
    );
    expect(status).toEqual({
      locked: true,
      banned: true,
      suspendedUntil: null,
      reason: 'rmt',
      message: 'This account has been banned.',
      chatMutedUntil: null,
      chatStrikes: 0,
      generalChatRateLimit: null,
    });
  });

  it('ban outranks an active suspension AND a deactivation on one row', () => {
    const status = computeModerationStatus(
      modRow({
        banned_at: '2026-01-01T00:00:00Z',
        suspended_until: new Date(NOW + 60_000).toISOString(),
        deactivated_at: '2026-01-02T00:00:00Z',
      }),
      NOW,
    );
    expect(status.banned).toBe(true);
    expect(status.suspendedUntil).toBeNull();
    expect(status.deactivated).toBeUndefined();
  });

  it('locks an active suspension with the ISO bound and the toUTCString prose', () => {
    const until = new Date(NOW + 90_000);
    const status = computeModerationStatus(
      modRow({ suspended_until: until.toISOString(), moderation_reason: 'griefing' }),
      NOW,
    );
    expect(status.locked).toBe(true);
    expect(status.banned).toBe(false);
    expect(status.suspendedUntil).toBe(until.toISOString());
    expect(status.reason).toBe('griefing');
    expect(status.message).toBe(`This account is suspended until ${until.toUTCString()}.`);
  });

  it('unlocks the SAME suspension row once the clock passes the bound (row, not result)', () => {
    const row = modRow({ suspended_until: new Date(NOW + 90_000).toISOString() });
    expect(computeModerationStatus(row, NOW).locked).toBe(true);
    expect(computeModerationStatus(row, NOW + 90_000).locked).toBe(false);
  });

  it('keeps the SAME ban row locked at any later clock (the one-way direction)', () => {
    const row = modRow({ banned_at: '2026-01-01T00:00:00Z' });
    expect(computeModerationStatus(row, NOW).locked).toBe(true);
    expect(computeModerationStatus(row, NOW + 365 * 24 * 3600 * 1000).locked).toBe(true);
  });

  it('suspension outranks deactivation; a lapsed suspension falls through to it', () => {
    const both = modRow({
      suspended_until: new Date(NOW + 60_000).toISOString(),
      deactivated_at: '2026-01-02T00:00:00Z',
    });
    const active = computeModerationStatus(both, NOW);
    expect(active.suspendedUntil).not.toBeNull();
    expect(active.deactivated).toBeUndefined();
    const lapsed = computeModerationStatus(both, NOW + 60_000);
    expect(lapsed.locked).toBe(true);
    expect(lapsed.deactivated).toBe(true);
    expect(lapsed.message).toBe('This account has been deactivated.');
  });

  it('locks a deactivated account with the exact legacy message and empty reason', () => {
    const status = computeModerationStatus(
      modRow({ deactivated_at: '2026-01-02T00:00:00Z', moderation_reason: 'ignored' }),
      NOW,
    );
    expect(status).toEqual({
      locked: true,
      banned: false,
      suspendedUntil: null,
      deactivated: true,
      reason: '',
      message: 'This account has been deactivated.',
      chatMutedUntil: null,
      chatStrikes: 0,
      generalChatRateLimit: null,
    });
  });

  it('computes the chat-mute lapse at read time over one unchanged row', () => {
    const until = new Date(NOW + 30_000);
    const row = modRow({ chat_muted_until: until.toISOString() });
    expect(computeModerationStatus(row, NOW).chatMutedUntil).toBe(until.toISOString());
    expect(computeModerationStatus(row, NOW + 30_000).chatMutedUntil).toBeNull();
  });

  it('coerces strike counts and carries them on locked and unlocked shapes alike', () => {
    expect(computeModerationStatus(modRow({ chat_strikes: '3' }), NOW).chatStrikes).toBe(3);
    expect(computeModerationStatus(modRow({ chat_strikes: null }), NOW).chatStrikes).toBe(0);
    expect(
      computeModerationStatus(modRow({ banned_at: '2026-01-01T00:00:00Z', chat_strikes: 2 }), NOW)
        .chatStrikes,
    ).toBe(2);
  });

  it('maps the LEFT-JOINed quota policy: absent means Unlimited (null), present is numbers', () => {
    expect(computeModerationStatus(modRow(), NOW).generalChatRateLimit).toBeNull();
    expect(
      computeModerationStatus(modRow({ messages: '5', window_minutes: '10' }), NOW)
        .generalChatRateLimit,
    ).toEqual({ messages: 5, windowMinutes: 10 });
    // The undefined half of the absent check (a projection that OMITS the
    // key rather than joining a null): still Unlimited, never NaN numbers.
    expect(
      computeModerationStatus(modRow({ messages: undefined as unknown as null }), NOW)
        .generalChatRateLimit,
    ).toBeNull();
  });

  it.each([
    ['banned', { banned_at: '2026-01-01T00:00:00Z' }],
    ['suspended', { suspended_until: new Date(NOW + 60_000).toISOString() }],
    ['deactivated', { deactivated_at: '2026-01-02T00:00:00Z' }],
  ] as const)(
    'carries a live mute and the quota policy onto the %s locked shape',
    (_label, over) => {
      // Per-branch carry-through: each locked branch builds its own return
      // object, so a branch hard-coding chatMutedUntil: null or
      // generalChatRateLimit: null would pass every fixture that leaves them
      // empty; this row leaves none of them empty.
      const until = new Date(NOW + 30_000);
      const status = computeModerationStatus(
        modRow({ ...over, chat_muted_until: until.toISOString(), messages: 3, window_minutes: 7 }),
        NOW,
      );
      expect(status.locked).toBe(true);
      expect(status.chatMutedUntil).toBe(until.toISOString());
      expect(status.generalChatRateLimit).toEqual({ messages: 3, windowMinutes: 7 });
    },
  );
});

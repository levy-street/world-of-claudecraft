import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountForDiscord,
  claimSwag,
  consumeDiscordOAuthState,
  consumeDiscordPendingLogin,
  createDiscordPendingLogin,
  type DiscordMemberMetaRecord,
  discordFlexRowsForDiscordIds,
  discordIdsWithGuildFlair,
  discordLinksForAccounts,
  grantRewardPoints,
  linkDiscordToAccount,
  loadRewardState,
  peekDiscordPendingLogin,
  setDiscordGuildMember,
  setDiscordLinkEmail,
  setDiscordMemberMetaBulk,
  unlinkDiscord,
} from '../server/discord_db';
import { drainLinkChanges } from '../server/discord_link_changes';
import {
  configureDiscordStatusCache,
  readDiscordStatusCore,
  resetDiscordStatusCacheForTests,
} from '../server/discord_status_cache';

// discord_db functions take the pg `pool` as an argument, so a fake pool (no
// vi.mock needed) drives every branch. The fake routes by normalized SQL and
// lets each test script row results; pool.connect() returns a client sharing the
// same router so the transactional paths (grant/claim) run for real.
type Result = { rows: any[]; rowCount: number };
type Handler = (sql: string, params: any[]) => Result;

function makePool(handler: Handler) {
  const calls: { sql: string; params: any[] }[] = [];
  const query = (sql: string, params: any[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: s, params });
    return Promise.resolve(handler(s, params));
  };
  const client = { query, release: () => {} };
  const pool: any = { query, connect: () => Promise.resolve(client) };
  return { pool, calls, didRun: (frag: string) => calls.some((c) => c.sql.includes(frag)) };
}

const NONE: Result = { rows: [], rowCount: 0 };

// The linked-member change feed is a module-global singleton that grantRewardPoints
// and claimSwag now write into, so every test starts from an empty queue and no
// block can inherit another's items.
beforeEach(() => {
  drainLinkChanges();
});

describe('linkDiscordToAccount', () => {
  it('refuses when the discord id already belongs to a different account', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id'))
        return { rows: [{ account_id: 99 }], rowCount: 1 };
      return NONE;
    });
    const ok = await linkDiscordToAccount(pool, 1, {
      discordUserId: '80351110224678912',
      username: 'x',
      avatar: null,
      email: null,
      guildMember: true,
    });
    expect(ok).toBe(false);
    // No INSERT attempted once a foreign owner is detected.
    expect(didRun('INSERT INTO discord_links')).toBe(false);
  });

  it('links when the discord id is free (or already this account)', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id')) return NONE;
      if (s.includes('INSERT INTO discord_links')) return { rows: [], rowCount: 1 };
      return NONE;
    });
    const ok = await linkDiscordToAccount(pool, 1, {
      discordUserId: '80351110224678912',
      username: 'maxp',
      avatar: 'abc',
      email: null,
      guildMember: true,
    });
    expect(ok).toBe(true);
    expect(didRun('INSERT INTO discord_links')).toBe(true);
  });

  it('treats a unique-violation race as already-owned (false, not a throw)', async () => {
    const { pool } = makePool((s) => {
      if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id')) return NONE;
      if (s.includes('INSERT INTO discord_links')) {
        const err: any = new Error('dup');
        err.code = '23505';
        throw err;
      }
      return NONE;
    });
    await expect(
      linkDiscordToAccount(pool, 1, {
        discordUserId: '80351110224678912',
        username: 'x',
        avatar: null,
        email: null,
        guildMember: false,
      }),
    ).resolves.toBe(false);
  });

  it('persists the captured Discord email in the INSERT + upsert', async () => {
    const { pool, calls } = makePool((s) => {
      if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id')) return NONE;
      if (s.includes('INSERT INTO discord_links')) return { rows: [], rowCount: 1 };
      return NONE;
    });
    await linkDiscordToAccount(pool, 1, {
      discordUserId: '80351110224678912',
      username: 'maxp',
      avatar: 'abc',
      email: 'maxp@example.com',
      guildMember: true,
    });
    const insert = calls.find((c) => c.sql.includes('INSERT INTO discord_links'));
    expect(insert).toBeTruthy();
    // The column list carries discord_email, the upsert COALESCEs it so a later
    // no-email grant cannot wipe a stored address, and the address is a bound param.
    expect(insert!.sql).toContain('discord_email');
    expect(insert!.sql).toContain('COALESCE(EXCLUDED.discord_email, discord_links.discord_email)');
    expect(insert!.params).toContain('maxp@example.com');
  });

  it('resets the bot-pushed guild meta when the link repoints at a different Discord id', async () => {
    const { pool, calls } = makePool((s) => {
      if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id')) return NONE;
      if (s.includes('INSERT INTO discord_links')) return { rows: [], rowCount: 1 };
      return NONE;
    });
    await linkDiscordToAccount(pool, 1, {
      discordUserId: '80351110224678912',
      username: 'maxp',
      avatar: null,
      email: null,
      guildMember: true,
    });
    const insert = calls.find((c) => c.sql.includes('INSERT INTO discord_links'));
    // discord_role and discord_joined_at belong to the OLD Discord identity, so
    // the upsert must reset both to NULL when the id changes (a same-id relink
    // keeps them). Without this a relinked account keeps the previous user's
    // staff flair until the next bot sync happens to cover the new id.
    expect(insert!.sql).toContain(
      'discord_role = CASE WHEN discord_links.discord_user_id = EXCLUDED.discord_user_id THEN discord_links.discord_role ELSE NULL END',
    );
    expect(insert!.sql).toContain(
      'discord_joined_at = CASE WHEN discord_links.discord_user_id = EXCLUDED.discord_user_id THEN discord_links.discord_joined_at ELSE NULL END',
    );
  });
});

describe('discordIdsWithGuildFlair', () => {
  it('selects only links still flagged as guild member or carrying a role key', async () => {
    const { pool, calls } = makePool((s) =>
      s.includes('SELECT discord_user_id FROM discord_links')
        ? { rows: [{ discord_user_id: 'u1' }, { discord_user_id: 'u2' }], rowCount: 2 }
        : NONE,
    );
    expect(await discordIdsWithGuildFlair(pool)).toEqual(['u1', 'u2']);
    const q = calls.find((c) => c.sql.includes('SELECT discord_user_id FROM discord_links'));
    // The WHERE is what keeps the list small AND what scopes the bot's
    // departed-member clearing to links that actually have something to clear.
    expect(q!.sql).toContain('WHERE guild_member = TRUE OR discord_role IS NOT NULL');
  });

  it('returns an empty list when nothing is flagged', async () => {
    const { pool } = makePool(() => NONE);
    expect(await discordIdsWithGuildFlair(pool)).toEqual([]);
  });
});

describe('discordLinksForAccounts', () => {
  const SELECT = 'FROM discord_links WHERE account_id = ANY($1::int[])';

  // No discord_email: the SELECT is deliberately narrower than discordForAccount's
  // (see the "narrows away discord_email" case below), so a fixture carrying one
  // would model a row this statement cannot produce.
  const row = (accountId: number) => ({
    account_id: accountId,
    discord_user_id: `du${accountId}`,
    discord_username: `un${accountId}`,
    discord_avatar: `av${accountId}`,
  });

  it('resolves a whole account set with ONE statement, however large the set', async () => {
    // The reason the function exists: the outbox drain resolves every account in
    // one pass, where the relay/activity GETs run discordForAccount per item.
    const one = makePool((s) => (s.includes(SELECT) ? { rows: [row(1)], rowCount: 1 } : NONE));
    expect(await discordLinksForAccounts(one.pool, [1])).toEqual([row(1)]);
    expect(one.calls).toHaveLength(1);

    // 5,000 ids: the full D18 guild-member envelope, so the one-statement claim is
    // pinned at the scale the invariant names rather than a tenth of it.
    const ids = Array.from({ length: 5000 }, (_, i) => i + 1);
    const many = makePool((s) =>
      s.includes(SELECT) ? { rows: ids.map(row), rowCount: ids.length } : NONE,
    );
    await discordLinksForAccounts(many.pool, ids);
    expect(many.calls).toHaveLength(1);
    expect(many.calls[0].params).toEqual([ids]);
  });

  it('issues NO statement at all for an empty account list', async () => {
    const { pool, calls } = makePool(() => ({ rows: [row(1)], rowCount: 1 }));
    expect(await discordLinksForAccounts(pool, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('de-duplicates ids before binding, so one account is asked about once', async () => {
    // A drain can carry the same account in several streams (a relay post AND a
    // points change), and the bound array is what the planner probes with.
    const { pool, calls } = makePool((s) =>
      s.includes(SELECT) ? { rows: [row(4), row(9)], rowCount: 2 } : NONE,
    );
    await discordLinksForAccounts(pool, [4, 9, 4, 9, 4]);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([[4, 9]]);
  });

  it('narrows away discord_email, through one set membership test', async () => {
    const { pool, calls } = makePool(() => NONE);
    await discordLinksForAccounts(pool, [1]);
    const sql = calls[0].sql;
    // Anchored on the CONTIGUOUS clause and counted: a bare toContain of the
    // predicate alone would also be satisfied by a comment mentioning it, or by a
    // second clause elsewhere in the statement deciding a different set of rows.
    expect(sql.split(SELECT)).toHaveLength(2);
    // The column list is the outbox's identity fields and nothing else. It is
    // deliberately NARROWER than the per-account discordForAccount, which also
    // selects discord_email: one drain resolves thousands of accounts at once, so
    // copying that column here would materialize thousands of email addresses one
    // spread away from a response the bot receives, for a field no caller on this
    // path reads.
    expect(sql).toContain('SELECT account_id, discord_user_id, discord_username, discord_avatar');
    // Narrowed in the Phase 5 QA round: guild_member and linked_at were dead
    // payload no outbox consumer read, so the identity read carries identity only.
    expect(sql).not.toContain('guild_member');
    expect(sql).not.toContain('linked_at');
    // Stated as its own negative, so a re-widened list cannot pass by prefix.
    expect(sql).not.toContain('discord_email');
  });

  it('answers with no row for an account that has no link (absence is the answer)', async () => {
    // Built fresh rather than reusing row(): the fake hands its own object back,
    // so asserting against that object would compare the result with its source.
    const { pool } = makePool((s) => (s.includes(SELECT) ? { rows: [row(1)], rowCount: 1 } : NONE));
    const rows = await discordLinksForAccounts(pool, [1, 2]);
    expect(rows.map((r) => r.account_id)).toEqual([1]);
    expect(rows[0].discord_user_id).toBe('du1');
  });
});

describe('setDiscordLinkEmail', () => {
  it('updates the stored Discord email when a fresh grant provides one', async () => {
    const { pool, calls, didRun } = makePool(() => ({ rows: [], rowCount: 1 }));
    await setDiscordLinkEmail(pool, 7, 'user@example.com');
    expect(didRun('UPDATE discord_links SET discord_email')).toBe(true);
    const update = calls.find((c) => c.sql.includes('UPDATE discord_links SET discord_email'));
    expect(update!.params).toEqual([7, 'user@example.com']);
  });

  it('is a no-op when the grant carried no email (never wipes a stored one)', async () => {
    const { pool, didRun } = makePool(() => ({ rows: [], rowCount: 1 }));
    await setDiscordLinkEmail(pool, 7, null);
    expect(didRun('UPDATE discord_links')).toBe(false);
  });
});

describe('accountForDiscord', () => {
  it('returns the owning account or null', async () => {
    const { pool } = makePool((s) =>
      s.includes('SELECT account_id FROM discord_links WHERE discord_user_id')
        ? { rows: [{ account_id: 7 }], rowCount: 1 }
        : NONE,
    );
    expect(await accountForDiscord(pool, '80351110224678912')).toBe(7);
    const empty = makePool(() => NONE);
    expect(await accountForDiscord(empty.pool, '80351110224678912')).toBeNull();
  });
});

describe('consumeDiscordOAuthState', () => {
  it('returns the row on a live state and null on a missing/expired one', async () => {
    const row = {
      state: 'st',
      code_verifier: 'v',
      mode: 'login',
      account_id: null,
      redirect_to: null,
    };
    const live = makePool((s) =>
      s.includes('DELETE FROM discord_oauth_states') ? { rows: [row], rowCount: 1 } : NONE,
    );
    expect(await consumeDiscordOAuthState(live.pool, 'st')).toEqual(row);
    const dead = makePool(() => NONE);
    expect(await consumeDiscordOAuthState(dead.pool, 'st')).toBeNull();
  });
});

describe('grantRewardPoints idempotency', () => {
  it('skips the balance update when the dedupe key was already granted', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('INSERT INTO reward_ledger') && s.includes('ON CONFLICT')) return NONE; // already granted
      if (s.includes('SELECT points, lifetime_points FROM reward_points'))
        return { rows: [{ points: '250', lifetime_points: '250' }], rowCount: 1 };
      return NONE;
    });
    const state = await grantRewardPoints(pool, 1, 250, 'link', 'link:1');
    expect(state).toEqual({ points: 250, lifetimePoints: 250 });
    // The UPSERT into reward_points must NOT run on a duplicate grant.
    expect(didRun('INSERT INTO reward_points')).toBe(false);
  });

  it('credits both spendable and lifetime on a fresh grant', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('INSERT INTO reward_ledger') && s.includes('ON CONFLICT'))
        return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('INSERT INTO reward_points'))
        return { rows: [{ points: '300', lifetime_points: '300' }], rowCount: 1 };
      return NONE;
    });
    const state = await grantRewardPoints(pool, 1, 300, 'guild_member', 'guild:1');
    expect(state).toEqual({ points: 300, lifetimePoints: 300 });
    expect(didRun('INSERT INTO reward_points')).toBe(true);
  });
});

describe('claimSwag', () => {
  it('reports already-claimed when the unique claim row conflicts', async () => {
    const { pool } = makePool(
      (s) => (s.includes('INSERT INTO swag_claims') ? NONE : NONE), // ON CONFLICT DO NOTHING -> 0 rows
    );
    expect(await claimSwag(pool, 1, 'title_discordian', 0)).toEqual({
      ok: false,
      reason: 'claimed',
    });
  });

  it('reports insufficient points when the guarded deduction fails', async () => {
    const { pool } = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('UPDATE reward_points SET points = points -')) return NONE; // points < cost
      return NONE;
    });
    expect(await claimSwag(pool, 1, 'chroma_blurple', 1000)).toEqual({
      ok: false,
      reason: 'points',
    });
  });

  it('succeeds when the claim is new and points cover the cost', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('UPDATE reward_points SET points = points -'))
        return { rows: [{ points: '500' }], rowCount: 1 };
      return NONE;
    });
    const res = await claimSwag(pool, 1, 'chroma_blurple', 1000);
    expect(res).toEqual({ ok: true, reason: 'ok', points: 500 });
    expect(didRun('INSERT INTO reward_ledger')).toBe(true); // spend is audited
  });

  it('claims a free item without touching the points balance', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('SELECT points FROM reward_points'))
        return { rows: [{ points: '0' }], rowCount: 1 };
      return NONE;
    });
    const res = await claimSwag(pool, 1, 'title_discordian', 0);
    expect(res.ok).toBe(true);
    expect(didRun('UPDATE reward_points SET points = points -')).toBe(false);
  });
});

// The two reward_points writers are the only points sites on the linked-member
// change feed, so each one has to distinguish a real balance write from the arms
// that return an unchanged balance. A feed item for a no-op costs the bot a full
// member re-push for nothing.
describe('reward points feed enqueues', () => {
  it('enqueues exactly one points item for the account a real grant credited', async () => {
    const { pool } = makePool((s) => {
      if (s.includes('INSERT INTO reward_ledger') && s.includes('ON CONFLICT'))
        return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('INSERT INTO reward_points'))
        return { rows: [{ points: '300', lifetime_points: '300' }], rowCount: 1 };
      return NONE;
    });

    await grantRewardPoints(pool, 77, 300, 'guild_member', 'guild:77');

    expect(drainLinkChanges()).toEqual([{ accountId: 77, kinds: ['points'] }]);
  });

  it('enqueues nothing when the truncated delta is zero (no balance write at all)', async () => {
    const { pool, didRun } = makePool(() => NONE);

    await grantRewardPoints(pool, 77, 0.4, 'playtime');

    expect(didRun('INSERT INTO reward_points')).toBe(false);
    expect(drainLinkChanges()).toEqual([]);
  });

  it('enqueues nothing on a dedupe-key replay (the balance is returned unchanged)', async () => {
    const { pool, didRun } = makePool((s) => {
      if (s.includes('INSERT INTO reward_ledger') && s.includes('ON CONFLICT')) return NONE;
      if (s.includes('SELECT points, lifetime_points FROM reward_points'))
        return { rows: [{ points: '250', lifetime_points: '250' }], rowCount: 1 };
      return NONE;
    });

    await grantRewardPoints(pool, 77, 250, 'link', 'link:77');

    expect(didRun('INSERT INTO reward_points')).toBe(false);
    expect(drainLinkChanges()).toEqual([]);
  });

  it('enqueues a points item for a priced swag claim that actually spent', async () => {
    const { pool } = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('UPDATE reward_points SET points = points -'))
        return { rows: [{ points: '500' }], rowCount: 1 };
      return NONE;
    });

    expect(await claimSwag(pool, 88, 'chroma_blurple', 1000)).toEqual({
      ok: true,
      reason: 'ok',
      points: 500,
    });
    expect(drainLinkChanges()).toEqual([{ accountId: 88, kinds: ['points'] }]);
  });

  it('enqueues nothing for a refused claim or a cost-0 claim that only reads', async () => {
    const refused = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('UPDATE reward_points SET points = points -')) return NONE; // cannot afford
      return NONE;
    });
    expect(await claimSwag(refused.pool, 88, 'chroma_blurple', 1000)).toEqual({
      ok: false,
      reason: 'points',
    });
    expect(drainLinkChanges()).toEqual([]);

    const free = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('SELECT points FROM reward_points'))
        return { rows: [{ points: '0' }], rowCount: 1 };
      return NONE;
    });
    expect((await claimSwag(free.pool, 88, 'title_discordian', 0)).ok).toBe(true);
    expect(drainLinkChanges()).toEqual([]);
  });
});

describe('loadRewardState', () => {
  it('defaults to zeros when no row exists', async () => {
    const { pool } = makePool(() => NONE);
    expect(await loadRewardState(pool, 1)).toEqual({ points: 0, lifetimePoints: 0 });
  });
});

// ---------------------------------------------------------------------------
// The two Phase 4 set-based reads/writes. Both exist to make the bot's sweep
// cost O(1) statements per request instead of O(members), so the statement COUNT
// off makePool's `calls` array is the load-bearing assertion in each block: a
// hidden per-item loop dressed up as "batched" fails these, not just a text pin.
// ---------------------------------------------------------------------------

/** A member-meta record, built fresh per call (never reuse one across assertions). */
function metaRecord(overrides: Partial<DiscordMemberMetaRecord> = {}): DiscordMemberMetaRecord {
  return {
    discordUserId: 'u1',
    nickname: 'Nick',
    joinedAtMs: 1_700_000_000_000,
    roleKey: 'mods',
    ...overrides,
  };
}

describe('setDiscordMemberMetaBulk', () => {
  const counted = (changed: string, skipped: string, unapplied: string[]): Result => ({
    rows: [{ changed, skipped, unapplied }],
    rowCount: 1,
  });

  it('issues exactly ONE statement for one record and ONE for a thousand', async () => {
    // The whole point of the phase: a 1000-member push used to be 1000 serial
    // UPDATEs. Counting off `calls` is what makes this claim real; a text pin on
    // the unnest would still pass if the function looped and ran it per record.
    const one = makePool(() => counted('1', '0', []));
    await setDiscordMemberMetaBulk(one.pool, [metaRecord()]);
    expect(one.calls).toHaveLength(1);

    const many = makePool(() => counted('1000', '0', []));
    const records = Array.from({ length: 1000 }, (_, i) => metaRecord({ discordUserId: `u${i}` }));
    await setDiscordMemberMetaBulk(many.pool, records);
    expect(many.calls).toHaveLength(1);
    // Non-vacuous: the single statement really did carry all thousand ids.
    expect((many.calls[0].params[0] as string[]).length).toBe(1000);
    expect((many.calls[0].params[0] as string[])[999]).toBe('u999');
  });

  it('retries EXACTLY once on a deadlock abort, and only for 40P01', async () => {
    // The sorted input is best-effort: row locks follow the plan, never the
    // subquery ORDER BY, so overlapping pushes can still deadlock. The victim
    // committed nothing, so one clean retry absorbs it; a second deadlock, and
    // any other error, must propagate (the next sweep re-sends anyway).
    let attempts = 0;
    const deadlockOnce = makePool(() => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
      return counted('3', '0', []);
    });
    const result = await setDiscordMemberMetaBulk(deadlockOnce.pool, [metaRecord()]);
    expect(result).toEqual({ changed: 3, skipped: 0, unapplied: [] });
    expect(deadlockOnce.calls).toHaveLength(2);
    // The retry re-runs the IDENTICAL statement and bindings: nothing about the
    // input changed, only the lock race outcome.
    expect(deadlockOnce.calls[1]).toEqual(deadlockOnce.calls[0]);

    const deadlockAlways = makePool(() => {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    });
    await expect(
      setDiscordMemberMetaBulk(deadlockAlways.pool, [metaRecord()]),
    ).rejects.toMatchObject({ code: '40P01' });
    expect(deadlockAlways.calls).toHaveLength(2);

    const otherError = makePool(() => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    await expect(setDiscordMemberMetaBulk(otherError.pool, [metaRecord()])).rejects.toMatchObject({
      code: '23505',
    });
    expect(otherError.calls).toHaveLength(1);
  });

  it('issues NO statement at all for an empty record list', async () => {
    const { pool, calls } = makePool(() => counted('0', '0', []));
    expect(await setDiscordMemberMetaBulk(pool, [])).toEqual({
      changed: 0,
      skipped: 0,
      unapplied: [],
    });
    expect(calls).toHaveLength(0);
  });

  it('binds four parallel arrays and converts joinedAtMs to an ISO timestamp', async () => {
    const { pool, calls } = makePool(() => counted('2', '0', []));
    await setDiscordMemberMetaBulk(pool, [
      metaRecord({ discordUserId: 'a', nickname: 'A', joinedAtMs: 0, roleKey: 'mods' }),
      metaRecord({ discordUserId: 'b', nickname: null, joinedAtMs: null, roleKey: null }),
    ]);
    // Four positional arrays, index-aligned. joinedAtMs 0 is a REAL timestamp
    // (the epoch), not a missing value, so it must survive as a timestamp rather
    // than collapsing to null the way a truthiness check would have made it.
    expect(calls[0].params).toEqual([
      ['a', 'b'],
      ['A', null],
      ['1970-01-01T00:00:00.000Z', null],
      ['mods', null],
    ]);
  });

  it('skips unchanged rows via a NULL-safe row comparison in ONE statement', async () => {
    const { pool, calls } = makePool(() => counted('0', '1', []));
    await setDiscordMemberMetaBulk(pool, [metaRecord()]);
    const sql = calls[0].sql;
    // unnest of four parallel arrays is what makes it one statement...
    expect(sql).toContain(
      'unnest($1::text[], $2::text[], $3::timestamptz[], $4::text[]) AS t(discord_user_id, nickname, joined_at, role_key)',
    );
    // ...and IS DISTINCT FROM (not <>) is what makes a NULL-to-NULL column count
    // as unchanged rather than as a difference that rewrites the row forever.
    //
    // ANCHORED to the full UPDATE WHERE clause, never a bare
    // toContain('IS DISTINCT FROM'): a fragment scan cannot tell the predicate
    // that stops the write from a copy elsewhere in the statement. Deleting the
    // predicate (every row rewrites, the phase's headline win gone) or
    // inverting it to IS NOT DISTINCT FROM (only unchanged rows write) must
    // both go red here. Verified by mutation in Phase 4 QA against the earlier
    // two-copy statement; the comparison now lives ONLY in the UPDATE's WHERE
    // (`skipped` is derived as matched minus changed), so the occurrence count
    // below pins that a second copy does not creep back in.
    expect(sql).toContain(
      'WHERE dl.discord_user_id = i.discord_user_id AND (dl.discord_username, dl.discord_joined_at, dl.discord_role) IS DISTINCT FROM (COALESCE(i.nickname, dl.discord_username), COALESCE(i.joined_at, dl.discord_joined_at), i.role_key) RETURNING dl.account_id',
    );
    expect(sql).not.toContain('<>');
    expect(sql).not.toContain('IS NOT DISTINCT FROM');
    // EXACTLY one copy: the UPDATE's WHERE. skipped and unapplied are derived
    // from `matched` (the bare linked-subset join) and `updated` counts, so a
    // second comparison would be duplicate expression work per row at the cap.
    expect(sql.split('IS DISTINCT FROM')).toHaveLength(2);
    expect(sql).toContain(
      'matched AS ( SELECT i.discord_user_id FROM input i JOIN discord_links dl ON dl.discord_user_id = i.discord_user_id )',
    );
    expect(sql).toContain(
      '(SELECT count(*) FROM matched) - (SELECT count(*) FROM updated) AS skipped',
    );
    // Phase 9: the /api/discord status bust reads the changed rows' account ids
    // off the SAME statement (RETURNING dl.account_id above feeds this
    // aggregate), so the write and the bust population cannot drift apart.
    // Anchored with its FROM clause: `updated` is the only CTE aggregated here,
    // and the alias is what setDiscordMemberMetaBulk parses.
    expect(sql).toContain(
      '(SELECT COALESCE(array_agg(account_id), ARRAY[]::int[]) FROM updated) AS changed_account_ids',
    );
    // The comparison must be against the value that would actually be STORED, so
    // the COALESCE rules appear on both the write and the compare.
    expect(sql).toContain(
      'SET discord_username = COALESCE(i.nickname, dl.discord_username), discord_joined_at = COALESCE(i.joined_at, dl.discord_joined_at), discord_role = i.role_key',
    );
  });

  it('drops an out-of-range joinedAtMs to null instead of poisoning the whole batch', async () => {
    // Number.isFinite admits values far past the JS Date range (+/-8.64e15 ms),
    // and new Date(1e20).toISOString() THROWS. The conversion now happens once,
    // up front, for every record, so an unguarded throw would abort all 1000
    // records BEFORE any SQL ran, and the bot would re-send the same poisoned set
    // every sweep forever. The old per-member loop lost only the bad record.
    //
    // THREE records with the bad one in the MIDDLE, on purpose: with the bad
    // record last, "aborts everything" and "skips the bad one" look identical.
    const { pool, calls } = makePool(() => counted('2', '0', []));
    const result = await setDiscordMemberMetaBulk(pool, [
      metaRecord({ discordUserId: 'aaa-first', joinedAtMs: 1_700_000_000_000 }),
      metaRecord({ discordUserId: 'mmm-bad', joinedAtMs: 1e20 }),
      metaRecord({ discordUserId: 'zzz-last', joinedAtMs: 1_700_000_000_001 }),
    ]);

    // It did not throw, the statement still ran, and both good records survived
    // with their real timestamps; only the unusable one became null. Null is the
    // right answer, not a clear: the column is written through COALESCE, so it
    // leaves whatever join date is already stored alone. (Ids are chosen so the
    // deadlock-guard sort keeps the bad one in the middle.)
    expect(calls).toHaveLength(1);
    expect(calls[0].params[0]).toEqual(['aaa-first', 'mmm-bad', 'zzz-last']);
    expect(calls[0].params[2]).toEqual([
      '2023-11-14T22:13:20.000Z',
      null,
      '2023-11-14T22:13:20.001Z',
    ]);
    expect(result).toEqual({ changed: 2, skipped: 0, unapplied: [] });
  });

  it('accepts the widest representable instant and rejects one millisecond past it', async () => {
    // MAX_EPOCH_MS (8.64e15) is the ECMA-262 Date range, and it was previously
    // unpinned on BOTH sides: the only rejected value any test used was 1e20,
    // eight orders of magnitude clear of the bound, and the largest accepted one
    // was ~1.7e12. A `>` to `>=` drift, or a wrong constant anywhere in that gap,
    // survived the whole suite. These two records sit either side of the real
    // edge, so the comparison and the constant are both pinned.
    //
    // BOTH SIDES OF ZERO, not just both sides of the positive edge. The guard is
    // Math.abs(joinedAtMs) > MAX_EPOCH_MS, so pinning only +8.64e15 and
    // +8.64e15 + 1 leaves `Math.abs(` deletable: a finite -8.64e15 - 1 (which
    // parseMemberMetaRecords accepts, it only checks Number.isFinite) would then
    // reach new Date(...).toISOString() and throw a RangeError inside the up-front
    // map, aborting all 1000 records before any SQL runs. That mutant survived the
    // first version of this test and was caught by the fix-round review.
    //
    // Ids are named so the deadlock-guard sort keeps them in this order: the
    // arrays are built AFTER `deduped` is sorted by discordUserId, so every
    // expectation below is in sorted-id order, not input order.
    const { pool, calls } = makePool(() => counted('2', '0', []));
    await setDiscordMemberMetaBulk(pool, [
      metaRecord({ discordUserId: 'aaa-at-limit', joinedAtMs: 8.64e15 }),
      metaRecord({ discordUserId: 'bbb-past-limit', joinedAtMs: 8.64e15 + 1 }),
      metaRecord({ discordUserId: 'ccc-at-limit-negative', joinedAtMs: -8.64e15 }),
      metaRecord({ discordUserId: 'ddd-past-limit-negative', joinedAtMs: -8.64e15 - 1 }),
    ]);
    expect(calls[0].params[2]).toEqual([
      '+275760-09-13T00:00:00.000Z',
      null,
      '-271821-04-20T00:00:00.000Z',
      null,
    ]);
  });

  it('drops a NaN joinedAtMs rather than throwing inside the up-front conversion', async () => {
    // The `!Number.isFinite` arm is unreachable from the one production caller
    // (parseMemberMetaRecords already coerces non-finite values to null), but it
    // is NOT redundant with the range check next to it: Infinity is caught by the
    // bound, while NaN is not, since `NaN > 8.64e15` is false. With this arm gone
    // a NaN reaches `new Date(NaN).toISOString()`, which throws a RangeError inside
    // the up-front .map, aborting all 1000 records BEFORE any SQL runs, exactly the
    // whole-batch failure this helper exists to prevent. Reached here by calling
    // the exported function directly, since the helper itself is module-private.
    const { pool, calls } = makePool(() => counted('1', '0', []));
    const result = await setDiscordMemberMetaBulk(pool, [
      metaRecord({ discordUserId: 'nan-join', joinedAtMs: Number.NaN }),
      metaRecord({ discordUserId: 'ok-join', joinedAtMs: 1_700_000_000_000 }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].params[2]).toEqual([null, '2023-11-14T22:13:20.000Z']);
    expect(result).toEqual({ changed: 1, skipped: 0, unapplied: [] });
  });

  it('reports changed, skipped and the unapplied ids, coercing bigint counts', async () => {
    // Postgres hands count(*) back as a bigint STRING through pg; a caller
    // comparing that to a number would silently always disagree.
    const { pool } = makePool(() => counted('3', '2', ['nolink1', 'nolink2']));
    expect(await setDiscordMemberMetaBulk(pool, [metaRecord()])).toEqual({
      changed: 3,
      skipped: 2,
      unapplied: ['nolink1', 'nolink2'],
    });
  });

  it('offers the same id order whatever order the caller supplied (deadlock guard)', async () => {
    // A multi-row UPDATE takes row locks in the order its plan feeds it, so two
    // overlapping pushes presenting the same ids in opposite orders can deadlock
    // and Postgres aborts one. The old per-member loop held one lock per
    // autocommitted statement and could never form a cycle, so this failure mode
    // is one THIS change introduces; sorting is what removes it again.
    const forward = makePool(() => counted('3', '0', []));
    await setDiscordMemberMetaBulk(forward.pool, [
      metaRecord({ discordUserId: 'alpha' }),
      metaRecord({ discordUserId: 'bravo' }),
      metaRecord({ discordUserId: 'charlie' }),
    ]);

    const reversed = makePool(() => counted('3', '0', []));
    await setDiscordMemberMetaBulk(reversed.pool, [
      metaRecord({ discordUserId: 'charlie' }),
      metaRecord({ discordUserId: 'bravo' }),
      metaRecord({ discordUserId: 'alpha' }),
    ]);

    // Same order out of both, and pinned to the literal so "both sorted" cannot
    // be satisfied by both being left in caller order.
    expect(forward.calls[0].params[0]).toEqual(['alpha', 'bravo', 'charlie']);
    expect(reversed.calls[0].params[0]).toEqual(['alpha', 'bravo', 'charlie']);
    // And the SQL keeps the order through to the UPDATE that takes the locks.
    expect(forward.calls[0].sql).toContain('FROM (SELECT * FROM input ORDER BY discord_user_id) i');
  });

  it('de-duplicates repeated ids keeping the LAST occurrence', async () => {
    // The old sequential loop applied every record in order, so the row ended up
    // holding the LAST write. Collapsing to the first would silently change that.
    const { pool, calls } = makePool(() => counted('1', '0', []));
    await setDiscordMemberMetaBulk(pool, [
      metaRecord({ discordUserId: 'dup', nickname: 'first', roleKey: null }),
      metaRecord({ discordUserId: 'other', nickname: 'other' }),
      metaRecord({ discordUserId: 'dup', nickname: 'last', roleKey: 'mods' }),
    ]);
    expect(calls[0].params[0]).toEqual(['dup', 'other']);
    expect(calls[0].params[1]).toEqual(['last', 'other']);
    expect(calls[0].params[3]).toEqual(['mods', 'mods']);
  });
});

describe('discordFlexRowsForDiscordIds', () => {
  const flexRow = (discordUserId: string) => ({
    discord_user_id: discordUserId,
    account_id: 7,
    discord_username: 'coolguy',
    points: '500',
    lifetime_points: '2000',
    character_name: 'Hero',
    character_class: 'warrior',
    character_level: 40,
  });

  it('issues exactly ONE statement for a 1-id batch and ONE for a 200-id batch', async () => {
    // The per-account path costs FOUR round trips per user (link lookup, top
    // character, reward state, link row). This is the pin that says the batch
    // read did not just move that loop server-side.
    const one = makePool(() => ({ rows: [flexRow('u0')], rowCount: 1 }));
    await discordFlexRowsForDiscordIds(one.pool, ['u0'], 'eastbrook');
    expect(one.calls).toHaveLength(1);

    const ids = Array.from({ length: 200 }, (_, i) => `u${i}`);
    const many = makePool(() => ({ rows: ids.map(flexRow), rowCount: ids.length }));
    await discordFlexRowsForDiscordIds(many.pool, ids, 'eastbrook');
    expect(many.calls).toHaveLength(1);
    expect(many.calls[0].params).toEqual([ids, 'eastbrook']);
  });

  it('issues NO statement for an empty id list', async () => {
    const { pool, calls } = makePool(() => ({ rows: [flexRow('u0')], rowCount: 1 }));
    expect(await discordFlexRowsForDiscordIds(pool, [], 'eastbrook')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('de-duplicates the bound id array, like its sibling discordLinksForAccounts', async () => {
    // Today's one caller sanitizes into a Set already; binding the dedup here
    // too keeps a future second caller from inheriting that unstated
    // requirement (repeats in an ANY() waste probes and skew nothing else).
    const { pool, calls } = makePool(() => ({ rows: [], rowCount: 0 }));
    await discordFlexRowsForDiscordIds(pool, ['u1', 'u2', 'u1', 'u2', 'u3'], 'eastbrook');
    expect(calls[0].params[0]).toEqual(['u1', 'u2', 'u3']);
  });

  it('resolves the whole batch through one ANY() pass with the reward join', async () => {
    const { pool, calls } = makePool(() => ({ rows: [], rowCount: 0 }));
    await discordFlexRowsForDiscordIds(pool, ['u1'], 'eastbrook');
    const sql = calls[0].sql;
    // One set-based membership test, not an id-per-statement lookup.
    expect(sql).toContain('WHERE dl.discord_user_id = ANY($1::text[])');
    // A LEFT JOIN so a linked account with no reward row still answers (zeroed).
    expect(sql).toContain('LEFT JOIN reward_points rp ON rp.account_id = dl.account_id');
    // The top-character rule must stay in lockstep with highestCharacterForAccount
    // in server/db.ts: both endpoints are live, and if they disagree the bot shows
    // a different character depending on which one it called. Pinned on BOTH sides
    // below, not just here.
    expect(sql).toContain(
      "ORDER BY c.level DESC, ((c.state->>'lifetimeXp')::bigint) DESC NULLS LAST, c.id ASC",
    );
    // Only the level is projected out of the character state blob. Selecting
    // `state` itself would drag megabytes of JSONB across for one integer.
    // The jsonb_typeof guard makes the projection TOTAL: a bare ::int cast raises
    // on any character whose state.level is not numeric, and that one corrupt row
    // would fail the read for every OTHER member in the batch. The per-account
    // path tolerates it in TypeScript, so the batch must not be more brittle.
    // All three parts are pinned because each one alone is insufficient:
    // jsonb_typeof still admits a float, and numeric::int still overflows.
    // NESTED CASEs, not one WHEN with AND: Postgres does not promise an order
    // of AND operand evaluation, so the bounds arm's ::numeric cast must sit in
    // a branch the typeof arm guards, which only CASE nesting guarantees.
    expect(sql).toContain(
      "CASE WHEN jsonb_typeof(c.state->'level') = 'number' THEN CASE WHEN (c.state->>'level')::numeric BETWEEN -2147483648 AND 2147483647 THEN (c.state->>'level')::numeric::int ELSE c.level END ELSE c.level END AS level",
    );
  });

  it('maps bigint strings to numbers and leaves an account with no character null', async () => {
    const { pool } = makePool(() => ({
      rows: [
        flexRow('u1'),
        {
          discord_user_id: 'u2',
          account_id: 8,
          discord_username: null,
          points: '0',
          lifetime_points: '0',
          character_name: null,
          character_class: null,
          character_level: null,
        },
      ],
      rowCount: 2,
    }));
    // Built as fresh literals rather than reusing the flexRow() object: the pg
    // fake hands the same object through, so asserting against it would compare
    // the mapped result with its own source.
    expect(await discordFlexRowsForDiscordIds(pool, ['u1', 'u2'], 'eastbrook')).toEqual([
      {
        discord_user_id: 'u1',
        account_id: 7,
        discord_username: 'coolguy',
        points: 500,
        lifetime_points: 2000,
        character_name: 'Hero',
        character_class: 'warrior',
        character_level: 40,
      },
      {
        discord_user_id: 'u2',
        account_id: 8,
        discord_username: null,
        points: 0,
        lifetime_points: 0,
        character_name: null,
        character_class: null,
        character_level: null,
      },
    ]);
  });

  it('orders top-character identically to highestCharacterForAccount in server/db.ts', async () => {
    // A ONE-SIDED pin would be near worthless here. Asserting only that this
    // module still carries the clause leaves an edit on the db.ts side green while
    // the two live endpoints silently disagree about which character is "top", and
    // db.ts is the side more likely to be edited (it owns the characters table).
    // So read both sources and require the SAME ordering, modulo the table alias
    // the batched query has to carry and the per-account query does not.
    //
    // A source-text pin because that is exactly what the claim is: two SQL strings
    // must say the same thing, and server/db.ts cannot be imported into
    // server/discord_db.ts to share a constant (db.ts imports DISCORD_SCHEMA from
    // it, so the dependency runs one way only).
    const { pool, calls } = makePool(() => ({ rows: [], rowCount: 0 }));
    await discordFlexRowsForDiscordIds(pool, ['u1'], 'eastbrook');
    const batchedOrderBy = calls[0].sql
      .slice(calls[0].sql.indexOf('ORDER BY c.level'))
      .slice(
        0,
        "ORDER BY c.level DESC, ((c.state->>'lifetimeXp')::bigint) DESC NULLS LAST, c.id ASC"
          .length,
      )
      .replace(/\bc\./g, '');

    // The db.ts side is narrowed to the BODY of highestCharacterForAccount before
    // it is searched. A whole-file `toContain` is not the pin it reads as: this
    // very phase added a LOCKSTEP comment directly above that query which restates
    // the clause in prose, so deleting `, id ASC` from the live ORDER BY while any
    // comment or unrelated query elsewhere in this 3000-line file still spelled
    // the old clause would leave the search satisfied and the two live endpoints
    // silently disagreeing. Slicing to the function body is what makes the
    // assertion answer "is the SHIPPING statement still in step", not "does this
    // text appear somewhere in the file".
    const dbSource = readFileSync(new URL('../server/db.ts', import.meta.url), 'utf8');
    // Anchored on the bare name, NOT the full one-line signature: that declaration
    // is 99 characters against biome's lineWidth of 100, so a two-character rename
    // would wrap the parameter list and turn this pin red with no defect behind it.
    const fnStart = dbSource.indexOf('function highestCharacterForAccount(');
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = dbSource.indexOf('\n}', fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const perAccountQuery = dbSource.slice(fnStart, fnEnd).replace(/\s+/g, ' ');
    // The slice must not swallow whatever follows. Asserted STRUCTURALLY (no second
    // top-level declaration inside it, exactly one query) rather than by naming the
    // current next function: a guard that names `listCharacters` goes quietly
    // constant-true the day anything is inserted between the two, which is the same
    // rotting-anchor shape this narrowing exists to remove.
    expect(perAccountQuery).not.toContain('export ');
    expect(perAccountQuery.split('pool.query(')).toHaveLength(2);

    expect(batchedOrderBy).toBe(
      "ORDER BY level DESC, ((state->>'lifetimeXp')::bigint) DESC NULLS LAST, id ASC",
    );
    // Non-vacuous on the db.ts side: the same de-aliased clause is really present
    // inside that function, so deleting or reordering it on either side fails.
    expect(perAccountQuery).toContain(batchedOrderBy);
    // ...and the LOCKSTEP comment sits ABOVE the function, i.e. outside the slice,
    // which is what proves the assertion above cannot be satisfied by prose.
    expect(perAccountQuery).not.toContain('LOCKSTEP');
  });

  it('returns nothing for an id with no link row (never a fabricated payload)', async () => {
    // The query selects FROM discord_links, so an unlinked id contributes no row.
    // Absence IS the unlinked answer; the caller must not receive a zeroed entry.
    const { pool } = makePool(() => ({ rows: [flexRow('linked')], rowCount: 1 }));
    const rows = await discordFlexRowsForDiscordIds(pool, ['linked', 'unlinked'], 'eastbrook');
    expect(rows.map((r) => r.discord_user_id)).toEqual(['linked']);
  });
});

describe('discord pending logins', () => {
  const ROW = {
    token: 'tok',
    discord_user_id: '80351110224678912',
    discord_username: 'Maxp',
    discord_avatar: null,
    guild_member: true,
  };

  it('createDiscordPendingLogin inserts with the verified identity + TTL', async () => {
    const { pool, calls, didRun } = makePool(() => NONE);
    await createDiscordPendingLogin(pool, {
      token: 'tok',
      discordUserId: '80351110224678912',
      username: 'Maxp',
      avatar: null,
      email: 'maxp@example.com',
      emailVerified: true,
      guildMember: true,
      ttlMinutes: 15,
    });
    expect(didRun('INSERT INTO discord_pending_logins')).toBe(true);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO discord_pending_logins'));
    expect(insert?.params).toEqual([
      'tok',
      '80351110224678912',
      'Maxp',
      null,
      'maxp@example.com',
      true,
      true,
      '15',
    ]);
  });

  it('peekDiscordPendingLogin reads WITHOUT deleting (live row, then null)', async () => {
    const live = makePool((s) =>
      s.includes('SELECT') && s.includes('FROM discord_pending_logins')
        ? { rows: [ROW], rowCount: 1 }
        : NONE,
    );
    expect(await peekDiscordPendingLogin(live.pool, 'tok')).toEqual(ROW);
    // A peek must never delete the row (it stays reusable for the retry).
    expect(live.didRun('DELETE FROM discord_pending_logins')).toBe(false);
    const dead = makePool(() => NONE);
    expect(await peekDiscordPendingLogin(dead.pool, 'tok')).toBeNull();
  });

  it('consumeDiscordPendingLogin deletes-and-returns (single use)', async () => {
    const live = makePool((s) =>
      s.includes('DELETE FROM discord_pending_logins') ? { rows: [ROW], rowCount: 1 } : NONE,
    );
    expect(await consumeDiscordPendingLogin(live.pool, 'tok')).toEqual(ROW);
    expect(live.didRun('DELETE FROM discord_pending_logins')).toBe(true);
    const dead = makePool(() => NONE);
    expect(await consumeDiscordPendingLogin(dead.pool, 'tok')).toBeNull();
  });
});

describe('/api/discord status cache busts ride the real write paths (Phase 9)', () => {
  // Every case drives the REAL discord_db write function; the assertion is the
  // per-account refresh COUNT on an installed counting reader, which proves the
  // bust fired through the write's own code path (calling bust() directly would
  // prove only that bust() exists). Negative arms per site: the no-op /refusal
  // shapes must NOT evict a healthy snapshot (busts ride real writes only).
  const reads = new Map<number, number>();

  beforeEach(() => {
    reads.clear();
    configureDiscordStatusCache(async (accountId) => {
      reads.set(accountId, (reads.get(accountId) ?? 0) + 1);
      return { link: null, points: 0, lifetimePoints: 0, claimedSwagIds: [], passwordSet: true };
    });
    resetDiscordStatusCacheForTests();
  });
  afterEach(() => {
    resetDiscordStatusCacheForTests();
  });

  const warm = (id: number) => readDiscordStatusCore(id);
  const readsFor = (id: number) => reads.get(id) ?? 0;

  it('grantRewardPoints busts the granted account on a real balance write', async () => {
    const { pool } = makePool((s) => {
      if (s.includes('INSERT INTO reward_points'))
        return { rows: [{ points: '10', lifetime_points: '10' }], rowCount: 1 };
      return NONE;
    });
    await warm(42);
    await warm(43);
    await grantRewardPoints(pool, 42, 10, 'test');
    await warm(42);
    await warm(43);
    expect(readsFor(42)).toBe(2);
    // Cross-account isolation through a real write: 43's entry survives 42's bust.
    expect(readsFor(43)).toBe(1);
  });

  it('a dedupe-key replay and a zero delta leave the cached entry alone', async () => {
    const replay = makePool((s) => {
      if (s.includes('ON CONFLICT (account_id, dedupe_key)')) return NONE; // already granted
      if (s.includes('SELECT points, lifetime_points'))
        return { rows: [{ points: '5', lifetime_points: '5' }], rowCount: 1 };
      return NONE;
    });
    await warm(42);
    await grantRewardPoints(replay.pool, 42, 10, 'test', 'key1');
    await warm(42);
    expect(readsFor(42)).toBe(1);

    const zero = makePool((s) => {
      if (s.includes('SELECT points, lifetime_points'))
        return { rows: [{ points: '5', lifetime_points: '5' }], rowCount: 1 };
      return NONE;
    });
    await grantRewardPoints(zero.pool, 42, 0, 'test');
    await warm(42);
    expect(readsFor(42)).toBe(1);
  });

  it('claimSwag busts on EVERY successful claim, the cost-0 arm included', async () => {
    const priced = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 1 }], rowCount: 1 };
      if (s.includes('UPDATE reward_points SET points = points -'))
        return { rows: [{ points: '1' }], rowCount: 1 };
      return NONE;
    });
    await warm(42);
    expect((await claimSwag(priced.pool, 42, 'hat', 100)).ok).toBe(true);
    await warm(42);
    expect(readsFor(42)).toBe(2);

    // A free claim moves no points (no feed enqueue) but still adds a
    // claimedSwagIds entry, which is a payload field, so it must bust too.
    const free = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 2 }], rowCount: 1 };
      if (s.includes('SELECT points FROM reward_points'))
        return { rows: [{ points: '3' }], rowCount: 1 };
      return NONE;
    });
    expect((await claimSwag(free.pool, 42, 'title', 0)).ok).toBe(true);
    await warm(42);
    expect(readsFor(42)).toBe(3);
  });

  it('claimSwag refusal arms (already claimed, cannot afford) never bust', async () => {
    const claimed = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return NONE; // ON CONFLICT DO NOTHING hit
      return NONE;
    });
    await warm(42);
    expect((await claimSwag(claimed.pool, 42, 'hat', 100)).ok).toBe(false);
    await warm(42);
    expect(readsFor(42)).toBe(1);

    const broke = makePool((s) => {
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 3 }], rowCount: 1 };
      if (s.includes('UPDATE reward_points SET points = points -')) return NONE; // points < cost
      return NONE;
    });
    expect((await claimSwag(broke.pool, 42, 'hat', 100)).ok).toBe(false);
    await warm(42);
    expect(readsFor(42)).toBe(1);
  });

  it('a COMMIT failure never busts (the bust rides the committed write, not the attempt)', async () => {
    // Bust-before-COMMIT is the mock-invisible reorder this arm exists for: an
    // early bust lets a concurrent refresh read pre-commit data and park it
    // until the TTL. A refused COMMIT must surface raw and evict nothing.
    const grant = makePool((s) => {
      if (s === 'COMMIT') throw new Error('commit refused');
      if (s.includes('INSERT INTO reward_points'))
        return { rows: [{ points: '10', lifetime_points: '10' }], rowCount: 1 };
      return NONE;
    });
    await warm(42);
    await expect(grantRewardPoints(grant.pool, 42, 10, 'test')).rejects.toThrow('commit refused');
    await warm(42);
    expect(readsFor(42)).toBe(1);

    const swag = makePool((s) => {
      if (s === 'COMMIT') throw new Error('commit refused');
      if (s.includes('INSERT INTO swag_claims')) return { rows: [{ id: 9 }], rowCount: 1 };
      if (s.includes('UPDATE reward_points SET points = points -'))
        return { rows: [{ points: '1' }], rowCount: 1 };
      return NONE;
    });
    await expect(claimSwag(swag.pool, 42, 'hat', 100)).rejects.toThrow('commit refused');
    await warm(42);
    expect(readsFor(42)).toBe(1);
  });

  it('linkDiscordToAccount busts on a landed upsert, never on the owned-by-other refusal', async () => {
    const info = {
      discordUserId: '80351110224678912',
      username: 'maxp',
      avatar: null,
      email: null,
      guildMember: true,
    };
    const ok = makePool((s) => {
      if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id')) return NONE;
      return NONE;
    });
    await warm(42);
    expect(await linkDiscordToAccount(ok.pool, 42, info)).toBe(true);
    await warm(42);
    expect(readsFor(42)).toBe(2);

    const owned = makePool((s) => {
      if (s.includes('SELECT account_id FROM discord_links WHERE discord_user_id'))
        return { rows: [{ account_id: 99 }], rowCount: 1 };
      return NONE;
    });
    expect(await linkDiscordToAccount(owned.pool, 42, info)).toBe(false);
    await warm(42);
    expect(readsFor(42)).toBe(2);
  });

  it('unlinkDiscord busts only when a row was really deleted', async () => {
    const deleted = makePool((s) =>
      s.includes('DELETE FROM discord_links') ? { rows: [], rowCount: 1 } : NONE,
    );
    await warm(42);
    await unlinkDiscord(deleted.pool, 42);
    await warm(42);
    expect(readsFor(42)).toBe(2);

    // The repeat unlink matches nothing: an idempotent no-op must not evict.
    const repeat = makePool(() => NONE);
    await unlinkDiscord(repeat.pool, 42);
    await warm(42);
    expect(readsFor(42)).toBe(2);
  });

  it('setDiscordGuildMember busts on a matched row, not for an account with no link', async () => {
    const matched = makePool((s) =>
      s.includes('UPDATE discord_links SET guild_member') ? { rows: [], rowCount: 1 } : NONE,
    );
    await warm(42);
    await setDiscordGuildMember(matched.pool, 42, true);
    await warm(42);
    expect(readsFor(42)).toBe(2);

    const unmatched = makePool(() => NONE);
    await setDiscordGuildMember(unmatched.pool, 42, true);
    await warm(42);
    expect(readsFor(42)).toBe(2);
  });

  it('setDiscordMemberMetaBulk busts exactly the changed accounts off the RETURNING', async () => {
    const { pool } = makePool(() => ({
      rows: [{ changed: '1', skipped: '1', unapplied: [], changed_account_ids: [42] }],
      rowCount: 1,
    }));
    await warm(42);
    await warm(43);
    await setDiscordMemberMetaBulk(pool, [
      metaRecord({ discordUserId: 'u42' }),
      metaRecord({ discordUserId: 'u43' }),
    ]);
    await warm(42);
    await warm(43);
    // The changed account refreshes; the skipped one keeps its snapshot.
    expect(readsFor(42)).toBe(2);
    expect(readsFor(43)).toBe(1);
  });

  it('setDiscordMemberMetaBulk skips junk changed_account_ids elements without throwing', async () => {
    // The Number.isFinite guard's own arm, decisively: junk FIRST so an
    // early-exit mutant (break/return on the first bad id) still has real
    // work remaining behind it, and account 0 warmed because Number(null) is
    // 0, so a deleted guard busts key 0 and reds the readsFor(0) pin (a bust
    // of an uncached junk key is a no-op delete, invisible otherwise).
    const { pool } = makePool(() => ({
      rows: [{ changed: '3', skipped: '0', unapplied: [], changed_account_ids: [null, 'x', 42] }],
      rowCount: 1,
    }));
    await warm(0);
    await warm(42);
    await setDiscordMemberMetaBulk(pool, [metaRecord({ discordUserId: 'u42' })]);
    await warm(0);
    await warm(42);
    expect(readsFor(0)).toBe(1);
    expect(readsFor(42)).toBe(2);
  });

  it('setDiscordMemberMetaBulk tolerates a row without changed_account_ids and busts nothing', async () => {
    // Defensive-parse arm, same shape as the unapplied guard: a router (or a
    // future statement variant) that omits the aggregate must not throw or bust.
    // With changed = 0 the missing aggregate is legitimate silence: the warn
    // below is reserved for the rows-changed-but-population-lost shape.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { pool } = makePool(() => ({
        rows: [{ changed: '0', skipped: '1', unapplied: [] }],
        rowCount: 1,
      }));
      await warm(42);
      const result = await setDiscordMemberMetaBulk(pool, [metaRecord()]);
      expect(result).toEqual({ changed: 0, skipped: 1, unapplied: [] });
      await warm(42);
      expect(readsFor(42)).toBe(1);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('setDiscordMemberMetaBulk warns once when rows changed but the aggregate is missing', async () => {
    // The invisible-staleness hole the warn exists for: the UPDATE wrote rows,
    // but the bust population was lost, so nothing is busted AND the log says
    // so. Both directions asserted: the warn fires exactly once, and the warm
    // entry is NOT evicted (no id to bust with).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { pool } = makePool(() => ({
        rows: [{ changed: '1', skipped: '0', unapplied: [] }],
        rowCount: 1,
      }));
      await warm(42);
      const result = await setDiscordMemberMetaBulk(pool, [metaRecord()]);
      expect(result).toEqual({ changed: 1, skipped: 0, unapplied: [] });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('changed_account_ids missing');
      await warm(42);
      expect(readsFor(42)).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

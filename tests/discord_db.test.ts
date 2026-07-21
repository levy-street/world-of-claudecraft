import { describe, expect, it } from 'vitest';
import {
  accountForDiscord,
  claimSwag,
  consumeDiscordOAuthState,
  consumeDiscordPendingLogin,
  createDiscordPendingLogin,
  discordIdsWithGuildFlair,
  grantRewardPoints,
  linkDiscordToAccount,
  loadRewardState,
  peekDiscordPendingLogin,
  setDiscordLinkEmail,
} from '../server/discord_db';

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

describe('loadRewardState', () => {
  it('defaults to zeros when no row exists', async () => {
    const { pool } = makePool(() => NONE);
    expect(await loadRewardState(pool, 1)).toEqual({ points: 0, lifetimePoints: 0 });
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

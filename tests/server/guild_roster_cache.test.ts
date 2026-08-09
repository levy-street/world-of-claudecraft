// The guild roster cache (server/guild_roster_cache.ts) wraps
// PgSocialDb.guildMembers (server/social_db.ts): the guild_members JOIN
// characters read is now served at most once per guild per TTL window instead
// of once per call, while every guild_members-mutating PgSocialDb method busts
// the guild it just changed. The one caller that documents needing a
// guaranteed-fresh read (GameServer.guildBankSaveCarrier, server/game.ts) uses
// the separate guildMembersFresh escape hatch, which always bypasses the
// cache; that contract is pinned here too, since tests/guild_bank_persistence.test.ts
// ("will NOT carry on a stale stamp") is what a broken cache would silently fail.

import { describe, expect, it } from 'vitest';
import { GuildRosterCache } from '../../server/guild_roster_cache';
import { PgSocialDb } from '../../server/social_db';

// ---------------------------------------------------------------------------
// GuildRosterCache: the pure mechanism, independent of PgSocialDb / SQL.
// ---------------------------------------------------------------------------

describe('GuildRosterCache', () => {
  it('serves a second read of the SAME key from cache: the reader runs exactly once', async () => {
    let calls = 0;
    const cache = new GuildRosterCache<{ id: number }[]>(async (guildId) => {
      calls++;
      return [{ id: guildId }];
    });
    const a = await cache.read(7);
    const b = await cache.read(7);
    expect(calls).toBe(1);
    // The SAME cached array instance, not a re-fetch that happens to equal it.
    expect(b).toBe(a);
  });

  it('reads a DIFFERENT key independently, never conflated with an unrelated guild', async () => {
    let calls = 0;
    const cache = new GuildRosterCache<number>(async (guildId) => {
      calls++;
      return guildId * 10;
    });
    expect(await cache.read(1)).toBe(10);
    expect(await cache.read(2)).toBe(20);
    expect(calls).toBe(2);
  });

  it('bust(key) forces the next read of that key to re-query', async () => {
    let calls = 0;
    const cache = new GuildRosterCache<number>(async () => {
      calls++;
      return calls;
    });
    expect(await cache.read(1)).toBe(1);
    expect(await cache.read(1)).toBe(1); // still cached: the reader did not run again
    cache.bust(1);
    expect(await cache.read(1)).toBe(2); // busted: a fresh value
    expect(calls).toBe(2);
  });

  it('bust(key) never drops an UNRELATED key that happens to still be cached', async () => {
    let calls = 0;
    const cache = new GuildRosterCache<number>(async () => {
      calls++;
      return calls;
    });
    await cache.read(1);
    await cache.read(2);
    cache.bust(1);
    expect(await cache.read(2)).toBe(2); // guild 2 never re-queried
    expect(calls).toBe(2);
  });

  it('caps entries at maxEntries: driving more distinct guilds than the cap never grows past it', async () => {
    const cache = new GuildRosterCache<number>(async (guildId) => guildId, { maxEntries: 3 });
    for (let guildId = 0; guildId < 50; guildId++) {
      await cache.read(guildId);
      expect(cache.stats().entries).toBeLessThanOrEqual(3);
    }
    expect(cache.stats().entries).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PgSocialDb wiring: the real JOIN, cached, busted by every guild_members
// mutation, with guildMembersFresh always bypassing the cache.
// ---------------------------------------------------------------------------

type RawMemberRow = {
  id: number;
  name: string;
  cls: string;
  level: number;
  realm: string;
  rank: string;
  lastLogin: string | null;
  joinedAt: string | null;
  active_title: string | null;
};

function memberRow(id: number, rank = 'member'): RawMemberRow {
  return {
    id,
    name: `Char${id}`,
    cls: 'warrior',
    level: 10,
    realm: 'R',
    rank,
    lastLogin: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    active_title: null,
  };
}

// A minimal `Pool`-shaped double: the guild_members JOIN, the RETURNING guild_id
// delete a kick/leave uses, and the rank UPDATE. Everything else answers empty,
// which is fine (bustAdminGuildListReads and the invite/rename statements this
// suite never exercises do not touch it).
function fakePool(rowsByGuild: Map<number, RawMemberRow[]>) {
  const selectCalls: number[] = [];
  const query = async (text: string, values?: unknown[]) => {
    if (text.includes('FROM guild_members gm JOIN characters c')) {
      const guildId = Number((values ?? [])[0]);
      selectCalls.push(guildId);
      return { rows: rowsByGuild.get(guildId) ?? [] };
    }
    if (text.startsWith('DELETE FROM guild_members WHERE character_id = $1 RETURNING guild_id')) {
      const charId = Number((values ?? [])[0]);
      for (const [guildId, rows] of rowsByGuild) {
        const idx = rows.findIndex((r) => r.id === charId);
        if (idx >= 0) {
          rows.splice(idx, 1);
          return { rows: [{ guild_id: guildId }] };
        }
      }
      return { rows: [] };
    }
    if (text.startsWith('UPDATE guild_members SET rank = $2')) {
      return { rowCount: 1 };
    }
    return { rows: [] };
  };
  return { pool: { query }, selectCalls };
}

describe('PgSocialDb.guildMembers caching', () => {
  it('reads the SAME guild twice from cache: one JOIN query, the identical rows back', async () => {
    const rowsByGuild = new Map([[5, [memberRow(1, 'leader'), memberRow(2)]]]);
    const { pool, selectCalls } = fakePool(rowsByGuild);
    const db = new PgSocialDb(pool as never);
    const first = await db.guildMembers(5);
    const second = await db.guildMembers(5);
    expect(selectCalls).toEqual([5]); // one query, not two
    expect(second).toBe(first); // the same cached array instance
    expect(first.map((m) => m.id)).toEqual([1, 2]);
    expect(first[0].rank).toBe('leader');
  });

  it('reads two DIFFERENT guilds as two independent queries', async () => {
    const rowsByGuild = new Map([
      [5, [memberRow(1)]],
      [6, [memberRow(2)]],
    ]);
    const { pool, selectCalls } = fakePool(rowsByGuild);
    const db = new PgSocialDb(pool as never);
    await db.guildMembers(5);
    await db.guildMembers(6);
    expect(selectCalls).toEqual([5, 6]);
  });

  it('removeGuildMember busts exactly the guild it removed a member from', async () => {
    const rowsByGuild = new Map([[5, [memberRow(1, 'leader'), memberRow(2)]]]);
    const { pool, selectCalls } = fakePool(rowsByGuild);
    const db = new PgSocialDb(pool as never);
    const before = await db.guildMembers(5);
    expect(before.map((m) => m.id)).toEqual([1, 2]);
    expect(selectCalls).toEqual([5]);

    await db.removeGuildMember(2); // a kick or a leave

    const after = await db.guildMembers(5);
    // Busted: a REAL second query, not the stale cached array, reflecting the
    // removal immediately.
    expect(selectCalls).toEqual([5, 5]);
    expect(after).not.toBe(before);
    expect(after.map((m) => m.id)).toEqual([1]);
  });

  it('setGuildRank busts on an actual row move; a refused write busts nothing', async () => {
    const rowsByGuild = new Map([[5, [memberRow(1, 'leader'), memberRow(2)]]]);
    const { pool, selectCalls } = fakePool(rowsByGuild);
    const db = new PgSocialDb(pool as never);
    await db.guildMembers(5);
    expect(selectCalls).toEqual([5]);

    const moved = await db.setGuildRank(2, 5, 'officer');
    expect(moved).toBe(true);
    await db.guildMembers(5);
    expect(selectCalls).toEqual([5, 5]); // busted: a second real query
  });

  it('guildMembersFresh ALWAYS re-queries even with a warm cache entry (the carrier-lookup contract)', async () => {
    // GameServer.guildBankSaveCarrier (server/game.ts) calls guildMembersFresh,
    // never guildMembers, exactly so a kick is visible on the very next read
    // instead of waiting out the roster cache's TTL: regression pin for
    // tests/guild_bank_persistence.test.ts "will NOT carry on a stale stamp".
    const rowsByGuild = new Map([[5, [memberRow(1, 'leader')]]]);
    const { pool, selectCalls } = fakePool(rowsByGuild);
    const db = new PgSocialDb(pool as never);
    await db.guildMembers(5); // warms the roster cache
    expect(selectCalls).toEqual([5]);

    // The durable roster changes without going through a PgSocialDb write (the
    // point under test is only whether the read is cache-served, not how the
    // row changed).
    rowsByGuild.set(5, [memberRow(1, 'leader'), memberRow(9, 'member')]);

    const fresh = await db.guildMembersFresh(5);
    expect(selectCalls).toEqual([5, 5]); // NOT served from the roster cache
    expect(fresh.map((m) => m.id)).toEqual([1, 9]);

    // guildMembers() itself is untouched: still the earlier cached answer.
    const cached = await db.guildMembers(5);
    expect(selectCalls).toEqual([5, 5]); // no third query
    expect(cached.map((m) => m.id)).toEqual([1]);
  });
});

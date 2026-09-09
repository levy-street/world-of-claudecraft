// The guild bank activity log's server read path (server/guild_bank_log.ts):
// the player-visible PROJECTION of bank_ledger rows, and the per-guild cached
// read that keeps one answer serving every officer of a guild.
//
// Two properties carry this suite:
//   1. What is withheld is withheld for a reason and is pinned as such: the two
//      diagnostic anomaly ops never reach a player, and an operator purge is
//      shown but NEVER attributed to the guildmate whose session carried it.
//   2. The read is cached and single-flighted per guild, and a book change
//      BUSTS it. Without the bust the guild would be shown a pre-op history for
//      a whole TTL precisely while somebody was watching for the op.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BANK_LEDGER_GUILD_MONEY_OPS_PREDICATE_SQL } from '../../server/bank_ledger_indexes';
import {
  bustGuildBankLog,
  GUILD_BANK_LOG_HIDDEN_OPS,
  GUILD_BANK_LOG_LIMIT,
  GUILD_BANK_LOG_VISIBLE_OPS,
  type GuildBankLogPage,
  guildBankLogCacheStats,
  guildBankLogOpsFor,
  parseGuildBankLogQuery,
  projectGuildBankLogRow,
  projectGuildBankLogRows,
  readGuildBankLog,
  resetGuildBankLogCacheForTests,
} from '../../server/guild_bank_log';
import {
  type GuildBankLogDbRow,
  guildBankLogPageSql,
  isGuildBankMoneySlice,
} from '../../server/guild_bank_log_db';
import type { GuildBankLogEntry } from '../../src/world_api/guild_bank';

/** One cached page as the injected reader answers it. */
const page = (entries: GuildBankLogEntry[], more = false): GuildBankLogPage => ({
  entries,
  more,
});

const AT = 1_770_000_000_000;

function dbRow(over: Partial<GuildBankLogDbRow> = {}): GuildBankLogDbRow {
  return {
    id: 42,
    at: AT,
    characterName: 'Kara',
    op: 'deposit',
    itemId: 'iron_ore',
    count: 5,
    copperDelta: 0,
    ...over,
  };
}

describe('projectGuildBankLogRow: what a guild is allowed to see', () => {
  it('never projects the diagnostic anomaly ops', () => {
    // These are operator forensics about a conservation defect, not something a
    // player did. Rendering one to a guild would be alarming, unactionable, and
    // usually wrong about who was involved.
    for (const op of GUILD_BANK_LOG_HIDDEN_OPS) {
      expect(projectGuildBankLogRow(dbRow({ op })), `op ${op}`).toBeNull();
    }
    expect(GUILD_BANK_LOG_HIDDEN_OPS).toEqual(['escrow_deficit', 'counterparty_orphan']);
  });

  it('refuses any op outside the allowlist (a future ledger op is invisible until reviewed)', () => {
    expect(projectGuildBankLogRow(dbRow({ op: 'some_future_op' }))).toBeNull();
  });

  it('projects every allowlisted op', () => {
    for (const op of GUILD_BANK_LOG_VISIBLE_OPS) {
      expect(projectGuildBankLogRow(dbRow({ op })), `op ${op}`).not.toBeNull();
    }
  });

  it('the visible and hidden lists together cover the whole guild op vocabulary', () => {
    // Exhaustiveness against the real bank_ledger op union: a new op that lands
    // in NEITHER list would silently default to invisible with nobody deciding.
    // Personal-container ops are out of scope (this reader filters on
    // container = 'guild' in SQL).
    const declared = [...GUILD_BANK_LOG_VISIBLE_OPS, ...GUILD_BANK_LOG_HIDDEN_OPS].sort();
    expect(declared).toEqual(
      [
        'admin_purge',
        'buy_slots',
        'counterparty_orphan',
        'create_fee',
        'deposit',
        'deposit_gold',
        'escrow_deficit',
        'open_bank',
        'withdraw',
        'withdraw_gold',
      ].sort(),
    );
  });

  it('an operator purge is SHOWN but names NOBODY', () => {
    // The row's character column is the escrow carrier: an online guild member
    // who lent their save transaction. Naming them would tell the guild that a
    // bystander destroyed their property.
    const row = projectGuildBankLogRow(dbRow({ op: 'admin_purge', characterName: 'Carrier' }));
    expect(row).not.toBeNull();
    expect(row?.actor).toBeNull();
    expect(row?.itemId).toBe('iron_ore');
  });

  it('names the actor on every op a guildmate performed', () => {
    for (const op of GUILD_BANK_LOG_VISIBLE_OPS.filter((o) => o !== 'admin_purge')) {
      expect(projectGuildBankLogRow(dbRow({ op }))?.actor, `op ${op}`).toBe('Kara');
    }
  });

  it('carries no account id, character id, realm, or instance payload', () => {
    const row = projectGuildBankLogRow(dbRow());
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'actor',
      'at',
      'copper',
      'count',
      'id',
      'itemId',
      'op',
    ]);
  });

  it('normalizes copper to a positive magnitude whatever the sign convention was', () => {
    // copper_delta's sign is NOT one axis in this table: the gold ops record the
    // treasury's signed movement while buy_slots / open_bank / create_fee record
    // a negated PAYMENT. The op name carries the direction; the number is a size.
    expect(projectGuildBankLogRow(dbRow({ op: 'deposit_gold', copperDelta: 2_500 }))?.copper).toBe(
      2_500,
    );
    expect(
      projectGuildBankLogRow(dbRow({ op: 'withdraw_gold', copperDelta: -2_500 }))?.copper,
    ).toBe(2_500);
    expect(projectGuildBankLogRow(dbRow({ op: 'open_bank', copperDelta: -90_000 }))?.copper).toBe(
      90_000,
    );
  });

  it('reports a vanished character as no actor rather than an empty name', () => {
    expect(projectGuildBankLogRow(dbRow({ characterName: null }))?.actor).toBeNull();
  });

  it('projectGuildBankLogRows drops exactly the refused rows and keeps order', () => {
    const rows = projectGuildBankLogRows([
      dbRow({ id: 3 }),
      dbRow({ id: 2, op: 'escrow_deficit' }),
      dbRow({ id: 1 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual([3, 1]);
  });

  it('pins the window size (the frame bound and the index-scan bound)', () => {
    expect(GUILD_BANK_LOG_LIMIT).toBe(50);
  });
});

describe('readGuildBankLog: the per-guild cached read', () => {
  let calls: number[] = [];
  let gate: Array<() => void> = [];

  beforeEach(() => {
    calls = [];
    gate = [];
    resetGuildBankLogCacheForTests({
      reader: async (guildId) => {
        calls.push(guildId);
        return page([
          {
            id: guildId,
            at: AT,
            actor: 'Kara',
            op: 'deposit',
            itemId: 'x',
            count: 1,
            copper: null,
          },
        ]);
      },
    });
  });

  it('two officers of the SAME guild share ONE query (single flight)', async () => {
    // The whole point of the cache: the answer is identical for every officer,
    // so N officers opening the log must not become N queries on a
    // keep-forever table.
    resetGuildBankLogCacheForTests({
      reader: (guildId) =>
        new Promise((resolve) => {
          calls.push(guildId);
          gate.push(() =>
            resolve(
              page([
                {
                  id: 1,
                  at: AT,
                  actor: 'Kara',
                  op: 'deposit',
                  itemId: 'x',
                  count: 1,
                  copper: null,
                },
              ]),
            ),
          );
        }),
    });
    const officerA = readGuildBankLog(7);
    const officerB = readGuildBankLog(7);
    expect(calls).toEqual([7]); // one flight, not two
    for (const release of gate) release();
    const [a, b] = await Promise.all([officerA, officerB]);
    expect(a).toEqual(b);
    expect(calls).toEqual([7]);
  });

  it('a warm entry answers a second officer with NO query at all', async () => {
    await readGuildBankLog(7);
    await readGuildBankLog(7);
    expect(calls).toEqual([7]);
  });

  it('different guilds never share an answer', async () => {
    const [seven, nine] = await Promise.all([readGuildBankLog(7), readGuildBankLog(9)]);
    expect(seven.entries[0].id).toBe(7);
    expect(nine.entries[0].id).toBe(9);
    expect(calls.sort()).toEqual([7, 9]);
  });

  it('a book change BUSTS the guild entry: the next read past the floor re-queries', async () => {
    let now = 0;
    resetGuildBankLogCacheForTests({
      now: () => now,
      minRefreshMs: 2_000,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    await readGuildBankLog(7);
    expect(calls).toEqual([7]);
    bustGuildBankLog(7);
    now = 2_000;
    await readGuildBankLog(7);
    expect(calls).toEqual([7, 7]);
  });

  it('a bust is scoped to ONE guild (a busy guild never evicts a quiet one)', async () => {
    let now = 0;
    resetGuildBankLogCacheForTests({
      now: () => now,
      minRefreshMs: 2_000,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    await readGuildBankLog(7);
    await readGuildBankLog(9);
    bustGuildBankLog(7);
    now = 5_000;
    await readGuildBankLog(9);
    expect(calls.filter((g) => g === 9)).toEqual([9]);
  });

  // ---------------------------------------------------------------------
  // The COALESCING FLOOR. Without it a bust dropped the entry outright, so
  // every ledger write made the next read a query, and a guild actively
  // working its bank is exactly the state its officers open the log in: the
  // cache did nothing in the one state it exists for.
  // ---------------------------------------------------------------------

  it('serves the installed value through a bust until the floor elapses', async () => {
    let now = 0;
    resetGuildBankLogCacheForTests({
      now: () => now,
      minRefreshMs: 2_000,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    await readGuildBankLog(7);
    expect(calls.length).toBe(1);
    bustGuildBankLog(7);
    now = 1_999;
    await readGuildBankLog(7);
    expect(calls.length, 'inside the floor: still served from the installed value').toBe(1);
    now = 2_000;
    await readGuildBankLog(7);
    expect(calls.length, 'past the floor: one refresh').toBe(2);
  });

  it('caps refreshes at one per floor however hard the guild is banked and read', async () => {
    // THE number the design rests on. Drive a full second of the op guard's
    // sustained write ceiling against a reader hammering every 100ms.
    let now = 0;
    resetGuildBankLogCacheForTests({
      now: () => now,
      minRefreshMs: 2_000,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    await readGuildBankLog(7);
    const cold = calls.length;
    for (let ms = 0; ms < 10_000; ms += 100) {
      now = ms;
      bustGuildBankLog(7); // a write
      bustGuildBankLog(7); // and another, inside the same tick
      await readGuildBankLog(7);
    }
    const refreshes = calls.length - cold;
    // 10 seconds at a 2s floor is at most 5 refreshes, not the 100 a
    // drop-on-bust cache would have produced.
    expect(refreshes).toBeLessThanOrEqual(5);
    expect(
      refreshes,
      'and it must still refresh, or it is not a cache but a freeze',
    ).toBeGreaterThan(0);
  });

  it('a burst of busts cannot push the refresh out indefinitely', async () => {
    // A second bust inside an open floor must be a NO-OP, never a reset: a
    // guild banking continuously would otherwise never see its own history.
    let now = 0;
    resetGuildBankLogCacheForTests({
      now: () => now,
      minRefreshMs: 2_000,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    await readGuildBankLog(7);
    bustGuildBankLog(7);
    for (let ms = 100; ms < 2_000; ms += 100) {
      now = ms;
      bustGuildBankLog(7);
    }
    now = 2_000;
    await readGuildBankLog(7);
    expect(calls.length).toBe(2);
  });

  it('a bust never orphans an in-flight query into a second identical one', async () => {
    // The old drop-on-bust deleted the entry mid-flight, so the next reader
    // minted a SECOND concurrent identical query and the single-flight property
    // stopped holding under the only write pattern that matters.
    const gates: Array<() => void> = [];
    resetGuildBankLogCacheForTests({
      minRefreshMs: 2_000,
      reader: (guildId) =>
        new Promise((resolve) => {
          calls.push(guildId);
          gates.push(() => resolve(page([])));
        }),
    });
    const first = readGuildBankLog(7);
    expect(calls).toEqual([7]);
    bustGuildBankLog(7); // a write lands mid-flight
    const second = readGuildBankLog(7);
    expect(calls, 'the in-flight query is joined, not orphaned').toEqual([7]);
    for (const release of gates) release();
    await Promise.all([first, second]);
  });

  it('a bust with nothing cached leaves no mark (a cold mint sees the write anyway)', async () => {
    let now = 0;
    resetGuildBankLogCacheForTests({
      now: () => now,
      minRefreshMs: 2_000,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    bustGuildBankLog(7); // no entry yet
    await readGuildBankLog(7);
    now = 5_000;
    await readGuildBankLog(7);
    // The cold mint already contained the write, so no redundant refresh sits
    // queued behind it.
    expect(calls.length).toBe(1);
  });

  it('reports the guilds sitting inside a floor, and never constructs the cache to do it', async () => {
    resetGuildBankLogCacheForTests({
      minRefreshMs: 2_000,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    // A stats read on an untouched process must not mint a cache as a side
    // effect of being measured (the discordStatusCacheStats precedent).
    expect(guildBankLogCacheStats()).toEqual({
      reads: 0,
      refreshes: 0,
      evictions: 0,
      busts: 0,
      entries: 0,
      dirtyGuilds: 0,
    });
    await readGuildBankLog(7);
    bustGuildBankLog(7);
    expect(guildBankLogCacheStats().dirtyGuilds).toBe(1);
  });

  it('serves within the TTL and re-queries past it', async () => {
    let now = 0;
    resetGuildBankLogCacheForTests({
      ttlMs: 30_000,
      now: () => now,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    await readGuildBankLog(7);
    now = 29_999;
    await readGuildBankLog(7);
    expect(calls.length).toBe(1);
    now = 30_000;
    await readGuildBankLog(7);
    expect(calls.length).toBe(2);
  });

  it('bounds the entry map (a long uptime with churn is not an unbounded residue)', async () => {
    resetGuildBankLogCacheForTests({
      maxEntries: 3,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    for (const guildId of [1, 2, 3, 4, 5]) await readGuildBankLog(guildId);
    expect(guildBankLogCacheStats().entries).toBeLessThanOrEqual(3);
    expect(guildBankLogCacheStats().evictions).toBeGreaterThan(0);
  });

  it('bounds the DIRTY MARKS too: an evicted guild does not keep its mark forever', async () => {
    // A mark is consumed by the next READ of its guild, so a guild whose cache
    // entry is LRU-evicted before anyone reads it again would otherwise keep
    // its mark for the life of the process, which is not the bound the module
    // header claims for it.
    const now = 0;
    resetGuildBankLogCacheForTests({
      now: () => now,
      minRefreshMs: 2_000,
      maxEntries: 2,
      reader: async (guildId) => {
        calls.push(guildId);
        return page([]);
      },
    });
    // Read and mark three guilds, evicting the earliest entries as we go.
    for (const guildId of [1, 2, 3]) {
      await readGuildBankLog(guildId);
      bustGuildBankLog(guildId);
    }
    expect(guildBankLogCacheStats().evictions).toBeGreaterThan(0);
    // The sweep runs on the bust that pushes the marks past the cache bound.
    await readGuildBankLog(4);
    bustGuildBankLog(4);
    expect(guildBankLogCacheStats().dirtyGuilds).toBeLessThanOrEqual(2);
  });

  it('the cached page is frozen: one reader cannot rewrite history for the rest', async () => {
    resetGuildBankLogCacheForTests();
    const spy = vi.spyOn(await import('../../server/guild_bank_log_db'), 'loadGuildBankLogPage');
    spy.mockResolvedValue({ rows: [dbRow({ id: 3 }), dbRow({ id: 2 })], more: true });
    const result = await readGuildBankLog(7);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.entries)).toBe(true);
    expect(result.more).toBe(true);
    spy.mockRestore();
  });

  it('passes the guild id, the limit, the allowlist and the cursor through to the statement', async () => {
    resetGuildBankLogCacheForTests();
    const spy = vi.spyOn(await import('../../server/guild_bank_log_db'), 'loadGuildBankLogPage');
    spy.mockResolvedValue({ rows: [], more: false });
    await readGuildBankLog(21);
    expect(spy).toHaveBeenCalledWith(21, GUILD_BANK_LOG_LIMIT, GUILD_BANK_LOG_VISIBLE_OPS, null);
    await readGuildBankLog(21, { kind: 'money', before: 400 });
    expect(spy).toHaveBeenLastCalledWith(
      21,
      GUILD_BANK_LOG_LIMIT,
      guildBankLogOpsFor('money'),
      400,
    );
    spy.mockRestore();
  });
});

describe('the money slice rides its partial index', () => {
  it('the partial index predicate names exactly the money ops the seam classifies', () => {
    // The index (bank_ledger_indexes.ts) and the statement interpolate the
    // SAME literal, derived from GUILD_BANK_LOG_OP_KIND; this pins that the
    // literal is the money slice and nothing else, in a stable order.
    const quoted = [...guildBankLogOpsFor('money')]
      .sort()
      .map((op) => `'${op}'`)
      .join(', ');
    expect(BANK_LEDGER_GUILD_MONEY_OPS_PREDICATE_SQL).toBe(`op IN (${quoted})`);
  });

  it('recognizes the money slice exactly, order-free, and nothing narrower or wider', () => {
    const money = guildBankLogOpsFor('money');
    expect(isGuildBankMoneySlice(money)).toBe(true);
    expect(isGuildBankMoneySlice([...money].reverse())).toBe(true);
    expect(isGuildBankMoneySlice(money.slice(1))).toBe(false);
    expect(isGuildBankMoneySlice([...money, 'deposit'])).toBe(false);
    expect(isGuildBankMoneySlice(guildBankLogOpsFor('all'))).toBe(false);
    expect(isGuildBankMoneySlice(guildBankLogOpsFor('items'))).toBe(false);
  });

  it('the money arm interpolates the literal predicate and drops the op parameter', () => {
    const money = guildBankLogPageSql({ cursor: true, money: true });
    expect(money).toContain(`bl.${BANK_LEDGER_GUILD_MONEY_OPS_PREDICATE_SQL}`);
    expect(money).not.toContain('ANY(');
    expect(money).toContain('LIMIT $2');
    expect(money).toContain('bl.realm = $3');
    expect(money).toContain('bl.id < $4');
    const all = guildBankLogPageSql({ cursor: true, money: false });
    expect(all).toContain('bl.op = ANY($2::text[])');
    expect(all).toContain('LIMIT $3');
    expect(all).toContain('bl.realm = $4');
    expect(all).toContain('bl.id < $5');
    expect(guildBankLogPageSql({ cursor: false, money: false })).not.toContain('bl.id <');
  });
});

describe('the transaction history query: kinds and cursors', () => {
  it('guildBankLogOpsFor narrows the allowlist by the seam classification, and `all` is the allowlist', () => {
    expect(guildBankLogOpsFor('all')).toBe(GUILD_BANK_LOG_VISIBLE_OPS);
    expect([...guildBankLogOpsFor('items')].sort()).toEqual(['admin_purge', 'deposit', 'withdraw']);
    expect([...guildBankLogOpsFor('money')].sort()).toEqual([
      'buy_slots',
      'create_fee',
      'deposit_gold',
      'open_bank',
      'withdraw_gold',
    ]);
    // items + money is exactly the allowlist: no visible op falls through.
    expect([...guildBankLogOpsFor('items'), ...guildBankLogOpsFor('money')].sort()).toEqual(
      [...GUILD_BANK_LOG_VISIBLE_OPS].sort(),
    );
  });

  it('parseGuildBankLogQuery re-validates both fields and never widens', () => {
    expect(parseGuildBankLogQuery({ cmd: 'guild_bank_log' })).toEqual({
      kind: 'all',
      before: null,
    });
    expect(parseGuildBankLogQuery({ kind: 'money', before: 12 })).toEqual({
      kind: 'money',
      before: 12,
    });
    // An unknown kind is `all`, the widest slice a member may read anyway; a
    // cursor that is not a positive safe integer is absent.
    for (const kind of ['ops', 'escrow_deficit', 7, null, ['items']]) {
      expect(parseGuildBankLogQuery({ kind }).kind, JSON.stringify(kind)).toBe('all');
    }
    for (const before of [0, -1, 1.5, '12', Number.MAX_SAFE_INTEGER + 1, null]) {
      expect(parseGuildBankLogQuery({ before }).before, JSON.stringify(before)).toBeNull();
    }
    expect(parseGuildBankLogQuery(null)).toEqual({ kind: 'all', before: null });
    expect(parseGuildBankLogQuery('guild_bank_log')).toEqual({ kind: 'all', before: null });
  });

  it('caches per (guild, kind, cursor): different slices and pages are different entries', async () => {
    const seen: string[] = [];
    resetGuildBankLogCacheForTests({
      reader: async (guildId, query) => {
        seen.push(`${guildId}:${query.kind}:${query.before ?? 0}`);
        return page([]);
      },
    });
    await readGuildBankLog(7);
    await readGuildBankLog(7, { kind: 'all', before: null });
    await readGuildBankLog(7, { kind: 'items', before: null });
    await readGuildBankLog(7, { kind: 'items', before: 40 });
    await readGuildBankLog(7, { kind: 'items', before: 40 });
    expect(seen).toEqual(['7:all:0', '7:items:0', '7:items:40']);
  });

  it('a bust refreshes every newest-window slice of the guild and leaves older pages alone', async () => {
    // An older page is a cursor into an append-only table: nothing a later
    // write does can change what lies before that cursor, so re-reading it
    // would be a query for nothing. The three head slices can all change.
    let now = 0;
    const seen: string[] = [];
    resetGuildBankLogCacheForTests({
      now: () => now,
      minRefreshMs: 2_000,
      reader: async (guildId, query) => {
        seen.push(`${guildId}:${query.kind}:${query.before ?? 0}`);
        return page([]);
      },
    });
    await readGuildBankLog(7, { kind: 'all', before: null });
    await readGuildBankLog(7, { kind: 'money', before: null });
    await readGuildBankLog(7, { kind: 'all', before: 40 });
    seen.length = 0;
    bustGuildBankLog(7);
    now = 2_000;
    await readGuildBankLog(7, { kind: 'all', before: 40 });
    await readGuildBankLog(7, { kind: 'all', before: null });
    await readGuildBankLog(7, { kind: 'money', before: null });
    expect(seen).toEqual(['7:all:0', '7:money:0']);
  });
});

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

import type { GuildBankLogDbRow } from '../../server/db';
import {
  bustGuildBankLog,
  GUILD_BANK_LOG_HIDDEN_OPS,
  GUILD_BANK_LOG_LIMIT,
  GUILD_BANK_LOG_VISIBLE_OPS,
  guildBankLogCacheStats,
  projectGuildBankLogRow,
  projectGuildBankLogRows,
  readGuildBankLog,
  resetGuildBankLogCacheForTests,
} from '../../server/guild_bank_log';

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
        return [
          {
            id: guildId,
            at: AT,
            actor: 'Kara',
            op: 'deposit',
            itemId: 'x',
            count: 1,
            copper: null,
          },
        ];
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
            resolve([
              { id: 1, at: AT, actor: 'Kara', op: 'deposit', itemId: 'x', count: 1, copper: null },
            ]),
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
    expect(seven[0].id).toBe(7);
    expect(nine[0].id).toBe(9);
    expect(calls.sort()).toEqual([7, 9]);
  });

  it('a book change BUSTS the guild entry: the next read re-queries', async () => {
    await readGuildBankLog(7);
    expect(calls).toEqual([7]);
    bustGuildBankLog(7);
    await readGuildBankLog(7);
    expect(calls).toEqual([7, 7]);
  });

  it('a bust is scoped to ONE guild (a busy guild never evicts a quiet one)', async () => {
    await readGuildBankLog(7);
    await readGuildBankLog(9);
    bustGuildBankLog(7);
    await readGuildBankLog(9);
    expect(calls.filter((g) => g === 9)).toEqual([9]);
  });

  it('serves within the TTL and re-queries past it', async () => {
    let now = 0;
    resetGuildBankLogCacheForTests({
      ttlMs: 30_000,
      now: () => now,
      reader: async (guildId) => {
        calls.push(guildId);
        return [];
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
        return [];
      },
    });
    for (const guildId of [1, 2, 3, 4, 5]) await readGuildBankLog(guildId);
    expect(guildBankLogCacheStats().entries).toBeLessThanOrEqual(3);
    expect(guildBankLogCacheStats().evictions).toBeGreaterThan(0);
  });

  it('the cached array is frozen: one reader cannot rewrite history for the rest', async () => {
    resetGuildBankLogCacheForTests();
    const spy = vi.spyOn(await import('../../server/db'), 'loadGuildBankLogRows');
    spy.mockResolvedValue([dbRow({ id: 3 }), dbRow({ id: 2 })]);
    const rows = await readGuildBankLog(7);
    expect(Object.isFrozen(rows)).toBe(true);
    spy.mockRestore();
  });

  it('passes the guild id, the limit, and the allowlist through to the statement', async () => {
    resetGuildBankLogCacheForTests();
    const spy = vi.spyOn(await import('../../server/db'), 'loadGuildBankLogRows');
    spy.mockResolvedValue([]);
    await readGuildBankLog(21);
    expect(spy).toHaveBeenCalledWith(21, GUILD_BANK_LOG_LIMIT, GUILD_BANK_LOG_VISIBLE_OPS);
    spy.mockRestore();
  });
});

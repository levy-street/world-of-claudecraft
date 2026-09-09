// The per-guild holder index behind the unsettled gate and the coalesced
// holder flush (server/guild_book_holders.ts), unit. The index replaces the
// realm-wide session scan the gate first shipped with; the pins here are the
// maintenance contract (touch / resync / dropGuild / dropSession), the cache
// invalidation trap the module note names, the contributing-only bounded
// flush selection, and the one-in-flight-one-rearm flush.
import { describe, expect, it, vi } from 'vitest';
import {
  GUILD_BOOK_FLUSH_FAN_OUT_MAX,
  GuildBookHolderIndex,
  requestGuildBookFlush,
} from '../server/guild_book_holders';
import { type GuildBankOpDelta, guildBankDeltaIdentityKey } from '../src/sim/guild_bank';

const delta = (partial: Partial<GuildBankOpDelta> & { op: GuildBankOpDelta['op'] }) => ({
  itemId: null,
  count: null,
  instance: null,
  craftedRecipeId: null,
  copperDelta: 0,
  purchasedSlotsBefore: 0,
  purchasedSlotsAfter: 0,
  ...partial,
});
const deposit = (itemId: string, count: number) => delta({ op: 'deposit', itemId, count });
const withdraw = (itemId: string, count: number) => delta({ op: 'withdraw', itemId, count });
const gold = (copperDelta: number) =>
  delta({ op: copperDelta > 0 ? 'deposit_gold' : 'withdraw_gold', copperDelta });
const keyOf = (itemId: string) =>
  guildBankDeltaIdentityKey({ itemId, instance: null, craftedRecipeId: null });

interface FakeSession {
  name: string;
  escrowQuarantined: boolean;
  left: boolean;
  dirtyGuildBanks: Map<number, number>;
  unflushedGuildBankOps: Map<number, GuildBankOpDelta[]>;
  guildBookFlushInFlight: boolean;
  guildBookFlushRearm: boolean;
}

function session(name: string): FakeSession {
  return {
    name,
    escrowQuarantined: false,
    left: false,
    dirtyGuildBanks: new Map(),
    unflushedGuildBankOps: new Map(),
    guildBookFlushInFlight: false,
    guildBookFlushRearm: false,
  };
}

/** Land an op on a session the way the coordinator does: mark, log, touch. */
function land(
  index: GuildBookHolderIndex<FakeSession>,
  s: FakeSession,
  guildId: number,
  ...deltas: GuildBankOpDelta[]
): void {
  s.dirtyGuildBanks.set(guildId, (s.dirtyGuildBanks.get(guildId) ?? 0) + 1);
  const log = s.unflushedGuildBankOps.get(guildId) ?? [];
  log.push(...deltas);
  s.unflushedGuildBankOps.set(guildId, log);
  index.touch(s, guildId);
}

/** Commit a prefix the way the post-commit consume does: splice, maybe clear
 *  the mark, resync. */
function commit(
  index: GuildBookHolderIndex<FakeSession>,
  s: FakeSession,
  guildId: number,
  count: number,
): void {
  const log = s.unflushedGuildBankOps.get(guildId) ?? [];
  log.splice(0, count);
  if (log.length === 0) {
    s.unflushedGuildBankOps.delete(guildId);
    s.dirtyGuildBanks.delete(guildId);
  }
  index.resync(s);
}

describe('GuildBookHolderIndex: maintenance', () => {
  it('indexes a holder on touch, sums its contribution, and forgets it once its mark clears', () => {
    const index = new GuildBookHolderIndex<FakeSession>();
    const a = session('a');
    const me = session('me');
    land(index, a, 9, deposit('spider_leg', 20));
    expect(index.holders(9, me, { includeLeaving: false })).toEqual([a]);
    expect(index.unsettled(9, me).items.get(keyOf('spider_leg'))).toBe(20);
    expect(index.size).toBe(1);
    commit(index, a, 9, 1);
    expect(index.holders(9, me, { includeLeaving: false })).toEqual([]);
    expect(index.unsettled(9, me).items.size).toBe(0);
    expect(index.size).toBe(0);
  });

  it('never counts the acting session itself, a quarantined holder, or (unless asked) a leaving one', () => {
    const index = new GuildBookHolderIndex<FakeSession>();
    const me = session('me');
    const quarantined = session('q');
    const leaving = session('l');
    land(index, me, 9, deposit('spider_leg', 5));
    land(index, quarantined, 9, deposit('spider_leg', 5));
    land(index, leaving, 9, deposit('spider_leg', 5));
    quarantined.escrowQuarantined = true;
    leaving.left = true;
    expect(index.holders(9, me, { includeLeaving: false })).toEqual([]);
    expect(index.holders(9, me, { includeLeaving: true })).toEqual([leaving]);
    // The gate counts the leaving holder's work; the flush never targets it.
    expect(index.unsettled(9, me).items.get(keyOf('spider_leg'))).toBe(5);
    expect(index.contributors(9, me, { kind: 'items', key: keyOf('spider_leg') })).toEqual([]);
  });

  it('invalidates, never patches: a commit that consumed one entry while an op pushed another keeps the length and changes the contents', () => {
    const index = new GuildBookHolderIndex<FakeSession>();
    const a = session('a');
    const me = session('me');
    land(index, a, 9, deposit('spider_leg', 10));
    // Warm the cache on the old log.
    expect(index.unsettled(9, me).items.get(keyOf('spider_leg'))).toBe(10);
    // The deposit commits (prefix consumed) while a NEW op lands: same log
    // length, different contents.
    const log = a.unflushedGuildBankOps.get(9);
    if (!log) throw new Error('missing log');
    log.splice(0, 1);
    index.resync(a);
    land(index, a, 9, deposit('venom_gland', 10));
    expect(a.unflushedGuildBankOps.get(9)).toHaveLength(1);
    const u = index.unsettled(9, me);
    expect(u.items.get(keyOf('spider_leg'))).toBeUndefined();
    expect(u.items.get(keyOf('venom_gland'))).toBe(10);
  });

  it('resync after a rollback, dropGuild on a disband, and dropSession on a leave all forget the holder', () => {
    const index = new GuildBookHolderIndex<FakeSession>();
    const me = session('me');
    const a = session('a');
    const b = session('b');
    const c = session('c');
    land(index, a, 9, gold(1_000));
    land(index, b, 9, gold(1_000));
    land(index, c, 9, gold(1_000));
    land(index, c, 10, gold(1_000));
    // A rolled back: its marks are gone before the resync.
    a.dirtyGuildBanks.clear();
    a.unflushedGuildBankOps.clear();
    index.resync(a);
    expect(index.holders(9, me, { includeLeaving: false })).toEqual([b, c]);
    index.dropSession(c);
    expect(index.holders(9, me, { includeLeaving: false })).toEqual([b]);
    expect(index.holders(10, me, { includeLeaving: false })).toEqual([]);
    index.dropGuild(9);
    expect(index.holders(9, me, { includeLeaving: false })).toEqual([]);
    expect(index.size).toBe(0);
  });

  it('sums each holder POSITIVE net per key and copper (a removal never hides a deposit)', () => {
    const index = new GuildBookHolderIndex<FakeSession>();
    const me = session('me');
    const b = session('b');
    const c = session('c');
    land(index, b, 9, deposit('spider_leg', 10), gold(10_000));
    land(index, c, 9, withdraw('spider_leg', 10), gold(-10_000));
    const u = index.unsettled(9, me);
    expect(u.items.get(keyOf('spider_leg'))).toBe(10);
    expect(u.copper).toBe(10_000);
  });
});

describe('GuildBookHolderIndex.contributors: the flush selection', () => {
  function rig() {
    const index = new GuildBookHolderIndex<FakeSession>();
    const me = session('me');
    const legs = session('legs');
    const glands = session('glands');
    const copper = session('copper');
    const rung = session('rung');
    land(index, legs, 9, deposit('spider_leg', 20));
    land(index, glands, 9, deposit('venom_gland', 20));
    land(index, copper, 9, gold(50_000));
    land(index, rung, 9, delta({ op: 'open_bank', copperDelta: -10_000, purchasedSlotsAfter: 24 }));
    return { index, me, legs, glands, copper, rung };
  }

  it('selects only the holders whose work feeds the dependency', () => {
    const { index, me, legs, glands, copper, rung } = rig();
    expect(index.contributors(9, me, { kind: 'items', key: keyOf('spider_leg') })).toEqual([legs]);
    expect(index.contributors(9, me, { kind: 'items_of', itemId: 'venom_gland' })).toEqual([
      glands,
    ]);
    expect(index.contributors(9, me, { kind: 'copper' })).toEqual([copper]);
    expect(index.contributors(9, me, { kind: 'ladder' })).toEqual([rung]);
    expect(index.contributors(9, me, { kind: 'items', key: keyOf('wolf_fang') })).toEqual([]);
  });

  it('flushes every holder when no dependency is named, bounded by the fan-out cap', () => {
    const { index, me } = rig();
    expect(index.contributors(9, me, null)).toHaveLength(4);
    expect(index.contributors(9, me, null, 2)).toHaveLength(2);
    expect(GUILD_BOOK_FLUSH_FAN_OUT_MAX).toBe(4);
    // A fifth contributor stays behind the cap.
    const fifth = session('fifth');
    land(index, fifth, 9, gold(1));
    expect(index.contributors(9, me, null)).toHaveLength(GUILD_BOOK_FLUSH_FAN_OUT_MAX);
  });

  it('never selects a leaving or quarantined holder even when it feeds the dependency', () => {
    const { index, me, legs } = rig();
    legs.left = true;
    expect(index.contributors(9, me, { kind: 'items', key: keyOf('spider_leg') })).toEqual([]);
    legs.left = false;
    legs.escrowQuarantined = true;
    expect(index.contributors(9, me, { kind: 'items', key: keyOf('spider_leg') })).toEqual([]);
  });
});

describe('requestGuildBookFlush: one in flight, one re-arm', () => {
  function deferred() {
    let resolve: (() => void) | undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve: () => resolve?.() };
  }

  it('runs one save while further requests only arm a single follow-up', async () => {
    const s = session('holder');
    s.dirtyGuildBanks.set(9, 1);
    const first = deferred();
    const save = vi.fn(() => first.promise);
    requestGuildBookFlush(s, save);
    requestGuildBookFlush(s, save);
    requestGuildBookFlush(s, save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.guildBookFlushInFlight).toBe(true);
    expect(s.guildBookFlushRearm).toBe(true);
    // The flush settles with work still on the holder: exactly ONE more.
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(2);
    expect(s.guildBookFlushRearm).toBe(false);
  });

  it('does not re-arm once the holder is clean when the flush settles', async () => {
    const s = session('holder');
    s.dirtyGuildBanks.set(9, 1);
    const first = deferred();
    const save = vi.fn(() => {
      // The save commits the holder's work.
      s.dirtyGuildBanks.clear();
      return first.promise;
    });
    requestGuildBookFlush(s, save);
    requestGuildBookFlush(s, save);
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.guildBookFlushInFlight).toBe(false);
    expect(s.guildBookFlushRearm).toBe(false);
  });

  it('settles on a rejected save too, and never flushes a leaving or quarantined holder', async () => {
    const s = session('holder');
    s.dirtyGuildBanks.set(9, 1);
    const save = vi.fn(() => Promise.reject(new Error('db down')));
    requestGuildBookFlush(s, save);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.guildBookFlushInFlight).toBe(false);
    const left = session('left');
    left.left = true;
    left.dirtyGuildBanks.set(9, 1);
    const never = vi.fn(() => Promise.resolve());
    requestGuildBookFlush(left, never);
    const quarantined = session('q');
    quarantined.escrowQuarantined = true;
    quarantined.dirtyGuildBanks.set(9, 1);
    requestGuildBookFlush(quarantined, never);
    expect(never).not.toHaveBeenCalled();
  });
});

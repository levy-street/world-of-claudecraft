// Guild Bank Phase 1 (foundation): the state model in src/sim/guild_bank.ts
// (constants, capacity ladder, the sanitizeGuildBankState load path, the
// per-guild book map with its load/serialize seam) plus the session-only
// PlayerMeta.guildMembership stamp and its parity-trace exclusion.
// Phase 2 (ops and wire): the five op bodies behind the pid-first Sim entry
// points (guildBank*For), the full refusal matrix (a decisive negative test
// per dimension on every op; no refusal path mutates), the gated info read
// with its null transitions (walk-away, death, demotion, leave), the stale-
// rank scenario, determinism, and the five ClientWorld wire sends.
//
// Constants and capacities are pinned to LITERAL numbers (never compared to the
// exported constant, which would be a zero-protection self-comparison), so a
// table regression flips an assertion.
import { describe, expect, it } from 'vitest';
// Type-only import (erased at compile, never executed): pins the sim-side rank
// redeclaration to the server's source of truth so the two cannot drift silently.
import type { GuildRank as ServerGuildRank } from '../server/social';
import { ClientWorld } from '../src/net/online';
import { bagCapacity, stackSizeOf } from '../src/sim/bags';
import { sanitizeBankState } from '../src/sim/bank';
import { BUILTIN_WORLD, ITEMS, QUESTS } from '../src/sim/data';
import {
  applyGuildBankDeltasTo,
  createEmptyGuildBankState,
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_LADDER_POSITIONS,
  GUILD_BANK_RUNG_PRICES,
  GUILD_BANK_RUNG_SLOTS,
  GUILD_BANK_TREASURY_CAP,
  GUILD_CREATION_FEE_COPPER,
  GUILD_RANKS,
  type GuildBankOpDelta,
  type GuildBankState,
  type GuildRank,
  guildBankCapacity,
  guildBankDeltaIdentityKey,
  guildBankNextExpansionPrice,
  guildBankPipeRefusal,
  guildBankRungsBought,
  netGuildBankOpLogForReplay,
  revertGuildBankDeltasTo,
  sanitizeGuildBankState,
} from '../src/sim/guild_bank';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, WorldContent } from '../src/sim/types';
import { META_EXCLUDE, samplePlayerMeta } from './parity/trace';

// The 7-rung ladder from docs/guild-bank/state.md, pinned as literals: rung 0
// OPENS the bank (24 slots, PURSE-paid); rungs 1..6 are the treasury-paid
// 6-slot expansions.
const PRICES = [90000, 25000, 50000, 100000, 250000, 500000, 1000000];
const RUNGS = [24, 6, 6, 6, 6, 6, 6];
const POSITIONS = [0, 24, 30, 36, 42, 48, 54, 60]; // every valid purchasedSlots value
const EXPANSION_TOTAL = 1925000; // 192g50s across the six treasury expansions (rungs 1..6)

const EMPTY: GuildBankState = { treasury: 0, inventory: [], purchasedSlots: 0 };

function freshSim(): Sim {
  return new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
}

// The sim redeclares the server's GuildRank (src/sim never imports server/);
// these two assignability pins fail to COMPILE if either side adds or renames a
// rank without the other, and the runtime pin below fixes the literal values.
type AssertExtends<_A extends B, B> = never;
type _SimRankCoversServer = AssertExtends<ServerGuildRank, GuildRank>;
type _ServerRankCoversSim = AssertExtends<GuildRank, ServerGuildRank>;

describe('guild bank constants (state.md contract)', () => {
  it('pins the creation fee, rung geometry, price ladder, and treasury cap', () => {
    expect(GUILD_CREATION_FEE_COPPER).toBe(10000); // founding costs 1 gold
    expect(GUILD_BANK_EXPANSION_SLOTS).toBe(6);
    expect([...GUILD_BANK_RUNG_SLOTS]).toEqual(RUNGS);
    expect([...GUILD_BANK_RUNG_PRICES]).toEqual(PRICES);
    expect([...GUILD_BANK_LADDER_POSITIONS]).toEqual(POSITIONS);
    // Reduce over the EXPORT (not the file-local literal) so the ladder-total claim is
    // load-bearing against the shipped table, not a tautology: the treasury
    // expansions (rungs 1..6) total 192g50s; the whole ladder adds rung 0's
    // 9g purse-paid opening on top.
    expect(GUILD_BANK_RUNG_PRICES.slice(1).reduce((a, b) => a + b, 0)).toBe(EXPANSION_TOTAL);
    expect(GUILD_BANK_RUNG_PRICES.reduce((a, b) => a + b, 0)).toBe(90000 + EXPANSION_TOTAL);
    expect(GUILD_BANK_TREASURY_CAP).toBe(1000000000);
  });

  it('pins the rank ladder to the server contract values', () => {
    expect([...GUILD_RANKS]).toEqual(['leader', 'officer', 'member']);
  });
});

describe('guildBankCapacity + guildBankNextExpansionPrice', () => {
  it('walks the full ladder: capacity per rung count and the next price at each step', () => {
    for (let rungs = 0; rungs <= 7; rungs++) {
      const bank: GuildBankState = {
        treasury: 0,
        inventory: [],
        purchasedSlots: POSITIONS[rungs],
      };
      expect(guildBankRungsBought(bank.purchasedSlots)).toBe(rungs);
      expect(guildBankCapacity(bank)).toBe(POSITIONS[rungs]);
      expect(guildBankNextExpansionPrice(bank)).toBe(rungs < 7 ? PRICES[rungs] : null);
    }
  });

  it('an UNOPENED bank (no rung bought) has 0 slots and rung 0 as the next price', () => {
    const unopened: GuildBankState = { treasury: 0, inventory: [], purchasedSlots: 0 };
    expect(guildBankCapacity(unopened)).toBe(0);
    expect(guildBankNextExpansionPrice(unopened)).toBe(90000); // the purse-paid opening
  });

  it('maxed banks report 60 slots and no further price', () => {
    const maxed: GuildBankState = { treasury: 0, inventory: [], purchasedSlots: 60 };
    expect(guildBankCapacity(maxed)).toBe(60);
    expect(guildBankNextExpansionPrice(maxed)).toBeNull();
  });

  it('floors a non-position purchasedSlots when pricing (defensive arm)', () => {
    // Sanitize guarantees valid ladder positions, so this arm is defensive;
    // pin it anyway so the floor cannot silently become a round-up (price
    // skip): a count below the opened base indexes rung 0, a count between
    // positions indexes the last rung actually reached.
    const odd: GuildBankState = { treasury: 0, inventory: [], purchasedSlots: 7 };
    expect(guildBankNextExpansionPrice(odd)).toBe(90000); // rung 0: 7 never opened the bank
    expect(guildBankCapacity(odd)).toBe(0);
    const between: GuildBankState = { treasury: 0, inventory: [], purchasedSlots: 29 };
    expect(guildBankNextExpansionPrice(between)).toBe(25000); // rung 1, not rung 2
    expect(guildBankCapacity(between)).toBe(24);
  });
});

describe('createEmptyGuildBankState', () => {
  it('returns the empty book, a fresh object every call', () => {
    const a = createEmptyGuildBankState();
    const b = createEmptyGuildBankState();
    expect(a).toEqual(EMPTY);
    expect(a).not.toBe(b);
    expect(a.inventory).not.toBe(b.inventory);
  });
});

describe('sanitizeGuildBankState (the ONE load path)', () => {
  it('defaults a missing or non-object raw to an empty book', () => {
    expect(sanitizeGuildBankState(undefined)).toEqual(EMPTY);
    expect(sanitizeGuildBankState(null)).toEqual(EMPTY);
    expect(sanitizeGuildBankState('garbage')).toEqual(EMPTY);
    expect(sanitizeGuildBankState(42)).toEqual(EMPTY);
    // A valid object with every key ABSENT defaults per-field (not the
    // short-circuit path above): pins the whole-object default end to end.
    expect(sanitizeGuildBankState({})).toEqual(EMPTY);
  });

  it('clamps treasury into [0, cap], flooring fractions and zeroing garbage', () => {
    const t = (v: unknown) => sanitizeGuildBankState({ treasury: v }).treasury;
    expect(t(-5)).toBe(0);
    expect(t(0)).toBe(0);
    expect(t(3.9)).toBe(3);
    expect(t(1000000000)).toBe(1000000000); // AT the cap survives
    expect(t(1000000001)).toBe(1000000000); // one past clamps back
    expect(t(Number.POSITIVE_INFINITY)).toBe(1000000000);
    expect(t(Number.NaN)).toBe(0);
    expect(t('not a number')).toBe(0);
    expect(t(undefined)).toBe(0);
  });

  it('floors purchasedSlots to a VALID ladder position within [0, 60]', () => {
    const ps = (v: unknown) => sanitizeGuildBankState({ purchasedSlots: v }).purchasedSlots;
    // Every valid position round-trips unchanged.
    for (const pos of POSITIONS) expect(ps(pos), String(pos)).toBe(pos);
    // Hostile values floor DOWN to the nearest position, so price indexing
    // stays coherent (a tampered save can never sit between rungs): old-ladder
    // residue below the opened base (6, 12, 18) reads as UNOPENED.
    expect(ps(6)).toBe(0);
    expect(ps(7)).toBe(0);
    expect(ps(23)).toBe(0);
    expect(ps(25)).toBe(24);
    expect(ps(29)).toBe(24);
    expect(ps(35)).toBe(30);
    expect(ps(59)).toBe(54);
    expect(ps(61)).toBe(60);
    expect(ps(9999)).toBe(60);
    expect(ps(-6)).toBe(0);
    expect(ps(30.9)).toBe(30);
    expect(ps(Number.NaN)).toBe(0);
    expect(ps(Number.POSITIVE_INFINITY)).toBe(60);
    expect(ps('x')).toBe(0);
  });

  it('coerces a non-array inventory to empty and keeps unknown string ids dormant', () => {
    expect(sanitizeGuildBankState({ inventory: 'nope' }).inventory).toEqual([]);
    const out = sanitizeGuildBankState({
      inventory: [
        null,
        7,
        'x',
        { count: 3 }, // no itemId: dropped
        { itemId: '', count: 3 }, // empty itemId: dropped
        { itemId: 'wolf_fang', count: 3 },
        // Removed-content id: dormant recoverable data, never destroyed.
        { itemId: 'unknown_id_xyz', count: 3 },
      ],
    }).inventory;
    expect(out).toEqual([
      { itemId: 'wolf_fang', count: 3 },
      { itemId: 'unknown_id_xyz', count: 3 },
    ]);
  });

  it('clamps counts like the personal bank: floor, min 1, instanced stack caps', () => {
    const out = sanitizeGuildBankState({
      inventory: [
        { itemId: 'wolf_fang', count: -5 },
        { itemId: 'wolf_fang', count: 2.9 },
        // Unstacked weapon (stackSize 1) with an instance payload caps at 1.
        { itemId: 'worn_sword', count: 5, instance: { signer: 'Ana' } },
        // Mergeable payload caps at the stack size (wolf_fang: 20).
        { itemId: 'wolf_fang', count: 21, instance: { signer: 'Ana' } },
        // Charge-bearing payloads stay one-per-slot (the shared-payload dupe guard).
        { itemId: 'wolf_fang', count: 4, instance: { signer: 'Ana', charges: { zap: 2 } } },
        // Unknown def: the merge-legal ceiling does not apply.
        { itemId: 'unknown_id_xyz', count: 30, instance: { signer: 'Ana' } },
        // Truthy non-object instance: degrades to a PLAIN slot, no garbage payload.
        { itemId: 'wolf_fang', count: 2, instance: 'not-an-object' },
      ],
    }).inventory;
    expect(out.map((s) => s.count)).toEqual([1, 2, 1, 20, 1, 30, 2]);
    expect(out[2]).toEqual({ itemId: 'worn_sword', count: 1, instance: { signer: 'Ana' } });
    expect(out[6]).toEqual({ itemId: 'wolf_fang', count: 2 });
    expect('instance' in out[6]).toBe(false);
  });

  it('preserves craftedRecipeId and drops a non-string or empty one (both arms pinned)', () => {
    // The crafted-provenance marker is part of "items are NEVER destroyed":
    // losing it on load is the same bug class bank.ts pins (tests/bank.test.ts).
    const out = sanitizeGuildBankState({
      inventory: [
        { itemId: 'wolf_fang', count: 2, craftedRecipeId: 'recipe_a' },
        { itemId: 'wolf_fang', count: 2, craftedRecipeId: '' },
        { itemId: 'wolf_fang', count: 2, craftedRecipeId: 7 },
      ],
    }).inventory;
    expect(out).toEqual([
      { itemId: 'wolf_fang', count: 2, craftedRecipeId: 'recipe_a' },
      { itemId: 'wolf_fang', count: 2 },
      { itemId: 'wolf_fang', count: 2 },
    ]);
    // toEqual treats an undefined-valued key as absent, so pin absence directly.
    expect('craftedRecipeId' in out[1]).toBe(false);
    expect('craftedRecipeId' in out[2]).toBe(false);
  });

  it('takes the SHARED load bounds on the payload and the crafted marker', () => {
    // REGRESSION (the one-sanitizer doctrine, src/sim/item_instance_load.ts):
    // this arm used to take `instance` verbatim and accept any non-empty
    // craftedRecipeId string, so an oversized signer or an unbounded marker
    // rode every autosave of the book forever. Both now answer to the same
    // helpers the personal bank arm uses.
    const out = sanitizeGuildBankState({
      inventory: [
        {
          itemId: 'wolf_fang',
          count: 1,
          instance: { signer: 'x'.repeat(5000), junkKey: 'nope' },
          craftedRecipeId: 'r'.repeat(5000),
        },
        // A legal payload beside it is untouched: the bound drops keys, never rows.
        { itemId: 'wolf_fang', count: 1, instance: { signer: 'Ana' }, craftedRecipeId: 'jerky' },
      ],
    }).inventory;
    // The row survives (items are never destroyed) with the junk gone.
    expect(out).toHaveLength(2);
    expect(out[0].itemId).toBe('wolf_fang');
    expect(out[0].instance?.signer).toBeUndefined();
    expect('craftedRecipeId' in out[0]).toBe(false);
    expect(JSON.stringify(out)).not.toContain('xxxxx');
    expect(JSON.stringify(out)).not.toContain('rrrrr');
    expect(out[1]).toEqual({
      itemId: 'wolf_fang',
      count: 1,
      instance: { signer: 'Ana' },
      craftedRecipeId: 'jerky',
    });
  });

  it('tolerates an overstacked PLAIN slot uncapped (the bank.ts pre-bag idiom, pinned)', () => {
    // Deliberate choice, shared with sanitizeBankState: a plain (non-instanced)
    // slot's count has no tamper ceiling (instancedCountCap returns Infinity
    // without a payload), so legacy overstacks survive a load as-is. If either
    // sanitizer ever clamps plain counts, change BOTH and update this pin.
    const out = sanitizeGuildBankState({
      inventory: [{ itemId: 'wolf_fang', count: 999 }],
    }).inventory;
    expect(out).toEqual([{ itemId: 'wolf_fang', count: 999 }]);
  });

  it('stays in lockstep with sanitizeBankState on the shared inventory arm', () => {
    // The inventory loop is a deliberate second copy of bank.ts (rule of three;
    // extract a shared leaf on the third copy). This pin feeds one hostile
    // fixture through BOTH sanitizers and asserts the inventory arms agree, so
    // a tamper-rule hardening applied to one silently skipping the other fails
    // here instead of shipping divergent load paths.
    const hostile = {
      inventory: [
        null,
        7,
        'x',
        { count: 3 },
        { itemId: '', count: 3 },
        { itemId: 'wolf_fang', count: -5 },
        { itemId: 'wolf_fang', count: 2.9 },
        { itemId: 'wolf_fang', count: 999 },
        { itemId: 'worn_sword', count: 5, instance: { signer: 'Ana' } },
        { itemId: 'wolf_fang', count: 21, instance: { signer: 'Ana' } },
        { itemId: 'wolf_fang', count: 4, instance: { signer: 'Ana', charges: { zap: 2 } } },
        { itemId: 'unknown_id_xyz', count: 30, instance: { signer: 'Ana' } },
        { itemId: 'wolf_fang', count: 2, craftedRecipeId: 'jerky' },
        { itemId: 'wolf_fang', count: 2, craftedRecipeId: '' },
        // The shared load bounds: an oversized signer, a junk key, and an
        // unbounded crafted marker must be dropped IDENTICALLY by both arms.
        {
          itemId: 'wolf_fang',
          count: 1,
          instance: { signer: 'x'.repeat(5000), junkKey: 'nope' },
          craftedRecipeId: 'r'.repeat(5000),
        },
      ],
    };
    expect(sanitizeGuildBankState(hostile).inventory).toEqual(sanitizeBankState(hostile).inventory);
  });

  it('tolerates an over-capacity inventory without truncating (items are never destroyed)', () => {
    const raw = {
      inventory: Array.from({ length: 60 }, (_, i) => ({ itemId: `mystery_${i}`, count: 1 })),
      purchasedSlots: 0,
    };
    const book = sanitizeGuildBankState(raw);
    expect(book.inventory.length).toBe(60); // an UNOPENED (0-slot) bank keeps them all
    expect(guildBankCapacity(book)).toBe(0);
  });

  it('round-trips its own output unchanged and never aliases the raw slots', () => {
    const raw = {
      treasury: 123456,
      purchasedSlots: 30,
      inventory: [
        { itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' }, craftedRecipeId: 'jerky' },
      ],
    };
    const once = sanitizeGuildBankState(raw);
    expect(sanitizeGuildBankState(once)).toEqual(once);
    expect(once.inventory[0]).not.toBe(raw.inventory[0]);
    expect(once.inventory[0].instance).not.toBe(raw.inventory[0].instance);
  });
});

describe('the per-guild book map (Sim.guildBanks + load/serialize seam)', () => {
  it('loadGuildBank installs a sanitized book on the live Sim-owned map', () => {
    const sim = freshSim();
    sim.loadGuildBank(3, { treasury: -50, purchasedSlots: 27, inventory: 'nope' });
    expect(sim.guildBanks.get(3)).toEqual({ treasury: 0, inventory: [], purchasedSlots: 24 });
  });

  it('is load-once: a second load never clobbers a live book (unflushed deposits)', () => {
    const sim = freshSim();
    sim.loadGuildBank(3, {
      treasury: 500,
      purchasedSlots: 24,
      inventory: [{ itemId: 'wolf_fang', count: 3 }],
    });
    const live = sim.guildBanks.get(3);
    sim.loadGuildBank(3, { treasury: 0, purchasedSlots: 0, inventory: [] });
    expect(sim.guildBanks.get(3)).toBe(live); // same object: the reload was skipped
    expect(sim.guildBanks.get(3)).toEqual({
      treasury: 500,
      purchasedSlots: 24,
      inventory: [{ itemId: 'wolf_fang', count: 3 }],
    });
    // Evict-then-load is the sanctioned reload path (Phase 3 disband/maintenance).
    sim.guildBanks.delete(3);
    sim.loadGuildBank(3, { treasury: 9, purchasedSlots: 0, inventory: [] });
    expect(sim.guildBanks.get(3)).toEqual({ treasury: 9, purchasedSlots: 0, inventory: [] });
  });

  it('ignores a non-positive or non-integer guild id (no garbage keys)', () => {
    const sim = freshSim();
    sim.loadGuildBank(0, {});
    sim.loadGuildBank(-1, {});
    sim.loadGuildBank(1.5, {});
    sim.loadGuildBank(Number.NaN, {});
    expect(sim.guildBanks.size).toBe(0);
  });

  it('serializeGuildBank returns null for an unknown guild', () => {
    expect(freshSim().serializeGuildBank(99)).toBeNull();
  });

  it('serializeGuildBank deep-clones so the save never aliases the live book', () => {
    const sim = freshSim();
    sim.loadGuildBank(5, {
      treasury: 777,
      purchasedSlots: 24,
      inventory: [{ itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' } }],
    });
    const book = sim.guildBanks.get(5);
    expect(book).toBeDefined();
    const save = sim.serializeGuildBank(5);
    expect(save).toEqual(book);
    expect(save).not.toBe(book);
    expect(save?.inventory).not.toBe(book?.inventory);
    expect(save?.inventory[0]).not.toBe(book?.inventory[0]);
    expect(save?.inventory[0].instance).not.toBe(book?.inventory[0].instance);
    // Mutating the snapshot never touches the live book.
    if (save) {
      save.treasury = 0;
      save.inventory.pop();
    }
    expect(sim.serializeGuildBank(5)).toEqual(book);
  });

  it('starts empty offline: the offline sim never creates a book', () => {
    expect(freshSim().guildBanks.size).toBe(0);
  });
});

describe('the session-only guild membership stamp (PlayerMeta.guildMembership)', () => {
  it('defaults to null on a fresh character (the offline arm)', () => {
    const sim = freshSim();
    expect(sim.players.get(sim.playerId)?.guildMembership).toBeNull();
  });

  it('stamps id + rank, cloned at the write boundary', () => {
    const sim = freshSim();
    const stamp = { guildId: 3, rank: 'officer' as const };
    sim.setPlayerGuildMembership(sim.playerId, stamp);
    const meta = sim.players.get(sim.playerId);
    expect(meta?.guildMembership).toEqual({ guildId: 3, rank: 'officer' });
    // Cloned: the sim must never alias the host's object.
    expect(meta?.guildMembership).not.toBe(stamp);
  });

  it('re-stamping changes the rank in place (promote/demote path)', () => {
    const sim = freshSim();
    sim.setPlayerGuildMembership(sim.playerId, { guildId: 3, rank: 'member' });
    sim.setPlayerGuildMembership(sim.playerId, { guildId: 3, rank: 'leader' });
    expect(sim.players.get(sim.playerId)?.guildMembership).toEqual({ guildId: 3, rank: 'leader' });
  });

  it('null clears the stamp (leave/kick/disband path)', () => {
    const sim = freshSim();
    sim.setPlayerGuildMembership(sim.playerId, { guildId: 3, rank: 'leader' });
    sim.setPlayerGuildMembership(sim.playerId, null);
    expect(sim.players.get(sim.playerId)?.guildMembership).toBeNull();
  });

  it('normalizes a malformed stamp to null instead of storing garbage', () => {
    const sim = freshSim();
    const pid = sim.playerId;
    const meta = () => sim.players.get(pid)?.guildMembership;
    for (const bad of [
      { guildId: 0, rank: 'officer' },
      { guildId: -2, rank: 'officer' },
      { guildId: 1.5, rank: 'officer' },
      { guildId: Number.NaN, rank: 'officer' },
      { guildId: 3, rank: 'boss' },
      // Truthy non-objects: the typeof guard arm, not the !m arm null takes.
      42,
      'guild 3 officer',
    ]) {
      sim.setPlayerGuildMembership(pid, { guildId: 3, rank: 'member' }); // arm with a valid stamp
      sim.setPlayerGuildMembership(pid, bad as never);
      expect(meta(), JSON.stringify(bad)).toBeNull();
    }
  });

  it('ignores an unknown pid without throwing', () => {
    expect(() =>
      freshSim().setPlayerGuildMembership(424242, { guildId: 3, rank: 'leader' }),
    ).not.toThrow();
  });

  it('never serializes into CharacterState (session-only)', () => {
    const sim = freshSim();
    sim.setPlayerGuildMembership(sim.playerId, { guildId: 3, rank: 'leader' });
    const state = sim.serializeCharacter(sim.playerId);
    expect(state).not.toBeNull();
    expect(JSON.stringify(state)).not.toContain('guildMembership');
  });

  it('the whole Phase 1 surface draws NO rng (the module-header claim)', () => {
    const sim = freshSim();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    // Positive control: prove the observer really counts before asserting zero.
    sim.rng.next();
    expect(draws).toBe(1);
    draws = 0;
    sim.loadGuildBank(3, {
      treasury: 500,
      purchasedSlots: 24,
      inventory: [{ itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' } }],
    });
    sim.serializeGuildBank(3);
    sim.serializeGuildBank(99); // the unknown-guild arm
    sim.setPlayerGuildMembership(sim.playerId, { guildId: 3, rank: 'officer' });
    sim.setPlayerGuildMembership(sim.playerId, null);
    sanitizeGuildBankState({ treasury: -1, purchasedSlots: 99, inventory: [null, 'x'] });
    createEmptyGuildBankState();
    const book = sim.guildBanks.get(3);
    expect(book).toBeDefined();
    if (book) {
      guildBankCapacity(book);
      guildBankNextExpansionPrice(book);
    }
    // The offline facet arm: the null read and all five inert commands.
    void sim.guildBankInfo;
    sim.guildBankDepositGold(1);
    sim.guildBankWithdrawGold(1);
    sim.guildBankDeposit(0, 1);
    sim.guildBankWithdraw(0, 1);
    sim.guildBankBuySlots();
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });

  it('is excluded from the parity meta sample (the bankBonusSources idiom)', () => {
    expect(META_EXCLUDE.has('guildMembership')).toBe(true);
    const sim = freshSim();
    const meta = sim.players.get(sim.playerId);
    expect(meta).toBeDefined();
    if (!meta) return;
    const before = JSON.stringify(samplePlayerMeta(meta));
    sim.setPlayerGuildMembership(sim.playerId, { guildId: 3, rank: 'officer' });
    expect(JSON.stringify(samplePlayerMeta(meta))).toBe(before);
  });
});

describe('the guild bank facet: inert offline, live online', () => {
  it('offline Sim: null read and five no-op commands mutate nothing (inert forever)', () => {
    const sim = freshSim();
    expect(sim.guildBankInfo).toBeNull();
    const copperBefore = sim.players.get(sim.playerId)?.copper;
    sim.guildBankDepositGold(5);
    sim.guildBankWithdrawGold(5);
    sim.guildBankDeposit(0, 1);
    sim.guildBankWithdraw(0, 1);
    sim.guildBankBuySlots();
    expect(sim.guildBanks.size).toBe(0);
    expect(sim.guildBankInfo).toBeNull();
    expect(sim.players.get(sim.playerId)?.copper).toBe(copperBefore);
  });

  it('ClientWorld: the five facet members send their guild_bank_* wire commands (no empty body)', () => {
    // Bare-prototype probe (the action_bar_layout_client idiom): no WebSocket,
    // cmd spied. Phase 1 pinned these to send NOTHING (no token existed yet);
    // Phase 2 registered the guild_bank_* tokens, so the pin flips: every one
    // of the five bodies MUST send its exact payload (the Phase 1 QA carried-
    // forward acceptance line: no guildBank* method body in online.ts is empty).
    // biome-ignore lint/suspicious/noExplicitAny: bare prototype probe needs the private cmd seam
    const client: any = Object.create(ClientWorld.prototype);
    const sent: unknown[] = [];
    client.cmd = (payload: unknown) => sent.push(payload);
    client.guildBankDepositGold(1500);
    client.guildBankWithdrawGold(2500);
    client.guildBankDeposit(3, 2);
    client.guildBankDeposit(4);
    client.guildBankWithdraw(5, 1);
    client.guildBankWithdraw(6);
    client.guildBankBuySlots();
    expect(sent).toEqual([
      { cmd: 'guild_bank_deposit_gold', amount: 1500 },
      { cmd: 'guild_bank_withdraw_gold', amount: 2500 },
      { cmd: 'guild_bank_deposit', slot: 3, count: 2 },
      { cmd: 'guild_bank_deposit', slot: 4 },
      { cmd: 'guild_bank_withdraw', slot: 5, count: 1 },
      { cmd: 'guild_bank_withdraw', slot: 6 },
      { cmd: 'guild_bank_buy_slots' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: the op bodies + the gated info read, driven through the pid-first
// server entry points (guildBank*For) on the REAL Sim. The offline IWorld
// facet arm stays inert (pinned above); these entry points are how the
// authoritative server acts for a session's pid.
// ---------------------------------------------------------------------------

// The three Gilded Strongbox bursars (banker NPCs), one per town hub, and a
// slim world (the tests/bank.test.ts idiom): op tests need real bankers and
// terrain, not the full continent's ambient spawns.
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'] as const;
const GUILD_BANK_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: Object.fromEntries(BANKERS.map((id) => [id, BUILTIN_WORLD.npcs[id]])),
  groundObjects: [],
};

const GUILD_ID = 7;

function moveToBanker(sim: Sim, pid = sim.playerId): Entity {
  let banker: Entity | null = null;
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === BANKERS[0]) banker = e;
  }
  if (!banker) throw new Error('banker is not spawned in the world');
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  return banker;
}

function moveFarFromBankers(sim: Sim, pid = sim.playerId): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { x: 500, y: p.pos.y, z: 500 };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

// An officer standing at a banker with their guild's book loaded: the fully
// authorized baseline every dimension below degrades from one axis at a time.
// The default book is OPENED (rung 0 bought, 24 slots); pass purchasedSlots: 0
// for the unopened-bank arms.
function makeOfficerSim(
  opts: { rank?: GuildRank; treasury?: number; purchasedSlots?: number } = {},
): Sim {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: false,
    world: GUILD_BANK_TEST_WORLD,
  });
  moveToBanker(sim);
  sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: opts.rank ?? 'officer' });
  sim.loadGuildBank(GUILD_ID, {
    treasury: opts.treasury ?? 100_000,
    inventory: [],
    purchasedSlots: opts.purchasedSlots ?? 24,
  });
  return sim;
}

const meta = (sim: Sim, pid = sim.playerId) => {
  const m = sim.players.get(pid);
  if (!m) throw new Error(`missing meta ${pid}`);
  return m;
};
const book = (sim: Sim) => {
  const b = sim.guildBanks.get(GUILD_ID);
  if (!b) throw new Error('missing guild book');
  return b;
};
const hasErr = (evs: { type: string; text?: string }[], text: string) =>
  evs.some((e) => e.type === 'error' && e.text === text);
const hasLog = (evs: { type: string; text?: string }[], text: string) =>
  evs.some((e) => e.type === 'log' && e.text === text);

// A full state fingerprint for no-mutation assertions: player purse+inventory
// plus the whole book. Any refusal path must leave it byte-identical.
function fingerprint(sim: Sim): string {
  return JSON.stringify({
    copper: meta(sim).copper,
    inventory: meta(sim).inventory,
    book: sim.guildBanks.get(GUILD_ID) ?? null,
  });
}

// Every op, invoked with well-formed arguments, so the shared refusal
// dimensions below run against ALL five ops rather than a sampled one.
const OPS: { name: string; run: (sim: Sim) => void }[] = [
  { name: 'guildBankDepositGoldFor', run: (sim) => sim.guildBankDepositGoldFor(sim.playerId, 10) },
  {
    name: 'guildBankWithdrawGoldFor',
    run: (sim) => sim.guildBankWithdrawGoldFor(sim.playerId, 10),
  },
  { name: 'guildBankDepositFor', run: (sim) => sim.guildBankDepositFor(sim.playerId, 0, 1) },
  { name: 'guildBankWithdrawFor', run: (sim) => sim.guildBankWithdrawFor(sim.playerId, 0, 1) },
  { name: 'guildBankBuySlotsFor', run: (sim) => sim.guildBankBuySlotsFor(sim.playerId) },
];

describe('guild bank ops: the shared refusal dimensions (every op, one axis at a time)', () => {
  it('dead: every op is silently inert (the market/mail town-service idiom)', () => {
    for (const op of OPS) {
      const sim = makeOfficerSim();
      sim.addItem('wolf_fang', 3);
      book(sim).inventory.push({ itemId: 'wolf_fang', count: 2 });
      const p = sim.entities.get(sim.playerId);
      if (!p) throw new Error('missing player');
      p.dead = true;
      const before = fingerprint(sim);
      sim.drainEvents();
      op.run(sim);
      expect(fingerprint(sim), op.name).toBe(before);
      expect(sim.drainEvents(), op.name).toEqual([]);
    }
  });

  it('out of range: every op refuses with the banker-distance error and mutates nothing', () => {
    for (const op of OPS) {
      const sim = makeOfficerSim();
      sim.addItem('wolf_fang', 3);
      book(sim).inventory.push({ itemId: 'wolf_fang', count: 2 });
      moveFarFromBankers(sim);
      const before = fingerprint(sim);
      sim.drainEvents();
      op.run(sim);
      expect(fingerprint(sim), op.name).toBe(before);
      expect(hasErr(sim.drainEvents(), 'You are too far from the banker.'), op.name).toBe(true);
    }
  });

  it('no guild: every op refuses with the no-guild error and mutates nothing', () => {
    for (const op of OPS) {
      const sim = makeOfficerSim();
      sim.addItem('wolf_fang', 3);
      book(sim).inventory.push({ itemId: 'wolf_fang', count: 2 });
      sim.setPlayerGuildMembership(sim.playerId, null);
      const before = fingerprint(sim);
      sim.drainEvents();
      op.run(sim);
      expect(fingerprint(sim), op.name).toBe(before);
      expect(
        hasErr(sim.drainEvents(), 'You must be in a guild to use the guild bank.'),
        op.name,
      ).toBe(true);
    }
  });

  it('member rank: every op refuses with the officer-gate error and mutates nothing', () => {
    for (const op of OPS) {
      const sim = makeOfficerSim({ rank: 'member' });
      sim.addItem('wolf_fang', 3);
      book(sim).inventory.push({ itemId: 'wolf_fang', count: 2 });
      const before = fingerprint(sim);
      sim.drainEvents();
      op.run(sim);
      expect(fingerprint(sim), op.name).toBe(before);
      expect(
        hasErr(sim.drainEvents(), 'Only guild officers may use the guild bank.'),
        op.name,
      ).toBe(true);
    }
  });

  it('unloaded book: every op is silently inert (host wiring state, not a player error)', () => {
    for (const op of OPS) {
      const sim = new Sim({
        seed: 42,
        playerClass: 'warrior',
        autoEquip: false,
        world: GUILD_BANK_TEST_WORLD,
      });
      moveToBanker(sim);
      sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'officer' });
      sim.addItem('wolf_fang', 3);
      const copperBefore = meta(sim).copper;
      const invBefore = JSON.stringify(meta(sim).inventory);
      sim.drainEvents();
      op.run(sim);
      expect(sim.guildBanks.size, op.name).toBe(0);
      expect(meta(sim).copper, op.name).toBe(copperBefore);
      expect(JSON.stringify(meta(sim).inventory), op.name).toBe(invBefore);
      expect(sim.drainEvents(), op.name).toEqual([]);
    }
  });

  it('leader rank passes the officer-plus gate on every op (the positive arm)', () => {
    const sim = makeOfficerSim({ rank: 'leader', treasury: 100_000 });
    meta(sim).copper = 5_000;
    sim.drainEvents();
    sim.guildBankDepositGoldFor(sim.playerId, 2_000);
    expect(book(sim).treasury).toBe(102_000);
    sim.guildBankWithdrawGoldFor(sim.playerId, 500);
    expect(book(sim).treasury).toBe(101_500);
    sim.addItem('wolf_fang', 3);
    sim.guildBankDepositFor(
      sim.playerId,
      meta(sim).inventory.findIndex((s) => s.itemId === 'wolf_fang'),
    );
    expect(book(sim).inventory).toEqual([{ itemId: 'wolf_fang', count: 3 }]);
    sim.guildBankWithdrawFor(sim.playerId, 0, 1);
    expect(book(sim).inventory).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    sim.guildBankBuySlotsFor(sim.playerId);
    expect(book(sim).purchasedSlots).toBe(30); // opened base 24 + one 6-slot expansion
    expect(book(sim).treasury).toBe(76_500); // 101500 - 25000 (rung-1 price literal)
  });
});

describe('guildBankDepositGoldFor / guildBankWithdrawGoldFor', () => {
  it('malformed amounts are silently inert on both gold ops (shape, the cheat/desync arm)', () => {
    const sim = makeOfficerSim();
    meta(sim).copper = 10_000;
    const before = fingerprint(sim);
    sim.drainEvents();
    for (const bad of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      sim.guildBankDepositGoldFor(sim.playerId, bad);
      sim.guildBankWithdrawGoldFor(sim.playerId, bad);
    }
    expect(fingerprint(sim)).toBe(before);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('deposit refuses when the player lacks the copper, mutating nothing', () => {
    const sim = makeOfficerSim();
    meta(sim).copper = 999;
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankDepositGoldFor(sim.playerId, 1_000);
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'Not enough money.')).toBe(true);
  });

  it('deposit refuses past the treasury cap and accepts exactly to it (never truncates)', () => {
    const sim = makeOfficerSim({ treasury: 999_999_000 });
    meta(sim).copper = 5_000;
    sim.drainEvents();
    // 999_999_000 + 1_001 would end at 1_000_000_001 > 1e9: refused whole.
    sim.guildBankDepositGoldFor(sim.playerId, 1_001);
    expect(book(sim).treasury).toBe(999_999_000);
    expect(meta(sim).copper).toBe(5_000);
    expect(hasErr(sim.drainEvents(), 'The guild treasury cannot hold that much.')).toBe(true);
    // Exactly to the cap (1e9, the state.md literal) is allowed.
    sim.guildBankDepositGoldFor(sim.playerId, 1_000);
    expect(book(sim).treasury).toBe(1_000_000_000);
    expect(meta(sim).copper).toBe(4_000);
  });

  it('deposit moves the copper atomically and emits the formatted notice', () => {
    const sim = makeOfficerSim({ treasury: 0 });
    meta(sim).copper = 50_007;
    sim.drainEvents();
    sim.guildBankDepositGoldFor(sim.playerId, 30_507); // 3g 5s 7c
    expect(meta(sim).copper).toBe(19_500);
    expect(book(sim).treasury).toBe(30_507);
    expect(hasLog(sim.drainEvents(), 'You deposit 3g 5s 7c into the guild treasury.')).toBe(true);
  });

  it('withdraw refuses when the treasury does not hold the amount, mutating nothing', () => {
    const sim = makeOfficerSim({ treasury: 999 });
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankWithdrawGoldFor(sim.playerId, 1_000);
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'The guild treasury does not hold that much.')).toBe(true);
  });

  it('withdraw refuses when it would overflow the player purse past the safe-integer bound', () => {
    const sim = makeOfficerSim({ treasury: 1_000 });
    meta(sim).copper = Number.MAX_SAFE_INTEGER - 500;
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankWithdrawGoldFor(sim.playerId, 501);
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'You cannot carry that much money.')).toBe(true);
    // Exactly to the bound is allowed: the refusal is a bound, not a fudge.
    sim.guildBankWithdrawGoldFor(sim.playerId, 500);
    expect(meta(sim).copper).toBe(Number.MAX_SAFE_INTEGER);
    expect(book(sim).treasury).toBe(500);
  });

  it('withdraw moves the copper atomically and emits the formatted notice', () => {
    const sim = makeOfficerSim({ treasury: 100_000 });
    meta(sim).copper = 100;
    sim.drainEvents();
    sim.guildBankWithdrawGoldFor(sim.playerId, 12_034); // 1g 20s 34c
    expect(meta(sim).copper).toBe(12_134);
    expect(book(sim).treasury).toBe(87_966);
    expect(hasLog(sim.drainEvents(), 'You withdraw 1g 20s 34c from the guild treasury.')).toBe(
      true,
    );
  });

  it('gold round trips conserve total copper (deposit then withdraw)', () => {
    const sim = makeOfficerSim({ treasury: 40_000 });
    meta(sim).copper = 60_000;
    const total = () => meta(sim).copper + book(sim).treasury;
    expect(total()).toBe(100_000);
    sim.guildBankDepositGoldFor(sim.playerId, 25_000);
    expect(total()).toBe(100_000);
    sim.guildBankWithdrawGoldFor(sim.playerId, 55_000);
    expect(total()).toBe(100_000);
    expect(meta(sim).copper).toBe(90_000);
    expect(book(sim).treasury).toBe(10_000);
  });
});

describe('guildBankDepositFor / guildBankWithdrawFor (items)', () => {
  it('refuses quest items with the GUILD-worded error, never the personal-bank line', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.push({ itemId: 'boar_hide', count: 2 }); // kind: 'quest'
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankDepositFor(
      sim.playerId,
      meta(sim).inventory.findIndex((s) => s.itemId === 'boar_hide'),
    );
    expect(fingerprint(sim)).toBe(before);
    const evs = sim.drainEvents();
    expect(hasErr(evs, 'You cannot store quest items in the guild bank.')).toBe(true);
    // Decisive negative: the personal bank's line must NOT be what the guild
    // pane shows (it names the wrong bank, the defect this arm fixes).
    expect(hasErr(evs, 'You cannot store quest items in the bank.')).toBe(false);
  });

  // The guild bank is an ANONYMOUS EXCHANGE PIPE (officer A deposits, officer B
  // withdraws), so it carries the full market/mail pipe policy, not the
  // personal bank's self-storage quest-only rule: one decisive negative test
  // per dimension, on the deposit side AND the tampered-book withdraw side.
  it('refuses soulbound items on deposit (the anonymous-pipe policy), mutating nothing', () => {
    const sim = makeOfficerSim();
    expect(ITEMS.reins_grag_bear.soulbound).toBe(true); // fixture guard
    meta(sim).inventory.push({ itemId: 'reins_grag_bear', count: 1 });
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankDepositFor(
      sim.playerId,
      meta(sim).inventory.findIndex((s) => s.itemId === 'reins_grag_bear'),
    );
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'You cannot store soulbound items in the guild bank.')).toBe(
      true,
    );
  });

  it('refuses noMarketList items on deposit, mutating nothing', () => {
    const sim = makeOfficerSim();
    expect(ITEMS.riding_training.noMarketList).toBe(true); // fixture guard
    meta(sim).inventory.push({ itemId: 'riding_training', count: 1 });
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankDepositFor(
      sim.playerId,
      meta(sim).inventory.findIndex((s) => s.itemId === 'riding_training'),
    );
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'That item cannot be stored in the guild bank.')).toBe(true);
  });

  it('refuses transfer-locked copies on deposit: bound (boundTo) and armed (bindOnTrade)', () => {
    for (const instance of [{ boundTo: 424242 }, { bindOnTrade: true }]) {
      const sim = makeOfficerSim();
      meta(sim).inventory.push({ itemId: 'wolf_fang', count: 1, instance: { ...instance } });
      const before = fingerprint(sim);
      sim.drainEvents();
      sim.guildBankDepositFor(sim.playerId, meta(sim).inventory.length - 1);
      expect(fingerprint(sim), JSON.stringify(instance)).toBe(before);
      expect(
        hasErr(sim.drainEvents(), 'That item cannot be stored in the guild bank.'),
        JSON.stringify(instance),
      ).toBe(true);
    }
  });

  it('refuses the pipe policy on WITHDRAW too: a tampered book cannot complete a transfer', () => {
    // Deposits keep these out, so only a tampered/legacy Phase 3 row can hold
    // one; the copy must stay dormant in the book, never reach another player.
    const sim = makeOfficerSim();
    book(sim).inventory.push(
      { itemId: 'reins_grag_bear', count: 1 }, // soulbound def
      { itemId: 'wolf_fang', count: 1, instance: { boundTo: 424242 } }, // bound copy
    );
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankWithdrawFor(sim.playerId, 0);
    sim.guildBankWithdrawFor(sim.playerId, 1);
    expect(fingerprint(sim)).toBe(before);
    const evs = sim.drainEvents();
    // The WITHDRAW direction speaks its own line: telling an officer they
    // "cannot store" a copy already sitting in the book is simply wrong.
    expect(hasErr(evs, 'That item cannot be withdrawn from the guild bank.')).toBe(true);
    expect(hasErr(evs, 'You cannot store soulbound items in the guild bank.')).toBe(false);
    expect(hasErr(evs, 'That item cannot be stored in the guild bank.')).toBe(false);
  });

  it('refuses every pipe dimension on WITHDRAW, not just the two sampled ones', () => {
    // guildBankPipeRefusal is shared, but the WITHDRAW call site is its own
    // line: sweep all four dimensions through it so a dropped call or a
    // reordered early return on this arm reddens here.
    const sim = makeOfficerSim();
    const questItemId = Object.keys(ITEMS).find((id) => ITEMS[id]?.kind === 'quest');
    const noListId = Object.keys(ITEMS).find(
      (id) => ITEMS[id]?.noMarketList && ITEMS[id]?.kind !== 'quest' && !ITEMS[id]?.soulbound,
    );
    if (!questItemId || !noListId) throw new Error('missing pipe-policy fixtures');
    // Every dimension refuses with the ONE withdraw-direction line (the wording
    // is direction-aware, the refusal set is not).
    const out = 'That item cannot be withdrawn from the guild bank.';
    const rows: { slot: Record<string, unknown>; err: string }[] = [
      { slot: { itemId: questItemId, count: 1 }, err: out },
      { slot: { itemId: 'reins_grag_bear', count: 1 }, err: out },
      { slot: { itemId: noListId, count: 1 }, err: out },
      { slot: { itemId: 'wolf_fang', count: 1, instance: { boundTo: 424242 } }, err: out },
      { slot: { itemId: 'wolf_fang', count: 1, instance: { bindOnTrade: true } }, err: out },
    ];
    for (const [i, row] of rows.entries()) {
      book(sim).inventory.push(row.slot as never);
      const before = fingerprint(sim);
      sim.drainEvents();
      sim.guildBankWithdrawFor(sim.playerId, i);
      expect(fingerprint(sim), JSON.stringify(row.slot)).toBe(before);
      expect(hasErr(sim.drainEvents(), row.err), JSON.stringify(row.slot)).toBe(true);
    }
  });

  it('the pipe refusal set is direction-independent; only the wording moves', () => {
    // The dormant predicate every reader shares is `!== null`, so the two
    // directions must agree slot for slot even though they word it differently.
    const questItemId = Object.keys(ITEMS).find((id) => ITEMS[id]?.kind === 'quest');
    if (!questItemId) throw new Error('missing quest fixture');
    const refused = [
      { itemId: questItemId, count: 1 },
      { itemId: 'reins_grag_bear', count: 1 },
      { itemId: 'riding_training', count: 1 },
      { itemId: 'wolf_fang', count: 1, instance: { boundTo: 424242 } },
      { itemId: 'wolf_fang', count: 1, instance: { bindOnTrade: true } },
    ];
    for (const slot of refused) {
      const dep = guildBankPipeRefusal(slot);
      const wit = guildBankPipeRefusal(slot, 'withdraw');
      expect(dep, JSON.stringify(slot)).not.toBeNull();
      expect(wit, JSON.stringify(slot)).not.toBeNull();
      expect(wit, JSON.stringify(slot)).toBe('That item cannot be withdrawn from the guild bank.');
      expect(dep, JSON.stringify(slot)).not.toBe(wit);
    }
    // A plain copy is allowed BOTH ways (the vacuity guard).
    expect(guildBankPipeRefusal({ itemId: 'wolf_fang', count: 1 })).toBeNull();
    expect(guildBankPipeRefusal({ itemId: 'wolf_fang', count: 1 }, 'withdraw')).toBeNull();
  });

  it('a malformed count is silently inert on both item ops (never grants free units)', () => {
    const sim = makeOfficerSim();
    sim.addItem('wolf_fang', 3);
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 3 });
    const depositIndex = meta(sim).inventory.findIndex((s) => s.itemId === 'wolf_fang');
    // Over-count is the one that would mint units if the guard were lost.
    for (const badCount of [0, -1, 99, Number.NaN, Number.POSITIVE_INFINITY]) {
      const before = fingerprint(sim);
      sim.drainEvents();
      sim.guildBankDepositFor(sim.playerId, depositIndex, badCount);
      sim.guildBankWithdrawFor(sim.playerId, 0, badCount);
      expect(fingerprint(sim), String(badCount)).toBe(before);
      expect(sim.drainEvents(), String(badCount)).toEqual([]);
    }
    // A fractional count FLOORS rather than refusing: the shared
    // moveBetweenContainers contract the personal bank already rides, pinned
    // here so the guild bank cannot drift from it silently.
    sim.drainEvents();
    sim.guildBankDepositFor(sim.playerId, depositIndex, 1.5);
    expect(book(sim).inventory.find((s) => s.itemId === 'wolf_fang')?.count).toBe(4);
    expect(meta(sim).inventory.find((s) => s.itemId === 'wolf_fang')?.count).toBe(2);
  });

  it('un-credits a collect objective on deposit and re-credits it on withdraw', () => {
    // Every content collect item is quest-kind today (and the pipe policy
    // denies those), so the onInventoryChangedForQuests wiring is defensive
    // for future content; pin it with a synthetic collect quest over a plain
    // fungible (the tests/bank.test.ts idiom).
    const sim = makeOfficerSim();
    const m = meta(sim);
    QUESTS.__guild_bank_uncredit = {
      ...QUESTS.q_widows,
      id: '__guild_bank_uncredit',
      objectives: [{ type: 'collect', itemId: 'wolf_fang', count: 5, label: 'Wolf Fang' }],
    };
    try {
      m.questLog.set('__guild_bank_uncredit', {
        questId: '__guild_bank_uncredit',
        counts: [0],
        state: 'active',
      });
      sim.addItem('wolf_fang', 5); // the add-side recompute credits and readies it
      expect(m.questLog.get('__guild_bank_uncredit')).toMatchObject({
        counts: [5],
        state: 'ready',
      });
      sim.guildBankDepositFor(
        sim.playerId,
        m.inventory.findIndex((s) => s.itemId === 'wolf_fang'),
      );
      expect(m.questLog.get('__guild_bank_uncredit')).toMatchObject({
        counts: [0],
        state: 'active',
      });
      sim.guildBankWithdrawFor(sim.playerId, 0);
      expect(m.questLog.get('__guild_bank_uncredit')).toMatchObject({
        counts: [5],
        state: 'ready',
      });
    } finally {
      delete QUESTS.__guild_bank_uncredit;
    }
  });

  it('an out-of-bounds or non-integer slot index is silently inert on both item ops', () => {
    const sim = makeOfficerSim();
    sim.addItem('wolf_fang', 2);
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 2 });
    const before = fingerprint(sim);
    sim.drainEvents();
    for (const bad of [-1, 99, 0.5, Number.NaN]) {
      sim.guildBankDepositFor(sim.playerId, bad);
      sim.guildBankWithdrawFor(sim.playerId, bad);
    }
    expect(fingerprint(sim)).toBe(before);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('deposit refuses when the guild bank is full, mutating nothing', () => {
    const sim = makeOfficerSim();
    // Fill all 24 opened base slots with non-mergeable instanced singles.
    for (let i = 0; i < GUILD_BANK_RUNG_SLOTS[0]; i++) {
      book(sim).inventory.push({ itemId: 'wolf_fang', count: 1, instance: { signer: `S${i}` } });
    }
    sim.addItem('linen_scrap', 1);
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankDepositFor(
      sim.playerId,
      meta(sim).inventory.findIndex((s) => s.itemId === 'linen_scrap'),
    );
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'The guild bank is full.')).toBe(true);
  });

  it('deposit against an UNOPENED (0-capacity) bank refuses cleanly, mutating nothing', () => {
    // The new-guild default: no rung bought, no item slots. The capacity
    // check refuses with the same full-bank line; nothing is minted or lost.
    const sim = makeOfficerSim({ purchasedSlots: 0 });
    sim.addItem('linen_scrap', 1);
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankDepositFor(
      sim.playerId,
      meta(sim).inventory.findIndex((s) => s.itemId === 'linen_scrap'),
    );
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'The guild bank is full.')).toBe(true);
    // The mirror: a withdraw against the empty 0-capacity book is silently
    // inert (no slot exists to name), the out-of-bounds shape arm.
    sim.drainEvents();
    sim.guildBankWithdrawFor(sim.playerId, 0);
    expect(fingerprint(sim)).toBe(before);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('withdraw refuses when the bags are full, mutating nothing', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'linen_scrap', count: 1 });
    const m = meta(sim);
    const cap = bagCapacity(m.bags);
    while (m.inventory.length < cap) {
      m.inventory.push({
        itemId: 'wolf_fang',
        count: 1,
        instance: { signer: `B${m.inventory.length}` },
      });
    }
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankWithdrawFor(sim.playerId, 0);
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'Your bags are full.')).toBe(true);
  });

  it('deposits a partial count, decrements the source, and emits the item notice', () => {
    const sim = makeOfficerSim();
    sim.addItem('wolf_fang', 10);
    sim.drainEvents();
    const idx = meta(sim).inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.guildBankDepositFor(sim.playerId, idx, 4);
    expect(meta(sim).inventory.find((s) => s.itemId === 'wolf_fang')?.count).toBe(6);
    expect(book(sim).inventory).toEqual([{ itemId: 'wolf_fang', count: 4 }]);
    expect(
      hasLog(sim.drainEvents(), `You deposit ${ITEMS.wolf_fang.name} into the guild bank.`),
    ).toBe(true);
  });

  it('withdraws a partial count back into the bags and emits the item notice', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 5 });
    sim.drainEvents();
    sim.guildBankWithdrawFor(sim.playerId, 0, 2);
    expect(book(sim).inventory).toEqual([{ itemId: 'wolf_fang', count: 3 }]);
    expect(meta(sim).inventory.find((s) => s.itemId === 'wolf_fang')?.count).toBe(2);
    expect(
      hasLog(sim.drainEvents(), `You withdraw ${ITEMS.wolf_fang.name} from the guild bank.`),
    ).toBe(true);
  });

  it('an instanced stack moves WHOLE regardless of the requested count (indivisible)', () => {
    const sim = makeOfficerSim();
    const payload = { signer: 'Ana' };
    meta(sim).inventory.push({ itemId: 'wolf_fang', count: 3, instance: { ...payload } });
    const idx = meta(sim).inventory.findIndex((s) => s.instance?.signer === 'Ana');
    sim.guildBankDepositFor(sim.playerId, idx, 1); // partial request: still all 3
    expect(meta(sim).inventory.some((s) => s.instance?.signer === 'Ana')).toBe(false);
    expect(book(sim).inventory).toEqual([{ itemId: 'wolf_fang', count: 3, instance: payload }]);
    sim.guildBankWithdrawFor(sim.playerId, 0, 1); // and back, whole again
    expect(book(sim).inventory).toEqual([]);
    expect(meta(sim).inventory.find((s) => s.instance?.signer === 'Ana')).toEqual({
      itemId: 'wolf_fang',
      count: 3,
      instance: payload,
    });
  });

  it('a plain crafted stack keeps its craftedRecipeId marker across the round trip', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.push({ itemId: 'wolf_fang', count: 2, craftedRecipeId: 'r_test' });
    const idx = meta(sim).inventory.findIndex((s) => s.craftedRecipeId === 'r_test');
    sim.guildBankDepositFor(sim.playerId, idx);
    expect(book(sim).inventory).toEqual([
      { itemId: 'wolf_fang', count: 2, craftedRecipeId: 'r_test' },
    ]);
    sim.guildBankWithdrawFor(sim.playerId, 0);
    expect(book(sim).inventory).toEqual([]);
    expect(meta(sim).inventory.find((s) => s.craftedRecipeId === 'r_test')?.count).toBe(2);
  });
});

describe('guildBankBuySlotsFor', () => {
  it('walks the whole ladder: rung 0 from the PURSE, rungs 1..6 from the treasury', () => {
    const sim = makeOfficerSim({ treasury: 1_925_000, purchasedSlots: 0 }); // unopened
    meta(sim).copper = 90_000; // exactly rung 0's purse price
    sim.drainEvents();
    // Rung 0: opening. The purse pays 9g; the treasury never moves.
    sim.guildBankBuySlotsFor(sim.playerId);
    expect(meta(sim).copper).toBe(0);
    expect(book(sim).treasury).toBe(1_925_000);
    expect(book(sim).purchasedSlots).toBe(24);
    expect(hasLog(sim.drainEvents(), 'You open the guild bank.')).toBe(true);
    // Rungs 1..6: the 192g50s treasury expansions at the literal prices.
    const prices = [25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
    let treasury = 1_925_000;
    for (let rung = 0; rung < prices.length; rung++) {
      sim.guildBankBuySlotsFor(sim.playerId);
      treasury -= prices[rung];
      expect(book(sim).treasury).toBe(treasury);
      expect(book(sim).purchasedSlots).toBe(24 + 6 * (rung + 1));
    }
    expect(book(sim).treasury).toBe(0);
    expect(book(sim).purchasedSlots).toBe(60); // the ladder cap
    // Rungs 1+ are paid from the TREASURY only: the purse never moved again.
    expect(meta(sim).copper).toBe(0);
    expect(hasLog(sim.drainEvents(), 'You purchase additional guild bank slots.')).toBe(true);
  });

  it('rung 0 refuses a purse-poor officer even when the treasury is rich, mutating nothing', () => {
    const sim = makeOfficerSim({ treasury: 10_000_000, purchasedSlots: 0 });
    meta(sim).copper = 89_999; // one copper short of the 9g opening price
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankBuySlotsFor(sim.playerId);
    expect(fingerprint(sim)).toBe(before); // treasury wealth must NOT substitute
    expect(hasErr(sim.drainEvents(), 'Not enough money.')).toBe(true);
  });

  it('rung 0 charges the purse and leaves the treasury untouched on success', () => {
    const sim = makeOfficerSim({ treasury: 555, purchasedSlots: 0 });
    meta(sim).copper = 100_000;
    sim.drainEvents();
    sim.guildBankBuySlotsFor(sim.playerId);
    expect(meta(sim).copper).toBe(10_000); // 100000 - 90000
    expect(book(sim).treasury).toBe(555); // never the treasury
    expect(book(sim).purchasedSlots).toBe(24);
    expect(guildBankCapacity(book(sim))).toBe(24);
    expect(hasLog(sim.drainEvents(), 'You open the guild bank.')).toBe(true);
    // The NEXT purchase is rung 1: treasury-paid at 2g50s.
    expect(guildBankNextExpansionPrice(book(sim))).toBe(25_000);
  });

  it('refuses at the ladder end, mutating nothing', () => {
    const sim = makeOfficerSim({ treasury: 10_000_000, purchasedSlots: 60 });
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankBuySlotsFor(sim.playerId);
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'The guild bank cannot be expanded further.')).toBe(true);
  });

  it('refuses when the treasury cannot afford the table price, mutating nothing', () => {
    const sim = makeOfficerSim({ treasury: 24_999 }); // opened: next is rung 1
    meta(sim).copper = 10_000_000; // personal wealth must NOT substitute
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankBuySlotsFor(sim.playerId);
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'Your guild cannot afford that expansion.')).toBe(true);
  });
});

describe('guildBankInfoFor (the maybe(guildBank) stream read)', () => {
  it('returns the boundary-cloned view for an authorized officer at the banker', () => {
    const sim = makeOfficerSim({ treasury: 12_345, purchasedSlots: 30 });
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 2, instance: { signer: 'Ana' } });
    const info = sim.guildBankInfoFor(sim.playerId);
    expect(info).toEqual({
      treasury: 12_345,
      slots: [{ itemId: 'wolf_fang', count: 2, instance: { signer: 'Ana' } }],
      capacity: 30,
      purchasedSlots: 30,
      nextExpansionPrice: 50_000, // rung-2 literal
    });
    // Boundary clone: mutating the returned view never reaches the live book.
    if (!info) throw new Error('unreachable');
    info.slots[0].count = 99;
    if (info.slots[0].instance) info.slots[0].instance.signer = 'Tampered';
    expect(book(sim).inventory[0].count).toBe(2);
    expect(book(sim).inventory[0].instance?.signer).toBe('Ana');
  });

  it('reports a null nextExpansionPrice once the ladder is exhausted', () => {
    const sim = makeOfficerSim({ purchasedSlots: 60 });
    expect(sim.guildBankInfoFor(sim.playerId)?.nextExpansionPrice).toBeNull();
    expect(sim.guildBankInfoFor(sim.playerId)?.capacity).toBe(60);
  });

  it('reports an UNOPENED bank as 0 capacity with rung 0 as the next price', () => {
    // The client derives the open-the-bank pane from purchasedSlots 0; the
    // treasury still streams (gold ops work from day one).
    const sim = makeOfficerSim({ treasury: 4_242, purchasedSlots: 0 });
    expect(sim.guildBankInfoFor(sim.playerId)).toEqual({
      treasury: 4_242,
      slots: [],
      capacity: 0,
      purchasedSlots: 0,
      nextExpansionPrice: 90_000, // the purse-paid opening price literal
    });
  });

  it('leader sees the bank; member sees null (the officer-plus gate)', () => {
    expect(makeOfficerSim({ rank: 'leader' }).guildBankInfoFor(7_777_777)).toBeNull(); // unknown pid arm
    const leader = makeOfficerSim({ rank: 'leader' });
    expect(leader.guildBankInfoFor(leader.playerId)).not.toBeNull();
    const member = makeOfficerSim({ rank: 'member' });
    expect(member.guildBankInfoFor(member.playerId)).toBeNull();
  });

  it('goes null on walk-away, death, demotion, and leave (the stream transitions)', () => {
    const sim = makeOfficerSim();
    expect(sim.guildBankInfoFor(sim.playerId)).not.toBeNull();
    // walk away, and back
    moveFarFromBankers(sim);
    expect(sim.guildBankInfoFor(sim.playerId)).toBeNull();
    moveToBanker(sim);
    expect(sim.guildBankInfoFor(sim.playerId)).not.toBeNull();
    // death, and revival
    const p = sim.entities.get(sim.playerId);
    if (!p) throw new Error('missing player');
    p.dead = true;
    expect(sim.guildBankInfoFor(sim.playerId)).toBeNull();
    p.dead = false;
    expect(sim.guildBankInfoFor(sim.playerId)).not.toBeNull();
    // demotion (the stale-rank re-stamp), and re-promotion
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'member' });
    expect(sim.guildBankInfoFor(sim.playerId)).toBeNull();
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'officer' });
    expect(sim.guildBankInfoFor(sim.playerId)).not.toBeNull();
    // leave (stamp cleared)
    sim.setPlayerGuildMembership(sim.playerId, null);
    expect(sim.guildBankInfoFor(sim.playerId)).toBeNull();
  });

  it('is null while the guild book is not loaded (never fabricates an empty book)', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: GUILD_BANK_TEST_WORLD,
    });
    moveToBanker(sim);
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'officer' });
    expect(sim.guildBankInfoFor(sim.playerId)).toBeNull();
    expect(sim.guildBanks.size).toBe(0);
  });
});

describe('guild bank authorization: the rank allowlist and per-guild isolation', () => {
  it('exactly leader and officer pass BOTH gates; every other rank fails closed', () => {
    // Swept over GUILD_RANKS itself, so a rank added to the ladder without
    // revisiting the allowlist reddens here instead of silently gaining
    // deposit, withdraw, and treasury-funded expansion purchase. The op gate
    // and the info read are asserted TOGETHER: a drift between them is a
    // phantom window (read yes, ops no) or a leak (ops yes, read no).
    const ALLOWED: readonly GuildRank[] = ['leader', 'officer'];
    for (const rank of GUILD_RANKS) {
      const sim = makeOfficerSim({ rank, treasury: 100_000 });
      meta(sim).copper = 5_000;
      const before = fingerprint(sim);
      sim.drainEvents();
      sim.guildBankDepositGoldFor(sim.playerId, 1_000);
      const opAllowed = fingerprint(sim) !== before;
      const readAllowed = sim.guildBankInfoFor(sim.playerId) !== null;
      expect(opAllowed, `op gate for '${rank}'`).toBe(ALLOWED.includes(rank));
      expect(readAllowed, `info read for '${rank}'`).toBe(ALLOWED.includes(rank));
      expect(opAllowed, `gates agree for '${rank}'`).toBe(readAllowed);
    }
  });

  it('a rank outside the allowlist fails CLOSED, not open (the future-rank arm)', () => {
    // Stands in for a rank added to the ladder later (an initiate tier). The
    // stamp normalizer only admits current GUILD_RANKS, so the future rank is
    // written straight onto the meta, exactly as a later normalizer would.
    // A denylist gate (`rank === 'member'`) would let this through: that is
    // the regression this pins.
    const sim = makeOfficerSim({ treasury: 100_000 });
    meta(sim).copper = 5_000;
    meta(sim).guildMembership = { guildId: GUILD_ID, rank: 'initiate' as GuildRank };
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankDepositGoldFor(sim.playerId, 1_000);
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'Only guild officers may use the guild bank.')).toBe(true);
    expect(sim.guildBankInfoFor(sim.playerId)).toBeNull();
  });

  it('an officer of one guild can never read or mutate another guild book', () => {
    // The gate must key the book on the STAMPED guild id, not "the only book
    // loaded": with two live books a lookup that ignored m.guildId would let
    // an officer of 7 drain 8's treasury.
    // The OTHER guild's book is loaded FIRST, so a lookup that grabbed "the
    // first loaded book" instead of the stamped one would resolve to it.
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: false,
      world: GUILD_BANK_TEST_WORLD,
    });
    moveToBanker(sim);
    const OTHER_GUILD = GUILD_ID + 1;
    sim.loadGuildBank(OTHER_GUILD, {
      treasury: 777_000,
      inventory: [{ itemId: 'wolf_fang', count: 9 }],
      purchasedSlots: 30,
    });
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'officer' });
    sim.loadGuildBank(GUILD_ID, { treasury: 100_000, inventory: [], purchasedSlots: 24 });
    const otherBefore = JSON.stringify(sim.guildBanks.get(OTHER_GUILD));
    meta(sim).copper = 5_000;
    sim.drainEvents();
    sim.guildBankDepositGoldFor(sim.playerId, 1_000);
    sim.guildBankWithdrawGoldFor(sim.playerId, 500);
    sim.guildBankBuySlotsFor(sim.playerId);
    // Every mutation landed in the stamped guild's book; the other is untouched.
    expect(JSON.stringify(sim.guildBanks.get(OTHER_GUILD))).toBe(otherBefore);
    expect(book(sim).treasury).toBe(100_000 + 1_000 - 500 - 25_000);
    // And the read reports the stamped guild's book, never the other's.
    const info = sim.guildBankInfoFor(sim.playerId);
    expect(info?.treasury).toBe(75_500);
    expect(info?.slots).toEqual([]);
  });

  it('a locked copy in a tampered book is projected, never broadcast whole', () => {
    // Deposits keep locked copies out, so only a tampered/legacy Phase 3 row
    // holds one. It is unwithdrawable, so the read must not ship another
    // character's bind identity (boundTo / armed bindOnTrade) to every
    // officer; cosmetic fields survive, and an ALLOWED copy keeps its full
    // payload (a withdrawer needs charges).
    const sim = makeOfficerSim();
    book(sim).inventory.push(
      {
        itemId: 'wolf_fang',
        count: 1,
        instance: { boundTo: 424242, signer: 'Aleph', charges: { zap: 3 } },
      },
      { itemId: 'wolf_fang', count: 1, instance: { bindOnTrade: true, enchant: 'minor_haste' } },
      { itemId: 'wolf_fang', count: 1, instance: { charges: { zap: 5 }, signer: 'Bet' } },
    );
    const info = sim.guildBankInfoFor(sim.playerId);
    expect(info?.slots[0].instance).toEqual({ signer: 'Aleph' }); // boundTo + charges stripped
    expect(info?.slots[1].instance).toEqual({ enchant: 'minor_haste' }); // bindOnTrade stripped
    expect(info?.slots[2].instance).toEqual({ charges: { zap: 5 }, signer: 'Bet' }); // allowed: full payload
    // And the projection never mutated the book itself.
    expect(book(sim).inventory[0].instance).toEqual({
      boundTo: 424242,
      signer: 'Aleph',
      charges: { zap: 3 },
    });
  });
});

describe('guild bank ops: the stale-rank scenario and determinism', () => {
  it('a demote landing mid-session gates the very next op and nulls the stream', () => {
    const sim = makeOfficerSim({ treasury: 10_000 });
    meta(sim).copper = 5_000;
    sim.drainEvents();
    sim.guildBankDepositGoldFor(sim.playerId, 1_000);
    expect(book(sim).treasury).toBe(11_000); // authorized while officer
    // The server re-stamps on demote (the onGuildMembershipChanged hook):
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'member' });
    sim.drainEvents();
    sim.guildBankDepositGoldFor(sim.playerId, 1_000);
    expect(book(sim).treasury).toBe(11_000); // the NEXT op is already refused
    expect(hasErr(sim.drainEvents(), 'Only guild officers may use the guild bank.')).toBe(true);
    expect(sim.guildBankInfoFor(sim.playerId)).toBeNull();
  });

  it('the whole Phase 2 op surface draws NO rng (determinism)', () => {
    const sim = makeOfficerSim({ treasury: 100_000 });
    meta(sim).copper = 50_000;
    sim.addItem('wolf_fang', 5);
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.rng.next();
    expect(draws).toBe(1); // positive control
    draws = 0;
    sim.guildBankDepositGoldFor(sim.playerId, 1_000);
    sim.guildBankWithdrawGoldFor(sim.playerId, 500);
    const idx = meta(sim).inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.guildBankDepositFor(sim.playerId, idx, 2);
    sim.guildBankWithdrawFor(sim.playerId, 0, 1);
    sim.guildBankBuySlotsFor(sim.playerId);
    sim.guildBankInfoFor(sim.playerId);
    // And a refusal from every dimension family:
    sim.guildBankDepositGoldFor(sim.playerId, 10 ** 12);
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'member' });
    sim.guildBankBuySlotsFor(sim.playerId);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: the persistence-facing sim helpers the server wires up (the evict,
// the disband-guard holdings read, and the reserve-at-gate fee charge/refund).
// The SQL side lives in server/db.ts and is pinned in the server suites.
// ---------------------------------------------------------------------------

describe('evictGuildBank (the sanctioned evict) + guildBankHoldings', () => {
  it('evict drops the book, releases load-once, and a reload sees fresh data', () => {
    const sim = makeOfficerSim({ treasury: 7_000 });
    expect(sim.guildBanks.has(GUILD_ID)).toBe(true);
    // Load-once: while live, a reload attempt is skipped (unflushed deposits).
    sim.loadGuildBank(GUILD_ID, { treasury: 1, inventory: [], purchasedSlots: 0 });
    expect(book(sim).treasury).toBe(7_000);
    sim.evictGuildBank(GUILD_ID);
    expect(sim.guildBanks.has(GUILD_ID)).toBe(false);
    // Evict-then-load is the reload path: the fresh row now seats.
    sim.loadGuildBank(GUILD_ID, { treasury: 1, inventory: [], purchasedSlots: 0 });
    expect(book(sim).treasury).toBe(1);
    // A re-created guild id never inherits a stale book: evicting again leaves
    // the map empty until the server loads or seeds a new (empty) book.
    sim.evictGuildBank(GUILD_ID);
    expect(sim.guildBanks.size).toBe(0);
    expect(() => sim.evictGuildBank(GUILD_ID)).not.toThrow(); // idempotent
  });

  it('holdings reports the live copper and item count, and null with no book', () => {
    const sim = makeOfficerSim({ treasury: 300 });
    sim.addItem('wolf_fang', 3);
    const idx = meta(sim).inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.guildBankDepositFor(sim.playerId, idx, 3);
    expect(sim.guildBankHoldings(GUILD_ID)).toEqual({ copper: 300, items: 1 });
    // An empty book reports zeros (a disband may proceed). The no-row empty
    // book IS the UNOPENED bank (purchasedSlots 0): an unopened bank with no
    // treasury must never block a disband (the guard counts copper and items
    // only, never the bought rungs).
    sim.evictGuildBank(GUILD_ID);
    sim.loadGuildBank(GUILD_ID, null);
    expect(sim.guildBanks.get(GUILD_ID)?.purchasedSlots).toBe(0); // unopened
    expect(sim.guildBankHoldings(GUILD_ID)).toEqual({ copper: 0, items: 0 });
    // ...but NO book is null, which the server treats as fail-closed: an
    // unloaded book cannot prove the DB row is empty.
    sim.evictGuildBank(GUILD_ID);
    expect(sim.guildBankHoldings(GUILD_ID)).toBeNull();
    expect(sim.guildBankHoldings(999)).toBeNull();
  });

  it('holdings is a pure read: it never mutates the book or creates one', () => {
    const sim = makeOfficerSim({ treasury: 55 });
    const before = fingerprint(sim);
    sim.guildBankHoldings(GUILD_ID);
    sim.guildBankHoldings(12345); // absent guild: must not lazily create a book
    expect(fingerprint(sim)).toBe(before);
    expect(sim.guildBanks.has(12345)).toBe(false);
  });
});

describe('chargeGuildCreationFeeFor (reserve-at-gate, the sim half)', () => {
  it('charges exactly the fee once when the purse covers it', () => {
    const sim = freshSim();
    meta(sim).copper = 150_000;
    expect(sim.chargeGuildCreationFeeFor(sim.playerId)).toBe(10_000); // 1g, pinned literal
    expect(meta(sim).copper).toBe(140_000);
  });

  it('clamps to the purse on a shortfall (never negative); the GATE refuses a short charge', () => {
    // The dispatch gate checks the purse and charges in the same synchronous
    // block, refusing (and refunding) when the charge comes back short, so
    // the clamp here is defensive only.
    const sim = freshSim();
    meta(sim).copper = 4_000;
    expect(sim.chargeGuildCreationFeeFor(sim.playerId)).toBe(4_000);
    expect(meta(sim).copper).toBe(0);
    // Nothing left charges nothing (and stays at zero, never negative).
    expect(sim.chargeGuildCreationFeeFor(sim.playerId)).toBe(0);
    expect(meta(sim).copper).toBe(0);
  });

  it('an unresolvable pid charges nothing and never throws', () => {
    const sim = freshSim();
    expect(sim.chargeGuildCreationFeeFor(999999)).toBe(0);
    expect(sim.chargeGuildCreationFeeFor(Number.NaN)).toBe(0);
  });

  it('charging draws no rng and emits no player line (silent by design)', () => {
    const sim = freshSim();
    meta(sim).copper = 200_000;
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.chargeGuildCreationFeeFor(sim.playerId);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(sim.drainEvents().filter((e) => e.type === 'error' || e.type === 'log')).toEqual([]);
  });
});

describe('refundGuildCreationFeeFor (the reserve-at-gate refusal arm)', () => {
  it('returns exactly the reserved fee to the purse', () => {
    const sim = freshSim();
    meta(sim).copper = 150_000;
    const charged = sim.chargeGuildCreationFeeFor(sim.playerId);
    expect(charged).toBe(10_000);
    expect(meta(sim).copper).toBe(140_000);
    expect(sim.refundGuildCreationFeeFor(sim.playerId, charged)).toBe(10_000);
    expect(meta(sim).copper).toBe(150_000);
  });

  it('refuses malformed amounts and clamps at the integer-safe purse bound', () => {
    const sim = freshSim();
    meta(sim).copper = 500;
    expect(sim.refundGuildCreationFeeFor(sim.playerId, 0)).toBe(0);
    expect(sim.refundGuildCreationFeeFor(sim.playerId, -5)).toBe(0);
    expect(sim.refundGuildCreationFeeFor(sim.playerId, 1.5)).toBe(0);
    expect(sim.refundGuildCreationFeeFor(sim.playerId, Number.NaN)).toBe(0);
    expect(meta(sim).copper).toBe(500);
    meta(sim).copper = Number.MAX_SAFE_INTEGER - 10;
    expect(sim.refundGuildCreationFeeFor(sim.playerId, 100)).toBe(10);
    expect(meta(sim).copper).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('an unresolvable pid refunds nothing, and refunding draws no rng and emits nothing', () => {
    const sim = freshSim();
    expect(sim.refundGuildCreationFeeFor(999999, 100)).toBe(0);
    meta(sim).copper = 100;
    sim.drainEvents();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.refundGuildCreationFeeFor(sim.playerId, 50);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(sim.drainEvents().filter((e) => e.type === 'error' || e.type === 'log')).toEqual([]);
  });
});

/** Ladder rung 0 as the dispatch observer records it: ABSOLUTE (0 -> 24), so
 *  the forward replay is "raise to at least 24" and the inverse is a
 *  compare-and-swap against 24. */
const OPEN_DELTA: GuildBankOpDelta = {
  op: 'open_bank',
  itemId: null,
  count: null,
  instance: null,
  copperDelta: -90_000,
  purchasedSlotsBefore: 0,
  purchasedSlotsAfter: 24,
};

describe('revertGuildBankDeltas (the unflushable-session surgical undo)', () => {
  const gold = (op: 'deposit_gold' | 'withdraw_gold', copperDelta: number) => ({
    op,
    itemId: null,
    count: null,
    instance: null,
    copperDelta,
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 0,
  });

  it('undoes gold deltas in both directions, leaving other unflushed value intact', () => {
    const sim = makeOfficerSim({ treasury: 50_000 });
    // The live book carries the dead session's +20_000 deposit AND another
    // officer's +5_000 (which must survive the revert).
    book(sim).treasury = 75_000;
    sim.revertGuildBankDeltas(GUILD_ID, [gold('deposit_gold', 20_000)]);
    expect(book(sim).treasury).toBe(55_000);
    // A reverted withdrawal puts the copper back.
    sim.revertGuildBankDeltas(GUILD_ID, [gold('withdraw_gold', -5_000)]);
    expect(book(sim).treasury).toBe(60_000);
  });

  it('clamps rather than tearing when the value was already consumed (the residue)', () => {
    const sim = makeOfficerSim({ treasury: 1_000 });
    // The dead session deposited 20_000, but another officer already withdrew
    // it: the inverse clamps at zero instead of going negative.
    sim.revertGuildBankDeltas(GUILD_ID, [gold('deposit_gold', 20_000)]);
    expect(book(sim).treasury).toBe(0);
  });

  it('undoes an item deposit by removing the matching copies, and a withdraw by restoring them', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 5 });
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'wolf_fang',
        count: 3,
        instance: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(book(sim).inventory).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    // Reverting a withdraw restores the copy WITH its craft provenance.
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'withdraw',
        itemId: 'iron_sword',
        count: 1,
        instance: null,
        craftedRecipeId: 'smith_iron_sword',
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(book(sim).inventory).toContainEqual({
      itemId: 'iron_sword',
      count: 1,
      craftedRecipeId: 'smith_iron_sword',
    });
    // A missing copy no-ops (already withdrawn by another officer): nothing
    // else is disturbed and nothing goes negative.
    const before = JSON.stringify(book(sim));
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'never_deposited',
        count: 2,
        instance: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(JSON.stringify(book(sim))).toBe(before);
  });

  it('matches instanced copies by payload, never collapsing distinct instances', () => {
    const sim = makeOfficerSim();
    const armed = { charges: { arcane: 3 } };
    const other = { charges: { arcane: 1 } };
    book(sim).inventory.push(
      { itemId: 'mana_prism', count: 1, instance: structuredClone(armed) },
      { itemId: 'mana_prism', count: 1, instance: structuredClone(other) },
    );
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'mana_prism',
        count: 1,
        instance: structuredClone(armed),
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    // Only the matching payload was removed; the other copy survives.
    expect(book(sim).inventory).toEqual([{ itemId: 'mana_prism', count: 1, instance: other }]);
  });

  it('undoes buy_slots as ONE compare-and-swap: slots and price move together or not at all', () => {
    const sim = makeOfficerSim({ treasury: 10_000, purchasedSlots: 30 });
    const expansion = {
      op: 'buy_slots' as const,
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -25_000,
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 30,
    };
    sim.revertGuildBankDeltas(GUILD_ID, [expansion]);
    expect(book(sim).purchasedSlots).toBe(24);
    expect(book(sim).treasury).toBe(35_000);
    // Replaying the same undo against a ladder that no longer stands where
    // this op left it must move NOTHING. An unconditional refund here was the
    // audit finding: the guild kept the slots AND got the copper back, minting
    // the rung price out of nothing.
    sim.revertGuildBankDeltas(GUILD_ID, [expansion]);
    expect(book(sim).purchasedSlots).toBe(24);
    expect(book(sim).treasury).toBe(35_000);
  });

  it('undoes open_bank (rung 0): the slot grant reverts, the treasury NEVER moves', () => {
    // Rung 0 was purse-paid, and the dead session's character half (holding
    // the purse charge) rolled back on its own: crediting the treasury here
    // would mint guild copper out of thin air.
    const sim = makeOfficerSim({ treasury: 10_000, purchasedSlots: 24 });
    sim.revertGuildBankDeltas(GUILD_ID, [OPEN_DELTA]);
    expect(book(sim).purchasedSlots).toBe(0); // unopened again
    expect(book(sim).treasury).toBe(10_000); // untouched
    // Against an already-unopened book the compare-and-swap misses: nothing
    // moves, and the ladder never goes negative.
    sim.revertGuildBankDeltas(GUILD_ID, [OPEN_DELTA]);
    expect(book(sim).purchasedSlots).toBe(0);
    expect(book(sim).treasury).toBe(10_000);
  });

  it('an open_bank revert after ANOTHER session expanded never strands a non-ladder position', () => {
    // The cross-session race: the dead session opened (0 -> 24), a live
    // session bought an expansion (24 -> 30), then the dead session's
    // open_bank delta reverts. Subtracting the 24-slot base would leave 6 (a
    // non-position: capacity collapses to 0 and the paid expansion is
    // destroyed); the guard leaves the grant in place instead (the
    // clamped-residue contract) and the treasury never moves.
    const sim = makeOfficerSim({ treasury: 40_000, purchasedSlots: 0 });
    meta(sim).copper = 90_000;
    sim.guildBankBuySlotsFor(sim.playerId); // open: 0 -> 24 (purse)
    sim.guildBankBuySlotsFor(sim.playerId); // expand: 24 -> 30 (treasury 40k - 25k)
    expect(book(sim).purchasedSlots).toBe(30);
    expect(book(sim).treasury).toBe(15_000);
    sim.revertGuildBankDeltas(GUILD_ID, [OPEN_DELTA]);
    expect(GUILD_BANK_LADDER_POSITIONS).toContain(book(sim).purchasedSlots); // valid position
    expect(book(sim).purchasedSlots).toBe(30); // the grant stays: nothing destroyed
    expect(guildBankCapacity(book(sim))).toBe(30);
    expect(book(sim).treasury).toBe(15_000); // untouched either way
  });

  it('reverts newest-first over a mixed batch, draws no rng, and no-ops on an absent book', () => {
    const sim = makeOfficerSim({ treasury: 10_000 });
    sim.addItem('wolf_fang', 2);
    const idx = meta(sim).inventory.findIndex((s) => s.itemId === 'wolf_fang');
    sim.guildBankDepositFor(sim.playerId, idx, 2);
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'wolf_fang',
        count: 2,
        instance: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
    expect(book(sim).inventory).toEqual([]);
    // Absent book: nothing to revert, nothing throws, nothing created.
    sim.evictGuildBank(GUILD_ID);
    expect(() => sim.revertGuildBankDeltas(GUILD_ID, [gold('deposit_gold', 1_000)])).not.toThrow();
    expect(sim.guildBanks.has(GUILD_ID)).toBe(false);
  });
});

describe('revertGuildBankDeltas: provenance, canonical payloads, and stack caps', () => {
  it('a plain-copy revert never removes a crafted copy of the same item (and vice versa)', () => {
    // The book legitimately holds crafted and plain copies of one item as
    // separate slots (addStacked keys its merge on craftedRecipeId). A revert
    // that ignored the third dimension would scan newest-first and destroy
    // another officer's durable crafted provenance.
    const sim = makeOfficerSim();
    book(sim).inventory.push(
      { itemId: 'iron_sword', count: 2 },
      { itemId: 'iron_sword', count: 1, craftedRecipeId: 'smith_iron_sword' },
    );
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'iron_sword',
        count: 1,
        instance: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    // The plain stack shrank; the crafted copy is untouched.
    expect(book(sim).inventory).toEqual([
      { itemId: 'iron_sword', count: 1 },
      { itemId: 'iron_sword', count: 1, craftedRecipeId: 'smith_iron_sword' },
    ]);
    // The mirror: a crafted-copy revert leaves the plain stack alone.
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'iron_sword',
        count: 1,
        instance: null,
        craftedRecipeId: 'smith_iron_sword',
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(book(sim).inventory).toEqual([{ itemId: 'iron_sword', count: 1 }]);
  });

  it('matches an instanced payload whose keys were reordered by a JSONB round trip', () => {
    // Postgres JSONB does not preserve object key order: after the
    // evict-and-reload arm, the live slot's payload may serialize with a
    // different key order than the delta's pre-reload clone. The canonical
    // (sorted-key) match must still find the copy; raw JSON.stringify
    // equality would silently no-op the revert and resurrect the dupe.
    const sim = makeOfficerSim();
    const reordered = JSON.parse('{"charges":{"arcane":2},"bindOnTrade":false}');
    book(sim).inventory.push({ itemId: 'mana_prism', count: 1, instance: reordered });
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'mana_prism',
        count: 1,
        instance: JSON.parse('{"bindOnTrade":false,"charges":{"arcane":2}}'),
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(book(sim).inventory).toEqual([]);
  });

  it('treats an UNDEFINED-valued payload key as absent, like the durable side does', () => {
    // The other half of the JSONB round trip, and the divergence class the
    // review found: JSON.stringify OMITS an undefined-valued key, so the
    // durable clone of `{ signer: 'Ana', enchantId: undefined }` comes back as
    // `{ signer: 'Ana' }`. A predicate that distinguished them would make a
    // live payload compare unequal to its own durable clone, which reports a
    // spurious deficit and refuses that session's escrow save forever.
    const sim = makeOfficerSim();
    const live = { signer: 'Ana', enchantId: undefined } as unknown as InvSlot['instance'];
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 1, instance: live });
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'deposit',
        itemId: 'wolf_fang',
        count: 1,
        // What Postgres actually hands back for the payload above.
        instance: JSON.parse('{"signer":"Ana"}'),
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    expect(book(sim).inventory).toEqual([]);

    // The same equality feeds the netting identity key the log compactor uses,
    // so pin it there too rather than only through the revert.
    const delta = (instance: unknown): GuildBankOpDelta => ({
      op: 'deposit',
      itemId: 'wolf_fang',
      count: 1,
      instance: instance as InvSlot['instance'],
      craftedRecipeId: null,
      copperDelta: 0,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
    expect(guildBankDeltaIdentityKey(delta({ signer: 'Ana', enchantId: undefined }))).toBe(
      guildBankDeltaIdentityKey(delta(JSON.parse('{"signer":"Ana"}'))),
    );
    // Decisive negative: a DIFFERENT payload still keys differently.
    expect(guildBankDeltaIdentityKey(delta({ signer: 'Ana' }))).not.toBe(
      guildBankDeltaIdentityKey(delta({ signer: 'Bru' })),
    );
  });

  it('a withdraw-undo respects the per-item stack cap (grants through addStacked)', () => {
    // The revert must not mint an over-stacked slot no legitimate path can
    // produce: the book contract tolerates over-CAPACITY, never over-STACK.
    const sim = makeOfficerSim();
    const stack = stackSizeOf(ITEMS.wolf_fang);
    expect(stack).toBeGreaterThan(1);
    expect(Number.isFinite(stack)).toBe(true);
    book(sim).inventory.push({ itemId: 'wolf_fang', count: stack - 1 });
    sim.revertGuildBankDeltas(GUILD_ID, [
      {
        op: 'withdraw',
        itemId: 'wolf_fang',
        count: 3,
        instance: null,
        copperDelta: 0,
        purchasedSlotsBefore: 0,
        purchasedSlotsAfter: 0,
      },
    ]);
    const counts = book(sim).inventory.map((s) => s.count);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(stack + 2);
    for (const c of counts) expect(c).toBeLessThanOrEqual(stack);
  });

  it('evictGuildBank draws no rng (completing the module-wide zero-rng sweep)', () => {
    const sim = makeOfficerSim();
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.evictGuildBank(GUILD_ID);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The forward/inverse delta pair (the escrow root fix). applyGuildBankDeltasTo
// is the escrow save's payload builder ("durable truth plus this session's own
// deltas") and revertGuildBankDeltasTo is its exact inverse on the live book.
// They must never drift apart, so the identity is pinned as a PROPERTY over a
// generated corpus rather than a handful of cases.
// ---------------------------------------------------------------------------
describe('applyGuildBankDeltasTo / revertGuildBankDeltasTo (the forward + inverse pair)', () => {
  // Deterministic harness randomness (mulberry32): the sim itself draws no rng
  // here, and a failure replays exactly from its printed seed.
  const rngFor = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const ITEM_IDS = ['wolf_fang', 'copper_ore', 'iron_sword'];
  const RECIPES = [undefined, 'smith_iron_sword'];
  // A mergeable payload (identical-payload stacking) and a charge-bearing one
  // (one copy per slot, bags.ts instancedCountCap), so the corpus covers both
  // grant shapes addStacked can take.
  const PAYLOADS: (InvSlot['instance'] | null)[] = [
    null,
    { signer: 'Ana' },
    { charges: { arcane: 2 } },
  ];
  // A charge-bearing copy is one-per-slot by construction: generating a
  // stacked one would build a book no legitimate path can produce.
  const capFor = (payload: InvSlot['instance'] | null | undefined, want: number) =>
    payload && 'charges' in (payload as Record<string, unknown>) ? 1 : want;

  /** A book's CONSERVED content: treasury, ladder position, and the item
   *  multiset summed per (itemId, canonical payload, craft provenance). Slot
   *  LAYOUT is deliberately excluded: addStacked appends, so a remove-then-
   *  restore cycle legitimately reorders slots and splits a charge-bearing
   *  grant one copy per slot. Conservation is what the pair owes. */
  const fingerprint = (b: GuildBankState): string => {
    const m = new Map<string, number>();
    for (const s of b.inventory) {
      const key = `${s.itemId}|${JSON.stringify(s.instance ?? null)}|${s.craftedRecipeId ?? ''}`;
      m.set(key, (m.get(key) ?? 0) + s.count);
    }
    return JSON.stringify([b.treasury, b.purchasedSlots, [...m.entries()].sort()]);
  };

  function genBook(rnd: () => number): GuildBankState {
    const rung = Math.floor(rnd() * GUILD_BANK_LADDER_POSITIONS.length);
    const inventory: InvSlot[] = [];
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const payload = PAYLOADS[Math.floor(rnd() * PAYLOADS.length)];
      const slot: InvSlot = {
        itemId: ITEM_IDS[Math.floor(rnd() * ITEM_IDS.length)],
        count: capFor(payload, 1 + Math.floor(rnd() * 5)),
      };
      if (payload) slot.instance = clone(payload);
      const recipe = RECIPES[Math.floor(rnd() * RECIPES.length)];
      if (recipe) slot.craftedRecipeId = recipe;
      inventory.push(slot);
    }
    return {
      treasury: Math.floor(rnd() * 200_000),
      inventory,
      purchasedSlots: GUILD_BANK_LADDER_POSITIONS[rung],
    };
  }

  function genDelta(rnd: () => number, book: GuildBankState): GuildBankOpDelta {
    const roll = rnd();
    const base: GuildBankOpDelta = {
      op: 'deposit_gold',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: 0,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    };
    if (roll < 0.25) {
      return { ...base, op: 'deposit_gold', copperDelta: 1 + Math.floor(rnd() * 50_000) };
    }
    if (roll < 0.4) {
      return { ...base, op: 'withdraw_gold', copperDelta: -(1 + Math.floor(rnd() * 50_000)) };
    }
    if (roll < 0.65) {
      const payload = PAYLOADS[Math.floor(rnd() * PAYLOADS.length)];
      return {
        ...base,
        op: 'deposit',
        itemId: ITEM_IDS[Math.floor(rnd() * ITEM_IDS.length)],
        count: capFor(payload, 1 + Math.floor(rnd() * 4)),
        instance: payload ? clone(payload) : null,
        craftedRecipeId: RECIPES[Math.floor(rnd() * RECIPES.length)] ?? null,
      };
    }
    if (roll < 0.85) {
      // Withdraw an identity the book actually holds, so the forward replay
      // has something to remove (a missing copy is the DEFICIT arm, covered
      // separately below). A share of these are the OPERATOR removal
      // (admin_purge), which the machinery must treat exactly like a withdraw:
      // generating it here puts it under the whole forward/inverse identity
      // property rather than under one hand-written case.
      const slot = book.inventory[Math.floor(rnd() * book.inventory.length)];
      const removal = rnd() < 0.25 ? 'admin_purge' : 'withdraw';
      if (!slot) return { ...base, op: 'deposit_gold', copperDelta: 1 };
      return {
        ...base,
        op: removal,
        itemId: slot.itemId,
        count: 1 + Math.floor(rnd() * slot.count),
        instance: slot.instance ? clone(slot.instance) : null,
        craftedRecipeId: slot.craftedRecipeId ?? null,
      };
    }
    // A ladder step from wherever the book stands, recorded ABSOLUTELY.
    const rung = guildBankRungsBought(book.purchasedSlots);
    if (rung >= GUILD_BANK_RUNG_PRICES.length) {
      return { ...base, op: 'deposit_gold', copperDelta: 1 };
    }
    const before = GUILD_BANK_LADDER_POSITIONS[rung];
    const after = GUILD_BANK_LADDER_POSITIONS[rung + 1];
    return {
      ...base,
      op: rung === 0 ? 'open_bank' : 'buy_slots',
      copperDelta: rung === 0 ? -GUILD_BANK_RUNG_PRICES[0] : -GUILD_BANK_RUNG_PRICES[rung],
      purchasedSlotsBefore: before,
      purchasedSlotsAfter: after,
    };
  }

  it('apply then revert is the IDENTITY on an arbitrary book and delta list', () => {
    let checked = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = rngFor(seed);
      const book = genBook(rnd);
      const original = clone(book);
      const deltas: GuildBankOpDelta[] = [];
      const probe = clone(book);
      const n = 1 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const d = genDelta(rnd, probe);
        // Build the list against a running book so each delta's ladder
        // witness and item identities are the ones a real op would record.
        if (applyGuildBankDeltasTo(probe, [d]) !== null) break;
        deltas.push(d);
      }
      if (deltas.length === 0) continue;
      const forward = clone(book);
      // The deficit arm is all-or-nothing (the caller discards the partially
      // mutated copy), so the identity only claims anything about clean
      // replays; the deficit itself is pinned decisively below.
      if (applyGuildBankDeltasTo(forward, deltas) !== null) continue;
      revertGuildBankDeltasTo(forward, deltas);
      checked++;
      expect(`seed ${seed}: ${fingerprint(forward)}`).toBe(
        `seed ${seed}: ${fingerprint(original)}`,
      );
    }
    // The property is only worth what it covered.
    expect(checked).toBeGreaterThan(200);
  });

  it('a ladder step replays ONLY onto the base its witness names, in both directions', () => {
    // The forward and the inverse run the SAME compare-and-swap against the
    // delta's own before/after witness, which is what makes them exact
    // inverses on any base rather than only on the one the delta came from.
    // A base that is not where the op left it moves NOTHING either way: a
    // forward raise from a lower base would grant rungs durable truth cannot
    // justify, and a forward charge onto a higher base would take treasury
    // copper the inverse then declines to give back.
    const expansion: GuildBankOpDelta = {
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -GUILD_BANK_RUNG_PRICES[1],
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 30,
    };
    for (const at of [0, 30, 36, 60]) {
      const book: GuildBankState = { treasury: 100_000, inventory: [], purchasedSlots: at };
      expect(`at ${at}: ${applyGuildBankDeltasTo(book, [expansion])?.kind}`).toBe(
        `at ${at}: ladder_behind`,
      );
      expect(`at ${at}: ${book.purchasedSlots}/${book.treasury}`).toBe(`at ${at}: ${at}/100000`);
      // ...and the inverse declines on exactly the same bases.
      revertGuildBankDeltasTo(book, [expansion]);
      expect(`at ${at} undone: ${book.purchasedSlots}/${book.treasury}`).toBe(
        at === 30 ? 'at 30 undone: 24/125000' : `at ${at} undone: ${at}/100000`,
      );
    }
    // On the base the witness names, both directions move, and the round trip
    // is the identity.
    const exact: GuildBankState = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    expect(applyGuildBankDeltasTo(exact, [expansion])).toBeNull();
    expect(exact).toEqual({ treasury: 75_000, inventory: [], purchasedSlots: 30 });
    revertGuildBankDeltasTo(exact, [expansion]);
    expect(exact).toEqual({ treasury: 100_000, inventory: [], purchasedSlots: 24 });
  });

  it('a rung is NEVER granted without its charge (all-or-nothing, unlike gold)', () => {
    // Granting the ladder while the treasury cannot cover the price would put
    // a FREE rung in durable truth, and if the session then died the charge
    // would never arrive. The gold arm carries a residual instead; the slot
    // arm waits.
    const expansion: GuildBankOpDelta = {
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -GUILD_BANK_RUNG_PRICES[1],
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 30,
    };
    for (const treasury of [0, 1, GUILD_BANK_RUNG_PRICES[1] - 1]) {
      const book: GuildBankState = { treasury, inventory: [], purchasedSlots: 24 };
      const r = applyGuildBankDeltasTo(book, [expansion]);
      expect(`treasury ${treasury}: ${r?.kind}`).toBe(`treasury ${treasury}: treasury_underflow`);
      expect(book.purchasedSlots).toBe(24); // no free rung
      expect(book.treasury).toBe(treasury); // and no partial charge
    }
  });

  it('the NETTED replay reaches the same book as the ordered one, open_bank included', () => {
    // netGuildBankOpLogForReplay is the escrow merge's fallback when the
    // ordered replay stalls on a cross-session ordering artifact, so it must
    // land on exactly the book the ordered replay would. The trap it exists to
    // avoid: rung 0 carries the officer's PURSE price as its copperDelta and
    // the applier never moves it, so netting that number in would destroy
    // 90_000 copper on every netted replay of a log containing an opening.
    const gold = (copperDelta: number): GuildBankOpDelta => ({
      op: copperDelta > 0 ? 'deposit_gold' : 'withdraw_gold',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
    const item = (op: 'deposit' | 'withdraw', count: number): GuildBankOpDelta => ({
      op,
      itemId: 'wolf_fang',
      count,
      instance: null,
      craftedRecipeId: null,
      copperDelta: 0,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
    const open: GuildBankOpDelta = {
      op: 'open_bank',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -GUILD_BANK_RUNG_PRICES[0],
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 24,
    };
    const expand: GuildBankOpDelta = {
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -GUILD_BANK_RUNG_PRICES[1],
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 30,
    };
    const logs: GuildBankOpDelta[][] = [
      [gold(-150_000), gold(300_000), open],
      [open, gold(300_000), expand, item('deposit', 4), item('withdraw', 1)],
      [gold(50_000), item('deposit', 3), gold(-20_000), item('withdraw', 2)],
      [open, expand],
    ];
    const base = (): GuildBankState => ({
      treasury: 200_000,
      inventory: [{ itemId: 'wolf_fang', count: 2 }],
      purchasedSlots: 0,
    });
    for (const log of logs) {
      const ordered = base();
      const netted = base();
      const a = applyGuildBankDeltasTo(ordered, log);
      const b = applyGuildBankDeltasTo(netted, netGuildBankOpLogForReplay(log));
      const tag = log.map((d) => d.op).join(',');
      expect(`${tag}: ${a?.kind ?? 'ok'}`).toBe(`${tag}: ok`);
      expect(`${tag}: ${b?.kind ?? 'ok'}`).toBe(`${tag}: ok`);
      expect(`${tag}: ${fingerprint(netted)}`).toBe(`${tag}: ${fingerprint(ordered)}`);
    }
    // Decisively, on the exact shape the trap needs: 200_000 - 150_000 +
    // 300_000 = 350_000, and rung 0's 90_000 purse price is NOT among the
    // numbers the book moves. Netting it in would write 260_000 here.
    const netted = base();
    expect(applyGuildBankDeltasTo(netted, netGuildBankOpLogForReplay(logs[0]))).toBeNull();
    expect(netted.treasury).toBe(350_000);
    expect(netted.purchasedSlots).toBe(24);
    // And the netted form ORDERS the single gold move last, which is the whole
    // point: the ordered replay of this same log stalls on the intermediate
    // dip below zero when the base is smaller.
    const small: GuildBankState = { treasury: 100_000, inventory: [], purchasedSlots: 0 };
    expect(applyGuildBankDeltasTo({ ...small, inventory: [] }, logs[0])?.kind).toBe(
      'treasury_underflow',
    );
    expect(applyGuildBankDeltasTo(small, netGuildBankOpLogForReplay(logs[0]))).toBeNull();
    expect(small.treasury).toBe(250_000);
  });

  it('an admin_purge is a REMOVAL in the netted replay, never a dropped delta', () => {
    // The netted form is the escrow merge's rescue path, so a delta it drops
    // is one the durable row silently keeps while the live book no longer has
    // it. The operator purge is exactly the delta most likely to be forgotten
    // here, because it is the only removal a player never dispatched.
    const purge = (count: number): GuildBankOpDelta => ({
      op: 'admin_purge',
      itemId: 'wolf_fang',
      count,
      instance: { boundTo: 7 },
      craftedRecipeId: null,
      copperDelta: 0,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    });
    const deposit = (count: number): GuildBankOpDelta => ({ ...purge(count), op: 'deposit' });
    const base = (): GuildBankState => ({
      treasury: 10_000,
      inventory: [{ itemId: 'wolf_fang', count: 3, instance: { boundTo: 7 } }],
      purchasedSlots: 24,
    });
    // A lone purge survives netting and removes exactly its copies.
    const netted = base();
    expect(applyGuildBankDeltasTo(netted, netGuildBankOpLogForReplay([purge(2)]))).toBeNull();
    expect(fingerprint(netted)).toBe(
      fingerprint(
        (() => {
          const ordered = base();
          applyGuildBankDeltasTo(ordered, [purge(2)]);
          return ordered;
        })(),
      ),
    );
    expect(netted.inventory).toEqual([{ itemId: 'wolf_fang', count: 1, instance: { boundTo: 7 } }]);
    // And it nets AGAINST a deposit of the same identity, the same way a
    // withdraw would: deposit 2 then purge 2 is a no-op on the book.
    expect(netGuildBankOpLogForReplay([deposit(2), purge(2)])).toEqual([]);
  });

  it('the forward replay of NON-slot deltas is order independent', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = rngFor(seed + 10_000);
      const book = genBook(rnd);
      const probe = clone(book);
      const deltas: GuildBankOpDelta[] = [];
      for (let i = 0; i < 3; i++) {
        const d = genDelta(rnd, probe);
        if (d.op === 'open_bank' || d.op === 'buy_slots') continue;
        if (applyGuildBankDeltasTo(probe, [d]) !== null) break;
        deltas.push(d);
      }
      if (deltas.length < 2) continue;
      const a = clone(book);
      const b = clone(book);
      if (applyGuildBankDeltasTo(a, deltas) !== null) continue;
      if (applyGuildBankDeltasTo(b, [...deltas].reverse()) !== null) continue;
      // Inventory ORDER can differ (addStacked appends), so compare the
      // conserved quantities: the treasury, the ladder, and the item multiset.
      expect(`seed ${seed}: ${fingerprint(a)}`).toBe(`seed ${seed}: ${fingerprint(b)}`);
    }
  });

  it('a slot op is recorded ABSOLUTELY, so a replay can never double-grant it', () => {
    // The whole point of recording slot ops absolutely. A relative "+6" record
    // replayed onto a base that already advanced would grant the rung twice;
    // an absolute one refuses that base outright.
    const expansion: GuildBankOpDelta = {
      op: 'buy_slots',
      itemId: null,
      count: null,
      instance: null,
      copperDelta: -GUILD_BANK_RUNG_PRICES[1],
      purchasedSlotsBefore: 24,
      purchasedSlotsAfter: 30,
    };
    const book: GuildBankState = { treasury: 100_000, inventory: [], purchasedSlots: 24 };
    expect(applyGuildBankDeltasTo(book, [expansion])).toBeNull();
    expect(book.purchasedSlots).toBe(30);
    expect(book.treasury).toBe(75_000);
    // The second replay moves NOTHING: not the ladder (a relative record would
    // have granted the rung twice) and not the treasury either.
    expect(applyGuildBankDeltasTo(book, [expansion])?.kind).toBe('ladder_behind');
    expect(book.purchasedSlots).toBe(30);
    expect(book.treasury).toBe(75_000);
    // A base BELOW the op's own `before` REFUSES: the officer who bought the
    // lower rung has not committed, so raising here would grant rungs durable
    // truth cannot justify. Nothing moves, and the save is retried.
    const behind: GuildBankState = { treasury: 100_000, inventory: [], purchasedSlots: 0 };
    expect(applyGuildBankDeltasTo(behind, [expansion])).toEqual({
      kind: 'ladder_behind',
      op: 'buy_slots',
      itemId: null,
      shortfall: 24,
      copperDelta: -GUILD_BANK_RUNG_PRICES[1],
    });
    expect(behind.purchasedSlots).toBe(0);
    expect(behind.treasury).toBe(100_000);
  });

  it('reports the DEFICIT rather than clamping when durable truth cannot satisfy the replay', () => {
    // The one thing the forward replay must never do is paper over a
    // shortfall: this session's character half durably gains what the book
    // never durably lost, which mints it permanently. It reports the shortfall
    // instead, and a PARTLY covered delta rides on as a residual the next save
    // retries.
    const empty = (): GuildBankState => ({ treasury: 0, inventory: [], purchasedSlots: 24 });
    const goldOut: GuildBankOpDelta = {
      op: 'withdraw_gold',
      itemId: null,
      count: null,
      instance: null,
      craftedRecipeId: null,
      copperDelta: -250,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    };
    const fangsOut: GuildBankOpDelta = {
      op: 'withdraw',
      itemId: 'wolf_fang',
      count: 4,
      instance: null,
      craftedRecipeId: null,
      copperDelta: 0,
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 0,
    };
    expect(applyGuildBankDeltasTo(empty(), [goldOut])).toEqual({
      kind: 'treasury_underflow',
      op: 'withdraw_gold',
      itemId: null,
      shortfall: 250,
      // SIGNED, so an operator reading the anomaly row can tell a would-be
      // mint (copper leaving the book) from a would-be destruction.
      copperDelta: -250,
    });
    expect(applyGuildBankDeltasTo(empty(), [fangsOut])).toEqual({
      kind: 'missing_items',
      op: 'withdraw',
      itemId: 'wolf_fang',
      shortfall: 4,
      copperDelta: 0,
    });
    // A partial shortfall is still a shortfall (2 of the 4 copies are there).
    const partial: GuildBankState = {
      treasury: 0,
      inventory: [{ itemId: 'wolf_fang', count: 2 }],
      purchasedSlots: 24,
    };
    const half = applyGuildBankDeltasTo(partial, [fangsOut]);
    expect(half?.shortfall).toBe(2);
    // ...and NOTHING moved: a partial withdraw would commit a character half
    // that took more than the book gave up, which is the mint the refusal
    // exists to prevent. The whole save is rolled back and retried instead.
    expect(partial.inventory).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    // A deposit whose provenance does not match the book's stack is a fresh
    // slot, never a merge that launders the marker.
    const crafted: GuildBankState = {
      treasury: 0,
      inventory: [{ itemId: 'iron_sword', count: 1 }],
      purchasedSlots: 24,
    };
    expect(
      applyGuildBankDeltasTo(crafted, [
        {
          op: 'deposit',
          itemId: 'iron_sword',
          count: 1,
          instance: null,
          craftedRecipeId: 'smith_iron_sword',
          copperDelta: 0,
          purchasedSlotsBefore: 0,
          purchasedSlotsAfter: 0,
        },
      ]),
    ).toBeNull();
    expect(crafted.inventory).toEqual([
      { itemId: 'iron_sword', count: 1 },
      { itemId: 'iron_sword', count: 1, craftedRecipeId: 'smith_iron_sword' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The operator escape hatch for a DORMANT slot (purgeDormantGuildBankSlot +
// guildBankInfoForGuild). A slot holding an item a later content change flagged
// soulbound / noMarketList / transfer-locked is refused in BOTH directions, so
// no player action can ever clear it and the disband guard refuses forever.
// This is the remedy, and its scope is the whole point: it must be unable to
// touch anything a guild could withdraw itself.
// ---------------------------------------------------------------------------

describe('purgeDormantGuildBankSlot (the admin escape hatch)', () => {
  const DORMANT = [
    { itemId: 'reins_grag_bear', count: 1 }, // soulbound def
    { itemId: 'riding_training', count: 1 }, // noMarketList def
    { itemId: 'wolf_fang', count: 1, instance: { boundTo: 424242 } }, // bound copy
    { itemId: 'wolf_fang', count: 1, instance: { bindOnTrade: true } }, // armed copy
  ];

  it('removes each dormant dimension and returns the removed copy as evidence', () => {
    for (const slot of DORMANT) {
      const sim = makeOfficerSim();
      book(sim).inventory.push({ itemId: 'wolf_fang', count: 3 }, { ...slot } as never);
      const removed = sim.purgeDormantGuildBankSlot(GUILD_ID, 1, slot.itemId);
      expect(removed, JSON.stringify(slot)).toEqual(slot);
      // Only the dormant slot left; the ordinary stack beside it is untouched.
      expect(book(sim).inventory).toEqual([{ itemId: 'wolf_fang', count: 3 }]);
    }
  });

  it('the returned evidence is a CLONE, not a live reference into the book', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push(
      { itemId: 'wolf_fang', count: 1, instance: { boundTo: 7 } },
      { itemId: 'wolf_fang', count: 1, instance: { boundTo: 8 } },
    );
    const live = book(sim).inventory[0];
    const removed = sim.purgeDormantGuildBankSlot(GUILD_ID, 0, 'wolf_fang');
    if (!removed?.instance) throw new Error('expected an instance payload');
    // Decisive: a live reference would be the SAME object, and mutating the
    // evidence would reach the payload the surviving book slot still shares.
    expect(removed).not.toBe(live);
    expect(removed.instance).not.toBe(live.instance);
    removed.instance.boundTo = 999;
    expect(book(sim).inventory[0]).toEqual({
      itemId: 'wolf_fang',
      count: 1,
      instance: { boundTo: 8 },
    });
  });

  it('REFUSES when the named itemId does not match the slot (the index-shift guard)', () => {
    // A purge splices the slot out, so every higher index shifts down by one.
    // An operator working from a stale listing must not destroy a different
    // dormant copy than the one they read.
    const sim = makeOfficerSim();
    book(sim).inventory.push(
      { itemId: 'reins_grag_bear', count: 1 },
      { itemId: 'riding_training', count: 1 },
    );
    const before = fingerprint(sim);
    expect(sim.purgeDormantGuildBankSlot(GUILD_ID, 1, 'reins_grag_bear')).toBeNull();
    expect(sim.purgeDormantGuildBankSlot(GUILD_ID, 0, '')).toBeNull();
    expect(fingerprint(sim)).toBe(before);
    // The matching name still purges.
    expect(sim.purgeDormantGuildBankSlot(GUILD_ID, 1, 'riding_training')).not.toBeNull();
  });

  it('REFUSES an ordinary withdrawable slot: this is not a delete-any-item tool', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push(
      { itemId: 'wolf_fang', count: 5 },
      { itemId: 'iron_sword', count: 1, craftedRecipeId: 'smith_iron_sword' },
    );
    const before = fingerprint(sim);
    expect(sim.purgeDormantGuildBankSlot(GUILD_ID, 0, 'wolf_fang')).toBeNull();
    expect(sim.purgeDormantGuildBankSlot(GUILD_ID, 1, 'iron_sword')).toBeNull();
    expect(fingerprint(sim)).toBe(before);
  });

  it('refuses a missing book, and every out-of-range or malformed index, mutating nothing', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'reins_grag_bear', count: 1 });
    const before = fingerprint(sim);
    for (const bad of [-1, 1, 99, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        sim.purgeDormantGuildBankSlot(GUILD_ID, bad, 'reins_grag_bear'),
        String(bad),
      ).toBeNull();
    }
    expect(fingerprint(sim)).toBe(before);
    // No book for that guild at all: refuse, never mint one.
    expect(sim.purgeDormantGuildBankSlot(GUILD_ID + 1, 0, 'reins_grag_bear')).toBeNull();
    expect(sim.guildBanks.has(GUILD_ID + 1)).toBe(false);
  });

  it('clears the disband guard once the last dormant slot is gone', () => {
    // The whole reason the hatch exists: guildBankHoldings is the disband
    // guard's read, and a dormant slot keeps it non-zero forever.
    const sim = makeOfficerSim({ treasury: 0 });
    book(sim).inventory.push({ itemId: 'reins_grag_bear', count: 1 });
    expect(sim.guildBankHoldings(GUILD_ID)).toEqual({ copper: 0, items: 1 });
    expect(sim.purgeDormantGuildBankSlot(GUILD_ID, 0, 'reins_grag_bear')).not.toBeNull();
    expect(sim.guildBankHoldings(GUILD_ID)).toEqual({ copper: 0, items: 0 });
  });

  it('draws no rng (the purge and the operator read are pure book work)', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'reins_grag_bear', count: 1 });
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    sim.rng.next();
    expect(draws).toBe(1); // positive control
    draws = 0;
    sim.guildBankInfoForGuild(GUILD_ID);
    sim.purgeDormantGuildBankSlot(GUILD_ID, 0, 'reins_grag_bear'); // the success arm
    sim.purgeDormantGuildBankSlot(GUILD_ID, 0, 'reins_grag_bear'); // and a refusal
    expect(draws).toBe(0);
    sim.rng.setObserver(null);
  });
});

describe('guildBankInfoForGuild (the ungated operator read)', () => {
  it('reads the book by guild id with no proximity, rank, or alive gate', () => {
    const sim = makeOfficerSim({ treasury: 4_242 });
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 2 });
    // Degrade every gate the PLAYER read applies: away from the banker, demoted
    // to member, and dead. The player read goes null; the operator read does not.
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'member' });
    const p = sim.entities.get(sim.playerId);
    if (!p) throw new Error('missing player');
    p.dead = true;
    expect(sim.guildBankInfoFor(sim.playerId)).toBeNull();
    const info = sim.guildBankInfoForGuild(GUILD_ID);
    expect(info?.treasury).toBe(4_242);
    expect(info?.slots).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
  });

  it('keeps the REAL instance payload on a dormant slot (the player read projects it)', () => {
    // The evidence contract: the ledger row for a purge is derived from this
    // read, so a publicInstanceView projection here would erase exactly the
    // bind identity an operator needs to reconstruct what was removed.
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 1, instance: { boundTo: 424242 } });
    expect(sim.guildBankInfoForGuild(GUILD_ID)?.slots[0].instance).toEqual({ boundTo: 424242 });
    // The player read still projects it away (unchanged behavior).
    expect(sim.guildBankInfoFor(sim.playerId)?.slots[0].instance).not.toEqual({
      boundTo: 424242,
    });
  });

  it('returns null for a guild with no loaded book (callers fail closed)', () => {
    const sim = makeOfficerSim();
    expect(sim.guildBankInfoForGuild(GUILD_ID + 1)).toBeNull();
  });

  it('never hands out a live reference into the book', () => {
    const sim = makeOfficerSim();
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 1, instance: { boundTo: 7 } });
    const info = sim.guildBankInfoForGuild(GUILD_ID);
    const slot = info?.slots[0];
    if (!slot?.instance) throw new Error('expected an instance payload');
    slot.count = 9999;
    slot.instance.boundTo = 999;
    expect(book(sim).inventory[0]).toEqual({
      itemId: 'wolf_fang',
      count: 1,
      instance: { boundTo: 7 },
    });
  });
});

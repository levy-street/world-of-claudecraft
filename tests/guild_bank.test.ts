// Guild Bank Phase 1 (foundation): the state model in src/sim/guild_bank.ts
// (constants, capacity ladder, the sanitizeGuildBankState load path, the
// per-guild book map with its load/serialize seam) plus the session-only
// PlayerMeta.guildMembership stamp and its parity-trace exclusion.
//
// Constants and capacities are pinned to LITERAL numbers (never compared to the
// exported constant, which would be a zero-protection self-comparison), so a
// table regression flips an assertion. Op bodies (deposit/withdraw/buy) and the
// wire land in Phase 2 and are tested there.
import { describe, expect, it } from 'vitest';
// Type-only import (erased at compile, never executed): pins the sim-side rank
// redeclaration to the server's source of truth so the two cannot drift silently.
import type { GuildRank as ServerGuildRank } from '../server/social';
import {
  createEmptyGuildBankState,
  GUILD_BANK_BASE_SLOTS,
  GUILD_BANK_EXPANSION_PRICES,
  GUILD_BANK_EXPANSION_SLOTS,
  GUILD_BANK_TREASURY_CAP,
  GUILD_CREATION_FEE_COPPER,
  GUILD_RANKS,
  type GuildBankState,
  type GuildRank,
  guildBankCapacity,
  guildBankNextExpansionPrice,
  sanitizeGuildBankState,
} from '../src/sim/guild_bank';
import { Sim } from '../src/sim/sim';
import { META_EXCLUDE, samplePlayerMeta } from './parity/trace';

// The 6-tier expansion ladder from docs/guild-bank/state.md, pinned as literals.
const PRICES = [50000, 100000, 250000, 500000, 1000000, 2500000];
const LADDER_TOTAL = 4400000; // 440 gold across all six expansions
const CAPS = [12, 18, 24, 30, 36, 42, 48]; // base 12 + 6 per purchased expansion

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
  it('pins the creation fee, slot geometry, price ladder, and treasury cap', () => {
    expect(GUILD_CREATION_FEE_COPPER).toBe(100000);
    expect(GUILD_BANK_BASE_SLOTS).toBe(12);
    expect(GUILD_BANK_EXPANSION_SLOTS).toBe(6);
    expect([...GUILD_BANK_EXPANSION_PRICES]).toEqual(PRICES);
    expect(PRICES.reduce((a, b) => a + b, 0)).toBe(LADDER_TOTAL);
    expect(GUILD_BANK_TREASURY_CAP).toBe(1000000000);
  });

  it('pins the rank ladder to the server contract values', () => {
    expect([...GUILD_RANKS]).toEqual(['leader', 'officer', 'member']);
  });
});

describe('guildBankCapacity + guildBankNextExpansionPrice', () => {
  it('walks the full ladder: capacity per tier and the next price at each step', () => {
    for (let tier = 0; tier <= 6; tier++) {
      const bank: GuildBankState = { treasury: 0, inventory: [], purchasedSlots: tier * 6 };
      expect(guildBankCapacity(bank)).toBe(CAPS[tier]);
      expect(guildBankNextExpansionPrice(bank)).toBe(tier < 6 ? PRICES[tier] : null);
    }
  });

  it('maxed banks report 48 slots and no further price', () => {
    const maxed: GuildBankState = { treasury: 0, inventory: [], purchasedSlots: 36 };
    expect(guildBankCapacity(maxed)).toBe(48);
    expect(guildBankNextExpansionPrice(maxed)).toBeNull();
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

  it('floors purchasedSlots to a whole expansion within [0, 36]', () => {
    const ps = (v: unknown) => sanitizeGuildBankState({ purchasedSlots: v }).purchasedSlots;
    expect(ps(0)).toBe(0);
    expect(ps(6)).toBe(6);
    expect(ps(7)).toBe(6);
    expect(ps(35)).toBe(30);
    expect(ps(36)).toBe(36);
    expect(ps(9999)).toBe(36);
    expect(ps(-6)).toBe(0);
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
      ],
    }).inventory;
    expect(out.map((s) => s.count)).toEqual([1, 2, 1, 20, 1, 30]);
    expect(out[2]).toEqual({ itemId: 'worn_sword', count: 1, instance: { signer: 'Ana' } });
  });

  it('tolerates an over-capacity inventory without truncating (items are never destroyed)', () => {
    const raw = {
      inventory: Array.from({ length: 60 }, (_, i) => ({ itemId: `mystery_${i}`, count: 1 })),
      purchasedSlots: 0,
    };
    const book = sanitizeGuildBankState(raw);
    expect(book.inventory.length).toBe(60); // way past the 12-slot budget, all kept
    expect(guildBankCapacity(book)).toBe(12);
  });

  it('round-trips its own output unchanged and never aliases the raw slots', () => {
    const raw = {
      treasury: 123456,
      purchasedSlots: 12,
      inventory: [{ itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' } }],
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
    sim.loadGuildBank(3, { treasury: -50, purchasedSlots: 7, inventory: 'nope' });
    expect(sim.guildBanks.get(3)).toEqual({ treasury: 0, inventory: [], purchasedSlots: 6 });
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
      purchasedSlots: 6,
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
    sim.loadGuildBank(3, {
      treasury: 500,
      purchasedSlots: 6,
      inventory: [{ itemId: 'wolf_fang', count: 3, instance: { signer: 'Ana' } }],
    });
    sim.serializeGuildBank(3);
    sim.setPlayerGuildMembership(sim.playerId, { guildId: 3, rank: 'officer' });
    sim.setPlayerGuildMembership(sim.playerId, null);
    sanitizeGuildBankState({ treasury: -1, purchasedSlots: 99, inventory: [null, 'x'] });
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

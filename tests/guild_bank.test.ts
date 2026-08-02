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
import { bagCapacity } from '../src/sim/bags';
import { sanitizeBankState } from '../src/sim/bank';
import { BUILTIN_WORLD, ITEMS, QUESTS } from '../src/sim/data';
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
import type { Entity, WorldContent } from '../src/sim/types';
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
    // Reduce over the EXPORT (not the file-local literal) so the 440g claim is
    // load-bearing against the shipped table, not a tautology.
    expect(GUILD_BANK_EXPANSION_PRICES.reduce((a, b) => a + b, 0)).toBe(LADDER_TOTAL);
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

  it('floors a non-multiple purchasedSlots when pricing (defensive arm)', () => {
    // Sanitize guarantees whole expansions, so this arm is defensive; pin it
    // anyway so the floor cannot silently become a round-up (price skip).
    const odd: GuildBankState = { treasury: 0, inventory: [], purchasedSlots: 7 };
    expect(guildBankNextExpansionPrice(odd)).toBe(100000); // tier 1 price, not tier 2
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
    expect(book.inventory.length).toBe(60); // way past the 12-slot budget, all kept
    expect(guildBankCapacity(book)).toBe(12);
  });

  it('round-trips its own output unchanged and never aliases the raw slots', () => {
    const raw = {
      treasury: 123456,
      purchasedSlots: 12,
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
    sim.loadGuildBank(3, { treasury: -50, purchasedSlots: 7, inventory: 'nope' });
    expect(sim.guildBanks.get(3)).toEqual({ treasury: 0, inventory: [], purchasedSlots: 6 });
  });

  it('is load-once: a second load never clobbers a live book (unflushed deposits)', () => {
    const sim = freshSim();
    sim.loadGuildBank(3, {
      treasury: 500,
      purchasedSlots: 6,
      inventory: [{ itemId: 'wolf_fang', count: 3 }],
    });
    const live = sim.guildBanks.get(3);
    sim.loadGuildBank(3, { treasury: 0, purchasedSlots: 0, inventory: [] });
    expect(sim.guildBanks.get(3)).toBe(live); // same object: the reload was skipped
    expect(sim.guildBanks.get(3)).toEqual({
      treasury: 500,
      purchasedSlots: 6,
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
      purchasedSlots: 6,
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
    purchasedSlots: opts.purchasedSlots ?? 0,
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
      expect(hasErr(sim.drainEvents(), 'You are not in a guild.'), op.name).toBe(true);
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
    expect(book(sim).purchasedSlots).toBe(6);
    expect(book(sim).treasury).toBe(51_500); // 101500 - 50000 (tier-1 price literal)
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
  it('refuses quest items with the personal-bank error, mutating nothing', () => {
    const sim = makeOfficerSim();
    meta(sim).inventory.push({ itemId: 'boar_hide', count: 2 }); // kind: 'quest'
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankDepositFor(
      sim.playerId,
      meta(sim).inventory.findIndex((s) => s.itemId === 'boar_hide'),
    );
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'You cannot store quest items in the bank.')).toBe(true);
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
    expect(hasErr(evs, 'You cannot store soulbound items in the guild bank.')).toBe(true);
    expect(hasErr(evs, 'That item cannot be stored in the guild bank.')).toBe(true);
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
    const rows: { slot: Record<string, unknown>; err: string }[] = [
      { slot: { itemId: questItemId, count: 1 }, err: 'You cannot store quest items in the bank.' },
      {
        slot: { itemId: 'reins_grag_bear', count: 1 },
        err: 'You cannot store soulbound items in the guild bank.',
      },
      {
        slot: { itemId: noListId, count: 1 },
        err: 'That item cannot be stored in the guild bank.',
      },
      {
        slot: { itemId: 'wolf_fang', count: 1, instance: { boundTo: 424242 } },
        err: 'That item cannot be stored in the guild bank.',
      },
      {
        slot: { itemId: 'wolf_fang', count: 1, instance: { bindOnTrade: true } },
        err: 'That item cannot be stored in the guild bank.',
      },
    ];
    for (const [i, row] of rows.entries()) {
      book(sim).inventory.push(row.slot as never);
      const before = fingerprint(sim);
      sim.drainEvents();
      sim.guildBankWithdrawFor(sim.playerId, i);
      expect(fingerprint(sim), row.err).toBe(before);
      expect(hasErr(sim.drainEvents(), row.err), row.err).toBe(true);
    }
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
    // Fill all 12 base slots with non-mergeable instanced singles.
    for (let i = 0; i < GUILD_BANK_BASE_SLOTS; i++) {
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
  it('walks the whole ladder from the treasury at the literal prices', () => {
    const sim = makeOfficerSim({ treasury: 4_400_000 }); // the 440g ladder total
    const copperBefore = meta(sim).copper;
    sim.drainEvents();
    const prices = [50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000];
    let treasury = 4_400_000;
    for (let tier = 0; tier < prices.length; tier++) {
      sim.guildBankBuySlotsFor(sim.playerId);
      treasury -= prices[tier];
      expect(book(sim).treasury).toBe(treasury);
      expect(book(sim).purchasedSlots).toBe(6 * (tier + 1));
    }
    expect(book(sim).treasury).toBe(0);
    expect(book(sim).purchasedSlots).toBe(36); // 48-slot cap = 12 base + 36
    // Paid from the TREASURY only: personal copper never moves.
    expect(meta(sim).copper).toBe(copperBefore);
    expect(hasLog(sim.drainEvents(), 'You purchase additional guild bank slots.')).toBe(true);
  });

  it('refuses at the ladder end, mutating nothing', () => {
    const sim = makeOfficerSim({ treasury: 10_000_000, purchasedSlots: 36 });
    const before = fingerprint(sim);
    sim.drainEvents();
    sim.guildBankBuySlotsFor(sim.playerId);
    expect(fingerprint(sim)).toBe(before);
    expect(hasErr(sim.drainEvents(), 'The guild bank cannot be expanded further.')).toBe(true);
  });

  it('refuses when the treasury cannot afford the table price, mutating nothing', () => {
    const sim = makeOfficerSim({ treasury: 49_999 });
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
    const sim = makeOfficerSim({ treasury: 12_345, purchasedSlots: 6 });
    book(sim).inventory.push({ itemId: 'wolf_fang', count: 2, instance: { signer: 'Ana' } });
    const info = sim.guildBankInfoFor(sim.playerId);
    expect(info).toEqual({
      treasury: 12_345,
      slots: [{ itemId: 'wolf_fang', count: 2, instance: { signer: 'Ana' } }],
      capacity: 18,
      purchasedSlots: 6,
      nextExpansionPrice: 100_000, // tier-2 literal
    });
    // Boundary clone: mutating the returned view never reaches the live book.
    if (!info) throw new Error('unreachable');
    info.slots[0].count = 99;
    if (info.slots[0].instance) info.slots[0].instance.signer = 'Tampered';
    expect(book(sim).inventory[0].count).toBe(2);
    expect(book(sim).inventory[0].instance?.signer).toBe('Ana');
  });

  it('reports a null nextExpansionPrice once the ladder is exhausted', () => {
    const sim = makeOfficerSim({ purchasedSlots: 36 });
    expect(sim.guildBankInfoFor(sim.playerId)?.nextExpansionPrice).toBeNull();
    expect(sim.guildBankInfoFor(sim.playerId)?.capacity).toBe(48);
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
      purchasedSlots: 6,
    });
    sim.setPlayerGuildMembership(sim.playerId, { guildId: GUILD_ID, rank: 'officer' });
    sim.loadGuildBank(GUILD_ID, { treasury: 100_000, inventory: [], purchasedSlots: 0 });
    const otherBefore = JSON.stringify(sim.guildBanks.get(OTHER_GUILD));
    meta(sim).copper = 5_000;
    sim.drainEvents();
    sim.guildBankDepositGoldFor(sim.playerId, 1_000);
    sim.guildBankWithdrawGoldFor(sim.playerId, 500);
    sim.guildBankBuySlotsFor(sim.playerId);
    // Every mutation landed in the stamped guild's book; the other is untouched.
    expect(JSON.stringify(sim.guildBanks.get(OTHER_GUILD))).toBe(otherBefore);
    expect(book(sim).treasury).toBe(100_000 + 1_000 - 500 - 50_000);
    // And the read reports the stamped guild's book, never the other's.
    const info = sim.guildBankInfoFor(sim.playerId);
    expect(info?.treasury).toBe(50_500);
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

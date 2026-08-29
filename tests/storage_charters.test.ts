// Bank Storage phase 11: the Claudium storage-SKU registry
// (src/sim/content/storage_charters.ts) and the server-originated grant
// command (bankGrantStorageSlots in src/sim/bank.ts).
//
// Registry pins follow tests/weapon_skins.test.ts: negative property
// assertions per entry (the game carries NO price and NO display copy), plus
// literal id/grant pins built FRESH here, never compared back to the module
// under test's own derived values. The grant suite drives the REAL Sim
// through sim.ctx, the exact call shape the server uses.
import { describe, expect, it } from 'vitest';
import {
  BANK_BASE_SLOTS,
  BANK_EXPANSION_PRICES,
  BANK_EXPANSION_SLOTS,
  bankCapacity,
  bankGrantStorageSlots,
  sanitizeBankState,
} from '../src/sim/bank';
import {
  isKnownStorageSkuId,
  STORAGE_SKU_LIST,
  STORAGE_SKUS,
} from '../src/sim/content/storage_charters';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimEvent, WorldContent } from '../src/sim/types';

// The sixteen ids, written out fresh (the service catalog's storage kind).
const CHARTER_IDS = [
  'strongbox_charter_1',
  'strongbox_charter_2',
  'strongbox_charter_3',
  'strongbox_charter_complete',
];
const RUNG_IDS = [
  'strongbox_rung_01',
  'strongbox_rung_02',
  'strongbox_rung_03',
  'strongbox_rung_04',
  'strongbox_rung_05',
  'strongbox_rung_06',
  'strongbox_rung_07',
  'strongbox_rung_08',
  'strongbox_rung_09',
  'strongbox_rung_10',
  'strongbox_rung_11',
  'strongbox_rung_12',
];

// A slim world (the tests/bank.test.ts idiom): the grant command has no
// banker-proximity gate, so no NPCs are needed at all.
const GRANT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const makeSim = (seed = 42) =>
  new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: GRANT_TEST_WORLD });
const meta = (sim: Sim, pid = sim.playerId) => sim.meta(pid)!;
const hasLog = (evs: SimEvent[], text: string) =>
  evs.some((e) => e.type === 'log' && e.text === text);

describe('storage SKU registry (the weapon-skin no-prices philosophy)', () => {
  it('ships exactly the sixteen storage ids: four charters and twelve rungs', () => {
    expect(STORAGE_SKU_LIST.length).toBe(16);
    expect(Object.keys(STORAGE_SKUS).sort()).toEqual([...CHARTER_IDS, ...RUNG_IDS].sort());
  });

  it('keeps product pricing and display copy out of the game registry', () => {
    for (const [key, sku] of Object.entries(STORAGE_SKUS)) {
      expect(sku.id).toBe(key);
      expect(sku).not.toHaveProperty('price');
      expect(sku).not.toHaveProperty('priceUsd');
      expect(sku).not.toHaveProperty('costClaudium');
      expect(sku).not.toHaveProperty('name');
      expect(sku).not.toHaveProperty('displayName');
      expect(sku).not.toHaveProperty('lore');
      expect(sku).not.toHaveProperty('copy');
    }
  });

  it('every grant is a positive multiple of the 6-slot expansion block', () => {
    for (const sku of STORAGE_SKU_LIST) {
      expect(sku.grantSlots, sku.id).toBeGreaterThan(0);
      expect(sku.grantSlots % 6, sku.id).toBe(0);
    }
  });

  it('the twelve rung entries map one-to-one onto ladder indices 0..11, one rung each', () => {
    const byIndex = new Map<number, string>();
    for (const id of RUNG_IDS) {
      const sku = STORAGE_SKUS[id];
      expect(sku, id).toBeDefined();
      expect(sku.grantSlots, id).toBe(6);
      expect(sku.ladderIndex, id).toBeDefined();
      byIndex.set(sku.ladderIndex as number, id);
    }
    expect([...byIndex.keys()].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    // The two-digit id suffix names its 1-based rung, so index = suffix - 1.
    for (const [index, id] of byIndex) {
      expect(Number(id.slice(-2)), id).toBe(index + 1);
    }
  });

  it('charter grants are the pinned bundles, and the largest equals the full ladder', () => {
    expect(STORAGE_SKUS.strongbox_charter_1.grantSlots).toBe(12);
    expect(STORAGE_SKUS.strongbox_charter_2.grantSlots).toBe(24);
    expect(STORAGE_SKUS.strongbox_charter_3.grantSlots).toBe(48);
    expect(STORAGE_SKUS.strongbox_charter_complete.grantSlots).toBe(72);
    // Complete is the whole purchasable ladder: 12 rungs of 6 (the ceiling
    // gold reaches, never past it). The price identity in pricing-and-skus.md
    // (I + III = Complete) lives service-side; grants deliberately overlap
    // instead, and the fit gate is what makes an overshooting bundle refuse.
    expect(STORAGE_SKUS.strongbox_charter_complete.grantSlots).toBe(12 * 6);
    // Charters carry no ladder index: they are position-free bundles.
    for (const id of CHARTER_IDS) {
      expect(STORAGE_SKUS[id].ladderIndex, id).toBeUndefined();
    }
  });

  it('the largest charter grant tracks the LIVE ladder, which the store fit gate relies on', () => {
    // The pin above fixes Complete at the literal 12 * 6. This one is the
    // different claim the WOC store leans on: src/ui/daily_rewards_window.ts
    // DERIVES its fit-gate ceiling as the largest charter grant, precisely so
    // that no slot literal and no copper price table has to reach src/ui. That
    // derivation is only correct while Complete really does buy the whole
    // ladder, so tie it to the live constants rather than to 72.
    //
    // If a retune lengthens BANK_EXPANSION_PRICES without growing Complete,
    // this reds. Fix it by growing the charter, never by loosening the
    // comparison: a stale Complete would make the store quietly hide charters
    // that DO fit, and the store has no other way to learn the real ceiling.
    const ladderCeiling = BANK_EXPANSION_PRICES.length * BANK_EXPANSION_SLOTS;
    const largestCharterGrant = Math.max(...CHARTER_IDS.map((id) => STORAGE_SKUS[id].grantSlots));
    expect(largestCharterGrant).toBe(ladderCeiling);
    // And no charter may overshoot the ladder: an unbuyable bundle would be
    // fit-gated out of the store on every character, forever.
    for (const id of CHARTER_IDS) {
      expect(STORAGE_SKUS[id].grantSlots, id).toBeLessThanOrEqual(ladderCeiling);
    }
  });

  it('isKnownStorageSkuId accepts exactly the registry and rejects everything else', () => {
    for (const id of [...CHARTER_IDS, ...RUNG_IDS]) {
      expect(isKnownStorageSkuId(id), id).toBe(true);
    }
    expect(isKnownStorageSkuId('strongbox_rung_13')).toBe(false);
    expect(isKnownStorageSkuId('strongbox_rung_00')).toBe(false);
    expect(isKnownStorageSkuId('')).toBe(false);
    expect(isKnownStorageSkuId('hasOwnProperty')).toBe(false);
    // The storage and skin allowlists never overlap, so a kind mixup can
    // never smuggle an id through the other family's gate.
    for (const skinId of Object.keys(WEAPON_SKINS)) {
      expect(isKnownStorageSkuId(skinId), skinId).toBe(false);
    }
  });
});

describe('bankGrantStorageSlots (the server-originated grant command)', () => {
  it('applies a charter grant once: counter, key, capacity, and the purchase notice', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.drainEvents();
    const res = bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_1', 'key-a');
    expect(res).toEqual({ status: 'applied', purchasedSlotsBefore: 0, purchasedSlotsAfter: 12 });
    expect(m.bank.purchasedSlots).toBe(12);
    expect(m.bank.appliedStorageKeys).toEqual(['key-a']);
    expect(bankCapacity(m.bank)).toBe(BANK_BASE_SLOTS + 12);
    expect(hasLog(sim.drainEvents(), 'You purchase additional bank slots.')).toBe(true);
  });

  it('never moves copper and never requires a banker or a living player', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = 777;
    const p = sim.entities.get(sim.playerId)!;
    p.dead = true;
    // No banker exists in this world at all, and the player is dead: the
    // receipt is already paid, so the grant still lands.
    const res = bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', 'key-b');
    expect(res.status).toBe('applied');
    expect(m.copper).toBe(777);
    expect(m.bank.purchasedSlots).toBe(6);
  });

  it('applies exactly once per key: a replay refuses and moves nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', 'key-c').status).toBe(
      'applied',
    );
    sim.drainEvents();
    const replay = bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_02', 'key-c');
    expect(replay).toEqual({ status: 'already_applied' });
    expect(m.bank.purchasedSlots).toBe(6);
    expect(m.bank.appliedStorageKeys).toEqual(['key-c']);
    expect(sim.drainEvents()).toHaveLength(0);
  });

  it('sells only the next unpurchased rung: ahead, behind, and replayed positions refuse', () => {
    const sim = makeSim();
    const m = meta(sim);
    // Ahead: rung 3 while nothing is purchased.
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_03', 'key-d')).toEqual({
      status: 'not_next_rung',
    });
    expect(m.bank.purchasedSlots).toBe(0);
    expect(m.bank.appliedStorageKeys).toEqual([]);
    // In order: rungs 1 then 2 apply.
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', 'key-e').status).toBe(
      'applied',
    );
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_02', 'key-f').status).toBe(
      'applied',
    );
    // Behind: rung 1 again under a FRESH key is a position refusal, not a
    // key dedupe, so a stale receipt can never re-buy a lower rung.
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', 'key-g')).toEqual({
      status: 'not_next_rung',
    });
    expect(m.bank.purchasedSlots).toBe(12);
  });

  it('refuses rather than clamps when the full grant no longer fits', () => {
    const sim = makeSim();
    const m = meta(sim);
    expect(
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_3', 'key-h').status,
    ).toBe('applied');
    expect(m.bank.purchasedSlots).toBe(48);
    // 48 + 48 would overshoot 72: the whole grant refuses, nothing partial.
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_3', 'key-i')).toEqual({
      status: 'does_not_fit',
    });
    expect(m.bank.purchasedSlots).toBe(48);
    expect(m.bank.appliedStorageKeys).toEqual(['key-h']);
    // 48 + 24 lands exactly on the ceiling: the bound is REACHED, not
    // stopped short of.
    expect(
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_2', 'key-j').status,
    ).toBe('applied');
    expect(m.bank.purchasedSlots).toBe(72);
    // At the ceiling every further SKU refuses on fit.
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_12', 'key-k')).toEqual({
      status: 'does_not_fit',
    });
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_1', 'key-l')).toEqual({
      status: 'does_not_fit',
    });
    expect(m.bank.purchasedSlots).toBe(72);
  });

  it('interleaves with the gold ladder on one shared counter (full gold parity)', () => {
    const sim = makeSim();
    const m = meta(sim);
    // A gold rung bought first moves the same counter the grant checks.
    m.bank.purchasedSlots = 6;
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', 'key-m')).toEqual({
      status: 'not_next_rung',
    });
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_02', 'key-n').status).toBe(
      'applied',
    );
    expect(m.bank.purchasedSlots).toBe(12);
  });

  it('dry run answers every rule without mutating anything', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.drainEvents();
    const before = structuredClone(m.bank);
    expect(
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_complete', 'key-o', {
        dryRun: true,
      }),
    ).toEqual({ status: 'fits' });
    expect(
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_03', 'key-o', {
        dryRun: true,
      }),
    ).toEqual({ status: 'not_next_rung' });
    expect(m.bank).toEqual(before);
    expect(sim.drainEvents()).toHaveLength(0);
    // The dry run sees the applied-key dedupe too (the pre-spend replay gate).
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', 'key-p').status).toBe(
      'applied',
    );
    expect(
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_02', 'key-p', {
        dryRun: true,
      }),
    ).toEqual({ status: 'already_applied' });
  });

  it('refuses to apply a key the load path could not keep (the shared length bound)', () => {
    const sim = makeSim();
    const m = meta(sim);
    // One past the bound refuses outright: "applicable" and "persistable"
    // must be the same set, or an applied key silently vanishes on the next
    // load and a replayed receipt re-grants for free.
    expect(
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', 'x'.repeat(201)),
    ).toEqual({ status: 'invalid_key' });
    expect(m.bank.purchasedSlots).toBe(0);
    expect(m.bank.appliedStorageKeys).toEqual([]);
    // Exactly AT the bound applies, survives the save round-trip, and still
    // refuses the replay on the reloaded state.
    const maxKey = 'k'.repeat(200);
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', maxKey).status).toBe(
      'applied',
    );
    const state = sim.serializeCharacter(sim.playerId)!;
    const sim2 = new Sim({
      seed: 5,
      playerClass: 'warrior',
      noPlayer: true,
      world: GRANT_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Bound', { state: state as never });
    expect(meta(sim2, pid).bank.appliedStorageKeys).toEqual([maxKey]);
    expect(bankGrantStorageSlots(sim2.ctx, pid, 'strongbox_rung_01', maxKey)).toEqual({
      status: 'already_applied',
    });
    expect(meta(sim2, pid).bank.purchasedSlots).toBe(6);
  });

  it('refuses prototype-chain ids as unknown SKUs instead of corrupting the counter', () => {
    const sim = makeSim();
    const before = structuredClone(meta(sim).bank);
    // A bracket lookup would make these truthy, skip both refusal gates on
    // undefined fields, and write NaN into purchasedSlots.
    for (const id of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(bankGrantStorageSlots(sim.ctx, sim.playerId, id, 'key-proto'), id).toEqual({
        status: 'unknown_sku',
      });
      expect(
        bankGrantStorageSlots(sim.ctx, sim.playerId, id, 'key-proto', { dryRun: true }),
        id,
      ).toEqual({ status: 'unknown_sku' });
    }
    expect(meta(sim).bank).toEqual(before);
    expect(Number.isSafeInteger(meta(sim).bank.purchasedSlots)).toBe(true);
  });

  it('a paid grant credits the shared purchasedSlots deed meters (the recorded ruling)', () => {
    // docs/design/deeds.md, Bank Storage phase 11 (maintainer-vetoable):
    // the bankPurchasedSlots meter reads the ONE shared counter, so the two
    // meter deeds credit on a Claudium grant exactly as they do on gold
    // (full gold parity; suppressing would strand the meter forever).
    const sim = makeSim();
    const m = meta(sim);
    expect(
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_complete', 'key-deed').status,
    ).toBe('applied');
    sim.tick();
    expect(m.deedsEarned.has('soc_room_for_more')).toBe(true);
    expect(m.deedsEarned.has('soc_gilded_strongbox')).toBe(true);
  });

  it('refuses an unknown SKU, an empty key, and an unresolvable player', () => {
    const sim = makeSim();
    const before = structuredClone(meta(sim).bank);
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_13', 'key-q')).toEqual({
      status: 'unknown_sku',
    });
    expect(bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_01', '')).toEqual({
      status: 'invalid_key',
    });
    expect(bankGrantStorageSlots(sim.ctx, 999999, 'strongbox_rung_01', 'key-r')).toEqual({
      status: 'no_player',
    });
    expect(meta(sim).bank).toEqual(before);
  });

  it('is deterministic: the same seed and the same grants produce identical saves', () => {
    const run = () => {
      const sim = makeSim(7);
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_1', 'key-s');
      bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_rung_03', 'key-t');
      for (let i = 0; i < 20; i++) sim.tick();
      return JSON.stringify(sim.serializeCharacter(sim.playerId));
    };
    expect(run()).toBe(run());
  });

  it('applied keys persist through the save round-trip, so a replay refuses on load', () => {
    const sim = makeSim();
    bankGrantStorageSlots(sim.ctx, sim.playerId, 'strongbox_charter_1', 'key-u');
    const state = sim.serializeCharacter(sim.playerId)!;
    // The saved blob carries the key alongside the counter it guards.
    const savedBank = (JSON.parse(JSON.stringify(state)) as { bank: Record<string, unknown> }).bank;
    expect(savedBank.appliedStorageKeys).toEqual(['key-u']);
    expect(savedBank.purchasedSlots).toBe(12);
    const sim2 = new Sim({
      seed: 9,
      playerClass: 'warrior',
      noPlayer: true,
      world: GRANT_TEST_WORLD,
    });
    const pid = sim2.addPlayer('warrior', 'Reload', { state: state as never });
    const m2 = meta(sim2, pid);
    expect(m2.bank.purchasedSlots).toBe(12);
    expect(m2.bank.appliedStorageKeys).toEqual(['key-u']);
    // The recovery-path truth: replaying the receipt against the RELOADED
    // durable state refuses, so a crash between apply and settle can never
    // double-apply.
    expect(bankGrantStorageSlots(sim2.ctx, pid, 'strongbox_charter_1', 'key-u')).toEqual({
      status: 'already_applied',
    });
    expect(m2.bank.purchasedSlots).toBe(12);
  });

  it('a never-granted bank omits appliedStorageKeys from the save (byte-equal idiom)', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    const savedBank = (JSON.parse(JSON.stringify(state)) as { bank: Record<string, unknown> }).bank;
    expect('appliedStorageKeys' in savedBank).toBe(false);
  });

  it('sanitize bounds tampered key lists without touching legitimate ones', () => {
    const good = sanitizeBankState({
      inventory: [],
      purchasedSlots: 12,
      bonusSlots: 0,
      appliedStorageKeys: ['key-a', 'key-b'],
    });
    expect(good.appliedStorageKeys).toEqual(['key-a', 'key-b']);
    const drops: string[] = [];
    const bad = sanitizeBankState(
      {
        inventory: [],
        purchasedSlots: 0,
        bonusSlots: 0,
        appliedStorageKeys: ['ok', '', 42, 'ok', 'x'.repeat(500), ...Array(100).fill('flood')],
      },
      'tamper',
      drops,
    );
    // '' (empty), 42 (non-string), the duplicate 'ok', and the oversized key
    // all drop with an audit trail. The EXACT survivor list, not a containment
    // check: the flood is 100 copies of one string, so dedupe collapses it to
    // a single entry and the result is two keys, full stop.
    expect(bad.appliedStorageKeys).toEqual(['ok', 'flood']);
    // 105 raw entries, 64 read: the tail overflows by exactly 41.
    expect(drops).toContain('bank.storageKey.overflow.41');
    // And each rejected entry names its index and the LENGTH it had, never
    // the key itself.
    expect(drops).toContain('bank.storageKey1.len0');
    expect(drops).toContain('bank.storageKey2.len2');
    expect(drops).toContain('bank.storageKey3.len2');
    expect(drops).toContain('bank.storageKey4.len500');
  });

  it('the applied-key cap is REACHED at exactly 64 distinct keys, and truncates there', () => {
    // The cap test above can never reach the bound: its flood is one string
    // repeated, so dedupe leaves two keys and any "<= 64" assertion passes
    // whatever the cap is. This one floods with DISTINCT keys, so the loop's
    // own 64-entry bound is the only thing that can stop it.
    const drops: string[] = [];
    const keys = Array.from({ length: 80 }, (_, i) => `k-${i}`);
    const bad = sanitizeBankState(
      { inventory: [], purchasedSlots: 0, bonusSlots: 0, appliedStorageKeys: keys },
      'tamper',
      drops,
    );
    expect(bad.appliedStorageKeys.length).toBe(64);
    // The boundary from both sides: the 64th read entry survives, the 65th
    // is never read at all.
    expect(bad.appliedStorageKeys[63]).toBe('k-63');
    expect(bad.appliedStorageKeys).not.toContain('k-64');
    expect(bad.appliedStorageKeys).toEqual(keys.slice(0, 64));
    // 80 raw, 64 read: the overflow count is exact, and no entry was rejected
    // on its own merits (every one of the first 64 was valid and distinct).
    expect(drops).toEqual(['bank.storageKey.overflow.16']);
  });
});

// ---------------------------------------------------------------------------
describe('the store ceiling and the grant ceiling are the same number', () => {
  it('the largest charter grant equals the whole purchasable ladder', () => {
    // src/ui/daily_rewards_window.ts DERIVES the store's fit ceiling as
    // `max(charter.grantSlots)` rather than importing the ladder table, so the
    // price constants stay out of src/ui. That derivation is only correct while
    // the "complete" charter grants the whole ladder, and nothing in
    // src/sim/content/storage_charters.ts warns an editor who trims it.
    //
    // Both directions are real: trim `strongbox_charter_complete` to 60 and the
    // store hides a charter the server would happily grant (capacity a paying
    // player cannot buy); raise it past the ladder and the store lists charters
    // the server answers `does_not_fit` on, so a button that rendered as
    // available refuses. The server's own ceiling is
    // `bankExpansions.length * BANK_EXPANSION_SLOTS` (bankGrantStorageSlots).
    const largestGrant = STORAGE_SKU_LIST.reduce((max, sku) => Math.max(max, sku.grantSlots), 0);
    const serverCeiling = BANK_EXPANSION_PRICES.length * BANK_EXPANSION_SLOTS;
    expect(largestGrant).toBe(serverCeiling);
    // The literal too, so a change that moved BOTH sides together still has to
    // be looked at rather than sliding through as a tautology.
    expect(largestGrant).toBe(72);
  });
});

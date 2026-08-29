// Materials Vault: the per-material material store beside the personal slot bank
// (src/sim/materials_vault.ts + the Sim delegates vaultDeposit/vaultWithdraw/
// vaultBuyUpgrade/vaultInfoFor). Where the bank spends ONE pooled slot budget over
// every item, the vault gives every material id its own capacity, bought with a
// five-rung gold ladder whose rung 0 is the unlock itself.
//
// THE ITEM-SAFETY COVENANT is this suite's first law: a vault op may move a
// material between the bags and the stock, but the TOTAL held count of that id
// must be byte-identical before and after, on SUCCESS and on EVERY refusal alike.
// Every case below asserts it. Prices, caps, and stock counts are pinned to LITERAL
// numbers so a table or formula regression flips an assertion.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { generalOnlyPools } from '../src/sim/bag_pools';
import { bagCapacity, bagPools, countFit } from '../src/sim/bags';
import { BUILTIN_WORLD, ITEMS, QUESTS } from '../src/sim/data';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import {
  consumePlayerVaultStock,
  consumeVaultStock,
  emitVaultCraftConsume,
  isVaultDepositableSlot,
  restoreVaultStateOnLoad,
  sanitizeVaultState,
  VAULT_BASE_CAP,
  VAULT_UPGRADE_PRICES,
  VAULT_UPGRADE_STEP,
  vaultCapacityPerMaterial,
  vaultMaterialIds,
  vaultStoredCount,
} from '../src/sim/materials_vault';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { tSim } from '../src/ui/sim_i18n';
import { predictVaultDepositAll } from '../src/ui/vault_view';
import { COMMAND_NAMES } from '../src/world_api';

// The five-rung ladder, pinned as literals (never compared to the exported table,
// which would be a zero-protection self-comparison). Rung 0 IS the unlock.
const PRICES = [20000, 50000, 100000, 200000, 400000];
const LADDER_TOTAL = 770000; // 20000 + 50000 + 100000 + 200000 + 400000
const CAPS = [40, 80, 120, 160, 200]; // 40 per purchased rung
const UNLOCK_NOTICE = 'You unlock the Materials Vault.';
const UPGRADE_NOTICE = 'You upgrade the Materials Vault.';
const TOO_FAR = 'You are too far from the banker.';
const LOCKED = 'You have not unlocked the Materials Vault.';
const NOT_A_MATERIAL = 'Only materials can be stored in the Materials Vault.';
const NO_HEADROOM = 'Your vault cannot hold any more of that material.';
const BAGS_FULL = 'Your bags are full.';

// The three Gilded Strongbox bursars (banker NPCs), one per town hub. The vault is
// sold and served at the same NPCs as the slot bank.
const BANKERS = ['bursar_fernando', 'bursar_petra_vell', 'bursar_aldous_crane'] as const;

// Vault command tests need real banker definitions and terrain, not the hundreds of
// unrelated ambient entities the full continent spawns (the bank suite's trimmed
// world, for the same reason: Sim construction would otherwise dominate the run).
const VAULT_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: Object.fromEntries(BANKERS.map((id) => [id, BUILTIN_WORLD.npcs[id]])),
  groundObjects: [],
};

// Resolve a banker's LIVE entity by templateId: content coords run through
// findSafePos/groundPos at spawn, so the runtime position can differ from the
// authored one. Every proximity move reads the live pos, never the content coord.
function bankerEntity(sim: Sim, templateId: string = BANKERS[0]): Entity {
  for (const e of sim.entities.values()) {
    if (e.kind === 'npc' && e.templateId === templateId) return e;
  }
  throw new Error(`banker ${templateId} is not spawned in the world`);
}

// Stand a player on top of a banker (well within reach) and rebucket so the
// proximity scan sees them.
function moveToBanker(sim: Sim, pid = sim.playerId, templateId: string = BANKERS[0]): Entity {
  const banker = bankerEntity(sim, templateId);
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { ...banker.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  return banker;
}

// Place a player far from every banker (2D distance only; the reach check ignores y).
function moveFarFromBankers(sim: Sim, pid = sim.playerId): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos = { x: 500, y: p.pos.y, z: 500 };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

// A fresh world whose default player already stands at a banker: the proximity gate
// refuses every vault command otherwise, and the rule-matrix suites below never read
// position (the far-refusal cases move away explicitly).
const makeSim = (seed = 42) => {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    world: VAULT_TEST_WORLD,
  });
  moveToBanker(sim);
  return sim;
};
const meta = (sim: Sim, pid = sim.playerId) => sim.meta(pid)!;
type Meta = ReturnType<typeof meta>;

// A multiplayer world (no default player), for the cases that need a pid.
const makeVaultWorld = (seed = 42) =>
  new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: VAULT_TEST_WORLD });

// Distinct gear ids (stackSize 1) for filling bags with non-mergeable entries.
const GEAR_IDS = Object.values(ITEMS)
  .filter((d) => d.kind === 'weapon' || d.kind === 'armor')
  .map((d) => d.id);

// Fill every free bag slot with distinct 1-per-slot gear so the next add has no home.
function fillBags(sim: Sim, pid = sim.playerId): void {
  const m = meta(sim, pid);
  const cap = bagCapacity(m.bags);
  let i = 0;
  while (m.inventory.length < cap) {
    sim.addItem(GEAR_IDS[i % GEAR_IDS.length], 1, pid);
    i++;
  }
}

const hasErr = (evs: { type: string; text?: string }[], text: string) =>
  evs.some((e) => e.type === 'error' && e.text === text);
const hasLog = (evs: { type: string; text?: string }[], text: string) =>
  evs.some((e) => e.type === 'log' && e.text === text);
// A clean SUCCESS is pinned as "no error line", never as "no events at all": the
// shared banker-business path can legitimately emit a deed unlock on the same call,
// and an unrelated toast must not be able to redden a success assertion.
const errorTexts = (evs: { type: string; text?: string }[]) =>
  evs.filter((e) => e.type === 'error').map((e) => e.text ?? '');

const clone = <T>(v: T): T => structuredClone(v);

// Blank out comments while preserving line structure, so a comment quoting an
// import form or a command token can never be scanned as a real one (the
// stripComments precedent in tests/architecture.test.ts and
// tests/command_schema.test.ts). Shared by both source scans below.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// The item-safety covenant, mechanized: carried copies plus vaulted copies of one id.
function totalHeld(m: Meta, itemId: string): number {
  const carried = m.inventory.reduce((n, s) => (s.itemId === itemId ? n + s.count : n), 0);
  return carried + vaultStoredCount(m.vault, itemId);
}
const carriedCount = (m: Meta, itemId: string) =>
  m.inventory.reduce((n, s) => (s.itemId === itemId ? n + s.count : n), 0);
const slotIndexOf = (m: Meta, itemId: string) => m.inventory.findIndex((s) => s.itemId === itemId);

// ---------------------------------------------------------------------------
describe('vault ladder constants and capacity math', () => {
  it('the upgrade ladder, base cap, and step are the pinned literals', () => {
    expect([...VAULT_UPGRADE_PRICES]).toEqual([20000, 50000, 100000, 200000, 400000]);
    expect(VAULT_UPGRADE_PRICES.length).toBe(5);
    expect(VAULT_BASE_CAP).toBe(40);
    expect(VAULT_UPGRADE_STEP).toBe(40);
  });

  it('vaultCapacityPerMaterial is 0 while locked, then 40 more per purchased rung', () => {
    const caps = [0, 1, 2, 3, 4, 5].map((upgrades) =>
      vaultCapacityPerMaterial({ stock: {}, upgrades }),
    );
    expect(caps).toEqual([0, 40, 80, 120, 160, 200]);
    // The stock never feeds the capacity: a stuffed vault has the same cap as an
    // empty one at the same rung.
    expect(vaultCapacityPerMaterial({ stock: { copper_ore: 999 }, upgrades: 1 })).toBe(40);
  });
});

// ---------------------------------------------------------------------------
describe('every vault command is banker-gated', () => {
  it('deposit far from a banker refuses and moves nothing, then succeeds in reach', () => {
    const sim = makeVaultWorld();
    const pid = sim.addPlayer('warrior', 'Depositor');
    const m = meta(sim, pid);
    m.vault.upgrades = 1;
    sim.addItem('copper_ore', 5, pid);
    const before = totalHeld(m, 'copper_ore');

    moveFarFromBankers(sim, pid);
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    const copperSnap = m.copper;
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), undefined, pid);
    expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
    expect(m.copper).toBe(copperSnap);
    expect(totalHeld(m, 'copper_ore')).toBe(before);

    moveToBanker(sim, pid, 'bursar_fernando');
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), undefined, pid);
    expect(m.vault.stock.copper_ore).toBe(5);
    expect(carriedCount(m, 'copper_ore')).toBe(0);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('withdraw far from a banker refuses and moves nothing, then succeeds in reach', () => {
    const sim = makeVaultWorld();
    const pid = sim.addPlayer('warrior', 'Withdrawer');
    const m = meta(sim, pid);
    m.vault = { stock: { copper_ore: 7 }, special: [], upgrades: 1 };
    const before = totalHeld(m, 'copper_ore');

    moveFarFromBankers(sim, pid);
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    const copperSnap = m.copper;
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore', undefined, pid);
    expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
    expect(m.copper).toBe(copperSnap);
    expect(totalHeld(m, 'copper_ore')).toBe(before);

    moveToBanker(sim, pid, 'bursar_fernando');
    sim.vaultWithdraw('copper_ore', undefined, pid);
    expect(carriedCount(m, 'copper_ore')).toBe(7);
    expect(m.vault.stock).toEqual({}); // fully drained: the key is DELETED, not zeroed
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('buying an upgrade far from a banker refuses and charges nothing, then succeeds in reach', () => {
    const sim = makeVaultWorld();
    const pid = sim.addPlayer('warrior', 'Buyer');
    const m = meta(sim, pid);
    m.copper = 20000; // exactly the unlock price

    moveFarFromBankers(sim, pid);
    sim.drainEvents();
    sim.vaultBuyUpgrade(pid);
    expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
    expect(m.copper).toBe(20000);
    expect(m.vault.upgrades).toBe(0);

    moveToBanker(sim, pid, 'bursar_fernando');
    sim.drainEvents();
    sim.vaultBuyUpgrade(pid);
    expect(hasLog(sim.drainEvents(), UNLOCK_NOTICE)).toBe(true);
    expect(m.copper).toBe(0);
    expect(m.vault.upgrades).toBe(1);
  });

  // The gate applies at ALL THREE hubs, not just the one the shared setup uses.
  for (const templateId of BANKERS) {
    it(`deposit is gated by proximity at ${templateId}`, () => {
      const sim = makeVaultWorld();
      const pid = sim.addPlayer('warrior', 'Traveler');
      const m = meta(sim, pid);
      m.vault.upgrades = 1;
      sim.addItem('copper_ore', 3, pid);

      moveFarFromBankers(sim, pid);
      sim.drainEvents();
      sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), undefined, pid);
      expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
      expect(m.vault.stock).toEqual({});
      expect(carriedCount(m, 'copper_ore')).toBe(3);

      moveToBanker(sim, pid, templateId);
      sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), undefined, pid);
      expect(m.vault.stock).toEqual({ copper_ore: 3 });
      expect(carriedCount(m, 'copper_ore')).toBe(0);
    });
  }

  it('a dead player at a banker is a SILENT no-op on all three commands', () => {
    // The market/mail town-service idiom the bank already follows: death precedes
    // the proximity gate, so a corpse gets no refusal line at all.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 6 }, special: [], upgrades: 1 };
    m.copper = LADDER_TOTAL;
    sim.addItem('iron_ore', 4);
    sim.player.dead = true;
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'iron_ore'));
    sim.vaultWithdraw('copper_ore');
    sim.vaultBuyUpgrade();
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
    expect(m.copper).toBe(LADDER_TOTAL);
  });
});

// ---------------------------------------------------------------------------
describe('buying vault upgrades', () => {
  it('walks all five rungs, charging the exact table price and adding 40 cap each time', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = LADDER_TOTAL;
    let copper = LADDER_TOTAL;
    expect(vaultCapacityPerMaterial(m.vault)).toBe(0); // locked until rung 0 is bought
    for (let rung = 0; rung < 5; rung++) {
      sim.drainEvents();
      sim.vaultBuyUpgrade();
      const evs = sim.drainEvents();
      // Rung 0 is the UNLOCK and says so; rungs 1-4 are ordinary upgrades.
      expect(hasLog(evs, rung === 0 ? UNLOCK_NOTICE : UPGRADE_NOTICE)).toBe(true);
      expect(hasLog(evs, rung === 0 ? UPGRADE_NOTICE : UNLOCK_NOTICE)).toBe(false);
      copper -= PRICES[rung];
      expect(m.copper).toBe(copper);
      expect(m.vault.upgrades).toBe(rung + 1);
      expect(vaultCapacityPerMaterial(m.vault)).toBe(CAPS[rung]);
    }
    expect(m.copper).toBe(0);
    expect(m.vault.upgrades).toBe(5);
    expect(vaultCapacityPerMaterial(m.vault)).toBe(200);
  });

  it('refuses a sixth purchase once the ladder is finished, charging nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = LADDER_TOTAL + 999999; // plenty left over: only the cap can refuse
    for (let rung = 0; rung < 5; rung++) sim.vaultBuyUpgrade();
    expect(m.vault.upgrades).toBe(5);
    const copperBefore = m.copper;
    sim.drainEvents();
    sim.vaultBuyUpgrade();
    expect(hasErr(sim.drainEvents(), 'Your vault cannot be upgraded further.')).toBe(true);
    expect(m.copper).toBe(copperBefore);
    expect(m.vault.upgrades).toBe(5);
    expect(vaultCapacityPerMaterial(m.vault)).toBe(200);
  });

  it('refuses an unaffordable unlock, charging nothing and granting no rung', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = 19999; // one copper short of the 20000 unlock
    sim.drainEvents();
    sim.vaultBuyUpgrade();
    expect(hasErr(sim.drainEvents(), 'You cannot afford that vault upgrade.')).toBe(true);
    expect(m.copper).toBe(19999);
    expect(m.vault.upgrades).toBe(0);
    expect(vaultCapacityPerMaterial(m.vault)).toBe(0);
  });

  it('charges exactly the next rung price, never a partial charge', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.copper = 20000; // exactly rung 0
    sim.vaultBuyUpgrade();
    expect(m.copper).toBe(0);
    expect(m.vault.upgrades).toBe(1);
    // Rung 1 costs 50000: at 49999 it must refuse and leave the rung at 1.
    m.copper = 49999;
    sim.drainEvents();
    sim.vaultBuyUpgrade();
    expect(hasErr(sim.drainEvents(), 'You cannot afford that vault upgrade.')).toBe(true);
    expect(m.copper).toBe(49999);
    expect(m.vault.upgrades).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('deposit rules', () => {
  it('refuses every deposit while the vault is locked, moving nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('copper_ore', 5);
    const before = totalHeld(m, 'copper_ore');
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'));
    expect(hasErr(sim.drainEvents(), LOCKED)).toBe(true);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault.stock).toEqual({});
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('refuses a non-material junk item even at full rung, moving nothing', () => {
    // guardian_core is kind junk like the ores, but it is in no material source
    // table, so the kind alone must never admit it.
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 5;
    sim.addItem('guardian_core', 2);
    const before = totalHeld(m, 'guardian_core');
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'guardian_core'));
    expect(hasErr(sim.drainEvents(), NOT_A_MATERIAL)).toBe(true);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault.stock).toEqual({});
    expect(totalHeld(m, 'guardian_core')).toBe(before);
  });

  it('answers the MATERIAL refusal before the locked one when both apply', () => {
    // Refusal precedence, which a matrix of independent cases cannot pin: the
    // material gate runs BEFORE the unlock gate, so a player whose vault is still
    // locked and who offers a non-material hears "Only materials", never "not
    // unlocked". Both arms are checked, so a reordering reddens either way.
    const sim = makeSim();
    const m = meta(sim);
    expect(m.vault.upgrades).toBe(0); // locked: the OTHER refusal is live too
    sim.addItem('guardian_core', 1);
    const before = totalHeld(m, 'guardian_core');
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'guardian_core'));
    const evs = sim.drainEvents();
    expect(hasErr(evs, NOT_A_MATERIAL)).toBe(true);
    expect(hasErr(evs, LOCKED)).toBe(false);
    expect(m.vault.stock).toEqual({});
    expect(totalHeld(m, 'guardian_core')).toBe(before);
  });

  it('refuses a quest-kind item, which is not a material either', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 5;
    sim.addItem('boar_hide', 1); // kind: 'quest'
    const before = totalHeld(m, 'boar_hide');
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'boar_hide'));
    expect(hasErr(sim.drainEvents(), NOT_A_MATERIAL)).toBe(true);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault.stock).toEqual({});
    expect(totalHeld(m, 'boar_hide')).toBe(before);
  });

  it('preserves a material slot carrying an instance payload in special storage', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 5;
    const bagBase = clone(m.inventory);
    m.inventory.push({ itemId: 'copper_ore', count: 3, instance: { signer: 'Ana' } });
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultDeposit(m.inventory.findIndex((s) => s.instance !== undefined));
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.inventory).toEqual(bagBase);
    expect(m.vault.stock).toEqual({});
    expect(m.vault.special).toEqual([
      { itemId: 'copper_ore', count: 3, instance: { signer: 'Ana' } },
    ]);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('preserves a material slot carrying a craftedRecipeId marker', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 5;
    const bagBase = clone(m.inventory);
    sim.addItem('copper_ore', 4, sim.playerId, { craftedRecipeId: 'recipe_test_crafted' });
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultDeposit(m.inventory.findIndex((s) => s.craftedRecipeId !== undefined));
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.inventory).toEqual(bagBase);
    expect(m.vault.stock).toEqual({});
    expect(m.vault.special).toEqual([
      {
        itemId: 'copper_ore',
        count: 4,
        craftedRecipeId: 'recipe_test_crafted',
      },
    ]);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('deposits a whole stack (count undefined), emptying the carried slot', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 1;
    sim.addItem('copper_ore', 12);
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'));
    expect(errorTexts(sim.drainEvents())).toEqual([]); // a clean success refuses nothing
    expect(m.vault.stock).toEqual({ copper_ore: 12 });
    expect(m.inventory.some((s) => s.itemId === 'copper_ore')).toBe(false);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('deposits an exact partial count, decrementing the carried stack', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 1;
    sim.addItem('copper_ore', 10);
    const before = totalHeld(m, 'copper_ore');
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), 3);
    expect(m.vault.stock).toEqual({ copper_ore: 3 });
    expect(carriedCount(m, 'copper_ore')).toBe(7);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('accumulates repeat deposits of the same material into one stock entry', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 1;
    sim.addItem('copper_ore', 8);
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), 5);
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), 3);
    expect(m.vault.stock).toEqual({ copper_ore: 8 });
    expect(carriedCount(m, 'copper_ore')).toBe(0);
  });

  it('keeps each material on its OWN capacity, never a shared budget', () => {
    // The whole point of the vault: filling copper_ore to its cap leaves iron_ore
    // completely unaffected.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 40 }, special: [], upgrades: 1 };
    sim.addItem('iron_ore', 9);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'iron_ore'));
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({ copper_ore: 40, iron_ore: 9 });
  });

  it('a partial deposit up to the headroom is a SUCCESS, leaving the remainder carried', () => {
    // Cap 40 with 30 stored leaves room for 10; a 20-stack deposit moves exactly
    // 10 and emits NO error (the bank's all-or-nothing rule deliberately does NOT
    // apply here: a material is fungible, so a partial move loses nothing).
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 30 }, special: [], upgrades: 1 };
    sim.addItem('copper_ore', 20);
    const before = totalHeld(m, 'copper_ore');
    expect(before).toBe(50);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'));
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({ copper_ore: 40 });
    expect(carriedCount(m, 'copper_ore')).toBe(10);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('refuses a deposit at exactly zero headroom, moving nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 40 }, special: [], upgrades: 1 }; // sitting exactly on the cap
    sim.addItem('copper_ore', 5);
    const before = totalHeld(m, 'copper_ore');
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'));
    expect(hasErr(sim.drainEvents(), NO_HEADROOM)).toBe(true);
    expect(m.vault.stock).toEqual({ copper_ore: 40 });
    expect(m.inventory).toEqual(bagSnap);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('treats a bad slot index or a malformed count as a SILENT no-op', () => {
    // Deposit follows the bank's count normalization exactly: a non-positive or
    // OVER-stack count is malformed input (cheat or desync), refused with no
    // player line and no partial move. Note the deliberate asymmetry with
    // withdraw, which clamps an over-count instead (pinned in its own case below).
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 1;
    sim.addItem('copper_ore', 5);
    const before = totalHeld(m, 'copper_ore');
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    const idx = slotIndexOf(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultDeposit(-1);
    sim.vaultDeposit(999);
    sim.vaultDeposit(1.5);
    sim.vaultDeposit(idx, 0);
    sim.vaultDeposit(idx, -2);
    sim.vaultDeposit(idx, 6); // count > the carried stack (5)
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('keeps malformed input SILENT even while the vault is LOCKED (count check precedes the gate)', () => {
    // The module's own precedence rule: count/slot normalization runs AHEAD of
    // the locked gate, so cheat/desync input never leaks the locked line. A
    // regression that moved validation after the gate would emit LOCKED here.
    const sim = makeSim();
    const m = meta(sim);
    expect(m.vault.upgrades).toBe(0); // still locked: the precondition this pins
    sim.addItem('copper_ore', 5);
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    const idx = slotIndexOf(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultDeposit(-1);
    sim.vaultDeposit(idx, 0);
    sim.vaultDeposit(idx, -2);
    sim.vaultDeposit(idx, 6); // count > the carried stack (5)
    // No LOCKED line (nor any other error): pinned via errorTexts per the
    // file's own convention, never as "no events at all".
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
  });

  it('floors an in-range fractional count on both moves (a fractional count can never persist)', () => {
    // The dispatch gate is typeof-only, so a wire count of 2.5 reaches the sim.
    // Without the floor, deposit would write fractional stock and decrement the
    // carried slot fractionally; sanitize floors 2.5 to 2 on the NEXT load, so
    // the missing floor would destroy half an item one relog later (the covenant
    // sin arriving on a delay). Integerness is asserted, not just the totals.
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 1;
    sim.addItem('copper_ore', 10);
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), 2.5);
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({ copper_ore: 2 });
    expect(carriedCount(m, 'copper_ore')).toBe(8);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
    sim.vaultWithdraw('copper_ore', 1.5);
    expect(m.vault.stock).toEqual({ copper_ore: 1 });
    expect(carriedCount(m, 'copper_ore')).toBe(9);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
    expect(Number.isInteger(m.vault.stock.copper_ore)).toBe(true);
    for (const s of m.inventory) expect(Number.isInteger(s.count)).toBe(true);
  });

  it('a corrupt STORED count cannot mint through the targeted deposit (both arms)', () => {
    // The deposit-direction twin of sanitizeVaultState's withdraw-dupe clamp,
    // closed by this phase's QA. Two reproduced faucets: (a) whole-stack on a
    // past-precision count adopts want = slot.count = 1e21, moves real
    // headroom into the vault, and the decrement is a float no-op (the stack
    // never drops: an unbounded faucet); (b) an EXPLICIT count against a NaN
    // stored count passes the range check (want > NaN is false) and mints
    // per call while the stack stays NaN forever. Both now refuse silently
    // on the stored count's own sanity arm.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 };
    m.inventory.push({ itemId: 'copper_ore', count: 1e21 });
    m.inventory.push({ itemId: 'rough_hide', count: Number.NaN });
    m.inventory.push({ itemId: 'ashwood_log', count: Number.POSITIVE_INFINITY });
    m.inventory.push({ itemId: 'wolf_fang', count: 2.5 }); // fractional: delayed destruction
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore')); // (a) whole-stack, 1e21
    sim.vaultDeposit(slotIndexOf(m, 'rough_hide'), 10); // (b) explicit count vs NaN
    sim.vaultDeposit(slotIndexOf(m, 'ashwood_log'), 10); // (b) explicit count vs Infinity
    sim.vaultDeposit(slotIndexOf(m, 'wolf_fang')); // (c) whole-stack, fractional
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({}); // nothing minted
    expect(m.inventory).toEqual(bagSnap); // corrupt slots untouched, recoverable
  });

  it('un-credits an active collect objective on deposit and re-credits it on withdraw', () => {
    // Six live collect objectives target honest vault materials (copper_ore,
    // game_meat, spider_silk, ironbark_log, rough_hide, goldleaf_herb: all
    // junk-kind, so the deposit accepts them), which is exactly why BOTH
    // recompute pokes are load-bearing for current content, not defensive.
    // Pin BOTH directions with a synthetic collect quest over a real
    // material (the bank suite's __bank_uncredit recipe).
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 1;
    QUESTS.__vault_uncredit = {
      ...QUESTS.q_widows,
      id: '__vault_uncredit',
      objectives: [{ type: 'collect', itemId: 'copper_ore', count: 5, label: 'Copper Ore' }],
    };
    try {
      m.questLog.set('__vault_uncredit', {
        questId: '__vault_uncredit',
        counts: [0],
        state: 'active',
      });
      sim.addItem('copper_ore', 5); // the add-side recompute credits and readies it
      expect(m.questLog.get('__vault_uncredit')).toMatchObject({ counts: [5], state: 'ready' });
      sim.vaultDeposit(slotIndexOf(m, 'copper_ore'));
      expect(m.questLog.get('__vault_uncredit')).toMatchObject({ counts: [0], state: 'active' });
      sim.vaultWithdraw('copper_ore', 5);
      expect(m.questLog.get('__vault_uncredit')).toMatchObject({ counts: [5], state: 'ready' });
    } finally {
      delete QUESTS.__vault_uncredit;
    }
  });

  it('the SWEEP un-credits a collect objective with ONE recompute for the whole batch', () => {
    // The one-recompute-at-end contract: the sweep moves two quest-counted
    // materials in one command, the collect counter drops for both, and the
    // recompute ran exactly once (pinned by spying the ctx callback; moving
    // it inside the loop would fire per moved stack, an observable host-facing
    // cadence change even though the final state would agree).
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 };
    QUESTS.__vault_uncredit = {
      ...QUESTS.q_widows,
      id: '__vault_uncredit',
      objectives: [{ type: 'collect', itemId: 'copper_ore', count: 5, label: 'Copper Ore' }],
    };
    try {
      m.questLog.set('__vault_uncredit', {
        questId: '__vault_uncredit',
        counts: [0],
        state: 'active',
      });
      sim.addItem('copper_ore', 5);
      sim.addItem('rough_hide', 3); // a second moved material: still ONE recompute
      expect(m.questLog.get('__vault_uncredit')).toMatchObject({ counts: [5], state: 'ready' });
      const recompute = vi.spyOn(sim.ctx, 'onInventoryChangedForQuests');
      sim.vaultDepositAll();
      expect(recompute).toHaveBeenCalledTimes(1);
      recompute.mockRestore();
      expect(m.vault.stock).toEqual({ copper_ore: 5, rough_hide: 3 });
      expect(m.questLog.get('__vault_uncredit')).toMatchObject({ counts: [0], state: 'active' });
    } finally {
      delete QUESTS.__vault_uncredit;
    }
  });
});

// ---------------------------------------------------------------------------
describe('withdraw rules', () => {
  it('withdraws the whole stock back into the bags', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 15 }, special: [], upgrades: 1 };
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore');
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({}); // fully drained: the key is DELETED, not zeroed
    expect(sim.countItem('copper_ore')).toBe(15);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('withdraws an exact partial count, decrementing the stock', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 15 }, special: [], upgrades: 1 };
    const before = totalHeld(m, 'copper_ore');
    sim.vaultWithdraw('copper_ore', 4);
    expect(m.vault.stock).toEqual({ copper_ore: 11 });
    expect(sim.countItem('copper_ore')).toBe(4);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('arrives under the normal bag stacking rules, topping up then opening a new slot', () => {
    // copper_ore stacks to 20: 15 carried plus a 10 withdrawal must fill the
    // carried stack to 20 and split the remaining 5 into a second slot, exactly
    // like any other addStacked grant.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 10 }, special: [], upgrades: 1 };
    sim.addItem('copper_ore', 15);
    const before = totalHeld(m, 'copper_ore');
    sim.vaultWithdraw('copper_ore');
    expect(m.inventory.filter((s) => s.itemId === 'copper_ore').map((s) => s.count)).toEqual([
      20, 5,
    ]);
    expect(m.vault.stock).toEqual({});
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('CLAMPS an over-count to the stored amount instead of refusing it', () => {
    // The deliberate asymmetry with deposit: deposit indexes a concrete carried
    // slot, so an over-count there is malformed input, but a withdraw names an id
    // whose stock the client only ever knew a snapshot ago, so an over-count is
    // an ordinary stale read and takes everything stored rather than nothing.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 6 }, special: [], upgrades: 1 };
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore', 99);
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({}); // fully drained: the key is DELETED, not zeroed
    expect(sim.countItem('copper_ore')).toBe(6);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('treats a non-positive count as a SILENT no-op', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 6 }, special: [], upgrades: 1 };
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore', 0);
    sim.vaultWithdraw('copper_ore', -4);
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
  });

  it('treats an unknown or absent itemId as a SILENT no-op', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 5 }, special: [], upgrades: 1 };
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    sim.drainEvents();
    sim.vaultWithdraw('totally_unknown_item');
    sim.vaultWithdraw('iron_ore'); // a real material the vault does not hold
    sim.vaultWithdraw('');
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
  });

  it('treats a prototype-named itemId with NO own row as a SILENT no-op, minting nothing', () => {
    // Withdraw is un-gated on the material set (R4), so a hostile itemId reaches
    // the stock read directly. Without the hasOwn guard, 'constructor' or
    // 'toString' would read an INHERITED function off Object.prototype; this
    // pins that no inherited value can ever be mistaken for held stock. (The
    // own-row '__proto__' drain, the recoverability half, is pinned in the
    // sanitization suite below.)
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 5 }, special: [], upgrades: 1 };
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    sim.drainEvents();
    sim.vaultWithdraw('constructor');
    sim.vaultWithdraw('toString');
    sim.vaultWithdraw('hasOwnProperty');
    sim.vaultWithdraw('__proto__'); // no own row here: the accessor returns an object
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
    expect(carriedCount(m, 'constructor')).toBe(0);
    expect(carriedCount(m, 'toString')).toBe(0);
  });

  it('refuses a withdraw into full bags with the existing bags-full line, moving nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 6 }, special: [], upgrades: 1 };
    fillBags(sim);
    const before = totalHeld(m, 'copper_ore');
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore');
    expect(hasErr(sim.drainEvents(), BAGS_FULL)).toBe(true);
    expect(m.vault.stock).toEqual({ copper_ore: 6 });
    expect(m.inventory).toEqual(bagSnap);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('a partial withdraw up to the bag fit is a SUCCESS, leaving the rest stored', () => {
    // Bags full except one copper_ore stack at 18 (room for exactly 2 more): a
    // 10-count withdrawal moves exactly 2 and leaves 8 in the vault.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 10 }, special: [], upgrades: 1 };
    fillBags(sim);
    m.inventory[m.inventory.length - 1] = { itemId: 'copper_ore', count: 18 };
    // Fixture preconditions: no free slot at all, and the one copper_ore stack has
    // room for exactly 2 more (18 of a 20 stack).
    expect(m.inventory.length).toBe(bagCapacity(m.bags));
    expect(m.inventory.filter((s) => s.itemId === 'copper_ore')).toEqual([
      { itemId: 'copper_ore', count: 18 },
    ]);
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore');
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({ copper_ore: 8 });
    expect(carriedCount(m, 'copper_ore')).toBe(20);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  // ---------------------------------------------------------------------------
  // The two-pool split AT the vaultWithdraw boundary (phase 05 made its countFit
  // take bagPools(meta.bags) instead of a flat bagCapacity total). The three arms
  // below share one fixture shape: a Forager's Haversack socketed, so the bags are
  // 16 general slots plus 12 materials-only slots.
  //
  // Read the discrimination honestly. vaultWithdraw only ever moves MATERIALS, and
  // for a material the split and the flat total agree on the free-slot count in
  // every within-budget state (both answer "the slots nobody is using"), so the
  // first and third arms are conservation coverage, not revert detectors. The
  // over-capacity arm in the middle is the one shape where they genuinely disagree,
  // and it is what actually reds on a revert to generalOnlyPools(bagCapacity(...)).
  // The wiring itself is pinned beside it in tests/pool_wiring_pins.test.ts.
  it('lands a withdrawal in satchel headroom, decrementing the stock exactly', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('foragers_haversack', 1);
    sim.equipBag('foragers_haversack', 0);
    // Fixture preconditions, pinned as literals so a backpack or satchel resize
    // fails HERE rather than quietly turning the arm vacuous.
    expect(bagPools(m.bags)).toEqual({ general: 16, materials: 12 });
    // General exactly full with distinct 1-per-slot gear: no free slot and no stack
    // to top up, and not one gear id is in the derived material set, so the only
    // headroom left in the bags is materials-only.
    m.inventory = GEAR_IDS.slice(0, 16).map((id) => ({ itemId: id, count: 1 }));
    m.vault = { stock: { copper_ore: 15 }, special: [], upgrades: 1 };
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore');
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({}); // fully drained: the key is DELETED, not zeroed
    expect(carriedCount(m, 'copper_ore')).toBe(15);
    expect(m.inventory).toHaveLength(17); // one materials-pool slot now occupied
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('pays out the full materials pool while the GENERAL pool sits over budget', () => {
    // The one state that tells the split from the flat total on a materials-only
    // command. 20 carried gear against a 16-slot general pool is the tolerated
    // over-capacity bag_pools.ts documents (a swapped-down bag, a legacy save):
    // never repaired, never destructive. The split still grants the satchel's 12
    // free slots to materials (12 * 20 = 240 units of headroom, so all 180 land and
    // total occupancy legitimately passes the summed budget), while the flat total
    // would see only 28 - 20 = 8 free slots and strand 20 units in the vault.
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('foragers_haversack', 1);
    sim.equipBag('foragers_haversack', 0);
    expect(bagPools(m.bags)).toEqual({ general: 16, materials: 12 });
    m.inventory = GEAR_IDS.slice(0, 20).map((id) => ({ itemId: id, count: 1 }));
    expect(m.inventory.length).toBeGreaterThan(16); // general pool over budget
    // copper_ore stacks to 20, so 180 is exactly 9 fresh slots: it fits the split's
    // 12 free materials slots whole and does NOT fit the flat total's 8.
    m.vault = { stock: { copper_ore: 180 }, special: [], upgrades: 5 };
    // The revert this arm exists to catch, made EXECUTABLE rather than asserted in
    // prose: on this exact fixture the pre-phase-05 flat total pays out only 160,
    // so the full 180 below can only come from the split. If a backpack, satchel,
    // or stack-size change ever made the two shapes agree here, this line reds
    // instead of the arm quietly going vacuous.
    expect(countFit(m.inventory, generalOnlyPools(bagCapacity(m.bags)), 'copper_ore', 180)).toBe(
      160,
    );
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore');
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({}); // nothing stranded: the flat total leaves 20
    expect(carriedCount(m, 'copper_ore')).toBe(180);
    expect(m.inventory).toHaveLength(29); // 20 gear + 9 full copper_ore stacks
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('refuses when BOTH pools are full, leaving the stock intact', () => {
    // Materials headroom is headroom, not a free pass: with the satchel's 12 slots
    // occupied by other materials and the general pool full too, the withdrawal is
    // refused on the shared bags-full line and the vault keeps every unit.
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('foragers_haversack', 1);
    sim.equipBag('foragers_haversack', 0);
    // The same precondition its two sibling arms carry. Without it, a lost
    // materialsOnly flag would collapse the satchel into the general pool, the 28
    // items loaded below would fill that one flat budget instead, and the refusal
    // this arm asserts would still happen, for the WRONG reason: green, and blind to
    // exactly the regression the split exists to catch.
    expect(bagPools(m.bags)).toEqual({ general: 16, materials: 12 });
    const fillers = [...MATERIAL_ITEM_IDS].filter((id) => id !== 'copper_ore').slice(0, 12);
    expect(fillers).toHaveLength(12); // enough distinct materials to fill the satchel
    m.inventory = [
      ...GEAR_IDS.slice(0, 16).map((id) => ({ itemId: id, count: 1 })),
      ...fillers.map((id) => ({ itemId: id, count: 1 })),
    ];
    expect(m.inventory).toHaveLength(bagCapacity(m.bags)); // both pools exactly full
    m.vault = { stock: { copper_ore: 6 }, special: [], upgrades: 1 };
    const before = totalHeld(m, 'copper_ore');
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore');
    expect(hasErr(sim.drainEvents(), BAGS_FULL)).toBe(true);
    expect(m.vault.stock).toEqual({ copper_ore: 6 });
    expect(m.inventory).toEqual(bagSnap);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('withdraws from a LOCKED vault: stored items are never trapped', () => {
    // Withdraw deliberately does NOT gate on the unlock. A vault that shrank back
    // to locked (a tampered or rolled-back save) must still hand its stock back.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = sanitizeVaultState({ stock: { copper_ore: 9 }, upgrades: 0 });
    expect(m.vault.upgrades).toBe(0);
    expect(vaultCapacityPerMaterial(m.vault)).toBe(0);
    const before = totalHeld(m, 'copper_ore');
    sim.drainEvents();
    sim.vaultWithdraw('copper_ore');
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(sim.countItem('copper_ore')).toBe(9);
    expect(m.vault.stock).toEqual({}); // fully drained: the key is DELETED, not zeroed
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });

  it('withdraws a NON-material id the sanitizer kept, for the same reason', () => {
    // Withdraw does not gate on the material set either: whatever a save put in
    // the stock comes back out, or the item is destroyed by a taxonomy change.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = sanitizeVaultState({ stock: { guardian_core: 3 }, upgrades: 1 });
    expect(m.vault.stock).toEqual({ guardian_core: 3 });
    const before = totalHeld(m, 'guardian_core');
    sim.drainEvents();
    sim.vaultWithdraw('guardian_core');
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(sim.countItem('guardian_core')).toBe(3);
    expect(m.vault.stock).toEqual({});
    expect(totalHeld(m, 'guardian_core')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('the vaultInfo read boundary', () => {
  it('is null away from a banker and non-null in reach', () => {
    const sim = makeSim();
    expect(sim.vaultInfo).not.toBeNull();
    moveFarFromBankers(sim);
    expect(sim.vaultInfo).toBeNull();
    expect(sim.vaultInfoFor(sim.playerId)).toBeNull();
  });

  it('clones the stock at the read boundary: mutating the view never touches sim state', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 12, iron_ore: 3 }, special: [], upgrades: 2 };
    const info = sim.vaultInfoFor(sim.playerId);
    expect(info).not.toBeNull();
    info!.stock.copper_ore = 999;
    info!.stock.injected_id = 42;
    delete info!.stock.iron_ore;
    // A shallow hand-back would have aliased the live map here.
    expect(m.vault.stock).toEqual({ copper_ore: 12, iron_ore: 3 });
    expect(sim.vaultInfoFor(sim.playerId)!.stock).toEqual({ copper_ore: 12, iron_ore: 3 });
  });

  it('reports the cap and the next rung price, going null once the ladder is done', () => {
    const sim = makeSim();
    const m = meta(sim);
    const locked = sim.vaultInfoFor(sim.playerId)!;
    expect(locked.upgrades).toBe(0);
    expect(locked.perMaterialCap).toBe(0);
    expect(locked.nextUpgradeCost).toBe(20000);

    m.copper = LADDER_TOTAL;
    sim.vaultBuyUpgrade();
    const unlocked = sim.vaultInfoFor(sim.playerId)!;
    expect(unlocked.upgrades).toBe(1);
    expect(unlocked.perMaterialCap).toBe(40);
    expect(unlocked.nextUpgradeCost).toBe(50000);

    for (let rung = 1; rung < 5; rung++) sim.vaultBuyUpgrade();
    const maxed = sim.vaultInfoFor(sim.playerId)!;
    expect(maxed.upgrades).toBe(5);
    expect(maxed.perMaterialCap).toBe(200);
    expect(maxed.nextUpgradeCost).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('persistence and back-compat', () => {
  it('round-trips a populated vault deep-equal through serialize -> load -> serialize', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 37, iron_ore: 4 }, special: [], upgrades: 3 };
    m.copper = 4242;

    const s1 = sim.serializeCharacter(sim.playerId)!;
    const sim2 = makeVaultWorld(1);
    const pid2 = sim2.addPlayer('warrior', 'Saver', { state: s1 });
    const s2 = sim2.serializeCharacter(pid2)!;
    // The Book of Deeds legitimately enriches a save across a load (the discovery
    // ledger and back-credited state predicates); everything else round-trips.
    const { deeds: _d1, deedStats: _ds1, renown: _r1, ...rest1 } = s1;
    const { deeds: _d2, deedStats: _ds2, renown: _r2, ...rest2 } = s2;
    expect(rest2).toEqual(rest1);
    expect(s2.vault).toEqual({ stock: { copper_ore: 37, iron_ore: 4 }, upgrades: 3 });
    expect(meta(sim2, pid2).vault).toEqual({
      stock: { copper_ore: 37, iron_ore: 4 },
      special: [],
      upgrades: 3,
    });
  });

  it('writes the vault key unconditionally and as a boundary clone', () => {
    const sim = makeSim();
    const m = meta(sim);
    const empty = sim.serializeCharacter(sim.playerId)!;
    // Even an untouched, still-locked vault is written: a save from this build
    // never relies on the load-side default.
    expect('vault' in empty).toBe(true);
    expect(empty.vault).toEqual({ stock: {}, upgrades: 0 });

    m.vault = { stock: { copper_ore: 5 }, special: [], upgrades: 1 };
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.vault).not.toBe(m.vault);
    expect(state.vault!.stock).not.toBe(m.vault.stock);
    // Mutating the LIVE vault afterwards must not reach into the serialized copy.
    m.vault.stock.copper_ore = 999;
    m.vault.upgrades = 4;
    expect(state.vault).toEqual({ stock: { copper_ore: 5 }, upgrades: 1 });
  });

  it('loads a legacy save with no vault field as an empty LOCKED vault', () => {
    const sim = makeSim();
    const state = sim.serializeCharacter(sim.playerId)!;
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete legacy.vault;
    const sim2 = makeVaultWorld(1);
    let pid = -1;
    expect(() => {
      pid = sim2.addPlayer('warrior', 'Legacy', { state: legacy as never });
    }).not.toThrow();
    expect(meta(sim2, pid).vault).toEqual({ stock: {}, special: [], upgrades: 0 });
    expect(() => sim2.serializeCharacter(pid)).not.toThrow();
    expect(sim2.serializeCharacter(pid)!.vault).toEqual({ stock: {}, upgrades: 0 });
  });
});

// ---------------------------------------------------------------------------
// The tamper matrix, driven through the REAL load path (addPlayer with a doctored
// state) so the load-boundary wiring is itself load-bearing, not just the pure
// sanitizer. Data is TOLERATED, never destroyed: an unrecognized id, a count over
// the current cap, and a shrunken ladder all survive the load, because the only
// safe direction for stored items is out.
describe('vault load-path sanitization', () => {
  const loadWith = (raw: unknown) => {
    const seed = makeSim();
    const state = seed.serializeCharacter(seed.playerId)! as { vault?: unknown };
    state.vault = raw;
    const sim = makeVaultWorld(1);
    const pid = sim.addPlayer('warrior', 'Tampered', { state: state as never });
    return { sim, pid, m: meta(sim, pid) };
  };

  it('keeps an unrecognized item id at its stored count (removed content stays recoverable)', () => {
    const { m } = loadWith({ stock: { totally_unknown_item: 7 }, upgrades: 1 });
    expect(m.vault.stock).toEqual({ totally_unknown_item: 7 });
  });

  it('skips an empty-string key while keeping its siblings', () => {
    const { m } = loadWith({ stock: { '': 4, copper_ore: 6 }, upgrades: 1 });
    expect(m.vault.stock).toEqual({ copper_ore: 6 });
  });

  it('floors a fractional count and SKIPS a row coercing to zero or less', () => {
    // A numeric zero-or-less row states "no items": skipping it creates nothing
    // and destroys nothing, where the bank-style lift-to-1 would MINT a unit
    // from an empty row (the covenant's create-from-nothing sin, and the exact
    // relog-minting hazard if a future consumption writer zeroes instead of
    // deleting).
    const { m } = loadWith({
      stock: { copper_ore: 2.9, iron_ore: -3, ironbark_log: 0, linen_scrap: 0.0001 },
      upgrades: 1,
    });
    // The zero boundary is exact: 0 states an empty row and is skipped, while
    // any POSITIVE fraction is a claim to something and keeps the
    // never-destroy floor of 1 (floor alone would zero it, destroying the
    // claim). One ULP apart, the covenant's two halves point opposite ways;
    // this pins which side each value lands on.
    expect(m.vault.stock).toEqual({ copper_ore: 2, linen_scrap: 1 });
  });

  it('keeps an unparseable count at the floor of 1, reads a numeric string, and skips coerced zeros', () => {
    // Two arms on purpose: 'junk' coerces to NaN (a row that DID hold something,
    // so it keeps the never-destroy floor of 1) and true coerces to 1, while
    // null and [] coerce to 0, which states an EMPTY row and is skipped. A
    // rewrite collapsing the arms reddens one side or the other.
    const { m } = loadWith({
      stock: {
        copper_ore: 'junk',
        iron_ore: null,
        ironbark_log: [],
        linen_scrap: true,
        homespun_cloth: '5',
      },
      upgrades: 1,
    });
    expect(m.vault.stock).toEqual({
      copper_ore: 1,
      linen_scrap: 1,
      homespun_cloth: 5,
    });
  });

  it('clamps a non-finite or past-precision count to MAX_SAFE_INTEGER, closing the withdraw dupe', () => {
    // 1e400 is Infinity in a float64 (what JSON.parse yields for such a jsonb
    // literal) and 1e21 is past 2^53: unclamped, `held - moved` is a float
    // no-op for both, so every withdraw would GRANT items while the stock never
    // dropped, an unlimited printer from one corrupt row. The clamp keeps the
    // subtraction exact; nothing legitimate is truncated (deposits are capped).
    // Built with JSON.parse, the honest shape (a jsonb count arrives exactly
    // this way) and the only lint-clean spelling of a precision-losing literal.
    const { sim, pid, m } = loadWith(
      JSON.parse('{"stock":{"copper_ore":1e400,"iron_ore":1e21},"upgrades":1}'),
    );
    expect(m.vault.stock).toEqual({
      copper_ore: 9007199254740991,
      iron_ore: 9007199254740991,
    });
    moveToBanker(sim, pid);
    sim.vaultWithdraw('iron_ore', 5, pid);
    expect(m.vault.stock.iron_ore).toBe(9007199254740991 - 5); // the decrement is real again
    expect(carriedCount(m, 'iron_ore')).toBe(5);
  });

  it('withdraws an id this build does not know, end to end (dormant stock is never trapped)', () => {
    // The pure-sanitizer arm above proves the unknown id LOADS; this proves the
    // player can actually get it back: withdraw is deliberately un-gated on the
    // material set and the unlock rung, and an unknown def stacks to the
    // DEFAULT_STACK of 20, so 7 arrive as one carried stack.
    const { sim, pid, m } = loadWith({ stock: { totally_unknown_item: 7 }, upgrades: 0 });
    moveToBanker(sim, pid);
    sim.drainEvents();
    sim.vaultWithdraw('totally_unknown_item', undefined, pid);
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({});
    expect(carriedCount(m, 'totally_unknown_item')).toBe(7);
  });

  it('withdraws a dormant __proto__ row end to end: the own key drains, the prototype never changes', () => {
    // The load-side test above proves the hostile row is KEPT as own data; this
    // proves the full drain: the own property shadows the inherited accessor for
    // the read, the delete removes the own key, and the object's prototype is
    // untouched throughout.
    const { sim, pid, m } = loadWith(JSON.parse('{"stock":{"__proto__":3},"upgrades":1}'));
    expect(Object.getOwnPropertyDescriptor(m.vault.stock, '__proto__')?.value).toBe(3);
    // The dormant row must NOT leak into the persisted discovery ledger: the
    // join-time seed walks vault stock, and ITEMS['__proto__'] is truthy via
    // the object prototype, so only the hasOwn guard keeps this out.
    expect(m.deedStats.itemsDiscovered.has('__proto__')).toBe(false);
    moveToBanker(sim, pid);
    sim.vaultWithdraw('__proto__', undefined, pid);
    expect(Object.getOwnPropertyDescriptor(m.vault.stock, '__proto__')).toBeUndefined();
    expect(Object.getPrototypeOf(m.vault.stock)).toBe(Object.prototype);
    expect(carriedCount(m, '__proto__')).toBe(3);
  });

  it('seeds item discovery from vault stock at join (the container walk includes the vault)', () => {
    const fresh = makeSim();
    expect(meta(fresh).deedStats.itemsDiscovered.has('copper_ore')).toBe(false); // non-vacuity control
    const { m } = loadWith({ stock: { copper_ore: 5 }, upgrades: 1 });
    expect(m.deedStats.itemsDiscovered.has('copper_ore')).toBe(true);
  });

  it('seeds vault discoveries in SORTED key order, not blob insertion order', () => {
    // vault.stock is the one persisted per-character record keyed by item id, and
    // Postgres jsonb re-orders object keys while the offline Sim keeps insertion
    // order; the seed walk sorts so the persisted itemsDiscovered insertion order
    // is host-identical. The fixture inserts iron BEFORE copper on purpose: an
    // unsorted walk yields ['iron_ore', 'copper_ore'] here and reddens.
    const { m } = loadWith(JSON.parse('{"stock":{"iron_ore":1,"copper_ore":2},"upgrades":1}'));
    const order = [...m.deedStats.itemsDiscovered].filter(
      (id) => id === 'copper_ore' || id === 'iron_ore',
    );
    expect(order).toEqual(['copper_ore', 'iron_ore']);
  });

  it('keeps a hostile __proto__ row as dormant OWN data, never a prototype write', () => {
    // The sanitizer builds the record with Object.fromEntries rather than keyed
    // assignment precisely so a '__proto__' row DEFINES an own property instead
    // of reaching the prototype setter, where it would both vanish from the stock
    // (an item-safety loss) and reshape the object.
    //
    // The raw is built with JSON.parse, NOT an object literal: in a literal (and
    // on a plain keyed assignment) `__proto__` is the prototype setter and no own
    // property is created at all, so a literal fixture would silently test the
    // empty case. JSON.parse is also the honest shape here, since a real save
    // arrives by parsing JSONB.
    const raw = JSON.parse('{"stock":{"__proto__":4,"copper_ore":2},"upgrades":1}');
    const { m } = loadWith(raw);
    expect(Object.hasOwn(m.vault.stock, '__proto__')).toBe(true);
    expect(Object.keys(m.vault.stock).sort()).toEqual(['__proto__', 'copper_ore']);
    // Read through the descriptor, not `stock.__proto__`: a plain access would go
    // through the inherited accessor if the own row were ever lost, which is the
    // very failure this pins.
    expect(Object.getOwnPropertyDescriptor(m.vault.stock, '__proto__')?.value).toBe(4);
    expect(Object.getPrototypeOf(m.vault.stock)).toBe(Object.prototype);
  });

  it('parses stock and upgrades independently: a junk stock keeps a valid ladder', () => {
    // A malformed stock must not take the rung count down with it (that would
    // silently re-lock a paid-up vault), and a malformed ladder must not discard
    // recoverable stock.
    expect(loadWith({ stock: [1, 2, 3], upgrades: 3 }).m.vault).toEqual({
      stock: {},
      special: [],
      upgrades: 3,
    });
    expect(loadWith({ stock: 'nope', upgrades: 2 }).m.vault).toEqual({
      stock: {},
      special: [],
      upgrades: 2,
    });
    expect(loadWith({ stock: { copper_ore: 5 }, upgrades: 'junk' }).m.vault).toEqual({
      stock: { copper_ore: 5 },
      special: [],
      upgrades: 0,
    });
  });

  it('clamps upgrades into [0, 5] in both directions', () => {
    expect(loadWith({ stock: {}, upgrades: 99 }).m.vault.upgrades).toBe(5);
    expect(loadWith({ stock: {}, upgrades: -3 }).m.vault.upgrades).toBe(0);
    expect(loadWith({ stock: {}, upgrades: 5 }).m.vault.upgrades).toBe(5);
    expect(loadWith({ stock: {}, upgrades: 0 }).m.vault.upgrades).toBe(0);
  });

  it('floors, never rounds, the upgrades coercion (a fraction cannot grant an unpaid rung)', () => {
    // 4.7 must load as 4: rounding up would grant a rung nobody paid for, the
    // covenant's mint sin applied to capacity instead of stock. The boolean and
    // numeric-string arms pin the Number() coercion half of the same line.
    expect(loadWith({ stock: {}, upgrades: 4.7 }).m.vault.upgrades).toBe(4);
    expect(loadWith({ stock: {}, upgrades: true }).m.vault.upgrades).toBe(1);
    expect(loadWith({ stock: {}, upgrades: '3' }).m.vault.upgrades).toBe(3);
  });

  it('is idempotent: sanitizing its own output is a fixed point, tamper matrix included', () => {
    // A second sanitize pass (a double load, or a future migration re-running
    // the load path) must never move a value the first pass settled: floors,
    // clamps, and skips all land in one step.
    const raws: unknown[] = [
      {
        stock: { copper_ore: 2.9, iron_ore: -3, ironbark_log: 0, linen_scrap: 0.0001 },
        upgrades: 1,
      },
      {
        stock: { copper_ore: 'junk', iron_ore: null, linen_scrap: true, homespun_cloth: '5' },
        upgrades: 4.7,
      },
      JSON.parse('{"stock":{"copper_ore":1e400,"iron_ore":1e21},"upgrades":1}'),
      JSON.parse('{"stock":{"__proto__":4,"copper_ore":2},"upgrades":1}'),
      { stock: [1, 2, 3], upgrades: 3 },
      { stock: { totally_unknown_item: 7, '': 4 }, upgrades: 99 },
      42,
      null,
    ];
    for (const raw of raws) {
      const once = sanitizeVaultState(raw, 'T', []);
      expect(sanitizeVaultState(once, 'T', []), `raw ${JSON.stringify(raw)}`).toEqual(once);
    }
  });

  it('a wholesale-dropped wrong-shaped stock leaves a trace in the dropped sink', () => {
    // The array shape is the ONE place tolerance cannot keep the data (it is the
    // bank's slot-list shape, the likely wrong guess in a hand edit), so the drop
    // must be operator-visible via the load-warning sink, never silent. A legacy
    // save with no vault key, and a merely-empty stock, stay traceless.
    const dropped: string[] = [];
    sanitizeVaultState({ stock: [{ itemId: 'copper_ore', count: 5 }], upgrades: 2 }, 'T', dropped);
    expect(dropped).toEqual(['vault.stock:array']);
    sanitizeVaultState({ stock: 'nope', upgrades: 2 }, 'T', dropped);
    expect(dropped).toEqual(['vault.stock:array', 'vault.stock:string']);
    const clean: string[] = [];
    sanitizeVaultState(undefined, 'T', clean);
    sanitizeVaultState({ upgrades: 1 }, 'T', clean);
    sanitizeVaultState({ stock: {}, upgrades: 1 }, 'T', clean);
    expect(clean).toEqual([]);
  });

  it('with no sink, the wrong-shape drop warns directly (no caller can make it silent)', () => {
    // The bank.ts local-fallback idiom: the sink aggregates when passed, and its
    // absence must not turn the one destroyed-shape case back into a silent drop.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      sanitizeVaultState({ stock: [1, 2, 3], upgrades: 1 }, 'Shapeless');
      const lines = warn.mock.calls.map((c) => c.join(' '));
      expect(
        lines.some(
          (l) =>
            l.includes('dropped malformed vault stock') &&
            l.includes('Shapeless') &&
            l.includes('vault.stock:array'),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('the REAL load path aggregates a wholesale-dropped stock shape into the character warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      loadWith({ stock: [{ itemId: 'copper_ore', count: 5 }], upgrades: 1 });
      const lines = warn.mock.calls.map((c) => c.join(' '));
      expect(
        lines.some(
          (l) =>
            l.includes('dropped item-instance junk') &&
            l.includes('Tampered') &&
            l.includes('vault.stock:array'),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('loads raw garbage as an empty locked vault without throwing', () => {
    for (const raw of [42, 'x', null, true, [], { stock: 'nope', upgrades: 'nope' }]) {
      let loaded: ReturnType<typeof loadWith> | undefined;
      expect(
        () => {
          loaded = loadWith(raw);
        },
        `raw ${JSON.stringify(raw)}`,
      ).not.toThrow();
      expect(loaded?.m.vault, `raw ${JSON.stringify(raw)}`).toEqual({
        stock: {},
        special: [],
        upgrades: 0,
      });
    }
  });

  it('tolerates an over-capacity stock: kept whole, deposit refused, withdraw still works', () => {
    // No capacity clamp on load, by decision: trimming would DESTROY items. The
    // over-cap stock simply blocks new deposits until it drains back under.
    const { sim, pid, m } = loadWith({ stock: { copper_ore: 999 }, upgrades: 1 });
    moveToBanker(sim, pid);
    expect(m.vault.stock).toEqual({ copper_ore: 999 });
    expect(vaultCapacityPerMaterial(m.vault)).toBe(40);

    sim.addItem('copper_ore', 3, pid);
    const before = totalHeld(m, 'copper_ore');
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), undefined, pid);
    expect(hasErr(sim.drainEvents(), NO_HEADROOM)).toBe(true);
    expect(m.vault.stock).toEqual({ copper_ore: 999 });
    expect(m.inventory).toEqual(bagSnap);
    expect(totalHeld(m, 'copper_ore')).toBe(before);

    sim.vaultWithdraw('copper_ore', 2, pid);
    expect(m.vault.stock).toEqual({ copper_ore: 997 });
    expect(totalHeld(m, 'copper_ore')).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe('the vault material scope', () => {
  it('is exactly the shared material taxonomy, id for id', () => {
    expect([...vaultMaterialIds()].sort()).toEqual([...MATERIAL_ITEM_IDS].sort());
  });

  it('admits the ores and rejects the junk-kind non-materials', () => {
    // Bare-literal membership beside the set equality above: the set-vs-set pin
    // would still pass if BOTH sides regressed the same way.
    const ids = vaultMaterialIds();
    expect(ids.has('copper_ore')).toBe(true);
    expect(ids.has('iron_ore')).toBe(true);
    expect(ids.has('guardian_core')).toBe(false); // kind junk, but no source table
    expect(ids.has('boar_hide')).toBe(false); // kind quest
    expect(ids.has('totally_unknown_item')).toBe(false);
  });

  it('returns the same eager canonical view on every call', () => {
    expect(vaultMaterialIds()).toBe(vaultMaterialIds());
  });

  it('no member of the material set is quest-kind (the sweep can never move a quest item)', () => {
    // Two player-facing claims rest on this content fact: the deposit-all
    // tooltip's "quest items are never touched", and the bags-side vault arm
    // (src/ui/bags_view.ts) skipping the quest check the personal-bank arm
    // makes. A future quest-kind id entering the derivation would falsify
    // both silently; this pin makes it a red instead.
    for (const id of vaultMaterialIds()) {
      expect(ITEMS[id], `material id ${id} must exist in ITEMS`).toBeDefined();
      expect(ITEMS[id].kind, `material id ${id} must not be quest-kind`).not.toBe('quest');
    }
  });

  it('no material id collides with an inherited Object.prototype name', () => {
    // The deposit path reads and writes vault.stock under ids from this set with
    // plain keyed access; that is only safe while no member shadows an inherited
    // Object.prototype name ('constructor', 'toString', '__proto__', ...). If a
    // future content record ever authored such an id, this reddens BEFORE the
    // first deposit could corrupt a stock row. `id in {}` is exactly "visible on
    // a plain empty object", i.e. inherited-only names.
    expect([...vaultMaterialIds()].filter((id) => id in {})).toEqual([]);
  });

  it('every stock read goes through Object.hasOwn, directly or via drawableVaultCount (source pin)', () => {
    // The hasOwn guards are refactor armor whose BEHAVIOR is identical to the
    // plain reads for every reachable input today (that identity is the point),
    // so no behavioral test can distinguish them; this source pin is what keeps
    // a later cleanup from silently reverting to the prototype-bearing index.
    const src = stripComments(
      readFileSync(
        fileURLToPath(new URL('../src/sim/materials_vault.ts', import.meta.url)),
        'utf8',
      ),
    );
    const fnBody = (fn: string): string => {
      // The open paren keeps the slice order-independent: 'vaultDeposit' is a
      // PREFIX of 'vaultDepositAll', so without it a reorder of the two
      // declarations would hand one function the other's body.
      const start = src.indexOf(`export function ${fn}(`);
      expect(start, `${fn} should exist`).toBeGreaterThan(-1);
      const next = src.indexOf('export function', start + 1);
      return src.slice(start, next === -1 ? undefined : next);
    };
    // Positive control for the slicer itself: a slice holds exactly ONE
    // export header (its own), so a slice that swallowed a neighbor (the
    // prefix-collision the paren above hardens against) reddens here instead
    // of silently satisfying any containment arm.
    expect(fnBody('vaultDeposit').match(/export function/g)).toHaveLength(1);
    // Per function, not file-wide: a guarded read added elsewhere must not be
    // able to cover for one of these being reverted.
    expect(fnBody('vaultDeposit')).toContain('Object.hasOwn(vault.stock,');
    expect(fnBody('vaultWithdraw')).toContain('Object.hasOwn(vault.stock,');
    expect(fnBody('vaultDepositAll')).toContain('Object.hasOwn(vault.stock,');
    const guarded = src.match(/Object\.hasOwn\(vault\.stock,/g) ?? [];
    // Exact total: a FOURTH read is a review trip-wire (the third was reviewed
    // in with the Phase 03 deposit-all sweep).
    expect(guarded).toHaveLength(3);
    // Bank Storage phase 04 moved this pin to cover the two-pool crafting
    // reads as well. They take the stock RECORD rather than the vault, so they
    // guard a differently-named binding and the totals above cannot see them.
    // drawableVaultCount owns the only new direct read; the other two functions
    // are pinned to route THROUGH it rather than indexing the record
    // themselves, which is what keeps the drawable rule (and its hasOwn guard)
    // single-sourced as more craft-side consumers land.
    expect(fnBody('drawableVaultCount')).toContain('Object.hasOwn(stock,');
    expect(src.match(/Object\.hasOwn\(stock,/g) ?? []).toHaveLength(1);
    expect(fnBody('consumeVaultStock')).toContain('drawableVaultCount(vault.stock,');
    expect(fnBody('craftVaultStockFor')).toContain('drawableVaultCount(stock,');
    // And neither may READ the record with a plain index, the prototype-bearing
    // form this whole pin exists to keep out. craftVaultStockFor never indexes
    // it at all (Object.keys plus a drawableVaultCount call per row);
    // consumeVaultStock's only two occurrences are its WRITES, named here
    // individually, both landing on a row drawableVaultCount has already proved
    // is an own data property. A third occurrence is a read that skipped the
    // guard.
    expect(fnBody('craftVaultStockFor')).not.toMatch(/stock\[/);
    expect(fnBody('consumeVaultStock').match(/vault\.stock\[itemId\]/g) ?? []).toHaveLength(2);
    expect(fnBody('consumeVaultStock')).toContain('delete vault.stock[itemId];');
    expect(fnBody('consumeVaultStock')).toContain('vault.stock[itemId] = held - count;');
  });
});

// ---------------------------------------------------------------------------
// material_derivation.ts is the injectable rule engine behind the one registry.
// It stays a pure type leaf so callers supply fully evaluated content tables and
// source-by-source tests can exercise it without hidden module state.
describe('material_derivation.ts stays a runtime-import-free leaf', () => {
  // Every line that pulls a RUNTIME dependency: a value import in any form (a
  // from-clause, a bare side-effect import, a dynamic import()) or a value
  // re-export. `import type` and `export type` are the only admitted forms. The
  // statement forms are anchored at the start of the trimmed line (a multi-line
  // import still opens with `import`), while `import(` is matched anywhere,
  // because a dynamic import is an expression and never starts its line.
  const runtimeDepLines = (src: string): string[] =>
    stripComments(src)
      .split('\n')
      .map((line) => line.trim())
      .filter(
        (line) =>
          (/^import\b/.test(line) && !/^import\s+type\b/.test(line)) ||
          /\bimport\s*\(/.test(line) ||
          (/^export\b[^;]*\bfrom\b/.test(line) && !/^export\s+type\b/.test(line)),
      );

  it('the detector has teeth: it flags every runtime form and stays quiet on type-only ones', () => {
    // A positive control, so a typo in the predicate cannot leave the sweep below
    // permanently, invisibly green (the file may legitimately have zero imports,
    // which is why an "at least one import" vacuity floor is not available here).
    for (const form of [
      "import { ITEMS } from './data';",
      "import './side_effects';",
      "const lazy = await import('./data');",
      "export * from './data';",
      "export { ITEMS } from './data';",
    ]) {
      expect(runtimeDepLines(form), form).toHaveLength(1);
    }
    for (const form of [
      "import type { ItemDef } from './types';",
      'import type {',
      "export type { ItemDef } from './types';",
      "// import { ITEMS } from './data';",
      "const label = 'import';",
    ]) {
      expect(runtimeDepLines(form), form).toEqual([]);
    }
  });

  it('has no runtime import or re-export at all', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../src/sim/material_derivation.ts', import.meta.url)),
      'utf8',
    );
    const offenders = runtimeDepLines(src);
    expect(
      offenders,
      `runtime dependencies in material_derivation.ts:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('the vault wire tokens', () => {
  it('contributes exactly four vault_ tokens in append order (the sweep reviewed in)', () => {
    // Pinned as an exact ordered list: a FIFTH token is a protocol addition
    // that must be reviewed here, and the order is the append order the table
    // promises never to change. vault_deposit_all is the Phase 03 batched
    // server-side sweep, the one deliberate addition this pin existed to force
    // through review (state.md Phase 03 constraints: one command, one batched
    // ledger write, never a client-side loop of vault_deposit sends).
    expect(COMMAND_NAMES.filter((t) => t.startsWith('vault_'))).toEqual([
      'vault_deposit',
      'vault_withdraw',
      'vault_buy_upgrade',
      'vault_deposit_all',
    ]);
  });

  it('the three item-moving tokens are HEAVY_SELF_CMDS members server-side', () => {
    // All three ops rewrite the carried inventory, the heavy-gated `inv` self
    // key (the sweep most of all: up to every slot in one command); without
    // membership the owner's bag mirror lags a vault move by up to the
    // 40-tick staggered refresh, aiming the next index-keyed deposit at the
    // wrong item. vault_buy_upgrade stays OUT on purpose: copper rides the
    // always-sent base self object (the documented guild-bank gold-op rule).
    const gameSrc = readFileSync(
      fileURLToPath(new URL('../server/game.ts', import.meta.url)),
      'utf8',
    );
    const start = gameSrc.indexOf('const HEAVY_SELF_CMDS');
    expect(start, 'HEAVY_SELF_CMDS should exist in server/game.ts').toBeGreaterThan(-1);
    // Comments are stripped so the pin reads only live members: a token named
    // in a comment can neither satisfy a positive arm nor redden the negative
    // one (the source-text-pin comment-gaming trap).
    const block = stripComments(gameSrc.slice(start, gameSrc.indexOf(']);', start)));
    expect(block).toContain("'bank_deposit'"); // positive control: the sibling rule
    expect(block).toContain("'vault_deposit'");
    expect(block).toContain("'vault_withdraw'");
    expect(block).toContain("'vault_deposit_all'");
    expect(block).not.toContain("'vault_buy_upgrade'");
  });
});

// ---------------------------------------------------------------------------
describe('the sim_i18n rows bind the emitted literals', () => {
  it('every vault row resolves to the exact emit-site string', () => {
    // Redundant with the S3 guard by design: S3 proves every emit is RECOGNIZED
    // by some matcher; this pins each row to ITS key, so a key rename or a row
    // shuffled onto the wrong key reddens here with a readable diff.
    expect(tSim('error.vaultOnlyMaterials')).toBe(NOT_A_MATERIAL);
    expect(tSim('error.vaultLocked')).toBe(LOCKED);
    expect(tSim('error.vaultMaterialFull')).toBe(NO_HEADROOM);
    expect(tSim('error.vaultCannotAfford')).toBe('You cannot afford that vault upgrade.');
    expect(tSim('error.vaultMaxUpgrades')).toBe('Your vault cannot be upgraded further.');
    expect(tSim('log.vaultUnlocked')).toBe(UNLOCK_NOTICE);
    expect(tSim('log.vaultUpgraded')).toBe(UPGRADE_NOTICE);
  });
});

// ---------------------------------------------------------------------------
describe('vaultDepositAll (the batched server-side sweep, Bank Storage Phase 03)', () => {
  // Total held count of one id across bags AND vault: the covenant's unit.
  const heldTotal = (m: Meta, itemId: string) =>
    m.inventory.filter((s) => s.itemId === itemId).reduce((sum, s) => sum + s.count, 0) +
    vaultStoredCount(m.vault, itemId);

  it('sweeps every eligible material in ONE call and leaves everything else alone', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 }; // cap 40 per material
    sim.addItem('copper_ore', 10);
    sim.addItem('iron_ore', 4);
    sim.addItem(GEAR_IDS[0], 1); // not a material: must survive the sweep
    const gearBefore = m.inventory.filter((s) => s.itemId === GEAR_IDS[0]).length;
    const copperTotal = heldTotal(m, 'copper_ore');
    const ironTotal = heldTotal(m, 'iron_ore');
    sim.drainEvents();
    sim.vaultDepositAll();
    // Silent success: the sweep emits no per-slot chatter and no summary line
    // (the UI summarizes from its own click-time replay).
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({ copper_ore: 10, iron_ore: 4 });
    expect(m.inventory.some((s) => s.itemId === 'copper_ore')).toBe(false);
    expect(m.inventory.some((s) => s.itemId === 'iron_ore')).toBe(false);
    expect(m.inventory.filter((s) => s.itemId === GEAR_IDS[0]).length).toBe(gearBefore);
    // Conservation, the covenant's unit: nothing minted, nothing destroyed.
    expect(heldTotal(m, 'copper_ore')).toBe(copperTotal);
    expect(heldTotal(m, 'iron_ore')).toBe(ironTotal);
  });

  it('fills each material only to its headroom, descending by slot index', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 }; // cap 40
    // 60 copper_ore = three 20-stacks (stackSize 20). Headroom 40: the sweep
    // walks DESCENDING, so the two HIGHEST-index stacks splice out and the
    // FIRST stack survives untouched. The exact survivor pins the direction: an
    // ascending walk with the same clamp would leave the LAST stack instead
    // (and would already have mis-stepped over the spliced indexes).
    sim.addItem('copper_ore', 60);
    expect(m.inventory.filter((s) => s.itemId === 'copper_ore')).toHaveLength(3);
    const firstStack = m.inventory.find((s) => s.itemId === 'copper_ore');
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(errorTexts(sim.drainEvents())).toEqual([]); // the clamp is silent
    expect(m.vault.stock).toEqual({ copper_ore: 40 });
    const carried = m.inventory.filter((s) => s.itemId === 'copper_ore');
    expect(carried).toHaveLength(1);
    expect(carried[0].count).toBe(20);
    expect(carried[0]).toBe(firstStack); // the SAME surviving slot object
    expect(heldTotal(m, 'copper_ore')).toBe(60);
  });

  it('sweeps instance-payload and crafted-provenance slots into special storage', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 };
    const bagBase = clone(m.inventory);
    sim.addItem('copper_ore', 3);
    m.inventory.push({ itemId: 'copper_ore', count: 2, instance: { signer: 'Ana' } });
    sim.addItem('iron_ore', 2, sim.playerId, { craftedRecipeId: 'recipe_test_crafted' });
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({ copper_ore: 3 });
    expect(m.vault.special).toEqual([
      { itemId: 'iron_ore', count: 2, craftedRecipeId: 'recipe_test_crafted' },
      { itemId: 'copper_ore', count: 2, instance: { signer: 'Ana' } },
    ]);
    expect(m.inventory).toEqual(bagBase);
  });

  it('a material already AT its ceiling is skipped whole, silently', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 40 }, special: [], upgrades: 1 }; // headroom 0
    sim.addItem('copper_ore', 5);
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(errorTexts(sim.drainEvents())).toEqual([]);
    expect(m.vault.stock).toEqual({ copper_ore: 40 });
    expect(heldTotal(m, 'copper_ore')).toBe(45);
    expect(m.inventory.find((s) => s.itemId === 'copper_ore')?.count).toBe(5);
  });

  it('an over-capacity tolerated stock blocks new deposits without losing anything', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 90 }, special: [], upgrades: 1 }; // legacy over-cap (cap 40)
    sim.addItem('copper_ore', 5);
    sim.vaultDepositAll();
    expect(m.vault.stock).toEqual({ copper_ore: 90 }); // never truncated
    expect(m.inventory.find((s) => s.itemId === 'copper_ore')?.count).toBe(5);
  });

  it('refuses on a locked vault with the locked line, moving nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('copper_ore', 5);
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(hasErr(sim.drainEvents(), LOCKED)).toBe(true);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual({ stock: {}, special: [], upgrades: 0 });
  });

  it('refuses away from every banker with the too-far line, moving nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 };
    sim.addItem('copper_ore', 5);
    moveFarFromBankers(sim);
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(hasErr(sim.drainEvents(), TOO_FAR)).toBe(true);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault.stock).toEqual({});
  });

  it('is a silent no-op while dead (the town-service idiom)', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 };
    sim.addItem('copper_ore', 5);
    sim.player.dead = true;
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault.stock).toEqual({});
  });

  it('an inventory with nothing eligible is a silent success (no chatter, no change)', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 };
    sim.addItem(GEAR_IDS[0], 1);
    const bagSnap = clone(m.inventory);
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault.stock).toEqual({});
  });

  it('fills a partial stack IN PLACE when headroom takes only part of it', () => {
    // The one line that decrements a live carried stack (the mint-or-destroy
    // line): cap 40, 25 pre-stocked, one carried 20-stack. 15 move, 5 stay ON
    // THE SAME SLOT, and the total is conserved exactly.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 25 }, special: [], upgrades: 1 };
    sim.addItem('copper_ore', 20);
    const stack = m.inventory.find((s) => s.itemId === 'copper_ore');
    sim.vaultDepositAll();
    expect(m.vault.stock).toEqual({ copper_ore: 40 });
    const carried = m.inventory.filter((s) => s.itemId === 'copper_ore');
    expect(carried).toHaveLength(1);
    expect(carried[0]).toBe(stack); // decremented in place, never respliced
    expect(carried[0].count).toBe(5);
    expect(heldTotal(m, 'copper_ore')).toBe(45);
  });

  it('a corrupt degenerate carried count is SKIPPED, never allowed to destroy stock', () => {
    // The bags load path applies NO bound at all to a plain slot's count
    // (instancedCountCap is Infinity without an instance payload), so a
    // tampered save can carry a zero, negative, or NaN slot count into the
    // inventory. Without the shared predicate's count guard, Math.min against
    // a negative count would splice the slot AND subtract from the stock:
    // three units gone.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 10 }, special: [], upgrades: 1 };
    m.inventory.push({ itemId: 'copper_ore', count: -3 });
    m.inventory.push({ itemId: 'copper_ore', count: 0 });
    m.inventory.push({ itemId: 'copper_ore', count: Number.NaN });
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.vault.stock).toEqual({ copper_ore: 10 }); // byte-identical, nothing destroyed
    // The corrupt slots stay in the bags untouched (recoverable evidence).
    expect(m.inventory.filter((s) => s.itemId === 'copper_ore')).toHaveLength(3);
  });

  it('a past-precision carried count (1e21, Infinity) is SKIPPED: the sweep cannot mint', () => {
    // The mint vector this phase's QA closed: with cap headroom available,
    // Math.min(1e21, 40) moves 40 real units into the vault while the
    // decrement (1e21 - 40) is a float NO-OP, so the corrupt stack never
    // drops and every sweep-withdraw cycle mints 40 more items from nothing.
    // The predicate's MAX_SAFE_INTEGER arm refuses the slot instead; honest
    // slots beside it still sweep normally.
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 };
    sim.addItem('iron_ore', 7); // the honest neighbor that must still move
    m.inventory.push({ itemId: 'copper_ore', count: 1e21 });
    m.inventory.push({ itemId: 'rough_hide', count: Number.POSITIVE_INFINITY });
    // The fractional arm: 2.5 would deposit whole and be FLOORED by the
    // sanitizer one relog later (delayed destruction), so it is refused too.
    m.inventory.push({ itemId: 'ashwood_log', count: 2.5 });
    sim.drainEvents();
    sim.vaultDepositAll();
    expect(sim.drainEvents()).toHaveLength(0);
    expect(m.vault.stock).toEqual({ iron_ore: 7 }); // honest slot swept, corrupt ones refused
    const corruptCopper = m.inventory.find((s) => s.itemId === 'copper_ore');
    const corruptHide = m.inventory.find((s) => s.itemId === 'rough_hide');
    const corruptLog = m.inventory.find((s) => s.itemId === 'ashwood_log');
    expect(corruptCopper?.count).toBe(1e21); // untouched recoverable evidence
    expect(corruptHide?.count).toBe(Number.POSITIVE_INFINITY);
    expect(corruptLog?.count).toBe(2.5);
  });

  it('double-send: the second sweep finds nothing left and changes nothing', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: {}, special: [], upgrades: 1 };
    sim.addItem('copper_ore', 10);
    sim.vaultDepositAll();
    const bagSnap = clone(m.inventory);
    const vaultSnap = clone(m.vault);
    sim.vaultDepositAll();
    expect(m.inventory).toEqual(bagSnap);
    expect(m.vault).toEqual(vaultSnap);
    expect(heldTotal(m, 'copper_ore')).toBe(10);
  });

  // The mixed fixture both differentials share: honest full and partial moves,
  // an at-cap material, identity-preserving payload/provenance moves, a non-material, and
  // corrupt counts, applied identically to any sim the caller hands in.
  function seedDifferentialFixture(sim: Sim): void {
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 25, iron_ore: 40 }, special: [], upgrades: 1 };
    sim.addItem('copper_ore', 20); // partial: headroom 15 of 20
    sim.addItem('rough_hide', 3); // full move
    sim.addItem('baked_bread', 1); // non-material, refused/skipped
    m.inventory.push({ itemId: 'iron_ore', count: 4 }); // at-cap material
    m.inventory.push({ itemId: 'spider_silk', count: 2, instance: { signer: 'Aleph' } });
    m.inventory.push({ itemId: 'ashwood_log', count: 2, craftedRecipeId: 'r_test' });
    m.inventory.push({ itemId: 'wolf_fang', count: Number.NaN }); // corrupt
    m.inventory.push({ itemId: 'goldleaf_herb', count: 1e21 }); // corrupt, the mint class
  }

  it('DIFFERENTIAL: the sweep equals N descending targeted deposits, byte for byte', () => {
    // The docblock's equivalence claim, made falsifiable: the sweep and the
    // targeted op keep separate bodies (the targeted op does not call the
    // shared predicate), so a rule edited in one body only must red HERE.
    // The targeted replay emits refusal lines where the sweep stays silent;
    // equivalence is over STATE, so events are drained, not compared.
    const a = makeSim();
    const b = makeSim();
    seedDifferentialFixture(a);
    seedDifferentialFixture(b);
    a.vaultDepositAll();
    for (let i = meta(b).inventory.length - 1; i >= 0; i--) b.vaultDeposit(i);
    a.drainEvents();
    b.drainEvents();
    expect(meta(a).inventory).toEqual(meta(b).inventory);
    expect(meta(a).vault).toEqual(meta(b).vault);
    // The fixture genuinely exercised every arm: partial move, full move,
    // at-cap skip, and the corrupt slots surviving untouched.
    expect(meta(a).vault.stock).toEqual({ copper_ore: 40, iron_ore: 40, rough_hide: 3 });
    expect(meta(a).inventory.some((s) => s.itemId === 'goldleaf_herb')).toBe(true);
  });

  it('DIFFERENTIAL: predictVaultDepositAll matches the real sweep it summarizes', () => {
    // The UI replay (src/ui/vault_view.ts) duplicates the headroom clamp and
    // the descending walk; only the skip set is structurally shared. This pins
    // the whole divergence class: predict from a click-time snapshot, run the
    // real sweep, and the prediction must equal what actually happened. Two
    // competing copper stacks share one 15-item headroom, so the walk order
    // itself decides WHICH stack empties: `items` and `full` are
    // order-invariant over a shared headroom, but `stacks` (whole-stack
    // empties) is not, which is why that field exists and is pinned here
    // against the real slots that disappeared. An ascending replay predicts
    // stacks 1 where the sim empties 2.
    const sim = makeSim();
    seedDifferentialFixture(sim);
    const m = meta(sim);
    m.inventory.push({ itemId: 'copper_ore', count: 9 }); // the competing stack
    const invSnap = m.inventory.map((s) => ({ ...s }));
    const info = sim.vaultInfo;
    if (!info) throw new Error('vaultInfo must be non-null at the banker');
    const prediction = predictVaultDepositAll(invSnap, info, vaultMaterialIds());
    const before = new Map(
      [...vaultMaterialIds()].map((itemId) => [itemId, vaultStoredCount(m.vault, itemId)]),
    );
    sim.vaultDepositAll();
    const movedTotal = [...vaultMaterialIds()].reduce(
      (n, itemId) => n + vaultStoredCount(m.vault, itemId) - (before.get(itemId) ?? 0),
      0,
    );
    expect(prediction.items).toBe(movedTotal);
    expect(prediction.items).toBe(22); // copper 15 + hide 3 + two identity rows of 2
    // The order probe: whole-stack empties equal the slots that disappeared.
    expect(prediction.stacks).toBe(invSnap.length - m.inventory.length);
    expect(prediction.stacks).toBe(4); // copper 9, hide, instance, and recipe stacks
    // `full` means a ceiling held something depositable back: exactly the
    // slots that still pass the shared predicate after the sweep ran.
    expect(prediction.full).toBe(
      m.inventory.some((s) => isVaultDepositableSlot(s, vaultMaterialIds())),
    );
    expect(prediction.full).toBe(true); // the fixture forces the interesting arm
  });
});

// ---------------------------------------------------------------------------
describe('the vault draws no rng', () => {
  it('a full command burst observes zero rng draws', () => {
    // The phase invariant "this phase draws no rng at all", pinned decisively:
    // the same-seed determinism run below cannot see an added draw (both runs
    // would draw identically), and no parity scenario drives a vault op yet, so
    // this observer is the one net that catches one. Commands execute
    // synchronously, so no world tick contributes draws while it watches.
    const sim = makeSim();
    const m = meta(sim);
    m.copper = LADDER_TOTAL;
    sim.addItem('copper_ore', 20);
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });
    for (let rung = 0; rung < 5; rung++) sim.vaultBuyUpgrade();
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), 15);
    sim.vaultWithdraw('copper_ore', 10);
    sim.vaultDepositAll(); // the batched sweep is command four, same invariant
    sim.vaultBuyUpgrade(); // refusal paths must not draw either
    sim.vaultDeposit(999);
    sim.vaultWithdraw('unknown_id');
    // 20 granted, 15 deposited, 10 withdrawn, then the sweep takes the carried
    // 15 back in: 20 stocked. Non-vacuity: the burst and the sweep really ran.
    expect(m.vault.stock.copper_ore).toBe(20);
    expect(draws).toBe(0);
    // Positive control IN this test: prove the installed observer actually counts
    // a draw, so the zero above can never be the observer seam silently broken.
    // (The test ends here, so the one deliberate draw perturbs nothing.)
    sim.rng.chance(0.5);
    expect(draws).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('unresolved players and pid-less worlds', () => {
  it('every vault surface is a safe no-op when no player resolves', () => {
    // The one-line resolve/primary guards, pinned: a stale-pid wire command or a
    // noPlayer world (the RL env, a server between joins) must fall through
    // silently rather than throw.
    const sim = makeSim();
    expect(sim.vaultInfoFor(999999)).toBeNull(); // unknown pid on a real world
    const noP = makeVaultWorld();
    expect(noP.vaultInfo).toBeNull(); // primaryId is -1: the getter's null arm
    expect(() => {
      noP.vaultDeposit(0);
      noP.vaultWithdraw('copper_ore');
      noP.vaultDepositAll();
      noP.vaultBuyUpgrade();
      noP.vaultDeposit(0, 1, 999999); // explicit stale pid on every command
      noP.vaultWithdraw('copper_ore', 1, 999999);
      noP.vaultDepositAll(999999);
      noP.vaultBuyUpgrade(999999);
    }).not.toThrow();
    expect(noP.drainEvents()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('a successful upgrade purchase re-checks deeds', () => {
  it('vaultBuyUpgrade ends on markDeedsDirty, the bankBuySlots beat', () => {
    // A purchase changes persisted trigger inputs; without the dirty mark a deed
    // reading them lags until the next unrelated mark. No purchase-triggered deed
    // exists in the trimmed world to observe behaviorally, so pin structurally:
    // the stripped SOURCE of the vaultBuyUpgrade body must call markDeedsDirty,
    // with the bankBuySlots body as the positive control for the extraction.
    const body = (src: string, fn: string): string => {
      const stripped = stripComments(src);
      const start = stripped.indexOf(`export function ${fn}`);
      expect(start, `${fn} should exist`).toBeGreaterThan(-1);
      const next = stripped.indexOf('export function', start + 1);
      return stripped.slice(start, next === -1 ? undefined : next);
    };
    const vaultSrc = readFileSync(
      fileURLToPath(new URL('../src/sim/materials_vault.ts', import.meta.url)),
      'utf8',
    );
    const bankSrc = readFileSync(
      fileURLToPath(new URL('../src/sim/bank.ts', import.meta.url)),
      'utf8',
    );
    expect(body(bankSrc, 'bankBuySlots')).toContain('ctx.markDeedsDirty('); // control
    expect(body(vaultSrc, 'vaultBuyUpgrade')).toContain('ctx.markDeedsDirty(');
  });

  it('a successful purchase marks the buyer deed-dirty; a refusal does not', () => {
    // The behavioral half the source pin above cannot see: the call placed after
    // the refusal returns, with the right pid, writing the real dirty set.
    const sim = makeSim();
    const m = meta(sim);
    sim.tick(); // let the join-time mark drain through updateDeeds first
    // State the baseline directly rather than inferring it from the tick: the
    // tick tail's 1 Hz visit sweep could legitimately re-mark a player near a
    // future POI deed, which would red this test for a non-vault reason.
    sim.deedDirtyPids.delete(sim.playerId);
    sim.vaultBuyUpgrade(); // zero copper: the cannot-afford refusal must not mark
    expect(sim.deedDirtyPids.has(sim.playerId)).toBe(false);
    m.copper = 20000;
    sim.vaultBuyUpgrade();
    expect(sim.deedDirtyPids.has(sim.playerId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The covenant's double-send class: the same command frame arriving twice (a
// double click, a client retry) must conserve counts on every arm. The sim is
// single-threaded, so the second send sees the first's completed state; these
// pin what that second sight does.
describe('double-send safety', () => {
  it('the same deposit frame twice conserves counts (the index re-aims, nothing dupes)', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault.upgrades = 1;
    sim.addItem('copper_ore', 5);
    sim.addItem('iron_ore', 7);
    const idx = slotIndexOf(m, 'copper_ore');
    const beforeCopper = totalHeld(m, 'copper_ore');
    const beforeIron = totalHeld(m, 'iron_ore');
    sim.drainEvents();
    sim.vaultDeposit(idx); // whole stack: the slot splices out, indices shift
    sim.vaultDeposit(idx); // the SAME frame again, now aimed at whatever shifted in
    // The re-aim is pinned, not just conservation: addItem appended iron right
    // after copper, so the splice shifts iron into idx and the second frame
    // deposits it. Per-id totals stay exact throughout; the index contract is
    // the bank's.
    expect(m.vault.stock.copper_ore).toBe(5);
    expect(m.vault.stock.iron_ore).toBe(7);
    expect(carriedCount(m, 'iron_ore')).toBe(0);
    expect(totalHeld(m, 'copper_ore')).toBe(beforeCopper);
    expect(totalHeld(m, 'iron_ore')).toBe(beforeIron);
  });

  it('a double-sent withdraw clamps to what remains; a double-sent buy charges per rung', () => {
    const sim = makeSim();
    const m = meta(sim);
    m.vault = { stock: { copper_ore: 6 }, special: [], upgrades: 1 };
    const before = totalHeld(m, 'copper_ore');
    sim.vaultWithdraw('copper_ore', 4);
    sim.vaultWithdraw('copper_ore', 4); // only 2 left: clamps, never negative
    expect(m.vault.stock).toEqual({});
    expect(carriedCount(m, 'copper_ore')).toBe(6);
    expect(totalHeld(m, 'copper_ore')).toBe(before);
    // Double-sent buy: two distinct rungs at their own table prices, never one
    // rung twice and never a double charge for one grant.
    m.vault.upgrades = 0; // back to locked so the pair is rung 0 then rung 1
    m.copper = 70000; // exactly rung 0 (20000) + rung 1 (50000)
    sim.vaultBuyUpgrade();
    sim.vaultBuyUpgrade();
    expect(m.vault.upgrades).toBe(2);
    expect(m.copper).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('determinism', () => {
  it('the same fixed vault-op script over 300 ticks yields identical state + events', () => {
    function run() {
      const sim = new Sim({
        seed: 123,
        playerClass: 'warrior',
        autoEquip: false,
        world: VAULT_TEST_WORLD,
      });
      moveToBanker(sim); // proximity gate: the scripted vault ops need a banker in reach
      const m = sim.meta(sim.playerId)!;
      m.copper = LADDER_TOTAL;
      const texts: string[] = [];
      const copperIdx = () => m.inventory.findIndex((s) => s.itemId === 'copper_ore');
      const ironIdx = () => m.inventory.findIndex((s) => s.itemId === 'iron_ore');
      for (let tick = 0; tick < 300; tick++) {
        if (tick === 5) sim.addItem('copper_ore', 20);
        if (tick === 8) sim.vaultDeposit(copperIdx()); // still locked: refused
        if (tick === 10) sim.vaultBuyUpgrade(); // rung 0, the unlock
        if (tick === 15) sim.vaultDeposit(copperIdx(), 12);
        if (tick === 40) sim.addItem('iron_ore', 10);
        if (tick === 45) sim.vaultDeposit(ironIdx());
        if (tick === 60) sim.vaultWithdraw('copper_ore', 5);
        if (tick === 80) sim.vaultBuyUpgrade(); // rung 1
        if (tick === 120) sim.vaultBuyUpgrade(); // rung 2
        if (tick === 200) sim.vaultWithdraw('iron_ore', 4);
        for (const e of sim.tick()) texts.push(`${e.type}:${'text' in e ? (e.text ?? '') : ''}`);
      }
      return { state: sim.serializeCharacter(sim.playerId)!, events: texts };
    }
    const a = run();
    // Non-vacuity FIRST: a regression that silently no-ops every scripted op would
    // still deep-equal a second run of itself.
    expect(a.state.vault!.upgrades).toBe(3); // the unlock plus two upgrades
    expect(a.state.vault!.stock.copper_ore).toBe(7); // 12 deposited, 5 withdrawn
    expect(a.state.vault!.stock.iron_ore).toBe(6); // 10 deposited, 4 withdrawn
    expect(a.events).toContain(`log:${UNLOCK_NOTICE}`);
    expect(a.events).toContain(`log:${UPGRADE_NOTICE}`);
    expect(a.events).toContain(`error:${LOCKED}`);
    expect(a).toEqual(run());
  });
});

describe('vault wire revision', () => {
  it('bumps once per successful live mutation and never for refusals or scratch consumption', () => {
    const sim = makeSim();
    const m = meta(sim);
    sim.addItem('copper_ore', 8);

    expect(m.vaultWireRev).toBe(0);
    sim.vaultDeposit(slotIndexOf(m, 'copper_ore')); // locked refusal
    expect(m.vaultWireRev).toBe(0);

    m.copper = 20000;
    sim.vaultBuyUpgrade();
    expect(m.vaultWireRev).toBe(1);
    sim.vaultBuyUpgrade(); // insufficient-funds refusal
    expect(m.vaultWireRev).toBe(1);

    sim.vaultDeposit(slotIndexOf(m, 'copper_ore'), 4);
    expect(m.vaultWireRev).toBe(2);
    sim.vaultWithdraw('copper_ore', 1);
    expect(m.vaultWireRev).toBe(3);
    sim.vaultWithdraw('iron_ore', 1); // empty-row refusal
    expect(m.vaultWireRev).toBe(3);

    m.inventory.push({
      itemId: 'copper_ore',
      count: 1,
      instance: { signer: 'Wire revision' },
    });
    sim.vaultDeposit(m.inventory.length - 1);
    expect(m.vaultWireRev).toBe(4);
    sim.vaultWithdraw(
      'copper_ore',
      undefined,
      { index: 0, instance: { signer: 'Wire revision' } },
      sim.playerId,
    );
    expect(m.vaultWireRev).toBe(5);

    sim.addItem('rough_hide', 2);
    sim.addItem('ashwood_log', 3);
    sim.vaultDepositAll();
    expect(m.vaultWireRev).toBe(6); // one sweep, not one bump per moved row
    sim.vaultDepositAll(); // empty sweep
    expect(m.vaultWireRev).toBe(6);

    expect(consumePlayerVaultStock(m, 'copper_ore', 1)).toBe(true);
    expect(m.vaultWireRev).toBe(7);
    expect(consumePlayerVaultStock(m, 'copper_ore', 999)).toBe(false);
    expect(m.vaultWireRev).toBe(7);

    const scratch = { stock: { copper_ore: 2 }, special: [], upgrades: 0 };
    expect(consumeVaultStock(scratch, 'copper_ore', 1)).toBe(true);
    expect(scratch.stock).toEqual({ copper_ore: 1 });
    expect(m.vaultWireRev).toBe(7); // batch-planning scratch stays revision-free

    const saved = sim.serializeCharacter(sim.playerId);
    if (!saved) throw new Error('missing serialized character');
    expect(saved).not.toHaveProperty('vaultWireRev');
  });

  it('restoreVaultStateOnLoad bumps the wire rev, unconditionally (the one bumping surface)', () => {
    // Installing a sanitized vault REWRITES the wire-visible record, and the
    // cvault signature elides on (rev, blocked) with no cadence backstop
    // behind it: a live re-install that kept the rev would leave the
    // client's cvault stale until the next real write. sanitizeVaultState
    // itself stays PURE (a dry-run caller must be able to sanitize without
    // touching the wire), so the installer is the one bumping surface. The
    // bump is pinned UNCONDITIONAL because the installer cannot distinguish
    // a no-op rebuild from a rewrite (it never sees the previous vault); the
    // fail-safe direction is one spurious re-send.
    const host = { name: 'T', vault: { stock: {}, special: [], upgrades: 0 }, vaultWireRev: 0 };
    restoreVaultStateOnLoad(host, { stock: { copper_ore: 3 }, upgrades: 1 }, [], 1);
    expect(host.vaultWireRev).toBe(1);
    expect(host.vault.stock).toEqual({ copper_ore: 3 });
    // Re-installing identical content still bumps: no previous vault, no diff.
    restoreVaultStateOnLoad(host, { stock: { copper_ore: 3 }, upgrades: 1 }, [], 1);
    expect(host.vaultWireRev).toBe(2);
    // The sanitizer's early-return shape bumps too: the installer replaces
    // whatever was there with the returned empty vault, still a rewrite.
    restoreVaultStateOnLoad(host, undefined, [], 1);
    expect(host.vaultWireRev).toBe(3);
    expect(host.vault).toEqual({ stock: {}, special: [], upgrades: 0 });
  });

  it('the real load path bumps the rev exactly once via restoreVaultStateOnLoad', () => {
    // The decisive half of the case above: the sim.ts call site must actually
    // route through the revHost arm, or the unit pin holds while the load
    // path silently regresses to a rev-less replacement. Exactly ONE bump,
    // because the whole-record replacement is the only load-time vault write.
    const seed = makeSim();
    seed.meta(seed.playerId)!.vault = {
      stock: { copper_ore: 9 },
      special: [],
      upgrades: 1,
    };
    const state = seed.serializeCharacter(seed.playerId)!;
    const sim = makeVaultWorld(1);
    const pid = sim.addPlayer('warrior', 'Reloaded', { state });
    expect(meta(sim, pid).vault.stock).toEqual({ copper_ore: 9 });
    expect(meta(sim, pid).vaultWireRev).toBe(1);
  });
});

describe('emitVaultCraftConsume (the sort-and-aggregate contract, Phase 04 review)', () => {
  // No shipped grade ladder can exercise either property (base ids sort
  // before their fine ids, and no shipped recipe draws one id twice), so a
  // deleted .sort() or Map aggregation would stay green everywhere else:
  // this is the direct pin the review round asked for. Stub ctx: only emit
  // is consumed.
  function emitted(draws: { itemId: string; count: number }[]): unknown[] {
    const events: unknown[] = [];
    const ctx = { emit: (ev: unknown) => events.push(ev) } as never;
    const meta = { entityId: 9, vault: { stock: {}, special: [], upgrades: 3 } } as never;
    emitVaultCraftConsume(ctx, meta, draws);
    return events;
  }

  it('aggregates duplicate ids and emits takes in SORTED id order, not plan order', () => {
    const events = emitted([
      { itemId: 'tin_ore', count: 2 },
      { itemId: 'copper_ore', count: 1 },
      { itemId: 'tin_ore', count: 3 },
    ]);
    expect(events).toEqual([
      {
        type: 'vaultCraftConsume',
        pid: 9,
        takes: [
          { itemId: 'copper_ore', count: 1 },
          { itemId: 'tin_ore', count: 5 },
        ],
        upgrades: 3,
      },
    ]);
  });

  it('emits nothing for an empty draw list', () => {
    expect(emitted([])).toEqual([]);
  });
});

describe('the cvault wire signature premise: stock writers are confined', () => {
  it('no module outside materials_vault.ts writes vault.stock (the rev-bump enumeration guard)', async () => {
    // The cvault key's elision rests on "every stock mutation bumps
    // vaultWireRev", which is an ENUMERATION over materials_vault.ts's own
    // writers now that the 4 Hz cadence self-heal is gone. Keep the
    // enumeration checkable: any new module that writes vault.stock (or
    // vault.special / vault.upgrades) must red here and join the
    // bumpVaultWireRev discipline, or the projection goes stale forever.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = fileURLToPath(new URL('../src/sim', import.meta.url));
    // The whole-record `meta.vault = ...` replacement is a write like any
    // other (one assignment swaps every enumerated surface at once), so it
    // gets its own pattern rather than an exclusion-by-construction claim:
    // the one sanctioned site is restoreVaultStateOnLoad in
    // materials_vault.ts (this walk's one excluded file), which pairs the
    // install with its rev bump.
    const wholeRecordWrite = /\.vault\s*=(?!=)/;
    const writes = [
      /vault\.(?:stock|special|upgrades)(?:\[[^\]]*\])?\s*(?:=(?!=)|\+=|-=)/,
      /vault\.(?:stock|special)\.(?:push|splice|pop|shift|unshift)\(/,
      /delete\s+[A-Za-z_$][\w$.]*vault\.stock/,
      wholeRecordWrite,
    ];
    // POSITIVE CONTROLS first: the patterns must recognize the sanctioned
    // writer's own mutations, or an offenders list of [] proves nothing. The
    // whole-record pattern is verified on its own, against
    // restoreVaultStateOnLoad's `meta.vault = ...` install.
    const sanctioned = readFileSync(join(root, 'materials_vault.ts'), 'utf8');
    expect(writes.some((pattern) => pattern.test(sanctioned))).toBe(true);
    expect(wholeRecordWrite.test(sanctioned)).toBe(true);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts') || entry === 'materials_vault.ts') continue;
        const src = readFileSync(full, 'utf8');
        // WRITES only: an indexed or whole-field assignment, a compound
        // assignment, an array mutator, a delete, or the whole-record
        // `meta.vault = ...` replacement. Plain reads (quest_item_presence's
        // presence probe) are legal everywhere. Sim.addPlayer stays a thin
        // caller of restoreVaultStateOnLoad, so no file outside the one
        // sanctioned writer matches any pattern.
        if (writes.some((pattern) => pattern.test(src))) offenders.push(full);
      }
    };
    walk(root);
    const serverRoot = fileURLToPath(new URL('../server', import.meta.url));
    walk(serverRoot);
    expect(offenders).toEqual([]);
  });
});

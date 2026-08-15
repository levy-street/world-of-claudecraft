// The drift pin for the four hand-copied admission chains.
//
// Craft Cast System split every profession action into a START gate and a
// COMPLETE resolve, and for the enchant family, salvage, and tool recharge the
// start gate is a hand-copied transcription of the resolver's deny arms
// (evaluateDisenchantAdmission / evaluateApplyEnchantAdmission /
// evaluateSalvageAdmission, and the recharge admission inside
// tool_effect_actions.ts). Two copies of one gate chain drift: a gate added to
// a resolver but not its admission lets a doomed cast start and pay 1.5 s
// before denying, and the reverse refuses a cast the resolve would have
// allowed.
//
// So every row below is one denial-producing state driven through BOTH halves,
// and both are pinned to the SAME literal reason. A gate added on one side
// only turns its row red on that side; a gate whose reason code is renamed on
// one side turns it red on both. Each family also carries an admitted row, so
// an admission that starts denying what the resolver still accepts is caught
// too.
//
// Recharge is the odd one out by construction: its admission returns a boolean
// and EMITS the deny event rather than returning it, so its two halves are
// compared through the event stream instead of return values.

import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import {
  evaluateApplyEnchantAdmission,
  evaluateDisenchantAdmission,
  resolveApplyEnchant,
  resolveDisenchant,
} from '../src/sim/professions/enchanting';
import { evaluateSalvageAdmission, resolveSalvage } from '../src/sim/professions/salvage';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, EquipSlot, InvSlot, SimEvent } from '../src/sim/types';
import { completeRechargeCast } from './helpers/enchant_family_cast';

const SWORD = 'eastbrook_arming_sword'; // common mainhand weapon
const TUNIC = 'recruit_tunic'; // common chest armor
const MIGHT = 'enchant_weapon_might'; // mainhand, 5 arcane_dust
const AGILITY = 'enchant_weapon_agility'; // a second mainhand enchant
const HELMET_ENCHANT = 'enchant_helmet_fortitude'; // targets 'helmet', not 'mainhand'
const DUST = 'arcane_dust';
const MISSING_ITEM = '__drift_no_such_item';
const MISSING_ENCHANT = '__drift_no_such_enchant';
const FILLER = 'simple_fishing_pole'; // one per slot, merges with nothing

function makeSim(seed = 7): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function playerOf(sim: Sim): { p: Entity; meta: PlayerMeta; pid: number } {
  const pid = sim.playerId;
  const meta = sim.players.get(pid);
  const p = sim.entities.get(pid);
  if (!meta || !p) throw new Error('player missing');
  return { p, meta, pid };
}

function fillerSlots(n: number): InvSlot[] {
  return Array.from({ length: n }, () => ({ itemId: FILLER, count: 1 }));
}

/** Fill the bags so exactly `keptSlots` of the extras below are the only
 *  non-filler entries and the pack is at (or over) capacity. */
function packBags(meta: PlayerMeta, fillers: number, extras: InvSlot[]): void {
  meta.inventory = [...fillerSlots(fillers), ...extras];
}

type Outcome = { ok: boolean; reason?: string } | null;

/** Both halves of one gate chain must answer with the SAME reason, and that
 *  reason is pinned to a literal so a rename cannot keep the row green by
 *  moving both sides together. `expected` null means "admitted". */
function expectSameAnswer(admission: Outcome, resolved: Outcome, expected: string | null): void {
  if (expected === null) {
    expect(admission, 'admission should admit').toBeNull();
    expect(resolved?.ok, 'resolver should succeed').toBe(true);
    expect(resolved?.reason, 'resolver reason on success').toBeUndefined();
    return;
  }
  expect(admission?.ok, 'admission denial ok flag').toBe(false);
  expect(admission?.reason, 'admission reason').toBe(expected);
  expect(resolved?.ok, 'resolver denial ok flag').toBe(false);
  expect(resolved?.reason, 'resolver reason').toBe(expected);
}

// ---------------------------------------------------------------------------
// Disenchant
// ---------------------------------------------------------------------------
describe('disenchant admission matches its resolver', () => {
  interface Row {
    name: string;
    expected: string | null;
    itemId: string;
    slotIndex?: number;
    setup: (sim: Sim, meta: PlayerMeta, pid: number) => void;
  }

  const rows: Row[] = [
    {
      name: 'an unknown item id',
      expected: 'unknown_item',
      itemId: MISSING_ITEM,
      setup: () => {},
    },
    {
      name: 'an ineligible item kind',
      expected: 'not_disenchantable',
      itemId: DUST,
      setup: (sim, _meta, pid) => sim.addItem(DUST, 3, pid),
    },
    {
      name: 'no copy held at all',
      expected: 'not_held',
      itemId: SWORD,
      setup: () => {},
    },
    {
      name: 'a pinned slot holding a different item',
      expected: 'not_held',
      itemId: SWORD,
      slotIndex: 0,
      setup: (sim, meta, pid) => {
        meta.inventory = [];
        sim.addItem('linen_scrap', 2, pid);
        sim.addItem(SWORD, 1, pid);
      },
    },
    {
      name: 'full bags where the victim slot survives and the yield has no home',
      expected: 'no_bag_space',
      itemId: SWORD,
      setup: (_sim, meta) => {
        // A legacy overstacked slot: consuming one copy frees nothing.
        packBags(meta, 15, [{ itemId: SWORD, count: 2 }]);
        expect(meta.inventory.length).toBe(bagCapacity(meta.bags));
      },
    },
    {
      name: 'an eligible piece with room',
      expected: null,
      itemId: SWORD,
      setup: (sim, _meta, pid) => sim.addItem(SWORD, 1, pid),
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const sim = makeSim();
      const { meta, pid } = playerOf(sim);
      row.setup(sim, meta, pid);
      const admission = evaluateDisenchantAdmission(sim.ctx, pid, row.itemId, row.slotIndex);
      const resolved = resolveDisenchant(sim.ctx, pid, row.itemId, row.slotIndex);
      expectSameAnswer(admission, resolved, row.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------
describe('salvage admission matches its resolver', () => {
  interface Row {
    name: string;
    expected: string | null;
    itemId: string;
    setup: (sim: Sim, meta: PlayerMeta, pid: number) => void;
  }

  const rows: Row[] = [
    {
      name: 'an unknown item id',
      expected: 'unknown_item',
      itemId: MISSING_ITEM,
      setup: () => {},
    },
    {
      name: 'an ineligible item kind',
      expected: 'not_salvageable',
      itemId: DUST,
      setup: (sim, _meta, pid) => sim.addItem(DUST, 3, pid),
    },
    {
      name: 'no copy held at all',
      expected: 'not_held',
      itemId: TUNIC,
      setup: () => {},
    },
    {
      name: 'full bags where the victim slot survives and the yield has no home',
      expected: 'no_bag_space',
      itemId: SWORD,
      setup: (_sim, meta) => {
        packBags(meta, 15, [{ itemId: SWORD, count: 2 }]);
        expect(meta.inventory.length).toBe(bagCapacity(meta.bags));
      },
    },
    {
      name: 'an eligible piece with room',
      expected: null,
      itemId: TUNIC,
      setup: (sim, _meta, pid) => sim.addItem(TUNIC, 1, pid),
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const sim = makeSim();
      const { meta, pid } = playerOf(sim);
      row.setup(sim, meta, pid);
      const admission = evaluateSalvageAdmission(sim.ctx, pid, row.itemId);
      const resolved = resolveSalvage(sim.ctx, pid, row.itemId);
      expectSameAnswer(admission, resolved, row.expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Apply enchant: the worn arm, the bagged arm, and the bagged replace arm are
// three separate gate chains inside one pair of functions, so each gets rows.
// ---------------------------------------------------------------------------
interface ApplyRow {
  name: string;
  expected: string | null;
  itemId: string;
  enchantId: string;
  slot?: EquipSlot;
  confirmReplace?: boolean;
  setup: (sim: Sim, meta: PlayerMeta, pid: number) => void;
}

function runApplyRows(rows: ApplyRow[]): void {
  for (const row of rows) {
    it(row.name, () => {
      const sim = makeSim();
      const { meta, pid } = playerOf(sim);
      row.setup(sim, meta, pid);
      const admission = evaluateApplyEnchantAdmission(
        sim.ctx,
        pid,
        row.itemId,
        row.enchantId,
        row.slot,
        row.confirmReplace,
      );
      const resolved = resolveApplyEnchant(
        sim.ctx,
        pid,
        row.itemId,
        row.enchantId,
        row.slot,
        row.confirmReplace,
      );
      expectSameAnswer(admission, resolved, row.expected);
    });
  }
}

/** Wear SWORD in the mainhand, optionally carrying `enchantId`. */
function wearSword(meta: PlayerMeta, enchantId?: string): void {
  meta.equipment.mainhand = SWORD;
  meta.equipmentInstance = enchantId
    ? { mainhand: { enchant: enchantId, rolled: { stats: { str: 2 } } } }
    : {};
}

describe('apply-enchant admission matches its resolver (shared gates)', () => {
  runApplyRows([
    {
      name: 'an unknown item id',
      expected: 'unknown_item',
      itemId: MISSING_ITEM,
      enchantId: MIGHT,
      setup: () => {},
    },
    {
      name: 'an unknown enchant id',
      expected: 'unknown_enchant',
      itemId: SWORD,
      enchantId: MISSING_ENCHANT,
      setup: (sim, _meta, pid) => sim.addItem(SWORD, 1, pid),
    },
    {
      name: 'an enchant that targets a different item slot',
      expected: 'wrong_slot',
      itemId: SWORD,
      enchantId: HELMET_ENCHANT,
      setup: (sim, _meta, pid) => {
        sim.addItem(SWORD, 1, pid);
        sim.addItem(DUST, 5, pid);
      },
    },
  ]);
});

describe('apply-enchant admission matches its resolver (worn arm)', () => {
  runApplyRows([
    {
      name: 'the named slot is not wearing that item',
      expected: 'not_held',
      itemId: SWORD,
      enchantId: MIGHT,
      slot: 'mainhand',
      setup: (sim, meta, pid) => {
        sim.addItem(DUST, 5, pid);
        expect(meta.equipment.mainhand).not.toBe(SWORD);
      },
    },
    {
      name: 'the worn copy is already enchanted and no consent was given',
      expected: 'already_enchanted',
      itemId: SWORD,
      enchantId: AGILITY,
      slot: 'mainhand',
      setup: (sim, meta, pid) => {
        wearSword(meta, MIGHT);
        sim.addItem(DUST, 5, pid);
      },
    },
    {
      name: 'the confirmed replace re-applies the enchant already worn',
      expected: 'same_enchant',
      itemId: SWORD,
      enchantId: MIGHT,
      slot: 'mainhand',
      confirmReplace: true,
      setup: (sim, meta, pid) => {
        wearSword(meta, MIGHT);
        sim.addItem(DUST, 5, pid);
      },
    },
    {
      name: 'a reagent is short',
      expected: 'insufficient_materials',
      itemId: SWORD,
      enchantId: MIGHT,
      slot: 'mainhand',
      setup: (sim, meta, pid) => {
        wearSword(meta);
        sim.addItem(DUST, 4, pid); // one short of the five Might costs
      },
    },
    {
      name: 'a plain worn copy with every reagent held',
      expected: null,
      itemId: SWORD,
      enchantId: MIGHT,
      slot: 'mainhand',
      setup: (sim, meta, pid) => {
        wearSword(meta);
        sim.addItem(DUST, 5, pid);
      },
    },
  ]);
});

describe('apply-enchant admission matches its resolver (bagged arm)', () => {
  runApplyRows([
    {
      name: 'no copy held at all',
      expected: 'not_held',
      itemId: SWORD,
      enchantId: MIGHT,
      setup: (sim, _meta, pid) => sim.addItem(DUST, 5, pid),
    },
    {
      name: 'every held copy is already enchanted and no consent was given',
      expected: 'already_enchanted',
      itemId: SWORD,
      enchantId: AGILITY,
      setup: (sim, meta, pid) => {
        sim.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid, 1);
        sim.addItem(DUST, 5, pid);
        expect(sim.countEnchantableItem(SWORD, pid)).toBe(0);
        expect(meta.inventory.filter((s) => s.itemId === SWORD)).toHaveLength(1);
      },
    },
    {
      name: 'a reagent is short',
      expected: 'insufficient_materials',
      itemId: SWORD,
      enchantId: MIGHT,
      setup: (sim, _meta, pid) => {
        sim.addItem(SWORD, 1, pid);
        sim.addItem(DUST, 4, pid);
      },
    },
    {
      name: 'full bags where the consumed copy frees no home for the mint',
      expected: 'no_bag_space',
      itemId: SWORD,
      enchantId: MIGHT,
      setup: (_sim, meta) => {
        packBags(meta, 14, [
          { itemId: SWORD, count: 2 }, // overstacked: frees nothing
          { itemId: DUST, count: 10 }, // five remain: keeps its slot
        ]);
        expect(meta.inventory.length).toBe(bagCapacity(meta.bags));
      },
    },
    {
      name: 'a plain bagged copy with every reagent held',
      expected: null,
      itemId: SWORD,
      enchantId: MIGHT,
      setup: (sim, _meta, pid) => {
        sim.addItem(SWORD, 1, pid);
        sim.addItem(DUST, 5, pid);
      },
    },
  ]);
});

describe('apply-enchant admission matches its resolver (bagged replace arm)', () => {
  runApplyRows([
    {
      name: 'the confirmed replace re-applies the enchant already on the victim',
      expected: 'same_enchant',
      itemId: SWORD,
      enchantId: MIGHT,
      confirmReplace: true,
      setup: (sim, _meta, pid) => {
        sim.addItemInstance(SWORD, { enchant: MIGHT, rolled: { stats: { str: 2 } } }, pid, 1);
        sim.addItem(DUST, 5, pid);
      },
    },
    {
      name: 'a reagent is short for the replacement',
      expected: 'insufficient_materials',
      itemId: SWORD,
      enchantId: MIGHT,
      confirmReplace: true,
      setup: (sim, _meta, pid) => {
        sim.addItemInstance(SWORD, { enchant: AGILITY, rolled: { stats: { agi: 2 } } }, pid, 1);
        sim.addItem(DUST, 4, pid);
      },
    },
    {
      name: 'full bags where the victim stack survives and the mint has no home',
      expected: 'no_bag_space',
      itemId: SWORD,
      enchantId: MIGHT,
      confirmReplace: true,
      setup: (_sim, meta) => {
        packBags(meta, 14, [
          {
            itemId: SWORD,
            count: 2,
            instance: { enchant: AGILITY, rolled: { stats: { agi: 2 } } },
          },
          { itemId: DUST, count: 10 },
        ]);
        expect(meta.inventory.length).toBe(bagCapacity(meta.bags));
      },
    },
    {
      name: 'a confirmed replace onto a different enchant with room',
      expected: null,
      itemId: SWORD,
      enchantId: MIGHT,
      confirmReplace: true,
      setup: (sim, _meta, pid) => {
        sim.addItemInstance(SWORD, { enchant: AGILITY, rolled: { stats: { agi: 2 } } }, pid, 1);
        sim.addItem(DUST, 5, pid);
      },
    },
  ]);
});

// ---------------------------------------------------------------------------
// Tool recharge: the admission emits its denial instead of returning it, so
// both halves are read off the toolEffectResult event stream.
// ---------------------------------------------------------------------------
describe('tool-recharge admission matches its resolver', () => {
  /** The single recharge toolEffectResult `fn` emitted, or null when it
   *  emitted none (the admitted arm: the start path arms a cast instead). */
  function rechargeOutcome(sim: Sim, fn: () => void): Outcome {
    sim.drainEvents();
    fn();
    const events = sim
      .drainEvents()
      .filter(
        (e): e is Extract<SimEvent, { type: 'toolEffectResult' }> =>
          e.type === 'toolEffectResult' && e.action === 'recharge',
      );
    if (events.length === 0) return null;
    expect(events).toHaveLength(1);
    return { ok: events[0].ok, reason: events[0].reason };
  }

  /** Mint a mining tool-effect slot off a copper pick, the shipped path. */
  function slotMiningEffect(sim: Sim, meta: PlayerMeta): void {
    sim.addItem('copper_mining_pick', 1);
    sim.addItemInstance('gatherers_cache', { signer: meta.name }, sim.playerId, 1);
    sim.slotToolEffect('mining', 'gatherers_cache');
    if (!meta.toolEffectSlots?.mining) throw new Error('mining slot was not minted');
  }

  interface Row {
    name: string;
    expected: string | null;
    professionId: string;
    setup: (sim: Sim, meta: PlayerMeta) => void;
  }

  const rows: Row[] = [
    {
      name: 'a profession id that is not a gathering craft',
      expected: 'invalid_request',
      professionId: 'not_a_profession',
      setup: () => {},
    },
    {
      name: 'no slotted effect on that profession',
      expected: 'no_slot',
      professionId: 'mining',
      setup: (sim) => sim.addItem(DUST, 10),
    },
    {
      name: 'no tool owned to size the fill',
      expected: 'no_tool',
      professionId: 'mining',
      setup: (sim, meta) => {
        slotMiningEffect(sim, meta);
        const slot = meta.toolEffectSlots?.mining;
        if (!slot) throw new Error('slot');
        slot.durability = 0;
        sim.removeItem('copper_mining_pick', 1);
        sim.addItem(DUST, 10);
      },
    },
    {
      name: 'the slot is already at its ceiling',
      expected: 'already_full',
      professionId: 'mining',
      setup: (sim, meta) => {
        slotMiningEffect(sim, meta);
        sim.addItem(DUST, 10);
      },
    },
    {
      name: 'the owned tool cannot fill past what the slot already holds',
      expected: 'tool_capped',
      professionId: 'mining',
      setup: (sim, meta) => {
        slotMiningEffect(sim, meta);
        const slot = meta.toolEffectSlots?.mining;
        if (!slot) throw new Error('slot');
        // A ceiling ratcheted by a better tool that is no longer carried.
        slot.maxDurability = slot.durability * 2;
        sim.addItem(DUST, 10);
      },
    },
    {
      name: 'the arcane material is short',
      expected: 'insufficient_materials',
      professionId: 'mining',
      setup: (sim, meta) => {
        slotMiningEffect(sim, meta);
        const slot = meta.toolEffectSlots?.mining;
        if (!slot) throw new Error('slot');
        slot.durability = 0;
        expect(sim.countItem(DUST)).toBe(0);
      },
    },
    {
      name: 'a depleted slot, a tool in the bags, and the material paid for',
      expected: null,
      professionId: 'mining',
      setup: (sim, meta) => {
        slotMiningEffect(sim, meta);
        const slot = meta.toolEffectSlots?.mining;
        if (!slot) throw new Error('slot');
        slot.durability = 0;
        sim.addItem(DUST, 10);
      },
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      const sim = makeSim();
      const { p, meta } = playerOf(sim);
      row.setup(sim, meta);

      const admission = rechargeOutcome(sim, () => sim.rechargeToolEffect(row.professionId));
      // Drive the completion body directly: on a denied start no cast was
      // armed, and the resolve re-derives everything from the session id.
      const resolved = rechargeOutcome(sim, () => {
        p.toolRechargeCastProfessionId = row.professionId;
        completeRechargeCast(sim);
      });
      expectSameAnswer(admission, resolved, row.expected);
    });
  }
});

// Table-wide magnitude invariants for the enchant table (the finishing-bonus
// convention stated in the header of src/sim/content/enchants.ts). The
// aggregate stacks and the tier ladder are enforced here rather than
// eyeballed, because resolveApplyEnchant bakes statBonus into the item
// instance at apply time: an oversized table cannot be walked back after
// launch without stranding grandfathered items, so the table's power level
// has to be pinned before players can enchant at all.

import { describe, expect, it } from 'vitest';
import { ENCHANTS, type EnchantDef } from '../src/sim/content/enchants';
import { resolveApplyEnchant } from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import { xpForLevel } from '../src/sim/types';

type Axis = 'str' | 'agi' | 'sta' | 'int' | 'spi' | 'armor';
const AXES: readonly Axis[] = ['str', 'agi', 'sta', 'int', 'spi', 'armor'];

// Tier identity is derived from the reagent contract, exactly the doctrine the
// table's section comments state: Greater is the arcane_shard consumer, Runed
// consumes a resonant_* typed disenchant secondary, base is everything else.
const isGreater = (e: EnchantDef) => e.reagents.some((r) => r.itemId === 'arcane_shard');
const isRuned = (e: EnchantDef) => e.reagents.some((r) => r.itemId.startsWith('resonant_'));
const isBase = (e: EnchantDef) => !isGreater(e) && !isRuned(e);

const axisOf = (e: EnchantDef): Axis => AXES.filter((a) => (e.statBonus[a] ?? 0) > 0)[0];

/** Best statBonus value on `axis` among enchants passing `include`, per slot,
 *  summed with the ring slot counted twice (a character wears two rings). */
function bestPerSlotTotal(axis: Axis, include: (e: EnchantDef) => boolean = () => true): number {
  const bySlot = new Map<string, number>();
  for (const e of Object.values(ENCHANTS)) {
    if (!include(e)) continue;
    const v = e.statBonus[axis] ?? 0;
    if (v <= 0) continue;
    bySlot.set(e.itemSlot, Math.max(bySlot.get(e.itemSlot) ?? 0, v));
  }
  let total = 0;
  for (const [slot, v] of bySlot) total += slot === 'ring' ? v * 2 : v;
  return total;
}

/** Best value on `slot`+`axis` among enchants passing `include`, 0 when none. */
function bestValue(slot: string, axis: Axis, include: (e: EnchantDef) => boolean): number {
  let best = 0;
  for (const e of Object.values(ENCHANTS)) {
    if (e.itemSlot !== slot || !include(e)) continue;
    best = Math.max(best, e.statBonus[axis] ?? 0);
  }
  return best;
}

describe('enchant table magnitude invariants', () => {
  it('every enchant grants exactly one stat axis (the tier and stack sweeps below rely on it)', () => {
    for (const e of Object.values(ENCHANTS)) {
      // Nonzero, not positive: a negative side axis would slip past the
      // positive-only filters in axisOf and bestPerSlotTotal unseen.
      const axes = AXES.filter((a) => (e.statBonus[a] ?? 0) !== 0);
      expect(axes, e.id).toHaveLength(1);
      expect(e.statBonus[axes[0]] ?? 0, e.id).toBeGreaterThan(0);
    }
  });

  it('the best-per-slot stack per axis (rings twice) stays at the finishing-bonus totals', () => {
    // Sized against the recomputed level-20 BiS gear budgets (best item per
    // equip slot across the live tables, dual wield and masterwork variants
    // included): str 125, agi 130, sta 113, int 120, spi 93. The enchant
    // layer lands at roughly 15 to 25 percent of that budget per axis, the
    // "finishing bonus" target, instead of the pre-trim 30 to 43 percent.
    expect(bestPerSlotTotal('int')).toBe(24); // 20 percent of the 120 int budget
    expect(bestPerSlotTotal('sta')).toBe(24); // 21 percent of the 113 sta budget; the HP pin below covers the x10 conversion
    expect(bestPerSlotTotal('agi')).toBe(25); // 19 percent of the 130 agi budget
    expect(bestPerSlotTotal('str')).toBe(19); // 15 percent of the 125 str budget
    // Spirit rides only neck, chest, and the two rings, so its stack sits
    // below the band by construction; accepted and recorded rather than
    // padded with new enchants.
    expect(bestPerSlotTotal('spi')).toBe(12); // 13 percent of the 93 spi budget
    expect(bestPerSlotTotal('armor')).toBe(35); // helmet 15 plus chest 20, the halved reinforcement pair
  });

  it('every Greater enchant beats the best base option on its slot and axis by at least 3', () => {
    // If the shard tier collapses to a point or two over base, nobody
    // disenchants an epic and the arcane_shard sink dies.
    const greaters = Object.values(ENCHANTS).filter(isGreater);
    expect(greaters.map((e) => e.id).sort()).toEqual([
      'enchant_chest_greater_stamina',
      'enchant_gloves_greater_agility',
      'enchant_helmet_greater_fortitude',
      'enchant_legs_greater_stamina',
      'enchant_weapon_greater_might',
      'enchant_weapon_greater_spellpower',
    ]);
    for (const g of greaters) {
      const axis = axisOf(g);
      const base = bestValue(g.itemSlot, axis, isBase);
      expect(base, `${g.id}: base sibling exists`).toBeGreaterThan(0);
      expect((g.statBonus[axis] ?? 0) - base, `${g.id}: step over base`).toBeGreaterThanOrEqual(3);
    }
  });

  it('every Runed enchant sits strictly between base and Greater on its slot and axis', () => {
    const runed = Object.values(ENCHANTS).filter(isRuned);
    expect(runed.map((e) => e.id).sort()).toEqual([
      'enchant_chest_runeweave',
      'enchant_helmet_runed_links',
      'enchant_legs_runed_hide',
      'enchant_weapon_runed_edge',
      'enchant_weapon_runed_focus',
    ]);
    for (const r of runed) {
      const axis = axisOf(r);
      const v = r.statBonus[axis] ?? 0;
      const base = bestValue(r.itemSlot, axis, isBase);
      const greater = bestValue(r.itemSlot, axis, isGreater);
      if (base > 0) expect(v, `${r.id}: above base`).toBeGreaterThan(base);
      if (greater > 0) expect(v, `${r.id}: below Greater`).toBeLessThan(greater);
    }
    // Two runed rows lack a full ladder on their own slot and axis, so the
    // relational sweep above cannot see them regress: chest spirit has no
    // Greater (runeweave is the chest spirit ceiling) and legs agility has no
    // sibling at all. Pin their magnitudes as literals.
    expect(ENCHANTS.enchant_chest_runeweave.statBonus).toEqual({ spi: 5 });
    expect(ENCHANTS.enchant_legs_runed_hide.statBonus).toEqual({ agi: 4 });
  });
});

describe('the full stamina path in HP', () => {
  it('enchanting every stamina slot adds exactly 240 HP on a level-20 pool', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    while (sim.player.level < 20) sim.grantXp(xpForLevel(sim.player.level));
    expect(sim.player.level).toBe(20);

    // The best stamina path: Greater on helmet, chest, and legs, base on the
    // two slots without a Greater. The gear pieces are ordinary armor a
    // warrior can wear; their own stats cancel out of the delta below.
    const GEAR = [
      ['cryptbone_helm', 'helmet', 'enchant_helmet_greater_fortitude'],
      // Not recruit_tunic: the player spawns already wearing one (even with
      // autoEquip false), so equipping a bag copy just swaps with the worn
      // copy and the bag-empty probe below would see the displaced one.
      ['apprentice_robe', 'chest', 'enchant_chest_greater_stamina'],
      ['mistveil_cord', 'waist', 'enchant_waist_stamina'],
      ['quilted_trousers', 'legs', 'enchant_legs_greater_stamina'],
      ['oiled_boots', 'feet', 'enchant_feet_stamina'],
    ] as const;

    for (const [itemId] of GEAR) {
      sim.addItem(itemId, 1, pid);
      sim.equipItem(itemId);
      // countItem scans bags only, so 0 here proves the piece went on.
      expect(sim.countItem(itemId, pid), itemId).toBe(0);
    }
    const staBefore = sim.player.stats.sta;
    const hpBefore = sim.player.maxHp;
    // Past the soft knee every further stamina point converts to 10 HP
    // (hpFromStamina in src/sim/entity.ts), which is why stamina is the most
    // tightly trimmed axis: the 24-point stack below must land at exactly
    // plus 240 HP, inside the intended 230 to 250 band.
    expect(staBefore).toBeGreaterThanOrEqual(20);

    sim.addItem('arcane_shard', 3, pid);
    sim.addItem('arcane_essence', 8, pid);
    sim.addItem('arcane_dust', 8, pid);
    for (const [itemId, slot, enchantId] of GEAR) {
      expect(sim.unequipItem(slot), slot).toBe(true);
      const applied = resolveApplyEnchant(sim.ctx, pid, itemId, enchantId);
      expect(applied.ok, enchantId).toBe(true);
      sim.equipItem(itemId);
      expect(sim.countItem(itemId, pid), itemId).toBe(0);
    }
    expect(sim.player.stats.sta).toBe(staBefore + 24);
    expect(sim.player.maxHp).toBe(hpBefore + 240);
  });
});

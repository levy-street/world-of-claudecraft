// The learned faction formulas at runtime (content/enchants.ts "Faction
// formulas", docs/design/factions.md): Riftwalker's Grace procs Agility plus a
// haste multiplier through the shared enchant proc hub, the two Church Order
// etchings bake Spell Power / Healing Power into the copy and the stat sum
// reads them back, and Piston Drive admits only a two-handed weapon. The table
// figures themselves are pinned in tests/enchants_magnitude_invariants.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { runWeaponProcs } from '../src/sim/combat/equip_procs';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import { createPlayer, recalcPlayerStats } from '../src/sim/entity';
import {
  enchantAdmitsWeaponHand,
  evaluateApplyEnchantAdmission,
  resolveApplyEnchant,
} from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const GRACE = 'enchant_weapon_riftwalkers_grace';
const ZEAL = 'enchant_weapon_lastflame_zeal';
const DAWNFIRE = 'enchant_weapon_dawnfire_etching';
const BENEDICTION = 'enchant_weapon_dawns_benediction';
const PISTON = 'enchant_weapon_piston_drive';
const ONE_HANDER = 'eastbrook_arming_sword';
const TWO_HANDER = 'forgemaster_crag_cleaver';

// The tests/lastflame_enchant.test.ts proc harness: a forced-true rng, a
// player whose two hands carry the enchant, and an aura sink that models
// applyAura's refresh-by-id rule.
function procHarness(enchantId: string) {
  const wielder = createPlayer(1, 'rogue', { x: 0, y: 0, z: 0 }, 'Crafter');
  const target = createPlayer(2, 'warrior', { x: 2, y: 0, z: 0 }, 'Target');
  wielder.level = 20;
  wielder.auras = [];
  wielder.mainhandItemId = 'duskforged_warblade';
  wielder.offhandItemId = 'rusty_dagger';
  const equipmentInstance = {
    mainhand: { enchant: enchantId },
    offhand: { enchant: enchantId },
  };
  const applied: Aura[] = [];
  const raw = {
    rng: { chance: vi.fn(() => true) },
    players: new Map([[wielder.id, { equipmentInstance }]]),
    applyAura: (_target: unknown, aura: Aura) => {
      applied.push(aura);
      wielder.auras = wielder.auras.filter((active) => active.id !== aura.id);
      wielder.auras.push(aura);
    },
    applyHeal: vi.fn(),
    emit: vi.fn(),
  };
  return { wielder, target, raw, applied, ctx: raw as unknown as SimContext };
}

function learnedSim(enchantId: string, seed = 11) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  const pid = sim.playerId;
  const meta = sim.ctx.resolve(pid)?.meta;
  if (!meta) throw new Error('fixture player missing');
  meta.craftSkills.enchanting = 100;
  meta.knownRecipes.add(enchantId);
  sim.addItem('arcane_shard', 2, pid);
  sim.addItem('arcane_essence', 4, pid);
  return { sim, pid, meta };
}

describe("Riftwalker's Grace: the Agility proc through the shared enchant hub", () => {
  it('a melee hit grants the Agility buff and a sibling haste multiplier, and heals nothing', () => {
    const { ctx, raw, wielder, target, applied } = procHarness(GRACE);
    runWeaponProcs(ctx, wielder, target, 'weaponHit', 'duskforged_warblade', 'mainhand');
    expect(raw.rng.chance).toHaveBeenCalledExactlyOnceWith(
      ITEMS.duskforged_warblade.weapon!.speed / 60,
    );
    const proc = ENCHANTS[GRACE].weaponProc!;
    expect(applied.map((a) => [a.id, a.kind, a.value, a.duration])).toEqual([
      [GRACE, 'buff_agi', proc.agility, proc.duration],
      [`${GRACE}_haste`, 'buff_haste', proc.hasteMult, proc.duration],
    ]);
    expect(raw.applyHeal).not.toHaveBeenCalled();
  });

  it('a second trigger from the OTHER hand refreshes both auras rather than stacking a second copy', () => {
    const { ctx, wielder, target } = procHarness(GRACE);
    runWeaponProcs(ctx, wielder, target, 'weaponHit', 'duskforged_warblade', 'mainhand');
    runWeaponProcs(ctx, wielder, target, 'weaponHit', 'rusty_dagger', 'offhand');
    expect(wielder.auras.filter((a) => a.id === GRACE)).toHaveLength(1);
    expect(wielder.auras.filter((a) => a.id === `${GRACE}_haste`)).toHaveLength(1);
  });

  it('a ranged trigger never fires the melee enchant', () => {
    const { ctx, raw, wielder, target, applied } = procHarness(GRACE);
    runWeaponProcs(ctx, wielder, target, 'weaponHit');
    expect(raw.rng.chance).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });

  it("Zeal's own path is unchanged: a Strength buff, no haste sibling, and the self-heal", () => {
    const { ctx, raw, wielder, target, applied } = procHarness(ZEAL);
    runWeaponProcs(ctx, wielder, target, 'weaponHit', 'duskforged_warblade', 'mainhand');
    const proc = ENCHANTS[ZEAL].weaponProc!;
    expect(applied.map((a) => [a.id, a.kind, a.value])).toEqual([
      [ZEAL, 'buff_str', proc.strength],
    ]);
    expect(raw.applyHeal).toHaveBeenCalledExactlyOnceWith(
      wielder,
      wielder,
      proc.heal,
      ENCHANTS[ZEAL].name,
      ZEAL,
      false,
      false,
    );
  });
});

describe('the Church Order etchings: baked power lines the stat sum reads back', () => {
  it.each([
    [DAWNFIRE, 'spellPower', 18],
    [BENEDICTION, 'healingPower', 34],
  ] as const)(
    '%s bakes %s %d into the copy and it reaches the entity',
    (enchantId, axis, amount) => {
      const { sim, pid, meta } = learnedSim(enchantId);
      sim.addItem(ONE_HANDER, 1, pid);
      const result = resolveApplyEnchant(sim.ctx, pid, ONE_HANDER, enchantId);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const slot = meta.inventory.find((s) => s.itemId === ONE_HANDER);
      expect(slot?.instance?.enchant).toBe(enchantId);
      expect(slot?.instance?.rolled?.stats).toEqual({ [axis]: amount });

      // Wear the enchanted copy: the entity's line moves by exactly the bake.
      const player = sim.player;
      meta.equipment.mainhand = ONE_HANDER;
      meta.equipmentInstance.mainhand = {};
      recalcPlayerStats(player, 'warrior', meta.equipment, meta.talentMods, meta.equipmentInstance);
      const plainSp = player.spellPower;
      const plainHeal = player.healPower;
      meta.equipmentInstance.mainhand = { ...slot!.instance! };
      recalcPlayerStats(player, 'warrior', meta.equipment, meta.talentMods, meta.equipmentInstance);
      if (axis === 'spellPower') {
        expect(player.spellPower - plainSp).toBe(amount);
        // Spell Power counts toward Healing Power (entity.ts), as the tooltip says.
        expect(player.healPower - plainHeal).toBe(amount);
      } else {
        expect(player.spellPower - plainSp).toBe(0);
        expect(player.healPower - plainHeal).toBe(amount);
      }
    },
  );

  it('an unlearned formula is refused at the admission gate, like Zeal', () => {
    const { sim, pid, meta } = learnedSim(DAWNFIRE);
    meta.knownRecipes.delete(DAWNFIRE);
    sim.addItem(ONE_HANDER, 1, pid);
    expect(evaluateApplyEnchantAdmission(sim.ctx, pid, ONE_HANDER, DAWNFIRE)?.reason).toBe(
      'recipe_not_learned',
    );
    expect(resolveApplyEnchant(sim.ctx, pid, ONE_HANDER, DAWNFIRE).reason).toBe(
      'recipe_not_learned',
    );
  });
});

describe('Piston Drive: the two-hander gate', () => {
  it('the predicate admits only a hand:twohand weapon, and every other enchant admits its slot', () => {
    expect(enchantAdmitsWeaponHand(ENCHANTS[PISTON], ITEMS[TWO_HANDER])).toBe(true);
    expect(enchantAdmitsWeaponHand(ENCHANTS[PISTON], ITEMS[ONE_HANDER])).toBe(false);
    expect(enchantAdmitsWeaponHand(ENCHANTS.enchant_weapon_might, ITEMS[ONE_HANDER])).toBe(true);
    expect(enchantAdmitsWeaponHand(ENCHANTS.enchant_weapon_might, ITEMS[TWO_HANDER])).toBe(true);
  });

  it('a one-handed weapon is refused at both arms; the two-hander takes the etching', () => {
    const { sim, pid, meta } = learnedSim(PISTON);
    sim.addItem(ONE_HANDER, 1, pid);
    sim.addItem(TWO_HANDER, 1, pid);
    expect(evaluateApplyEnchantAdmission(sim.ctx, pid, ONE_HANDER, PISTON)?.reason).toBe(
      'wrong_slot',
    );
    expect(resolveApplyEnchant(sim.ctx, pid, ONE_HANDER, PISTON).reason).toBe('wrong_slot');
    // Reagents untouched by the refusal.
    expect(sim.countItem('arcane_shard', pid)).toBe(2);
    expect(evaluateApplyEnchantAdmission(sim.ctx, pid, TWO_HANDER, PISTON)).toBeNull();
    const result = resolveApplyEnchant(sim.ctx, pid, TWO_HANDER, PISTON);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const slot = meta.inventory.find((s) => s.itemId === TWO_HANDER);
    expect(slot?.instance?.rolled?.stats).toEqual({ str: 12, critRating: 25 });
    expect(sim.countItem('arcane_shard', pid)).toBe(0);
  });
});

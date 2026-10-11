// Feral strikes outside the meleeSwing shell roll the mainhand melee enchant
// (Last Flame's Zeal, Riftwalker's Grace): the cat finishers (finisherDamage),
// Marrowbreak (directDamage) and Sweeping Claws (aoeDamage, once per cast).
// Before this only autos and weaponStrike specials rolled, so a bear rolled on
// its auto swings alone and a cat's Redharvest never rolled; together with
// cat specials rolling at the 1 sec paw speed that left a feral at roughly a
// third of a Bloodrush warrior's Zeal uptime.
//
// Every case counts the enchant rolls by their exact chance argument
// (ppm * weapon speed / 60), so a missing roll, a duplicated roll, a per-target
// AoE roll, or a roll at the paw speed all fail.

import { describe, expect, it, vi } from 'vitest';
import { rollFeralStrikeEnchant } from '../src/sim/combat/equip_procs';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const ZEAL = 'enchant_weapon_lastflame_zeal';
const STAFF = 'gnarled_staff';
const STAFF_ROLL = (ITEMS[STAFF].weapon?.speed ?? 0) / 60;

function druid(opts: { enchanted: boolean; spec?: 'feral' }) {
  const sim = new Sim({
    seed: 71,
    playerClass: 'druid',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(20);
  if (opts.spec) expect(sim.setSpec(opts.spec)).toBe(true);
  const source = sim.player;
  const ctx = (sim as unknown as { ctx: SimContext }).ctx;
  const meta = sim.players.get(source.id);
  if (!meta) throw new Error('fixture player missing');
  meta.equipment.mainhand = STAFF;
  if (opts.enchanted) meta.equipmentInstance.mainhand = { enchant: ZEAL };
  recalcPlayerStats(source, 'druid', meta.equipment, meta.talentMods, meta.equipmentInstance);
  return { sim, ctx, source };
}

function dummy(sim: Sim, id: number, dx = 0): Entity {
  const p = sim.player;
  const target = createMob(id, MOBS.training_dummy, 20, {
    ...p.pos,
    x: p.pos.x + dx,
    z: p.pos.z + 2,
  });
  target.maxHp = target.hp = 1_000_000;
  target.hostile = true;
  // addEntity, not a bare Map set: area strikes search the spatial grid.
  sim.addEntity(target);
  return target;
}

function shift(sim: Sim, form: 'cat_form' | 'bear_form', target: Entity): void {
  const p = sim.player;
  p.resource = p.maxResource;
  sim.castAbility(form);
  p.targetId = target.id;
  p.facing = 0;
  p.gcdRemaining = 0;
  p.resource = p.maxResource;
}

// Cast one ability with every rng.chance call recorded (real outcomes), and
// return how many of them were the staff-speed enchant roll.
function enchantRollsDuring(ctx: SimContext, cast: () => void): number {
  const chance = vi.spyOn(ctx.rng, 'chance');
  cast();
  const rolls = chance.mock.calls.filter(([p]) => p === STAFF_ROLL).length;
  chance.mockRestore();
  return rolls;
}

describe('feral strikes roll the mainhand melee enchant', () => {
  it('a landed Cat Form finisher (Gorebite) rolls once at the weapon speed', () => {
    const { sim, ctx, source } = druid({ enchanted: true });
    const target = dummy(sim, 9601);
    shift(sim, 'cat_form', target);
    source.comboPoints = 5;
    const hpBefore = target.hp;
    expect(enchantRollsDuring(ctx, () => sim.castAbility('ferocious_bite'))).toBe(1);
    expect(target.hp).toBeLessThan(hpBefore);
  });

  it('Sweeping Claws rolls ONCE per cast however many enemies it strikes', () => {
    const { sim, ctx, source } = druid({ enchanted: true });
    const targets = [dummy(sim, 9611, -1), dummy(sim, 9612, 0), dummy(sim, 9613, 1)];
    shift(sim, 'bear_form', targets[1]);
    const before = targets.map((t) => t.hp);
    expect(enchantRollsDuring(ctx, () => sim.castAbility('swipe'))).toBe(1);
    // All three were struck, so a per-target roll would have counted three.
    for (const [i, t] of targets.entries()) expect(t.hp).toBeLessThan(before[i]);
    expect(source.auras.some((a) => a.kind === 'form_bear')).toBe(true);
  });

  it('a landed Marrowbreak rolls once at the weapon speed', () => {
    const { sim, ctx, source } = druid({ enchanted: true, spec: 'feral' });
    const target = dummy(sim, 9621);
    shift(sim, 'bear_form', target);
    // Marrowbreak is the Maul button at 3 Old Blood (actionReplacement).
    // A physical strike can miss; retry until one lands (each cast spends
    // the 3 Old Blood, so re-bank it), then pin the landed cast's rolls. A
    // miss must roll nothing.
    let landed = false;
    for (let attempt = 0; attempt < 20 && !landed; attempt++) {
      ctx.applyAura(source, {
        id: 'old_blood',
        name: 'Old Blood',
        kind: 'old_blood',
        value: 0,
        stacks: 3,
        remaining: 30,
        duration: 30,
        sourceId: source.id,
        school: 'physical',
      });
      // Full health: the strike, not the below-half guard that replaces it.
      source.hp = source.maxHp;
      source.gcdRemaining = 0;
      source.resource = source.maxResource;
      const hpBefore = target.hp;
      const rolls = enchantRollsDuring(ctx, () => sim.castAbility('maul'));
      landed = target.hp < hpBefore;
      expect(rolls).toBe(landed ? 1 : 0);
    }
    expect(landed).toBe(true);
  });

  it('draws nothing for an unenchanted feral, so every ordinary stream is unchanged', () => {
    const { sim, ctx, source } = druid({ enchanted: false });
    const target = dummy(sim, 9631);
    shift(sim, 'cat_form', target);
    source.comboPoints = 5;
    expect(enchantRollsDuring(ctx, () => sim.castAbility('ferocious_bite'))).toBe(0);
  });

  it('is scoped to physical Cat and Bruin Form strikes', () => {
    const { ctx, source } = druid({ enchanted: true });
    const chance = vi.spyOn(ctx.rng, 'chance');
    // No form requirement (a warrior Execute shape), and a non-physical form ability.
    rollFeralStrikeEnchant(ctx, source, { school: 'physical' });
    rollFeralStrikeEnchant(ctx, source, { requiresForm: 'cat', school: 'nature' });
    expect(chance).not.toHaveBeenCalled();
    rollFeralStrikeEnchant(ctx, source, { requiresForm: 'bear', school: 'physical' });
    expect(chance).toHaveBeenCalledExactlyOnceWith(STAFF_ROLL);
    chance.mockRestore();
  });
});

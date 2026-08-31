import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { coatTickValue, nextCoatStacks, poisonCoatFor } from '../src/sim/combat/poison_coating';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// The rogue poisons are weapon COATS: the ability puts an imbue on you, and a
// landed melee swing carries the coat's rider onto whatever you struck.
//   Adder's Bite     +14 flat Nature damage per swing, no rider
//   Festering Venom  a stacking Nature DoT (4 per tick per stack, cap 5, every
//                    2 sec for 12 sec), refreshed by every landed swing
// This file pins the shared machinery (combat/poison_coating.ts) and the two
// damage poisons; tests/rogue_utility_poisons.test.ts pins the two utility
// coats that ride the same seam.

type SimInternals = { rebucket(e: Entity): void; addEntity(e: Entity): void; ctx: SimContext };

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as SimInternals).ctx;
}

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as SimInternals).rebucket(e);
}

/** A level-20 rogue toe to toe with a hostile mob of `mobLevel`. */
function poisonRig(mobLevel = 10): { sim: Sim; rogue: Entity; mob: Entity } {
  const sim = new Sim({ seed: 3, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  const rogue = sim.player;
  teleport(sim, rogue, 0, 0);
  const mob = createMob(34_000, MOBS.forest_wolf, mobLevel, { x: 0, y: 0, z: 0 });
  mob.hostile = true;
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  (sim as unknown as SimInternals).addEntity(mob);
  teleport(sim, mob, 2, 0);
  rogue.facing = Math.atan2(mob.pos.x - rogue.pos.x, mob.pos.z - rogue.pos.z);
  rogue.resource = rogue.maxResource;
  sim.targetEntity(mob.id);
  return { sim, rogue, mob };
}

/** Coating abilities target the caster, so no projectile travel is involved and
 *  a handful of ticks settles the cast. */
function coat(sim: Sim, rogue: Entity, id: string): void {
  rogue.gcdRemaining = 0;
  rogue.resource = rogue.maxResource;
  sim.castAbility(id);
  for (let i = 0; i < 5; i++) sim.tick();
}

/** One white mainhand swing through the REAL shared shell, returning whether it
 *  connected (a miss, dodge or parry returns false). */
function swing(sim: Sim, rogue: Entity, mob: Entity): boolean {
  return meleeSwing(ctxOf(sim), rogue, mob, 0, null, {
    autoAttackHand: 'mainhand',
    autoAttack: true,
  });
}

function dotOf(target: Entity, id: string, sourceId: number): Entity['auras'][number] | undefined {
  return target.auras.find((a) => a.id === id && a.kind === 'dot' && a.sourceId === sourceId);
}

describe('the poison-coating stack math', () => {
  it('adds one stack per application and clamps at the cap', () => {
    expect(nextCoatStacks(undefined, 5)).toBe(1);
    expect(nextCoatStacks(1, 5)).toBe(2);
    expect(nextCoatStacks(4, 5)).toBe(5);
    expect(nextCoatStacks(5, 5)).toBe(5);
    // A cap below 1 still yields a real application rather than a zero-stack aura.
    expect(nextCoatStacks(undefined, 0)).toBe(1);
  });

  it('scales the per-tick damage by the stack count, never below 1', () => {
    expect(coatTickValue(4, 1)).toBe(4);
    expect(coatTickValue(4, 3)).toBe(12);
    expect(coatTickValue(4, 5)).toBe(20);
    expect(coatTickValue(0.1, 1)).toBe(1);
  });

  it('reads the rider off the ability, and only where one is authored', () => {
    expect(poisonCoatFor('deadly_poison')).toEqual({
      rider: 'stackDot',
      perTick: 4,
      maxStacks: 5,
      duration: 12,
      interval: 2,
    });
    expect(poisonCoatFor('instant_poison')).toBeNull();
    expect(poisonCoatFor('seal_of_righteousness')).toBeNull();
    expect(poisonCoatFor('not_an_ability')).toBeNull();
  });
});

describe("Adder's Bite", () => {
  it('is the flat coat: 14 damage per swing, no rider', () => {
    const imbue = ABILITIES.instant_poison.effects.find((e) => e.type === 'imbue');
    expect(imbue).toBeDefined();
    expect(imbue?.type === 'imbue' && imbue.bonus).toBe(14);
    expect(imbue?.type === 'imbue' && imbue.coat).toBeUndefined();
  });

  it('adds its flat damage to a landed swing and leaves nothing on the target', () => {
    const { sim, rogue, mob } = poisonRig();
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const bare: number[] = [];
    for (let i = 0; i < 12; i++) {
      const hpBefore = mob.hp;
      if (swing(sim, rogue, mob)) bare.push(hpBefore - mob.hp);
    }
    coat(sim, rogue, 'instant_poison');
    const coated: number[] = [];
    for (let i = 0; i < 12; i++) {
      const hpBefore = mob.hp;
      if (swing(sim, rogue, mob)) coated.push(hpBefore - mob.hp);
    }
    expect(bare.length).toBeGreaterThan(0);
    expect(coated.length).toBeGreaterThan(0);
    // The +14 rides the swing itself (auto_attack's imbueBonus), so coated
    // swings hit strictly harder on average.
    expect(mean(coated)).toBeGreaterThan(mean(bare));
    // ...and the flat coat carries no rider, so the target keeps no debuff.
    expect(mob.auras.filter((a) => a.sourceId === rogue.id)).toHaveLength(0);
  });
});

describe('Festering Venom', () => {
  it('coats the weapon rather than striking: the cast alone touches nothing', () => {
    const { sim, rogue, mob } = poisonRig();
    const hpBefore = mob.hp;
    expect(ABILITIES.deadly_poison.requiresTarget).toBe(false);

    coat(sim, rogue, 'deadly_poison');

    expect(rogue.auras.find((a) => a.id === 'deadly_poison')?.kind).toBe('imbue');
    expect(mob.hp).toBe(hpBefore);
    expect(mob.auras).toHaveLength(0);
  });

  it('festers a stacking Nature DoT that ramps 4 to 20 per tick over 5 swings', () => {
    const { sim, rogue, mob } = poisonRig();
    coat(sim, rogue, 'deadly_poison');

    let landed = 0;
    for (let i = 0; i < 60 && landed < 5; i++) {
      if (!swing(sim, rogue, mob)) continue;
      landed += 1;
      const dot = dotOf(mob, 'deadly_poison', rogue.id);
      expect(dot).toBeDefined();
      expect(dot?.stacks).toBe(landed);
      expect(dot?.value).toBe(4 * landed);
      // Every application fully refreshes the 12 sec timer.
      expect(dot?.remaining).toBe(12);
    }
    expect(landed).toBe(5);

    const dot = dotOf(mob, 'deadly_poison', rogue.id);
    expect(dot?.school).toBe('nature');
    expect(dot?.duration).toBe(12);
    expect(dot?.tickInterval).toBe(2);
    expect(dot?.value).toBe(20);
  });

  it('caps at 5 stacks however long you keep swinging', () => {
    const { sim, rogue, mob } = poisonRig();
    coat(sim, rogue, 'deadly_poison');
    for (let i = 0; i < 40; i++) swing(sim, rogue, mob);
    const dot = dotOf(mob, 'deadly_poison', rogue.id);
    expect(dot?.stacks).toBe(5);
    expect(dot?.value).toBe(20);
  });

  it('announces the aura only while the stack count actually moves', () => {
    // A coat re-applies on EVERY landed swing, so a refresh must stay silent:
    // 5 announcements (one per stack gained) and nothing after the cap, rather
    // than one broadcast per swing for the rest of the fight.
    const { sim, rogue, mob } = poisonRig();
    coat(sim, rogue, 'deadly_poison');
    sim.drainEvents();

    let landed = 0;
    for (let i = 0; i < 40; i++) if (swing(sim, rogue, mob)) landed += 1;
    expect(landed).toBeGreaterThan(5);

    const announced = sim
      .drainEvents()
      .filter((e) => e.type === 'aura' && e.targetId === mob.id && e.name === 'Festering Venom');
    expect(announced).toHaveLength(5);
    // ...and the timer is still being refreshed by the silent swings.
    expect(dotOf(mob, 'deadly_poison', rogue.id)?.remaining).toBe(12);
  });

  it('never poisons a swing that whiffed: stacks count LANDED swings only', () => {
    // A level-32 target sits far above the rogue, so the hit table misses often.
    const { sim, rogue, mob } = poisonRig(32);
    coat(sim, rogue, 'deadly_poison');
    let landed = 0;
    let swings = 0;
    for (let i = 0; i < 12; i++) {
      swings += 1;
      if (swing(sim, rogue, mob)) landed += 1;
      expect(dotOf(mob, 'deadly_poison', rogue.id)?.stacks ?? 0).toBe(Math.min(5, landed));
    }
    // The premise the assertion above rests on: some of those swings really whiffed.
    expect(landed).toBeLessThan(swings);
  });

  it('ticks its stacked value every 2 sec and expires 12 sec after the last swing', () => {
    const { sim, rogue, mob } = poisonRig();
    coat(sim, rogue, 'deadly_poison');
    while (dotOf(mob, 'deadly_poison', rogue.id) === undefined) swing(sim, rogue, mob);
    const perTick = dotOf(mob, 'deadly_poison', rogue.id)?.value ?? 0;
    expect(perTick).toBe(4);

    const hpBefore = mob.hp;
    for (let i = 0; i < 20 * 2; i++) sim.tick(); // exactly one tick interval
    expect(hpBefore - mob.hp).toBe(perTick);

    for (let i = 0; i < 20 * 11; i++) sim.tick();
    expect(dotOf(mob, 'deadly_poison', rogue.id)).toBeUndefined();
  });

  it("Knifework's Redhanded raises the rider, not just the flat coats", () => {
    // Redhanded promises "your poison damage by 10%". Festering Venom's damage
    // IS its rider now, so the passive has to reach the DoT or it silently pays
    // nothing on the one poison that is pure poison damage.
    const { sim, rogue, mob } = poisonRig();
    expect(sim.setSpec('assassination')).toBe(true);
    coat(sim, rogue, 'deadly_poison');
    for (let i = 0; i < 40; i++) swing(sim, rogue, mob);
    // 4 x 1.1 = 4.4 per stack, rounded ONCE at 5 stacks: 22, not the base 20.
    expect(dotOf(mob, 'deadly_poison', rogue.id)?.stacks).toBe(5);
    expect(dotOf(mob, 'deadly_poison', rogue.id)?.value).toBe(22);
  });

  it('two rogues each ramp their own stack of the same poison', () => {
    const { sim, rogue, mob } = poisonRig();
    coat(sim, rogue, 'deadly_poison');
    const otherId = sim.addPlayer('rogue', 'Nightsliver');
    const other = sim.entities.get(otherId);
    expect(other).toBeDefined();
    if (!other) return;
    sim.setPlayerLevel(20, otherId);
    teleport(sim, other, -2, 0);
    other.auras.push({
      id: 'deadly_poison',
      name: 'Festering Venom',
      kind: 'imbue',
      remaining: 1800,
      duration: 1800,
      value: 0,
      sourceId: other.id,
      school: 'nature',
    });

    while (dotOf(mob, 'deadly_poison', rogue.id) === undefined) swing(sim, rogue, mob);
    while (dotOf(mob, 'deadly_poison', other.id) === undefined) swing(sim, other, mob);

    expect(dotOf(mob, 'deadly_poison', rogue.id)?.stacks).toBe(1);
    expect(dotOf(mob, 'deadly_poison', other.id)?.stacks).toBe(1);
    expect(mob.auras.filter((a) => a.id === 'deadly_poison')).toHaveLength(2);
  });
});

describe('one coat at a time', () => {
  it('a second poison replaces the first, so two riders never run together', () => {
    const { sim, rogue, mob } = poisonRig();
    coat(sim, rogue, 'deadly_poison');
    coat(sim, rogue, 'instant_poison');

    const imbues = rogue.auras.filter((a) => a.kind === 'imbue');
    expect(imbues).toHaveLength(1);
    expect(imbues[0].id).toBe('instant_poison');

    for (let i = 0; i < 10; i++) swing(sim, rogue, mob);
    expect(dotOf(mob, 'deadly_poison', rogue.id)).toBeUndefined();
  });
});

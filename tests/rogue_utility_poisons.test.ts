import { describe, expect, it } from 'vitest';
import { healingTakenMult } from '../src/sim/combat/heal';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { ABILITIES, CLASSES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// The two utility poisons added alongside the rogue rework. Both are strike
// poisons in the Leaden Venom mould: a small Nature hit that carries the strike
// into combat plus one rider.
//   Melting Acid       -5% target armor, 12 sec (aura kind 'melting_acid')
//   Nightshade Coating -25% healing the target receives, 12 sec (reuses the
//                      existing 'mortal_wound' kind)

type SimInternals = { rebucket(e: Entity): void; addEntity(e: Entity): void; ctx: SimContext };

function ctxOf(sim: Sim): SimContext {
  return (sim as unknown as SimInternals).ctx;
}

/** Read both riders through the ONE production path each, never a restatement
 *  of the arithmetic: armor DR via Sim.effectiveArmor, healing taken via
 *  combat/heal.ts healingTakenMult. */
function effectiveArmor(sim: Sim, e: Entity): number {
  return ctxOf(sim).effectiveArmor(e);
}
function healingTaken(sim: Sim, e: Entity): number {
  return healingTakenMult(ctxOf(sim), e);
}

function teleport(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as SimInternals).rebucket(e);
}

function poisonRig(): { sim: Sim; rogue: Entity; mob: Entity } {
  const sim = new Sim({ seed: 3, playerClass: 'rogue', autoEquip: true });
  sim.setPlayerLevel(20);
  const rogue = sim.player;
  teleport(sim, rogue, 0, 0);
  const mob = createMob(34_000, MOBS.forest_wolf, 10, { x: 0, y: 0, z: 0 });
  mob.hostile = true;
  (sim as unknown as SimInternals).addEntity(mob);
  teleport(sim, mob, 2, 0);
  rogue.facing = Math.atan2(mob.pos.x - rogue.pos.x, mob.pos.z - rogue.pos.z);
  rogue.resource = rogue.maxResource;
  sim.targetEntity(mob.id);
  return { sim, rogue, mob };
}

// Nature-school casts travel as projectiles (the same default Leaden Venom
// takes), so the rider lands a few ticks after the cast, not on the same one.
function cast(sim: Sim, rogue: Entity, id: string, pid?: number): void {
  rogue.gcdRemaining = 0;
  rogue.resource = rogue.maxResource;
  sim.castAbility(id, pid);
  for (let i = 0; i < 20; i++) sim.tick();
}

function auraOf(target: Entity, id: string) {
  return target.auras.find((a) => a.id === id);
}

describe('the rogue learns both utility poisons', () => {
  it('they are class abilities on the rogue list at their learn levels', () => {
    expect(CLASSES.rogue.abilities).toContain('melting_acid');
    expect(CLASSES.rogue.abilities).toContain('nightshade_coating');
    expect(ABILITIES.melting_acid.class).toBe('rogue');
    expect(ABILITIES.nightshade_coating.class).toBe('rogue');

    const known = (level: number) => abilitiesKnownAt('rogue', level).map((k) => k.def.id);
    expect(known(15)).not.toContain('melting_acid');
    expect(known(16)).toContain('melting_acid');
    expect(known(17)).not.toContain('nightshade_coating');
    expect(known(18)).toContain('nightshade_coating');
  });
});

describe('Melting Acid', () => {
  it('shaves 5% off the target armor for 12 sec', () => {
    const { sim, rogue, mob } = poisonRig();
    const armorBefore = effectiveArmor(sim, mob);
    expect(armorBefore).toBeGreaterThan(0);

    cast(sim, rogue, 'melting_acid');
    const aura = auraOf(mob, 'melting_acid');
    expect(aura).toBeDefined();
    expect(aura?.kind).toBe('melting_acid');
    expect(aura?.value).toBeCloseTo(0.05);
    expect(aura?.duration).toBe(12);

    expect(effectiveArmor(sim, mob)).toBeCloseTo(armorBefore * 0.95, 6);

    // ...and it really expires on its own timer (12 sec from the landing).
    for (let i = 0; i < 20 * 13; i++) sim.tick();
    expect(auraOf(mob, 'melting_acid')).toBeUndefined();
    expect(effectiveArmor(sim, mob)).toBeCloseTo(armorBefore, 6);
  });

  it('max-combines with the other percent armor debuffs instead of stacking', () => {
    const { sim, rogue, mob } = poisonRig();
    const armorBefore = effectiveArmor(sim, mob);
    cast(sim, rogue, 'melting_acid');
    // Faerie Fire is the deeper cut (10%), so the pair reads as 10%, not 15%:
    // the same rule Sunder Armor and Faerie Fire already share (effectiveArmor).
    mob.auras.push({
      id: 'faerie_fire',
      name: 'Witchlight',
      kind: 'faerie_fire',
      remaining: 40,
      duration: 40,
      value: 0,
      sourceId: rogue.id,
      school: 'nature',
    });
    expect(effectiveArmor(sim, mob)).toBeCloseTo(armorBefore * 0.9, 6);
  });

  it('the strike puts both sides into combat, like Leaden Venom', () => {
    const { sim, rogue, mob } = poisonRig();
    cast(sim, rogue, 'melting_acid');
    expect(rogue.inCombat).toBe(true);
    expect(mob.threat.has(rogue.id)).toBe(true);
  });
});

describe('Nightshade Coating', () => {
  it('cuts the healing the target receives by 25% for 12 sec', () => {
    const sim = new Sim({ seed: 3, playerClass: 'rogue', noPlayer: true });
    const rogueId = sim.addPlayer('rogue', 'Slip');
    const foeId = sim.addPlayer('priest', 'Mark');
    sim.duels.set(rogueId, { a: rogueId, b: foeId, state: 'active', timer: 0 });
    sim.duels.set(foeId, sim.duels.get(rogueId)!);
    const rogue = sim.entities.get(rogueId)!;
    const foe = sim.entities.get(foeId)!;
    sim.setPlayerLevel(20, rogueId);
    teleport(sim, rogue, 0, 0);
    teleport(sim, foe, 2, 0);
    rogue.facing = Math.atan2(foe.pos.x - rogue.pos.x, foe.pos.z - rogue.pos.z);
    sim.targetEntity(foe.id, rogueId);

    cast(sim, rogue, 'nightshade_coating', rogueId);

    const aura = auraOf(foe, 'nightshade_coating');
    expect(aura).toBeDefined();
    expect(aura?.kind).toBe('mortal_wound');
    expect(aura?.value).toBeCloseTo(0.25);
    expect(aura?.duration).toBe(12);

    // The healing-taken cut is what mortal_wound means, and combat/heal.ts is
    // the one reader: assert through it rather than restating the arithmetic.
    expect(healingTaken(sim, foe)).toBeCloseTo(0.75, 6);

    for (let i = 0; i < 20 * 13; i++) sim.tick();
    expect(auraOf(foe, 'nightshade_coating')).toBeUndefined();
    expect(healingTaken(sim, foe)).toBeCloseTo(1, 6);
  });

  it('keeps its own aura id, so it never evicts a warrior Maiming Strike debuff', () => {
    // Both carry kind 'mortal_wound'; applyAura dedupes by id, and the first
    // buffTarget of a def takes the ability id, so the two ids differ.
    const nightshade = ABILITIES.nightshade_coating.effects.find((e) => e.type === 'buffTarget');
    const maiming = ABILITIES.mortal_strike.effects.find(
      (e) => e.type === 'buffTarget' && e.kind === 'mortal_wound',
    );
    expect(nightshade).toBeDefined();
    expect(maiming).toBeDefined();
    expect(ABILITIES.nightshade_coating.id).not.toBe(ABILITIES.mortal_strike.id);
  });
});

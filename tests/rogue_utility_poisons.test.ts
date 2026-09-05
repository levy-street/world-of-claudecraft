import { describe, expect, it } from 'vitest';
import { meleeSwing } from '../src/sim/combat/auto_attack';
import { healingTakenMult } from '../src/sim/combat/heal';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { ABILITIES, CLASSES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// The two utility poisons added alongside the rogue rework. Both are weapon
// COATS (issue #3774: they shipped as 40-energy targeted nukes by mistake): the
// cast puts an imbue on the rogue, and every landed melee swing carries the
// rider onto whatever was struck.
//   Melting Acid       -5% target armor, 12 sec (aura kind 'melting_acid')
//   Nightshade Coating -25% healing the target receives, 12 sec (reuses the
//                      existing 'mortal_wound' kind)
// The shared coating machinery is pinned in tests/rogue_poison_coatings.test.ts.

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
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  (sim as unknown as SimInternals).addEntity(mob);
  teleport(sim, mob, 2, 0);
  rogue.facing = Math.atan2(mob.pos.x - rogue.pos.x, mob.pos.z - rogue.pos.z);
  rogue.resource = rogue.maxResource;
  sim.targetEntity(mob.id);
  return { sim, rogue, mob };
}

/** Coating abilities target the caster, so a handful of ticks settles the cast. */
function coat(sim: Sim, rogue: Entity, id: string): void {
  rogue.gcdRemaining = 0;
  rogue.resource = rogue.maxResource;
  sim.castAbility(id);
  for (let i = 0; i < 5; i++) sim.tick();
}

/** Swing through the REAL shared shell until one connects. */
function swingUntilLanded(sim: Sim, rogue: Entity, mob: Entity): void {
  for (let i = 0; i < 60; i++) {
    const landed = meleeSwing(ctxOf(sim), rogue, mob, 0, null, {
      autoAttackHand: 'mainhand',
      autoAttack: true,
    });
    if (landed) return;
  }
  throw new Error('no swing connected');
}

function auraOf(target: Entity, id: string): Entity['auras'][number] | undefined {
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

  it('both are weapon coats, not targeted strikes (issue #3774)', () => {
    for (const id of ['melting_acid', 'nightshade_coating'] as const) {
      const def = ABILITIES[id];
      // A coating is cast on yourself and carries no direct hit of its own.
      expect(def.requiresTarget).toBe(false);
      expect(def.effects.some((e) => e.type === 'directDamage')).toBe(false);
      expect(def.effects.some((e) => e.type === 'buffTarget')).toBe(false);
      const imbue = def.effects.find((e) => e.type === 'imbue');
      expect(imbue?.type === 'imbue' && imbue.duration).toBe(1800);
      expect(imbue?.type === 'imbue' && imbue.coat?.rider).toBe('debuff');
    }
  });
});

describe('Melting Acid', () => {
  it('coats the weapon: the cast alone neither damages nor debuffs anything', () => {
    const { sim, rogue, mob } = poisonRig();
    const hpBefore = mob.hp;
    const armorBefore = effectiveArmor(sim, mob);

    coat(sim, rogue, 'melting_acid');

    expect(rogue.auras.find((a) => a.id === 'melting_acid')?.kind).toBe('imbue');
    expect(mob.hp).toBe(hpBefore);
    expect(mob.auras).toHaveLength(0);
    expect(effectiveArmor(sim, mob)).toBeCloseTo(armorBefore, 6);
  });

  it('shaves 5% off the struck target armor for 12 sec', () => {
    const { sim, rogue, mob } = poisonRig();
    const armorBefore = effectiveArmor(sim, mob);
    expect(armorBefore).toBeGreaterThan(0);

    coat(sim, rogue, 'melting_acid');
    swingUntilLanded(sim, rogue, mob);

    const aura = auraOf(mob, 'melting_acid');
    expect(aura).toBeDefined();
    expect(aura?.kind).toBe('melting_acid');
    expect(aura?.value).toBeCloseTo(0.05);
    expect(aura?.duration).toBe(12);
    expect(aura?.sourceId).toBe(rogue.id);

    expect(effectiveArmor(sim, mob)).toBeCloseTo(armorBefore * 0.95, 6);

    // ...and it really expires on its own timer, 12 sec after the last swing.
    for (let i = 0; i < 20 * 13; i++) sim.tick();
    expect(auraOf(mob, 'melting_acid')).toBeUndefined();
    expect(effectiveArmor(sim, mob)).toBeCloseTo(armorBefore, 6);
  });

  it('every landed swing refreshes the shred rather than stacking it', () => {
    const { sim, rogue, mob } = poisonRig();
    const armorBefore = effectiveArmor(sim, mob);
    coat(sim, rogue, 'melting_acid');
    for (let i = 0; i < 10; i++) swingUntilLanded(sim, rogue, mob);

    expect(mob.auras.filter((a) => a.id === 'melting_acid')).toHaveLength(1);
    expect(auraOf(mob, 'melting_acid')?.remaining).toBe(12);
    expect(effectiveArmor(sim, mob)).toBeCloseTo(armorBefore * 0.95, 6);
  });

  it('max-combines with the other percent armor debuffs instead of stacking', () => {
    const { sim, rogue, mob } = poisonRig();
    const armorBefore = effectiveArmor(sim, mob);
    coat(sim, rogue, 'melting_acid');
    swingUntilLanded(sim, rogue, mob);
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
});

describe('Nightshade Coating', () => {
  it('cuts the healing the struck target receives by 25% for 12 sec', () => {
    const { sim, rogue, mob } = poisonRig();
    coat(sim, rogue, 'nightshade_coating');
    expect(healingTaken(sim, mob)).toBeCloseTo(1, 6);

    swingUntilLanded(sim, rogue, mob);

    const aura = auraOf(mob, 'nightshade_coating');
    expect(aura).toBeDefined();
    expect(aura?.kind).toBe('mortal_wound');
    expect(aura?.value).toBeCloseTo(0.25);
    expect(aura?.duration).toBe(12);

    // The healing-taken cut is what mortal_wound means, and combat/heal.ts is
    // the one reader: assert through it rather than restating the arithmetic.
    expect(healingTaken(sim, mob)).toBeCloseTo(0.75, 6);

    for (let i = 0; i < 20 * 13; i++) sim.tick();
    expect(auraOf(mob, 'nightshade_coating')).toBeUndefined();
    expect(healingTaken(sim, mob)).toBeCloseTo(1, 6);
  });

  it('keeps its own aura id, so it never evicts a warrior Maiming Strike debuff', () => {
    // Both carry kind 'mortal_wound'; applyAura dedupes by (id, sourceId), and a
    // coat rider borrows the coating ability's id, so the two ids differ.
    const nightshade = ABILITIES.nightshade_coating.effects.find((e) => e.type === 'imbue');
    const maiming = ABILITIES.mortal_strike.effects.find(
      (e) => e.type === 'buffTarget' && e.kind === 'mortal_wound',
    );
    expect(nightshade?.type === 'imbue' && nightshade.coat?.rider).toBe('debuff');
    expect(
      nightshade?.type === 'imbue' && nightshade.coat?.rider === 'debuff' && nightshade.coat.kind,
    ).toBe('mortal_wound');
    expect(maiming).toBeDefined();
    expect(ABILITIES.nightshade_coating.id).not.toBe(ABILITIES.mortal_strike.id);
  });
});

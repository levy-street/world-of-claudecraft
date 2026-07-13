import { describe, expect, it } from 'vitest';
import { BATTLE_TRANCE_ABILITIES } from '../src/sim/combat/empower_next';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { DIE_BY_SWORD_CUT, DIE_BY_SWORD_DODGE } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

// Arms warrior restructure (owner 2026-07-08): declutter + fused strike +
// Redhand empower + Sweeping Strikes cleave window + Deep Wounds bleed + a
// defensive cooldown. These pin the new mechanics.

const armsMods = () => computeTalentModifiers('warrior', { ...emptyAllocation(), spec: 'arms' });
const armsKnown = (level = 20): Set<string> =>
  new Set(abilitiesKnownAt('warrior', level, armsMods()).map((k) => k.def.id));

const makeArms = (seed = 42): Sim => {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec('arms')).toBe(true);
  sim.tick(); // settle the auto-stance reconcile
  return sim;
};

const nearestMob = (sim: Sim, template?: string): Entity => {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    if (template && e.templateId !== template) continue;
    const d = (e.pos.x - sim.player.pos.x) ** 2 + (e.pos.z - sim.player.pos.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) throw new Error('no mob');
  return best;
};

// Put the player in melee range of the mob and face it, so weaponStrike lands.
const approach = (sim: Sim, mob: Entity): void => {
  const p = sim.player;
  p.pos.x = mob.pos.x;
  p.pos.z = mob.pos.z - 1.5;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
};

describe('Arms restructure: gating (a cleaner bar)', () => {
  it('drops the retired/moved abilities and gains its new ones', () => {
    const known = armsKnown();
    // Removed from Arms: Reaver Strike (Fury/no-spec filler), the tank AoE + shred,
    // and the retired bleed.
    for (const id of ['heroic_strike', 'rend', 'thunder_clap', 'sunder_armor']) {
      expect(known.has(id), `arms should NOT know ${id}`).toBe(false);
    }
    // Kept/added: the Arms main strike + its new defensive, cleave window, passive.
    for (const id of ['mortal_strike', 'die_by_sword', 'sweeping_strikes', 'deep_wounds']) {
      expect(known.has(id), `arms should know ${id}`).toBe(true);
    }
  });

  it('the retired abilities keep valid defs but are gated away from Arms', () => {
    expect(ABILITIES.rend).toBeTruthy(); // def survives for internal reuse
    expect(ABILITIES.sunder_armor?.specs).toEqual(['prot']);
    expect(ABILITIES.thunder_clap?.specs).toEqual(['prot']);
    expect(ABILITIES.heroic_strike?.excludeSpecs).toEqual(['prot', 'arms', 'fury']);
    expect(ABILITIES.die_by_sword?.specs).toEqual(['arms']);
  });
});

describe('Arms restructure: the fused strike', () => {
  it('Maiming Strike can be freed by the Battle Trance proc', () => {
    expect(BATTLE_TRANCE_ABILITIES.has('mortal_strike')).toBe(true);
  });

  it('Redhand empowers the next Maiming Strike and is consumed by it', () => {
    const sim = makeArms();
    const mob = nearestMob(sim);
    mob.maxHp = 100000;
    mob.hp = mob.maxHp;
    approach(sim, mob);
    sim.player.resource = 100;
    sim.targetEntity(mob.id);
    // Redhand applies the overpower_charge.
    sim.castAbility('overpower');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'overpower_charge')).toBe(true);
    // Maiming Strike consumes it.
    for (let i = 0; i < 40; i++) sim.tick(); // clear GCD / overpower cd
    sim.castAbility('mortal_strike');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'overpower_charge')).toBe(false);
  });

  it('Redhand has 2 charges (used twice back to back) and stacks its empower to 2', () => {
    const sim = makeArms();
    const mob = nearestMob(sim);
    mob.maxHp = 100000;
    mob.hp = mob.maxHp;
    approach(sim, mob);
    sim.player.resource = 100;
    sim.targetEntity(mob.id);
    // Two charges: both casts land back to back with only the GCD between them,
    // no cooldown wait. Each use stacks the empower.
    sim.castAbility('overpower');
    sim.tick();
    sim.player.gcdRemaining = 0;
    sim.castAbility('overpower');
    sim.tick();
    expect(sim.player.auras.find((a) => a.kind === 'overpower_charge')?.stacks).toBe(2);
    // Both charges spent now; a third cast is blocked until one recharges, so the
    // stack stays capped at 2.
    sim.player.gcdRemaining = 0;
    sim.castAbility('overpower');
    sim.tick();
    expect(sim.player.auras.find((a) => a.kind === 'overpower_charge')?.stacks).toBe(2);
  });

  it('Maiming Strike leaves the Deep Wounds bleed on the target', () => {
    const sim = makeArms();
    const mob = nearestMob(sim);
    mob.maxHp = 100000;
    mob.hp = mob.maxHp;
    approach(sim, mob);
    sim.player.resource = 100;
    sim.targetEntity(mob.id);
    sim.castAbility('mortal_strike');
    sim.tick();
    expect(mob.auras.some((a) => a.kind === 'dot' && a.sourceId === sim.player.id)).toBe(true);
  });
});

describe('Arms restructure: Sweeping Strikes (the cleave window)', () => {
  it('applies its 12s window aura on cast', () => {
    const sim = makeArms();
    sim.castAbility('sweeping_strikes');
    sim.tick();
    // The 75% reduction lives in the effect-dispatch SWEEP_MULT const, not the
    // aura value, so we only assert the window is up.
    expect(sim.player.auras.some((a) => a.kind === 'sweeping_strikes')).toBe(true);
  });
});

describe('Arms restructure: Die by the Sword (the defensive)', () => {
  it('cuts incoming damage 30% and boosts dodge while worn', () => {
    const sim = makeArms();
    const dodgeBefore = sim.player.dodgeChance;
    sim.castAbility('die_by_sword');
    sim.tick();
    expect(sim.player.auras.some((a) => a.kind === 'die_by_sword')).toBe(true);
    // Dodge folds in through recalcPlayerStats.
    expect(sim.player.dodgeChance).toBeCloseTo(dodgeBefore + DIE_BY_SWORD_DODGE, 5);
    // The take-fraction is a flat 30% cut now (no low-health doubling).
    expect(DIE_BY_SWORD_CUT).toBeCloseTo(0.7, 5);
  });
});

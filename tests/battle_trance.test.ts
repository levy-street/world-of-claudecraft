// Battle Trance (the warrior baseline free-strike proc: connected auto swings
// have a chance to make the next Reaver Strike or Brute Swing free) plus the
// Redhand rework into the kit's active rage builder (no cost, +10 rage, no
// dodge-proc gate). Sim-level and deterministic; the proc scope predicate is
// also unit-driven directly (the action bar imports the same one).

import { describe, expect, it } from 'vitest';
import { freeCostAuraActive } from '../src/sim/combat/empower_next';
import { MOBS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { dist2d, MAX_LEVEL } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

function warriorAtCap(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function nearestMob(sim: Sim, opts: { thornless?: boolean } = {}) {
  let best: any = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    // The rage-grant assertions need a mob WITHOUT the innate spiked-hide
    // reflect (bristleback boars), whose reflected hit mints taken-damage rage.
    if (opts.thornless && MOBS[e.templateId]?.thorns) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function standOff(sim: Sim, mob: any, dist: number) {
  const p = sim.player;
  p.pos.x = mob.pos.x - dist;
  p.pos.z = mob.pos.z;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
}

const hasTrance = (sim: Sim) => sim.player.auras.some((a: any) => a.kind === 'battle_trance');

// Swing at a durable training dummy until the proc arms (20%/connected swing:
// deterministic per seed, and statistically certain well inside the cap).
function swingUntilProc(sim: Sim): void {
  const mob = nearestMob(sim);
  mob.hp = 1_000_000;
  mob.maxHp = 1_000_000;
  sim.player.hp = sim.player.maxHp;
  standOff(sim, mob, 2);
  sim.targetEntity(mob.id);
  sim.startAutoAttack();
  for (let i = 0; i < 20 * 120 && !hasTrance(sim); i++) {
    sim.tick();
    sim.player.hp = sim.player.maxHp; // the dummy hits back; stay alive
  }
  expect(hasTrance(sim)).toBe(true);
  sim.stopAutoAttack();
}

describe('Battle Trance: arming', () => {
  it('a connected warrior auto swing arms the 10s proc (no stacking, one aura)', () => {
    const sim = warriorAtCap(61);
    swingUntilProc(sim);
    const auras = sim.player.auras.filter((a: any) => a.kind === 'battle_trance');
    expect(auras).toHaveLength(1);
    expect(auras[0].duration).toBe(10);
    expect(auras[0].remaining).toBeGreaterThan(0);
  });

  it('never arms for a Fury warrior (it owns none of the consuming abilities)', () => {
    const sim = warriorAtCap(61);
    expect(sim.setSpec('fury')).toBe(true);
    const mob = nearestMob(sim);
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    sim.startAutoAttack();
    for (let i = 0; i < 20 * 120; i++) {
      sim.tick();
      sim.player.hp = sim.player.maxHp;
    }
    expect(hasTrance(sim)).toBe(false);
  });

  it('never arms for a non-warrior melee', () => {
    const sim = new Sim({ seed: 61, playerClass: 'rogue' });
    sim.setPlayerLevel(MAX_LEVEL);
    const mob = nearestMob(sim);
    mob.hp = 1_000_000;
    mob.maxHp = 1_000_000;
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    sim.startAutoAttack();
    for (let i = 0; i < 20 * 60; i++) {
      sim.tick();
      sim.player.hp = sim.player.maxHp;
    }
    expect(hasTrance(sim)).toBe(false);
  });
});

describe('Battle Trance: consumption scope', () => {
  it('makes Brute Swing (slam) free at zero rage and is consumed by it', () => {
    const sim = warriorAtCap(62);
    expect(sim.setSpec('arms')).toBe(true); // Brute Swing is arms/prot-gated base kit
    swingUntilProc(sim);
    const p = sim.player;
    p.gcdRemaining = 0;
    p.resource = 0;
    const mob = nearestMob(sim);
    const hp0 = mob.hp;
    sim.castAbility('slam');
    expect(mob.hp).toBeLessThan(hp0); // the strike landed despite 0 rage
    expect(hasTrance(sim)).toBe(false); // one charge, consumed
  });

  it('covers Reaver Strike (heroic_strike) through the on-swing queue', () => {
    const sim = warriorAtCap(63);
    swingUntilProc(sim);
    const p = sim.player;
    p.gcdRemaining = 0;
    p.resource = 0;
    sim.castAbility('heroic_strike');
    expect(p.queuedOnSwing).toBe('heroic_strike');
    expect(p.queuedOnSwingFree).toBe(true); // the charge moved onto the queue
    expect(hasTrance(sim)).toBe(false);
  });

  it('does NOT cover other rage abilities: they still need rage and keep the proc', () => {
    const sim = warriorAtCap(64);
    swingUntilProc(sim);
    const p = sim.player;
    p.gcdRemaining = 0;
    p.resource = 0;
    const mob = nearestMob(sim);
    sim.castAbility('hamstring');
    expect(mob.auras.some((a: any) => a.kind === 'slow')).toBe(false); // rejected
    expect(hasTrance(sim)).toBe(true); // and the proc was not eaten
  });

  it('the shared scope predicate matches sim behavior (the action bar imports it)', () => {
    const trance = [{ kind: 'battle_trance' }];
    expect(freeCostAuraActive(trance, 'heroic_strike')).toBe(true);
    expect(freeCostAuraActive(trance, 'slam')).toBe(true);
    expect(freeCostAuraActive(trance, 'hamstring')).toBe(false);
    // The generic fiesta-style charge stays ability-agnostic.
    expect(freeCostAuraActive([{ kind: 'next_cast_free' }], 'hamstring')).toBe(true);
    expect(freeCostAuraActive([], 'slam')).toBe(false);
    // Sudden Death (Arms): the same predicate frees Early Grave (execute) ONLY, so
    // the action bar lights the execute proc glow (procGlow = freeByProc) exactly
    // when the sim lets it fire free.
    expect(freeCostAuraActive([{ kind: 'sudden_death' }], 'execute')).toBe(true);
    expect(freeCostAuraActive([{ kind: 'sudden_death' }], 'heroic_strike')).toBe(false);
  });
});

// Redhand (overpower) was reworked 2026-07-09 from an Arms rage BUILDER into a
// BASELINE early rage SPENDER (all specs, level 2, 20 rage). Its Anger Management
// interaction is covered by the talent suites (it is no longer a rage source).
describe('Redhand (overpower): the baseline rage spender', () => {
  it('deals damage, empowers the next Maiming Strike, and goes on a 5s cooldown', () => {
    const sim = warriorAtCap(65); // no-spec: overpower is baseline (level 2), no grant needed
    const p = sim.player;
    const mob = nearestMob(sim, { thornless: true });
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    p.resource = 50;
    const hp0 = mob.hp;
    sim.castAbility('overpower');
    expect(mob.hp).toBeLessThan(hp0); // dealt weapon damage
    expect(p.auras.some((a: any) => a.kind === 'overpower_charge')).toBe(true); // empowers Maiming Strike
    expect(p.cooldowns.get('overpower')).toBe(5);
  });

  it('is a 20-rage spender: refuses to cast below 20 rage', () => {
    const sim = warriorAtCap(66);
    const p = sim.player;
    const mob = nearestMob(sim, { thornless: true });
    standOff(sim, mob, 2);
    sim.targetEntity(mob.id);
    p.resource = 10; // below the 20 cost
    const hp0 = mob.hp;
    sim.castAbility('overpower');
    expect(p.resource).toBe(10); // nothing spent
    expect(mob.hp).toBe(hp0); // no strike landed
    expect(p.cooldowns.get('overpower')).toBeUndefined(); // no cooldown started
  });
});

describe('determinism', () => {
  it('same seed gives the same proc timeline and rage', () => {
    const run = () => {
      const sim = warriorAtCap(67);
      const mob = nearestMob(sim);
      mob.hp = 1_000_000;
      mob.maxHp = 1_000_000;
      standOff(sim, mob, 2);
      sim.targetEntity(mob.id);
      sim.startAutoAttack();
      const timeline: number[] = [];
      for (let i = 0; i < 20 * 30; i++) {
        sim.tick();
        sim.player.hp = sim.player.maxHp;
        if (hasTrance(sim)) timeline.push(i);
      }
      return { timeline, resource: sim.player.resource };
    };
    expect(run()).toEqual(run());
  });
});

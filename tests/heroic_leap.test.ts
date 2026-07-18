// Heroic Leap (owner 2026-07-09): the leap ARCS to the landing over ~0.6s instead
// of teleporting, and its AoE slams down on touchdown (not at cast). Drives the sim
// deterministically: arm the flight, watch it rise, then land + blast.
// Restored from the pre-revert payload (f274835b1^); the HeroicLeapFlight fields
// were renamed upstream (dur -> duration, aoe -> landingAoe, ability ->
// abilityName + school), so the adversarial re-arm uses the current shape.

import { describe, expect, it } from 'vitest';
import { handleDeath } from '../src/sim/combat/damage';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { readyArenaFighter } from '../src/sim/social/arena';
import { fiestaDownEntity } from '../src/sim/social/fiesta';
import type { Entity } from '../src/sim/types';
import { MAX_LEVEL } from '../src/sim/types';

type AnySim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
};

describe('Heroic Leap: arcs over time, slams on landing', () => {
  it('arms a flight, rises mid-air, then lands near the aim and blasts on touchdown', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as AnySim;
    sim.setPlayerLevel(MAX_LEVEL);
    const p: Entity = sim.player;
    const from = { ...p.pos };
    const aim = { x: p.pos.x + 10, z: p.pos.z };
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
      x: aim.x,
      y: p.pos.y,
      z: aim.z + 1,
    });
    mob.maxHp = 1e6;
    mob.hp = 1e6;
    mob.hostile = true;
    sim.addEntity(mob);
    const hp0 = mob.hp;

    p.gcdRemaining = 0;
    sim.castAbility('heroic_leap', p.id, aim);
    // Cast ARMS the flight; the caster has not moved yet and no damage has landed.
    expect(p.leap).not.toBeNull();
    expect(p.pos.x).toBeCloseTo(from.x, 5);
    expect(mob.hp).toBe(hp0);

    // Mid-flight: airborne (above the start height), still no landing blast.
    sim.tick();
    expect(p.pos.y).toBeGreaterThan(from.y);
    expect(p.onGround).toBe(false);
    expect(mob.hp).toBe(hp0);

    // Fly to touchdown (~0.6s); the flight owns movement until it lands.
    for (let i = 0; i < 25 && p.leap; i++) sim.tick();
    expect(p.leap).toBeNull(); // landed
    expect(p.onGround).toBe(true);
    expect(Math.hypot(p.pos.x - aim.x, p.pos.z - aim.z)).toBeLessThan(3); // near the aim
    expect(mob.hp).toBeLessThan(hp0); // AoE slammed down on landing
  });

  it('does not teleport: it is NOT at the destination on the first tick', () => {
    const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true }) as AnySim;
    sim.setPlayerLevel(MAX_LEVEL);
    const p: Entity = sim.player;
    const aim = { x: p.pos.x + 12, z: p.pos.z };
    p.gcdRemaining = 0;
    sim.castAbility('heroic_leap', p.id, aim);
    sim.tick();
    // One tick in (0.05s of a ~0.6s arc), it is still well short of the aim.
    expect(Math.abs(p.pos.x - aim.x)).toBeGreaterThan(6);
    expect(p.leap).not.toBeNull();
  });
});

// The flight must die with the caster or with any external relocation: a stale
// leap otherwise resumes later and teleports the player onto the stored landing
// point (skipping the corpse run, or undoing an arena/fiesta placement).
describe('Heroic Leap: lifecycle resets', () => {
  function armLeap(seed: number): { sim: AnySim; p: Entity; landing: { x: number; z: number } } {
    const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as AnySim;
    sim.setPlayerLevel(MAX_LEVEL);
    const p: Entity = sim.player;
    p.gcdRemaining = 0;
    sim.castAbility('heroic_leap', p.id, { x: p.pos.x + 12, z: p.pos.z });
    expect(p.leap).not.toBeNull();
    sim.tick(); // one tick in: genuinely mid-flight
    const leap = p.leap;
    if (!leap) throw new Error('leap did not arm');
    return { sim, p, landing: { x: leap.to.x, z: leap.to.z } };
  }

  it('death mid-flight cancels the leap', () => {
    const { sim, p } = armLeap(11);
    handleDeath(sim.ctx, p, null);
    expect(p.leap).toBeNull();
  });

  it('a released ghost never resumes a stale flight (no graveyard-to-landing teleport)', () => {
    const { sim, p, landing } = armLeap(13);
    handleDeath(sim.ctx, p, null);
    sim.releaseSpirit(p.id);
    // Adversarial arm: even if some death path missed the clear, movement for a
    // dead entity must not fly the arc. Re-arm a stale flight by hand and tick.
    p.leap = {
      from: { ...p.pos },
      to: { x: landing.x, y: 0, z: landing.z },
      elapsed: 0,
      duration: 0.6,
      apex: 5,
      landingAoe: { min: 24, max: 32, radius: 6 },
      abilityName: 'Heroic Leap',
      school: 'physical',
    };
    const ghostPos = { ...p.pos };
    for (let i = 0; i < 20; i++) sim.tick();
    expect(p.leap).toBeNull(); // dropped, not flown
    expect(Math.hypot(p.pos.x - landing.x, p.pos.z - landing.z)).toBeGreaterThan(3);
    expect(Math.hypot(p.pos.x - ghostPos.x, p.pos.z - ghostPos.z)).toBeLessThan(3);
  });

  it('arena fighter reset clears an in-flight leap', () => {
    const { sim, p } = armLeap(17);
    readyArenaFighter(sim.ctx, p, { clearPrep: true });
    expect(p.leap).toBeNull();
  });

  it('fiesta down clears an in-flight leap', () => {
    const { sim, p } = armLeap(19);
    fiestaDownEntity(sim.ctx, p, null);
    expect(p.leap).toBeNull();
  });
});

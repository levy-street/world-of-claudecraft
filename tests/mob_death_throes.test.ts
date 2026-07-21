// Death Throes: a volatile mob (the Bog Bloat) does not explode the instant it
// dies. Its corpse swells for a telegraphed delay, then bursts for area damage
// to every living player within radius. Killing one next to you should arm the
// fuse, then hurt you when it pops — but spare anyone who ran clear in time.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { terrainHeight } from '../src/sim/world';
import type { Entity } from '../src/sim/types';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

function bloat(sim: Sim): Entity {
  return [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && e.templateId === 'bog_bloat' && e.ownerId === null,
  )!;
}

// Teleport an entity to (x,z), grounded, with prevPos cleared so it doesn't streak.
function place(sim: Sim, e: Entity, x: number, z: number) {
  e.pos = { x, z, y: terrainHeight(x, z, sim.cfg.seed) };
  e.prevPos = { ...e.pos };
}

// Lethally strike a target so handleDeath (and armDeathThroes) runs.
function kill(sim: Sim, victim: Entity) {
  victim.aiState = 'idle';
  victim.auras = [];
  (sim as any).dealDamage(sim.player, victim, victim.hp + 10000, false, 'physical', null, 'hit', true);
}

describe('death throes on a volatile mob', () => {
  it('bog_bloat carries the deathThroes trait', () => {
    expect(MOBS.bog_bloat.deathThroes).toEqual({
      min: 14, max: 22, radius: 8, delay: 1.5, name: 'Caustic Spores', school: 'nature',
    });
  });

  it('does not detonate the instant it dies — it arms a fuse', () => {
    const sim = makeSim();
    const b = bloat(sim);
    place(sim, b, -200, 0);
    place(sim, sim.player, -198, 0); // within the 8yd blast
    sim.tick();
    const hpFull = sim.player.hp;

    kill(sim, b);
    expect(b.detonateTimer).toBeCloseTo(1.5, 5); // fuse armed, not yet fired
    expect(sim.player.hp).toBe(hpFull); // no damage on the death tick itself
  });

  it('bursts after the delay and damages a player in range', () => {
    const sim = makeSim();
    const b = bloat(sim);
    place(sim, b, -200, 0);
    place(sim, sim.player, -198, 0);
    sim.tick();
    const hpFull = sim.player.hp;

    kill(sim, b);
    for (let i = 0; i < 31; i++) sim.tick(); // ~1.55s, past the 1.5s fuse

    expect(b.detonateTimer).toBe(Infinity); // fired exactly once
    expect(sim.player.hp).toBeLessThan(hpFull);
    expect(hpFull - sim.player.hp).toBeGreaterThanOrEqual(14); // at least the min blast
  });

  it('spares a player who is clear of the blast radius', () => {
    const sim = makeSim();
    const b = bloat(sim);
    place(sim, b, -200, 0);
    place(sim, sim.player, -180, 0); // 20yd away, well outside the 8yd radius
    sim.tick();
    const hpFull = sim.player.hp;

    kill(sim, b);
    for (let i = 0; i < 31; i++) sim.tick();

    expect(sim.player.hp).toBe(hpFull);
  });
});

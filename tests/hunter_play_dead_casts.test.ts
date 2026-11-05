// Play Dead (src/sim/combat/hunter_play_dead.ts) drops a hostile caster's
// spell mid-cast: an enemy player's cast aimed at the hunter is cancelled
// when the hunter lies down, so it never finishes on the 'corpse'.
import { describe, expect, it } from 'vitest';
import { isPlayingDead } from '../src/sim/combat/hunter_play_dead';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const SEED = 7;
const QUIET_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
// Open, level, contested ground (the Typhoon suite's spot).
const OPEN = { x: 70, z: 690 };

type Internals = { rebucket(e: Entity): void; time: number };
const internals = (sim: Sim) => sim as unknown as Internals;

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = { x, y: groundHeight(x, z, SEED), z };
  e.prevPos = { ...e.pos };
  e.onGround = true;
  internals(sim).rebucket(e);
}

function duelists(): { sim: Sim; mage: Entity; hunter: Entity } {
  const sim = new Sim({ seed: SEED, playerClass: 'mage', noPlayer: true, world: QUIET_WORLD });
  sim.resetDay = '2026-07-08';
  const m = sim.addPlayer('mage', 'Caster', { autoEquip: true });
  const h = sim.addPlayer('hunter', 'Feigner', { autoEquip: true });
  for (const pid of [m, h]) sim.setPlayerLevel(20, pid);
  internals(sim).time += 400;
  sim.tick();
  sim.setWorldPvpFlag(true, m);
  sim.setWorldPvpFlag(true, h);
  const mage = sim.entities.get(m) as Entity;
  const hunter = sim.entities.get(h) as Entity;
  place(sim, mage, OPEN.x, OPEN.z);
  place(sim, hunter, OPEN.x + 15, OPEN.z);
  mage.facing = Math.PI / 2;
  mage.resource = mage.maxResource;
  hunter.cooldowns.clear();
  expect(sim.ctx.isHostileTo(mage, hunter)).toBe(true);
  sim.targetEntity(hunter.id, mage.id);
  return { sim, mage, hunter };
}

function castFireball(sim: Sim, mage: Entity, hunter: Entity): void {
  mage.gcdRemaining = 0;
  sim.castAbility('fireball', mage.id);
  expect(mage.castingAbility).toBe('fireball');
  expect(mage.castTargetId).toBe(hunter.id);
}

describe('Play Dead drops a hostile cast already aimed at the hunter', () => {
  it('a fireball that would land lands when the hunter does not play dead', () => {
    const { sim, mage, hunter } = duelists();
    const hp = hunter.hp;
    castFireball(sim, mage, hunter);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(hunter.hp).toBeLessThan(hp);
  });

  it('cancels the cast mid-way, and nothing reaches the corpse', () => {
    const { sim, mage, hunter } = duelists();
    const hp = hunter.hp;
    castFireball(sim, mage, hunter);
    for (let i = 0; i < 10; i++) sim.tick();
    expect(mage.castingAbility).toBe('fireball');
    sim.castAbility('play_dead', hunter.id);
    sim.tick();
    expect(isPlayingDead(hunter)).toBe(true);
    expect(mage.castingAbility).toBeNull();
    expect(mage.castTargetId).toBeNull();
    expect(mage.targetId).toBeNull();
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    expect(hunter.hp).toBe(hp);
    expect(isPlayingDead(hunter)).toBe(true);
  });
});

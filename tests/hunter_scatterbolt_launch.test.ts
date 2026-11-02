// Scatterbolt throws enemy PLAYERS through the air like Typhoon
// (src/sim/combat/knockback_launch.ts): a straight-line airborne hop whose
// fall credits the hunter, while mobs keep the grounded shove (pinned in
// tests/hunter_pr4488_followup.test.ts).
import { describe, expect, it } from 'vitest';
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
  e.fallStartY = e.pos.y;
  e.onGround = true;
  internals(sim).rebucket(e);
}

function pvpPair(): { sim: Sim; hunter: Entity; victim: Entity } {
  const sim = new Sim({ seed: SEED, playerClass: 'hunter', noPlayer: true, world: QUIET_WORLD });
  sim.resetDay = '2026-07-08';
  const h = sim.addPlayer('hunter', 'Volley', { autoEquip: true });
  const v = sim.addPlayer('warrior', 'Victim', { autoEquip: true });
  for (const pid of [h, v]) sim.setPlayerLevel(20, pid);
  internals(sim).time += 400;
  sim.tick();
  sim.setWorldPvpFlag(true, h);
  sim.setWorldPvpFlag(true, v);
  const hunter = sim.entities.get(h) as Entity;
  const victim = sim.entities.get(v) as Entity;
  place(sim, hunter, OPEN.x - 3, OPEN.z);
  place(sim, victim, OPEN.x, OPEN.z);
  hunter.facing = Math.PI / 2;
  hunter.cooldowns.clear();
  expect(sim.ctx.isHostileTo(hunter, victim)).toBe(true);
  return { sim, hunter, victim };
}

describe('Scatterbolt throws enemy players through the air', () => {
  it('launches the victim on a straight airborne hop back to about 20 yd', () => {
    const { sim, hunter, victim } = pvpPair();
    const start = { ...victim.pos };
    sim.castAbility('scatterbolt', hunter.id);
    sim.tick();
    expect(victim.onGround).toBe(false);
    expect(victim.launchedBy?.sourceId).toBe(hunter.id);
    let apex = 0;
    let ticks = 0;
    while (!victim.onGround && ticks++ < 60) {
      sim.tick();
      apex = Math.max(apex, victim.pos.y - start.y);
      expect(Math.abs(victim.pos.z - start.z)).toBeLessThan(1e-6);
    }
    expect(victim.onGround).toBe(true);
    expect(apex).toBeGreaterThan(0.5);
    // Pushed to about 20 yd from the hunter, who stood 3 yd away.
    const fromHunter = victim.pos.x - hunter.pos.x;
    expect(fromHunter).toBeGreaterThan(18);
    expect(fromHunter).toBeLessThan(22);
  });
});

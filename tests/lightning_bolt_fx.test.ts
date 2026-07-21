import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Lightning Bolt draws a jagged electric bolt instead of the default glowing
// projectile: it emits a `spellfx` with fx:'lightning' (caster -> target). The
// projectile MECHANIC is unchanged, so damage still resolves on impact.

type SpellFx = Extract<SimEvent, { type: 'spellfx' }>;

function nearestMob(sim: Sim, templateId: string): Entity {
  const p = sim.player;
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) throw new Error(`no ${templateId} in world`);
  return best;
}

describe('lightning bolt visual', () => {
  it('emits fx:lightning from caster to target and still deals damage', () => {
    const sim = new Sim({ seed: 42, playerClass: 'shaman' });
    const p = sim.player;
    const wolf = nearestMob(sim, 'forest_wolf');
    // Stand next to the wolf and face it.
    p.pos.x = wolf.pos.x + 4;
    p.pos.z = wolf.pos.z;
    p.pos.y = groundHeight(p.pos.x, p.pos.z, sim.cfg.seed);
    p.prevPos = { ...p.pos };
    (sim as unknown as { rebucket(e: Entity): void }).rebucket(p);
    p.facing = Math.atan2(wolf.pos.x - p.pos.x, wolf.pos.z - p.pos.z);
    p.resource = p.maxResource;

    sim.targetEntity(wolf.id);
    sim.castAbility('lightning_bolt');

    const fxs: SpellFx[] = [];
    let damaged = false;
    for (let i = 0; i < 20 * 5; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'spellfx') fxs.push(ev);
        if (ev.type === 'damage' && ev.targetId === wolf.id && ev.amount > 0) damaged = true;
      }
    }

    const bolt = fxs.find((e) => e.fx === 'lightning');
    expect(bolt, 'a lightning spellfx was emitted').toBeTruthy();
    expect(bolt).toMatchObject({ sourceId: p.id, targetId: wolf.id });
    // No default glowing projectile should be emitted for this spell.
    expect(fxs.some((e) => e.fx === 'projectile')).toBe(false);
    // The projectile mechanic is intact: damage still lands.
    expect(damaged).toBe(true);
  });
});

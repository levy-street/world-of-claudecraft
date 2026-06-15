// Classic-WoW "trivial con" rule: a wild mob far below the player's level goes
// passive — it will not auto-aggro from proximity while idle. It still fights
// back if attacked (that path is the damage/threat handler, not the idle gate),
// and elites/rares/bosses are never trivial, so they always remain dangerous.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { dist2d } from '../src/sim/types';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}

function nearestMob(sim: Sim): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.ownerId !== null) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best!;
}

// Park an idle mob right on top of the player so proximity aggro would fire.
function placeIdleOnPlayer(sim: Sim, mob: Entity) {
  mob.aiState = 'idle';
  mob.aggroTargetId = null;
  mob.threat.clear();
  mob.pos = { ...sim.player.pos };
}

describe('trivial mobs go passive', () => {
  it('a mob 10+ levels below the player does not aggro from proximity', () => {
    const sim = makeSim();
    const mob = nearestMob(sim);
    mob.level = 2;
    sim.player.level = 12;
    placeIdleOnPlayer(sim, mob);

    sim.tick();

    expect(mob.aiState).toBe('idle');
    expect(mob.aggroTargetId).toBeNull();
  });

  it('a mob just under the gap (9 levels below) still aggros', () => {
    const sim = makeSim();
    const mob = nearestMob(sim);
    mob.level = 3;
    sim.player.level = 12;
    placeIdleOnPlayer(sim, mob);

    sim.tick();

    expect(mob.aiState).not.toBe('idle');
    expect(mob.aggroTargetId).toBe(sim.playerId);
  });

  it('an elite/rare mob is never trivial and aggros even far below level', () => {
    const sim = makeSim();
    const mob = nearestMob(sim);
    mob.templateId = 'elder_bristleback'; // elite + rare template
    mob.level = 2;
    sim.player.level = 30;
    placeIdleOnPlayer(sim, mob);

    sim.tick();

    expect(mob.aiState).not.toBe('idle');
    expect(mob.aggroTargetId).toBe(sim.playerId);
  });

  it('a trivial mob still retaliates when attacked', () => {
    const sim = makeSim();
    const mob = nearestMob(sim);
    mob.level = 2;
    mob.maxHp = 5000;
    mob.hp = 5000;
    sim.player.level = 12;
    placeIdleOnPlayer(sim, mob);

    (sim as any).dealDamage(sim.player, mob, 100, false, 'physical', null, 'hit', true);

    expect(mob.threat.get(sim.playerId)).toBeGreaterThan(0);
    expect(mob.aiState).not.toBe('idle');
  });
});

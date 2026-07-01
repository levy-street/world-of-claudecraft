// Players must leave combat once nothing is actually engaging them. inCombat is
// driven by Sim.engagedPids: a mob only keeps you flagged while it targets a live
// entity within COMBAT_LEASH_RADIUS. A mob stuck out of reach must NOT pin you in
// combat forever (the "stuck in combat" bug, #563).
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}
function wildMob(sim: Sim): Entity {
  const m = [...sim.entities.values()].find(
    (e) => e.kind === 'mob' && !e.dead && e.ownerId === null,
  );
  if (!m) throw new Error('no wild mob');
  return m;
}
function placeStuckChaser(mob: Entity, x: number, z: number, targetId: number) {
  mob.pos = { x, z, y: mob.pos.y };
  mob.prevPos = { ...mob.pos };
  mob.spawnPos = { ...mob.pos }; // anchored at itself so it never leashes-and-drops on its own
  mob.leashAnchor = { ...mob.pos };
  mob.hostile = true;
  mob.aiState = 'chase';
  mob.aggroTargetId = targetId;
  mob.threat.set(targetId, 1000); // keep it locked on through updateMobTarget
}

describe('players drop combat when nothing is engaging them', () => {
  it('a mob stuck far out of reach does not keep the player in combat', () => {
    const sim = makeSim();
    const p = sim.player;
    p.combatTimer = 10; // past the grace timer, so only live engagement matters
    placeStuckChaser(wildMob(sim), p.pos.x + 60, p.pos.z, p.id); // 60 yds >> COMBAT_LEASH_RADIUS
    sim.tick();
    expect(p.inCombat).toBe(false);
  });

  it('a mob engaging in range keeps the player in combat', () => {
    const sim = makeSim();
    const p = sim.player;
    p.combatTimer = 10;
    const mob = wildMob(sim);
    placeStuckChaser(mob, p.pos.x + 4, p.pos.z, p.id); // within range
    mob.aiState = 'attack';
    sim.tick();
    expect(p.inCombat).toBe(true);
  });
});

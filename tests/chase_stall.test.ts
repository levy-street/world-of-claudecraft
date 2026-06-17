// Follow-up to the combat-leash fix: a mob that cannot physically reach its target
// (pinned behind terrain/water/a prop) must GIVE UP rather than chase forever and
// never leash. After CHASE_STALL_TIMEOUT of no progress it drops the target and
// retargets (next on threat) or evades home.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
}
function wildMob(sim: Sim): Entity {
  return [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead && e.ownerId === null)!;
}
function lockChaser(mob: Entity, x: number, z: number, targetId: number) {
  mob.pos = { x, z, y: mob.pos.y };
  mob.prevPos = { ...mob.pos };
  mob.spawnPos = { ...mob.pos };    // anchored at itself so it never leashes on its own
  mob.leashAnchor = { ...mob.pos };
  mob.hostile = true;
  mob.aiState = 'chase';
  mob.aggroTargetId = targetId;
  mob.threat.set(targetId, 1000);
}

describe('mobs give up a target they cannot reach', () => {
  it('drops an unreachable target after the stall timeout and evades', () => {
    const sim = makeSim();
    const p = sim.player;
    const mob = wildMob(sim);
    (sim as any).moveToward = () => false; // simulate being unable to advance
    lockChaser(mob, p.pos.x + 20, p.pos.z, p.id);

    for (let i = 0; i < 20 * 3; i++) sim.tick();      // 3s < timeout: still chasing
    expect(mob.aggroTargetId).toBe(p.id);

    for (let i = 0; i < 20 * 4; i++) sim.tick();      // total 7s > CHASE_STALL_TIMEOUT
    expect(mob.aggroTargetId).not.toBe(p.id);          // dropped
    expect(mob.aiState === 'evade' || mob.aiState === 'idle').toBe(true);
  });

  it('a mob that can advance keeps chasing (no premature give-up)', () => {
    const sim = makeSim();
    const p = sim.player;
    const mob = wildMob(sim);
    lockChaser(mob, p.pos.x + 15, p.pos.z, p.id);
    for (let i = 0; i < 20 * 6; i++) sim.tick();       // 6s > timeout, but it can move
    expect(mob.aggroTargetId).toBe(p.id);
    expect(mob.aiState === 'attack' || mob.aiState === 'chase').toBe(true);
  });
});

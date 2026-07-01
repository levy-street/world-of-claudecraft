// Follow-up to the combat-leash fix: a mob that cannot physically reach its target
// (pinned behind terrain/water/a prop) must GIVE UP rather than chase forever and
// never leash. After CHASE_STALL_TIMEOUT of no progress it drops the target and
// retargets (next on threat) or evades home (#564).
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
function lockChaser(mob: Entity, x: number, z: number, targetId: number) {
  mob.pos = { x, z, y: mob.pos.y };
  mob.prevPos = { ...mob.pos };
  mob.spawnPos = { ...mob.pos }; // anchored at itself so it never leashes on its own
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
    // Simulate being unable to advance: the chase block calls ctx.moveToward, so a
    // no-op there leaves the mob pinned and accrues chaseStall.
    (sim as unknown as { ctx: { moveToward: () => boolean } }).ctx.moveToward = () => false;
    lockChaser(mob, p.pos.x + 20, p.pos.z, p.id);

    for (let i = 0; i < 20 * 3; i++) sim.tick(); // 3s < timeout: still chasing
    expect(mob.aggroTargetId).toBe(p.id);

    for (let i = 0; i < 20 * 4; i++) sim.tick(); // total 7s > CHASE_STALL_TIMEOUT
    expect(mob.aggroTargetId).not.toBe(p.id); // dropped
  });
});

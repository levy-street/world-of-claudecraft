// Tab targeting should cycle the enemies a player can see / is fighting, not
// the nearest blip regardless of where the player is looking. Reproduces the
// bug where Tab selected an off-screen mob behind the player over a visible one.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 31337;

function spawnMob(sim: Sim, id: number, dx: number, dz: number) {
  const p = sim.entities.get(sim.playerId)!;
  const mob = createMob(id, MOBS.ridge_stalker, 13, { x: p.pos.x + dx, y: p.pos.y, z: p.pos.z + dz });
  sim.entities.set(mob.id, mob);
  (sim as any).rebucket(mob);
  return mob;
}

describe('Sim.tabTarget on-screen / in-combat cycling', () => {
  it('targets the on-screen enemy and does not cycle to an unseen one behind', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const p = sim.entities.get(sim.playerId)!;
    p.facing = 0; // facing +Z
    (sim as any).rebucket(p);
    const behindClose = spawnMob(sim, 900001, 0, -6); // behind, near, idle
    const frontFar = spawnMob(sim, 900002, 0, 25); // in front, far, idle

    sim.tabTarget();
    expect(p.targetId).toBe(frontFar.id);

    // The unseen idle mob behind the player is not part of the fight cluster, so
    // cycling stays on the visible enemy instead of grabbing it.
    sim.tabTarget();
    expect(p.targetId).toBe(frontFar.id);
  });

  it('falls back to an unseen enemy only when nothing visible is in the cluster', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const p = sim.entities.get(sim.playerId)!;
    p.facing = 0; // facing +Z
    (sim as any).rebucket(p);
    const behindClose = spawnMob(sim, 900003, 0, -6); // behind, near, idle (off screen)

    // No on-screen / engaged enemy exists, so Tab still targets the only mob.
    sim.tabTarget();
    expect(p.targetId).toBe(behindClose.id);
  });

  it('ignores an engaged enemy behind the player and Tabs a fresh mob in front (charge-escape)', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const p = sim.entities.get(sim.playerId)!;
    p.facing = 0; // facing +Z, away from the fight
    (sim as any).rebucket(p);
    const chaser = spawnMob(sim, 900031, 0, -10); // behind, engaged with the player
    chaser.aggroTargetId = p.id;
    const freshFront = spawnMob(sim, 900032, 0, 16); // in front, idle, the charge target

    // Tab grabs the visible fresh mob to charge toward, not the engaged chaser
    // off screen behind the player.
    sim.tabTarget();
    expect(p.targetId).toBe(freshFront.id);
    // Cycling stays on the front mob; the unseen chaser never steals selection.
    sim.tabTarget();
    expect(p.targetId).toBe(freshFront.id);
  });

  it('prefers an enemy engaged with the player', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const p = sim.entities.get(sim.playerId)!;
    p.facing = 0;
    (sim as any).rebucket(p);
    const idleNear = spawnMob(sim, 900011, 0, 6); // on screen, idle, near
    const engagedFar = spawnMob(sim, 900012, 0, 28); // on screen, far, aggroed
    engagedFar.aggroTargetId = p.id;

    sim.tabTarget();
    expect(p.targetId).toBe(engagedFar.id);
  });

  it('walks the fallback band from a clicked fallback target, then wraps into the cluster', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const p = sim.entities.get(sim.playerId)!;
    p.facing = 0; // facing +Z
    (sim as any).rebucket(p);
    // Isolate from world-spawned mobs so the fallback ordering is exactly ours.
    for (const id of [...sim.entities.keys()]) {
      if (id !== sim.playerId) (sim as any).dropEntity(id);
    }
    const near = spawnMob(sim, 900041, 0, 10); // on screen, idle, near: the cluster
    const behindA = spawnMob(sim, 900042, 0, -8); // off screen behind: fallback
    const behindB = spawnMob(sim, 900043, 0, -15); // off screen behind, farther: fallback

    // Simulate clicking a fallback (off-screen) mob, which Tab alone never grabs
    // while a cluster exists.
    p.targetId = behindA.id;
    // Tab from a fallback target walks the rest of the fallback band, nearest first.
    sim.tabTarget();
    expect(p.targetId).toBe(behindB.id);
    // One more Tab wraps off the end of the fallback back into the cluster.
    sim.tabTarget();
    expect(p.targetId).toBe(near.id);
    // And from the cluster it stays in the cluster (single mob wraps onto itself).
    sim.tabTarget();
    expect(p.targetId).toBe(near.id);
  });

  it('cycles only the near fight cluster and wraps back, ignoring a distant idle mob', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const p = sim.entities.get(sim.playerId)!;
    p.facing = 0; // facing +Z
    (sim as any).rebucket(p);
    // Three on-screen mobs within the near radius (the current fight) and one
    // idle mob two screens away but still inside the 40 yd query.
    const near1 = spawnMob(sim, 900021, 0, 8);
    const near2 = spawnMob(sim, 900022, 0, 14);
    const near3 = spawnMob(sim, 900023, 0, 20);
    const farIdle = spawnMob(sim, 900024, 0, 38);

    // Tab walks the cluster nearest-first.
    sim.tabTarget();
    expect(p.targetId).toBe(near1.id);
    sim.tabTarget();
    expect(p.targetId).toBe(near2.id);
    sim.tabTarget();
    expect(p.targetId).toBe(near3.id);
    // One more Tab wraps back to the priority (nearest) mob, NOT the far idle one.
    sim.tabTarget();
    expect(p.targetId).toBe(near1.id);

    // The distant idle mob is never selected by cycling the cluster.
    for (let i = 0; i < 6; i++) {
      sim.tabTarget();
      expect(p.targetId).not.toBe(farIdle.id);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { LEASH_DISTANCE } from '../src/sim/types';

// Hit-and-run pursuit combat for EVERY melee mob (mob-pursuit-combat-v023).
// An ordinary mob no longer stops at max reach to trade blows like a statue:
// it swings from effective reach while continuing to close to desiredRange,
// and it is leash-checked from the attack state too, so kite-dragging a mob
// past the leash still evades and resets it. Ranged petSpell casters keep the
// classic caster loop (close to spell range, stand, cast) unchanged.
// All tests drive the real dispatcher ((sim as any).updateMob) with the same
// engaged-mob setup the tests/parity mob_locomotion scenario uses.

const SEED = 7788;
let nextId = 9200;

function makeSim() {
  const sim: any = new Sim({ seed: SEED, playerClass: 'warrior' });
  const p = sim.entities.get(sim.playerId)!;
  p.pos = { x: 0, y: 0, z: 0 };
  p.prevPos = { x: 0, y: 0, z: 0 };
  p.maxHp = 100000;
  p.hp = 100000;
  return { sim, p };
}

function engageMob(
  sim: any,
  p: any,
  templateId: string,
  dist: number,
  aiState: 'chase' | 'attack',
  opts: { moved?: boolean; swingTimer?: number } = {},
) {
  const mob = createMob(nextId++, MOBS[templateId], 5, { x: dist, y: 0, z: 0 });
  mob.weapon = { min: 50, max: 50, speed: 2 };
  mob.swingTimer = opts.swingTimer ?? 0;
  mob.prevPos = opts.moved ? { x: dist + 2, y: 0, z: 0 } : { x: dist, y: 0, z: 0 };
  mob.spawnPos = { ...mob.pos };
  mob.hostile = true;
  mob.inCombat = true;
  mob.aiState = aiState;
  mob.aggroTargetId = p.id;
  mob.threat.set(p.id, 100);
  sim.entities.set(mob.id, mob);
  sim.rebucket?.(mob);
  return mob;
}

describe('every melee mob hits and runs (pursuit combat)', () => {
  it('a pursuing mob swings AND keeps moving closer in the same tick', () => {
    const { sim, p } = makeSim();
    // 5.5 yd out, repositioning (effective reach 6): inside swing reach but
    // beyond desiredRange, so one tick must both swing and close distance.
    const mob = engageMob(sim, p, 'forest_wolf', 5.5, 'chase', { moved: true });
    sim.updateMob(mob);
    expect(mob.swingTimer).toBeGreaterThan(0); // swing attempted (timer re-armed)
    expect(mob.pos.x).toBeLessThan(5.5); // AND it moved closer, same tick
  });

  it('a mob in the attack state keeps closing to desiredRange instead of standing at max reach', () => {
    const { sim, p } = makeSim();
    // 4.8 yd out, mid-swing (timer 1): inside true reach (5) but beyond the
    // desiredRange (4), so it should keep walking in while the timer runs.
    const mob = engageMob(sim, p, 'forest_wolf', 4.8, 'attack', { swingTimer: 1 });
    sim.updateMob(mob);
    expect(mob.pos.x).toBeLessThan(4.8);
  });

  it('a mob inside desiredRange stands and swings (no orbiting or overshoot)', () => {
    const { sim, p } = makeSim();
    const mob = engageMob(sim, p, 'forest_wolf', 3, 'attack', { swingTimer: 0 });
    sim.updateMob(mob);
    expect(mob.swingTimer).toBeGreaterThan(0); // swing attempted
    expect(mob.pos.x).toBe(3); // already comfortable: no movement
  });

  it('a mob dragged past the leash evades even from the attack state', () => {
    const { sim, p } = makeSim();
    const mob = engageMob(sim, p, 'forest_wolf', 1, 'attack');
    mob.spawnPos = { x: 1 + LEASH_DISTANCE + 5, y: 0, z: 0 };
    mob.fleeReturnTimer = 0;
    sim.updateMob(mob);
    expect(mob.aiState).toBe('evade');
    expect(mob.aggroTargetId).toBeNull();
  });
});

describe('ranged petSpell casters keep the classic caster loop', () => {
  it('stands and casts inside spell range instead of chasing into melee', () => {
    const { sim, p } = makeSim();
    const mob = engageMob(sim, p, 'corrupted_priest_malric', 10, 'attack', { swingTimer: 5 });
    sim.updateMob(mob);
    expect(mob.pos.x).toBe(10); // a casting priest does not advance
    expect(mob.aiState).toBe('attack');
  });

  it('drops back to chase when the target leaves spell range', () => {
    const { sim, p } = makeSim();
    const mob = engageMob(sim, p, 'corrupted_priest_malric', 35, 'attack', { swingTimer: 5 });
    sim.updateMob(mob);
    expect(mob.aiState).toBe('chase');
  });

  it('flips from chase to attack at spell range with the fast-cast clamp', () => {
    const { sim, p } = makeSim();
    const mob = engageMob(sim, p, 'corrupted_priest_malric', 20, 'chase', { swingTimer: 5 });
    sim.updateMob(mob);
    expect(mob.aiState).toBe('attack');
    expect(mob.swingTimer).toBeLessThanOrEqual(0.4);
  });
});

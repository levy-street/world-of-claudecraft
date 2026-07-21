import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { angleTo, FACING_HOLD_DIST, steadyAngleTo } from '../src/sim/types';

// Repro for the "immobile characters strobe their orientation" report: any
// per-tick `facing = angleTo(a, b)` write amplifies millimetric position noise
// into full-circle swings once the two positions overlap (atan2 of a
// sub-epsilon delta is direction noise, not a bearing). steadyAngleTo holds
// the previous facing below FACING_HOLD_DIST instead.

function wrap(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

describe('steadyAngleTo', () => {
  it('matches angleTo at normal distances', () => {
    const from = { x: 1, y: 0, z: 2 };
    const to = { x: 4, y: 0, z: -1 };
    expect(steadyAngleTo(from, to, 9.9)).toBe(angleTo(from, to));
  });

  it('holds the current facing when the target is within FACING_HOLD_DIST', () => {
    const from = { x: 10, y: 0, z: 10 };
    const to = { x: 10 + FACING_HOLD_DIST * 0.4, y: 0, z: 10 - FACING_HOLD_DIST * 0.3 };
    expect(steadyAngleTo(from, to, 1.234)).toBe(1.234);
  });
});

describe('mob facing vs a target standing on top of it', () => {
  it('does not strobe when the target dithers millimetrically on the mob', () => {
    const sim = new Sim({ seed: 999, playerClass: 'warrior' });
    const p = sim.player;
    let mob: ReturnType<typeof sim.entities.get> | undefined;
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob' && !e.dead && e.hostile) {
        mob = e;
        break;
      }
    }
    if (!mob) throw new Error('no hostile mob in the starting zone');
    p.hp = 1e9;
    p.maxHp = 1e9;
    mob.threat.set(p.id, 1000);
    mob.aggroTargetId = p.id;
    mob.aiState = 'attack';
    mob.inCombat = true;

    const facings: number[] = [];
    for (let i = 0; i < 120; i++) {
      // sub-centimeter position noise, the online rounding/collision scale
      p.pos.x = mob.pos.x + (i % 2 === 0 ? 0.004 : -0.004);
      p.pos.z = mob.pos.z + (i % 3 === 0 ? 0.004 : -0.004);
      sim.tick();
      facings.push(mob.facing);
    }
    let maxStep = 0;
    for (let i = 1; i < facings.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(wrap(facings[i] - facings[i - 1])));
    }
    // before the fix this strobed at +-PI every tick (maxStep === Math.PI)
    expect(maxStep).toBeLessThan(0.1);
  });
});

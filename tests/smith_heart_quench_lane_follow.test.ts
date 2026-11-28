// A blade's slash line rides the marked player's DRAWN body every frame while
// it still follows them (the owner's online run of 2026-11-17: the line
// trailed the marked, the snapshot a step behind), and holds the sim's own
// yaw once it has locked (quench_fight_fx_core.ts laneDrawnYaw).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LANE_LOCK_LEAD,
  LANE_TRACK_TOLERANCE,
  laneDrawnYaw,
  laneLocked,
} from '../src/render/smith_heart_fx/quench_fight_fx_core';
import { QUENCH_DIFFICULTY } from '../src/sim/encounters/smith_heart/quench_ids';

describe('the slash line follows the drawn body', () => {
  it('while the sim line points at a marked player, aims at where that player is drawn', () => {
    // The blade at the origin, the marked player's snapshot 20 yd north, the
    // body drawn a yard and a half east of it (moving).
    const simYaw = Math.atan2(0, 20);
    const yaw = laneDrawnYaw(0, 0, simYaw, [{ simX: 0, simZ: 20, drawnX: 1.5, drawnZ: 20 }]);
    expect(yaw).toBeCloseTo(Math.atan2(1.5, 20), 9);
    expect(yaw).not.toBeCloseTo(simYaw, 3);
  });

  it('picks the marked player the line is on, never another', () => {
    const simYaw = Math.atan2(-20, 0);
    const yaw = laneDrawnYaw(0, 0, simYaw, [
      { simX: 0, simZ: 20, drawnX: 0.5, drawnZ: 20 },
      { simX: -20, simZ: 0, drawnX: -20, drawnZ: 1 },
    ]);
    expect(yaw).toBeCloseTo(Math.atan2(-20, 1), 9);
  });

  it('locked (no mark on its sim line), keeps the sim yaw', () => {
    const simYaw = 0.4;
    const off = simYaw + LANE_TRACK_TOLERANCE * 3;
    const yaw = laneDrawnYaw(0, 0, simYaw, [
      { simX: Math.sin(off) * 20, simZ: Math.cos(off) * 20, drawnX: 5, drawnZ: 5 },
    ]);
    expect(yaw).toBe(simYaw);
    expect(laneDrawnYaw(0, 0, simYaw, [])).toBe(simYaw);
  });

  it('the fight draws its lines through it, from the marked players it scans', () => {
    const src = readFileSync('src/render/smith_heart_fx/quench_fight_fx.ts', 'utf8');
    expect(src).toMatch(
      /laneDrawnYaw\(\s*lane\.pos\.x,\s*lane\.pos\.z,\s*lane\.facing,\s*this\.markedAt\(world\),\s*lof\.state !== 'warn' \|\| laneLocked\(this\.clock - l\.born, lof\.seconds, lof\.lock\),\s*\)/,
    );
    expect(src).toMatch(/markedAt\(world: IWorld\)[\s\S]*fxAnchor\(e\)/);
  });
});

describe("the slash line's sound: the marked player's alone", () => {
  it('names the marked player the line is aimed at', async () => {
    const { laneTargetIndex } = await import('../src/render/smith_heart_fx/quench_fight_fx_core');
    const marks = [
      { simX: 0, simZ: 20 },
      { simX: 20, simZ: 0 },
    ];
    expect(laneTargetIndex(0, 0, Math.atan2(20, 0), marks)).toBe(1);
    expect(laneTargetIndex(0, 0, 0.02, marks)).toBe(0);
    expect(laneTargetIndex(0, 0, 0, [])).toBe(-1);
  });

  it('the fight passes `mine` from the local player being that target', () => {
    const src = readFileSync('src/render/smith_heart_fx/quench_fight_fx.ts', 'utf8');
    expect(src).toContain('marked[target].id === world.playerId');
  });
});

// Jose's video of 2026-11-25 (Heroic, about 0:22): after the lock the line
// swung off on its own. The sim freezes its yaw at the lock
// (quench_slash.ts stepSlashes), but the client kept riding the marked body
// while it still stood near the bearing; locked, the drawn line is the sim's
// yaw and nothing else, whatever the marked do.
describe('the locked slash line never moves', () => {
  it('locked, holds the sim yaw even with the marked body right on its line and moving', () => {
    const simYaw = Math.atan2(0, 20);
    const drawn: number[] = [];
    for (let k = 0; k <= 20; k++) {
      // The marked runs off sideways from right on the line.
      const x = k * 0.1;
      drawn.push(
        laneDrawnYaw(0, 0, simYaw, [{ simX: x * 0.5, simZ: 20, drawnX: x, drawnZ: 20 }], true),
      );
    }
    for (const y of drawn) expect(y).toBe(simYaw);
    // Unlocked, the same frames follow the body (the smooth track before the lock).
    const free = laneDrawnYaw(0, 0, simYaw, [{ simX: 0.5, simZ: 20, drawnX: 1, drawnZ: 20 }]);
    expect(free).toBeCloseTo(Math.atan2(1, 20), 9);
  });

  it("locks on the line's own clock, a hair before the sim does, on every tier", () => {
    for (const tier of ['normal', 'heroic', 'mythic'] as const) {
      const { slashAim: warn, slashLock: lock } = QUENCH_DIFFICULTY[tier];
      const at = warn - lock;
      expect(laneLocked(at - LANE_LOCK_LEAD - 0.05, warn, lock), tier).toBe(false);
      expect(laneLocked(at - LANE_LOCK_LEAD, warn, lock), tier).toBe(true);
      expect(laneLocked(at, warn, lock), tier).toBe(true);
      expect(laneLocked(warn, warn, lock), tier).toBe(true);
    }
    // An interphase line, locked its whole warning, never tracks.
    expect(laneLocked(0, 3, 3)).toBe(true);
    expect(LANE_LOCK_LEAD).toBeLessThanOrEqual(0.15);
  });
});

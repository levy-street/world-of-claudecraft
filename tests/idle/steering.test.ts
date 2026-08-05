// Integration test for the idle engine's steering: the character must actually
// navigate to a goal and engage (gain XP), not spin in place.
//
// Regression: once-per-step steering held a TURN action for the full
// frameSkip batch (1 sim-second), rotating the player exactly PI radians per
// step. A PI-per-step actuator can only ever place the facing on one of two
// antipodal angles, so the steering loop could never converge onto a target
// bearing; the player oscillated forever and never gained XP or moved off
// spawn. Fix: drive movement per tick (the sim's normal cadence), which
// converges between steps.

import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IdleEngine } from '../../idle/engine';
import { dist2d } from '../../src/sim/types';

/** Drive an engine for `steps` and return it plus the entropy of the run. */
function drive(
  steps: number,
  level = 5,
): { engine: IdleEngine; xpDelta: number; kills: number; movedYards: number } {
  const engine = new IdleEngine({
    seed: 20061,
    playerClass: 'warrior',
    frameSkip: 20, // 1 sim-sec/step
    playerLevel: level,
    playerName: 'SteerChar',
    saveDir: path.join(os.tmpdir(), 'idle-steer-test'),
  });
  const start = { ...engine.sim.player.pos };
  const startXp = engine.sim.xp;
  const startKills = engine.sim.counters.kills;
  for (let i = 0; i < steps; i++) {
    engine.step(1000);
  }
  const p = engine.sim.player;
  return {
    engine,
    xpDelta: engine.sim.xp - startXp,
    kills: engine.sim.counters.kills - startKills,
    movedYards: dist2d({ x: p.pos.x, y: 0, z: p.pos.z }, { x: start.x, y: 0, z: start.z }),
  };
}

describe('IdleEngine steering reaches a camp and engages', () => {
  it('drifts off spawn and gains XP instead of spinning in place', () => {
    const { xpDelta, kills, movedYards } = drive(200);
    // The core promise of the idle mode: the character moves to a hunting
    // ground and farms. Spinning forever (bug) yields zero kills AND zero XP.
    expect(movedYards).toBeGreaterThan(15);
    expect(xpDelta).toBeGreaterThan(0);
    expect(kills).toBeGreaterThan(0);
  });

  it('the facing does not get stuck oscillating between two antipodal angles', () => {
    // Regression sentinel for the steering bug: a once-per-step TURN held for
    // the full frameSkip batch rotates the player exactly PI radians per step,
    // so the facing can only ever land on one of two antipodal angles and the
    // steering loop never converges. Over 30 steps a fixed facing must visit
    // more than two distinct values; the bug visited exactly two (radians 0
    // and PI) forever.
    const engine = new IdleEngine({
      seed: 20061,
      playerClass: 'warrior',
      frameSkip: 20,
      playerLevel: 5,
      playerName: 'SteerChar3',
      saveDir: path.join(os.tmpdir(), 'idle-steer-test3'),
    });
    const distinct = new Set<number>();
    for (let i = 0; i < 30; i++) {
      engine.step(1000);
      // Quantize to PI/4 buckets so tiny per-tick jitter inside a healthy run
      // does not inflate the count, but the bug's two-antipode signature stays
      // at exactly 2 buckets.
      distinct.add(Math.round((engine.sim.player.facing / (Math.PI / 4)) % 8));
    }
    expect(distinct.size).toBeGreaterThan(2);
  });
});

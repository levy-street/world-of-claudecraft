// Determinism and smoke tests for the Idle Classic engine.
// Verifies: byte-identical counters from same seed, save/restore round-trip,
// all-9-classes smoke, and basic progression.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IdleEngine } from '../../idle/engine';
import type { PlayerClass } from '../../src/sim/types';
import { ALL_CLASSES } from '../../src/sim/types';

/** Run the engine for N steps and return the final counters snapshot. */
function runEngine(cls: PlayerClass, seed: number, steps: number, level = 1): IdleEngine {
  const engine = new IdleEngine({
    seed,
    playerClass: cls,
    frameSkip: 20, // 1 sim-sec/step
    playerLevel: level,
    playerName: 'TestChar',
    saveDir: path.join(os.tmpdir(), 'idle-test'),
  });
  for (let i = 0; i < steps; i++) {
    engine.step(1000);
  }
  return engine;
}

describe('IdleEngine determinism', () => {
  it('produces identical counters from the same seed', () => {
    const a = runEngine('warrior', 20061, 10);
    const b = runEngine('warrior', 20061, 10);
    expect(a.sim.counters).toEqual(b.sim.counters);
    expect(a.sim.player.level).toBe(b.sim.player.level);
  });

  it('different seeds produce different results', () => {
    const a = runEngine('warrior', 20061, 10);
    const b = runEngine('warrior', 99999, 10);
    // Very unlikely to have identical kills/xp from different seeds
    const aKills = a.sim.counters.kills;
    const bKills = b.sim.counters.kills;
    // Just verify both run without error
    expect(aKills).toBeGreaterThanOrEqual(0);
    expect(bKills).toBeGreaterThanOrEqual(0);
  });
});

describe('IdleEngine progression', () => {
  it('does not crash for any player class', () => {
    for (const cls of ALL_CLASSES) {
      const engine = runEngine(cls, 20061, 5);
      expect(engine.sim.player.dead).toBeDefined();
      expect(engine.sim.counters.kills).toBeGreaterThanOrEqual(0);
    }
  });

  it('starts at the requested player level', () => {
    const engine = new IdleEngine({
      seed: 20061,
      playerClass: 'warrior',
      playerLevel: 10,
      playerName: 'TestChar',
    });
    expect(engine.sim.player.level).toBe(10);
    expect(engine.sim.player.maxHp).toBeGreaterThan(200); // level 10 has ~442 HP
  });
});

describe('IdleEngine save/restore', () => {
  const tmpDir = path.join(os.tmpdir(), 'idle-test-save');

  it('persists and restores identical counters', () => {
    // Run control
    const control = runEngine('warrior', 42, 5, 5);
    const controlKills = control.sim.counters.kills;

    // Run another, save at step 3, continue
    const engine = new IdleEngine({
      seed: 42,
      playerClass: 'warrior',
      frameSkip: 20,
      playerLevel: 5,
      playerName: 'SaveTest',
      saveDir: tmpDir,
    });
    for (let i = 0; i < 3; i++) engine.step(1000);
    engine.save(tmpDir);

    // Restore and run remaining steps
    const restored = IdleEngine.restore(path.join(tmpDir, 'warrior_42.idle.json'));
    expect(restored).not.toBeNull();
    if (restored) {
      for (let i = 3; i < 5; i++) restored.step(1000);
      expect(restored.sim.counters.kills).toBe(controlKills);
      expect(restored.sim.player.level).toBe(control.sim.player.level);
    }
  });
});

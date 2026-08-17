// Shared fight helper for the tank crit-immunity suite split
// (tank_crit_immunity_*_pair.test.ts). Not a test file: nothing here runs
// on its own. Split from the original single-file tests/tank_crit_immunity.test.ts
// along class-pair boundaries for CI shard balance (a pure move).

import { expect, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

// Vitest default (5 s) is far too tight for the 240 s simulated window: after
// the upstream merge each case runs ~17 s even on an unloaded machine, and
// 25-33 s under full-suite parallel load (the old 30 s cap flaked exactly
// there: whichever cases drew the worst scheduling timed out). 120 s keeps a
// ~4x margin over the worst observed case; the assertions themselves are
// deterministic and unaffected by load.
vi.setConfig({ testTimeout: 120000 });

// Tank crit immunity: creatures cannot critically strike a committed tank.
// Committed means Protection-spec warrior, Protection-spec paladin, or a
// Feral-spec druid IN Sloth Form (the form aura, not just the spec). Everyone
// else keeps eating 2x mob crits, and the 5% crit roll is still DRAWN for the
// immune tank so every downstream rng draw keeps its stream position.

export const SEED = 90210;
export const WINDOW_SECONDS = 240;

export type Setup = {
  cls: PlayerClass;
  spec: string | null;
  form?: 'bear_form';
  // Warspirit weapon posture, cast after the spec is applied (the shaman
  // commitment is the Stonebound POSTURE, not the spec alone).
  imbue?: 'rockbiter_weapon' | 'galeheart_weapon';
};

// One identical fight per case: same seed, same mob, same window; only the
// defender's build differs. Returns landed swings and crits taken.
// Hand-spawned wolf only: empty ambient world so 240 s of ticks stay cheap
// (subsystem-world pattern; does not change hit/crit assertions).
export function critsTaken(setup: Setup): { hits: number; crits: number } {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer(setup.cls, 'Defender');
  sim.setPlayerLevel(20, pid);
  if (setup.spec) sim.applyTalents({ spec: setup.spec, rows: {} }, pid);
  const p = sim.entities.get(pid)!;
  if (setup.form) {
    sim.castAbility(setup.form, pid);
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
  }
  if (setup.imbue) {
    p.resource = p.maxResource;
    sim.castAbility(setup.imbue, pid);
    sim.tick();
    expect(p.auras.some((a) => a.id === setup.imbue)).toBe(true);
  }
  p.maxHp = 1e9;
  p.hp = p.maxHp;

  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: p.pos.x + 1,
    y: p.pos.y,
    z: p.pos.z,
  });
  mob.hostile = true;
  mob.maxHp = 1e9;
  mob.hp = mob.maxHp;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = pid;
  mob.threat.set(pid, 1e9);

  let hits = 0;
  let crits = 0;
  for (let tick = 0; tick < WINDOW_SECONDS * 20; tick++) {
    p.hp = p.maxHp;
    mob.aggroTargetId = pid;
    mob.threat.set(pid, 1e9);
    for (const event of sim.tick()) {
      if (
        event.type === 'damage' &&
        event.sourceId === mob.id &&
        event.targetId === pid &&
        event.kind === 'hit'
      ) {
        hits++;
        if (event.crit) crits++;
      }
    }
  }
  expect(hits).toBeGreaterThan(30); // the fight actually ran
  return { hits, crits };
}

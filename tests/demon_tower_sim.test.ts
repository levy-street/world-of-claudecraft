// End-to-end Demon Tower: a live Sim enters the tower, fights its way up, and the
// run behaves the way the design says it does.
//
// These are the assertions that would actually catch a regression in the wiring:
// a floor that arrives pre-populated (the tower's whole feel is wave-by-wave), a
// second wave landing on top of the first, an ascent that opens before the floor
// is clear, the floor-5 gatekeeper stealing the run's boss slot and ending it
// early, or the summit failing to pay out.

import { describe, expect, it } from 'vitest';
import {
  buildDemonTowerFloor,
  DEMON_TOWER_SEED,
  demonTowerArenaPolygon,
  isDemonTowerSeed,
} from '../src/sim/content/rift/demon_tower';
import { BUILTIN_WORLD } from '../src/sim/data';
import { generateRiftFloor, generateRiftPlan, riftFloorCount } from '../src/sim/rift/rift_gen';
import {
  DEMON_TOWER_FLOOR_COUNT,
  demonTowerArenaRadius,
  demonTowerFloorTuning,
  isDemonTowerBossFloor,
} from '../src/sim/rift/tower_scaling';
import { demonTowerBossFor } from '../src/sim/rift/tower_waves';
import type { RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';

const TOWER_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim() {
  const sim = new Sim({
    seed: 4242,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    world: TOWER_WORLD,
  });
  sim.setPlayerLevel(20);
  // The tower is tuned to kill a raid, let alone one warrior. The tester is
  // invulnerable so these tests measure the RUN's wiring, not its balance
  // (every damage path funnels through the devGod check in combat/damage.ts).
  sim.player.devGod = true;
  return sim;
}

function towerInstance(sim: Sim): RiftInstance {
  const inst = sim.riftInstances.find((i) => i.partyKey !== null);
  if (!inst) throw new Error('no live rift instance');
  return inst;
}

// updateRiftInstances sweeps once a SECOND, not once a tick (runs.ts), so every
// step that waits on the wave driver has to span at least one sweep.
const SWEEP = 22;

function tickAlive(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) {
    sim.player.hp = sim.player.maxHp;
    sim.tick();
  }
}

/** Take the open ascent up, the way a player does: walk onto it. */
function ascend(sim: Sim, inst: RiftInstance): void {
  expect(inst.descentOpen, 'ascent must be open before climbing').toBe(true);
  const desc = sim.entities.get(inst.descentId!);
  expect(desc, 'ascent object must exist').toBeTruthy();
  sim.player.pos = { ...desc!.pos };
  tickAlive(sim, SWEEP);
}

/** Kill everything the tower currently has on the floor. */
function killLiveDemons(sim: Sim, inst: RiftInstance): number {
  let killed = 0;
  for (const id of [...inst.towerWaveMobIds, inst.towerBossId ?? -1]) {
    const e = sim.entities.get(id);
    if (e && !e.dead) {
      e.hp = 0;
      e.dead = true;
      killed++;
    }
  }
  return killed;
}

/** Clear a whole floor, wave by wave, the way a raid would. */
function clearFloor(sim: Sim, inst: RiftInstance): number {
  const expected = demonTowerFloorTuning(inst.floorIndex).waveCount;
  let waves = 0;
  for (let guard = 0; guard < 40 && !inst.puzzleSolved; guard++) {
    tickAlive(sim, SWEEP);
    if (killLiveDemons(sim, inst) > 0) waves++;
  }
  expect(waves, `floor ${inst.floorIndex + 1} should have sent ${expected} waves`).toBe(expected);
  return waves;
}

describe('demon tower: generation', () => {
  it('is a fixed landmark on its reserved seed, at every rank', () => {
    expect(isDemonTowerSeed(DEMON_TOWER_SEED)).toBe(true);
    expect(isDemonTowerSeed(DEMON_TOWER_SEED + 1)).toBe(false);
    // Unlike the C-only Infernal Citadel, the tower opens the same ten floors
    // whatever baseLevel it is entered at.
    for (const baseLevel of [20, 22, 25, 28]) {
      expect(riftFloorCount(DEMON_TOWER_SEED, baseLevel)).toBe(DEMON_TOWER_FLOOR_COUNT);
      expect(generateRiftPlan(DEMON_TOWER_SEED, baseLevel).floorCount).toBe(
        DEMON_TOWER_FLOOR_COUNT,
      );
    }
  });

  it('builds a circular arena whose wall matches the declared radius', () => {
    for (let k = 0; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      const poly = demonTowerArenaPolygon(k);
      const radius = demonTowerArenaRadius(k);
      expect(poly.length).toBeGreaterThan(16);
      for (const p of poly) {
        expect(Math.hypot(p.x, p.z)).toBeCloseTo(radius, 2);
      }
      // CCW winding is what the shell seam expects (rift_gen does the same check).
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        area += a.x * b.z - b.x * a.z;
      }
      expect(area).toBeGreaterThan(0);
    }
  });

  it('arrives EMPTY: the population comes from the core, not from floor entry', () => {
    for (let k = 0; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, k);
      expect(floor.spawns).toHaveLength(0);
      expect(floor.puzzle.kind).toBe('demon_waves');
      expect(floor.authored).toBe(true);
      expect(floor.objects.some((o) => o.kind === 'tower_core')).toBe(true);
    }
  });

  it('marks only the summit as the run-ending boss floor', () => {
    for (let k = 0; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      const floor = generateRiftFloor(DEMON_TOWER_SEED, 20, k);
      expect(floor.isBoss).toBe(k === DEMON_TOWER_FLOOR_COUNT - 1);
      // Every non-summit floor must offer a way up, or the climb dead-ends.
      if (k < DEMON_TOWER_FLOOR_COUNT - 1) {
        expect(floor.objects.some((o) => o.kind === 'descent')).toBe(true);
      } else {
        expect(floor.objects.some((o) => o.kind === 'chest')).toBe(true);
      }
    }
  });

  it('keeps the entry point inside the arena and clear of the core', () => {
    for (let k = 0; k < DEMON_TOWER_FLOOR_COUNT; k++) {
      const floor = buildDemonTowerFloor(DEMON_TOWER_SEED, 20, 20, k);
      const r = Math.hypot(floor.entry.x, floor.entry.z);
      expect(r).toBeLessThan(demonTowerArenaRadius(k));
      expect(r).toBeGreaterThan(5);
    }
  });
});

describe('demon tower: a live run', () => {
  it('sends wave 1 only after entry, and never two waves at once', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);
    expect(inst.floorIndex).toBe(0);
    expect(inst.towerWave).toBe(0);
    expect(inst.towerWaveMobIds).toHaveLength(0);

    tickAlive(sim, SWEEP);
    const tuning = demonTowerFloorTuning(0);
    expect(inst.towerWave).toBe(1);
    expect(inst.towerWaveMobIds).toHaveLength(tuning.packSize);

    // While the wave lives, the core must NOT send another one.
    tickAlive(sim, SWEEP * 3);
    expect(inst.towerWave).toBe(1);
    expect(inst.towerWaveMobIds).toHaveLength(tuning.packSize);
    expect(inst.puzzleSolved).toBe(false);
    expect(inst.descentOpen).toBe(false);
  });

  it('opens the ascent only once every wave of the floor is dead', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);
    const tuning = demonTowerFloorTuning(0);

    // Clear all but the last wave: still sealed.
    for (let w = 0; w < tuning.waveCount - 1; w++) {
      tickAlive(sim, SWEEP);
      killLiveDemons(sim, inst);
    }
    tickAlive(sim, SWEEP);
    expect(inst.puzzleSolved).toBe(false);
    expect(inst.descentOpen).toBe(false);

    // Kill the last wave and the ascent tears open.
    killLiveDemons(sim, inst);
    tickAlive(sim, SWEEP);
    expect(inst.towerWave).toBe(tuning.waveCount);
    expect(inst.puzzleSolved).toBe(true);
    expect(inst.descentOpen).toBe(true);
  });

  it('scales the demons by the floor, not by the portal rank', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);
    tickAlive(sim, SWEEP);
    const groundFloorHp = Math.max(
      ...inst.towerWaveMobIds.map((id) => sim.entities.get(id)?.maxHp ?? 0),
    );

    // Jump the same instance to a much higher floor and re-arm it.
    const sim2 = makeSim();
    sim2.enterRift(DEMON_TOWER_SEED, 20, sim2.player.id);
    const inst2 = towerInstance(sim2);
    for (let k = 0; k < 6; k++) {
      clearFloor(sim2, inst2);
      ascend(sim2, inst2);
    }
    expect(inst2.floorIndex).toBe(6);
    tickAlive(sim2, SWEEP);
    const highFloorHp = Math.max(
      ...inst2.towerWaveMobIds.map((id) => sim2.entities.get(id)?.maxHp ?? 0),
    );
    // Floor 7 demons are a different, tougher tier AND carry the floor multiplier.
    expect(highFloorHp).toBeGreaterThan(groundFloorHp * 2);
  });

  it('releases the floor-5 gatekeeper on the last wave without ending the run', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);
    for (let k = 0; k < 4; k++) {
      clearFloor(sim, inst);
      ascend(sim, inst);
    }
    expect(inst.floorIndex).toBe(4);
    expect(isDemonTowerBossFloor(4)).toBe(true);

    const tuning = demonTowerFloorTuning(4);
    for (let w = 0; w < tuning.waveCount; w++) {
      tickAlive(sim, SWEEP);
      if (w < tuning.waveCount - 1) killLiveDemons(sim, inst);
    }
    // The last wave brought the gatekeeper with it...
    expect(inst.towerBossId).not.toBeNull();
    const boss = sim.entities.get(inst.towerBossId!);
    expect(boss?.templateId).toBe(demonTowerBossFor(4));
    // ...but he must NOT hold the run's boss slot, or the run ends five floors early.
    expect(inst.bossId).toBeNull();
    expect(inst.puzzleSolved).toBe(false);

    killLiveDemons(sim, inst);
    tickAlive(sim, SWEEP);
    expect(inst.puzzleSolved).toBe(true);
    expect(inst.descentOpen).toBe(true);
  });

  it('climbs all ten floors and the summit boss claims the run', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);

    for (let k = 0; k < DEMON_TOWER_FLOOR_COUNT - 1; k++) {
      expect(inst.floorIndex).toBe(k);
      clearFloor(sim, inst);
      expect(inst.descentOpen).toBe(true);
      ascend(sim, inst);
    }

    expect(inst.floorIndex).toBe(DEMON_TOWER_FLOOR_COUNT - 1);
    const tuning = demonTowerFloorTuning(DEMON_TOWER_FLOOR_COUNT - 1);
    for (let w = 0; w < tuning.waveCount; w++) {
      tickAlive(sim, SWEEP);
      if (w < tuning.waveCount - 1) killLiveDemons(sim, inst);
    }
    // The summit's Demon Lord DOES take the run's boss slot: his death is what
    // opens the way home and pays out.
    expect(inst.towerBossId).not.toBeNull();
    expect(inst.bossId).toBe(inst.towerBossId);
    expect(sim.entities.get(inst.bossId!)?.templateId).toBe(
      demonTowerBossFor(DEMON_TOWER_FLOOR_COUNT - 1),
    );

    killLiveDemons(sim, inst);
    tickAlive(sim, SWEEP);
    expect(inst.bossDiedAtTick).not.toBeNull();
    expect(inst.exitId).not.toBeNull();
  });
});

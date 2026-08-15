// End-to-end Demon Tower: a live Sim enters the tower, fights its way up, and the
// run behaves the way the design says it does.
//
// These are the assertions that would actually catch a regression in the wiring:
// a floor that arrives pre-populated (the tower's whole feel is wave-by-wave), a
// second wave landing on top of the first, an ascent that opens before the floor
// is clear, Vaskar stealing the Void Crown's boss slot and ending it early, or
// the Demon Lord failing to pay out.

import { describe, expect, it } from 'vitest';
import {
  buildDemonTowerFloor,
  DEMON_TOWER_SEED,
  demonTowerArenaPolygon,
  isDemonTowerSeed,
} from '../src/sim/content/rift/demon_tower';
import { BUILTIN_WORLD, MOBS, riftInstanceOrigin } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { RIFT_MECHANIC_SPACING_SEC } from '../src/sim/mob/mechanic_spacing';
import { riftRankTemplate } from '../src/sim/rift/ranks';
import { generateRiftFloor, generateRiftPlan, riftFloorCount } from '../src/sim/rift/rift_gen';
import { demonTowerRankTuning } from '../src/sim/rift/tower';
import {
  DEMON_TOWER_FLOOR_COUNT,
  demonTowerArenaRadius,
  demonTowerFloorTuning,
  isDemonTowerBossFloor,
} from '../src/sim/rift/tower_scaling';
import {
  DEMON_TOWER_GATEKEEPER,
  demonTowerBossFor,
  demonTowerWavePlan,
  safeTowerSpawnPosition,
} from '../src/sim/rift/tower_waves';
import type { RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';

const TOWER_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function makeSim(riftPortals = false) {
  const sim = new Sim({
    seed: 4242,
    playerClass: 'warrior',
    autoEquip: true,
    devCommands: true,
    riftPortals,
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
  if (inst.descentId === null) throw new Error('ascent id must exist before climbing');
  const desc = sim.entities.get(inst.descentId);
  expect(desc, 'ascent object must exist').toBeTruthy();
  if (!desc) throw new Error('ascent object must exist before climbing');
  sim.player.pos = { ...desc.pos };
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
    // Unlike the C-only Infernal Citadel, the tower opens the same three
    // authored raids whatever baseLevel it is entered at.
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
      expect(poly.length).toBeGreaterThanOrEqual(8);
      expect(Math.max(...poly.map((p) => Math.hypot(p.x, p.z)))).toBeCloseTo(radius, 2);
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
    expect(inst.towerWave).toBe(1);
    expect(inst.towerWaveMobIds).toHaveLength(demonTowerWavePlan(0)[0].spawns.length);

    // While the wave lives, the core must NOT send another one.
    tickAlive(sim, SWEEP * 3);
    expect(inst.towerWave).toBe(1);
    expect(inst.towerWaveMobIds).toHaveLength(demonTowerWavePlan(0)[0].spawns.length);
    expect(inst.puzzleSolved).toBe(false);
    expect(inst.descentOpen).toBe(false);
  });

  it('keeps a live Tower caster at range and starts its projectile windup', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);
    tickAlive(sim, SWEEP);
    const imp = inst.towerWaveMobIds
      .map((id) => sim.entities.get(id))
      .find((mob) => mob?.templateId === 'tower_imp');
    if (!imp) throw new Error('the Bloodforge opening wave needs its ranged imp');

    sim.player.pos = { x: imp.pos.x, y: imp.pos.y, z: imp.pos.z - 18 };
    sim.player.prevPos = { ...sim.player.pos };
    imp.aiState = 'attack';
    imp.aggroTargetId = sim.player.id;
    imp.threat.set(sim.player.id, 100);
    imp.swingTimer = 0;
    const before = { ...imp.pos };

    (sim as unknown as { updateMob(mob: typeof imp): void }).updateMob(imp);

    expect(imp.pos).toEqual(before);
    expect(imp.aiState).toBe('attack');
    expect(imp.rangedWindupReleaseTick).not.toBeNull();
    expect(imp.rangedDamageMult).toBe(1);

    sim.drainEvents();
    imp.rangedWindupReleaseTick = 0;
    (sim as unknown as { updateMob(mob: typeof imp): void }).updateMob(imp);
    expect(sim.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'spellfx',
          sourceId: imp.id,
          targetId: sim.player.id,
          fx: 'projectile',
        }),
        expect.objectContaining({
          type: 'damage',
          sourceId: imp.id,
          targetId: sim.player.id,
          ability: 'Cinderbolt',
        }),
      ]),
    );
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

    // Climb to the Void Crown and compare against the same base portal rank.
    const sim2 = makeSim();
    sim2.enterRift(DEMON_TOWER_SEED, 20, sim2.player.id);
    const inst2 = towerInstance(sim2);
    for (let k = 0; k < 2; k++) {
      clearFloor(sim2, inst2);
      ascend(sim2, inst2);
    }
    expect(inst2.floorIndex).toBe(2);
    tickAlive(sim2, SWEEP);
    const highFloorHp = Math.max(
      ...inst2.towerWaveMobIds.map((id) => sim2.entities.get(id)?.maxHp ?? 0),
    );
    // Void Crown demons are a different, tougher tier AND carry the floor multiplier.
    expect(highFloorHp).toBeGreaterThan(groundFloorHp * 2);
  });

  it('fields Vaskar as a Void Crown lieutenant without stealing the run boss slot', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);
    for (let k = 0; k < 2; k++) {
      clearFloor(sim, inst);
      ascend(sim, inst);
    }
    expect(inst.floorIndex).toBe(2);
    expect(isDemonTowerBossFloor(2)).toBe(true);

    const plan = demonTowerWavePlan(2);
    const lieutenantWave = plan.findIndex((wave) =>
      wave.spawns.some((spawn) => spawn.templateId === DEMON_TOWER_GATEKEEPER),
    );
    expect(lieutenantWave).toBeGreaterThan(0);
    for (let w = 0; w <= lieutenantWave; w++) {
      tickAlive(sim, SWEEP);
      if (w < lieutenantWave) killLiveDemons(sim, inst);
    }
    const boss = inst.towerWaveMobIds
      .map((id) => sim.entities.get(id))
      .find((entity) => entity?.templateId === DEMON_TOWER_GATEKEEPER);
    expect(boss).toBeTruthy();
    // Vaskar is part of the authored wave, not the Demon Lord release.
    expect(inst.towerBossId).toBeNull();
    expect(inst.bossId).toBeNull();
    expect(inst.puzzleSolved).toBe(false);

    // Summoned boss adds must inherit this floor's Tower curve, not the S-rank
    // portal table. v0.38.0 retuned S independently, so confusing the two makes
    // these adds several times deadlier without touching Tower tuning.
    if (!boss) throw new Error('Vaskar did not spawn');
    expect(RIFT_MECHANIC_SPACING_SEC).toBe(5);
    expect(boss.riftMechanicSpacing).toBe(5);
    const summon = sim as unknown as {
      spawnBossAdds(entity: typeof boss, mobId: string, count: number): void;
    };
    summon.spawnBossAdds(boss, 'tower_imp', 1);
    const addId = boss.summonedIds.at(-1);
    const add = addId === undefined ? undefined : sim.entities.get(addId);
    expect(add).toBeTruthy();
    expect(add?.riftMechanicSpacing).toBeUndefined();
    const rankTuning = demonTowerRankTuning(2);
    const expected = createMob(
      -1,
      riftRankTemplate(MOBS.tower_imp, rankTuning, 'add'),
      boss.level,
      add?.pos ?? boss.pos,
    );
    expect({
      maxHp: add?.maxHp,
      weapon: add?.weapon,
      armor: add?.stats.armor,
      moveSpeed: add?.moveSpeed,
      rangedDamageMult: add?.rangedDamageMult,
      mechanicDamageMult: add?.mechanicDamageMult,
      mechanicHealMult: add?.mechanicHealMult,
    }).toEqual({
      maxHp: expected.maxHp,
      weapon: expected.weapon,
      armor: expected.stats.armor,
      moveSpeed: expected.moveSpeed,
      rangedDamageMult: rankTuning.addDamageMultiplier,
      mechanicDamageMult: rankTuning.addDamageMultiplier,
      mechanicHealMult: rankTuning.healthMultiplier,
    });

    // A surviving summon is part of the encounter population: killing Vaskar
    // cannot advance the wave while his add is still active.
    killLiveDemons(sim, inst);
    tickAlive(sim, SWEEP);
    expect(inst.towerBossId).toBeNull();
    if (add) {
      add.hp = 0;
      add.dead = true;
    }
    tickAlive(sim, SWEEP);
    expect(inst.towerBossId).not.toBeNull();
    expect(inst.bossId).toBe(inst.towerBossId);
    const towerBossId = inst.towerBossId;
    if (towerBossId === null) throw new Error('Demon Lord did not spawn');
    expect(sim.entities.get(towerBossId)?.templateId).toBe(demonTowerBossFor(2));
    expect(sim.entities.get(towerBossId)?.riftMechanicSpacing).toBe(5);
    expect(inst.puzzleSolved).toBe(false);
  });

  it('releases each live floor boss at the safe authored position', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);

    for (let floorIndex = 0; floorIndex < DEMON_TOWER_FLOOR_COUNT; floorIndex++) {
      expect(inst.floorIndex).toBe(floorIndex);
      const waveCount = demonTowerFloorTuning(floorIndex).waveCount;
      for (let wave = 0; wave < waveCount; wave++) {
        tickAlive(sim, SWEEP);
        if (wave < waveCount - 1) killLiveDemons(sim, inst);
      }
      if (inst.towerBossId === null) throw new Error(`floor ${floorIndex + 1} boss missing`);
      const boss = sim.entities.get(inst.towerBossId);
      if (!boss) throw new Error(`floor ${floorIndex + 1} boss entity missing`);
      const origin = riftInstanceOrigin(inst.slot, floorIndex);
      const localBoss = {
        x: boss.spawnPos.x - origin.x,
        z: boss.spawnPos.z - origin.z,
      };
      const expected = safeTowerSpawnPosition(floorIndex, {
        x: 0,
        z: demonTowerArenaRadius(floorIndex) * 0.36,
      });
      expect(localBoss.x).toBeCloseTo(expected.x, 6);
      expect(localBoss.z).toBeCloseTo(expected.z, 6);
      expect(Math.hypot(localBoss.x, localBoss.z)).toBeGreaterThan(5);

      killLiveDemons(sim, inst);
      tickAlive(sim, SWEEP);
      if (floorIndex < DEMON_TOWER_FLOOR_COUNT - 1) ascend(sim, inst);
    }
  });

  it('caps boss summons against the complete live Tower population', () => {
    const sim = makeSim();
    sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
    const inst = towerInstance(sim);
    tickAlive(sim, SWEEP);
    const summoner = sim.entities.get(inst.towerWaveMobIds[0]);
    if (!summoner) throw new Error('tower wave should provide a summoner fixture');
    const summon = sim as unknown as {
      spawnBossAdds(entity: typeof summoner, mobId: string, count: number): void;
    };
    summon.spawnBossAdds(summoner, 'tower_imp', 50);
    const live = inst.mobIds.filter((id) => {
      const mob = sim.entities.get(id);
      return mob && !mob.dead;
    });
    expect(live.length).toBe(18);
    expect(summoner.summonedIds).toHaveLength(18 - inst.towerWaveMobIds.length);
  });

  it('replays the same runtime wave trace for the same seed and config', () => {
    const trace = (): unknown => {
      const sim = makeSim();
      sim.enterRift(DEMON_TOWER_SEED, 20, sim.player.id);
      const inst = towerInstance(sim);
      tickAlive(sim, SWEEP);
      return inst.towerWaveMobIds.map((id) => {
        const mob = sim.entities.get(id);
        return (
          mob && {
            id: mob.id,
            templateId: mob.templateId,
            pos: mob.pos,
            maxHp: mob.maxHp,
            weapon: mob.weapon,
            spacing: mob.riftMechanicSpacing,
          }
        );
      });
    };
    expect(trace()).toEqual(trace());
  });

  it('climbs all three raids and the Demon Lord claims the run', () => {
    const sim = makeSim(true);
    sim.tick();
    const door = [...sim.entities.values()].find(
      (e) => e.templateId === 'rift_portal' && e.riftSeed === DEMON_TOWER_SEED,
    );
    expect(door).toBeTruthy();
    if (!door) throw new Error('tower door should exist');
    sim.player.pos = { ...door.pos };
    sim.tick();
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
    if (inst.bossId === null) throw new Error('summit boss should exist');
    expect(sim.entities.get(inst.bossId)?.templateId).toBe(
      demonTowerBossFor(DEMON_TOWER_FLOOR_COUNT - 1),
    );

    const bossId = inst.bossId;
    if (bossId === null) throw new Error('summit boss should exist');
    const boss = sim.entities.get(bossId);
    if (!boss) throw new Error('summit boss entity should exist');
    boss.hp = 0;
    boss.dead = true;
    tickAlive(sim, SWEEP);
    expect(inst.bossDiedAtTick).not.toBeNull();
    expect(inst.puzzleSolved).toBe(false);
    expect(inst.exitId).toBeNull();

    killLiveDemons(sim, inst);
    tickAlive(sim, SWEEP);
    expect(inst.puzzleSolved).toBe(true);
    expect(inst.exitId).not.toBeNull();
    expect(inst.cacheId).toBeNull();
    // A natural/dev rift seals its entry after a clear. The tower is a permanent
    // landmark and must remain available for the next raid.
    expect(sim.entities.get(door.id)).toBe(door);
  });
});

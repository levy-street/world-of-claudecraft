import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import {
  BUILTIN_WORLD,
  EASTBROOK_FREIGHT_CARAVAN_ESCORT_ID,
  EASTBROOK_FREIGHT_CARAVAN_MOB_ID,
  ESCORTS,
  WORLD_QUESTS_BY_ID,
} from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { worldQuestCycleOfferingQuest } from '../src/sim/world_quest_rotation';
import { WORLD_SEED } from '../src/sim/world_seed';

const QUEST_ID = 'wq_eastbrook_caravan';
const ESCORT_ID = EASTBROOK_FREIGHT_CARAVAN_ESCORT_ID;
const DEF = ESCORTS[ESCORT_ID];
const QUEST = WORLD_QUESTS_BY_ID[QUEST_ID];
const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

function player(sim: Sim, pid: number): Entity {
  const value = sim.entities.get(pid);
  if (!value) throw new Error(`Missing player ${pid}`);
  return value;
}

function teleport(sim: Sim, entity: Entity, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  entity.pos = { ...pos };
  entity.prevPos = { ...pos };
}

function caravan(sim: Sim): Entity | undefined {
  return [...sim.entities.values()].find(
    (entity) =>
      entity.kind === 'mob' &&
      entity.templateId === EASTBROOK_FREIGHT_CARAVAN_MOB_ID &&
      !entity.dead,
  );
}

describe('Eastbrook world-quest caravan', () => {
  it('can be armed immediately in a local dev session', () => {
    const sim = new Sim({
      seed: 9191,
      playerClass: 'warrior',
      noPlayer: true,
      world: TEST_WORLD,
      devCommands: true,
    });
    const pid = sim.addPlayer('warrior', 'Caravan Tester');
    sim.resetDay = '2026-09-04';
    sim.drainEvents();

    sim.chat('/dev caravan', pid);

    const meta = sim.meta(pid);
    expect(meta?.worldQuestLog.get(QUEST_ID)).toMatchObject({
      questId: QUEST_ID,
      count: 0,
      state: 'active',
    });
    expect(meta?.devWorldQuestCycle).toBe(
      worldQuestCycleOfferingQuest(sim.worldQuestCycle, QUEST_ID),
    );
    expect(player(sim, pid).level).toBeGreaterThanOrEqual(QUEST.minLevel);
    expect(
      sim
        .drainEvents()
        .some(
          (event) =>
            event.type === 'log' &&
            event.text.includes('/dev tp -92 -32') &&
            event.text.includes('interact with the wagon'),
        ),
    ).toBe(true);

    teleport(sim, player(sim, pid), DEF.start.x, DEF.start.z);
    sim.tick();
    expect(caravan(sim)).toBeDefined();
  });

  it('moves along the road, pauses for three scaled waves, and shares nearby credit', () => {
    expect(DEF.worldQuestId).toBe(QUEST_ID);
    expect(QUEST.objective).toEqual({ type: 'escort', escortId: ESCORT_ID });
    expect(DEF).toMatchObject({
      start: { x: -92, z: -32 },
      waypoints: [
        { x: -92, z: -46 },
        { x: -92, z: -56 },
        { x: -88, z: -60 },
        { x: -80, z: -66 },
        { x: -70, z: -68 },
        { x: -62, z: -76 },
        { x: -56, z: -88 },
        { x: -44, z: -98 },
        { x: -26, z: -101 },
        { x: -20, z: -102 },
      ],
      moveSpeed: 4,
      ambushes: [
        { atWaypoint: 2, mobId: 'vale_bandit', count: 3, level: 10, radius: 6 },
        { atWaypoint: 5, mobId: 'vale_bandit', count: 4, level: 10, radius: 7 },
        { atWaypoint: 8, mobId: 'vale_bandit', count: 5, level: 10, radius: 8 },
      ],
      creditRadius: 35,
    });
    for (const point of [DEF.start, ...DEF.waypoints]) {
      expect(isBlocked(WORLD_SEED, point.x, point.z, 0.8), `${point.x},${point.z}`).toBe(false);
    }
    for (const wave of DEF.ambushes) {
      const point = DEF.waypoints[wave.atWaypoint];
      const radius = wave.radius ?? 5;
      for (let index = 0; index < wave.count; index++) {
        const angle = (index / wave.count) * Math.PI * 2;
        expect(
          isBlocked(
            WORLD_SEED,
            point.x + Math.sin(angle) * radius,
            point.z + Math.cos(angle) * radius,
            0.55,
          ),
          `wave ${wave.atWaypoint} spawn ${index}`,
        ).toBe(false);
      }
    }

    const sim = new Sim({
      seed: 424242,
      playerClass: 'warrior',
      noPlayer: true,
      world: TEST_WORLD,
    });
    const starterPid = sim.addPlayer('warrior', 'Starter');
    const helperPid = sim.addPlayer('priest', 'Helper');
    const farPid = sim.addPlayer('mage', 'Far');
    const cycle = worldQuestCycleOfferingQuest('wq3_0', QUEST_ID);
    for (const pid of [starterPid, helperPid, farPid]) {
      const meta = sim.meta(pid);
      if (!meta) throw new Error(`Missing metadata ${pid}`);
      meta.devWorldQuestCycle = cycle;
      player(sim, pid).level = 10;
      teleport(sim, player(sim, pid), DEF.start.x, DEF.start.z);
    }

    // Public-event walkers are absent outside their active rotation and
    // materialize when the first eligible players enter the authored area.
    expect(caravan(sim)).toBeUndefined();
    sim.tick();
    const wagon = caravan(sim);
    expect(wagon).toBeDefined();
    if (!wagon) return;
    for (const pid of [starterPid, helperPid, farPid]) {
      expect(sim.meta(pid)?.worldQuestLog.get(QUEST_ID)?.state).toBe('active');
    }

    teleport(sim, player(sim, starterPid), wagon.pos.x, wagon.pos.z);
    sim.interact(starterPid);
    expect(sim.escortRuns.get(ESCORT_ID)?.run).toBeTruthy();
    const initial = { x: wagon.pos.x, z: wagon.pos.z };
    const starterCopper = sim.meta(starterPid)?.copper ?? 0;
    const helperCopper = sim.meta(helperPid)?.copper ?? 0;
    const farCopper = sim.meta(farPid)?.copper ?? 0;
    const waveSizes: number[] = [];
    let sawPause = false;
    let completed = false;
    const events: SimEvent[] = [];

    for (let tick = 0; tick < 180 * 20 && !completed; tick++) {
      const run = sim.escortRuns.get(ESCORT_ID)?.run;
      const live = (run?.ambushIds ?? [])
        .map((id) => sim.entities.get(id))
        .filter((entity): entity is Entity => !!entity && !entity.dead);
      if (run && run.ambushIds.length > (waveSizes.at(-1) ?? 0)) {
        waveSizes.push(run.ambushIds.length);
        expect(live.every((mob) => mob.level === 10)).toBe(true);
        const held = { x: wagon.pos.x, z: wagon.pos.z };
        sim.tick();
        expect(Math.hypot(wagon.pos.x - held.x, wagon.pos.z - held.z)).toBeLessThan(0.05);
        sawPause = true;
      }
      for (const mob of live) {
        mob.hp = 0;
        mob.dead = true;
        mob.respawnTimer = 99_999;
      }
      teleport(sim, player(sim, starterPid), wagon.pos.x + 2, wagon.pos.z);
      teleport(sim, player(sim, helperPid), wagon.pos.x - 2, wagon.pos.z);
      // Still inside the WQ area but well outside final shared-credit range.
      teleport(sim, player(sim, farPid), DEF.start.x, DEF.start.z);
      const tickEvents = sim.tick();
      events.push(...tickEvents);
      completed = tickEvents.some(
        (event) => event.type === 'worldQuestDone' && event.questId === QUEST_ID,
      );
    }

    expect(Math.hypot(wagon.pos.x - initial.x, wagon.pos.z - initial.z)).toBeGreaterThan(30);
    expect(sawPause).toBe(true);
    expect(waveSizes).toEqual([3, 7, 12]);
    expect(completed).toBe(true);
    expect(
      events.filter((event) => event.type === 'worldQuestDone' && event.questId === QUEST_ID),
    ).toHaveLength(2);
    expect(sim.meta(starterPid)?.worldQuestLog.get(QUEST_ID)?.state).toBe('completed');
    expect(sim.meta(helperPid)?.worldQuestLog.get(QUEST_ID)?.state).toBe('completed');
    expect(sim.meta(farPid)?.worldQuestLog.get(QUEST_ID)?.state).toBe('active');
    expect((sim.meta(starterPid)?.copper ?? 0) - starterCopper).toBe(4_250);
    expect((sim.meta(helperPid)?.copper ?? 0) - helperCopper).toBe(4_250);
    expect((sim.meta(farPid)?.copper ?? 0) - farCopper).toBe(0);
    expect(caravan(sim)).toBeUndefined();
  }, 60_000);

  it('stays absent off-rotation and deterministically cleans the caravan and live wave on rollover', () => {
    const run = () => {
      const sim = new Sim({
        seed: 7878,
        playerClass: 'warrior',
        noPlayer: true,
        world: TEST_WORLD,
      });
      const pid = sim.addPlayer('warrior', 'Guard');
      const meta = sim.meta(pid);
      if (!meta) throw new Error('Missing guard metadata');
      player(sim, pid).level = 10;
      teleport(sim, player(sim, pid), DEF.start.x, DEF.start.z);

      meta.devWorldQuestCycle = 'wq3_0';
      sim.tick();
      expect(caravan(sim)).toBeUndefined();
      expect(meta.worldQuestLog.has(QUEST_ID)).toBe(false);

      meta.devWorldQuestCycle = worldQuestCycleOfferingQuest('wq3_0', QUEST_ID);
      sim.tick();
      const wagon = caravan(sim);
      if (!wagon) throw new Error('Missing active caravan');
      teleport(sim, player(sim, pid), wagon.pos.x, wagon.pos.z);
      sim.interact(pid);
      const escortRun = sim.escortRuns.get(ESCORT_ID)?.run;
      if (!escortRun) throw new Error('Missing caravan run');
      escortRun.waypointIndex = 2;
      teleport(sim, wagon, DEF.waypoints[2].x, DEF.waypoints[2].z);
      sim.tick();
      const ambushIds = [...escortRun.ambushIds];
      const trace = ambushIds.map((id) => {
        const mob = sim.entities.get(id);
        if (!mob) throw new Error(`Missing ambusher ${id}`);
        return { id, x: mob.pos.x, z: mob.pos.z, level: mob.level };
      });

      meta.devWorldQuestCycle = 'wq3_1';
      sim.tick();
      expect(caravan(sim)).toBeUndefined();
      expect(sim.escortRuns.get(ESCORT_ID)?.run).toBeNull();
      expect(ambushIds.every((id) => !sim.entities.has(id))).toBe(true);
      expect(meta.worldQuestLog.has(QUEST_ID)).toBe(false);
      return trace;
    };

    const first = run();
    expect(first).toHaveLength(3);
    expect(run()).toEqual(first);
  });
});

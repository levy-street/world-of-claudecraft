import { describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { FROSTVEIL_ROADS } from '../src/sim/content/frostveil';
import { WILLOWFEN_ROADS } from '../src/sim/content/willowfen';
import {
  FROSTVEIL_SUPPLY_CARAVAN_ESCORT_ID,
  WILLOWFEN_REMEDY_CARAVAN_ESCORT_ID,
  WORLD_QUEST_ESCORTS,
  WORLD_QUESTS_BY_ID,
} from '../src/sim/content/world_quests';
import { BUILTIN_WORLD, MOBS, zoneAt } from '../src/sim/data';
import { ESCORT_ARRIVE_RANGE } from '../src/sim/escort';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { worldQuestCycleOfferingQuest } from '../src/sim/world_quest_rotation';
import { WORLD_SEED } from '../src/sim/world_seed';

const CASES = [
  { id: WILLOWFEN_REMEDY_CARAVAN_ESCORT_ID, zone: 'willowfen', roads: WILLOWFEN_ROADS },
  { id: FROSTVEIL_SUPPLY_CARAVAN_ESCORT_ID, zone: 'frostveil', roads: FROSTVEIL_ROADS },
];

function distanceToRoad(x: number, z: number, roads: { x: number; z: number }[][]): number {
  let nearest = Infinity;
  for (const road of roads) {
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1];
      const b = road[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
      nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
    }
  }
  return nearest;
}

describe.each(CASES)('$zone caravan content', ({ id, zone, roads }) => {
  const def = WORLD_QUEST_ESCORTS[id];
  const questId = def.worldQuestId;
  const story = def.story;
  if (!questId || !story) throw new Error(`Missing caravan story ${id}`);
  const quest = WORLD_QUESTS_BY_ID[questId];

  it('registers a local story and three regional waves without changing the terrain', () => {
    expect(quest).toMatchObject({ zoneId: zone, minLevel: 10, count: 1 });
    expect(quest.objective).toEqual({ type: 'escort', escortId: id });
    expect(MOBS[def.npcMobId]).toMatchObject({ aggroRadius: 0, moveSpeed: 0, loot: [] });
    expect(def.story?.lines).toHaveLength(3);
    expect(def.ambushes.map((wave) => wave.count)).toEqual([3, 4, 5]);
    expect(new Set(def.ambushes.map((wave) => wave.mobId)).size).toBeGreaterThan(1);
    const problems: string[] = [];
    for (const wave of def.ambushes) {
      expect(MOBS[wave.mobId]).toBeDefined();
      expect(wave.level).toBe(10);
      const point = def.waypoints[wave.atWaypoint];
      for (let i = 0; i < wave.count; i++) {
        const angle = (i / wave.count) * Math.PI * 2;
        const x = point.x + Math.sin(angle) * (wave.radius ?? 5);
        const z = point.z + Math.cos(angle) * (wave.radius ?? 5);
        if (isBlocked(WORLD_SEED, x, z, 0.55))
          problems.push(`blocked wave ${wave.atWaypoint}, spawn ${i}`);
        if (terrainHeight(x, z, WORLD_SEED) <= WATER_LEVEL + 1)
          problems.push(`wet wave ${wave.atWaypoint}, spawn ${i}`);
      }
    }
    const route = [def.start, ...def.waypoints];
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));
      for (let step = 0; step <= steps; step++) {
        const x = a.x + ((b.x - a.x) * step) / steps;
        const z = a.z + ((b.z - a.z) * step) / steps;
        const message = `${x},${z}`;
        expect(zoneAt(x, z)?.id, message).toBe(zone);
        expect(distanceToRoad(x, z, roads), message).toBeLessThan(0.01);
        // The wagon and paired horses need more space than a humanoid's
        // collision radius, including along the narrow Fenway crossing.
        if (isBlocked(WORLD_SEED, x, z, 1.2)) problems.push(`blocked ${message}`);
        if (terrainHeight(x, z, WORLD_SEED) <= WATER_LEVEL + 1) problems.push(`wet ${message}`);
        expect(Math.hypot(x - quest.area.x, z - quest.area.z), message).toBeLessThan(
          quest.area.radius,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('walks every waypoint with real world collision, never accepting a stuck shortcut', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    const pid = sim.addPlayer('warrior', 'Road tester');
    const guard = sim.entities.get(pid);
    const meta = sim.meta(pid);
    if (!guard || !meta) throw new Error('Missing road tester');
    guard.level = 10;
    meta.devWorldQuestCycle = worldQuestCycleOfferingQuest('wq3_0', questId);
    guard.pos = sim.groundPos(def.start.x, def.start.z);
    guard.prevPos = { ...guard.pos };
    sim.tick();
    const state = sim.escortRuns.get(id);
    if (!state || state.npcId === null) throw new Error(`Missing caravan ${id}`);
    expect(state.npcId).not.toBeNull();
    const wagon = sim.entities.get(state.npcId);
    if (!wagon) throw new Error(`Missing wagon ${id}`);
    sim.interact(pid);
    expect(state.run).not.toBeNull();
    const visited: number[] = [];
    const speeches: string[] = [];
    let done = false;
    for (let tick = 0; tick < 180 * 20 && !done; tick++) {
      const run = state.run;
      if (!run) throw new Error(`Caravan ${id} stopped before completion`);
      const oldWaypoint = run.waypointIndex;
      const previous = { ...wagon.pos };
      const ambushers = run.ambushIds
        .map((entityId) => sim.entities.get(entityId))
        .filter((e): e is Entity => !!e && !e.dead);
      for (const mob of ambushers) {
        expect(isBlocked(WORLD_SEED, mob.pos.x, mob.pos.z, 0.55), `spawn ${mob.templateId}`).toBe(
          false,
        );
        expect(mob.pos.y, `wet spawn ${mob.templateId}`).toBeGreaterThan(WATER_LEVEL + 1);
        expect(mob.level).toBe(10);
        mob.hp = 0;
        mob.dead = true;
        mob.respawnTimer = 99_999;
      }
      guard.pos = sim.groundPos(wagon.pos.x, wagon.pos.z + 2);
      guard.prevPos = { ...guard.pos };
      const events = sim.tick();
      if (state.run && state.run.waypointIndex > oldWaypoint) {
        const target = def.waypoints[oldWaypoint];
        expect(
          Math.hypot(previous.x - target.x, previous.z - target.z),
          `waypoint ${oldWaypoint}`,
        ).toBeLessThanOrEqual(ESCORT_ARRIVE_RANGE);
        visited.push(oldWaypoint);
      }
      for (const event of events) {
        if (event.type === 'chat' && event.channel === 'yell' && event.entityId === wagon.id) {
          expect(event.from).toBe(story.speaker);
          speeches.push(event.text);
        }
        if (event.type === 'worldQuestDone' && event.questId === questId) done = true;
      }
    }
    expect(done).toBe(true);
    expect(visited).toEqual(def.waypoints.map((_, i) => i));
    for (const line of story.lines) expect(speeches).toContain(line.text);
    expect(speeches).toContain(def.successText);
    expect(meta.worldQuestLog.get(questId)?.state).toBe('completed');
    expect(state.npcId).toBeNull();
  }, 60_000);
});

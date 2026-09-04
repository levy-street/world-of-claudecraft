import { describe, expect, it, vi } from 'vitest';
import { isBlocked, resolveMovement } from '../src/sim/colliders';
import { dealDamage } from '../src/sim/combat/damage';
import {
  BUILTIN_WORLD,
  ESCORTS,
  GATHER_NODES,
  ITEMS,
  MOBS,
  NPCS,
  PLAYER_START,
  QUESTS,
  WORLD_QUESTS,
  WORLD_QUESTS_BY_ID,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import { MAX_AGGRO_RADIUS, MAX_WANDER_RADIUS } from '../src/sim/mob/aggro_ranges';
import { summonMountItem } from '../src/sim/mounts';
import { findPlayerPath, PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { moveSpeedMult } from '../src/sim/player_motion';
import { interactObjectCreditKey } from '../src/sim/quests/interact_object_credit';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  INTERACT_RANGE,
  STABLE_GROUND_OBJECT_ENTITY_ID_MIN,
  type WorldContent,
  type WorldQuestDef,
} from '../src/sim/types';
import {
  groundHeight,
  roadDistance,
  terrainHeight,
  terrainSteepnessAt,
  waterLevel,
} from '../src/sim/world';
import { hasWorldQuestDeliveryCargo } from '../src/sim/world_quest_delivery';
import { applyWorldQuestMatch3Move } from '../src/sim/world_quest_match3';
import { worldQuestSalvageLayout } from '../src/sim/world_quest_salvage';
import {
  activeWorldQuestsForCycle,
  onMobKilledForWorldQuests,
  onNodeGatheredForWorldQuests,
  sanitizeWorldQuestCycle,
  sanitizeWorldQuestProgress,
  updateWorldQuests,
  worldQuestCycleForResetDay,
  worldQuestRewardAmount,
} from '../src/sim/world_quests';
import { WORLD_SEED } from '../src/sim/world_seed';

function enterQuest(sim: Sim, quest: WorldQuestDef, level = quest.minLevel): void {
  sim.setPlayerLevel(level);
  sim.utcDay = '2026-08-31';
  sim.resetDay = '2026-08-31';
  const player = sim.player;
  player.pos.x = quest.area.x;
  player.pos.z = quest.area.z;
  player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
  sim.tick();
}

function targetFor(sim: Sim, quest: WorldQuestDef): Entity {
  if (quest.objective.type !== 'kill') throw new Error(`Expected kill objective ${quest.id}`);
  const targetMobId = quest.objective.targetMobId;
  const target = [...sim.entities.values()].find(
    (entity) => entity.kind === 'mob' && entity.templateId === targetMobId,
  );
  if (!target) throw new Error(`Missing target ${targetMobId}`);
  target.pos.x = quest.area.x;
  target.pos.z = quest.area.z;
  return target;
}

function finishQuest(sim: Sim, quest: WorldQuestDef): void {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('Missing player meta');
  if (quest.objective.type === 'gather') {
    const nodeType = quest.objective.nodeType;
    const nodes = GATHER_NODES.filter((node) => {
      const dx = node.pos.x - quest.area.x;
      const dz = node.pos.z - quest.area.z;
      return node.type === nodeType && dx * dx + dz * dz <= quest.area.radius ** 2;
    });
    for (let i = 0; i < quest.count; i++) {
      const node = nodes[i];
      if (!node) throw new Error(`Missing gather node ${i} for ${quest.id}`);
      onNodeGatheredForWorldQuests(sim.ctx, node, meta);
    }
    return;
  }
  if (quest.objective.type === 'match3') {
    const progress = sim.worldQuestLog.get(quest.id);
    const variant = progress?.puzzleVariant ?? 0;
    const level = quest.objective.levels[variant];
    const activationObjectItemId = quest.objective.activationObjectItemId;
    const activator = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === activationObjectItemId,
    );
    if (!progress || !level || !activator) throw new Error(`Missing match-three state ${quest.id}`);
    sim.player.pos.x = activator.pos.x;
    sim.player.pos.z = activator.pos.z;
    expect(sim.pickUpObject(activator.id)).toBe(true);
    let board = [...level.board];
    let refillIndex = 0;
    for (let move = 0; move < level.maxMoves && progress.state === 'active'; move++) {
      let best:
        | {
            from: number;
            to: number;
            result: ReturnType<typeof applyWorldQuestMatch3Move>;
          }
        | undefined;
      for (let from = 0; from < board.length; from++) {
        for (const to of [from + 1, from + level.columns]) {
          const result = applyWorldQuestMatch3Move(level, board, from, to, refillIndex);
          if (!result.accepted) continue;
          if (!best || result.cleared > best.result.cleared) best = { from, to, result };
        }
      }
      if (!best) break;
      sim.swapWorldQuestMatch3Tiles(quest.id, best.from, best.to);
      board = best.result.board;
      refillIndex = best.result.refillIndex;
    }
    return;
  }
  if (quest.objective.type === 'delivery') {
    const objective = quest.objective;
    const pickup = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === objective.pickupObjectItemId,
    );
    const destination = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === objective.deliveryObjectItemId,
    );
    if (!pickup || !destination) throw new Error(`Missing delivery objects for ${quest.id}`);
    for (let i = 0; i < quest.count; i++) {
      sim.player.pos.x = pickup.pos.x;
      sim.player.pos.z = pickup.pos.z;
      expect(sim.pickUpObject(pickup.id)).toBe(true);
      sim.player.pos.x = destination.pos.x;
      sim.player.pos.z = destination.pos.z;
      expect(sim.pickUpObject(destination.id)).toBe(true);
    }
    return;
  }
  if (quest.objective.type === 'salvage') {
    const progress = sim.worldQuestLog.get(quest.id);
    if (!progress) throw new Error(`Missing salvage state ${quest.id}`);
    for (const entityId of worldQuestSalvageLayout(quest, progress, sim.worldQuestCycle)) {
      const object = sim.entities.get(entityId);
      if (!object) throw new Error(`Missing salvage object ${entityId}`);
      sim.player.pos = { ...object.pos };
      expect(sim.pickUpObject(object.id)).toBe(true);
    }
    return;
  }
  if (quest.objective.type === 'escort') {
    throw new Error(`Escort ${quest.id} must complete through its live route`);
  }
  const target = targetFor(sim, quest);
  for (let i = 0; i < quest.count; i++) onMobKilledForWorldQuests(sim.ctx, target, meta);
}

describe('world quest content', () => {
  it('authors level 10 objectives in every shipped map over enough live targets', () => {
    const freight = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const recovery = WORLD_QUESTS_BY_ID.wq_frostveil_howlers;
    const puzzle = WORLD_QUESTS_BY_ID.wq_galecrest_wisps;
    const match3 = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    const salvage = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
    const caravan = WORLD_QUESTS_BY_ID.wq_eastbrook_caravan;
    expect(freight.count).toBe(6);
    expect(freight.objective).toEqual({
      type: 'delivery',
      pickupObjectItemId: 'eastbrook_freight_crate',
      deliveryObjectItemId: 'eastbrook_freight_wagon',
    });
    expect(recovery.count).toBe(4);
    expect(puzzle.objective.type).toBe('puzzle');
    if (puzzle.objective.type !== 'puzzle') throw new Error('Expected puzzle fixture');
    expect(puzzle.objective.puzzles).toHaveLength(3);
    expect(puzzle.objective.puzzles[0].columns).toBe(3);
    expect(puzzle.objective.puzzles[0].rows).toBe(3);
    expect(puzzle.objective.puzzles[0].tiles).toHaveLength(9);
    expect(match3.objective.type).toBe('match3');
    if (match3.objective.type !== 'match3') throw new Error('Expected match-three fixture');
    expect(match3.objective.levels).toHaveLength(3);
    expect(match3.count).toBe(72);
    expect(match3.objective.levels.map((level) => level.target)).toEqual([72, 72, 72]);
    expect(match3.objective.levels.map((level) => level.maxMoves)).toEqual([20, 17, 14]);
    expect(salvage.count).toBe(8);
    expect(salvage.objective.type).toBe('salvage');
    if (salvage.objective.type !== 'salvage') throw new Error('Expected salvage fixture');
    expect(salvage.objective.layouts).toHaveLength(3);
    expect(caravan.objective).toEqual({
      type: 'escort',
      escortId: 'esc_wq_eastbrook_caravan',
    });
    expect(new Set(WORLD_QUESTS.map((quest) => quest.id)).size).toBe(WORLD_QUESTS.length);
    expect(new Set(WORLD_QUESTS.map((quest) => quest.zoneId))).toEqual(
      new Set(ZONES.map((zone) => zone.id)),
    );
    const sim = new Sim({ seed: 123, playerClass: 'warrior', noPlayer: true });
    const zoneFrequency = new Map<string, number>();
    for (const quest of WORLD_QUESTS) {
      zoneFrequency.set(quest.zoneId, (zoneFrequency.get(quest.zoneId) ?? 0) + 1);
      expect(quest.minLevel, quest.id).toBe(10);
      expect(zoneAt(quest.area.x, quest.area.z).id, quest.id).toBe(quest.zoneId);
      if (quest.objective.type === 'kill') {
        const targetMobId = quest.objective.targetMobId;
        const population = [...sim.entities.values()].filter((entity) => {
          const dx = entity.pos.x - quest.area.x;
          const dz = entity.pos.z - quest.area.z;
          return entity.templateId === targetMobId && dx * dx + dz * dz <= quest.area.radius ** 2;
        }).length;
        expect(population, quest.id).toBeGreaterThanOrEqual(quest.count);
      } else if (quest.objective.type === 'gather') {
        const nodeType = quest.objective.nodeType;
        const nodes = GATHER_NODES.filter((node) => {
          const dx = node.pos.x - quest.area.x;
          const dz = node.pos.z - quest.area.z;
          return node.type === nodeType && dx * dx + dz * dz <= quest.area.radius ** 2;
        });
        expect(nodes.length, quest.id).toBeGreaterThanOrEqual(quest.count);
      } else if (quest.objective.type === 'interact') {
        const targetObjectItemId = quest.objective.targetObjectItemId;
        const objects = [...sim.entities.values()].filter((entity) => {
          const dx = entity.pos.x - quest.area.x;
          const dz = entity.pos.z - quest.area.z;
          return (
            entity.objectItemId === targetObjectItemId &&
            dx * dx + dz * dz <= quest.area.radius ** 2
          );
        });
        expect(objects.length, quest.id).toBeGreaterThanOrEqual(quest.count);
      } else if (quest.objective.type === 'delivery') {
        const objective = quest.objective;
        const pickup = [...sim.entities.values()].find(
          (entity) => entity.objectItemId === objective.pickupObjectItemId,
        );
        const destination = [...sim.entities.values()].find(
          (entity) => entity.objectItemId === objective.deliveryObjectItemId,
        );
        expect(pickup, `${quest.id} pickup`).toBeDefined();
        expect(destination, `${quest.id} destination`).toBeDefined();
      } else if (quest.objective.type === 'puzzle') {
        for (const level of quest.objective.puzzles) {
          expect(level.tiles).toHaveLength(level.columns * level.rows);
        }
      } else if (quest.objective.type === 'salvage') {
        expect(quest.objective.layouts).toHaveLength(3);
        for (const layout of quest.objective.layouts) {
          expect(layout).toHaveLength(quest.count);
          for (const entityId of layout) {
            const object = sim.entities.get(entityId);
            expect(object, `${quest.id} object ${entityId}`).toBeDefined();
            expect(object?.objectItemId).toBe(quest.objective.objectItemId);
            expect(
              Math.hypot((object?.pos.x ?? 0) - quest.area.x, (object?.pos.z ?? 0) - quest.area.z) +
                INTERACT_RANGE,
              `${quest.id} object ${entityId}`,
            ).toBeLessThanOrEqual(quest.area.radius);
          }
        }
      } else if (quest.objective.type === 'match3') {
        for (const level of quest.objective.levels) {
          expect(level.board).toHaveLength(level.columns * level.rows);
          expect(level.target).toBe(quest.count);
        }
      } else if (quest.objective.type === 'escort') {
        const escort = ESCORTS[quest.objective.escortId];
        expect(escort, `${quest.id} escort`).toBeDefined();
        expect(escort?.worldQuestId).toBe(quest.id);
        expect(escort?.waypoints.length).toBeGreaterThan(0);
      }
      if (quest.objective.type === 'puzzle' || quest.objective.type === 'match3') {
        const activationObjectItemId = quest.objective.activationObjectItemId;
        const activators = [...sim.entities.values()].filter(
          (entity) => entity.objectItemId === activationObjectItemId,
        );
        expect(activators, quest.id).toHaveLength(1);
        const activator = activators[0];
        expect(
          (activator.pos.x - quest.area.x) ** 2 + (activator.pos.z - quest.area.z) ** 2,
          quest.id,
        ).toBeLessThanOrEqual(quest.area.radius ** 2);
      }
      expect(Object.hasOwn(QUESTS, quest.id), quest.id).toBe(false);
      expect(
        Object.values(NPCS).some((npc) => npc.questIds.includes(quest.id)),
        quest.id,
      ).toBe(false);
      if (quest.reward.type === 'item') expect(ITEMS[quest.reward.itemId], quest.id).toBeDefined();
    }
    expect([...zoneFrequency.values()].every((count) => count >= 1)).toBe(true);
    expect(zoneFrequency.get('eastbrook_vale')).toBe(2);
  });

  it('places both minigame activators on safe, walkable ground outside hostile aggro', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
    });
    const expectedPositions = new Map([
      ['wq_galecrest_wisps', { x: 420, z: 330 }],
      ['wq_palmreach_confections', { x: -325, z: 820 }],
    ]);

    for (const [questId, expected] of expectedPositions) {
      const quest = WORLD_QUESTS_BY_ID[questId];
      if (quest.objective.type !== 'puzzle' && quest.objective.type !== 'match3') {
        throw new Error(`Expected minigame fixture ${questId}`);
      }
      const activationObjectItemId = quest.objective.activationObjectItemId;
      const activator = [...sim.entities.values()].find(
        (entity) => entity.objectItemId === activationObjectItemId,
      );
      if (!activator) throw new Error(`Missing activator for ${questId}`);

      expect({ x: activator.pos.x, z: activator.pos.z }, questId).toEqual(expected);
      expect({ x: quest.area.x, z: quest.area.z }, questId).toEqual(expected);
      expect(isBlocked(WORLD_SEED, expected.x, expected.z, PLAYER_BODY_RADIUS), questId).toBe(
        false,
      );
      expect(terrainSteepnessAt(expected.x, expected.z, WORLD_SEED), questId).toBeLessThanOrEqual(
        PLAYER_MAX_CLIMB_SLOPE,
      );
      expect(
        groundHeight(expected.x, expected.z, WORLD_SEED) - waterLevel(),
        questId,
      ).toBeGreaterThanOrEqual(1);
      expect(roadDistance(expected.x, expected.z), questId).toBeGreaterThanOrEqual(5);

      const hostileSafetyClearance = Math.min(
        ...[...sim.entities.values()]
          .filter((entity) => entity.kind === 'mob' && !entity.dead)
          .map((entity) => {
            const baseAggroRadius = MOBS[entity.templateId ?? '']?.aggroRadius ?? 0;
            const effectiveAggroRadius = Math.max(
              4,
              Math.min(MAX_AGGRO_RADIUS, baseAggroRadius + (entity.level - quest.minLevel) * 1.5),
            );
            return (
              Math.hypot(entity.spawnPos.x - expected.x, entity.spawnPos.z - expected.z) -
              effectiveAggroRadius -
              MAX_WANDER_RADIUS
            );
          }),
      );
      expect(hostileSafetyClearance, questId).toBeGreaterThan(30);

      const zone = ZONES.find((candidate) => candidate.id === quest.zoneId);
      if (!zone) throw new Error(`Missing zone for ${questId}`);
      const route = findPlayerPath(WORLD_SEED, zone.hub, expected);
      let current = { x: zone.hub.x, z: zone.hub.z };
      let waypointIndex = 0;
      let stalledSteps = 0;
      for (
        let step = 0;
        step < 2_000 && Math.hypot(expected.x - current.x, expected.z - current.z) > 0.2;
        step++
      ) {
        while (
          waypointIndex < route.length - 1 &&
          Math.hypot(route[waypointIndex].x - current.x, route[waypointIndex].z - current.z) <= 0.25
        ) {
          waypointIndex++;
        }
        const waypoint = route[waypointIndex] ?? expected;
        const dx = waypoint.x - current.x;
        const dz = waypoint.z - current.z;
        const distance = Math.max(Math.hypot(dx, dz), Number.EPSILON);
        const stride = Math.min(0.2, distance);
        const next = resolveMovement(
          WORLD_SEED,
          current.x,
          current.z,
          current.x + (dx / distance) * stride,
          current.z + (dz / distance) * stride,
          PLAYER_BODY_RADIUS,
        );
        const moved = Math.hypot(next.x - current.x, next.z - current.z);
        stalledSteps = moved < 1e-4 ? stalledSteps + 1 : 0;
        current = next;
        if (stalledSteps > 20) break;
      }
      expect(
        Math.hypot(expected.x - current.x, expected.z - current.z),
        questId,
      ).toBeLessThanOrEqual(0.2);
    }
  });

  it('places the freight yard on safe walkable ground outside roads and hostile aggro', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    if (quest.objective.type !== 'delivery') throw new Error('Expected delivery fixture');
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      noPlayer: true,
    });
    const expected = new Map([
      [quest.objective.pickupObjectItemId, { x: -63, z: -90 }],
      [quest.objective.deliveryObjectItemId, { x: -80, z: -82 }],
    ]);

    for (const [itemId, position] of expected) {
      const object = [...sim.entities.values()].find((entity) => entity.objectItemId === itemId);
      expect(object, itemId).toBeDefined();
      expect(object?.pos, itemId).toMatchObject(position);
      expect(isBlocked(WORLD_SEED, position.x, position.z, PLAYER_BODY_RADIUS), itemId).toBe(false);
      expect(terrainSteepnessAt(position.x, position.z, WORLD_SEED), itemId).toBeLessThanOrEqual(
        PLAYER_MAX_CLIMB_SLOPE,
      );
      expect(
        groundHeight(position.x, position.z, WORLD_SEED) - waterLevel(),
        itemId,
      ).toBeGreaterThanOrEqual(1);
      expect(roadDistance(position.x, position.z), itemId).toBeGreaterThanOrEqual(5);
      expect(
        Math.hypot(position.x - quest.area.x, position.z - quest.area.z) + INTERACT_RANGE,
        `${itemId} interaction clearance`,
      ).toBeLessThanOrEqual(quest.area.radius);
    }

    const hostileSafetyClearance = Math.min(
      ...[...sim.entities.values()]
        .filter((entity) => entity.kind === 'mob' && !entity.dead)
        .map((entity) => {
          const baseAggroRadius = MOBS[entity.templateId ?? '']?.aggroRadius ?? 0;
          const effectiveAggroRadius = Math.max(
            4,
            Math.min(MAX_AGGRO_RADIUS, baseAggroRadius + (entity.level - quest.minLevel) * 1.5),
          );
          return (
            Math.hypot(entity.spawnPos.x - quest.area.x, entity.spawnPos.z - quest.area.z) -
            effectiveAggroRadius -
            MAX_WANDER_RADIUS
          );
        }),
    );
    expect(hostileSafetyClearance).toBeGreaterThan(30);

    const pickupPosition = expected.get(quest.objective.pickupObjectItemId);
    const destinationPosition = expected.get(quest.objective.deliveryObjectItemId);
    if (!pickupPosition || !destinationPosition) throw new Error('Missing freight route anchors');
    expect(
      Math.hypot(
        pickupPosition.x - destinationPosition.x,
        pickupPosition.z - destinationPosition.z,
      ),
    ).toBeGreaterThanOrEqual(18);
    for (const [from, to, label] of [
      [PLAYER_START, pickupPosition, 'Eastbrook start to crates'],
      [pickupPosition, destinationPosition, 'crates to wagon'],
    ] as const) {
      let current = { x: from.x, z: from.z };
      for (const waypoint of findPlayerPath(WORLD_SEED, from, to, 128)) {
        current = resolveMovement(
          WORLD_SEED,
          current.x,
          current.z,
          waypoint.x,
          waypoint.z,
          PLAYER_BODY_RADIUS,
        );
      }
      expect(Math.hypot(to.x - current.x, to.z - current.z), label).toBeLessThanOrEqual(0.2);
    }
  });

  it('places every rotating salvage layout on a quiet natural shoreline', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
    if (quest.objective.type !== 'salvage') throw new Error('Expected salvage fixture');
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });

    for (const entityId of quest.objective.layouts.flat()) {
      const object = sim.entities.get(entityId);
      if (!object) throw new Error(`Missing salvage object ${entityId}`);
      expect(zoneAt(object.pos.x, object.pos.z).id, `${entityId} zone`).toBe('farshore_isle');
      expect(
        groundHeight(object.pos.x, object.pos.z, WORLD_SEED) -
          terrainHeight(object.pos.x, object.pos.z, WORLD_SEED),
        `${entityId} structure lift`,
      ).toBeLessThanOrEqual(0.01);
      expect(isBlocked(WORLD_SEED, object.pos.x, object.pos.z, PLAYER_BODY_RADIUS)).toBe(false);
      expect(
        terrainSteepnessAt(object.pos.x, object.pos.z, WORLD_SEED),
        `${entityId} slope`,
      ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
      expect(groundHeight(object.pos.x, object.pos.z, WORLD_SEED) - waterLevel()).toBeGreaterThan(
        1,
      );

      const hostileSafetyClearance = Math.min(
        ...[...sim.entities.values()]
          .filter((entity) => entity.kind === 'mob' && !entity.dead)
          .map((entity) => {
            const baseAggroRadius = MOBS[entity.templateId ?? '']?.aggroRadius ?? 0;
            const effectiveAggroRadius = Math.max(
              4,
              Math.min(MAX_AGGRO_RADIUS, baseAggroRadius + (entity.level - quest.minLevel) * 1.5),
            );
            return (
              Math.hypot(entity.spawnPos.x - object.pos.x, entity.spawnPos.z - object.pos.z) -
              effectiveAggroRadius -
              MAX_WANDER_RADIUS
            );
          }),
      );
      expect(hostileSafetyClearance, `${entityId} hostile clearance`).toBeGreaterThan(70);
    }
  });
});

describe('world quest lifecycle', () => {
  it('caches the active rotation and refreshes it only when the reset day changes', () => {
    const sim = new Sim({ seed: 409, playerClass: 'warrior', autoEquip: true });
    sim.resetDay = '2026-08-31';
    const first = sim.ctx.currentWorldQuestRotation();
    expect(sim.ctx.currentWorldQuestRotation()).toBe(first);
    expect(first.quests.map((quest) => quest.id)).toEqual(
      activeWorldQuestsForCycle(first.cycle).map((quest) => quest.id),
    );

    sim.resetDay = '2026-09-03';
    const next = sim.ctx.currentWorldQuestRotation();
    expect(next).not.toBe(first);
    expect(next.cycle).not.toBe(first.cycle);
  });

  it('consumes the cached realm rotation directly during the player tick', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const sim = new Sim({ seed: 409, playerClass: 'warrior', autoEquip: true });
    sim.resetDay = '2026-08-31';
    sim.setPlayerLevel(quest.minLevel);
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.player.pos.y = terrainHeight(quest.area.x, quest.area.z, sim.cfg.seed);
    const cycle = sim.ctx.currentWorldQuestRotation().cycle;
    const rotation = vi
      .spyOn(sim.ctx, 'currentWorldQuestRotation')
      .mockReturnValue({ cycle, quests: [] });

    sim.tick();

    expect(rotation).toHaveBeenCalledTimes(1);
    expect(sim.worldQuestLog.size).toBe(0);
  });

  it('accepts stable ground-object ids only from the reserved high range', () => {
    const worldWith = (entityIds: readonly number[]): WorldContent => ({
      ...BUILTIN_WORLD,
      camps: [],
      npcs: {},
      services: undefined,
      groundObjects: [
        {
          itemId: 'leyline_cache',
          name: 'Test cache',
          positions: entityIds.map((_, index) => ({ x: index, z: 0 })),
          entityIds,
        },
      ],
    });

    expect(
      () =>
        new Sim({
          seed: 1,
          playerClass: 'warrior',
          noPlayer: true,
          world: worldWith([STABLE_GROUND_OBJECT_ENTITY_ID_MIN - 1]),
        }),
    ).toThrow('Invalid or duplicate stable ground object entity id');
    expect(
      () =>
        new Sim({
          seed: 1,
          playerClass: 'warrior',
          noPlayer: true,
          world: worldWith([
            STABLE_GROUND_OBJECT_ENTITY_ID_MIN,
            STABLE_GROUND_OBJECT_ENTITY_ID_MIN,
          ]),
        }),
    ).toThrow('Invalid or duplicate stable ground object entity id');

    const valid = new Sim({
      seed: 1,
      playerClass: 'warrior',
      noPlayer: true,
      world: worldWith([STABLE_GROUND_OBJECT_ENTITY_ID_MIN]),
    });
    expect(valid.entities.get(STABLE_GROUND_OBJECT_ENTITY_ID_MIN)?.objectItemId).toBe(
      'leyline_cache',
    );
  });

  it('rotates a deterministic five-quest selection every three reset days', () => {
    const firstCycle = worldQuestCycleForResetDay('2026-08-31');
    expect(firstCycle).toBe(worldQuestCycleForResetDay('2026-09-01'));
    expect(firstCycle).toBe(worldQuestCycleForResetDay('2026-09-02'));
    const nextCycle = worldQuestCycleForResetDay('2026-09-03');
    expect(nextCycle).not.toBe(firstCycle);

    const firstIds = activeWorldQuestsForCycle(firstCycle).map((quest) => quest.id);
    const nextIds = activeWorldQuestsForCycle(nextCycle).map((quest) => quest.id);
    expect(firstIds).toHaveLength(5);
    expect(new Set(firstIds).size).toBe(5);
    expect(nextIds).toHaveLength(5);
    expect(nextIds).not.toEqual(firstIds);
    expect(activeWorldQuestsForCycle(firstCycle).map((quest) => quest.id)).toEqual(firstIds);

    const thirdIds = activeWorldQuestsForCycle(worldQuestCycleForResetDay('2026-09-06')).map(
      (quest) => quest.id,
    );
    const fourthIds = activeWorldQuestsForCycle(worldQuestCycleForResetDay('2026-09-09')).map(
      (quest) => quest.id,
    );
    const fifthIds = activeWorldQuestsForCycle(worldQuestCycleForResetDay('2026-09-12')).map(
      (quest) => quest.id,
    );
    const sixthIds = activeWorldQuestsForCycle(worldQuestCycleForResetDay('2026-09-15')).map(
      (quest) => quest.id,
    );
    expect(firstIds).toEqual([
      'wq_eastbrook_bandits',
      'wq_mirefen_gravecallers',
      'wq_palmreach_confections',
      'wq_evergarden_watch',
      'wq_galecrest_wisps',
    ]);
    expect(nextIds).toEqual([
      'wq_thornpeak_stormcrag',
      'wq_hollow_sporelings',
      'wq_drakelands_brood',
      'wq_frostveil_howlers',
      'wq_amberfall_lurkers',
    ]);
    expect(thirdIds).toEqual([
      'wq_willowfen_ore',
      'wq_nightbloom_barrow',
      'wq_wraithwood_restless',
      'wq_farshore_salvage',
      'wq_proving_shore_scuttlers',
    ]);
    expect(fourthIds).toEqual(['wq_eastbrook_caravan', ...firstIds.slice(1)]);
    expect(fifthIds).toEqual([...nextIds.slice(0, 3), 'wq_frostveil_caravan', nextIds[4]]);
    expect(sixthIds).toEqual(['wq_willowfen_caravan', ...thirdIds.slice(1)]);
    const allRotatedIds = [
      ...firstIds,
      ...nextIds,
      ...thirdIds,
      ...fourthIds,
      ...fifthIds,
      ...sixthIds,
    ];
    expect(new Set(allRotatedIds)).toEqual(new Set(WORLD_QUESTS.map((quest) => quest.id)));
  });

  it('does not start a catalog quest outside the current five-quest rotation', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_thornpeak_stormcrag;
    const sim = new Sim({ seed: 410, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest);
    expect(activeWorldQuestsForCycle(sim.worldQuestCycle).some((row) => row.id === quest.id)).toBe(
      false,
    );
    expect(sim.worldQuestLog.has(quest.id)).toBe(false);
    expect(sim.drainEvents().some((event) => event.type === 'worldQuestStarted')).toBe(false);
  });

  it('stays unavailable below level 10 and starts automatically on area entry', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const sim = new Sim({ seed: 41, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest, 9);
    expect(sim.worldQuestLog.has(quest.id)).toBe(false);
    expect(sim.worldQuestCycle).toBe('');
    sim.setPlayerLevel(10);
    const events = sim.tick();
    expect(sim.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: 0,
      state: 'active',
    });
    expect(events).toContainEqual({
      type: 'worldQuestStarted',
      questId: quest.id,
      pid: sim.playerId,
    });
  });

  it('stays dormant in deterministic hosts that intentionally supply no calendar', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const sim = new Sim({ seed: 411, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;

    expect(sim.resetDay).toBe('');
    expect(sim.tick().some((event) => event.type === 'worldQuestStarted')).toBe(false);
    expect(sim.worldQuestCycle).toBe('');
    expect(sim.worldQuestLog.size).toBe(0);
  });

  it('credits only matching kills inside the active area', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_evergarden_watch;
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest);
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player meta');
    const target = targetFor(sim, quest);
    onMobKilledForWorldQuests(sim.ctx, target, meta);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);
    expect(meta.counters.questProgress).toBe(1);
    target.pos.x = quest.area.x + quest.area.radius + 1;
    onMobKilledForWorldQuests(sim.ctx, target, meta);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);
    target.pos.x = quest.area.x;
    target.templateId = 'forest_wolf';
    onMobKilledForWorldQuests(sim.ctx, target, meta);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('credits the three authored Willowfen ore nodes and completes the gather objective', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_willowfen_ore;
    if (quest.objective.type !== 'gather') throw new Error('Expected gather world quest fixture');
    const nodeType = quest.objective.nodeType;
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(quest.minLevel);
    sim.utcDay = '2026-09-06';
    sim.resetDay = '2026-09-06';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.player.pos.y = terrainHeight(quest.area.x, quest.area.z, sim.cfg.seed);
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player meta');
    const nodes = GATHER_NODES.filter(
      (node) =>
        node.type === nodeType &&
        (node.pos.x - quest.area.x) ** 2 + (node.pos.z - quest.area.z) ** 2 <=
          quest.area.radius ** 2,
    );

    expect(nodes).toHaveLength(quest.count);
    for (const node of nodes) onNodeGatheredForWorldQuests(sim.ctx, node, meta);

    expect(sim.worldQuestLog.get(quest.id)).toMatchObject({
      count: quest.count,
      state: 'completed',
    });
  });

  it('carries one personal freight crate at a time and banks only delivered progress', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const sim = new Sim({ seed: 422, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest);
    const meta = sim.meta(sim.playerId);
    if (!meta || quest.objective.type !== 'delivery') throw new Error('Missing delivery fixture');
    const objective = quest.objective;
    const pickup = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === objective.pickupObjectItemId,
    );
    const destination = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === objective.deliveryObjectItemId,
    );
    if (!pickup || !destination) throw new Error('Missing freight objects');

    // No standing point may reach both fixtures and replay the whole job without walking.
    sim.player.pos.x = (pickup.pos.x + destination.pos.x) / 2;
    sim.player.pos.z = (pickup.pos.z + destination.pos.z) / 2;
    expect(sim.pickUpObject(pickup.id)).toBe(false);
    expect(sim.pickUpObject(destination.id)).toBe(false);

    sim.player.pos = { ...destination.pos };
    expect(sim.pickUpObject(destination.id)).toBe(true);
    expect(sim.worldQuestLog.get(quest.id)).toMatchObject({ count: 0 });

    sim.player.pos = { ...pickup.pos };
    expect(sim.pickUpObject(pickup.id)).toBe(true);
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(true);
    expect(sim.pickUpObject(pickup.id)).toBe(true);
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(true);

    const stateWhileCarrying = sim.serializeCharacter(sim.playerId);
    expect(stateWhileCarrying?.worldQuests?.progress[0]).toEqual({
      questId: quest.id,
      count: 0,
      state: 'active',
    });

    sim.player.pos.x = quest.area.x + quest.area.radius + 5;
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: 0,
      state: 'active',
    });
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(false);

    sim.player.pos = { ...pickup.pos };
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.pickUpObject(pickup.id)).toBe(true);
    sim.player.pos = { ...destination.pos };
    expect(sim.pickUpObject(destination.id)).toBe(true);
    expect(sim.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: 1,
      state: 'active',
    });

    sim.player.pos = { ...pickup.pos };
    expect(sim.pickUpObject(pickup.id)).toBe(true);
    sim.player.pos.x = quest.area.x + quest.area.radius + 5;
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(false);
    expect(sim.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: 1,
      state: 'active',
    });
    sim.player.pos = { ...pickup.pos };
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);

    const otherPid = sim.addPlayer('warrior', 'Other Loader');
    const other = sim.entities.get(otherPid);
    const otherMeta = sim.meta(otherPid);
    if (!other || !otherMeta) throw new Error('Missing second player');
    other.level = quest.minLevel;
    other.pos = { ...pickup.pos };
    other.prevPos = { ...other.pos };
    updateWorldQuests(sim.ctx, otherMeta, other);
    expect(sim.pickUpObject(pickup.id, otherPid)).toBe(true);
    expect(hasWorldQuestDeliveryCargo(other)).toBe(true);
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(false);
  });

  it('makes freight public, foot-carried, and ephemeral across death and disconnect', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const sim = new Sim({ seed: 424, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest);
    if (quest.objective.type !== 'delivery') throw new Error('Missing delivery fixture');
    const objective = quest.objective;
    const pickup = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === objective.pickupObjectItemId,
    );
    const destination = [...sim.entities.values()].find(
      (entity) => entity.objectItemId === objective.deliveryObjectItemId,
    );
    const meta = sim.meta(sim.playerId);
    if (!pickup || !destination || !meta) throw new Error('Missing delivery player fixture');
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, sim.playerId, { silent: true });
    sim.player.pos = { ...pickup.pos };
    sim.player.mountKey = 'valorsteed';

    expect(sim.pickUpObject(pickup.id)).toBe(true);
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(true);
    expect(sim.player.mountKey).toBe('');
    expect(moveSpeedMult(sim.player)).toBe(0.75);
    expect(summonMountItem(sim.ctx, sim.playerId, 'valorsteed')).toBe(false);
    expect(
      sim
        .tick()
        .filter((event) => event.type === 'error')
        .map((event) => event.text),
    ).toContain("You can't ride while carrying freight.");

    sim.dropWorldQuestDeliveryCargo();
    sim.player.mountCastRemaining = 1;
    sim.player.mountCastKey = 'valorsteed';
    expect(sim.pickUpObject(pickup.id)).toBe(true);
    expect(sim.player.mountCastRemaining).toBe(0);
    expect(sim.player.mountCastKey).toBe('');

    // The public delegate is what the multiplayer socket-close path calls.
    expect(sim.dropWorldQuestDeliveryCargo()).toBe(true);
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(false);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(0);

    expect(sim.pickUpObject(pickup.id)).toBe(true);
    sim.player.pos = { ...destination.pos };
    expect(sim.pickUpObject(destination.id)).toBe(true);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);
    sim.player.pos = { ...pickup.pos };
    expect(sim.pickUpObject(pickup.id)).toBe(true);
    dealDamage(sim.ctx, sim.player, sim.player, 99_999, false, 'physical', 'Test Hazard', 'hit');
    expect(sim.player.dead).toBe(true);
    expect(hasWorldQuestDeliveryCargo(sim.player)).toBe(false);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('credits distinct recovered objects and restores their detached ledger', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_frostveil_howlers;
    const sim = new Sim({ seed: 423, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.resetDay = '2026-09-03';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.tick();
    const objects = [...sim.entities.values()].filter(
      (entity) =>
        entity.kind === 'object' &&
        quest.objective.type === 'interact' &&
        entity.objectItemId === quest.objective.targetObjectItemId,
    );
    expect(objects).toHaveLength(4);
    for (const object of objects.slice(0, 2)) {
      sim.player.pos.x = object.pos.x;
      sim.player.pos.z = object.pos.z;
      expect(sim.pickUpObject(object.id)).toBe(true);
    }
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(2);
    expect(sim.pickUpObject(objects[1].id)).toBe(true);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(2);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Missing serialized character');
    expect(state.worldQuests?.progress[0]?.creditedObjects).toHaveLength(2);
    for (const object of objects.slice(2)) {
      sim.player.pos.x = object.pos.x;
      sim.player.pos.z = object.pos.z;
      sim.pickUpObject(object.id);
    }
    expect(sim.worldQuestLog.get(quest.id)?.state).toBe('completed');
    expect(state.worldQuests?.progress[0]?.creditedObjects).toHaveLength(2);

    const restored = new Sim({
      seed: 423,
      playerClass: 'warrior',
      noPlayer: true,
    });
    restored.resetDay = '2026-09-03';
    const pid = restored.addPlayer('warrior', 'Trap Keeper', { state });
    const player = restored.entities.get(pid);
    const restoredMeta = restored.meta(pid);
    if (!player || !restoredMeta) throw new Error('Missing restored player');
    player.pos.x = quest.area.x;
    player.pos.z = quest.area.z;
    player.prevPos = { ...player.pos };
    restored.tick();
    expect(restoredMeta.worldQuestLog.get(quest.id)?.count).toBe(2);
    const restoredObjects = [...restored.entities.values()].filter(
      (entity) =>
        entity.kind === 'object' &&
        quest.objective.type === 'interact' &&
        entity.objectItemId === quest.objective.targetObjectItemId,
    );
    for (const object of restoredObjects.slice(0, 2)) {
      player.pos.x = object.pos.x;
      player.pos.z = object.pos.z;
      expect(restored.pickUpObject(object.id, pid)).toBe(true);
    }
    expect(restoredMeta.worldQuestLog.get(quest.id)?.count).toBe(2);
    for (const object of restoredObjects.slice(2)) {
      player.pos.x = object.pos.x;
      player.pos.z = object.pos.z;
      expect(restored.pickUpObject(object.id, pid)).toBe(true);
    }
    expect(restoredMeta.worldQuestLog.get(quest.id)?.state).toBe('completed');
  });

  it('keeps personal shipwreck salvage across leaving, re-entry, and a save restore', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
    const sim = new Sim({ seed: 425, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.resetDay = '2026-09-06';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.tick();
    const progress = sim.worldQuestLog.get(quest.id);
    if (!progress || quest.objective.type !== 'salvage') {
      throw new Error('Missing salvage progress fixture');
    }
    const layout = worldQuestSalvageLayout(quest, progress, sim.worldQuestCycle);
    const wrongLayoutId = quest.objective.layouts[(progress.puzzleVariant ?? 0) === 0 ? 1 : 0][0];
    const wrongObject = sim.entities.get(wrongLayoutId);
    if (!wrongObject) throw new Error('Missing rotated-out salvage object');
    sim.player.pos = { ...wrongObject.pos };
    expect(sim.pickUpObject(wrongObject.id)).toBe(true);
    expect(progress.count).toBe(0);

    for (const entityId of layout.slice(0, 3)) {
      const object = sim.entities.get(entityId);
      if (!object) throw new Error(`Missing salvage object ${entityId}`);
      sim.player.pos = { ...object.pos };
      expect(sim.pickUpObject(entityId)).toBe(true);
    }
    expect(progress.count).toBe(3);

    sim.player.pos.x = quest.area.x + quest.area.radius + 10;
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(progress.count).toBe(3);
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.player.prevPos = { ...sim.player.pos };
    expect(sim.tick().some((event) => event.type === 'worldQuestStarted')).toBe(false);
    expect(progress.count).toBe(3);

    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Missing salvage save');
    const restored = new Sim({ seed: 425, playerClass: 'warrior', noPlayer: true });
    restored.resetDay = '2026-09-06';
    const pid = restored.addPlayer('warrior', 'Wreck Salvager', { state });
    const restoredMeta = restored.meta(pid);
    const player = restored.entities.get(pid);
    if (!restoredMeta || !player) throw new Error('Missing restored salvage player');
    const restoredProgress = restoredMeta.worldQuestLog.get(quest.id);
    expect(restoredProgress).toMatchObject({ count: 3, state: 'active' });
    expect(restoredProgress?.creditedObjects).toHaveLength(3);
    expect(restoredProgress?.puzzleVariant).toBe(progress.puzzleVariant);

    for (const entityId of layout) {
      const object = restored.entities.get(entityId);
      if (!object) throw new Error(`Missing restored salvage object ${entityId}`);
      player.pos = { ...object.pos };
      expect(restored.pickUpObject(entityId, pid)).toBe(true);
    }
    expect(restoredProgress?.state).toBe('completed');
  });

  it.each([
    ['2026-09-15', 2],
    ['2026-10-03', 1],
  ] as const)(
    'persists and completes the non-default shipwreck layout for %s',
    (resetDay, variant) => {
      const quest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
      const sim = new Sim({ seed: 427 + variant, playerClass: 'warrior', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.resetDay = resetDay;
      sim.player.pos = { x: quest.area.x, y: 0, z: quest.area.z };
      sim.tick();
      const progress = sim.worldQuestLog.get(quest.id);
      if (!progress || quest.objective.type !== 'salvage') {
        throw new Error('Missing non-default salvage fixture');
      }
      expect(progress.puzzleVariant).toBe(variant);
      const layout = quest.objective.layouts[variant];
      const inactiveLayout =
        quest.objective.layouts[(variant + 1) % quest.objective.layouts.length];
      const inactive = sim.entities.get(inactiveLayout[0]);
      if (!inactive) throw new Error('Missing inactive salvage piece');
      sim.player.pos = { ...inactive.pos };
      expect(sim.pickUpObject(inactive.id)).toBe(true);
      expect(progress.count).toBe(0);

      const first = sim.entities.get(layout[0]);
      if (!first) throw new Error('Missing first salvage piece');
      sim.player.pos = { ...first.pos };
      expect(sim.pickUpObject(first.id)).toBe(true);

      const state = sim.serializeCharacter(sim.playerId);
      if (!state) throw new Error('Missing non-default salvage save');
      const restored = new Sim({
        seed: 427 + variant,
        playerClass: 'warrior',
        noPlayer: true,
      });
      restored.resetDay = resetDay;
      const pid = restored.addPlayer('warrior', 'Weekly Salvager', { state });
      const player = restored.entities.get(pid);
      const restoredProgress = restored.meta(pid)?.worldQuestLog.get(quest.id);
      if (!player || !restoredProgress) throw new Error('Missing restored weekly salvage fixture');
      expect(restoredProgress).toMatchObject({ count: 1, puzzleVariant: variant, state: 'active' });
      for (const entityId of layout) {
        const object = restored.entities.get(entityId);
        if (!object) throw new Error(`Missing weekly salvage object ${entityId}`);
        player.pos = { ...object.pos };
        expect(restored.pickUpObject(entityId, pid)).toBe(true);
      }
      expect(restoredProgress.state).toBe('completed');
    },
  );

  it("never leaks Farshore debris credit into Galecrest Dead Men's Cargo", () => {
    const quest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
    const sim = new Sim({ seed: 426, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.resetDay = '2026-09-06';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    sim.tick();
    const progress = sim.worldQuestLog.get(quest.id);
    const meta = sim.meta(sim.playerId);
    if (!progress || !meta || quest.objective.type !== 'salvage') {
      throw new Error('Missing salvage isolation fixture');
    }
    meta.questLog.set('q_gc_dead_mens_cargo', {
      questId: 'q_gc_dead_mens_cargo',
      counts: [0, 0],
      state: 'active',
    });
    const activeObject = sim.entities.get(
      worldQuestSalvageLayout(quest, progress, sim.worldQuestCycle)[0],
    );
    const rotatedObject = sim.entities.get(quest.objective.layouts[1][0]);
    if (!activeObject || !rotatedObject) throw new Error('Missing salvage objects');

    for (const object of [rotatedObject, activeObject]) {
      sim.player.pos = { ...object.pos };
      expect(sim.pickUpObject(object.id)).toBe(true);
      expect(meta.questLog.get('q_gc_dead_mens_cargo')?.counts).toEqual([0, 0]);
    }
    expect(progress.count).toBe(1);
  });

  it('keeps progress while outside and does not restart when the player re-enters', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_evergarden_watch;
    const sim = new Sim({ seed: 421, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest);
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player meta');
    onMobKilledForWorldQuests(sim.ctx, targetFor(sim, quest), meta);
    sim.drainEvents();

    sim.player.pos.x = quest.area.x + quest.area.radius + 20;
    sim.player.prevPos = { ...sim.player.pos };
    expect(sim.tick().some((event) => event.type === 'worldQuestStarted')).toBe(false);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);
    onMobKilledForWorldQuests(sim.ctx, targetFor(sim, quest), meta);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);

    sim.player.pos.x = quest.area.x;
    sim.player.prevPos = { ...sim.player.pos };
    expect(sim.tick().some((event) => event.type === 'worldQuestStarted')).toBe(false);
    expect(sim.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: 1,
      state: 'active',
    });
  });

  it('credits the real combat death path without a manual quest command', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_evergarden_watch;
    const sim = new Sim({ seed: 420, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest);
    const target = targetFor(sim, quest);
    target.hp = 1;

    dealDamage(sim.ctx, sim.player, target, 99_999, false, 'physical', 'Test Strike', 'hit');

    expect(target.dead).toBe(true);
    expect(sim.worldQuestLog.get(quest.id)?.count).toBe(1);
  });

  it('automatically grants XP that remains useful at maximum level', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const sim = new Sim({ seed: 43, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest, 20);
    const before = sim.lifetimeXp;
    finishQuest(sim, quest);
    expect(sim.worldQuestLog.get(quest.id)?.state).toBe('completed');
    expect(sim.meta(sim.playerId)?.counters.questsCompleted).toBe(1);
    if (quest.reward.type !== 'xp') throw new Error('Expected XP reward');
    expect(worldQuestRewardAmount(quest.reward, 20)).toBe(2_784);
    expect(sim.lifetimeXp - before).toBe(2_784);
  });

  it('automatically grants level-scaled copper and authored item rewards', () => {
    const goldQuest = WORLD_QUESTS_BY_ID.wq_mirefen_gravecallers;
    const goldSim = new Sim({
      seed: 44,
      playerClass: 'warrior',
      autoEquip: true,
    });
    enterQuest(goldSim, goldQuest, 10);
    const copperBefore = goldSim.copper;
    finishQuest(goldSim, goldQuest);
    if (goldQuest.reward.type !== 'copper') throw new Error('Expected copper reward');
    expect(worldQuestRewardAmount(goldQuest.reward, 10)).toBe(4_250);
    expect(worldQuestRewardAmount(goldQuest.reward, 20)).toBe(6_000);
    expect(goldSim.copper - copperBefore).toBe(4_250);

    const itemQuest = WORLD_QUESTS_BY_ID.wq_palmreach_confections;
    const itemSim = new Sim({
      seed: 45,
      playerClass: 'warrior',
      autoEquip: true,
    });
    enterQuest(itemSim, itemQuest, 20);
    const itemBefore = itemSim.countItem('rift_essence');
    finishQuest(itemSim, itemQuest);
    expect(itemSim.countItem('rift_essence') - itemBefore).toBe(1);
  });

  it('restores same-cycle progress and completion without restarting or paying twice', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_evergarden_watch;
    const sim = new Sim({ seed: 46, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest);
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player meta');
    onMobKilledForWorldQuests(sim.ctx, targetFor(sim, quest), meta);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Missing serialized character');
    expect(state.worldQuests).toEqual({
      cycle: worldQuestCycleForResetDay('2026-08-31'),
      progress: [{ questId: quest.id, count: 1, state: 'active' }],
    });

    const restored = new Sim({
      seed: 46,
      playerClass: 'warrior',
      noPlayer: true,
    });
    restored.resetDay = '2026-08-31';
    const pid = restored.addPlayer('warrior', 'Traveler', { state });
    const player = restored.entities.get(pid);
    if (!player) throw new Error('Missing restored player');
    player.pos.x = quest.area.x;
    player.pos.z = quest.area.z;
    player.prevPos = { ...player.pos };
    const events = restored.tick();
    expect(restored.meta(pid)?.worldQuestCycle).toBe(worldQuestCycleForResetDay('2026-08-31'));
    expect(restored.meta(pid)?.worldQuestLog.get(quest.id)).toEqual({
      questId: quest.id,
      count: 1,
      state: 'active',
    });
    expect(events.some((event) => event.type === 'worldQuestStarted')).toBe(false);
  });

  it('rolls only when the three-day realm rotation changes and is idempotent after completion', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_evergarden_watch;
    const sim = new Sim({ seed: 461, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest, 20);
    finishQuest(sim, quest);
    sim.drainEvents();
    const rewardAfterCompletion = sim.lifetimeXp;
    const completedAfterCompletion = sim.meta(sim.playerId)?.counters.questsCompleted;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player meta');
    onMobKilledForWorldQuests(sim.ctx, targetFor(sim, quest), meta);
    expect(sim.lifetimeXp).toBe(rewardAfterCompletion);
    expect(meta.counters.questsCompleted).toBe(completedAfterCompletion);
    expect(sim.drainEvents().some((event) => event.type === 'worldQuestDone')).toBe(false);

    sim.utcDay = '2026-09-01';
    updateWorldQuests(sim.ctx, meta, sim.player);
    expect(meta.worldQuestCycle).toBe(worldQuestCycleForResetDay('2026-08-31'));
    expect(meta.worldQuestLog.get(quest.id)?.state).toBe('completed');

    sim.resetDay = '2026-09-03';
    updateWorldQuests(sim.ctx, meta, sim.player);
    expect(meta.worldQuestCycle).toBe(worldQuestCycleForResetDay('2026-09-03'));
    expect(meta.worldQuestLog.has(quest.id)).toBe(false);
  });

  it('clears an expired rotation for a dead player and dirties the owner snapshot', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const sim = new Sim({
      seed: 4611,
      playerClass: 'warrior',
      autoEquip: true,
    });
    enterQuest(sim, quest, 20);
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player meta');
    const revision = meta.wireRev;
    sim.player.dead = true;
    sim.resetDay = '2026-09-03';

    const events = sim.tick();

    expect(meta.worldQuestCycle).toBe(worldQuestCycleForResetDay('2026-09-03'));
    expect(meta.worldQuestLog.size).toBe(0);
    expect(meta.wireRev).toBe(revision + 1);
    expect(events.some((event) => event.type === 'worldQuestStarted')).toBe(false);
  });

  it('keeps completion claims across a v0.41-style rollback save', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_mirefen_gravecallers;
    const sim = new Sim({ seed: 462, playerClass: 'warrior', autoEquip: true });
    enterQuest(sim, quest, 10);
    finishQuest(sim, quest);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Missing serialized character');
    const { worldQuests: _droppedByOldBinary, ...legacyResave } = state;

    const restored = new Sim({
      seed: 462,
      playerClass: 'warrior',
      noPlayer: true,
    });
    restored.resetDay = '2026-08-31';
    const pid = restored.addPlayer('warrior', 'Rollback Traveler', {
      state: legacyResave,
    });
    const restoredMeta = restored.meta(pid);
    if (!restoredMeta) throw new Error('Missing restored meta');
    const copper = restoredMeta.copper;
    expect(restoredMeta.worldQuestLog.get(quest.id)?.state).toBe('completed');
    onMobKilledForWorldQuests(restored.ctx, targetFor(restored, quest), restoredMeta);
    expect(restoredMeta.copper).toBe(copper);
  });

  it('normalizes legacy daily save cycles and claim tokens without paying twice', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_mirefen_gravecallers;
    const sim = new Sim({
      seed: 4621,
      playerClass: 'warrior',
      autoEquip: true,
    });
    enterQuest(sim, quest, 10);
    finishQuest(sim, quest);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Missing serialized character');
    state.worldQuests = {
      cycle: '2026-08-31',
      progress: [{ questId: quest.id, count: quest.count, state: 'completed' }],
    };
    state.unlockedMilestones = (state.unlockedMilestones ?? []).map((id) =>
      id.startsWith('__wq_claim__:') ? `__wq_claim__:2026-08-31:${quest.id}` : id,
    );

    const restored = new Sim({
      seed: 4621,
      playerClass: 'warrior',
      noPlayer: true,
    });
    restored.resetDay = '2026-08-31';
    const pid = restored.addPlayer('warrior', 'Legacy Traveler', { state });
    const meta = restored.meta(pid);
    if (!meta) throw new Error('Missing restored meta');
    const copper = meta.copper;
    expect(meta.worldQuestCycle).toBe(worldQuestCycleForResetDay('2026-08-31'));
    expect(meta.worldQuestLog.get(quest.id)?.state).toBe('completed');
    onMobKilledForWorldQuests(restored.ctx, targetFor(restored, quest), meta);
    expect(meta.copper).toBe(copper);
  });

  it('ignores malformed milestone values and persisted quests outside their rotation', () => {
    const inactive = WORLD_QUESTS_BY_ID.wq_thornpeak_stormcrag;
    const seed = new Sim({
      seed: 4622,
      playerClass: 'warrior',
      autoEquip: true,
    });
    seed.setPlayerLevel(20);
    const state = seed.serializeCharacter(seed.playerId);
    if (!state) throw new Error('Missing serialized character');
    state.worldQuests = {
      cycle: '2026-08-31',
      progress: [{ questId: inactive.id, count: inactive.count - 1, state: 'active' }],
    };
    state.unlockedMilestones = [42, 'ordinary_milestone'] as unknown as string[];

    const restored = new Sim({
      seed: 4622,
      playerClass: 'warrior',
      noPlayer: true,
    });
    restored.resetDay = '2026-08-31';
    const pid = restored.addPlayer('warrior', 'Hardened Traveler', { state });
    const meta = restored.meta(pid);
    const player = restored.entities.get(pid);
    if (!meta || !player) throw new Error('Missing restored player');
    player.pos.x = inactive.area.x;
    player.pos.z = inactive.area.z;
    const before = meta.counters.questsCompleted;
    expect(meta.worldQuestLog.has(inactive.id)).toBe(false);
    expect(() =>
      onMobKilledForWorldQuests(restored.ctx, targetFor(restored, inactive), meta),
    ).not.toThrow();
    expect(meta.counters.questsCompleted).toBe(before);
  });

  it('uses no shared RNG draws for start, credit, reward, or rollover', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_eastbrook_bandits;
    const sim = new Sim({ seed: 463, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.resetDay = '2026-08-31';
    sim.player.pos.x = quest.area.x;
    sim.player.pos.z = quest.area.z;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('Missing player meta');
    let draws = 0;
    sim.rng.setObserver(() => draws++);
    updateWorldQuests(sim.ctx, meta, sim.player);
    finishQuest(sim, quest);
    sim.resetDay = '2026-09-01';
    updateWorldQuests(sim.ctx, meta, sim.player);
    sim.rng.setObserver(null);
    expect(draws).toBe(0);
  });

  it('bounds and catalog-filters untrusted persisted progress and cycles', () => {
    expect(
      sanitizeWorldQuestProgress(
        [
          { questId: 'missing', count: 99, state: 'completed' },
          { questId: 'constructor', count: 1, state: 'completed' },
          { questId: 'wq_eastbrook_bandits', count: 99, state: 'active' },
          { questId: 'wq_eastbrook_bandits', count: 1, state: 'completed' },
        ],
        'wq3_0',
      ),
    ).toEqual([{ questId: 'wq_eastbrook_bandits', count: 5, state: 'active' }]);
    expect(
      sanitizeWorldQuestProgress(
        [
          {
            questId: 'wq_eastbrook_bandits',
            count: Number.POSITIVE_INFINITY,
            state: 'active',
          },
          { questId: 'wq_mirefen_gravecallers', count: -4, state: 'completed' },
          { questId: 'wq_thornpeak_stormcrag', count: 2, state: 'future' },
        ],
        'wq3_0',
      ),
    ).toEqual([
      { questId: 'wq_eastbrook_bandits', count: 0, state: 'active' },
      { questId: 'wq_mirefen_gravecallers', count: 6, state: 'completed' },
    ]);
    expect(sanitizeWorldQuestCycle('2026-08-31')).toBe('wq3_0');
    expect(sanitizeWorldQuestCycle('wq3_000')).toBe('wq3_0');
    expect(sanitizeWorldQuestCycle('x'.repeat(32))).toBe('');
    expect(sanitizeWorldQuestCycle(`wq3_${'1'.repeat(64)}`)).toBe('');
    expect(sanitizeWorldQuestCycle(null)).toBe('');

    const hostilePrefix = Array.from({ length: WORLD_QUESTS.length * 4 }, () => ({
      questId: 'missing',
      count: 1,
      state: 'active',
    }));
    expect(
      sanitizeWorldQuestProgress(
        [...hostilePrefix, { questId: 'wq_eastbrook_bandits', count: 1, state: 'active' }],
        'wq3_0',
      ),
    ).toEqual([]);
    expect(
      sanitizeWorldQuestProgress(
        [
          {
            questId: 'wq_frostveil_howlers',
            count: 2,
            state: 'active',
            creditedObjects: [
              interactObjectCreditKey(0, { x: 1, z: 2 }),
              interactObjectCreditKey(0, { x: 3, z: 4 }),
              interactObjectCreditKey(0, { x: 5, z: 6 }),
              interactObjectCreditKey(0, { x: 7, z: 8 }),
            ],
          },
        ],
        'wq3_1',
      ),
    ).toEqual([
      {
        questId: 'wq_frostveil_howlers',
        count: 2,
        state: 'active',
        creditedObjects: ['0@1.0,2.0', '0@3.0,4.0'],
      },
    ]);
  });
});

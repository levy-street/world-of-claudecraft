// Studio-movable gameplay objects (src/sim/moved_objects.ts): farm beds,
// practice dummies, gather nodes and dungeon doors keep their ids and spawn
// slots and only change position per map. Every arm below pins one read site
// against a moved position, plus the built-in identity contract: a world that
// moves nothing reads the very shipped tables, so the built-in world cannot
// drift.

import { afterEach, describe, expect, it } from 'vitest';
import {
  type Collider,
  invalidateStaticColliders,
  queryOpenWorldColliders,
} from '../src/sim/colliders';
import { FARM_PATCHES, farmBedById } from '../src/sim/content/farm_patches';
import { GATHER_NODES as CONTENT_GATHER_NODES } from '../src/sim/content/gather_nodes';
import { HEALING_TRAINING_GROUND_SPAWNS } from '../src/sim/content/healing_training';
import {
  HUB_HEALING_DUMMY_ID,
  HUB_TRAINING_DUMMY_ID,
  HUB_TRAINING_DUMMY_POS,
} from '../src/sim/content/practice_dummies';
import {
  activeDungeonDoorPos,
  activeGatherNodes,
  BASE_WORLD,
  BUILTIN_WORLD,
  DUNGEON_LIST,
  DUNGEONS,
  GATHER_NODES,
  gatherNodesInActiveWorld,
  getActiveWorldContent,
  setActiveWorldContent,
} from '../src/sim/data';
import { projectOutsideDungeonDoors } from '../src/sim/dungeon_door_clearance';
import { dungeonDoorJambColliders } from '../src/sim/dungeon_door_jambs';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import {
  dungeonDoorPos,
  farmBedFor,
  farmPatchesFor,
  freezeObjectMoves,
  gatherNodesFor,
  MAX_OBJECT_MOVES,
  type ObjectMove,
  objectMoveKey,
  parseObjectMoveKey,
  practiceDummyPos,
  sanitizeObjectMoves,
} from '../src/sim/moved_objects';
import { plantCrop } from '../src/sim/professions/farming';
import { gatherNodeById } from '../src/sim/professions/gathering';
import { DOOR_ARCH_JAMB_X } from '../src/sim/prop_layout';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { SimEvent, WorldContent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const BED = 'bed_eastbrook_1';

function movedWorld(moves: Record<string, ObjectMove>): WorldContent {
  return { ...BUILTIN_WORLD, objectMoves: freezeObjectMoves(moves) };
}

function teleport(sim: Sim, x: number, z: number): void {
  const p = sim.player;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

afterEach(() => {
  setActiveWorldContent(null);
});

describe('moved objects: the record', () => {
  it('keys round-trip and reject anything that is not a known kind', () => {
    const key = objectMoveKey('farmBed', BED);
    expect(key).toBe('farmBed:bed_eastbrook_1');
    expect(parseObjectMoveKey(key)).toEqual({ kind: 'farmBed', id: BED });
    expect(parseObjectMoveKey('npc:foo')).toBeNull();
    expect(parseObjectMoveKey('farmBed:')).toBeNull();
    expect(parseObjectMoveKey('farmBed:Bad Id')).toBeNull();
  });

  it('sanitizes: well-formed finite in-bound entries survive, frozen; the rest drop', () => {
    const out = sanitizeObjectMoves(
      {
        'farmBed:bed_eastbrook_1': { x: 10, z: 20 },
        'gatherNode:some_node': { x: -5, z: 7.5, extra: 'dropped' },
        'npc:hale': { x: 1, z: 1 },
        'farmBed:bed_x': { x: Number.NaN, z: 1 },
        'farmBed:bed_y': { x: 1 },
        'farmBed:bed_z': { x: 99_999, z: 0 },
        'dungeonDoor:hollow_crypt': 'nope',
      },
      10_000,
    );
    expect(out).toEqual({
      'farmBed:bed_eastbrook_1': { x: 10, z: 20 },
      'gatherNode:some_node': { x: -5, z: 7.5 },
    });
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out?.['farmBed:bed_eastbrook_1'])).toBe(true);
    expect(sanitizeObjectMoves({}, 10_000)).toBeUndefined();
    expect(sanitizeObjectMoves([], 10_000)).toBeUndefined();
    expect(sanitizeObjectMoves(null, 10_000)).toBeUndefined();
  });

  it('caps a hostile document at MAX_OBJECT_MOVES', () => {
    const raw: Record<string, ObjectMove> = {};
    for (let i = 0; i < MAX_OBJECT_MOVES + 50; i++) raw[`gatherNode:n_${i}`] = { x: i, z: i };
    expect(Object.keys(sanitizeObjectMoves(raw, 10_000) ?? {})).toHaveLength(MAX_OBJECT_MOVES);
  });

  it('freezeObjectMoves: undefined for empty, the same object when already frozen', () => {
    expect(freezeObjectMoves(undefined)).toBeUndefined();
    expect(freezeObjectMoves({})).toBeUndefined();
    const frozen = freezeObjectMoves({ 'farmBed:a': { x: 1, z: 2 } });
    expect(freezeObjectMoves(frozen)).toBe(frozen);
    const plain = { 'farmBed:a': { x: 1, z: 2 } };
    const copy = freezeObjectMoves(plain);
    expect(copy).not.toBe(plain);
    expect(copy).toEqual(plain);
  });

  it('a map document keeps its moves through the shared sanitizer', () => {
    const doc = sanitizeMapDoc({
      content: { zones: BUILTIN_WORLD.zones },
      objectMoves: { 'farmBed:bed_eastbrook_1': { x: 3, z: 4 }, 'bogus:x': { x: 0, z: 0 } },
    });
    expect(doc?.objectMoves).toEqual({ 'farmBed:bed_eastbrook_1': { x: 3, z: 4 } });
    const none = sanitizeMapDoc({ content: { zones: BUILTIN_WORLD.zones } });
    expect(none && 'objectMoves' in none).toBe(false);
  });
});

describe('moved objects: activating a world', () => {
  it('freezes a record that arrived as JSON (a playtest handoff, a published map)', () => {
    const world = JSON.parse(
      JSON.stringify({
        ...BUILTIN_WORLD,
        objectMoves: { [objectMoveKey('farmBed', BED)]: { x: 1, z: 2 } },
      }),
    ) as WorldContent;
    expect(Object.isFrozen(world.objectMoves)).toBe(false);
    setActiveWorldContent(world);
    expect(Object.isFrozen(world.objectMoves)).toBe(true);
    expect(Object.isFrozen(world.objectMoves?.[objectMoveKey('farmBed', BED)])).toBe(true);
    expect(world.objectMoves).toEqual({ [objectMoveKey('farmBed', BED)]: { x: 1, z: 2 } });
    // An empty record leaves no field behind.
    const empty = { ...BUILTIN_WORLD, objectMoves: {} } as WorldContent;
    setActiveWorldContent(empty);
    expect('objectMoves' in empty).toBe(false);
  });
});

describe('moved objects: the built-in world cannot drift', () => {
  it('every resolver hands back the shipped table or row itself when nothing moved', () => {
    expect(farmPatchesFor(undefined, FARM_PATCHES)).toBe(FARM_PATCHES);
    expect(gatherNodesFor(undefined, GATHER_NODES)).toBe(GATHER_NODES);
    // Moves of OTHER kinds leave a kind's table untouched by reference.
    const doorOnly = freezeObjectMoves({ 'dungeonDoor:hollow_crypt': { x: 1, z: 1 } });
    expect(farmPatchesFor(doorOnly, FARM_PATCHES)).toBe(FARM_PATCHES);
    expect(gatherNodesFor(doorOnly, GATHER_NODES)).toBe(GATHER_NODES);
    const bed = farmBedById(BED);
    expect(farmBedFor(undefined, bed)).toBe(bed);
    expect(practiceDummyPos(undefined, HUB_TRAINING_DUMMY_ID, HUB_TRAINING_DUMMY_POS)).toBe(
      HUB_TRAINING_DUMMY_POS,
    );
    const crypt = DUNGEONS.hollow_crypt;
    expect(dungeonDoorPos(undefined, crypt)).toBe(crypt.doorPos);
  });

  it('the base world Sim and the active base world read the shipped tables', () => {
    setActiveWorldContent(BASE_WORLD);
    const sim = new Sim({ seed: 7, playerClass: 'warrior', world: BASE_WORLD });
    expect(sim.farmPatches).toBe(FARM_PATCHES);
    expect(getActiveWorldContent().objectMoves).toBeUndefined();
    expect(gatherNodesInActiveWorld()).toBe(GATHER_NODES);
    expect(activeGatherNodes()).toBe(GATHER_NODES);
  });
});

describe('moved objects: farm beds', () => {
  const target = { x: 40, z: -20 };
  const moves = freezeObjectMoves({ [objectMoveKey('farmBed', BED)]: target });

  it('moves the bed, re-centres its patch, and shares every untouched row', () => {
    const patches = farmPatchesFor(moves, FARM_PATCHES);
    expect(patches).not.toBe(FARM_PATCHES);
    expect(patches).toBe(farmPatchesFor(moves, FARM_PATCHES));
    const home = patches.find((p) => p.beds.some((b) => b.id === BED));
    const shipped = FARM_PATCHES.find((p) => p.beds.some((b) => b.id === BED));
    if (!home || !shipped) throw new Error('no eastbrook patch');
    expect(home.beds.find((b) => b.id === BED)).toEqual({ id: BED, ...target });
    expect(home.beds.map((b) => b.id)).toEqual(shipped.beds.map((b) => b.id));
    const cx = home.beds.reduce((s, b) => s + b.x, 0) / home.beds.length;
    const cz = home.beds.reduce((s, b) => s + b.z, 0) / home.beds.length;
    expect(home.x).toBeCloseTo(cx, 9);
    expect(home.z).toBeCloseTo(cz, 9);
    expect(Object.isFrozen(home)).toBe(true);
    expect(Object.isFrozen(home.beds)).toBe(true);
    for (const patch of patches) {
      if (patch.id !== home.id) expect(FARM_PATCHES).toContain(patch);
    }
    // Unmoved beds of the moved patch are still the shipped rows.
    for (const bed of home.beds) {
      if (bed.id !== BED) expect(shipped.beds).toContain(bed);
    }
  });

  it('two worlds never answer for each other', () => {
    const other = freezeObjectMoves({ [objectMoveKey('farmBed', BED)]: { x: 0, z: 0 } });
    const a = farmPatchesFor(moves, FARM_PATCHES);
    const b = farmPatchesFor(other, FARM_PATCHES);
    expect(a).not.toBe(b);
    const bedA = a.flatMap((p) => p.beds).find((x) => x.id === BED);
    const bedB = b.flatMap((p) => p.beds).find((x) => x.id === BED);
    expect(bedA).toMatchObject(target);
    expect(bedB).toMatchObject({ x: 0, z: 0 });
  });

  it('the plant range check measures from the moved bed', () => {
    const world = movedWorld({ [objectMoveKey('farmBed', BED)]: target });
    const moved = new Sim({ seed: 11, playerClass: 'warrior', world });
    expect(moved.farmPatches.flatMap((p) => p.beds).find((b) => b.id === BED)).toMatchObject(
      target,
    );
    const meta = moved.players.get(moved.playerId) as PlayerMeta;
    const denials = (): string[] =>
      moved
        .tick()
        .filter((e): e is Extract<SimEvent, { type: 'farmDenied' }> => e.type === 'farmDenied')
        .map((e) => e.reason);
    const shipped = farmBedById(BED);
    if (!shipped) throw new Error('no bed');
    // At the shipped spot the moved bed is out of reach.
    teleport(moved, shipped.x, shipped.z);
    plantCrop(moved.ctx, moved.player, meta, BED, 'vale_wheat');
    expect(denials()).toContain('range');
    // At the moved spot the range gate passes (whatever the next gate says).
    teleport(moved, target.x, target.z);
    plantCrop(moved.ctx, moved.player, meta, BED, 'vale_wheat');
    expect(denials()).not.toContain('range');
  });
});

describe('moved objects: practice dummies', () => {
  const spawnRows = (sim: Sim) =>
    [...sim.entities.values()]
      .filter((e) => e.kind === 'mob' && e.templateId.includes('dummy'))
      .map((e) => ({ id: e.id, templateId: e.templateId, x: e.pos.x, z: e.pos.z }))
      .sort((a, b) => a.id - b.id);

  it('spawn at the moved marks with the same ids, the same order and the same rng', () => {
    const healingRow = HEALING_TRAINING_GROUND_SPAWNS[2];
    const world = movedWorld({
      [objectMoveKey('practiceDummy', HUB_TRAINING_DUMMY_ID)]: { x: -70, z: -60 },
      [objectMoveKey('practiceDummy', HUB_HEALING_DUMMY_ID)]: { x: -72, z: -58 },
      [objectMoveKey('practiceDummy', healingRow.mobId)]: { x: -60, z: -30 },
    });
    const shipped = new Sim({ seed: 5, playerClass: 'priest', world: { ...BUILTIN_WORLD } });
    const moved = new Sim({ seed: 5, playerClass: 'priest', world });
    const a = spawnRows(shipped);
    const b = spawnRows(moved);
    expect(b.map((r) => [r.id, r.templateId])).toEqual(a.map((r) => [r.id, r.templateId]));
    expect(moved.playerId).toBe(shipped.playerId);
    expect(moved.rng.next()).toBe(shipped.rng.next());
    const at = (rows: typeof b, id: string) => rows.find((r) => r.templateId === id);
    expect(at(b, HUB_TRAINING_DUMMY_ID)).toMatchObject({ x: -70, z: -60 });
    expect(at(b, HUB_HEALING_DUMMY_ID)).toMatchObject({ x: -72, z: -58 });
    expect(at(b, healingRow.mobId)).toMatchObject({ x: -60, z: -30 });
    expect(at(a, HUB_TRAINING_DUMMY_ID)).toMatchObject(HUB_TRAINING_DUMMY_POS);
    // An unmoved training-ground dummy stays on its shipped mark.
    const still = HEALING_TRAINING_GROUND_SPAWNS[0];
    expect(at(b, still.mobId)).toMatchObject(still.pos);
  });
});

describe('moved objects: gather nodes', () => {
  const node = GATHER_NODES.find((n) => n.type === 'ore');
  if (!node) throw new Error('no ore node');
  const target = { x: node.pos.x + 30, z: node.pos.z + 12 };
  const moves = freezeObjectMoves({ [objectMoveKey('gatherNode', node.id)]: target });

  it('memoizes only on deep-frozen content, and hands out frozen answers', () => {
    // ONE table: the data merge re-exports the deep-frozen content table, so
    // every reader resolves against the same memo key.
    expect(GATHER_NODES).toBe(CONTENT_GATHER_NODES);
    expect(Object.isFrozen(GATHER_NODES)).toBe(true);
    expect(Object.isFrozen(GATHER_NODES[0])).toBe(true);
    expect(Object.isFrozen(GATHER_NODES[0].pos)).toBe(true);
    const nodes = gatherNodesFor(moves, GATHER_NODES);
    expect(Object.isFrozen(nodes)).toBe(true);
    const moved = nodes.find((n) => n.id === node.id);
    expect(Object.isFrozen(moved)).toBe(true);
    expect(Object.isFrozen(moved?.pos)).toBe(true);
    // A record frozen on the outside with a live entry is never memoized:
    // each read resolves afresh, so an entry mutated in place shows at once.
    const entry = { x: 1, z: 2 };
    const shallow = Object.freeze({ [objectMoveKey('gatherNode', node.id)]: entry });
    const a = gatherNodesFor(shallow, GATHER_NODES);
    expect(gatherNodesFor(shallow, GATHER_NODES)).not.toBe(a);
    entry.x = 9;
    expect(gatherNodesFor(shallow, GATHER_NODES).find((n) => n.id === node.id)?.pos.x).toBe(9);
    // A different table never answers from another table's memo entry.
    const copy = [...GATHER_NODES];
    expect(gatherNodesFor(moves, copy)).not.toBe(nodes);
    expect(gatherNodesFor(moves, copy)).toEqual(nodes);
  });

  it('resolves the moved node in place, keeping order and every other row', () => {
    const nodes = gatherNodesFor(moves, GATHER_NODES);
    expect(nodes).toBe(gatherNodesFor(moves, GATHER_NODES));
    expect(nodes).toHaveLength(GATHER_NODES.length);
    expect(nodes.map((n) => n.id)).toEqual(GATHER_NODES.map((n) => n.id));
    const moved = nodes.find((n) => n.id === node.id);
    expect(moved).toEqual({ ...node, pos: target });
    expect(node.pos).not.toEqual(target);
    expect(gatherNodeById(node.id, moves)?.pos).toEqual(target);
    expect(gatherNodeById(node.id)).toBe(node);
  });

  it('the harvest command measures its reach from the moved node', () => {
    const ore = GATHER_NODES.find((n) => n.id === 'ore_eastbrook_1');
    if (!ore) throw new Error('no ore_eastbrook_1');
    const spot = { x: ore.pos.x + 7, z: ore.pos.z + 3 };
    const world = movedWorld({ [objectMoveKey('gatherNode', ore.id)]: spot });
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world });
    const pid = sim.addPlayer('warrior', 'Gatherer');
    sim.addItem('copper_mining_pick', 1, pid); // bare hands never harvest
    for (const e of sim.entities.values()) {
      if (e.kind === 'mob') e.dead = true;
    }
    const errors = (): string[] =>
      sim
        .tick()
        .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
        .map((e) => e.text);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('no player');
    const stand = (x: number, z: number) => {
      p.pos.x = x;
      p.pos.z = z;
      p.pos.y = terrainHeight(x, z, sim.cfg.seed);
      p.prevPos = { ...p.pos };
    };
    stand(ore.pos.x, ore.pos.z);
    expect(sim.harvestNode(ore.id, undefined, pid)).toBe(false);
    expect(errors()).toContain('Too far away.');
    stand(spot.x, spot.z);
    const ok = sim.harvestNode(ore.id, undefined, pid);
    expect(errors()).toEqual([]);
    expect(ok).toBe(true);
    expect(p.gatherCastNodeId).toBe(ore.id);
  });

  it('the active world reads the moved node, and its collider travels with it', () => {
    const near = (x: number, z: number): Collider[] =>
      queryOpenWorldColliders(20061, x - 0.5, z - 0.5, x + 0.5, z + 0.5, []).filter(
        (c) => c.type === 'circle' && Math.hypot(c.x - x, c.z - z) < 0.01,
      );
    setActiveWorldContent(movedWorld({ [objectMoveKey('gatherNode', node.id)]: target }));
    invalidateStaticColliders();
    try {
      expect(gatherNodesInActiveWorld().find((n) => n.id === node.id)?.pos).toEqual(target);
      expect(near(target.x, target.z)).toHaveLength(1);
      expect(near(node.pos.x, node.pos.z)).toHaveLength(0);
    } finally {
      setActiveWorldContent(null);
      invalidateStaticColliders();
    }
    expect(near(node.pos.x, node.pos.z)).toHaveLength(1);
  });
});

describe('moved objects: dungeon doors', () => {
  const crypt = DUNGEON_LIST.find((d) => d.id === 'hollow_crypt');
  if (!crypt) throw new Error('no hollow crypt');
  const target = { x: crypt.doorPos.x + 40, z: crypt.doorPos.z - 25 };
  const world = movedWorld({ [objectMoveKey('dungeonDoor', crypt.id)]: target });

  it('the door entity spawns at the moved spot, same id as the shipped world', () => {
    const doorOf = (sim: Sim) =>
      [...sim.entities.values()].find(
        (e) => e.templateId === 'dungeon_door' && e.dungeonId === crypt.id,
      );
    const shipped = doorOf(
      new Sim({ seed: 3, playerClass: 'warrior', world: { ...BUILTIN_WORLD } }),
    );
    const moved = doorOf(new Sim({ seed: 3, playerClass: 'warrior', world }));
    expect(moved?.id).toBe(shipped?.id);
    expect(moved?.pos).toMatchObject(target);
    expect(shipped?.pos).toMatchObject(crypt.doorPos);
  });

  it('the arch jambs and the entrance set-piece colliders follow the moved door', () => {
    const keep = DUNGEON_LIST.find((d) => d.id === 'the_last_keep');
    if (!keep) throw new Error('no last keep');
    const keepTarget = { x: keep.doorPos.x - 30, z: keep.doorPos.z + 18 };
    const topY = () => 3;
    const jambAt = (cs: Collider[], x: number, z: number) =>
      cs.some((c) => c.type === 'obb' && Math.abs(c.x - x) < 1e-6 && Math.abs(c.z - z) < 1e-6);
    const near = (cs: Collider[], p: { x: number; z: number }) =>
      cs.filter((c) => 'x' in c && Math.hypot(c.x - p.x, c.z - p.z) < 12).length;
    const shipped = dungeonDoorJambColliders(20061, topY);
    setActiveWorldContent(
      movedWorld({
        [objectMoveKey('dungeonDoor', keep.id)]: keepTarget,
        [objectMoveKey('dungeonDoor', crypt.id)]: target,
      }),
    );
    const moved = dungeonDoorJambColliders(20061, topY);
    setActiveWorldContent(null);
    expect(moved).toHaveLength(shipped.length);
    expect(jambAt(shipped, keep.doorPos.x + DOOR_ARCH_JAMB_X, keep.doorPos.z)).toBe(true);
    expect(jambAt(moved, keepTarget.x + DOOR_ARCH_JAMB_X, keepTarget.z)).toBe(true);
    expect(jambAt(moved, keepTarget.x - DOOR_ARCH_JAMB_X, keepTarget.z)).toBe(true);
    expect(jambAt(moved, keep.doorPos.x + DOOR_ARCH_JAMB_X, keep.doorPos.z)).toBe(false);
    // The Hollow Crypt's chapel colliders travel with its door.
    expect(near(shipped, crypt.doorPos)).toBeGreaterThan(0);
    expect(near(moved, crypt.doorPos)).toBe(0);
    expect(near(moved, target)).toBe(near(shipped, crypt.doorPos));
  });

  it('the camp clear ring follows the moved door', () => {
    const moves = world.objectMoves;
    const inside = { x: target.x + 2, z: target.z };
    const pushed = projectOutsideDungeonDoors(inside.x, inside.z, moves);
    expect(Math.hypot(pushed.x - target.x, pushed.z - target.z)).toBeGreaterThan(2);
    expect(projectOutsideDungeonDoors(inside.x, inside.z)).toEqual(inside);
  });

  it('the active world resolves the moved door for the render and map readers', () => {
    setActiveWorldContent(world);
    expect(activeDungeonDoorPos(crypt)).toEqual(target);
    setActiveWorldContent(null);
    expect(activeDungeonDoorPos(crypt)).toBe(crypt.doorPos);
  });

  it('leaving the dungeon drops the player in front of the moved door', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', world });
    const door = [...sim.entities.values()].find(
      (e) => e.templateId === 'dungeon_door' && e.dungeonId === crypt.id,
    );
    if (!door) throw new Error('no door entity');
    teleport(sim, door.pos.x, door.pos.z);
    for (let i = 0; i < 4; i++) sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(5000);
    sim.leaveDungeon();
    const drop = crypt.leaveOffset ?? { x: 0, z: -4 };
    expect(sim.player.pos.x).toBeCloseTo(target.x + drop.x, 3);
    expect(sim.player.pos.z).toBeCloseTo(target.z + drop.z, 3);
  });
});

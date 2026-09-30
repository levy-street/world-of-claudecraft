// The Fire and Fly arena: its dungeon record and band, the shared field (height,
// tower, rocks, tree ring, walls) and the static collision set built from it.

import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it, vi } from 'vitest';
import {
  type CircleCollider,
  type Collider,
  resolveMovement,
  resolvePosition,
  supportHeightAt,
} from '../src/sim/colliders';
import {
  FIRE_AND_FLY_DUNGEON_DEFS,
  FIRE_AND_FLY_DUNGEON_ID,
} from '../src/sim/content/fire_and_fly_arena';
import { TURRET_ARENA, TURRET_SIZE_CLASSES } from '../src/sim/content/turret_defense';
import {
  DUNGEON_FLOOR_Y,
  DUNGEON_LIST,
  DUNGEON_OVERFLOW_X_BASE,
  DUNGEONS,
  dungeonAt,
  INSTANCE_SLOT_COUNT,
  instanceOrigin,
  isArenaPos,
  isBgPos,
  isDelvePos,
  isRiftPos,
  isYumiMazePos,
  PLAYER_START,
} from '../src/sim/data';
import {
  FIRE_AND_FLY_CLEARING_RADIUS,
  FIRE_AND_FLY_EDGE_TREES,
  FIRE_AND_FLY_FOREST_RADIUS,
  FIRE_AND_FLY_ROCKS,
  FIRE_AND_FLY_TOWER,
  FIRE_AND_FLY_TREE_RING,
  FIRE_AND_FLY_TREE_ROWS,
  FIRE_AND_FLY_TREES,
  FIRE_AND_FLY_WALL_RADIUS,
  FIRE_AND_FLY_WALL_REACH,
  FIRE_AND_FLY_WALLS,
  fireAndFlyColliders,
  fireAndFlyFieldHeight,
  fireAndFlyTrunkRadius,
} from '../src/sim/fire_and_fly_field';
import { derivedInteriorColliders } from '../src/sim/interior_collider_sets';
import { resolveSavedPosExit } from '../src/sim/saved_pos_exit';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ARENA = DUNGEONS[FIRE_AND_FLY_DUNGEON_ID];
const colliders = fireAndFlyColliders(DUNGEON_FLOOR_Y);
const circles = colliders.filter((c): c is CircleCollider => c.type === 'circle');

function ringSamples(maxR: number, step = 2.5): [number, number][] {
  const out: [number, number][] = [];
  for (let x = -maxR; x <= maxR; x += step) {
    for (let z = -maxR; z <= maxR; z += step) {
      if (Math.hypot(x, z) <= maxR) out.push([x, z]);
    }
  }
  return out;
}

describe('the Fire and Fly dungeon record', () => {
  it('is a hidden, door-less, spawn-free solo interior in the next overflow band', () => {
    expect(FIRE_AND_FLY_DUNGEON_ID).toBe('fire_and_fly_arena');
    expect(Object.keys(FIRE_AND_FLY_DUNGEON_DEFS)).toEqual([FIRE_AND_FLY_DUNGEON_ID]);
    expect(ARENA).toMatchObject({
      name: 'Fire and Fly',
      index: 15,
      interior: 'fire_and_fly',
      overworldDoor: false,
      guideVisible: false,
      spawns: [],
      suggestedPlayers: 1,
    });
    expect(ARENA.npcs ?? []).toEqual([]);
    expect(ARENA.objects ?? []).toEqual([]);
    const indices = DUNGEON_LIST.map((d) => d.index);
    expect(new Set(indices).size).toBe(indices.length);
    expect(Math.max(...indices.filter((i) => i !== ARENA.index))).toBe(ARENA.index - 1);
  });

  it('owns its band: every slot resolves to the arena and to no other instance system', () => {
    for (let slot = 0; slot < INSTANCE_SLOT_COUNT; slot++) {
      const o = instanceOrigin(ARENA.index, slot);
      expect(o.x).toBe(DUNGEON_OVERFLOW_X_BASE + (ARENA.index - 7) * 600);
      for (const dx of [-FIRE_AND_FLY_FOREST_RADIUS - 2, 0, FIRE_AND_FLY_FOREST_RADIUS + 2]) {
        const x = o.x + dx;
        expect(dungeonAt(x)?.id).toBe(FIRE_AND_FLY_DUNGEON_ID);
        expect([isArenaPos(x), isDelvePos(x), isRiftPos(x), isYumiMazePos(x), isBgPos(x)]).toEqual([
          false,
          false,
          false,
          false,
          false,
        ]);
      }
    }
  });

  it('adds no world-boot entity (no door), only its 24 free slots', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', noPlayer: true });
    const doors = [...sim.entities.values()].filter((e) => e.templateId === 'dungeon_door');
    expect(doors.some((door) => door.dungeonId === FIRE_AND_FLY_DUNGEON_ID)).toBe(false);
    const slots = sim.ctx.instances.filter((inst) => inst.dungeonId === FIRE_AND_FLY_DUNGEON_ID);
    expect(slots.map((inst) => inst.slot)).toEqual(
      Array.from({ length: INSTANCE_SLOT_COUNT }, (_, i) => i),
    );
    expect(slots.every((inst) => inst.partyKey === null)).toBe(true);
  });

  it('rejoins a save taken inside at the Eastbrook arrival point', () => {
    const o = instanceOrigin(ARENA.index, 11);
    expect(resolveSavedPosExit({ x: o.x + 20, z: o.z - 30 })).toEqual({
      pos: PLAYER_START,
      instanceExit: true,
    });
  });
});

describe('the Fire and Fly field', () => {
  it('pins the clearing, the tree ring and the forest the render draws from', () => {
    expect(FIRE_AND_FLY_CLEARING_RADIUS).toBe(55);
    expect(FIRE_AND_FLY_TREE_RING).toEqual({ inner: 60, outer: 95 });
    expect(FIRE_AND_FLY_FOREST_RADIUS).toBe(100);
  });

  it('reads through groundHeight in every slot', () => {
    for (const slot of [0, 7, INSTANCE_SLOT_COUNT - 1]) {
      const o = instanceOrigin(ARENA.index, slot);
      for (const [x, z] of [
        [0, 0],
        [23, -41],
        [-70, 12],
        [0, 98],
      ] as const) {
        expect(groundHeight(o.x + x, o.z + z, WORLD_SEED)).toBe(
          DUNGEON_FLOOR_Y + fireAndFlyFieldHeight(x, z),
        );
      }
    }
  });

  it('is exactly flat at the tower foot and rolls under 0.6 yd across the clearing', () => {
    for (const [x, z] of ringSamples(5, 0.5)) expect(fireAndFlyFieldHeight(x, z)).toBe(0);
    const heights = ringSamples(FIRE_AND_FLY_CLEARING_RADIUS).map(([x, z]) =>
      fireAndFlyFieldHeight(x, z),
    );
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.6);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.2);
  });

  it('is smooth everywhere and rises gently into the forest', () => {
    const h = 0.25;
    let steepest = 0;
    for (const [x, z] of ringSamples(FIRE_AND_FLY_FOREST_RADIUS, 3)) {
      const gx = (fireAndFlyFieldHeight(x + h, z) - fireAndFlyFieldHeight(x - h, z)) / (2 * h);
      const gz = (fireAndFlyFieldHeight(x, z + h) - fireAndFlyFieldHeight(x, z - h)) / (2 * h);
      steepest = Math.max(steepest, Math.hypot(gx, gz));
    }
    expect(steepest).toBeLessThan(0.2);
    const rim = (r: number) =>
      Array.from({ length: 36 }, (_, i) => {
        const a = (i * Math.PI) / 18;
        return fireAndFlyFieldHeight(Math.sin(a) * r, Math.cos(a) * r);
      });
    expect(Math.min(...rim(FIRE_AND_FLY_TREE_RING.outer))).toBeGreaterThan(
      Math.max(...rim(FIRE_AND_FLY_CLEARING_RADIUS)) + 1.5,
    );
  });

  it('is deterministic: a fresh evaluation of the module yields the same arena', async () => {
    vi.resetModules();
    const again = await import('../src/sim/fire_and_fly_field');
    expect(again.FIRE_AND_FLY_TREES).not.toBe(FIRE_AND_FLY_TREES);
    expect(again.FIRE_AND_FLY_TREES).toEqual(FIRE_AND_FLY_TREES);
    expect(again.FIRE_AND_FLY_ROCKS).toEqual(FIRE_AND_FLY_ROCKS);
    expect(again.fireAndFlyColliders(DUNGEON_FLOOR_Y)).toEqual(colliders);
    expect(again.fireAndFlyFieldHeight(31.7, -12.25)).toBe(fireAndFlyFieldHeight(31.7, -12.25));
  });
});

describe('the Fire and Fly tower', () => {
  it('stands its roof 4.5 to 5 yd above the ground at one shared scale', () => {
    expect(FIRE_AND_FLY_TOWER.scale).toBe(3.4);
    expect(FIRE_AND_FLY_TOWER.roofY).toBeGreaterThanOrEqual(4.5);
    expect(FIRE_AND_FLY_TOWER.roofY).toBeLessThanOrEqual(5);
  });

  it('matches the drawn tower: the roof the head sits on, the parapet top, a shaft-wide body', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const root = (await io.read('public/models/biome/hex_tower_cannon.glb')).getRoot();
    const head = root.listNodes().find((n) => n.getName() === 'cannon_turret_green');
    const body = root
      .listNodes()
      .find((n) => n.getMesh()?.getName() === 'building_tower_cannon_green');
    if (!head || !body) throw new Error('hex_tower_cannon.glb lost its head or its tower body');
    const scale = FIRE_AND_FLY_TOWER.scale;
    // The head pivots on the roof platform: its world height is where the player stands.
    expect(FIRE_AND_FLY_TOWER.roofY / scale).toBeCloseTo(head.getWorldMatrix()[13], 3);
    const scene = root.listScenes()[0];
    expect(getBounds(scene).min[1]).toBeCloseTo(0, 6);
    const m = body.getWorldMatrix();
    const position = body.getMesh()?.listPrimitives()[0].getAttribute('POSITION');
    if (!position) throw new Error('the tower body has no positions');
    let top = Number.NEGATIVE_INFINITY;
    let shaft = 0;
    const v: number[] = [];
    for (let i = 0; i < position.getCount(); i++) {
      position.getElement(i, v);
      const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
      const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
      top = Math.max(top, y);
      // The plinth flares wider only in its bottom sliver (ankle high at scale).
      if (y > 0.06) shaft = Math.max(shaft, Math.hypot(x, z));
    }
    expect(FIRE_AND_FLY_TOWER.topY / scale).toBeCloseTo(top, 3);
    // The collider circle covers every shaft vertex, with no more than a few inches spare.
    expect(FIRE_AND_FLY_TOWER.radius / scale).toBeGreaterThanOrEqual(shaft);
    expect(FIRE_AND_FLY_TOWER.radius / scale).toBeLessThan(shaft + 0.03);
  });

  it('is a round collider at the center whose roof is the standable top', () => {
    const tower = colliders[0];
    expect(tower).toEqual({
      type: 'circle',
      x: 0,
      z: 0,
      r: FIRE_AND_FLY_TOWER.radius,
      moveTopY: DUNGEON_FLOOR_Y + FIRE_AND_FLY_TOWER.roofY,
      standable: true,
      cameraTopY: DUNGEON_FLOOR_Y + FIRE_AND_FLY_TOWER.topY,
    });
    const o = instanceOrigin(ARENA.index, 4);
    const roof = DUNGEON_FLOOR_Y + FIRE_AND_FLY_TOWER.roofY;
    expect(supportHeightAt(WORLD_SEED, o.x, o.z, 0.5, roof)).toBe(roof);
    expect(supportHeightAt(WORLD_SEED, o.x + 1, o.z - 0.5, 0.5, roof + 3)).toBe(roof);
    expect(supportHeightAt(WORLD_SEED, o.x + 4, o.z, 0.5, roof)).toBe(Number.NEGATIVE_INFINITY);
    const walked = resolvePosition(WORLD_SEED, o.x + 1, o.z, 0.5);
    expect(Math.hypot(walked.x - o.x, walked.z - o.z)).toBeCloseTo(
      FIRE_AND_FLY_TOWER.radius + 0.5,
      6,
    );
    const onRoof = resolvePosition(WORLD_SEED, o.x + 1, o.z, 0.5, false, undefined, {
      y: roof,
      lift: 0,
    });
    expect(onRoof).toEqual({ x: o.x + 1, z: o.z });
  });
});

describe('the Fire and Fly dressing and walls', () => {
  it('keeps the clearing open: nothing but the tower within 20 yd, only rocks inside the ring', () => {
    for (const c of circles.slice(1)) {
      const d = Math.hypot(c.x, c.z);
      expect(d).toBeGreaterThan(20);
      if (d < FIRE_AND_FLY_TREE_RING.inner) expect(c.standable).toBe(true);
    }
  });

  it('sets the rocks at the forest edge, out of every lane in from the spawn ring, clear of the trunks', () => {
    expect(FIRE_AND_FLY_ROCKS.length).toBeGreaterThanOrEqual(5);
    const widest = Math.max(...Object.values(TURRET_SIZE_CLASSES).map((c) => c.radius));
    for (const rock of FIRE_AND_FLY_ROCKS) {
      const d = Math.hypot(rock.x, rock.z);
      expect(d).toBeGreaterThanOrEqual(50);
      expect(d).toBeLessThanOrEqual(58);
      // Marchers walk straight in from the spawn ring, so a rock wholly beyond it
      // by more than the widest body is never in a lane.
      expect(d - rock.radius).toBeGreaterThan(TURRET_ARENA.spawnRadius + widest);
      for (const tree of FIRE_AND_FLY_TREES) {
        const gap = Math.hypot(tree.x - rock.x, tree.z - rock.z) - rock.radius;
        expect(gap - fireAndFlyTrunkRadius(tree)).toBeGreaterThan(1);
      }
    }
  });

  it('gives every rock a standable top at its rendered height over the ground', () => {
    for (const rock of FIRE_AND_FLY_ROCKS) {
      const c = circles.find((candidate) => candidate.x === rock.x && candidate.z === rock.z);
      expect(c).toMatchObject({ r: rock.radius, standable: true });
      expect(c?.moveTopY).toBeCloseTo(fireAndFlyFieldHeight(rock.x, rock.z) + rock.height, 12);
      expect(rock.height).toBeGreaterThan(1);
    }
  });

  it('plants a dense trunk ring from 60 to 95 yd, trunks never touching, the inner row solid', () => {
    expect(FIRE_AND_FLY_TREES.length).toBeGreaterThan(250);
    expect(FIRE_AND_FLY_TREE_ROWS.flat()).toEqual([...FIRE_AND_FLY_TREES]);
    expect(FIRE_AND_FLY_EDGE_TREES).toBe(FIRE_AND_FLY_TREE_ROWS[0]);
    for (const tree of FIRE_AND_FLY_TREES) {
      const d = Math.hypot(tree.x, tree.z);
      expect(d).toBeGreaterThanOrEqual(FIRE_AND_FLY_TREE_RING.inner);
      expect(d).toBeLessThanOrEqual(FIRE_AND_FLY_TREE_RING.outer);
      const trunk = circles.find((c) => c.x === tree.x && c.z === tree.z);
      // Only the inner row is solid: the rows behind the wall are out of reach.
      if (FIRE_AND_FLY_EDGE_TREES.includes(tree)) {
        expect(trunk?.r).toBe(fireAndFlyTrunkRadius(tree));
        expect(trunk?.moveTopY).toBeUndefined();
      } else {
        expect(trunk).toBeUndefined();
      }
      expect(['oak', 'pine']).toContain(tree.kind);
    }
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < FIRE_AND_FLY_TREES.length; i++) {
      for (let j = i + 1; j < FIRE_AND_FLY_TREES.length; j++) {
        const a = FIRE_AND_FLY_TREES[i];
        const b = FIRE_AND_FLY_TREES[j];
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    expect(closest).toBeGreaterThan(3);
  });

  it('closes the arena with full-height walls just behind the inner row, before the next', () => {
    const walls = colliders.filter((c) => c.type === 'obb');
    expect(walls).toHaveLength(FIRE_AND_FLY_WALLS.length);
    const outerEdge = (tree: (typeof FIRE_AND_FLY_TREES)[number]) =>
      Math.hypot(tree.x, tree.z) + fireAndFlyTrunkRadius(tree);
    const innerEdge = (tree: (typeof FIRE_AND_FLY_TREES)[number]) =>
      Math.hypot(tree.x, tree.z) - fireAndFlyTrunkRadius(tree);
    // The radius is the inner row's layout plus a small clearance, on a hundredth grid.
    const row = Math.max(...FIRE_AND_FLY_EDGE_TREES.map(outerEdge));
    expect(FIRE_AND_FLY_WALL_RADIUS - row).toBeGreaterThan(0);
    expect(FIRE_AND_FLY_WALL_RADIUS - row).toBeLessThan(
      2 * Math.min(...Object.values(TURRET_SIZE_CLASSES).map((c) => c.radius)),
    );
    expect(Math.round(FIRE_AND_FLY_WALL_RADIUS * 100)).toBeCloseTo(
      FIRE_AND_FLY_WALL_RADIUS * 100,
      9,
    );
    // Even a wall corner stops a body short of the second row's nearest trunk.
    const next = Math.min(...FIRE_AND_FLY_TREE_ROWS[1].map(innerEdge));
    expect(FIRE_AND_FLY_WALL_REACH).toBeLessThan(next - 1);
    for (const rock of FIRE_AND_FLY_ROCKS) {
      expect(Math.hypot(rock.x, rock.z) + rock.radius).toBeLessThan(FIRE_AND_FLY_WALL_RADIUS);
    }
    for (const wall of walls) {
      expect(wall.moveTopY).toBeUndefined();
      expect(Math.hypot(wall.x, wall.z)).toBeGreaterThan(row);
      expect(Math.hypot(wall.x, wall.z)).toBeLessThan(next);
    }
    // A walker heading straight out at any bearing, between trunks or into one,
    // corners included, stays inside the polygon.
    const o = instanceOrigin(ARENA.index, 9);
    for (let i = 0; i < 192; i++) {
      const a = (i * Math.PI) / 96 + 0.01;
      const out = resolveMovement(
        WORLD_SEED,
        o.x + Math.sin(a) * 50,
        o.z + Math.cos(a) * 50,
        o.x + Math.sin(a) * 90,
        o.z + Math.cos(a) * 90,
        0.5,
      );
      expect(Math.hypot(out.x - o.x, out.z - o.z)).toBeLessThanOrEqual(
        FIRE_AND_FLY_WALL_REACH - 0.5 + 1e-6,
      );
    }
  });

  it('is the static interior set the collision routing serves for the arena', () => {
    const served: Collider[] = derivedInteriorColliders(FIRE_AND_FLY_DUNGEON_ID, 'fire_and_fly');
    expect(served).toEqual(colliders);
    expect(derivedInteriorColliders(null, 'fire_and_fly')).toBe(served);
  });
});

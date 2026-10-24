import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authoredTownBuildingPlacements } from '../src/editor/feature_prop_placements';
import { isPlacedBuildingAsset } from '../src/render/eastbrook_placed_building';
import {
  buildingRecordColliders,
  isAuthoredTownBuildingDef,
  placedBuildingAnnexes,
  promotedTownBuildingStandsDown,
} from '../src/sim/authored_town_buildings';
import { rotY } from '../src/sim/collider_shapes';
import { isBlocked, streetlampPlacements } from '../src/sim/colliders';
import { ZONE2_PROPS } from '../src/sim/content/zone2';
import { BASE_WORLD, setActiveWorldContent } from '../src/sim/data';
import { FENBRIDGE_LAYOUT, localToWorld, type Obb2 } from '../src/sim/fenbridge_layout';
import { HIGHWATCH_LAYOUT } from '../src/sim/highwatch_layout';
import { JAIL_TERRAIN_EDITS } from '../src/sim/jail';
import { loadPublishedMap, MAP_SEED } from '../src/sim/maps/eastbrook_rebuild.generated';
import { isResting } from '../src/sim/progression/xp';
import { Sim } from '../src/sim/sim';
import { townWalkInPlacements } from '../src/sim/town_walk_in';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The built-in Fenbridge stands five painted Tidehold buildings (in the
// Fenrire moss look) round its open square. This suite measures each
// layout record off the things it was copied from: the shipped model file and
// the model's baked collision rows.

const ROOT = path.join(__dirname, '..');
const BUILDINGS = FENBRIDGE_LAYOUT.buildings;
type Building = (typeof BUILDINGS)[number];

beforeEach(() => setActiveWorldContent(BASE_WORLD));
afterEach(() => setActiveWorldContent(null));

interface BakedBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  ry?: number;
}
const BAKED = JSON.parse(
  readFileSync(path.join(ROOT, 'data/asset_collision_overrides.json'), 'utf8'),
) as Record<string, { boxes: BakedBox[] }>;

/** The model a record draws: a look (`tidehold/fenrire/x`) re-bakes the
 *  textures of `tidehold/x` on the same geometry, so it shares its rows. */
function modelIdOf(building: Building): string {
  const name = building.assetId.replace(/^.*\//, '').replace(/\.glb$/, '');
  return `tidehold/${name}`;
}

/** A world point in the model's own axes (the inverse of localToWorld). */
function toModelAxes(building: Building, point: { x: number; z: number }) {
  const dx = point.x - building.placement.x;
  const dz = point.z - building.placement.z;
  const cos = Math.cos(building.placement.rotation);
  const sin = Math.sin(building.placement.rotation);
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function rectOf(building: Building, obb: Obb2): Rect {
  const c = toModelAxes(building, obb.center);
  return {
    x0: c.x - obb.halfWidth,
    x1: c.x + obb.halfWidth,
    z0: c.z - obb.halfDepth,
    z1: c.z + obb.halfDepth,
  };
}

function worstEdge(a: Rect, b: Rect): number {
  return Math.max(
    Math.abs(a.x0 - b.x0),
    Math.abs(a.x1 - b.x1),
    Math.abs(a.z0 - b.z0),
    Math.abs(a.z1 - b.z1),
  );
}

interface NaturalBounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}
const naturalBounds = new Map<string, NaturalBounds>();

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const building of BUILDINGS) {
    const bytes = readFileSync(path.join(ROOT, 'public', building.assetId.replace(/^\//, '')));
    const document = await io.readBinary(bytes);
    const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const m = node.getWorldMatrix();
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        const lo = position.getMinNormalized([]);
        const hi = position.getMaxNormalized([]);
        for (const x of [lo[0], hi[0]]) {
          for (const y of [lo[1], hi[1]]) {
            for (const z of [lo[2], hi[2]]) {
              const world = [
                m[0] * x + m[4] * y + m[8] * z + m[12],
                m[1] * x + m[5] * y + m[9] * z + m[13],
                m[2] * x + m[6] * y + m[10] * z + m[14],
              ];
              for (let axis = 0; axis < 3; axis++) {
                min[axis] = Math.min(min[axis], world[axis]);
                max[axis] = Math.max(max[axis], world[axis]);
              }
            }
          }
        }
      }
    });
    naturalBounds.set(building.id, {
      min,
      max,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    });
  }
});

function boundsOf(building: Building): NaturalBounds {
  const bounds = naturalBounds.get(building.id);
  if (!bounds) throw new Error(`no measured bounds for ${building.id}`);
  return bounds;
}

/** Placed-asset target height: a baked collision row is stored in multiples
 *  of the model's largest dimension over it. */
const PLACED_TARGET_HEIGHT = 2.2;

describe('the five placed Fenbridge buildings', () => {
  it('are the painted Tidehold set, one building per role', () => {
    expect(BUILDINGS.map((building) => [building.id, modelIdOf(building), building.kind])).toEqual([
      ['fenbridge_warden_gatehouse', 'tidehold/house_a', 'house'],
      ['fenbridge_crooked_reed_inn', 'tidehold/tavern', 'inn'],
      ['fenbridge_lantern_chapel', 'tidehold/hall', 'chapel'],
      ['fenbridge_moonwort_apothecary', 'tidehold/shop_b', 'house'],
      ['fenbridge_gilded_strongbox', 'tidehold/shop_a', 'house'],
    ]);
    for (const building of BUILDINGS) {
      expect(isPlacedBuildingAsset(building.assetId), building.id).toBe(true);
    }
  });

  it('stand grand, each at its own size, with their footing buried', () => {
    // the smallest size that clears a door of about five yards
    // (fenbridge_layout.ts); the chapel's portal already does at authored size
    expect(BUILDINGS.map((building) => [building.id, building.placement.scale])).toEqual([
      ['fenbridge_warden_gatehouse', 1.4],
      ['fenbridge_crooked_reed_inn', 1.2],
      ['fenbridge_lantern_chapel', 1],
      ['fenbridge_moonwort_apothecary', 1.5],
      ['fenbridge_gilded_strongbox', 1.5],
    ]);
    for (const building of BUILDINGS) {
      expect(building.placement.lift, building.id).toBeCloseTo(
        -(building.placement.scale + 0.05),
        9,
      );
      // one authored yard of footing, buried, the ground line a hair under the seat
      const groundLine =
        -boundsOf(building).min[1] * building.placement.scale + building.placement.lift;
      expect(groundLine, `${building.id} ground line`).toBeLessThan(0);
      expect(groundLine, `${building.id} ground line`).toBeGreaterThan(-0.06);
      // the walk-in rule reads the model's largest AUTHORED dimension, whatever
      // size the record stands at (its baked rows are stored in multiples of it)
      expect(building.placement.modelSize, building.id).toBeCloseTo(
        Math.max(...boundsOf(building).size),
        2,
      );
    }
  });

  it('reach across the whole model, measured off the shipped file', () => {
    for (const building of BUILDINGS) {
      const bounds = boundsOf(building);
      const scale = building.placement.scale;
      const measured: Rect = {
        x0: bounds.min[0] * scale,
        x1: bounds.max[0] * scale,
        z0: bounds.min[2] * scale,
        z1: bounds.max[2] * scale,
      };
      expect(
        worstEdge(rectOf(building, building.reach), measured),
        `${building.id} reach`,
      ).toBeLessThan(0.02);
      // the height the record reports is the part above the ground line
      expect(
        Math.abs(
          building.nativeDimensions.height - (bounds.size[1] * scale + building.placement.lift),
        ),
        `${building.id} height`,
      ).toBeLessThan(0.02);
    }
  });

  it('collide on their baked wall lines, never on their eaves', () => {
    for (const building of BUILDINGS) {
      const baked = BAKED[modelIdOf(building)];
      expect(baked, modelIdOf(building)).toBeDefined();
      // a row's unit: the model's largest dimension over the target height
      const unit =
        (Math.max(...boundsOf(building).size) / PLACED_TARGET_HEIGHT) * building.placement.scale;
      const boxes = baked.boxes.map((box) => {
        const cos = Math.abs(Math.cos(box.ry ?? 0));
        const sin = Math.abs(Math.sin(box.ry ?? 0));
        const ex = (box.hx * cos + box.hz * sin) * unit;
        const ez = (box.hx * sin + box.hz * cos) * unit;
        // the rows stand the model on its lowest point (its footing)
        const footing = -boundsOf(building).min[1] * building.placement.scale;
        return {
          x0: box.x * unit - ex,
          x1: box.x * unit + ex,
          z0: box.z * unit - ez,
          z1: box.z * unit + ez,
          y0: (box.y - box.hy) * unit - footing,
          y1: (box.y + box.hy) * unit - footing,
        };
      });
      const groundWalls = boxes.filter((box) => box.y0 < 0.1 && box.y1 - box.y0 >= 3.5);
      const walls = rectOf(building, building.footprint);
      const sides = [
        { name: 'west', at: walls.x0, face: 'x0', lo: walls.z0, hi: walls.z1, along: 'z' },
        { name: 'east', at: walls.x1, face: 'x1', lo: walls.z0, hi: walls.z1, along: 'z' },
        { name: 'front', at: walls.z0, face: 'z0', lo: walls.x0, hi: walls.x1, along: 'x' },
        { name: 'back', at: walls.z1, face: 'z1', lo: walls.x0, hi: walls.x1, along: 'x' },
      ] as const;
      for (const side of sides) {
        let covered = 0;
        for (const box of groundWalls) {
          if (Math.abs(box[side.face] - side.at) > 0.06) continue;
          const lo = side.along === 'z' ? box.z0 : box.x0;
          const hi = side.along === 'z' ? box.z1 : box.x1;
          covered += Math.max(0, Math.min(hi, side.hi) - Math.max(lo, side.lo));
        }
        // a door or a shopfront opens the wall line, never most of it
        expect(covered / (side.hi - side.lo), `${building.id} ${side.name} wall`).toBeGreaterThan(
          0.75,
        );
      }
      // the box sits well inside the reach: it is not the eaves
      const reach = rectOf(building, building.reach);
      expect(
        (reach.x1 - reach.x0) * (reach.z1 - reach.z0),
        `${building.id} reach area`,
      ).toBeGreaterThan((walls.x1 - walls.x0) * (walls.z1 - walls.z0) * 1.15);
      for (const annex of building.annexes) {
        const want = rectOf(building, annex);
        let best = Infinity;
        for (const box of boxes) best = Math.min(best, worstEdge(want, box));
        // ...or everything that stands on the ground inside it (a pair of
        // barrels with the awning post beside them)
        const inside = boxes.filter((box) => {
          if (box.y0 >= 0.1) return false;
          const cx = (box.x0 + box.x1) / 2;
          const cz = (box.z0 + box.z1) / 2;
          return (
            cx > want.x0 - 0.1 && cx < want.x1 + 0.1 && cz > want.z0 - 0.1 && cz < want.z1 + 0.1
          );
        });
        if (inside.length > 0) {
          best = Math.min(
            best,
            worstEdge(want, {
              x0: Math.min(...inside.map((box) => box.x0)),
              x1: Math.max(...inside.map((box) => box.x1)),
              z0: Math.min(...inside.map((box) => box.z0)),
              z1: Math.max(...inside.map((box) => box.z1)),
            }),
          );
        }
        expect(best, annex.id).toBeLessThan(0.06);
      }
    }
  });

  it('names the solid parts that stand outside each wall box', () => {
    expect(
      Object.fromEntries(
        BUILDINGS.map((building) => [building.id, building.annexes.map((annex) => annex.id)]),
      ),
    ).toEqual({
      fenbridge_warden_gatehouse: [],
      fenbridge_crooked_reed_inn: [
        'fenbridge_crooked_reed_inn:front_bench',
        'fenbridge_crooked_reed_inn:barrels',
      ],
      fenbridge_lantern_chapel: [
        'fenbridge_lantern_chapel:bell_tower',
        'fenbridge_lantern_chapel:notice_board',
      ],
      fenbridge_moonwort_apothecary: ['fenbridge_moonwort_apothecary:turret'],
      fenbridge_gilded_strongbox: [
        'fenbridge_gilded_strongbox:stall_counter',
        'fenbridge_gilded_strongbox:stall_barrels',
      ],
    });
  });
});

describe('placed Fenbridge building collision in the built-in world', () => {
  const recordOf = (building: Building) => {
    const record = ZONE2_PROPS.buildings.find((candidate) => candidate.id === building.id);
    if (!record) throw new Error(`no props record for ${building.id}`);
    return record;
  };

  it('gives a sealed record its wall box plus one box per annex', () => {
    for (const building of BUILDINGS) {
      const record = recordOf(building);
      expect(record).toMatchObject({
        x: building.position.x,
        z: building.position.z,
        w: building.nativeDimensions.width,
        d: building.nativeDimensions.depth,
        rot: building.rotation,
      });
      // without the world seed every record keeps the sealed shape
      const colliders = buildingRecordColliders(record, 30, () => 0);
      expect(colliders, building.id).toHaveLength(1 + building.annexes.length);
      building.annexes.forEach((annex, index) => {
        expect(colliders[index + 1], annex.id).toMatchObject({
          type: 'obb',
          x: annex.center.x,
          z: annex.center.z,
          hw: annex.halfWidth,
          hd: annex.halfDepth,
          rot: annex.rotation,
        });
      });
    }
    // a record a custom world moved leaves its annexes behind
    const inn = recordOf(BUILDINGS[1]);
    expect(placedBuildingAnnexes(inn)).toHaveLength(2);
    expect(placedBuildingAnnexes({ ...inn, x: inn.x + 4 })).toHaveLength(0);
  });

  it('makes the four buildings with an open doorway walk-in, and keeps the warden house shut', () => {
    expect(BUILDINGS.filter((building) => building.walkIn).map((building) => building.id)).toEqual([
      'fenbridge_crooked_reed_inn',
      'fenbridge_lantern_chapel',
      'fenbridge_moonwort_apothecary',
      'fenbridge_gilded_strongbox',
    ]);
  });

  it('collides a walk-in record on its own model baked boxes, seated on the terrain', () => {
    for (const building of BUILDINGS) {
      const record = recordOf(building);
      const colliders = buildingRecordColliders(record, 30, () => 0, WORLD_SEED);
      if (!building.walkIn) {
        expect(colliders, building.id).toHaveLength(1 + building.annexes.length);
        continue;
      }
      const baked = BAKED[modelIdOf(building)].boxes;
      expect(colliders, building.id).toHaveLength(baked.length);
      // the placement rule: the model stands on the terrain under its anchor,
      // never on the ground query, which already carries its own floor deck
      const unit = (building.placement.scale * building.placement.modelSize) / PLACED_TARGET_HEIGHT;
      const seat =
        terrainHeight(building.placement.x, building.placement.z, WORLD_SEED) +
        building.placement.lift;
      const lowestBox = Math.min(...baked.map((box) => box.y - box.hy));
      const lowestCollider = Math.min(
        ...colliders.map((collider) => (collider as { baseY?: number }).baseY ?? Infinity),
      );
      expect(lowestCollider, building.id).toBeCloseTo(seat + lowestBox * unit, 6);
      // every annex is still solid: a baked box stands inside it (a pair of
      // barrels can leave its very centre open)
      for (const annex of building.annexes) {
        const covered = colliders.some((collider) => {
          if (collider.type !== 'obb') return false;
          const local = rotY(
            collider.x - annex.center.x,
            collider.z - annex.center.z,
            -annex.rotation,
          );
          return (
            Math.abs(local.x) <= annex.halfWidth + 0.1 && Math.abs(local.z) <= annex.halfDepth + 0.1
          );
        });
        expect(covered, annex.id).toBe(true);
      }
      // a record a custom world moved is one sealed box again, annexes left behind
      expect(
        buildingRecordColliders({ ...record, x: record.x + 4 }, 30, () => 0, WORLD_SEED),
        building.id,
      ).toHaveLength(1);
    }
  });

  it('opens the doorway of each walk-in building, keeps its walls, and seals the rest', () => {
    for (const building of BUILDINGS) {
      const anchor = { x: building.placement.x, z: building.placement.z };
      const walls = rectOf(building, building.footprint);
      const door = toModelAxes(building, building.frontStandingPoint);
      // one stride inside the front wall, on the door's own line, asked for a
      // body standing on the ground there (the lintel and the storey above a
      // doorway are overhead, not in its way)
      const inside = localToWorld(anchor, building.placement.rotation, door.x, walls.z0 + 1);
      const standing = { y: groundHeight(inside.x, inside.z, WORLD_SEED), lift: 0 };
      expect(
        isBlocked(WORLD_SEED, inside.x, inside.z, 0.5, false, undefined, 0, standing),
        `${building.id} doorway`,
      ).toBe(!building.walkIn);
      const front = building.frontStandingPoint;
      expect(isBlocked(WORLD_SEED, front.x, front.z, 0.5), `${building.id} front`).toBe(false);
      for (const annex of building.annexes) {
        expect(isBlocked(WORLD_SEED, annex.center.x, annex.center.z), annex.id).toBe(true);
      }
      // the back wall still stands, straight across from the door
      const back = localToWorld(anchor, building.placement.rotation, door.x, walls.z1 - 0.1);
      expect(isBlocked(WORLD_SEED, back.x, back.z), `${building.id} back wall`).toBe(true);
    }
  });
});

describe('walking into the walk-in Fenbridge buildings', () => {
  const insideBy = (building: Building, depth: number) => {
    const walls = rectOf(building, building.footprint);
    const door = toModelAxes(building, building.frontStandingPoint);
    return localToWorld(
      { x: building.placement.x, z: building.placement.z },
      building.placement.rotation,
      door.x,
      walls.z0 + depth,
    );
  };

  it('raises the ground to the floor inside each walk-in building, and nowhere else', () => {
    for (const building of BUILDINGS) {
      const inside = insideBy(building, 2);
      const rise =
        groundHeight(inside.x, inside.z, WORLD_SEED) -
        terrainHeight(inside.x, inside.z, WORLD_SEED);
      if (building.walkIn) {
        // the painted floors stand a step to most of a yard over the ground line
        expect(rise, `${building.id} floor`).toBeGreaterThan(0.25);
        expect(rise, `${building.id} floor`).toBeLessThan(1.2);
      } else {
        expect(rise, `${building.id} floor`).toBe(0);
      }
      // four strides out of the door the street is the plain ground again
      const street = insideBy(building, -4);
      expect(groundHeight(street.x, street.z, WORLD_SEED), `${building.id} street`).toBe(
        terrainHeight(street.x, street.z, WORLD_SEED),
      );
    }
  });

  it('walks a player from the street through each open door onto its floor', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', world: BASE_WORLD });
    const body = sim.player;
    const meta = sim.players.get(body.id);
    if (!meta) throw new Error('missing player meta');
    for (const building of BUILDINGS.filter((candidate) => candidate.walkIn)) {
      const start = building.frontStandingPoint;
      const goal = insideBy(building, 3);
      body.pos.x = start.x;
      body.pos.z = start.z;
      body.pos.y = groundHeight(start.x, start.z, WORLD_SEED);
      body.prevPos = { ...body.pos };
      body.facing = Math.atan2(goal.x - start.x, goal.z - start.z);
      for (let i = 0; i < 20 * 2; i++) {
        Object.assign(meta.moveInput, {
          forward: true,
          back: false,
          turnLeft: false,
          turnRight: false,
          strafeLeft: false,
          strafeRight: false,
          jump: false,
          dive: false,
          surface: false,
        });
        sim.tick();
      }
      Object.assign(meta.moveInput, { forward: false });
      for (let i = 0; i < 20; i++) sim.tick();
      const walls = rectOf(building, building.footprint);
      const local = toModelAxes(building, body.pos);
      expect(local.z, `${building.id}: got past the door`).toBeGreaterThan(walls.z0 + 1.5);
      expect(local.x, building.id).toBeGreaterThan(walls.x0);
      expect(local.x, building.id).toBeLessThan(walls.x1);
      // standing on the raised floor, not sunk to the ground line under it
      expect(body.pos.y, building.id).toBeCloseTo(
        groundHeight(body.pos.x, body.pos.z, WORLD_SEED),
        3,
      );
      expect(body.pos.y - terrainHeight(body.pos.x, body.pos.z, WORLD_SEED)).toBeGreaterThan(0.25);
    }
  });

  it('leaves the floors of a Studio document to its own placements', () => {
    // Eastbrook and Highwatch stand their own walk-in floors beside these
    const fenbridgePaths = new Set(BUILDINGS.map((building) => building.assetId));
    const builtIn = townWalkInPlacements(BASE_WORLD).filter((placement) =>
      fenbridgePaths.has(placement.path),
    );
    expect(builtIn).toHaveLength(4);
    expect(
      townWalkInPlacements(loadPublishedMap()).filter((placement) =>
        BUILDINGS.some(
          (building) =>
            building.assetId === placement.path &&
            building.placement.x === placement.x &&
            building.placement.z === placement.z,
        ),
      ),
    ).toEqual([]);
  });
});

describe('the ground under the placed Fenbridge buildings', () => {
  it('never rises through a floor, and the footing covers every dip', () => {
    for (const building of BUILDINGS) {
      const seat = terrainHeight(building.placement.x, building.placement.z, WORLD_SEED);
      const box = building.reach;
      let low = Infinity;
      let high = -Infinity;
      for (let lx = -box.halfWidth; lx <= box.halfWidth + 1e-6; lx += 0.5) {
        for (let lz = -box.halfDepth; lz <= box.halfDepth + 1e-6; lz += 0.5) {
          const point = localToWorld(box.center, box.rotation, lx, lz);
          const y = terrainHeight(point.x, point.z, WORLD_SEED);
          low = Math.min(low, y);
          high = Math.max(high, y);
        }
      }
      // the ground line sits 0.05 under the seat: a rise of more would show
      // grass through the floor
      expect(high - seat, `${building.id} high ground`).toBeLessThan(0.05);
      const footing = -boundsOf(building).min[1] * building.placement.scale;
      expect(seat - low, `${building.id} low ground`).toBeLessThan(footing - 0.3);
    }
  });
});

describe('the street lamps around the placed Fenbridge buildings', () => {
  it('stand clear of every building, porch and eave, and off every door step', () => {
    const hub = FENBRIDGE_LAYOUT.hub.center;
    isBlocked(WORLD_SEED, hub.x, hub.z); // plans the lamp network with the grid
    const lamps = streetlampPlacements(WORLD_SEED).filter(
      (lamp) => Math.hypot(lamp.x - hub.x, lamp.z - hub.z) < 60,
    );
    expect(lamps.length).toBeGreaterThan(0);
    for (const lamp of lamps) {
      const at = `lamp at ${lamp.x.toFixed(2)}, ${lamp.z.toFixed(2)}`;
      for (const building of BUILDINGS) {
        const local = toModelAxes(building, lamp);
        const reach = rectOf(building, building.reach);
        const within =
          local.x > reach.x0 && local.x < reach.x1 && local.z > reach.z0 && local.z < reach.z1;
        expect(within, `${at} in ${building.id}`).toBe(false);
        const step = building.frontStandingPoint;
        expect(
          Math.hypot(lamp.x - step.x, lamp.z - step.z),
          `${at} by the ${building.id} door`,
        ).toBeGreaterThan(3);
      }
    }
  });
});

// Fenbridge in ClaudeCraft Studio. A maker rearranges the town in the
// published Studio map (data/maps/eastbrook_rebuild.map.json, the shipped
// world with both rebuilt towns) or in a new map from the world: either way
// every building is an ordinary placement they can select and move, standing
// where the game stands it.

interface StudioPlacement {
  assetId: string;
  x: number;
  z: number;
  y?: number;
  rotY?: number;
  scale?: number;
  scaleX?: number;
  collide?: boolean;
  collisionMode?: string;
}
const REBUILD_MAP = JSON.parse(
  readFileSync(path.join(ROOT, 'data/maps/eastbrook_rebuild.map.json'), 'utf8'),
) as {
  placements: StudioPlacement[];
  content: {
    npcs: Record<string, { pos: { x: number; z: number }; facing?: number }>;
    roads: { x: number; z: number }[][];
  };
  terrainEdits: Record<string, unknown>[];
};

/** The kit buildings the rebuild retired (their models stay shipped for Studio). */
const RETIRED_KIT_BUILDING =
  /^props\/fenbridge_(warden_gatehouse|crooked_reed_inn|lantern_chapel|moonwort_apothecary|gilded_strongbox|hesk_tannery|scout_lodge)$/;

function placementAssetIdOf(building: Building): string {
  return building.assetId.replace(/^\/models\//, '').replace(/\.glb$/, '');
}

/** A yard grid across a record's wall box, a stride in from every wall,
 *  optionally shifted. */
function wallBoxGrid(building: Building, dx = 0, dz = 0): { x: number; z: number }[] {
  const box = building.footprint;
  const out: { x: number; z: number }[] = [];
  for (let lx = -box.halfWidth + 1; lx <= box.halfWidth - 1 + 1e-6; lx += 1) {
    for (let lz = -box.halfDepth + 1; lz <= box.halfDepth - 1 + 1e-6; lz += 1) {
      const point = localToWorld(box.center, box.rotation, lx, lz);
      out.push({ x: point.x + dx, z: point.z + dz });
    }
  }
  return out;
}

describe('Fenbridge in Studio', () => {
  it('turns each building into one movable placement at the spot the game stands it', () => {
    const converted = authoredTownBuildingPlacements(WORLD_SEED);
    for (const building of BUILDINGS) {
      const placed = converted.filter((p) => p.assetId === placementAssetIdOf(building));
      expect(placed, building.id).toHaveLength(1);
      expect(placed[0]).toMatchObject({
        x: building.placement.x,
        z: building.placement.z,
        y: building.placement.lift,
        collide: true,
        collisionMode: 'baked',
      });
      expect(placed[0].rotY).toBeCloseTo(building.placement.rotation, 9);
      // one uniform scale over the model's largest dimension, the placed-asset rule
      const largest = Math.max(...boundsOf(building).size);
      expect(placed[0].scale, building.id).toBeCloseTo(
        (building.placement.scale * largest) / PLACED_TARGET_HEIGHT,
        2,
      );
      expect(placed[0].scaleX, building.id).toBeUndefined();
    }
  });

  it('stands the rebuilt town in the published Studio map, with no kit building left over', () => {
    const converted = authoredTownBuildingPlacements(WORLD_SEED);
    for (const building of BUILDINGS) {
      const want = converted.find((p) => p.assetId === placementAssetIdOf(building));
      if (!want) throw new Error(`no Studio placement for ${building.id}`);
      const placed = REBUILD_MAP.placements.filter(
        (p) => p.assetId === placementAssetIdOf(building),
      );
      expect(placed, building.id).toHaveLength(1);
      expect(placed[0]).toMatchObject({
        x: want.x,
        z: want.z,
        y: want.y,
        collide: true,
        collisionMode: 'baked',
      });
      expect(placed[0].rotY ?? 0, building.id).toBeCloseTo(want.rotY, 9);
      expect(placed[0].scale ?? 1, building.id).toBeCloseTo(want.scale, 9);
    }
    const leftover = REBUILD_MAP.placements
      .filter((p) => RETIRED_KIT_BUILDING.test(p.assetId))
      .map((p) => p.assetId);
    expect(leftover).toEqual([]);
  });

  it('stands the townsfolk and runs the streets in the Studio map where the game does', () => {
    for (const npc of FENBRIDGE_LAYOUT.services.npcs) {
      const doc = REBUILD_MAP.content.npcs[npc.id];
      if (!doc) throw new Error(`the Studio map has no ${npc.id}`);
      expect(doc.pos.x, npc.id).toBeCloseTo(npc.position.x, 9);
      expect(doc.pos.z, npc.id).toBeCloseTo(npc.position.z, 9);
      expect(doc.facing ?? 0, npc.id).toBeCloseTo(npc.facing, 9);
    }
    const hub = FENBRIDGE_LAYOUT.hub.center;
    const touchesTown = (road: readonly { x: number; z: number }[]) =>
      road.some((q) => Math.hypot(q.x - hub.x, q.z - hub.z) < 40);
    const gameStreets = BASE_WORLD.roads.filter(touchesTown);
    expect(gameStreets.length).toBeGreaterThan(0);
    expect(REBUILD_MAP.content.roads.filter(touchesTown)).toEqual(gameStreets);
  });

  it('levels the Studio map ground under the grand buildings with the pads the game stamps', () => {
    // every pad, in the layout's own order, where the built-in world stamps
    // them: straight after the moderation cage's
    const pads = FENBRIDGE_LAYOUT.pads;
    expect(pads.length).toBeGreaterThan(0);
    const after = JAIL_TERRAIN_EDITS.length;
    const at = pads.map((pad) =>
      REBUILD_MAP.terrainEdits.findIndex(
        (edit) =>
          edit.x === pad.x &&
          edit.z === pad.z &&
          edit.radius === pad.radius &&
          edit.delta === pad.delta &&
          edit.hardness === pad.hardness &&
          edit.falloff === pad.falloff &&
          edit.mode === pad.mode,
      ),
    );
    expect(at).toEqual(pads.map((_, index) => after + index));
    const builtIn = BASE_WORLD.terrainEdits ?? [];
    expect(builtIn.slice(after, after + pads.length)).toEqual([...pads]);
    // ...and no other stamp of the map reaches the town's ground, so the pads
    // have the last word there wherever they sit in the list
    const others = [
      ...REBUILD_MAP.terrainEdits.slice(0, after),
      ...REBUILD_MAP.terrainEdits.slice(after + pads.length),
    ] as unknown as { x: number; z: number; radius: number }[];
    expect(others.length).toBeGreaterThan(HIGHWATCH_LAYOUT.pads.length);
    for (const edit of others) {
      const near = Math.hypot(
        Math.max(-60 - edit.x, 0, edit.x - 60),
        Math.max(240 - edit.z, 0, edit.z - 370),
      );
      expect(near, `Studio stamp at ${edit.x}, ${edit.z}`).toBeGreaterThanOrEqual(edit.radius);
    }
  });

  it('hands the game copy of the Studio map current town records, so its record walls stand down', () => {
    const world = loadPublishedMap();
    const collision = (world.assetCollision ?? {}) as Record<string, readonly unknown[]>;
    for (const building of BUILDINGS) {
      const record = world.props.buildings.find((candidate) => candidate.id === building.id);
      if (!record) throw new Error(`the published map has no ${building.id} record`);
      expect(isAuthoredTownBuildingDef(record), building.id).toBe(true);
      expect(promotedTownBuildingStandsDown(world.promotedScenery, record), building.id).toBe(true);
      expect(collision[building.assetId]?.length ?? 0, building.assetId).toBeGreaterThan(0);
    }
  });

  it('moves a building with its walls and rest area when a maker moves it, leaving nothing behind', () => {
    const world = loadPublishedMap();
    const inn = BUILDINGS.find((building) => building.kind === 'inn');
    if (!inn) throw new Error('no Fenbridge inn');
    const index = (world.placements ?? []).findIndex((p) => p.path === inn.assetId);
    expect(index).toBeGreaterThanOrEqual(0);
    // a maker drags the inn eight yards west
    const SHIFT = 8;
    const moved: WorldContent = {
      ...world,
      placements: (world.placements ?? []).map((p, i) =>
        i === index ? { ...p, x: p.x + SHIFT } : p,
      ),
    };
    const walls = rectOf(inn, inn.footprint);
    const underMovedInn = (point: { x: number; z: number }) => {
      const local = toModelAxes(inn, { x: point.x - SHIFT, z: point.z });
      return (
        local.x > walls.x0 - 1.5 &&
        local.x < walls.x1 + 1.5 &&
        local.z > walls.z0 - 1.5 &&
        local.z < walls.z1 + 1.5
      );
    };
    const blockedCount = (content: WorldContent, points: { x: number; z: number }[]) => {
      setActiveWorldContent(content);
      try {
        return points.filter((point) => isBlocked(MAP_SEED, point.x, point.z)).length;
      } finally {
        setActiveWorldContent(null);
      }
    };
    const vacated = wallBoxGrid(inn).filter((point) => !underMovedInn(point));
    expect(vacated.length).toBeGreaterThan(20);
    // the inn blocks where it stands, and stops blocking there once it is moved
    expect(blockedCount(world, vacated)).toBeGreaterThan(0);
    expect(blockedCount(moved, vacated)).toBe(0);
    expect(blockedCount(moved, wallBoxGrid(inn, SHIFT, 0))).toBeGreaterThan(0);
    // its rest area rides the placement (the placement path alone, records aside)
    const body = (point: { x: number; z: number }) =>
      ({ inCombat: false, pos: { x: point.x, y: 0, z: point.z } }) as unknown as Entity;
    setActiveWorldContent(moved);
    try {
      const centre = inn.footprint.center;
      expect(isResting(body({ x: centre.x + SHIFT, z: centre.z }), [], [], false)).toBe(true);
      expect(isResting(body(vacated[0]), [], [], false)).toBe(false);
    } finally {
      setActiveWorldContent(null);
    }
  });
});

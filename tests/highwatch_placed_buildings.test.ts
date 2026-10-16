import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  authoredTownBuildingPlacements,
  FEATURE_PROMOTIONS,
  highwatchOldKitPlacements,
  highwatchTownBuildingPlacements,
  promoteFeatureDressing,
} from '../src/editor/feature_prop_placements';
import { isPlacedBuildingAsset } from '../src/render/eastbrook_placed_building';
import {
  buildingRecordColliders,
  promotedTownBuildingStandsDown,
} from '../src/sim/authored_town_buildings';
import { AUTHORED_TOWNS } from '../src/sim/authored_town_registry';
import { rotY } from '../src/sim/collider_shapes';
import { isBlocked } from '../src/sim/colliders';
import { ZONE3_PROPS } from '../src/sim/content/zone3';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { isExcludedDecoration } from '../src/sim/decoration_exclusions';
import { HIGHWATCH_LAYOUT } from '../src/sim/highwatch_layout';
import { loadPublishedMap, MAP_SEED } from '../src/sim/maps/eastbrook_rebuild.generated';
import { distancePointToObb, localToWorld, type Obb2 } from '../src/sim/placed_town_kit';
import { isResting } from '../src/sim/progression/xp';
import { Sim } from '../src/sim/sim';
import { townWalkInPlacements } from '../src/sim/town_walk_in';
import type { BuildingDef, Entity, WorldContent } from '../src/sim/types';
import { generateDecorationsInBounds, groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The built-in Highwatch stands five painted Tidehold buildings (in the
// Highwatch look) round its square, and the lord's manor on the north hill,
// built for Highwatch alone (scripts/assets/highwatch_manor/). This suite
// measures each layout record off the things it was copied from: the model's
// shipped geometry (a look re-bakes only the textures of the default model,
// tests/tidehold_texture_tiers.test.ts) and the model's baked collision rows;
// then walks into the open ones.

const ROOT = path.join(__dirname, '..');
const BUILDINGS = HIGHWATCH_LAYOUT.buildings;
type Building = (typeof BUILDINGS)[number];
/** The manor ships only in the Highwatch look, at its own grand size, so it has no default
 *  model of the painted set and stands at scale 1. */
const MANOR_ID = 'highwatch_manor';

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
) as Record<string, { boxes: BakedBox[]; ramps?: BakedBox[] }>;

/** The model a record draws: `tidehold/highwatch/x` re-bakes the textures of
 *  `tidehold/x` on the same geometry, so it shares its rows. */
function modelIdOf(building: Building): string {
  const name = building.assetId.replace(/^.*\//, '').replace(/\.glb$/, '');
  return building.id === MANOR_ID ? `tidehold/highwatch/${name}` : `tidehold/${name}`;
}

function recordOf(building: Building): BuildingDef {
  const record = ZONE3_PROPS.buildings.find((candidate) => candidate.id === building.id);
  if (!record) throw new Error(`no props record for ${building.id}`);
  return record;
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

async function measure(io: NodeIO, file: string): Promise<NaturalBounds> {
  const document = await io.readBinary(readFileSync(path.join(ROOT, 'public', file)));
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
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const building of BUILDINGS) {
    // the look's own file: the geometry the game draws
    naturalBounds.set(building.id, await measure(io, building.assetId.replace(/^\//, '')));
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

describe('the six placed Highwatch buildings', () => {
  it('are the painted Tidehold set in the Highwatch look', () => {
    expect(BUILDINGS.map((building) => [building.id, modelIdOf(building), building.kind])).toEqual([
      ['highwatch_summit_inn', 'tidehold/tavern_b', 'inn'],
      ['highwatch_gate_chapel', 'tidehold/hall', 'chapel'],
      ['highwatch_counting_house', 'tidehold/shop_a', 'house'],
      ['highwatch_watch_house', 'tidehold/house_c', 'house'],
      ['highwatch_smithy', 'tidehold/smithy', 'house'],
      ['highwatch_manor', 'tidehold/highwatch/manor', 'house'],
    ]);
    for (const building of BUILDINGS) {
      expect(isPlacedBuildingAsset(building.assetId), building.id).toBe(true);
      expect(building.assetId.startsWith('/models/tidehold/highwatch/'), building.id).toBe(true);
    }
  });

  it('stand grand, each at its own size, with their footing buried', () => {
    for (const building of BUILDINGS) {
      if (building.id === MANOR_ID) expect(building.placement.scale).toBe(1);
      else expect(building.placement.scale, building.id).toBeGreaterThanOrEqual(1.2);
      expect(building.placement.lift, building.id).toBeCloseTo(
        -(building.placement.scale + 0.05),
        9,
      );
      const groundLine =
        -boundsOf(building).min[1] * building.placement.scale + building.placement.lift;
      expect(groundLine, `${building.id} ground line`).toBeLessThan(0);
      expect(groundLine, `${building.id} ground line`).toBeGreaterThan(-0.06);
      // the walk-in rule reads the model's largest dimension
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
      expect(
        Math.abs(
          building.nativeDimensions.height - (bounds.size[1] * scale + building.placement.lift),
        ),
        `${building.id} height`,
      ).toBeLessThan(0.02);
    }
  });

  it('collide on their baked wall lines, and name the solid parts outside them', () => {
    for (const building of BUILDINGS) {
      const baked = BAKED[modelIdOf(building)];
      expect(baked, modelIdOf(building)).toBeDefined();
      // the look carries its default model's rows (the manor IS the look's own model)
      if (building.id !== MANOR_ID) {
        expect(
          BAKED[`tidehold/highwatch/${modelIdOf(building).slice('tidehold/'.length)}`],
        ).toEqual(baked);
      }
      const unit =
        (Math.max(...boundsOf(building).size) / PLACED_TARGET_HEIGHT) * building.placement.scale;
      const footing = -boundsOf(building).min[1] * building.placement.scale;
      const boxes = baked.boxes.map((box) => {
        const cos = Math.abs(Math.cos(box.ry ?? 0));
        const sin = Math.abs(Math.sin(box.ry ?? 0));
        const ex = (box.hx * cos + box.hz * sin) * unit;
        const ez = (box.hx * sin + box.hz * cos) * unit;
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
          0.6,
        );
      }
      const decks = (baked.ramps ?? []).map((deck) => {
        const cos = Math.abs(Math.cos(deck.ry ?? 0));
        const sin = Math.abs(Math.sin(deck.ry ?? 0));
        const ex = (deck.hx * cos + deck.hz * sin) * unit;
        const ez = (deck.hx * sin + deck.hz * cos) * unit;
        return {
          x0: deck.x * unit - ex,
          x1: deck.x * unit + ex,
          z0: deck.z * unit - ez,
          z1: deck.z * unit + ez,
        };
      });
      for (const annex of building.annexes) {
        const want = rectOf(building, annex);
        let best = Infinity;
        for (const box of boxes) best = Math.min(best, worstEdge(want, box));
        // a covered floor outside the walls (the forge shelter) is its deck
        for (const deck of decks) best = Math.min(best, worstEdge(want, deck));
        // ...or everything that stands on the ground inside it
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
    expect(
      Object.fromEntries(
        BUILDINGS.map((building) => [building.id, building.annexes.map((annex) => annex.id)]),
      ),
    ).toEqual({
      highwatch_summit_inn: ['highwatch_summit_inn:turret', 'highwatch_summit_inn:chimney'],
      highwatch_gate_chapel: [
        'highwatch_gate_chapel:bell_tower',
        'highwatch_gate_chapel:notice_board',
      ],
      highwatch_counting_house: [
        'highwatch_counting_house:stall_counter',
        'highwatch_counting_house:stall_barrels',
      ],
      highwatch_watch_house: ['highwatch_watch_house:tower'],
      highwatch_smithy: ['highwatch_smithy:forge_shelter', 'highwatch_smithy:chimney'],
      highwatch_manor: [
        'highwatch_manor:west_wing',
        'highwatch_manor:east_wing',
        'highwatch_manor:dais_bay',
        'highwatch_manor:kitchen_chimney',
      ],
    });
  });
});

describe('placed Highwatch building collision in the built-in world', () => {
  it('makes the five open buildings walk-in, and keeps the watch house shut', () => {
    expect(BUILDINGS.filter((building) => building.walkIn).map((building) => building.id)).toEqual([
      'highwatch_summit_inn',
      'highwatch_gate_chapel',
      'highwatch_counting_house',
      'highwatch_smithy',
      'highwatch_manor',
    ]);
  });

  it('collides a walk-in record on its own model baked boxes, a sealed one on its box', () => {
    for (const building of BUILDINGS) {
      const record = recordOf(building);
      const colliders = buildingRecordColliders(record, 30, () => 0, WORLD_SEED);
      if (!building.walkIn) {
        expect(colliders, building.id).toHaveLength(1 + building.annexes.length);
        continue;
      }
      const baked = BAKED[modelIdOf(building)].boxes;
      expect(colliders, building.id).toHaveLength(baked.length);
      const unit =
        (building.placement.scale * (building.placement.modelSize ?? 0)) / PLACED_TARGET_HEIGHT;
      const seat =
        terrainHeight(building.placement.x, building.placement.z, WORLD_SEED) +
        building.placement.lift;
      const lowestBox = Math.min(...baked.map((box) => box.y - box.hy));
      const lowestCollider = Math.min(
        ...colliders.map((collider) => (collider as { baseY?: number }).baseY ?? Infinity),
      );
      expect(lowestCollider, building.id).toBeCloseTo(seat + lowestBox * unit, 6);
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
      // a record a custom world moved is one sealed box again
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
      const inside = localToWorld(anchor, building.placement.rotation, door.x, walls.z0 + 1);
      const standing = { y: groundHeight(inside.x, inside.z, WORLD_SEED), lift: 0 };
      expect(
        isBlocked(WORLD_SEED, inside.x, inside.z, 0.5, false, undefined, 0, standing),
        `${building.id} doorway`,
      ).toBe(!building.walkIn);
      const front = building.frontStandingPoint;
      expect(isBlocked(WORLD_SEED, front.x, front.z, 0.5), `${building.id} front`).toBe(false);
      // (the manor's back wall opens in its middle onto the dais bay: its probe stands off it)
      const backX = building.id === MANOR_ID ? door.x + 9 : door.x;
      const back = localToWorld(anchor, building.placement.rotation, backX, walls.z1 - 0.1);
      expect(isBlocked(WORLD_SEED, back.x, back.z), `${building.id} back wall`).toBe(true);
    }
  });

  it('clears the scatter its buildings stand on, in the game and in the Studio map', () => {
    // the scatter only keeps clear of the hub's ring, and the buildings reach
    // past it: the pine and the rock in the chapel nave, then every tree whose
    // crown and every rock whose shoulder reached a wall
    const CLEARED = [
      { x: -18.039, z: 624.694 },
      { x: -10.043, z: 630.927 },
      { x: -10.244, z: 618.3 },
      { x: 22.009, z: 634.679 },
      { x: 20.702, z: 704.601 },
      { x: 33.195, z: 650.412 },
      { x: 31.928, z: 667.127 },
      // stood grand, the buildings reach further
      { x: -25.576, z: 668.259 },
      { x: 27.314, z: 648.031 },
      { x: 34.786, z: 673.567 },
      { x: 31.334, z: 708.04 },
    ];
    for (const point of CLEARED) {
      expect(isExcludedDecoration(point.x, point.z), `${point.x}, ${point.z}`).toBe(true);
    }
    const bounds = { minX: -60, maxX: 70, minZ: 590, maxZ: 740 };
    for (const [name, world, seed] of [
      ['built-in', null, WORLD_SEED],
      ['Studio', loadPublishedMap(), MAP_SEED],
    ] as const) {
      setActiveWorldContent(world);
      try {
        const scatter = generateDecorationsInBounds(seed, bounds);
        // not vacuous: the town's ring still carries its scatter (the manor's clearing
        // took some 19 trees and rocks off the rise west of the Sanctum road)
        expect(scatter.length, name).toBeGreaterThan(20);
        for (const decoration of scatter) {
          // a pine's crown spreads about 3 yd, a boulder's shoulder 1.5
          const clearance = decoration.kind === 'rock' ? 1.5 : 3;
          for (const building of BUILDINGS) {
            expect(
              distancePointToObb(decoration, building.reach),
              `${name}: ${decoration.kind} at ${decoration.x.toFixed(2)}, ${decoration.z.toFixed(2)} by ${building.id}`,
            ).toBeGreaterThan(clearance);
          }
        }
      } finally {
        setActiveWorldContent(null);
      }
    }
  });

  it('stands the records down only for a document that promoted Highwatch', () => {
    for (const building of BUILDINGS) {
      const record = recordOf(building);
      expect(promotedTownBuildingStandsDown(undefined, record)).toBe(false);
      expect(promotedTownBuildingStandsDown({ authoredTowns: true }, record)).toBe(false);
      expect(promotedTownBuildingStandsDown({ highwatchTown: true }, record)).toBe(true);
    }
    // ...and the Highwatch family never reaches the other towns' buildings
    const otherIds = new Set(
      AUTHORED_TOWNS.filter((town) => town.id !== 'highwatch').flatMap((town) =>
        town.buildings.map((building) => building.id),
      ),
    );
    const others = BUILTIN_WORLD.props.buildings.filter(
      (record) => record.id !== undefined && otherIds.has(record.id),
    );
    expect(others.length).toBeGreaterThanOrEqual(10);
    for (const record of others) {
      expect(promotedTownBuildingStandsDown({ highwatchTown: true }, record), record.id).toBe(
        false,
      );
      expect(promotedTownBuildingStandsDown({ authoredTowns: true }, record), record.id).toBe(true);
    }
  });
});

describe('walking into the walk-in Highwatch buildings', () => {
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
        expect(rise, `${building.id} floor`).toBeGreaterThan(0.25);
        expect(rise, `${building.id} floor`).toBeLessThan(1.2);
      } else {
        expect(rise, `${building.id} floor`).toBe(0);
      }
      // (the manor's street is past its porch and steps)
      const street = insideBy(building, building.id === MANOR_ID ? -10 : -4);
      expect(groundHeight(street.x, street.z, WORLD_SEED), `${building.id} street`).toBe(
        terrainHeight(street.x, street.z, WORLD_SEED),
      );
    }
  });

  it('walks a player from the street through each open door onto its floor', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
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
      expect(body.pos.y, building.id).toBeCloseTo(
        groundHeight(body.pos.x, body.pos.z, WORLD_SEED),
        3,
      );
      expect(body.pos.y - terrainHeight(body.pos.x, body.pos.z, WORLD_SEED)).toBeGreaterThan(0.25);
    }
  });

  it('stands the floors of the built-in world, never of the Studio map', () => {
    const paths = townWalkInPlacements(BUILTIN_WORLD).map((placement) => placement.path);
    for (const building of BUILDINGS.filter((candidate) => candidate.walkIn)) {
      expect(paths).toContain(building.assetId);
    }
    expect(townWalkInPlacements(loadPublishedMap())).toEqual([]);
  });
});

describe('Highwatch in WoC Studio', () => {
  it('rests a traveller in the Studio inn, across its walls, wherever a maker moves it', () => {
    const inn = BUILDINGS.find((building) => building.kind === 'inn');
    if (!inn) throw new Error('missing inn');
    const world = loadPublishedMap();
    const index = (world.placements ?? []).findIndex((p) => p.path === inn.assetId);
    expect(index).toBeGreaterThanOrEqual(0);
    // far enough that the moved inn and its old spot share no ground
    const SHIFT = 60;
    const moved: WorldContent = {
      ...world,
      placements: (world.placements ?? []).map((p, i) =>
        i === index ? { ...p, x: p.x + SHIFT } : p,
      ),
    };
    const body = (point: { x: number; z: number }) =>
      ({ inCombat: false, pos: { x: point.x, y: 0, z: point.z } }) as unknown as Entity;
    const anchor = { x: inn.placement.x + SHIFT, z: inn.placement.z };
    const walls = rectOf(inn, inn.footprint);
    const at = (lx: number, lz: number) => localToWorld(anchor, inn.placement.rotation, lx, lz);
    setActiveWorldContent(moved);
    try {
      // the rest area rides the placement (the built-in record is not in a
      // Studio document), not the old spot
      expect(
        isResting(body(at((walls.x0 + walls.x1) / 2, (walls.z0 + walls.z1) / 2)), [], [], false),
      ).toBe(true);
      expect(isResting(body(inn.footprint.center), [], [], false)).toBe(false);
      // wall-sized: just inside each corner rests, three yards past the front does not
      for (const [lx, lz] of [
        [walls.x0 + 1, walls.z0 + 1],
        [walls.x1 - 1, walls.z0 + 1],
        [walls.x0 + 1, walls.z1 - 1],
        [walls.x1 - 1, walls.z1 - 1],
      ]) {
        expect(isResting(body(at(lx, lz)), [], [], false), `${lx}, ${lz}`).toBe(true);
      }
      expect(isResting(body(at((walls.x0 + walls.x1) / 2, walls.z0 - 3)), [], [], false)).toBe(
        false,
      );
    } finally {
      setActiveWorldContent(null);
    }
  });

  it('promotes the six buildings as their own family, placed exactly as the game stands them', () => {
    expect(FEATURE_PROMOTIONS.map((family) => family.flag)).toContain('highwatchTown');
    const placements = highwatchTownBuildingPlacements(WORLD_SEED);
    expect(placements.map((placement) => placement.assetId)).toEqual(
      BUILDINGS.map((building) =>
        building.assetId.replace(/^\/models\//, '').replace(/\.glb$/, ''),
      ),
    );
    for (const [index, building] of BUILDINGS.entries()) {
      const placement = placements[index];
      expect(placement).toMatchObject({
        x: building.placement.x,
        z: building.placement.z,
        y: building.placement.lift,
        collide: true,
        collisionMode: 'baked',
      });
      expect(placement.scale).toBeCloseTo(
        (Math.max(...boundsOf(building).size) / PLACED_TARGET_HEIGHT) * building.placement.scale,
        3,
      );
      // turned as the game turns it: a flipped yaw would face every door away
      expect(placement.rotY, building.id).toBeCloseTo(building.placement.rotation, 9);
    }
    // the family's promotion places exactly these
    expect(
      FEATURE_PROMOTIONS.find((family) => family.flag === 'highwatchTown')?.placements(WORLD_SEED),
    ).toEqual(placements);
    // the older family keeps only Eastbrook and Fenbridge
    expect(
      authoredTownBuildingPlacements(WORLD_SEED).some((placement) =>
        placement.assetId.startsWith('tidehold/highwatch/'),
      ),
    ).toBe(false);
  });

  it("trades an older document's Highwatch kit houses for the painted town on load", () => {
    // a fully editable document saved before the rebuild: every other family
    // promoted, and the full-world conversion's six kit placements for
    // Highwatch's five old buildings, one of them moved by its maker
    const oldKit = highwatchOldKitPlacements(WORLD_SEED);
    expect(oldKit.map((placement) => placement.assetId).sort()).toEqual([
      'props/bell_tower',
      'props/blacksmith',
      'props/house_1',
      'props/house_2',
      'props/house_3',
      'props/inn',
    ]);
    const moved = { ...oldKit[0], x: oldKit[0].x + 3 };
    const keeper = { ...oldKit[1], assetId: 'props/well', x: 40, z: 600 };
    const doc = {
      placements: [...oldKit.slice(1), moved, keeper],
      promotedScenery: Object.fromEntries(
        FEATURE_PROMOTIONS.filter((family) => family.flag !== 'highwatchTown').map((family) => [
          family.flag,
          true,
        ]),
      ) as Record<string, boolean>,
      propsMode: 'editable-all' as const,
      content: { zones: BUILTIN_WORLD.zones },
      meta: { seed: WORLD_SEED },
    };
    expect(promoteFeatureDressing(doc)).toBe(1);
    expect(doc.promotedScenery.highwatchTown).toBe(true);
    // the painted buildings are in, the untouched kit houses are out
    const painted = doc.placements.filter((placement) =>
      placement.assetId.startsWith('tidehold/highwatch/'),
    );
    // the five painted buildings and the manor
    expect(painted).toHaveLength(BUILDINGS.length);
    for (const old of oldKit.slice(1)) {
      expect(doc.placements, old.assetId).not.toContainEqual(old);
    }
    // what the maker moved, and everything else, stays
    expect(doc.placements).toContainEqual(moved);
    expect(doc.placements).toContainEqual(keeper);
    expect(doc.placements).toHaveLength(2 + BUILDINGS.length);
    // and loading it again changes nothing
    expect(promoteFeatureDressing(doc)).toBe(0);
    expect(doc.placements).toHaveLength(2 + BUILDINGS.length);
  });

  it('ships the rebuilt town in the published Eastbrook Rebuild map', () => {
    const map = loadPublishedMap();
    expect(map.promotedScenery).toMatchObject({ authoredTowns: true, highwatchTown: true });
    const placed = (map.placements ?? []).filter((placement) =>
      placement.path.startsWith('/models/tidehold/highwatch/'),
    );
    expect(placed.map((placement) => placement.path).sort()).toEqual(
      BUILDINGS.map((building) => building.assetId).sort(),
    );
    const studio = highwatchTownBuildingPlacements(WORLD_SEED);
    for (const [index, building] of BUILDINGS.entries()) {
      const placement = placed.find((candidate) => candidate.path === building.assetId);
      expect(placement?.x, building.id).toBeCloseTo(building.placement.x, 6);
      expect(placement?.z, building.id).toBeCloseTo(building.placement.z, 6);
      expect(placement?.rotY, building.id).toBeCloseTo(building.placement.rotation, 9);
      expect(placement?.scale, building.id).toBeCloseTo(studio[index].scale, 6);
    }
    // the inn keeps its rest area as a placement
    const inn = placed.find((placement) => placement.path.endsWith('/tavern_b.glb'));
    expect(inn?.worldPropKind).toBe('inn');
    // the moved townsfolk stand where the game stands them
    for (const npc of HIGHWATCH_LAYOUT.services.npcs) {
      expect(map.npcs[npc.id]?.pos.x, npc.id).toBeCloseTo(npc.position.x, 9);
      expect(map.npcs[npc.id]?.pos.z, npc.id).toBeCloseTo(npc.position.z, 9);
      expect(map.npcs[npc.id]?.facing ?? 0, npc.id).toBeCloseTo(npc.facing, 9);
    }
    // and the town's roads are the game's, the re-routed Stormcrag road included
    const touchesTown = (road: readonly { x: number; z: number }[]) =>
      road.some((point) => Math.hypot(point.x, point.z - 660) < 40);
    const mapRoads = map.roads.filter(touchesTown);
    expect(mapRoads.length).toBeGreaterThanOrEqual(4);
    expect(mapRoads).toEqual(BUILTIN_WORLD.roads.filter(touchesTown));
    expect(mapRoads).toContainEqual(
      HIGHWATCH_LAYOUT.roads.stormcrag.map((point) => ({ ...point })),
    );
    // the map's ground carries the pads its buildings stand on
    for (const pad of HIGHWATCH_LAYOUT.pads) {
      expect(map.terrainEdits ?? []).toContainEqual(pad);
    }
    // the painted buildings are what stands where the kit houses stood
    // (kit placements carry these paths: the regex is live)
    expect(
      (map.placements ?? []).some((placement) =>
        /\/props\/(house_[123]|inn|bell_tower|blacksmith)\.glb$/.test(placement.path),
      ),
    ).toBe(true);
    // no old kit building is left standing in the town
    expect(
      (map.placements ?? []).some(
        (placement) =>
          /\/props\/(house_[123]|inn|bell_tower|blacksmith)\.glb$/.test(placement.path) &&
          Math.hypot(placement.x, placement.z - 660) < 30,
      ),
    ).toBe(false);
  });
});

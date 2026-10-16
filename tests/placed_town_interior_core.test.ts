import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { highwatchTownInternalsForTest } from '../src/render/highwatch_town';
import {
  activeCameraInterior,
  clampChaseCameraToInterior,
  interiorCameraInternalsForTest,
  interiorLensInAir,
  registerCameraInterior,
} from '../src/render/interior_camera';
import {
  type CameraInterior,
  interiorCameraPadding,
  interiorContains,
  interiorEntryWeight,
  interiorExit,
  interiorHoldsEye,
  interiorSegmentFraction,
} from '../src/render/interior_camera_core';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { createPlacedTownKit } from '../src/render/placed_town_buildings';
import {
  type PlacedTownInteriorBuilding,
  placedTownCameraInterior,
  placedTownInteriorModels,
  placedTownModelName,
} from '../src/render/placed_town_interior_core';
import { bakedBoxesForPath } from '../src/sim/asset_collision';
import { buildingRecordColliders } from '../src/sim/authored_town_buildings';
import { type Collider, rotY } from '../src/sim/collider_shapes';
import { emitPlacementBoxes } from '../src/sim/colliders_authored/placement_colliders';
import { BUILTIN_WORLD, getActiveWorldContent, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';
import { HIGHWATCH_LAYOUT } from '../src/sim/highwatch_layout';
import { distancePointToObb, localToWorld } from '../src/sim/placed_town_kit';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import type { PlacedAsset, WorldContent } from '../src/sim/types';
import { groundHeight, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The air of the walk-in painted buildings (src/render/placed_town_interior_core.ts),
// registered with the indoor camera (src/render/interior_camera.ts) by every town view that
// stands them (src/render/placed_town_interiors.ts), so walking into an inn, a chapel, a bank,
// a shop, a smithy or the Highwatch manor the camera follows in through the door and then
// keeps to the rooms, the way it does in the Mirefen tavern. The first blocks pin grand
// Highwatch; the next two pin every painted model at any scale and turn, and every walk-in
// building of Eastbrook, Fenbridge and Highwatch at the scale and spot its layout gives it
// today; the last pins the manor's many rooms against its own baked collision.

const BUILDINGS = HIGHWATCH_LAYOUT.buildings;
type Building = (typeof BUILDINGS)[number];
const WALK_IN = BUILDINGS.filter((building) => building.walkIn);

/** A town's placed building record, as the town views and the air read it. */
interface TownBuilding extends PlacedTownInteriorBuilding {
  readonly placement: PlacedTownInteriorBuilding['placement'] & { readonly modelSize: number };
  readonly frontStandingPoint: { readonly x: number; readonly z: number };
}

/** The built-in towns that stand painted buildings, with their records. */
const TOWN_BUILDINGS: readonly (readonly [string, readonly TownBuilding[]])[] = [
  ['Eastbrook', EASTBROOK_LAYOUT.buildings],
  ['Fenbridge', FENBRIDGE_LAYOUT.buildings],
  ['Highwatch', HIGHWATCH_LAYOUT.buildings],
];

afterEach(() => {
  interiorCameraInternalsForTest.reset();
  setActiveWorldContent(null);
});

function airOf(building: Building) {
  const ground = terrainHeight(building.placement.x, building.placement.z, WORLD_SEED);
  const air = placedTownCameraInterior(building, ground);
  if (!air) throw new Error(`no air for ${building.id}`);
  return air;
}

/** A point `depth` yards in from the door along the building's own axis. */
function inside(building: Building, depth: number) {
  const door = building.sockets.entrance.localPosition;
  return localToWorld(building.placement, building.rotation, door.x, door.z + depth);
}

describe('the air of a walk-in placed building', () => {
  it('stands for every walk-in Highwatch building, never for the sealed watch house', () => {
    expect(WALK_IN.map((building) => placedTownModelName(building.assetId))).toEqual([
      'tavern_b',
      'hall',
      'shop_a',
      'smithy',
      'manor',
    ]);
    for (const name of WALK_IN.map((building) => placedTownModelName(building.assetId))) {
      expect(placedTownInteriorModels()).toContain(name);
    }
    for (const building of WALK_IN) {
      const air = airOf(building);
      expect(air.id).toBe(`placed_town:${building.id}`);
      // the stable Mirefen framing: walls shorten the boom, never swing the view
      expect(air.framing).toBe('preserve-angle');
    }
    const watch = BUILDINGS.find((building) => building.id === 'highwatch_watch_house');
    if (!watch) throw new Error('no watch house');
    expect(placedTownCameraInterior(watch, 9)).toBeNull();
    // a quarter turn keeps its air in the world's axes, as it always has: no frame at all
    const inn = WALK_IN[0];
    expect(airOf(inn)).not.toHaveProperty('frame');
    // a record at any other turn gets its air in its own frame: the anchor its origin, the
    // turn its yaw, the model's own pieces at the placed scale over its ground line, and its
    // door the model's own (the front, local -z)
    const p = { ...inn.placement, rotation: 0.3 };
    const skew = placedTownCameraInterior({ ...inn, placement: p }, 9);
    expect(skew?.id).toBe(`placed_town:${inn.id}`);
    expect(skew?.framing).toBe('preserve-angle');
    expect(skew?.frame).toEqual({
      x: p.x,
      z: p.z,
      yaw: 0.3,
      cos: Math.cos(0.3),
      sin: Math.sin(0.3),
    });
    const s = p.scale;
    const line = 9 + s + p.lift;
    expect(skew?.boxes[0]).toEqual([
      -11.0 * s,
      12.15 * s,
      line + 0.45 * s,
      line + 5.0 * s,
      -6.65 * s,
      6.65 * s,
    ]);
    expect(skew?.openings).toEqual([{ box: 1, axis: 2, side: -1 }]);
  });

  it('opens at the door, a grand one, and holds the eye only past the threshold', () => {
    for (const building of WALK_IN) {
      const air = airOf(building);
      const front = air.openings[0];
      const box = air.boxes[front.box];
      const floorY = box[2];
      // the door's middle is on the record's entrance socket: square across the wall, and
      // no deeper than the wall's own thickness off its face
      const door = building.sockets.entrance.position;
      const across =
        front.axis === 0 ? (box[4] + box[5]) / 2 - door.z : (box[0] + box[1]) / 2 - door.x;
      const deep =
        front.axis === 0 ? (box[0] + box[1]) / 2 - door.x : (box[4] + box[5]) / 2 - door.z;
      expect(Math.abs(across), building.id).toBeLessThan(0.01);
      expect(Math.abs(deep), building.id).toBeLessThan(1);
      // the opening faces the standing point outside it
      const facing = building.frontStandingPoint;
      const centre = { x: (box[0] + box[1]) / 2, z: (box[4] + box[5]) / 2 };
      const outward = front.axis === 0 ? facing.x - centre.x : facing.z - centre.z;
      expect(Math.sign(outward), building.id).toBe(front.side);
      // grand: every door clears about five yards over its floor (a player stands 2.6)
      const head = box[3] - floorY;
      expect(head, `${building.id} door head`).toBeGreaterThan(4.5);
      expect(head, `${building.id} door head`).toBeLessThan(6.2);
      // the floor is the building's own deck, a hand over its pad
      const ground = terrainHeight(building.placement.x, building.placement.z, WORLD_SEED);
      expect(floorY - ground, building.id).toBeGreaterThan(0.4);
      expect(floorY - ground, building.id).toBeLessThan(1.2);
      // the eye on the door step is outdoors; three yards in it is indoors
      expect(interiorHoldsEye(air, facing.x, floorY + 2, facing.z), building.id).toBe(false);
      const room = inside(building, 3);
      expect(interiorHoldsEye(air, room.x, floorY + 2, room.z), building.id).toBe(true);
      // ...and every piece of air stands inside the building's ground
      for (const piece of air.boxes) {
        for (const [x, z] of [
          [piece[0], piece[4]],
          [piece[1], piece[5]],
        ]) {
          expect(distancePointToObb({ x, z }, building.reach), building.id).toBeLessThan(0.01);
        }
      }
    }
  });

  it('rooms are roomy: more than five yards of air over the floor', () => {
    for (const building of WALK_IN) {
      const air = airOf(building);
      const room = air.boxes[0];
      expect(room[3] - room[2], building.id).toBeGreaterThan(5.4);
    }
  });

  it('walks a player in through each door with the camera following and keeping inside', () => {
    for (const building of WALK_IN) {
      interiorCameraInternalsForTest.reset();
      const air = airOf(building);
      registerCameraInterior(air);
      const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
      const start = localToWorld(
        building.placement,
        building.rotation,
        building.sockets.entrance.localPosition.x,
        building.sockets.entrance.localPosition.z - 8,
      );
      const end = inside(building, 3.5);
      const steps = 240;
      const pitch = 0.45;
      const dist = 12;
      let indoors = 0;
      for (let i = 0; i <= steps + 120; i++) {
        const t = Math.min(1, i / steps);
        const x = start.x + (end.x - start.x) * t;
        const z = start.z + (end.z - start.z) * t;
        const self = new THREE.Vector3(x, groundHeight(x, z, WORLD_SEED), z);
        const look = new THREE.Vector3(x, self.y + 2, z);
        // the chase camera behind the player, along the way in
        const back = { x: start.x - end.x, z: start.z - end.z };
        const len = Math.hypot(back.x, back.z);
        camera.position.set(
          x + (back.x / len) * Math.cos(pitch) * dist,
          look.y + Math.sin(pitch) * dist,
          z + (back.z / len) * Math.cos(pitch) * dist,
        );
        clampChaseCameraToInterior(camera, look, self, 1 / 60, false);
        if (activeCameraInterior()) indoors++;
      }
      expect(indoors, building.id).toBeGreaterThan(60);
      expect(activeCameraInterior()?.id, building.id).toBe(air.id);
      // standing inside, the lens has come in to the room's air
      expect(interiorLensInAir(), building.id).toBe(true);
      const c = camera.position;
      expect(interiorContains(air, c.x, c.y, c.z), building.id).toBe(true);
    }
  });
});

describe('the placed-town view registers the air', () => {
  function fixtureSources(): Map<string, THREE.Object3D> {
    const kit = highwatchTownInternalsForTest.kit;
    return new Map(
      kit.urls.map((url) => {
        const source = new THREE.Group();
        source.add(
          new THREE.Mesh(
            new THREE.BoxGeometry(6, 5, 4).translate(0, 1.5, 0),
            new THREE.MeshBasicMaterial(),
          ),
        );
        return [url, source];
      }),
    );
  }

  it('registers each walk-in building when the view builds, and drops them with it', () => {
    const kit = highwatchTownInternalsForTest.kit;
    const ids = () => interiorCameraInternalsForTest.interiors().map((vol) => vol.id);
    kit.buildFromSources(fixtureSources(), () => 9, true);
    expect(ids()).toEqual(WALK_IN.map((building) => `placed_town:${building.id}`));
    // a rebuild replaces them, never doubles them
    kit.buildFromSources(fixtureSources(), () => 9, true);
    expect(ids()).toHaveLength(WALK_IN.length);
    // a document that owns the buildings as placements keeps no town air
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      promotedScenery: { highwatchTown: true },
    } as WorldContent);
    kit.buildFromSources(fixtureSources(), () => 9, true);
    expect(ids()).toEqual([]);
    setActiveWorldContent(null);
    kit.buildFromSources(fixtureSources(), () => 9, true);
    // ...nor does a world without the town
    kit.buildFromSources(new Map(), () => 0, false);
    expect(ids()).toEqual([]);
  });

  it('hands a turned building doors to its camera fade in its own frame', () => {
    // the Eastbrook bank (225 degrees) stood alone by the shared placed-town view: with the lens
    // out on the step behind a player who has just walked in, its sight line in through the
    // door, the bank stays solid; a lens off along the front, looking through the wall beside
    // the door, fades it
    const bank = EASTBROOK_LAYOUT.buildings.find((building) => building.id === 'eastbrook_bank');
    if (!bank) throw new Error('no Eastbrook bank');
    setDitherFadeEnabledForTest(false);
    try {
      const kit = createPlacedTownKit({
        town: 'eastbrook',
        layoutId: 'turned_probe',
        rootName: 'turnedProbe',
        revealKey: 'turned-probe-static',
        hub: { center: bank.position, radius: 20 },
        buildings: [bank],
        promotedBy: 'highwatchTown',
      });
      const source = new THREE.Group();
      source.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(6, 5, 4).translate(0, 1.5, 0),
          new THREE.MeshBasicMaterial(),
        ),
      );
      const view = kit.buildFromSources(new Map([[bank.assetId, source]]), () => 4, true);
      const [air] = interiorCameraInternalsForTest.interiors();
      expect(air.id).toBe(`placed_town:${bank.id}`);
      expect(air.frame?.yaw).toBe(bank.placement.rotation);
      const group = view.group.getObjectByName(`eastbrookBuilding:${bank.id}`);
      if (!group) throw new Error('no bank group');
      const opacities: number[] = [];
      const drawn = () => {
        opacities.length = 0;
        group.traverse((child) => {
          if (child instanceof THREE.Mesh)
            opacities.push((child.material as THREE.Material).opacity);
        });
        return opacities;
      };
      const door = doorway(air);
      const eyeY = door.box[2] + 2;
      const inside = air.thresholds[0] + 0.5;
      const eye = { x: door.x + door.inX * inside, z: door.z + door.inZ * inside };
      expect(interiorHoldsEye(air, eye.x, eyeY, eye.z)).toBe(true);
      const step = { x: door.x - door.inX * 6, z: door.z - door.inZ * 6 };
      view.update(step.x, eyeY + 1.5, step.z, eye.x, eyeY, eye.z, 400, 0.05);
      expect(drawn().length).toBeGreaterThan(0);
      expect(drawn().every((opacity) => opacity === 1)).toBe(true);
      // fifteen yards along the front from the step: the sight line crosses the front wall
      // beyond the door's jamb
      const aside = { x: step.x - door.inZ * 15, z: step.z + door.inX * 15 };
      view.update(aside.x, eyeY + 1.5, aside.z, eye.x, eyeY, eye.z, 400, 0.05);
      expect(drawn().every((opacity) => opacity < 1)).toBe(true);
    } finally {
      setDitherFadeEnabledForTest(null);
    }
  });
});

/** Whether a baked wall's footprint holds the world point (x, z). */
function footprintHolds(c: Collider, x: number, z: number): boolean {
  if (c.type !== 'obb') return false;
  const local = rotY(x - c.x, z - c.z, -c.rot);
  return Math.abs(local.x) <= c.hw && Math.abs(local.z) <= c.hd;
}

/** Whether a baked wall holds the world point (x, y, z): its footprint and its band. */
function wallHolds(c: Collider, x: number, y: number, z: number): boolean {
  return footprintHolds(c, x, z) && y >= (c.baseY ?? -Infinity) && y <= (c.moveTopY ?? Infinity);
}

/** A point (x, z) of an interior's own axes, its boxes', in the world: as it is for air in the
 *  world's axes, through the frame for a building at any other turn. */
function airPoint(air: CameraInterior, x: number, z: number): { x: number; z: number } {
  const f = air.frame;
  return f ? localToWorld(f, f.yaw, x, z) : { x, z };
}

/** A world point (x, z) in an interior's own axes. */
function airLocal(air: CameraInterior, x: number, z: number): { x: number; z: number } {
  const f = air.frame;
  return f ? rotY(x - f.x, z - f.z, -f.yaw) : { x, z };
}

/** An opening's box (in the interior's own axes), the middle of its outside face and the way
 *  in (a unit step), both in the world, and `point`: the world point `into` yards in from that
 *  face and `at` across the doorway (along the box's own `across` axis). */
function doorway(air: CameraInterior, index = 0) {
  const o = air.openings[index];
  const box = air.boxes[o.box];
  const across = o.axis === 0 ? 2 : 0;
  const face = o.side > 0 ? box[o.axis * 2 + 1] : box[o.axis * 2];
  const mid = (box[across * 2] + box[across * 2 + 1]) / 2;
  const inX = o.axis === 0 ? -o.side : 0;
  const inZ = o.axis === 2 ? -o.side : 0;
  const point = (at: number, into: number) =>
    airPoint(air, o.axis === 0 ? face + inX * into : at, o.axis === 2 ? face + inZ * into : at);
  const centre = point(mid, 0);
  const inward = air.frame ? localToWorld({ x: 0, z: 0 }, air.frame.yaw, inX, inZ) : null;
  return {
    box,
    across,
    x: centre.x,
    z: centre.z,
    inX: inward ? inward.x : inX,
    inZ: inward ? inward.z : inZ,
    point,
  };
}

describe('the authored air against each model baked collision', () => {
  // The largest dimension of each model at authored size, measured off the shipped GLB: the
  // placed-asset unit (a baked row is stored in multiples of it over 2.2), and the number the
  // towns' records carry as placement.modelSize.
  const MODEL_SIZE: Readonly<Record<string, number>> = {
    tavern_b: 30.262,
    tavern: 22.6483,
    bank: 22.6067,
    hall: 30.4998,
    shop_a: 16.2797,
    shop_b: 18.7,
    smithy: 19.797,
    manor: 51.248,
  };
  // the sizes the towns stand the models at (authored size, and the grand towns' 1.2 to 1.5),
  // at every quarter turn (air in the world's axes) and at two of the free turns Eastbrook
  // stands its buildings at (the smithy's 20 degrees, the bank's 225: air in its own frame)
  const SCALES = [1, 1.3, 1.5];
  const TURNS = [
    0,
    Math.PI / 2,
    Math.PI,
    -Math.PI / 2,
    (20 * Math.PI) / 180,
    (225 * Math.PI) / 180,
  ];
  /** The ground under a probe building's anchor. */
  const GROUND = 7.25;
  /** The tall pieces a room's air is cut round, each named by a point inside its baked box at
   *  authored size (x, y over the ground line, z): the lens never stands in one. */
  const CUT_ROUND: Readonly<
    Record<string, readonly (readonly [string, number, number, number])[]>
  > = {
    tavern_b: [['the chimney breast', -11.8, 2.5, -1]],
    tavern: [
      ['the chimney breast', -8.8, 2.5, 0],
      ['the back-bar shelves', -2.4, 2, 5.4],
      ['the back-bar shelves', 2.4, 2, 5.4],
    ],
    bank: [
      ['a pillar', -4.6, 2.5, -2.2],
      ['a pillar', 4.6, 2.5, -2.2],
    ],
    shop_a: [['the back shelves', 0, 2, 3.55]],
    shop_b: [['the back shelves', -0.6, 2, 3.85]],
    smithy: [['the forge hearth', -4.4, 2, 0]],
  };

  /**
   * One model stood the way a town stands it, at `scale` and `turn` on GROUND: its camera air,
   * and the same building as the sim stands it (sim/town_walk_in.ts walkInPlacementFor) on the
   * same ground: its baked walls (the emitter the town's record collides on) and the deck the
   * sim walks at a point.
   */
  function stand(name: string, scale: number, turn: number) {
    const placement = { x: 31.5, z: -48.25, rotation: turn, scale, lift: -(scale + 0.05) };
    const record = {
      id: `probe_${name}`,
      assetId: `/models/tidehold/${name}.glb`,
      walkIn: true,
      placement,
    };
    const air = placedTownCameraInterior(record, GROUND);
    if (!air) throw new Error(`no air for ${name}`);
    const size = MODEL_SIZE[name];
    if (size === undefined) throw new Error(`no model size for ${name}`);
    const asset: PlacedAsset = {
      path: record.assetId,
      x: placement.x,
      z: placement.z,
      rotY: turn,
      scale: (scale * size) / 2.2,
      y: placement.lift,
      collideRadius: 1,
      detached: true,
      groundY: GROUND,
    };
    const baked = bakedBoxesForPath(asset.path);
    if (!baked) throw new Error(`no baked collision for ${name}`);
    const walls: Collider[] = [];
    emitPlacementBoxes(walls, asset, baked, GROUND);
    const content = { placements: [asset] } as unknown as WorldContent;
    const lineY = GROUND + scale + placement.lift;
    return {
      air,
      walls,
      deckAt: (x: number, z: number) => placementRampFloorAt(content, WORLD_SEED, x, z),
      /** A point in the model's own axes at authored size, in the world. */
      world: (x: number, y: number, z: number) => ({
        ...localToWorld(placement, turn, x * scale, z * scale),
        y: lineY + y * scale,
      }),
    };
  }

  function eachStanding(check: (name: string, scale: number, turn: number, at: string) => void) {
    for (const name of placedTownInteriorModels()) {
      // the manor (its own model under tidehold/highwatch, many rooms off one hall) is pinned
      // by its own block at the end of this file
      if (name === 'manor') continue;
      for (const scale of SCALES) {
        for (const turn of TURNS) check(name, scale, turn, `${name} at ${scale}, turned ${turn}`);
      }
    }
  }

  it('stands every room on its deck and every doorway under its lintel, between its jambs', () => {
    eachStanding((name, scale, turn, at) => {
      const { air, walls, deckAt } = stand(name, scale, turn);
      const room = air.boxes[0];
      // the room's floor is the deck the sim walks under its middle
      const centre = airPoint(air, (room[0] + room[1]) / 2, (room[4] + room[5]) / 2);
      const middle = deckAt(centre.x, centre.z);
      expect(Math.abs(middle - room[2]), at).toBeLessThan(0.01);
      for (let index = 0; index < air.openings.length; index++) {
        const door = doorway(air, index);
        const box = door.box;
        const floor = box[2];
        // a hand into the wall from the doorway's outside face (a tenth of a yard out from
        // the wall's own, at authored size)
        const into = 0.3 * scale;
        const point = (across: number) => door.point(across, into);
        const lo = box[door.across * 2];
        const hi = box[door.across * 2 + 1];
        const mid = point((lo + hi) / 2);
        // the doorway stands on the deck the sim walks through it
        expect(Math.abs(deckAt(mid.x, mid.z) - floor), at).toBeLessThan(0.01);
        // its head is the lowest baked box over its middle, in the wall
        const over = walls.filter(
          (c) => footprintHolds(c, mid.x, mid.z) && (c.baseY ?? -Infinity) > floor + 1,
        );
        expect(Math.min(...over.map((c) => c.baseY ?? Infinity)), at).toBeCloseTo(box[3], 1);
        // under it the doorway is open edge to edge, and its jambs are the wall either side
        const y = floor + Math.min(1.5 * scale, (box[3] - floor) / 2);
        for (const across of [lo + 0.05 * scale, (lo + hi) / 2, hi - 0.05 * scale]) {
          const p = point(across);
          expect(
            walls.some((c) => wallHolds(c, p.x, y, p.z)),
            `${at}: open at ${across}`,
          ).toBe(false);
        }
        for (const across of [lo - 0.15 * scale, hi + 0.15 * scale]) {
          const p = point(across);
          expect(
            walls.some((c) => wallHolds(c, p.x, y, p.z)),
            `${at}: jamb at ${across}`,
          ).toBe(true);
        }
      }
    });
  });

  it('keeps every room clear of the hearths, shelves and pillars it is cut round', () => {
    eachStanding((name, scale, turn, at) => {
      const { air, walls, world } = stand(name, scale, turn);
      for (const [what, x, y, z] of CUT_ROUND[name] ?? []) {
        const p = world(x, y, z);
        const solid = walls.filter((c) => wallHolds(c, p.x, p.y, p.z));
        expect(solid.length, `${at}: ${what} is baked`).toBeGreaterThan(0);
        for (const c of solid) {
          if (c.type !== 'obb') continue;
          // the baked box in the air's own axes (as it is for air in the world's)
          const centre = airLocal(air, c.x, c.z);
          const rot = c.rot - (air.frame?.yaw ?? 0);
          const cos = Math.abs(Math.cos(rot));
          const sin = Math.abs(Math.sin(rot));
          const ex = c.hw * cos + c.hd * sin;
          const ez = c.hw * sin + c.hd * cos;
          const [y0, y1] = [c.baseY ?? -Infinity, c.moveTopY ?? Infinity];
          for (const piece of air.boxes) {
            const overlaps =
              piece[0] < centre.x + ex &&
              piece[1] > centre.x - ex &&
              piece[2] < y1 &&
              piece[3] > y0 &&
              piece[4] < centre.z + ez &&
              piece[5] > centre.z - ez;
            expect(overlaps, `${at}: the air stands clear of ${what}`).toBe(false);
          }
        }
      }
    });
  });

  it('keeps each building one piece of air under the camera near-plane pad', () => {
    // the camera walks its ray through the pieces each shrunk by its pad: two pieces join only
    // where they overlap by more than both pads (the widest pad in play: a wide screen with the
    // field of view kicked out)
    const pad = interiorCameraPadding(0.2, 75, 21 / 9);
    eachStanding((name, scale, turn, at) => {
      const { air } = stand(name, scale, turn);
      const doors = new Set(air.openings.map((o) => o.box));
      const rooms = air.boxes.map((_, index) => index).filter((index) => !doors.has(index));
      const joined = (i: number, j: number) =>
        [0, 1, 2].every(
          (a) =>
            Math.min(air.boxes[i][a * 2 + 1], air.boxes[j][a * 2 + 1]) -
              Math.max(air.boxes[i][a * 2], air.boxes[j][a * 2]) >
            2 * pad,
        );
      const reached = new Set([0]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const i of rooms) {
          if (reached.has(i) || ![...reached].some((j) => joined(i, j))) continue;
          reached.add(i);
          grew = true;
        }
      }
      expect(
        rooms.filter((index) => !reached.has(index)),
        at,
      ).toEqual([]);
    });
  });

  it('carries the model size every town record keeps for its walk-in buildings', () => {
    for (const [, buildings] of TOWN_BUILDINGS) {
      for (const building of buildings) {
        if (!building.walkIn) continue;
        const name = placedTownModelName(building.assetId);
        expect(building.placement.modelSize, building.id).toBeCloseTo(MODEL_SIZE[name], 2);
      }
    }
  });
});

describe('every walk-in painted building of the built-in towns', () => {
  const WALK_INS = TOWN_BUILDINGS.flatMap(([town, buildings]) =>
    buildings.filter((building) => building.walkIn).map((building) => ({ town, building })),
  );
  const groundAt = (x: number, z: number) => terrainHeight(x, z, WORLD_SEED);

  function townAir(building: TownBuilding) {
    const air = placedTownCameraInterior(
      building,
      groundAt(building.placement.x, building.placement.z),
    );
    if (!air) throw new Error(`no air for ${building.id}`);
    return air;
  }

  it('gives every walk-in building its rooms, and no sealed one any', () => {
    // every town stands walk-in painted buildings, so the list is never vacuous
    for (const [town, buildings] of TOWN_BUILDINGS) {
      expect(buildings.filter((building) => building.walkIn).length, town).toBeGreaterThan(1);
      for (const building of buildings) {
        const air = placedTownCameraInterior(
          building,
          groundAt(building.placement.x, building.placement.z),
        );
        if (!building.walkIn) {
          expect(air, `${town}: ${building.id}`).toBeNull();
          continue;
        }
        expect(air?.id, `${town}: ${building.id}`).toBe(`placed_town:${building.id}`);
        expect(air?.framing, `${town}: ${building.id}`).toBe('preserve-angle');
      }
    }
  });

  it('stands each room on the floor the sim walks and each front door under its own lintel', () => {
    const content = getActiveWorldContent();
    for (const { town, building } of WALK_INS) {
      const at = `${town}: ${building.id}`;
      const air = townAir(building);
      const room = air.boxes[0];
      const middle = airPoint(air, (room[0] + room[1]) / 2, (room[4] + room[5]) / 2);
      expect(
        Math.abs(placementRampFloorAt(content, WORLD_SEED, middle.x, middle.z) - room[2]),
        at,
      ).toBeLessThan(0.01);
      // the record's own walls, as the sim collides on them (its baked walk-in walls)
      const def = content.props.buildings.find((candidate) => candidate.id === building.id);
      if (!def) throw new Error(`no props record for ${at}`);
      const walls = buildingRecordColliders(def, Infinity, groundAt, WORLD_SEED);
      const door = doorway(air);
      const into = 0.3 * building.placement.scale;
      const m = { x: door.x + door.inX * into, z: door.z + door.inZ * into };
      const over = walls.filter(
        (c) => footprintHolds(c, m.x, m.z) && (c.baseY ?? -Infinity) > door.box[2] + 1,
      );
      expect(Math.min(...over.map((c) => c.baseY ?? Infinity)), at).toBeCloseTo(door.box[3], 1);
      // the eye on the doorstep is outdoors; three yards past the threshold it is indoors
      const front = building.frontStandingPoint;
      const eyeY = door.box[2] + 2;
      expect(interiorHoldsEye(air, front.x, eyeY, front.z), at).toBe(false);
      const deep = air.thresholds[0] + 3;
      expect(
        interiorHoldsEye(air, door.x + door.inX * deep, eyeY, door.z + door.inZ * deep),
        at,
      ).toBe(true);
    }
  });

  it('walks a player in through each front door with the camera following and keeping inside', () => {
    for (const { town, building } of WALK_INS) {
      const at = `${town}: ${building.id}`;
      interiorCameraInternalsForTest.reset();
      const air = townAir(building);
      registerCameraInterior(air);
      const door = doorway(air);
      const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
      const start = { x: door.x - door.inX * 8, z: door.z - door.inZ * 8 };
      const depth = air.thresholds[0] + 3.5;
      const end = { x: door.x + door.inX * depth, z: door.z + door.inZ * depth };
      const steps = 240;
      const pitch = 0.45;
      const dist = 12;
      let indoors = 0;
      for (let i = 0; i <= steps + 120; i++) {
        const t = Math.min(1, i / steps);
        const x = start.x + (end.x - start.x) * t;
        const z = start.z + (end.z - start.z) * t;
        const self = new THREE.Vector3(x, groundHeight(x, z, WORLD_SEED), z);
        const look = new THREE.Vector3(x, self.y + 2, z);
        // the chase camera behind the player, along the way in
        camera.position.set(
          x - door.inX * Math.cos(pitch) * dist,
          look.y + Math.sin(pitch) * dist,
          z - door.inZ * Math.cos(pitch) * dist,
        );
        clampChaseCameraToInterior(camera, look, self, 1 / 60, false);
        if (activeCameraInterior()) indoors++;
      }
      expect(indoors, at).toBeGreaterThan(60);
      expect(activeCameraInterior()?.id, at).toBe(air.id);
      // standing inside, the lens has come in to the room's air
      expect(interiorLensInAir(), at).toBe(true);
      const c = camera.position;
      expect(interiorContains(air, c.x, c.y, c.z), at).toBe(true);
    }
  });
});

describe('a walk-in painted building at any turn', () => {
  // Every painted model stood at a free turn (the Eastbrook smithy's 20 degrees, the bank's
  // 225) keeps the air its unturned twin has, carried round its anchor: rooms square to its
  // own walls, doors where its doors are, and the real clamp walks a player in through its
  // front door exactly as through the twin's.
  const TURNS = [(20 * Math.PI) / 180, (225 * Math.PI) / 180];
  const ANCHOR = { x: -61.99, z: -118.33 };
  const GROUND = 4.4;
  const SCALE = 1.3;

  function standAt(name: string, rotation: number): CameraInterior {
    const air = placedTownCameraInterior(
      {
        id: `turned_${name}`,
        assetId:
          name === 'manor'
            ? '/models/tidehold/highwatch/manor.glb'
            : `/models/tidehold/${name}.glb`,
        walkIn: true,
        placement: { x: ANCHOR.x, z: ANCHOR.z, rotation, scale: SCALE, lift: -(SCALE + 0.05) },
      },
      GROUND,
    );
    if (!air) throw new Error(`no air for ${name}`);
    return air;
  }

  /** Where the building turned `rotation` stands the world point (x, z) of its unturned twin. */
  const turnedPoint = (rotation: number, x: number, z: number) =>
    localToWorld(ANCHOR, rotation, x - ANCHOR.x, z - ANCHOR.z);
  /** The world point (x, z) of the turned building back where its unturned twin has it. */
  const untwisted = (rotation: number, x: number, z: number) => {
    const local = rotY(x - ANCHOR.x, z - ANCHOR.z, -rotation);
    return { x: ANCHOR.x + local.x, z: ANCHOR.z + local.z };
  };

  it('reads every point and sight line of the turned air as its twin reads the one it came from', () => {
    for (const name of placedTownInteriorModels()) {
      const flat = standAt(name, 0);
      // the unturned twin is in the world's axes, as every quarter turn is
      expect(flat).not.toHaveProperty('frame');
      const u = flat.bounds;
      for (const rotation of TURNS) {
        const air = standAt(name, rotation);
        expect(air.frame?.yaw, name).toBe(rotation);
        let held = 0;
        let out = 0;
        let stopped = 0;
        for (let x = u[0] - 2.13; x <= u[1] + 2; x += 1.1) {
          for (let z = u[4] - 2.71; z <= u[5] + 2; z += 0.9) {
            for (const rise of [1.37, 3.9]) {
              const y = u[2] + rise;
              const p = turnedPoint(rotation, x, z);
              const at = `${name} turned ${rotation}: ${x}, ${y}, ${z}`;
              const inside = interiorContains(flat, x, y, z);
              expect(interiorContains(air, p.x, y, p.z), at).toBe(inside);
              expect(interiorHoldsEye(air, p.x, y, p.z), at).toBe(interiorHoldsEye(flat, x, y, z));
              expect(interiorEntryWeight(air, p.x, y, p.z), at).toBeCloseTo(
                interiorEntryWeight(flat, x, y, z),
                9,
              );
              if (!inside) {
                out++;
                continue;
              }
              held++;
              // a sight line out of the building from here, toward each side and the door
              for (const [fx, fz] of [
                [x + 31, z + 3.7],
                [x - 4.3, z - 29],
                [x + 2.9, z + 33],
              ]) {
                const flatWalk = interiorSegmentFraction(flat, x, y, z, fx, y + 1.1, fz, 0.4, 1);
                const exit = { ...interiorExit };
                const f = turnedPoint(rotation, fx, fz);
                const walk = interiorSegmentFraction(air, p.x, y, p.z, f.x, y + 1.1, f.z, 0.4, 1);
                expect(walk, at).toBeCloseTo(flatWalk, 9);
                expect({ ...interiorExit }, at).toEqual(exit);
                if (flatWalk < 1) stopped++;
              }
            }
          }
        }
        expect(held, name).toBeGreaterThan(20);
        expect(out, name).toBeGreaterThan(20);
        expect(stopped, name).toBeGreaterThan(20);
      }
    }
  });

  it('walks a player in through each door at a free turn, the camera following and keeping inside', () => {
    // every opening: the front doors (along each model's own z) and the smithy's side arch onto
    // its forge shelter (along its own x)
    const doors = placedTownInteriorModels().flatMap((name) =>
      standAt(name, 0).openings.map((_, index) => ({ name, index })),
    );
    expect(doors.length).toBeGreaterThan(placedTownInteriorModels().length);
    for (const { name, index } of doors) {
      const flat = standAt(name, 0);
      // the walk in through the twin's door (world axes), its feet on the door's floor
      const door = doorway(flat, index);
      const floor = door.box[2];
      const start = { x: door.x - door.inX * 8, z: door.z - door.inZ * 8 };
      const depth = flat.thresholds[index] + 3.5;
      const end = { x: door.x + door.inX * depth, z: door.z + door.inZ * depth };
      const steps = 240;
      const pitch = 0.45;
      const dist = 12;
      const poses: [THREE.Vector3, THREE.Vector3][] = [];
      for (let i = 0; i <= steps + 120; i++) {
        const t = Math.min(1, i / steps);
        const x = start.x + (end.x - start.x) * t;
        const z = start.z + (end.z - start.z) * t;
        // the chase camera behind the player, along the way in
        poses.push([
          new THREE.Vector3(x, floor, z),
          new THREE.Vector3(
            x - door.inX * Math.cos(pitch) * dist,
            floor + 2 + Math.sin(pitch) * dist,
            z - door.inZ * Math.cos(pitch) * dist,
          ),
        ]);
      }
      /** The walk over `vol` turned `rotation` (0: the twin as it is): per frame, the drawn
       *  camera where the twin has it, and whether the eye is indoors and the lens in the air. */
      const walk = (vol: CameraInterior, rotation: number) => {
        interiorCameraInternalsForTest.reset();
        registerCameraInterior(vol);
        const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.2, 950);
        return poses.map(([feet, want]) => {
          const f = turnedPoint(rotation, feet.x, feet.z);
          const c = turnedPoint(rotation, want.x, want.z);
          const self = new THREE.Vector3(f.x, feet.y, f.z);
          const look = new THREE.Vector3(f.x, feet.y + 2, f.z);
          camera.position.set(c.x, want.y, c.z);
          clampChaseCameraToInterior(camera, look, self, 1 / 60, false);
          const p = camera.position;
          const back = untwisted(rotation, p.x, p.z);
          return {
            at: new THREE.Vector3(back.x, p.y, back.z),
            indoors: activeCameraInterior()?.id === vol.id,
            inAir: interiorLensInAir(),
            contained: interiorContains(vol, p.x, p.y, p.z),
          };
        });
      };
      const twin = walk(flat, 0);
      for (const rotation of TURNS) {
        const at = `${name} door ${index} turned ${rotation}`;
        const air = standAt(name, rotation);
        const frames = walk(air, rotation);
        expect(frames.filter((f) => f.indoors).length, at).toBeGreaterThan(60);
        // standing inside, the lens has come in to the turned room's air
        const last = frames[frames.length - 1];
        expect([last.indoors, last.inAir, last.contained], at).toEqual([true, true, true]);
        // and every frame of the way in drew the camera where the twin's walk drew it
        for (const [i, f] of frames.entries()) {
          expect(f.at.distanceTo(twin[i].at), `${at}, frame ${i}`).toBeLessThan(1e-6);
          expect([f.indoors, f.inAir, f.contained], `${at}, frame ${i}`).toEqual([
            twin[i].indoors,
            twin[i].inAir,
            twin[i].contained,
          ]);
        }
      }
    }
  });
});

describe("the Highwatch manor's air against its baked collision", () => {
  interface Row {
    x: number;
    y: number;
    z: number;
    hx: number;
    hy: number;
    hz: number;
    ry?: number;
    y0?: number;
    y1?: number;
  }
  const BAKED = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'data/asset_collision_overrides.json'), 'utf8'),
  ) as Record<string, { boxes: Row[]; ramps?: Row[] }>;
  // the manor's largest dimension at authored size (the placed-asset unit)
  const MANOR_SIZE = 51.248;
  /** The manor's air at authored size in its own axes: stood at the origin, unturned, its
   *  ground line on y 0. */
  function manorAir() {
    const air = placedTownCameraInterior(
      {
        id: 'probe_manor',
        assetId: '/models/tidehold/highwatch/manor.glb',
        walkIn: true,
        placement: { x: 0, z: 0, rotation: 0, scale: 1, lift: -1 },
      },
      0,
    );
    if (!air) throw new Error('no manor air');
    return air;
  }

  it('stands its front door under its lintel and its hall on its floor deck', () => {
    const air = manorAir();
    const unit = MANOR_SIZE / 2.2;
    const rows = BAKED['tidehold/highwatch/manor'];
    const boxes = rows.boxes.map((b) => {
      const c = Math.abs(Math.cos(b.ry ?? 0));
      const s = Math.abs(Math.sin(b.ry ?? 0));
      const ex = (b.hx * c + b.hz * s) * unit;
      const ez = (b.hx * s + b.hz * c) * unit;
      return {
        x0: b.x * unit - ex,
        x1: b.x * unit + ex,
        z0: b.z * unit - ez,
        z1: b.z * unit + ez,
        y0: (b.y - b.hy) * unit - 1,
      };
    });
    const decks = (rows.ramps ?? []).map((r) => Math.max(r.y0 ?? 0, r.y1 ?? 0) * unit - 1);
    const [room, door] = [air.boxes[0], air.boxes[air.openings[0].box]];
    // the hall's floor is one of the model's decks
    expect(Math.min(...decks.map((d) => Math.abs(d - room[2])))).toBeLessThan(0.02);
    // the door's head is the lowest baked box over the door's middle, in the wall
    const mx = (door[0] + door[1]) / 2;
    const mz = door[4] + 0.3; // inside the wall, a hand in from its outside face
    const over = boxes.filter(
      (b) => b.x0 <= mx && b.x1 >= mx && b.z0 <= mz && b.z1 >= mz && b.y0 > door[2] + 1,
    );
    expect(Math.min(...over.map((b) => b.y0))).toBeCloseTo(door[3], 1);
  });

  it("keeps every piece of the manor's air on a floor deck and clear of its walls", () => {
    // the manor has many rooms: each piece stands on the deck under its middle, and no wall
    // (a baked box five yards tall or more) cuts into any of them, so the camera can never be
    // walked into masonry the model would draw through
    const air = manorAir();
    const unit = MANOR_SIZE / 2.2;
    const rows = BAKED['tidehold/highwatch/manor'];
    const walls = rows.boxes
      .map((b) => ({
        x0: (b.x - b.hx) * unit,
        x1: (b.x + b.hx) * unit,
        z0: (b.z - b.hz) * unit,
        z1: (b.z + b.hz) * unit,
        y0: (b.y - b.hy) * unit - 1,
        y1: (b.y + b.hy) * unit - 1,
      }))
      .filter((b) => b.y1 - b.y0 >= 5);
    expect(walls.length).toBeGreaterThan(20);
    const decks = (rows.ramps ?? []).map((r) => ({
      x0: (r.x - (r.ry ? r.hz : r.hx)) * unit,
      x1: (r.x + (r.ry ? r.hz : r.hx)) * unit,
      z0: (r.z - (r.ry ? r.hx : r.hz)) * unit,
      z1: (r.z + (r.ry ? r.hx : r.hz)) * unit,
      y: Math.max(r.y0 ?? 0, r.y1 ?? 0) * unit - 1,
    }));
    for (const [i, [x0, x1, y0, y1, z0, z1]] of air.boxes.entries()) {
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      // the highest deck under its middle is its floor
      const under = decks.filter((d) => d.x0 <= mx && d.x1 >= mx && d.z0 <= mz && d.z1 >= mz);
      expect(under.length, `piece ${i}`).toBeGreaterThan(0);
      expect(Math.max(...under.map((d) => d.y)), `piece ${i} floor`).toBeCloseTo(y0, 1);
      for (const w of walls) {
        const overlap =
          Math.min(x1, w.x1) - Math.max(x0, w.x0) > 0.05 &&
          Math.min(z1, w.z1) - Math.max(z0, w.z0) > 0.05 &&
          Math.min(y1, w.y1) - Math.max(y0, w.y0) > 0.05;
        expect(overlap, `piece ${i} against a wall at ${w.x0.toFixed(1)}, ${w.z0.toFixed(1)}`).toBe(
          false,
        );
      }
    }
  });
});

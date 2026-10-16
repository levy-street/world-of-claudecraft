import { describe, expect, it } from 'vitest';
import {
  authoredTownBuildingPlacements,
  highwatchTownBuildingPlacements,
} from '../src/editor/feature_prop_placements';
import { TARGET_HEIGHT } from '../src/render/asset_scale';
import { authoredRampsForPath } from '../src/sim/asset_collision';
import { buildingRecordColliders } from '../src/sim/authored_town_buildings';
import { type Collider, rotY } from '../src/sim/collider_shapes';
import { pushPlacementColliders } from '../src/sim/colliders_authored/placement_colliders';
import { ZONE1_PROPS } from '../src/sim/content/zone1';
import { ZONE2_PROPS } from '../src/sim/content/zone2';
import { ZONE3_PROPS } from '../src/sim/content/zone3';
import { BUILTIN_WORLD } from '../src/sim/data';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';
import { HIGHWATCH_LAYOUT } from '../src/sim/highwatch_layout';
import { loadPublishedMap } from '../src/sim/maps/eastbrook_rebuild.generated';
import { decksMayStand } from '../src/sim/placement_ramps';
import { nearTownWalkIn, townWalkInPlacements, walkInPlacementFor } from '../src/sim/town_walk_in';
import type { BuildingDef, WorldContent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

// The walk-in town buildings (src/sim/town_walk_in.ts): the one placement a
// walk-in record resolves to, which its walls (authored_town_buildings.ts)
// and its floors (placement_ramps.ts) are both built from. Eastbrook,
// Fenbridge and Highwatch stand walk-in buildings; each town keeps its own
// bounds box.

const TOWN_BUILDINGS = [
  ...EASTBROOK_LAYOUT.buildings,
  ...FENBRIDGE_LAYOUT.buildings,
  ...HIGHWATCH_LAYOUT.buildings,
];
const WALK_IN = TOWN_BUILDINGS.filter((building) => building.walkIn);
const HIGHWATCH_WALK_IN = HIGHWATCH_LAYOUT.buildings.filter((building) => building.walkIn);

function recordOf(id: string): BuildingDef {
  const record = [
    ...ZONE1_PROPS.buildings,
    ...ZONE2_PROPS.buildings,
    ...ZONE3_PROPS.buildings,
  ].find((candidate) => candidate.id === id);
  if (!record) throw new Error(`no props record for ${id}`);
  return record;
}

describe('the walk-in town placement', () => {
  it('walks into every town building whose model bakes an open doorway', () => {
    // the shut-door models (Eastbrook's quay cottage, Fenbridge's warden
    // house, Highwatch's watch house) stay sealed; every other placed building
    // in the three towns is open
    expect(WALK_IN.map((building) => building.id)).toEqual([
      'eastbrook_bank',
      'eastbrook_smithy',
      'eastbrook_inn',
      'eastbrook_chapel',
      'eastbrook_apothecary',
      'fenbridge_crooked_reed_inn',
      'fenbridge_lantern_chapel',
      'fenbridge_moonwort_apothecary',
      'fenbridge_gilded_strongbox',
      'highwatch_summit_inn',
      'highwatch_gate_chapel',
      'highwatch_counting_house',
      'highwatch_smithy',
      'highwatch_manor',
    ]);
  });

  it('stands each walk-in model at its layout anchor, at the size Studio places it', () => {
    const studio = [
      ...authoredTownBuildingPlacements(WORLD_SEED),
      ...highwatchTownBuildingPlacements(WORLD_SEED),
    ];
    expect(WALK_IN.length).toBeGreaterThan(0);
    for (const building of WALK_IN) {
      const placement = walkInPlacementFor(recordOf(building.id));
      if (!placement) throw new Error(`${building.id} resolved no placement`);
      expect(placement).toMatchObject({
        path: building.assetId,
        x: building.placement.x,
        z: building.placement.z,
        rotY: building.placement.rotation,
        y: building.placement.lift,
      });
      // one size rule: the largest dimension over the placed-asset target height
      expect(placement.scale, building.id).toBeCloseTo(
        (building.placement.scale * building.placement.modelSize) / TARGET_HEIGHT,
        9,
      );
      const asStudio = studio.find((p) => `/models/${p.assetId}.glb` === building.assetId);
      if (!asStudio) throw new Error(`Studio places no ${building.assetId}`);
      expect(placement.scale, building.id).toBeCloseTo(asStudio.scale, 3);
    }
  });

  it('gives a sealed record, and one a custom world moved, turned or resized, nothing', () => {
    const sealed = TOWN_BUILDINGS.filter((building) => !building.walkIn);
    expect(sealed.map((building) => building.id)).toEqual([
      'eastbrook_quay_cottage',
      'fenbridge_warden_gatehouse',
      'highwatch_watch_house',
    ]);
    for (const building of sealed) expect(walkInPlacementFor(recordOf(building.id))).toBeNull();
    const inn = recordOf(WALK_IN[0].id);
    expect(walkInPlacementFor(inn)).not.toBeNull();
    expect(walkInPlacementFor({ ...inn, x: inn.x + 2 })).toBeNull();
    expect(walkInPlacementFor({ ...inn, z: inn.z - 2 })).toBeNull();
    expect(walkInPlacementFor({ ...inn, rot: inn.rot + 0.5 })).toBeNull();
    expect(walkInPlacementFor({ ...inn, w: inn.w + 1 })).toBeNull();
    expect(walkInPlacementFor({ ...inn, d: inn.d - 1 })).toBeNull();
    expect(walkInPlacementFor({ ...inn, id: undefined })).toBeNull();
  });

  it('stands the floors of a world that keeps the town records, never of one that owns them', () => {
    expect(townWalkInPlacements(BUILTIN_WORLD).map((p) => p.path)).toEqual(
      WALK_IN.map((building) => building.assetId),
    );
    // a plain copy of the built-in world keeps the records, and their floors
    expect(townWalkInPlacements({ ...BUILTIN_WORLD } as WorldContent)).toHaveLength(WALK_IN.length);
    // a document that took a town's buildings over as placements stands that
    // town's records down: Eastbrook and Fenbridge under authoredTowns,
    // Highwatch under its own family
    expect(
      townWalkInPlacements({
        ...BUILTIN_WORLD,
        promotedScenery: { authoredTowns: true },
      } as WorldContent).map((p) => p.path),
    ).toEqual(HIGHWATCH_WALK_IN.map((building) => building.assetId));
    expect(
      townWalkInPlacements({
        ...BUILTIN_WORLD,
        promotedScenery: { highwatchTown: true },
      } as WorldContent).map((p) => p.path),
    ).toEqual(
      [...EASTBROOK_LAYOUT.buildings, ...FENBRIDGE_LAYOUT.buildings]
        .filter((building) => building.walkIn)
        .map((building) => building.assetId),
    );
    expect(
      townWalkInPlacements({
        ...BUILTIN_WORLD,
        promotedScenery: { authoredTowns: true, highwatchTown: true },
      } as WorldContent),
    ).toEqual([]);
    expect(townWalkInPlacements(loadPublishedMap())).toEqual([]);
  });

  it('collides exactly as the same model placed in Studio', () => {
    for (const building of WALK_IN) {
      const record = recordOf(building.id);
      const placement = walkInPlacementFor(record);
      if (!placement) throw new Error(`${building.id} resolved no placement`);
      const town = buildingRecordColliders(record, 30, () => 0, WORLD_SEED);
      const studio: Collider[] = [];
      pushPlacementColliders(
        studio,
        { ...BUILTIN_WORLD, placements: [placement] } as WorldContent,
        WORLD_SEED,
      );
      expect(studio.length, building.id).toBeGreaterThan(0);
      // the Studio lane stamps a dev attribution on what it emits; nothing else differs
      expect(town, building.id).toEqual(studio.map(({ src: _src, ...rest }) => rest));
    }
  });

  it('keeps every walk-in floor inside the box the built-in ground query asks about', () => {
    for (const building of WALK_IN) {
      const placement = walkInPlacementFor(recordOf(building.id));
      if (!placement) throw new Error(`${building.id} resolved no placement`);
      const decks = authoredRampsForPath(placement.path);
      expect(decks.length, building.id).toBeGreaterThan(0);
      for (const deck of decks) {
        for (const [u, v] of [
          [-deck.hx, -deck.hz],
          [deck.hx, -deck.hz],
          [deck.hx, deck.hz],
          [-deck.hx, deck.hz],
        ]) {
          // the deck's corner, turned within the model, then placed in the world
          const inModel = rotY(u, v, deck.ry ?? 0);
          const offset = rotY(
            (deck.x + inModel.x) * placement.scale,
            (deck.z + inModel.z) * placement.scale,
            placement.rotY,
          );
          const x = placement.x + offset.x;
          const z = placement.z + offset.z;
          expect(nearTownWalkIn(x, z), `${building.id} deck corner`).toBe(true);
          expect(decksMayStand(BUILTIN_WORLD, x, z), `${building.id} deck corner`).toBe(true);
        }
      }
    }
    // away from the towns the built-in world asks for no deck at all: one box
    // per town, so the country between Eastbrook and Fenbridge and the road
    // between Fenbridge and Highwatch ask for none
    for (const [x, z] of [
      [0, 0],
      [120, 300],
      [0, 420],
      [0, 540],
      [0, 600],
      [80, 660],
      [0, 100],
      [-10, 200],
    ]) {
      expect(decksMayStand(BUILTIN_WORLD, x, z), `${x}, ${z}`).toBe(false);
    }
  });
});

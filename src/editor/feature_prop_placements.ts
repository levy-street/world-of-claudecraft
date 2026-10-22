// Promotes the per-zone FEATURE dressing, the Drakelands' den treasure and
// crystal groves, the Veiled Hollow's valley boulders, the Willowfen's pond
// flora, every other lake's lily rafts and reeds, and the strand's fallen
// coconuts, into ordinary editable map placements (the fen_willows contract:
// each render builder exports its ONE spot list and this module maps it).
//
// Conversion rules, pinned by tests/feature_prop_placements.test.ts:
// - placed_assets seats a model's LOWEST point at ground + placement.y and
//   normalizes it to targetHeightFor(path) / largest-dimension, so
//   placement.y = builder's world bottom minus terrainHeight, and
//   placement.scale = builderScale x modelMaxDim / targetHeight.
// - The feature builders come in two scale conventions: RAW model units times
//   the spot's uniform scale (realm/fen/jungle/water), and normalized-by-
//   footprint (ember's fp / foot). Every model here has its footprint as its
//   largest dimension, so ember's conversion collapses to fp / targetHeight.
// - `y` in a spot list may be ABSOLUTE (ember's flat-bed seats, the fen's
//   waterline lilies): always convert through terrainHeight.
//
// Doc flags: these families have no unique asset id to self-detect from the
// placements list (the fen and the lakes share the same lily model), so each
// promotion stamps map.promotedScenery[flag] = true, persisted by
// map_doc.ts and merged into the play/edit projections by promotedSceneryFor.

import { emberDressingSpots } from '../render/ember_features';
import { farshoreCoconutSpots } from '../render/farshore_features';
import { fenFloraSpots } from '../render/fen_features';
import { reachCoconutSpots } from '../render/jungle_features';
import { placeFlora } from '../render/realm_flora';
import { waterFloraRegions } from '../render/water_flora_core';
import { AUTHORED_TOWNS, type AuthoredTownFamily } from '../sim/authored_town_registry';
import { BUILTIN_WORLD } from '../sim/data';
import { EASTBROOK_LAYOUT, localToWorld } from '../sim/eastbrook_layout';
import { emberLilySpots } from '../sim/ember_lilies';
import { REMOVED_HIGHWATCH_BUILDINGS } from '../sim/highwatch_layout';
import { MAX_PLACEMENTS, type MapPlacement } from '../sim/map_doc';
import { PAINTED_TOWNS } from '../sim/painted_towns';
import type { ZonePropsDef } from '../sim/types';
import { terrainHeight } from '../sim/world';
import { civicPlacementFields } from '../sim/world_layout/civic';
import { authoredTownDressingPlacements } from './authored_town_dressing_placements';
import { decorPropPlacements, worldMajorPropPlacements } from './world_prop_placements';

/** targetHeightFor() for every /models/props/ path this module emits. */
const TARGET_HEIGHT = 2.2;

/** Largest source dimension per model (== its footprint for all of these),
 *  measured from the GLBs the way gen_prop_natural_size.mjs measures props.
 *  A remodel changes these; re-measure rather than eyeballing. */
const MODEL_MAX_DIM: Readonly<Record<string, number>> = {
  'props/dragon_hoard': 0.977,
  'props/dragon_eggs': 0.9438,
  'props/ember_lily': 0.9528,
  'props/rock_large_d': 1.0688,
  'props/fallen_coconuts': 0.9325,
  'props/fen_lilies': 0.9796,
  'props/fen_reeds': 0.9823,
  'props/fen_mushrooms': 0.9813,
  'props/fen_log': 0.9596,
};

function cleanZero(v: number): number {
  return Object.is(v, -0) ? 0 : v;
}

function placementOf(
  assetId: string,
  name: string,
  x: number,
  z: number,
  bottomWorldY: number,
  rawScale: number,
  rot: number,
  seed: number,
  collideRadius?: number,
): MapPlacement {
  const placement: MapPlacement = {
    assetId,
    name,
    x,
    z,
    y: bottomWorldY - terrainHeight(x, z, seed),
    rotY: cleanZero(rot),
    scale: (rawScale * (MODEL_MAX_DIM[assetId] ?? TARGET_HEIGHT)) / TARGET_HEIGHT,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    collide: false,
  };
  if (collideRadius !== undefined && collideRadius > 0) {
    placement.collide = true;
    placement.collisionMode = 'basic';
    placement.collideRadius = collideRadius;
  }
  return placement;
}

/** The Drakelands den dressing: hoards, egg clutches, ember lilies (their
 *  rocky-bed colliders preserved) and the crystal clusters. */
export function emberDressingPlacements(seed: number): MapPlacement[] {
  const dressing = emberDressingSpots(seed);
  const out: MapPlacement[] = [];
  dressing.hoards.forEach((h, i) => {
    out.push(
      placementOf(
        'props/dragon_hoard',
        `Dragon hoard ${i + 1}`,
        h.x,
        h.z,
        h.y,
        h.fp / (MODEL_MAX_DIM['props/dragon_hoard'] ?? 1),
        h.rot,
        seed,
      ),
    );
  });
  dressing.eggs.forEach((e, i) => {
    out.push(
      placementOf(
        'props/dragon_eggs',
        `Dragon eggs ${i + 1}`,
        e.x,
        e.z,
        e.y,
        e.fp / (MODEL_MAX_DIM['props/dragon_eggs'] ?? 1),
        e.rot,
        seed,
      ),
    );
  });
  // Lilies from the SIM list (it carries the rocky-bed collider radius the
  // world blocked with); the dressing list drops it.
  emberLilySpots(seed).forEach((lily, i) => {
    out.push(
      placementOf(
        'props/ember_lily',
        `Ember lily ${i + 1}`,
        lily.x,
        lily.z,
        lily.y - 0.1,
        lily.fp / (MODEL_MAX_DIM['props/ember_lily'] ?? 1),
        lily.rot,
        seed,
        lily.r,
      ),
    );
  });
  dressing.crystals.forEach((c, i) => {
    out.push(
      placementOf(
        'props/ember_lily',
        `Ember crystal ${i + 1}`,
        c.x,
        c.z,
        c.y,
        c.fp / (MODEL_MAX_DIM['props/ember_lily'] ?? 1),
        c.rot,
        seed,
      ),
    );
  });
  return out;
}

/** The Veiled Hollow's valley-floor boulders (the promoted copy is the plain
 *  kit rock without the builder's granite regrade, the catalog's own rock). */
export function realmBoulderPlacements(seed: number): MapPlacement[] {
  return placeFlora(seed).boulders.map((b, i) =>
    placementOf(
      'props/rock_large_d',
      `Hollow boulder ${i + 1}`,
      b.x,
      b.z,
      b.y - 0.12 * b.scale,
      b.scale,
      b.rot,
      seed,
    ),
  );
}

/** The Willowfen's pond lilies, reeds, mushroom clusters and anchor logs. */
export function fenFloraPlacements(seed: number): MapPlacement[] {
  const flora = fenFloraSpots(seed);
  const out: MapPlacement[] = [];
  flora.lilies.forEach((sp, i) => {
    out.push(
      placementOf('props/fen_lilies', `Fen lilies ${i + 1}`, sp.x, sp.z, sp.y, sp.s, sp.rot, seed),
    );
  });
  flora.reeds.forEach((sp, i) => {
    out.push(
      placementOf('props/fen_reeds', `Fen reeds ${i + 1}`, sp.x, sp.z, sp.y, sp.s, sp.rot, seed),
    );
  });
  flora.mushrooms.forEach((sp, i) => {
    out.push(
      placementOf(
        'props/fen_mushrooms',
        `Fen mushrooms ${i + 1}`,
        sp.x,
        sp.z,
        sp.y,
        sp.s,
        sp.rot,
        seed,
      ),
    );
  });
  flora.logs.forEach((sp, i) => {
    out.push(
      placementOf('props/fen_log', `Fen log ${i + 1}`, sp.x, sp.z, sp.y, sp.s, sp.rot, seed),
    );
  });
  return out;
}

/** Every other declared lake's lily rafts and shoreline reeds. */
export function waterFloraPlacements(seed: number): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (const region of waterFloraRegions(seed)) {
    region.lilies.forEach((sp, i) => {
      out.push(
        placementOf(
          'props/fen_lilies',
          `${region.zoneId} lilies ${i + 1}`,
          sp.x,
          sp.z,
          sp.y,
          sp.s,
          sp.rot,
          seed,
        ),
      );
    });
    region.reeds.forEach((sp, i) => {
      out.push(
        placementOf(
          'props/fen_reeds',
          `${region.zoneId} reeds ${i + 1}`,
          sp.x,
          sp.z,
          sp.y,
          sp.s,
          sp.rot,
          seed,
        ),
      );
    });
  }
  return out;
}

/** The strand palms' fallen-coconut clusters (Palmreach + the Farshore isle). */
export function jungleCoconutPlacements(seed: number): MapPlacement[] {
  const out: MapPlacement[] = [];
  reachCoconutSpots(seed).forEach((sp, i) => {
    out.push(
      placementOf(
        'props/fallen_coconuts',
        `Fallen coconuts ${i + 1}`,
        sp.x,
        sp.z,
        sp.y,
        sp.s,
        sp.rot,
        seed,
      ),
    );
  });
  farshoreCoconutSpots(seed).forEach((sp, i) => {
    out.push(
      placementOf(
        'props/fallen_coconuts',
        `Isle coconuts ${i + 1}`,
        sp.x,
        sp.z,
        sp.y,
        sp.s,
        sp.rot,
        seed,
      ),
    );
  });
  return out;
}

type NaturalSize = { x: number; y: number; z: number };

/** Natural sizes of the authored towns' building GLBs (measured like
 *  MODEL_MAX_DIM above). The Fenbridge set is authored at real yards, its
 *  per-axis fit multipliers come out ~1. A town building whose asset has no
 *  row here is left out of the Studio conversion, so tests/painted_towns.test.ts
 *  pins a row for every model of every painted look. */
export const TOWN_BUILDING_NATURAL: Readonly<Record<string, NaturalSize>> = {
  'biome/hexb_townhall': { x: 1.4351, y: 1.8861, z: 1.5638 },
  'biome/hexb_workshop': { x: 1.6654, y: 1.1537, z: 1.6672 },
  'biome/hexb_tavern': { x: 1.1718, y: 1.3967, z: 1.3324 },
  'biome/hex_church': { x: 1.0291, y: 1.645, z: 1.155 },
  'biome/hexb_home_a': { x: 0.7919, y: 0.93, z: 0.8537 },
  'biome/hexb_home_b': { x: 0.8749, y: 1.28, z: 1.0987 },
  'biome/hexb_market': { x: 1.7994, y: 0.9818, z: 1.3156 },
  // The painted Tidehold set Eastbrook is built from, authored in real yards.
  'tidehold/smithy': { x: 19.797, y: 12.7809, z: 11.6901 },
  'tidehold/tavern': { x: 22.6483, y: 18.7798, z: 16.7997 },
  'tidehold/hall': { x: 18.8515, y: 30.4998, z: 24.212 },
  'tidehold/bank': { x: 22.6067, y: 22.5005, z: 19.8387 },
  'tidehold/shop_a': { x: 13.004, y: 16.2797, z: 12.2001 },
  'tidehold/house_b': { x: 15.0123, y: 15.9799, z: 11.6997 },
  // ...and the rest of the default look the painted towns may stand
  // (sim/painted_towns/models.ts): the same models the looks below re-bake.
  'tidehold/tavern_b': { x: 30.262, y: 22.3513, z: 20.4279 },
  'tidehold/shop_b': { x: 13.6495, y: 18.7, z: 12.7017 },
  'tidehold/house_a': { x: 11.7628, y: 12.23, z: 9.8009 },
  'tidehold/house_c': { x: 12.7632, y: 19.5804, z: 16.2637 },
  // Fenbridge stands the same set in the Fenrire moss look: the same models
  // re-baked with other maps, so the same sizes.
  'tidehold/fenrire/house_a': { x: 11.7628, y: 12.23, z: 9.8009 },
  'tidehold/fenrire/tavern': { x: 22.6483, y: 18.7798, z: 16.7997 },
  'tidehold/fenrire/hall': { x: 18.8515, y: 30.4998, z: 24.212 },
  'tidehold/fenrire/shop_a': { x: 13.004, y: 16.2797, z: 12.2001 },
  'tidehold/fenrire/shop_b': { x: 13.6495, y: 18.7, z: 12.7017 },
  // Highwatch stands it in the Highwatch look (slate and granite): again
  // the same models re-baked, so the same sizes.
  'tidehold/highwatch/bank': { x: 22.6067, y: 22.5005, z: 19.8387 },
  'tidehold/highwatch/tavern_b': { x: 30.262, y: 22.3513, z: 20.4279 },
  'tidehold/highwatch/hall': { x: 18.8515, y: 30.4998, z: 24.212 },
  'tidehold/highwatch/shop_a': { x: 13.004, y: 16.2797, z: 12.2001 },
  'tidehold/highwatch/house_c': { x: 12.7632, y: 19.5804, z: 16.2637 },
  'tidehold/highwatch/smithy': { x: 19.797, y: 12.7809, z: 11.6901 },
  // The town looks (the town texture library's maps, each building with its
  // own stained glass): the same models re-baked, so the same sizes.
  'tidehold/pantile/house_a': { x: 11.7628, y: 12.23, z: 9.8009 },
  'tidehold/pantile/shop_a': { x: 13.004, y: 16.2797, z: 12.2001 },
  'tidehold/pantile/tavern': { x: 22.6483, y: 18.7798, z: 16.7997 },
  'tidehold/shakes/hall': { x: 18.8515, y: 30.4998, z: 24.212 },
  'tidehold/shakes/house_a': { x: 11.7628, y: 12.23, z: 9.8009 },
  'tidehold/shakes/tavern': { x: 22.6483, y: 18.7798, z: 16.7997 },
  'tidehold/diamond/hall': { x: 18.8515, y: 30.4998, z: 24.212 },
  'tidehold/diamond/house_c': { x: 12.7632, y: 19.5804, z: 16.2637 },
  'tidehold/diamond/shop_a': { x: 13.004, y: 16.2797, z: 12.2001 },
  'tidehold/diamond/smithy': { x: 19.797, y: 12.7809, z: 11.6901 },
  'tidehold/diamond/tavern': { x: 22.6483, y: 18.7798, z: 16.7997 },
  'tidehold/brick/hall': { x: 18.8515, y: 30.4998, z: 24.212 },
  'tidehold/brick/house_a': { x: 11.7628, y: 12.23, z: 9.8009 },
  'tidehold/brick/shop_a': { x: 13.004, y: 16.2797, z: 12.2001 },
  'tidehold/brick/smithy': { x: 19.797, y: 12.7809, z: 11.6901 },
  'tidehold/brick/tavern': { x: 22.6483, y: 18.7798, z: 16.7997 },
  'tidehold/thatch/hall': { x: 18.8515, y: 30.4998, z: 24.212 },
  'tidehold/thatch/house_a': { x: 11.7628, y: 12.23, z: 9.8009 },
  'tidehold/thatch/house_b': { x: 15.0123, y: 15.9799, z: 11.6997 },
  'tidehold/thatch/smithy': { x: 19.797, y: 12.7809, z: 11.6901 },
  'tidehold/thatch/tavern': { x: 22.6483, y: 18.7798, z: 16.7997 },
};

/**
 * One promoted family's rebuild BUILDINGS as editable placements: every
 * town of sim/authored_town_registry.ts that family promotes. The rest of
 * each town, wells, stalls, fences, streets, wall, harbor, stays town-drawn.
 *
 * Every town building is a PLACED one (the painted Tidehold set): it converts
 * back into the placement its record was built from, the model's own anchor,
 * one uniform scale and its buried footing, with the model's baked collision,
 * so the document's copy is the walk-in building a maker expects.
 */
function townBuildingPlacementsOf(family: AuthoredTownFamily): MapPlacement[] {
  const out: MapPlacement[] = [];
  const towns = AUTHORED_TOWNS.filter((town) => town.promotedBy === family);
  for (const b of towns.flatMap((town) => town.buildings)) {
    const assetId = b.assetId.replace(/^\/models\//, '').replace(/\.glb$/i, '');
    const nat = TOWN_BUILDING_NATURAL[assetId];
    if (!nat) continue;
    const maxDim = Math.max(nat.x, nat.y, nat.z);
    out.push({
      assetId,
      name: b.id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      x: b.placement.x,
      z: b.placement.z,
      y: b.placement.lift,
      rotY: cleanZero(b.placement.rotation),
      scale: (b.placement.scale * maxDim) / TARGET_HEIGHT,
      collide: true,
      collisionMode: 'baked',
    });
  }
  return out;
}

/** The authored towns' rebuild BUILDINGS (Eastbrook Vale + Fenbridge). */
export function authoredTownBuildingPlacements(_seed: number): MapPlacement[] {
  return townBuildingPlacementsOf('authoredTowns');
}

/** Highwatch's rebuild BUILDINGS: their own family (authored_town_registry.ts). */
export function highwatchTownBuildingPlacements(_seed: number): MapPlacement[] {
  return townBuildingPlacementsOf('highwatchTown');
}

/**
 * The kit placements the full-world conversion (worldMajorPropPlacements) made
 * for Highwatch's five old buildings before the painted town replaced them. A
 * document saved fully editable before that still holds them, and promoting
 * the painted buildings over them would stand two towns in one place.
 */
export function highwatchOldKitPlacements(seed: number): MapPlacement[] {
  const empty = Object.fromEntries(
    Object.entries(BUILTIN_WORLD.props).map(([key, value]) => [
      key,
      Array.isArray(value) ? [] : value,
    ]),
  ) as unknown as ZonePropsDef;
  const buildings = REMOVED_HIGHWATCH_BUILDINGS.map((record) => ({
    kind: record.kind,
    x: record.x,
    z: record.z,
    w: record.width,
    d: record.depth,
    rot: record.rotation,
  }));
  return worldMajorPropPlacements({ ...empty, buildings }, seed);
}

/** The painted towns' rebuild BUILDINGS (sim/painted_towns/): one family. */
export function paintedTownBuildingPlacements(_seed: number): MapPlacement[] {
  return townBuildingPlacementsOf('paintedTowns');
}

/**
 * The kit placements the full-world conversion made for the painted towns' old
 * buildings (each layout's replacedKitBuildings, exactly as its zone file had
 * them), lifted before the painted buildings are promoted over them: the
 * Highwatch rule for every painted town.
 */
export function paintedTownsOldKitPlacements(seed: number): MapPlacement[] {
  const empty = Object.fromEntries(
    Object.entries(BUILTIN_WORLD.props).map(([key, value]) => [
      key,
      Array.isArray(value) ? [] : value,
    ]),
  ) as unknown as ZonePropsDef;
  const buildings = PAINTED_TOWNS.flatMap((town) =>
    town.replacedKitBuildings.map((record) => ({ ...record })),
  );
  // ...and the hex-kit buildings a town replaced from its decor rows
  const decorProps = PAINTED_TOWNS.flatMap((town) =>
    town.replacedDecorProps.map((row) => ({ ...row })),
  );
  return [
    ...worldMajorPropPlacements({ ...empty, buildings }, seed),
    ...decorPropPlacements({ ...empty, decorProps }),
  ];
}

/** The Weekly Vault's placeable model (public/models/tidehold/vault.glb): the
 *  town-drawn hall's own boxes, authored in real yards, so its largest
 *  dimension over the target height draws it at the hall's size. The buried
 *  footing is the part of the model below its ground line. */
const WEEKLY_VAULT_MAX_DIM = 14.125;
const WEEKLY_VAULT_FOOTING = 1.45;

/**
 * The Eastbrook Weekly Vault as an editable placement, standing where the
 * town view draws it and seated by the same rule (its ground line at the
 * height of the ground in front of its door). The keeper is an ordinary NPC
 * and stays one.
 */
export function eastbrookVaultPlacements(seed: number): MapPlacement[] {
  const vault = EASTBROOK_LAYOUT.weeklyVault;
  const entrance = localToWorld(vault, vault.rot, 0, vault.d / 2);
  return [
    {
      assetId: 'tidehold/vault',
      name: 'Eastbrook weekly vault',
      x: vault.x,
      z: vault.z,
      y:
        terrainHeight(entrance.x, entrance.z, seed) -
        terrainHeight(vault.x, vault.z, seed) -
        WEEKLY_VAULT_FOOTING,
      rotY: cleanZero(vault.rot),
      scale: WEEKLY_VAULT_MAX_DIM / TARGET_HEIGHT,
      ...civicPlacementFields(vault.id),
      collide: true,
      collisionMode: 'baked',
    },
  ];
}

export const FEATURE_PROMOTIONS: readonly {
  flag: string;
  placements(seed: number): MapPlacement[];
  /** What an older conversion placed for the things this family replaces:
   *  each one still standing exactly where it was made is lifted first. */
  supersedes?(seed: number): MapPlacement[];
}[] = [
  { flag: 'emberDressing', placements: emberDressingPlacements },
  { flag: 'realmBoulders', placements: realmBoulderPlacements },
  { flag: 'fenFlora', placements: fenFloraPlacements },
  { flag: 'waterFlora', placements: waterFloraPlacements },
  { flag: 'jungleCoconuts', placements: jungleCoconutPlacements },
  { flag: 'authoredTowns', placements: authoredTownBuildingPlacements },
  { flag: 'eastbrookVault', placements: eastbrookVaultPlacements },
  { flag: 'authoredTownDressing', placements: authoredTownDressingPlacements },
  {
    flag: 'highwatchTown',
    placements: highwatchTownBuildingPlacements,
    supersedes: highwatchOldKitPlacements,
  },
  {
    flag: 'paintedTowns',
    placements: paintedTownBuildingPlacements,
    supersedes: paintedTownsOldKitPlacements,
  },
];

/** The same placement, untouched: one asset standing on the spot it was made. */
function sameSpot(a: MapPlacement, b: MapPlacement): boolean {
  return (
    a.assetId === b.assetId &&
    Math.abs(a.x - b.x) < 1e-6 &&
    Math.abs(a.z - b.z) < 1e-6 &&
    Math.abs((a.rotY ?? 0) - (b.rotY ?? 0)) < 1e-6
  );
}

/**
 * One-time upgrade for editable-all maps saved before a feature family
 * promoted (the promoteEditablePalms gates; idempotence via the doc flag).
 * Returns how many families were newly promoted.
 */
export function promoteFeatureDressing(map: {
  placements: MapPlacement[];
  promotedScenery?: Record<string, boolean>;
  propsMode?: 'empty' | 'editable-major' | 'editable-all';
  presentationMode?: string;
  content: { zones: readonly { id: string }[] };
  meta: { seed: number };
}): number {
  if (map.propsMode !== 'editable-all' || map.presentationMode !== undefined) return 0;
  // Builtin zone identity, id-for-id (the promoteMajorWorldProps gate): the
  // spot generators read the ACTIVE world's terrain/roads, so only a
  // builtin-shaped map can trust their output.
  const builtinIds = BUILTIN_WORLD.zones.map((zone) => zone.id);
  if (
    map.content.zones.length !== builtinIds.length ||
    !map.content.zones.every((zone, index) => zone.id === builtinIds[index])
  ) {
    return 0;
  }
  let promoted = 0;
  for (const family of FEATURE_PROMOTIONS) {
    if (map.promotedScenery?.[family.flag]) continue;
    const additions = family.placements(map.meta.seed);
    if (additions.length === 0) continue;
    const superseded = family.supersedes?.(map.meta.seed) ?? [];
    const lifted = map.placements.filter((placement) =>
      superseded.some((old) => sameSpot(old, placement)),
    ).length;
    if (map.placements.length - lifted + additions.length > MAX_PLACEMENTS) continue;
    if (lifted > 0) {
      // in place: the document's array keeps its identity
      for (let index = map.placements.length - 1; index >= 0; index--) {
        const placement = map.placements[index];
        if (superseded.some((old) => sameSpot(old, placement))) map.placements.splice(index, 1);
      }
    }
    map.placements.push(...additions);
    map.promotedScenery = { ...(map.promotedScenery ?? {}), [family.flag]: true };
    promoted++;
  }
  return promoted;
}

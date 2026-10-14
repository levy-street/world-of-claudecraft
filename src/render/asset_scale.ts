// The one normalization rule for placed catalogue GLBs: what world height a
// model lands at before its per-placement scale.
//
// This is the map editor's rule, and it is load-bearing for collision: the
// editor's collision bake normalizes with EXACTLY these numbers, so the baked
// boxes vendored into data/battleground/thornhollow_assets.json only line up
// with their models when the renderer seats them the same way. Changing a
// number here silently drifts every authored map's colliders off its art.

// Height (yards) a placed model is normalized to before its per-placement
// scale, so arbitrary catalogue GLBs (which vary wildly in source units) land
// sanely.
export const TARGET_HEIGHT = 2.2;

// Catalogue foliage lands at believable WORLD sizes instead of the generic
// prop height: a tree normalized to 2.2yd is doll-sized next to the ~2yd
// player, which made every brushed tree/bush read far too small no matter
// what the scale sliders said. Per-placement scale still multiplies on top,
// and the collide-radius factors are tuned against these same heights so the
// blocking circle keeps tracking the visual silhouette.

/** Largest source dimension (yards) of each Warden bridge module, from its
 *  build sidecar (tmp/asset_src/deepglass/<tag>.collision.json `size`). */
const BRIDGE_KIT_MAX_DIM: Record<string, number> = {
  bridge_deck: 72.21,
  bridge_lamp: 74.85,
  bridge_pylon: 79.22,
};

/** Largest source dimension of each Warden gate state (build sidecar `size`). */
const WARDEN_GATE_MAX_DIM: Record<string, number> = {
  warden_gate_closed: 8.34,
  warden_gate_open: 8.34,
};
/** Largest source dimension of the dock stairs (build sidecar `size`). */
const DOCK_STAIRS_MAX_DIM = 7.58;
/** Largest source dimension of the plot sign (dg_plot_sign.py sidecar `size`). */
const PLOT_SIGN_MAX_DIM = 2.48;
/** Largest source dimension of each dock deck module (build sidecar `size`). */
const DOCK_DECK_MAX_DIM: Record<string, number> = {
  dock_deck: 6.12,
  dock_deck_rail: 6.12,
};
/** Largest source dimension of each ring-city stair flight (dg_stair_flights.py
 *  stair_flights.sizes.json): 32 yd, the 26-yd run plus a 3-yd landing each end. */
const STAIR_FLIGHT_MAX_DIM: Record<string, number> = {
  stair_flight_38: 32,
  stair_flight_43: 32,
  stair_flight_16: 32,
};
/** Largest source dimension of each Warden wharf piece (dg_wharf.py sidecar `size`). */
const WHARF_KIT_MAX_DIM: Record<string, number> = {
  wharf_deck: 36,
  wharf_deck_rail: 37.72,
  wharf_deck_rails: 37.72,
  wharf_quay: 36,
  wharf_quay_rail: 37.72,
  wharf_bastion: 38.08,
  wharf_bastion_open: 38.08,
  wharf_stairs: 37.72,
  wharf_crane: 9.6723,
  wharf_mast: 24.1,
  wharf_lamp: 5.3,
  wharf_bollard: 2.786,
  wharf_rail: 8.0041,
  wharf_shed: 6.3,
  wharf_quay_wide: 36,
  wharf_quay_wide_rail: 37.72,
  wharf_berth: 37.52,
  // the Tidehold galleon (dg_galleon.py) and its gangplank
  wharf_galleon: 48.9121,
  wharf_gangplank: 5.9,
  wharf_mine_support: 8.3,
};

// The Deepglass trees (scripts/assets/deepglass/bl_dg_trees.py): authored in
// yards, trunk foot at the origin; scale 1 = as built (a 30 yd pine), so the
// trunk collision installed by finish_dg_trees.mjs lines up at norm 1.
// The Deepglass undergrowth (scripts/assets/deepglass/bl_dg_shrubs.py): ten
// shrubs and three grass clumps, authored in yards with the base at the
// origin, so scale 1 is as built (a 0.95 yd bush stays a 0.95 yd bush).
const DG_SHRUB_MAX_DIM: Record<string, number> = {
  shrub_round_a: 1.506,
  shrub_round_b: 2.366,
  shrub_sprawl: 2.341,
  shrub_upright: 1.734,
  shrub_twig_bare: 1.17,
  shrub_snow_a: 1.397,
  shrub_snow_b: 1.558,
  shrub_fern: 2.334,
  shrub_tuft: 1.106,
  shrub_rock_cling: 1.706,
  grass_tuft: 0.665,
  grass_tall: 1.806,
  grass_snow: 0.702,
  shrub_berry: 1.851,
  shrub_bloom: 2.018,
  shrub_heather: 1.285,
  grass_bloom: 0.882,
  grass_dry: 0.8,
};

const DG_TREE_MAX_DIM: Record<string, number> = {
  tree_pine_tall_a: 32.622,
  tree_pine_tall_b: 37.809,
  tree_pine_full: 25.867,
  tree_pine_lean: 28.355,
  tree_pine_young: 14.717,
  tree_pine_ragged: 26.22,
  tree_root_giant_a: 22.414,
  tree_root_giant_b: 26.42,
  tree_root_twin: 20.747,
  tree_root_crag_pine: 14.891,
  tree_pine_snow_tall: 33.692,
  tree_pine_snow_full: 24.228,
  tree_pine_snow_young: 13.932,
  tree_pine_pollen: 24.084,
  tree_pine_pollen_tall: 32.625,
  tree_bloom_giant: 20.664,
  tree_bloom_twist: 14.142,
  tree_bloom_weeping: 12.245,
};

// The Deepglass ARENA kit (scripts/assets/deepglass/bl_dg_arena.py): the
// spectator bowl as sixteen placeable 22.5-degree wedges plus its gatehouse,
// canopy and dressing. Authored in yards about each piece's own footprint
// centre with the base at z=0 and +X pointing OUTWARD, so a placement is
// centre + Rmid*(cos t, sin t) with rotY = -t and scale 1. Pinned from the
// build sidecars by install_authored.mjs --pin.
const DG_ARENA_MAX_DIM: Record<string, number> = {
  arena_stand: 39.3887,
  arena_stand_vom: 39.3887,
  arena_gatehouse: 71.9,
  arena_concourse: 24.737,
  arena_canopy: 39.642,
  arena_brazier: 8.7,
  arena_banner: 6.4,
  arena_box: 13,
  arena_scoreboard: 15.625,
  arena_pennant: 16.2,
  arena_causeway: 14.75,
  arena_floor: 60.467,
  arena_floor_gate: 60.467,
  arena_floor_core: 7.9,
};

// The Deepglass ice (scripts/assets/deepglass/bl_dg_ice.py): authored in yards,
// waterline (bergs, floes) or ground (glacier, spires) at the origin; scale 1 =
// as built, so the installed collision lines up at norm 1.
const DG_ICE_MAX_DIM: Record<string, number> = {
  ice_berg_a: 10.906,
  ice_berg_b: 14.512,
  ice_berg_small: 5.367,
  ice_floe_a: 7.4,
  ice_floe_b: 11.505,
  ice_glacier_face: 27.612,
  ice_spire_a: 8.962,
  ice_spire_b: 14.214,
};

// City ground clutter (scripts/assets/clutter/make_city_clutter.mjs): tiny
// pieces authored in yards, ground at the origin. Scale 1 = as built, so a
// pebble placed by hand is a pebble, not a 2.2 yd boulder. The painted
// clutter layer (render/city_clutter.ts) uses the raw models directly.
export const CITY_CLUTTER_MAX_DIM: Record<string, number> = {
  tile_broken: 0.61,
  tile_shards: 0.569,
  pebbles: 0.435,
  stones: 0.43,
  letter: 0.496,
  paper_scraps: 0.407,
  leaves: 0.495,
  straw: 0.591,
  splinters: 0.5,
  pot_shards: 0.438,
};

/** The model-space Y that should sit ON the terrain, for assets whose ground
 *  line is AUTHORED at the origin instead of at the bottom of the bounding
 *  box; null means seat by the bounding box, as everything else does.
 *
 *  The Deepglass trees (bl_dg_trees.py) bury geometry below y = 0 on purpose:
 *  a pine's trunk starts at -0.8 and a root giant's buttress tips dive to
 *  -1.3 with the underside of its root mound capped below them. Seating those
 *  by the bounding box lifts the whole tree by that depth, so the mound hovers
 *  and the roots end in mid-air instead of biting into the ground, which is
 *  most of what reads as a "gap" under a root giant. Their origin IS the
 *  ground line, so seat it there and let the buried part stay buried.
 *
 *  The arena kit (bl_dg_arena.py) does the same for the opposite reason: its
 *  wedges carry a battered base course that dives 2.2 yd below the floor so
 *  the building meets the ground (or the Deepglass water) on a plinth instead
 *  of a cut edge. Seating by the bounding box would lift the whole bowl by
 *  that depth and float the concourse off it.
 *
 *  The ring-city stair flights (dg_stair_flights.py) sit at the citadel
 *  stairBlock frame, origin 0.5 under the foot plaza, and their side rails
 *  dive 4 yd under the nosing line into the terrace: seated by the box they
 *  would rise 3 yd off every plaza.
 */
export function authoredGroundLine(path: string): number | null {
  return /\/deepglass\/(?:tree|shrub|grass|arena|stair_flight)_[a-z0-9_]+\.glb$/i.test(path)
    ? 0
    : null;
}

export function targetHeightFor(path: string): number {
  // The loader normalizes by the largest source dimension. This model is already
  // authored at 14 x 11 x 7.2 yards, so preserving its 14-yard width keeps the
  // full sidecar dimensions intact at placement scale 1.
  if (/goldcrest_bank_reference/i.test(path)) return 14;
  // The City Build wall tower is authored in real yards (9.6 tall) so its
  // arcade-floor height matches the wall-tower blueprint at placement scale 1;
  // preserve that instead of squashing to TARGET_HEIGHT.
  if (/\/city\/wall_tower\.glb$/i.test(path)) return 9.6;
  // The Deepglass colonnade pillar is Blender-authored at 9 yards with its
  // origin at the foot: keep it, so a placement's scale is height / 9.
  if (/\/props\/deepglass_pillar\.glb$/i.test(path)) return 9;
  // The Warden bridge kit (scripts/assets/deepglass/dg_bridge.py) is authored
  // in yards with the pier feet at the origin: keep each module at its authored
  // size, so scale 1 is an 8 yd square deck on 85 yd piers and the installed
  // collision (install_bridge.mjs, norm 1) lines up with the art.
  // The Warden Colossus (scripts/assets/deepglass/bl_warden_colossus.py) is a
  // 10.12-unit figure with its plinth foot at the origin: scale 1 = 10 yd, so a
  // cliff statue is simply scale = height / 10.
  if (/\/deepglass\/warden_colossus\.glb$/i.test(path)) return 10.12;
  const dgArena = /\/deepglass\/(arena_[a-z0-9_]+)\.glb$/i.exec(path);
  if (dgArena && DG_ARENA_MAX_DIM[dgArena[1]]) return DG_ARENA_MAX_DIM[dgArena[1]];
  const dgIce = /\/deepglass\/(ice_[a-z0-9_]+)\.glb$/i.exec(path);
  if (dgIce && DG_ICE_MAX_DIM[dgIce[1]]) return DG_ICE_MAX_DIM[dgIce[1]];
  const dgTree = /\/deepglass\/(tree_[a-z0-9_]+)\.glb$/i.exec(path);
  if (dgTree && DG_TREE_MAX_DIM[dgTree[1]]) return DG_TREE_MAX_DIM[dgTree[1]];
  const dgShrub = /\/deepglass\/((?:shrub|grass)_[a-z0-9_]+)\.glb$/i.exec(path);
  if (dgShrub && DG_SHRUB_MAX_DIM[dgShrub[1]]) return DG_SHRUB_MAX_DIM[dgShrub[1]];
  const bridge = /\/deepglass\/(bridge_[a-z0-9_]+)\.glb$/i.exec(path);
  if (bridge && BRIDGE_KIT_MAX_DIM[bridge[1]]) return BRIDGE_KIT_MAX_DIM[bridge[1]];
  // The Warden gate (dg_warden_gate.py) is kit-compatible with the 4 yd wall:
  // keep it at the WALL's yards-per-scale (2.2 / 4), so a gate placed at the
  // same scale as a wall run stands its authored 1.6x height with matching
  // courses. Collision installs at that same norm (install_authored.mjs).
  const gate = /\/deepglass\/(warden_gate_[a-z]+)\.glb$/i.exec(path);
  if (gate && WARDEN_GATE_MAX_DIM[gate[1]])
    return WARDEN_GATE_MAX_DIM[gate[1]] * (TARGET_HEIGHT / 4);
  // Dock stairs (dg_dock_stairs.py): authored in yards, scale 1 = as built.
  if (/\/props\/dock_stairs\.glb$/i.test(path)) return DOCK_STAIRS_MAX_DIM;
  // Plot sign (dg_plot_sign.py): authored yards, post foot at the origin; scale 1 = 2.58 yd tall.
  if (/\/props\/plot_sign\.glb$/i.test(path)) return PLOT_SIGN_MAX_DIM;
  // Dock deck modules (dg_dock_deck.py): authored yards, deck at the stairs' landing.
  const deck = /\/props\/(dock_deck(?:_rail)?)\.glb$/i.exec(path);
  if (deck && DOCK_DECK_MAX_DIM[deck[1]]) return DOCK_DECK_MAX_DIM[deck[1]];
  // Warden wharf kit (dg_wharf.py): authored yards, pile feet at the origin;
  // scale 1 = as built, so the installed decks and piles line up at norm 1.
  // Ring-city stair flights (dg_stair_flights.py): authored yards at the
  // stairBlock frame; scale 1 = as built, so a flight swaps in for the old
  // model/custom one at the same x/z/rotY/groundY.
  const stairFlight = /\/deepglass\/(stair_flight_[0-9]+)\.glb$/i.exec(path);
  if (stairFlight && STAIR_FLIGHT_MAX_DIM[stairFlight[1]])
    return STAIR_FLIGHT_MAX_DIM[stairFlight[1]];
  const wharf = /\/deepglass\/(wharf_[a-z0-9_]+)\.glb$/i.exec(path);
  if (wharf && WHARF_KIT_MAX_DIM[wharf[1]]) return WHARF_KIT_MAX_DIM[wharf[1]];
  // City ground clutter: authored yards, scale 1 = as built.
  const clutter = /\/clutter\/([a-z0-9_]+)\.glb$/i.exec(path);
  if (clutter && CITY_CLUTTER_MAX_DIM[clutter[1]]) return CITY_CLUTTER_MAX_DIM[clutter[1]];
  // Palms live in the biome set but are trees: match them wherever they sit.
  if (/beach_palm/i.test(path)) return 4;
  if (/desert_cactus_tall/i.test(path)) return 4.5;
  const m = /\/foliage\/([a-z0-9_]+)\.glb$/i.exec(path);
  if (!m) return TARGET_HEIGHT;
  const name = m[1];
  if (/^(oak|pine|twisted|dead)/.test(name)) return 7.5;
  if (/^bush/.test(name)) return 3.2;
  if (/^(fern|mushroom)/.test(name)) return 1.6;
  if (/^rock/.test(name)) return 2.4;
  return TARGET_HEIGHT;
}

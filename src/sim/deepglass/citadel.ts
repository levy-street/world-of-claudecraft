// TIDEHOLD — the Warden City above the Deepglass, at FULL scale.
//
// The bell sits on a mesa in the sky with a chasm all round it and nothing on
// the far side. This is the far side: the city the Wardens keep, terraced up
// the northern massif, joined to the arena terrace by a single causeway over
// the drop. Walk out of the bowl, over the Tideway, through the Tide Gate, up
// four wards, and the Warden's Seat is at the top looking back down at the
// glass.
//
// AUTHORED THROUGH THE STUDIO LAYERS, like the arena it serves: terrain stamps,
// placements, lights, point sounds, grass clear, ground paint, locations,
// blockers and routed NPCs — the same fields the editor writes. Nothing here
// needs bespoke render code, which is why the whole city is data and every
// piece of it can be opened in Studio and dragged.
//
// ---------------------------------------------------------------------------
// SCALE, and what "3x" means here
//
// The city was first laid out at hamlet scale: 6-yard houses on 150-yard
// terraces, which read as a diorama beside a 76-yard glass bell. This pass
// rebuilds it monumental:
//
//   - the CITY FRAME is scaled by TH_S inside th(), so every street,
//     terrace, route and district triples without touching the layout math;
//   - BUILDING heights triple with it (the H table), so a house is a real
//     three-storey stone house and the keep is a hundred-yard castle;
//   - HUMAN-SCALE furniture — market stalls, streetlamps, crates, barrels,
//     rails, torches — deliberately KEEPS its old size. Scale reads by
//     contrast: a lamp you know the height of makes the wall behind it tall.
//
// The land grew with it: the wards now stand on a broad peninsula between two
// glacial fjords, with an icy ocean below, grand bridge-causeways east and
// west off the fountain plaza, mountain ranges on three sides, and the frozen
// sea filling every low place the stamps carve.
//
// ---------------------------------------------------------------------------
// GEOMETRY, and why it is Cartesian rather than polar
//
// The caldera is built in polar coordinates because it IS a ring. A city is
// not: it has streets, terrace walls and building rows, and laying those out on
// an annulus sector means every row is a different length and nothing lines up.
// So the city has its own frame — `u` across (east positive), `v` along the
// axis (north, away from the bell) — with the origin at the Tide Gate, and one
// scaled translation puts it in the world.
//
// Terraces are stamped as overlapping `level`+`flat` discs. That mode drives
// the heightfield to EXACTLY its delta inside the radius and the stamps apply
// in array order, so a terrace laid last is a true plane at a known y no matter
// what the caldera did underneath it. Every building then stands on a height
// this file already knows, with no sampling and no float.
//
// The climb between wards is a run of small discs whose delta steps by
// TH_RAMP_STEP (0.375: small enough that a lip crossed within one tick-step
// still reads under the walkable slope limit), and kcas stair modules laid
// over the ramp carry the LOOK — steps to the eye, a smooth ramp to the
// character controller, which is the classic stairs trick.
// ---------------------------------------------------------------------------

import { assetFirePreset } from '../fire_effects';
import { localOffset, pol, RING_BANK, RING_CASTLE, RING_MONUMENT, RING_TAVERN, ringSeat } from './citadel_ring_frame';
import type {
  AssetFireEmitter,
  AssetFireStyle,
  BiomePaint,
  ColliderVolume,
  CustomPaintSwatch,
  HeightStamp,
  NpcDef,
  PlacedAsset,
  WorldContent,
} from '../types';

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/** World z of the Tide Gate — the city's v = 0. North of the chasm's far lip. */
// Ring city (citadel_ring.ts): the island's south quay. The renderer's city cull
// half-plane keys off this; the old city frame (th) only seats the residents'
// roster now, and ringSeat re-maps every (u, v) onto the ring.
export const TH_GATE_Z = 215;

/** The city-frame scale. Layout is authored in "city units" and rendered at
 *  three times that, which is how the whole plan tripled in one place. Heights
 *  do NOT pass through this — they are retuned by hand in the H table, because
 *  a lamp must stay lamp-sized while the wall behind it triples. */
// City frame scale. Tightened from the original 3 to 1.8 (a 40% shrink) because
// the wards read as mostly empty ground, then opened back up 20% to 2.16 —
// buildings keep their real size, only the distance between them moves. The
// arena is laid out in world units by layout.ts and is deliberately unaffected.
export const TH_S = 2.16;

/** City point (u across, v along) in world coordinates. */
export function th(u: number, v: number): { x: number; z: number } {
  return { x: u * TH_S, z: TH_GATE_Z + v * TH_S };
}

/** A ward: a flat shelf between two v bands at a fixed height. */
interface Ward {
  id: string;
  name: string;
  v0: number;
  v1: number;
  /** Half-width in u across the shelf. */
  halfU: number;
  y: number;
}

/**
 * The four wards, climbing away from the bell.
 *
 * Heights rise 12-18 yards a ward now: each terrace's retaining wall reads as
 * a true cliff under the tripled buildings, and the ramps joining them are
 * three times longer, so the grade stays a comfortable walk.
 */
export const TH_WARDS: readonly Ward[] = [
  { id: 'th_lower', name: 'The Tide Gate', v0: -6, v1: 52, halfU: 70, y: 18 },
  { id: 'th_market', name: 'The Glass Market', v0: 52, v1: 106, halfU: 82, y: 30 },
  { id: 'th_high', name: 'Wardens’ Row', v0: 106, v1: 152, halfU: 74, y: 44 },
  { id: 'th_keep', name: 'The Warden’s Seat', v0: 152, v1: 196, halfU: 52, y: 62 },
];

const ward = (id: string): Ward => {
  const found = TH_WARDS.find((w) => w.id === id);
  if (!found) throw new Error(`Tidehold: no ward ${id}`);
  return found;
};

export const TH_LOWER = ward('th_lower');
export const TH_MARKET = ward('th_market');
export const TH_HIGH = ward('th_high');
export const TH_KEEP = ward('th_keep');

/** Where the causeway meets the arena terrace (WORLD z), and its half width in
 *  WORLD yards. The causeway is the one piece of the city anchored in the
 *  arena's frame — it must land on the terrace whatever the city scale does. */
const TH_CAUSEWAY_Z0 = 94;
const TH_CAUSEWAY_HALF_W = 13;
/**
 * The Realm Builder monument on the Fountain Plaza (it stands where the
 * Wardens' Fountain stood): city-frame seat, height, and the derived world
 * placement the renderer's FX and the sim's inspect entity both read, so the
 * three can never disagree about where the statue is.
 *
 * The front plate faces SOUTH, down the boulevard toward the causeway: that is
 * the side a traveller meets walking up from the arena. The sculpt's front is
 * its local -Z, so no yaw is needed to point it that way.
 */
const TH_MONUMENT_SOURCE = { width: 0.755235, height: 0.991974, depth: 0.702649 } as const;
const TH_MONUMENT_SOURCE_RADIUS = 0.415158;
export const TH_MONUMENT = (() => {
  const height = 9.5; // Eastbrook's stands 7.6; Tidehold is the grander city
  const scale = height / TH_MONUMENT_SOURCE.height;
  const pos = pol(RING_MONUMENT.r, RING_MONUMENT.phi); // Baldemar's Square: the Glass Market crossroads
  return {
    u: 0,
    v: 79,
    x: pos.x,
    z: pos.z,
    rotY: 0,
    height,
    collide: Math.ceil(TH_MONUMENT_SOURCE_RADIUS * scale * 100) / 100,
    nativeWidth: TH_MONUMENT_SOURCE.width * scale,
    nativeHeight: height,
    nativeDepth: TH_MONUMENT_SOURCE.depth * scale,
    /** Reserved static-service id, one past Eastbrook's monument
     *  (eastbrook_layout.ts 2_000_000_100); the noticeboard band below is
     *  append-only, so this stays clear of it. */
    entityId: 2_000_000_101,
  } as const;
})();

/** Rise per causeway/ramp disc. Under MAX_STEP_HEIGHT = 0.9, so every step of
 *  the climb is a stride to the character controller rather than a wall. */
// Under 0.5, never 0.6: a lip is crossed inside ONE tick-step (~0.35 yd), so
// the climb gate reads lip/step as the slope — 0.6 lips read 1.7, OVER the 1.5
// walkable limit, and the old ramps stuttered and walled on the way up
// ("slightly too steep"). At 0.375 every lip reads ~1.07 and the climb strides
// smooth (and the body rides the flight's collider PLANE anyway, stairFloor);
// the stair PLACEMENTS (stairRunW) are the look laid over this ramp.
// Troy 2026-09-07: risers raised 0.3 -> 0.375 so every tread is 25% longer and
// a flight has a fifth fewer steps over the same climb (a 40 yd seam went from
// 100 steps of 0.4 yd to 80 of 0.5). The sim walks the collider plane, not the
// treads, so the riser is a LOOK, bounded only by what the heightfield's
// plateaus can resolve.
export const TH_RAMP_STEP = 0.375;

/** Ramp corridors joining the wards, by u centre (city units). Two per seam so
 *  the city has a west and an east climb and no single choke point. */
const TH_RAMP_U = [-34, 34];
const TH_RAMP_HALF_U = 8;

// ---------------------------------------------------------------------------
// The wider land: fjords, ocean, ranges, bridges. All WORLD units.
// ---------------------------------------------------------------------------

/** The glacial fjords flanking the city peninsula: sheer water channels
 *  between the ward cliffs and the far-shore ranges. */
const TH_FJORD_X = 305; // channel centre, mirrored east/west
const TH_FJORD_HALF_W = 55;
const TH_FJORD_Z0 = 150;
const TH_FJORD_Z1 = 780;
/** The icy sea floor. Well under the waterline, so the water reads deep. */
export const TH_SEA_FLOOR = -55;
/** The waterline, and how far the berg tables stand proud of it. The sea was
 *  at -16, well below the arena terrace (y 0); raised to just under the terrace
 *  so the moat and fjords read as a real sea lapping the island rather than a
 *  distant puddle at the bottom of a chasm. The bergs are stamped RELATIVE to
 *  this, so ice and water can never drift apart again — world.ts reads the same
 *  constant for the rendered surface, the swim volume and the underwater fog. */
export const TH_WATER_Y = -2;
const TH_BERG_FREEBOARD = 1.6;

/** The grand bridge-causeways east and west off the fountain plaza. They run
 *  along the plaza's own axis, so the city reads as a cross: causeway south,
 *  keep north, a bridge over the ice to a beacon terrace either side. */
export const TH_BRIDGE_Z = 389;
const TH_BRIDGE_HALF_W = 10;
const TH_BRIDGE_X0 = 240; // just inside the market ward's shelf edge
const TH_BRIDGE_X1 = 372;
/** The lit landing each bridge reaches: a shelf cut into the far-shore range. */
const TH_BEACON_TERRACE_X = 388;
const TH_BEACON_TERRACE_R = 32;
const TH_BRIDGE_Y = 30; // the market ward's own height, so the span is level

/** Far-shore and backing ranges (world units). */
const TH_FLANK_RANGE_X = 424;
const TH_BACK_RANGE_Z = 930;

// ---------------------------------------------------------------------------
// Model sizes, MEASURED (yards, raw GLB bounds) rather than guessed.
//
// The renderer normalizes every placed model to 2.2 yd tall at scale 1, so a
// placement's rendered HEIGHT is 2.2 * scale whatever the model is, and its
// footprint follows from the model's own aspect. `hi()` therefore asks for a
// height in yards, and `foot()` answers what that costs in ground — which is
// what a street layout actually needs to know.
// ---------------------------------------------------------------------------

const TARGET_H = 2.2;

/** Raw GLB bounds in yards. Measured, not guessed — `tmp/_measure_glb.mjs`
 *  reads them straight out of the files (and cross-checks against the browser's
 *  own Box3), so a number here is never someone's recollection of a model. */
const SIZE: Record<string, readonly [number, number, number]> = {
  'biome/kcas_wall': [4, 4, 1],
  'biome/kcas_wall_half': [2, 4, 1],
  'biome/kcas_wall_corner': [2.5, 4, 2.5],
  'biome/kcas_wall_gated': [4, 4, 1],
  'biome/kcas_wall_doorway': [4, 4, 1],
  'biome/kcas_wall_pillar': [4, 4, 1.5],
  'biome/kcas_wall_window': [4, 4, 1],
  'biome/kcas_stairs_wide': [7, 5.1, 4],
  'biome/kcas_barrier': [4, 1.1, 0.5],
  'biome/kcas_barrier_corner': [2.39, 1.4, 2.39],
  'biome/kcas_column': [0.7, 1.4, 0.7],
  'biome/kcas_pillar': [2.23, 4, 1.71],
  'biome/kcas_floor_large': [4, 0.15, 4],
  'biome/kcas_foundation': [2.2, 2, 2.2],
  'biome/kcas_torch': [0.55, 1.13, 0.55],
  'biome/hexb_home_a': [0.79, 0.93, 0.85],
  'biome/hexb_home_b': [0.87, 1.28, 1.1],
  'biome/hexb_tavern': [1.17, 1.4, 1.33],
  'biome/hexb_townhall': [1.44, 1.89, 1.56],
  'biome/hexb_workshop': [1.67, 1.15, 1.67],
  'biome/hexb_market': [1.8, 0.98, 1.32],
  'biome/hexb_shipyard': [1.92, 1.24, 1.88],
  'biome/hexb_stables': [1.86, 0.61, 2.13],
  'biome/hexb_tower_a': [0.99, 2.19, 1.15],
  'biome/hexb_tower_b': [1.2, 2.49, 1.38],
  'biome/hexb_tower_base': [0.93, 1.5, 1.11],
  'biome/hexb_windmill': [1.13, 1.46, 0.82],
  'biome/hexb_docks': [2, 1.44, 0.5],
  'biome/hex_castle': [1.98, 3.98, 2.26],
  'biome/hex_church': [1.03, 1.65, 1.15],
  'biome/hex_barracks': [1.44, 1.64, 1.57],
  'biome/hex_ship_blue': [1, 2.24, 2.26],
  'biome/hex_anchor': [0.22, 0.29, 0.05],
  'biome/hex_flag': [0.06, 0.28, 0.26],
  'biome/hexn_fence_stone': [0.2, 0.27, 1.15],
  'biome/hex_target': [0.239, 0.302, 0.142],
  'biome/hex_weaponrack': [0.2, 0.24, 0.13],
  'biome/hex_haybale': [0.4, 0.18, 0.216],
  'biome/hex_trough': [0.2, 0.105, 0.2],
  'biome/hex_crate_big': [0.21, 0.21, 0.21],
  'biome/hex_crate_open': [0.332, 0.206, 0.2],
  'biome/hex_sack': [0.107, 0.065, 0.16],
  'biome/hex_barrel': [0.201, 0.212, 0.201],
  'biome/hex_wheelbarrow': [0.238, 0.188, 0.506],
  'biome/hex_lumber': [0.686, 0.21, 0.331],
  'props/eastbrook_bank': [7, 7.8, 5.5],
  'props/eastbrook_chapel': [5.5, 7, 6],
  'props/eastbrook_smithy': [7, 7.5, 5.5],
  'props/eastbrook_toolworks': [5.5, 5.8, 4.5],
  'props/eastbrook_weaving_workshop': [5.5, 5.8, 4.5],
  'props/eastbrook_grand_armoury': [13, 16.35, 9],
  'props/eastbrook_inn': [7.5, 8.5, 6],
  'props/eastbrook_market_stall': [2.8, 2.7, 2.2],
  'props/eastbrook_civic_well_beacon': [3.2, 3.1, 3.2],
  'props/eastbrook_noticeboard': [2.4, 2.6, 0.6],
  'props/streetlamp_veiled_crystal': [2.59, 5.5, 2.51],
  'props/frostveil_ice_spire': [1.76, 3.2, 1.03],
  'props/crystal_amethyst_cluster': [4.4, 6, 4.71],
  'props/bell_tower': [1.94, 4.76, 2.23],
  'props/barrel': [0.7, 0.9, 0.7],
  'props/crate_wooden': [0.84, 0.93, 0.91],
  'props/banker_chest': [2.2, 1.31, 1.3],
  'props/garden_iron_fence': [4, 2.2, 0.5],
  'props/garden_arch': [4.22, 4.41, 0.77],
  'props/flower_bed_round': [0.98, 0.5, 0.98],
  'props/dock_platform': [2.5, 1.31, 2.51],
  'props/fenbridge_gate_arch': [7.2, 4.8, 1],
  // The arena's own kit, standing in the city as monuments: the cradle pylon
  // is the Deepglass's signature silhouette, and a colonnade of them ties the
  // two places into one architecture. Measured like everything else.
  'deepglass/cradle_pylon': [3.047, 8.77, 3.059],
  // The Warden Wall: the city's own curtain-wall kit, authored in the pylon's
  // language (scripts/assets/deepglass/dg_wall.py). Same 4 wide x 4 tall
  // envelope as the kcas wall it replaced, so wallSpan() and every existing
  // run height still hold; ~170 / ~230 tris per module.
  'deepglass/warden_wall': [4, 4, 1.34],
  'deepglass/warden_wall_pillar': [4, 4, 1.9],
  // The Warden Tower (dg_tower.py): octagonal, 8 tall x ~4.1 across, so the
  // height argument is the tower's height. Stands in for every hexb tower.
  'deepglass/warden_tower': [4.1, 8, 4.2],
  'deepglass/warden_tower_spire_e': [8.52, 24.19, 8.59],
  'deepglass/warden_tower_spire_d': [8.22, 28.1, 8.72],
  'deepglass/warden_tower_spire_c': [8.28, 19.99, 8.12],
  'deepglass/warden_tower_spire_b': [9.11, 25.8, 8.03],
  'deepglass/warden_tower_spire': [8.5, 24.14, 8.18],
  // The Warden pylon: the Blender-authored replacement for the colossi, built
  // to the cradle pylon's envelope so every height below places unchanged
  // (scripts/assets/build_deepglass_warden_pylon.py).
  'deepglass/warden_pylon': [3.05, 8.77, 3.05],
  // Tidehold's own two: built for this city (Blender, plain PBR, no textures).
  // The beacon's bounds INCLUDE its light beam — placed at H.beacon the solid
  // tower is about two thirds and the beam carries the rest into the sky.
  'props/tidehold_fountain': [10.8, 6.15, 10.8],
  // The Realm Builder monument (scripts/assets/specs/realm_builder_monument.json):
  // measured off the shipped GLB, the same numbers eastbrook_layout.ts carries.
  'props/eastbrook_realm_builder_monument': [0.755235, 0.991974, 0.702649],
  'props/tidehold_skybeacon': [4.4, 14.2, 4.4],
  // Ring city dressing (citadel_ring.ts), measured 2026-09-07:
  'props/farmcrate_apple': [0.714, 0.244, 0.414],
  'props/market_stand_1': [0.951, 1.049, 1.19],
  'props/market_stand_2': [0.517, 1.042, 1.154],
  // Ring city dressing (citadel_ring.ts), measured 2026-09-07:

  // The explorable buildings (Blender-assembled from the medieval_village_v2
  // kit, tmp scratchpad bl_*.py): authored at WORLD scale in yards, so their
  // placements pass maxDim as the height argument — scale = maxDim/2.2 exactly
  // cancels the loader's normalization and the building renders at authored
  // size. Collision is authored per-asset (asset_collision_overrides), the
  // roof/upper-storey hide is render/interior_reveal.ts.
  'tidehold/tavern': [26.78, 22.21, 22.09],
  'tidehold/tavern_b': [56.76, 33.70, 42.64], // bl_tavern_b.py, measured on install
  'props/plot_sign': [0.233, 2.48, 1.9], // dg_plot_sign.py sidecar
  'tidehold/bank': [25.91, 27.03, 22.11],
  'tidehold/market': [35.64, 13.96, 19.53],
  'tidehold/smithy': [21.1, 14.07, 16.58],
  'tidehold/hall': [22.51, 28.66, 34.7],
  // Filler houses (tmp/blender_tidehold/bl_houses.py): non-enterable, closed
  // doors, plank walls, slate roofs. Front faces -Z like the big five.
  'tidehold/house_a': [12.19, 14.43, 12.39],
  'tidehold/house_b': [16.09, 19.42, 12.7],
  'tidehold/house_c': [13.23, 19.24, 19.23],
  'tidehold/house_d': [16.09, 15.91, 22.35],
  'tidehold/house_e': [23.91, 19.42, 12.2],
  // The Warden's Keep (bl_castle.py): enterable, two castle storeys + a roof
  // terrace, stone stair flights, a walled courtyard with a gatehouse.
  'tidehold/castle': [41.37, 37.79, 47.87],
  // Castle B (bl_castle_b.py): nine round towers, gatehouse, hall + wings.
  'tidehold/castle_b': [76.194, 61.87, 70.254], // measured on install (finials on every cone)
  'props/stone_step': [1, 1, 1.1],
};

/** Placement height argument that renders an authored-at-world-scale model at
 *  its authored size: the model's largest dimension (see SIZE note above). */
export const AUTHORED = {
  tavern: 26.78,
  tavern_b: 56.76,
  bank: 27.03,
  market: 35.64,
  smithy: 21.1,
  hall: 34.7,
  house_a: 14.43,
  house_b: 19.42,
  house_c: 19.24,
  house_d: 22.35,
  house_e: 23.91,
  castle: 47.85,
  castle_b: 76.14,
} as const;

/** The scale that renders `id` at `heightYd` yards tall. */
export function hi(id: string, heightYd: number): number {
  if (!SIZE[id]) throw new Error(`Tidehold: unmeasured model ${id}`);
  return heightYd / TARGET_H;
}

/** The ground footprint (width, depth in the model's own axes) of `id` when
 *  rendered `heightYd` tall. Street layout reads this so rows never overlap. */
export function foot(id: string, heightYd: number): { w: number; d: number } {
  const s = SIZE[id];
  if (!s) throw new Error(`Tidehold: unmeasured model ${id}`);
  const k = heightYd / s[1];
  return { w: s[0] * k, d: s[2] * k };
}

/** The horizontal span one modular kcas wall module covers at a given height.
 *  The kit is 4 wide x 4 tall, so a module is exactly as wide as it is tall. */
function wallSpan(heightYd: number): number {
  return heightYd;
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

interface PlaceOpts {
  rotY?: number;
  /** Per-axis scale multipliers on top of the uniform scale (gizmo semantics). */
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  /** Seat the model at EXACTLY this world height instead of sampling the
   *  terrain under its anchor — what lets a stair module sit flush on a
   *  graded ramp whose height varies across the module's own footprint. */
  seatY?: number;
  /** Collision opt-in AND the fallback radius. Any value > 0 turns collision
   *  on; unless `custom` is also set, the model's BAKED box set (or its
   *  Collision Master override) supplies the real hitboxes and this number is
   *  only the last-resort circle for a model with no bake entry. */
  collide?: number;
  square?: boolean;
  /** Keep the hand-authored circle/square INSTEAD of the baked boxes. The old
   *  default; now the exception, because the city wants real hitboxes — walk
   *  through an archway, stand against a wall's actual face. */
  custom?: boolean;
  /** Authored flame/glow emitters (hearths, forges, chandeliers): the warm
   *  light that keeps an explorable interior readable under the pinned dusk. */
  fireEffects?: readonly AssetFireEmitter[];
}

/** Place at a WORLD position. The city-frame `place()` below wraps this. */
export function placeW(
  out: PlacedAsset[],
  id: string,
  x: number,
  z: number,
  heightYd: number,
  opts: PlaceOpts = {},
): PlacedAsset {
  const asset: PlacedAsset = {
    path: `/models/${id}.glb`,
    x,
    z,
    rotY: opts.rotY ?? 0,
    scale: hi(id, heightYd),
  };
  if (opts.scaleX !== undefined) asset.scaleX = opts.scaleX;
  if (opts.scaleY !== undefined) asset.scaleY = opts.scaleY;
  if (opts.scaleZ !== undefined) asset.scaleZ = opts.scaleZ;
  if (opts.seatY !== undefined) {
    asset.detached = true;
    asset.groundY = opts.seatY;
  }
  if (opts.collide !== undefined && opts.collide > 0) {
    asset.collideRadius = opts.collide;
    if (opts.custom) {
      // A deliberately simple footprint. Saying so keeps Studio from swapping
      // it for the baked set on first edit.
      asset.collideCustom = true;
      if (opts.square) asset.collideShape = 'square';
    }
  }
  if (opts.fireEffects && opts.fireEffects.length > 0) {
    asset.fireEffects = opts.fireEffects;
  }
  out.push(asset);
  return asset;
}

/** A fire/glow emitter at model-local yard offsets (anchor 'base', so offsets
 *  are from the placement's ground point, rotated with the building). */
export function flame(
  id: string,
  style: AssetFireStyle,
  x: number,
  y: number,
  z: number,
  over: Partial<AssetFireEmitter> = {},
): AssetFireEmitter {
  return { ...assetFirePreset(style, id), anchor: 'base', x, y, z, ...over };
}

/** Place at a CITY (u, v) position. */
function place(
  out: PlacedAsset[],
  id: string,
  u: number,
  v: number,
  heightYd: number,
  opts: PlaceOpts = {},
): PlacedAsset {
  const p = th(u, v);
  return placeW(out, id, p.x, p.z, heightYd, opts);
}

/**
 * A straight run of modular wall between two WORLD points, with a pillar every
 * `pillarEvery` modules and a gate GAP at the run's midpoint when asked.
 *
 * The kcas wall's face lies in its local XZ with the wall running along local
 * X, so `rotY` is the run's compass bearing and each module steps one span
 * along it.
 */
export function wallRunW(
  out: PlacedAsset[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  heightYd: number,
  opts: {
    pillarEvery?: number;
    gateAtMid?: boolean;
    torches?: boolean;
    /** Module index this run continues from, so a wall laid one module at a
     *  time (an arc) still gets a pillar every `pillarEvery` — a fresh run per
     *  module made EVERY module a pillar and no plain panel ever appeared. */
    startIndex?: number;
  } = {},
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const span = wallSpan(heightYd);
  const modules = Math.max(1, Math.round(len / span));
  // Bearing: the sim's yaw convention points along (sin f, cos f), so a run
  // heading (dx, dz) is atan2(dx, dz).
  const rotY = Math.atan2(dx, dz) + Math.PI / 2;
  const pillarEvery = opts.pillarEvery ?? 4;
  const mid = Math.floor(modules / 2);
  for (let i = 0; i < modules; i++) {
    const t = (i + 0.5) / modules;
    const x = x0 + dx * t;
    const z = z0 + dz * t;
    // A gate is a GAP, not a module. The gated wall piece is a closed
    // portcullis: standing in a curtain wall it reads as a shut gate that a
    // player then walks straight through, which is worse than either. The run
    // simply omits its middle module and the caller stands an arch there.
    if (opts.gateAtMid === true && i === mid) continue;
    const isPillar = ((opts.startIndex ?? 0) + i) % pillarEvery === 0;
    const id = isPillar ? 'deepglass/warden_wall_pillar' : 'deepglass/warden_wall';
    placeW(out, id, x, z, heightYd, { rotY, collide: span * 0.5 });
    if (opts.torches === true && isPillar) {
      // Torches stay HUMAN scale whatever the wall does: a sconce at eye
      // height, not a bonfire on a cliff.
      placeW(out, 'biome/kcas_torch', x, z, 2.6, { rotY });
    }
  }
}

/** wallRunW in city coordinates. */
function wallRun(
  out: PlacedAsset[],
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  heightYd: number,
  opts: { pillarEvery?: number; gateAtMid?: boolean; torches?: boolean } = {},
): void {
  const a = th(u0, v0);
  const b = th(u1, v1);
  wallRunW(out, a.x, a.z, b.x, b.z, heightYd, opts);
}

/** A balustrade run between two WORLD points — the low kcas barrier, for
 *  terrace lips, the causeway and the bridge decks. Human scale on purpose. */
function barrierRunW(
  out: PlacedAsset[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  heightYd = 2.4,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const span = foot('biome/kcas_barrier', heightYd).w;
  const modules = Math.max(1, Math.round(len / span));
  const rotY = Math.atan2(dx, dz) + Math.PI / 2;
  for (let i = 0; i < modules; i++) {
    const t = (i + 0.5) / modules;
    placeW(out, 'biome/kcas_barrier', x0 + dx * t, z0 + dz * t, heightYd, {
      rotY,
      collide: span * 0.5,
      square: true,
      custom: true,
    });
  }
}

/** barrierRunW in city coordinates. */
function barrierRun(
  out: PlacedAsset[],
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  heightYd = 2.4,
): void {
  const a = th(u0, v0);
  const b = th(u1, v1);
  barrierRunW(out, a.x, a.z, b.x, b.z, heightYd);
}

/** Crystal streetlamps down both sides of a north-south street (city units). */
function lampRow(
  out: PlacedAsset[],
  uCentre: number,
  vFrom: number,
  vTo: number,
  halfU: number,
  step = 10,
  heightYd = 5.5,
): void {
  for (let v = vFrom; v <= vTo; v += step) {
    for (const side of [-1, 1]) {
      place(out, 'props/streetlamp_veiled_crystal', uCentre + side * halfU, v, heightYd, {
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        collide: 0.6,
        custom: true,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The land
// ---------------------------------------------------------------------------

/**
 * A flat shelf at exactly `y`, tiled from overlapping level discs. WORLD units.
 *
 * The centres are INSET by one radius. A disc centred on the boundary reaches a
 * full radius past it, and since the wards are stamped in climbing order that
 * bleed had each terrace eating a full disc off the one below it — the Tide
 * Gate's stables ended up standing on the market's shelf. Inset, the union's
 * edge lands on the boundary instead, give or take the scallop between
 * neighbouring arcs, which is what a terrace cut out of rock should look like
 * anyway.
 */
function shelfW(
  out: HeightStamp[],
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  discR = 45,
): void {
  const step = discR * 0.78; // overlap enough that no scallop reaches the middle
  const ix0 = x0 + discR;
  const ix1 = x1 - discR;
  const iz0 = z0 + discR;
  const iz1 = z1 - discR;
  const cols = Math.max(1, Math.ceil(Math.abs(ix1 - ix0) / step));
  const rows = Math.max(1, Math.ceil(Math.abs(iz1 - iz0) / step));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      out.push({
        x: ix0 + ((ix1 - ix0) * c) / cols,
        z: iz0 + ((iz1 - iz0) * r) / rows,
        radius: discR,
        delta: y,
        falloff: 'flat',
        mode: 'level',
      });
    }
  }
}

/** shelfW over a ward's city-frame rectangle, with a little apron margin so
 *  the curtain walls never stand on the very lip of their own cliff. */
function wardShelf(out: HeightStamp[], w: Ward, marginU = 6): void {
  const a = th(-w.halfU - marginU, w.v0);
  const b = th(w.halfU + marginU, w.v1);
  shelfW(out, a.x, b.x, a.z, b.z, w.y);
}

/** A graded climb along z from y0 to y1, as a run of small level discs. WORLD.
 *
 *  The discs are wide (they must cover the lane's full width), so each one
 *  reaches far past its own tread along z — and level stamps apply in array
 *  order, later wins. Stamped AT the tread line, the highest disc covering a
 *  point governed it, which slid the whole grade a disc-radius EARLY: the
 *  climb began and topped out ~discR before its authored span, and the stair
 *  modules laid on the nominal line sat buried under the shifted slope. Each
 *  disc's CENTRE is therefore pushed one radius PAST its tread, so the last
 *  disc covering a point is exactly the one whose tread it is: the grade
 *  lands on the authored span, tread for tread. */
/** How far the ground beside a stair lane runs off from tread level to
 *  whatever lies beside it, yards. The lane's flat plateaus end in a vertical
 *  face at their rim (an embankment wall where the flank is lower, a trench
 *  wall where the flank is the upper terrace, up to 13 yd tall at a seam's
 *  head); a smooth-falloff disc centred ON that rim, stamped before the flat
 *  band, turns the face into a slope this wide — 14 keeps the steepest trench
 *  wall near 45 degrees. The cost is that a disc spills the same distance
 *  past the flight's head and foot, where its plateau is a few risers off the
 *  plaza: a shallow saddle at the stair corners rather than a sharp edge. */
const TH_RAMP_SHOULDER = 14;
/** Smallest plateau disc, yards. A tread can be a yard deep; discs that small
 *  would take fifty across a lane, and the heightfield cannot resolve them. */
const TH_RAMP_DISC_MIN = 3;

/**
 * The stepped ground under a flight: one LEVEL plateau per tread, each a band
 * across the whole lane.
 *
 * A band is a row of small flat discs, not one lane-wide disc. The old form
 * was a single disc per tread of the lane's half-width, centred one radius
 * past its tread so its leading edge landed where the tread starts (the
 * grade-shift fix). One big disc per tread CROWNS the lane: a point on the
 * centreline is reached by discs a full radius further along the climb, a
 * point at the rim only by discs a few yards along, so mid-flight the rim sat
 * 2.7 yd under the centreline and the stair block's side walls stood that
 * far proud of the ground — a wall down both edges of every flight. Small
 * discs reach only a tread or so ahead wherever they sit, so every plateau is
 * level from rim to rim and meets the block's treads at its edges.
 *
 * Stamp order: EVERY shoulder of the flight first (every other tread is
 * plenty at a 14 yd radius), then every flat band. A shoulder reaches 14 yd
 * back along the climb, so interleaving them let a later tread's shoulder
 * lift the rim of an earlier plateau a yard above its own centreline; with
 * the bands last, the lane is exact and the shoulders only shape the ground
 * beyond its rim.
 */
function rampW(
  out: HeightStamp[],
  xCentre: number,
  halfW: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
): void {
  const rise = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.abs(rise) / TH_RAMP_STEP));
  const tread = Math.abs(z1 - z0) / steps;
  const dir = Math.sign(z1 - z0) || 1;
  const r = Math.max(tread, TH_RAMP_DISC_MIN) * 1.1;
  // The lane's rim stays where the old disc put it, a little outside the
  // stair block, so the block's edges always stand on level ground.
  const rimR = halfW * 1.1;
  const across = Math.max(1, Math.ceil((2 * rimR) / (r * 0.78)));
  // Leading edge at the tread's start (the same rule as before, at the small
  // radius); a band reaches 2r along, past the next tread's start, and that
  // later band wins the overlap.
  const zAt = (i: number): number => z0 + ((z1 - z0) * i) / steps + dir * r;
  const yAt = (i: number): number => y0 + (rise * i) / steps;
  for (let i = 0; i <= steps; i += 2) {
    for (const side of [-1, 1]) {
      out.push({
        x: xCentre + side * rimR,
        z: zAt(i),
        radius: TH_RAMP_SHOULDER,
        delta: yAt(i),
        falloff: 'smooth',
        mode: 'level',
      });
    }
  }
  for (let i = 0; i <= steps; i++) {
    for (let k = 0; k <= across; k++) {
      out.push({
        x: xCentre - rimR + ((2 * rimR) * k) / across,
        z: zAt(i),
        radius: r,
        delta: yAt(i),
        falloff: 'flat',
        mode: 'level',
      });
    }
  }
}

/** A level strip along x (for the bridge decks): overlapping discs at fixed y. */
function stripW(
  out: HeightStamp[],
  x0: number,
  x1: number,
  z: number,
  y: number,
  discR: number,
): void {
  const step = discR * 0.78;
  const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / step));
  for (let i = 0; i <= n; i++) {
    out.push({
      x: x0 + ((x1 - x0) * i) / n,
      z,
      radius: discR,
      delta: y,
      falloff: 'flat',
      mode: 'level',
    });
  }
}

/**
 * The Tideway: the one causeway over the chasm.
 *
 * Real ground, not a bridge deck — a raised isthmus the level stamps carve out
 * of the drop, so it collides and pathfinds like any other floor. The chasm is
 * left open either side of it — open ICE WATER now — which is what makes it
 * read as a span.
 */
function causewayTerrain(out: HeightStamp[]): void {
  const gate = th(0, TH_LOWER.v0);
  rampW(out, 0, TH_CAUSEWAY_HALF_W, TH_CAUSEWAY_Z0, gate.z, 0, TH_LOWER.y);
}

/** Deterministic, hash-free variation: a fixed cosine walk, so the land builds
 *  identically on every host (world content must). */
function drift(i: number): number {
  return Math.cos(i * 2.399) * 0.5 + Math.sin(i * 1.117) * 0.5;
}

/**
 * The icy sea floor: everything low is water now.
 *
 * Carved BEFORE the ranges and the ward shelves (see citadelBackingRange's
 * ordering note), so mountains rise out of the sea and the city planes cut
 * their own edges clean. Three families:
 *
 *   - an ocean ring around the whole caldera, skipping the city's north arc;
 *   - the two fjords flanking the city peninsula;
 *   - the fjord mouths, where channel meets ocean.
 */
function seaFloor(out: HeightStamp[]): void {
  // The ocean ring, two rows deep. Kept outside r 250 so the chasm moat and
  // the arena terrace keep their own shape; the chasm floor (-46) is already
  // below the waterline, which is what turns the ring chasm into a moat.
  for (const [ringR, discR] of [
    [280, 90],
    [380, 110],
  ] as const) {
    const n = Math.ceil((Math.PI * 2 * ringR) / (discR * 1.2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // The city's arc: leave the peninsula alone. The fjords cut their own
      // water there, precisely, rather than a broad ring doing it loosely.
      let d = Math.abs(a - Math.PI / 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < 1.05) continue;
      out.push({
        x: Math.cos(a) * ringR,
        z: Math.sin(a) * ringR,
        radius: discR,
        delta: TH_SEA_FLOOR,
        falloff: 'smooth',
        mode: 'level',
      });
    }
  }
  // The fjords: straight glacial channels along both flanks of the peninsula.
  for (const side of [-1, 1]) {
    const x = side * TH_FJORD_X;
    const step = TH_FJORD_HALF_W * 0.9;
    const n = Math.ceil((TH_FJORD_Z1 - TH_FJORD_Z0) / step);
    for (let i = 0; i <= n; i++) {
      out.push({
        x,
        z: TH_FJORD_Z0 + ((TH_FJORD_Z1 - TH_FJORD_Z0) * i) / n,
        radius: TH_FJORD_HALF_W,
        falloff: 'smooth',
        delta: TH_SEA_FLOOR,
        mode: 'level',
      });
    }
    // The mouths: join each channel to the southern ocean.
    out.push({
      x: side * 320,
      z: 90,
      radius: 70,
      delta: TH_SEA_FLOOR,
      falloff: 'smooth',
      mode: 'level',
    });
    out.push({
      x: side * 350,
      z: -10,
      radius: 80,
      delta: TH_SEA_FLOOR,
      falloff: 'smooth',
      mode: 'level',
    });
  }
}

/**
 * The ranges: the far shore of each fjord, and the wall of peaks behind the
 * Warden's Seat. Also the SEA FLOOR, which must come first in this same array
 * so the mountains rise out of the water rather than being flattened by it.
 *
 * (This function keeps its old name — world.ts spreads it between the caldera
 * and the city terraces, which is exactly the order all of this needs.)
 */
export function citadelBackingRange(): HeightStamp[] {
  const out: HeightStamp[] = [];
  seaFloor(out);

  // The far-shore ranges, one along each fjord. Two rows so they read as
  // country rather than a fence of teeth. Peaks whose skirt would cross the
  // bridge corridor are pushed clear of it: without the shove the spans dove
  // into a slot canyon between two range toes and the beacon terraces read as
  // holes drilled through a mountain rather than lit landings.
  const clearOfSpan = (z: number): number => {
    const d = z - TH_BRIDGE_Z;
    if (Math.abs(d) >= 88) return z;
    return TH_BRIDGE_Z + (d >= 0 ? 88 : -88);
  };
  for (const side of [-1, 1]) {
    const peaks = 8;
    for (let i = 0; i < peaks; i++) {
      const j = drift(i + (side < 0 ? 3 : 11));
      const z = clearOfSpan(200 + ((TH_FJORD_Z1 - 120 - 200) * i) / (peaks - 1) + j * 24);
      out.push({
        x: side * (TH_FLANK_RANGE_X + j * 22),
        z,
        radius: 64 + j * 12,
        delta: 165 + Math.abs(j) * 55,
        falloff: 'smooth',
        mode: 'add',
      });
      out.push({
        x: side * (TH_FLANK_RANGE_X + 62),
        z: clearOfSpan(z + 40),
        radius: 78,
        delta: 130 + j * 34,
        falloff: 'smooth',
        mode: 'add',
      });
    }
    // Corner peaks: close the ring between each flank range and the backing
    // range, so the horizon never opens over the fjord heads.
    out.push({ x: side * 428, z: 705, radius: 68, delta: 155, falloff: 'smooth', mode: 'add' });
    out.push({ x: side * 432, z: 768, radius: 72, delta: 150, falloff: 'smooth', mode: 'add' });
    out.push({ x: side * 384, z: 866, radius: 78, delta: 172, falloff: 'smooth', mode: 'add' });
  }

  // The backing range: closes the horizon from BEHIND the Warden's Seat, so
  // the city has mountains at its back instead of a hole in the sky. The
  // caldera's own massif opens for the city (citadelSuppressesMassifPeak).
  const peaks = 13;
  for (let i = 0; i < peaks; i++) {
    const t = i / (peaks - 1);
    const x = -370 + 740 * t;
    const j = drift(i);
    const z = TH_BACK_RANGE_Z + 36 * j;
    out.push({
      x,
      z,
      radius: 80 + j * 15,
      delta: 185 + j * 34,
      falloff: 'smooth',
      mode: 'add',
    });
    // A second row further back, so the range has depth rather than being one
    // row of teeth (the caldera's massif does the same).
    out.push({
      x: x + 30,
      z: z + 74,
      radius: 88,
      delta: 150 + j * 26,
      falloff: 'smooth',
      mode: 'add',
    });
  }
  return out;
}

/** The frozen berg fields: pillars of ice rising from the sea floor to just
 *  above the waterline, each crowned with spires. Shared between the terrain
 *  pass (the mound) and the placement pass (the ice). */
const TH_BERGS: readonly { x: number; z: number; r: number; spireH: number }[] = (() => {
  const sites: { x: number; z: number; r: number; spireH: number }[] = [];
  // The moat ring around the arena island, skipping the causeway's arc.
  const moatAngles = [0.05, 0.75, 2.3, 3.05, 3.85, 4.55, 5.5];
  moatAngles.forEach((a, i) => {
    sites.push({
      x: Math.cos(a) * 120,
      z: Math.sin(a) * 120,
      r: 7 + Math.abs(drift(i)) * 3,
      spireH: 8 + Math.abs(drift(i + 5)) * 4,
    });
  });
  // The fjords.
  for (const side of [-1, 1]) {
    sites.push({ x: side * 302, z: 262, r: 9, spireH: 11 });
    sites.push({ x: side * 318, z: 505, r: 8, spireH: 9 });
    sites.push({ x: side * 288, z: 655, r: 10, spireH: 12 });
  }
  // The open sea south of the bell.
  sites.push({ x: 95, z: -212, r: 11, spireH: 12 });
  sites.push({ x: -150, z: -198, r: 9, spireH: 10 });
  return sites;
})();

export function citadelTerrain(): HeightStamp[] {
  const out: HeightStamp[] = [];
  // Wards, low to high. Order matters: a later stamp wins outright, so the
  // shelves are laid in climbing order and each one's lip cuts the one below.
  //
  // Each seam also gets a FILLER STRIP at the lower ward's height, stamped
  // before the upper shelf: two inset shelf edges meet at the boundary give or
  // take their scallops, and where both scallops recede the ground fell forty
  // yards into a hidden slot canyon right across the high street. The strip
  // puts the lower terrace under that gap; the upper shelf then cuts its own
  // clean edge through the strip.
  TH_WARDS.forEach((w, i) => {
    if (i > 0) {
      const lo = TH_WARDS[i - 1];
      const half = Math.min(lo.halfU, w.halfU) + 6;
      const a = th(-half, w.v0);
      const b = th(half, w.v0);
      stripW(out, a.x, b.x, a.z, lo.y, 22);
    }
    wardShelf(out, w);
  });
  // The climbs between them, stamped after the shelves so a ramp mouth is never
  // clipped by the terrace it climbs to.
  for (const [lo, hi2] of [
    [TH_LOWER, TH_MARKET],
    [TH_MARKET, TH_HIGH],
    [TH_HIGH, TH_KEEP],
  ] as const) {
    for (const u of TH_RAMP_U) {
      const a = th(u, lo.v1 - 12);
      const b = th(u, hi2.v0 + 12);
      rampW(out, a.x, TH_RAMP_HALF_U * TH_S, a.z, b.z, lo.y, hi2.y);
    }
  }
  // The back apron. Without it the ground fell off a cliff the instant it left
  // the Warden's Seat's rear wall and sat in a pit until the backing range
  // caught it — a hole behind the castle that a player looking down from the
  // keep would see straight into. This carries the shelf north to meet the
  // mountains' skirt, and being a level stamp it also planes off the range's
  // toe so the two meet cleanly instead of interpenetrating.
  {
    // Same height as the Seat, so it simply OVERLAPS the keep shelf (no seam
    // to scallop) and runs far enough north for its level plane to cut the
    // backing range's toe where the two meet.
    const a = th(-TH_KEEP.halfU - 12, TH_KEEP.v1 - 8);
    const b = th(TH_KEEP.halfU + 12, TH_KEEP.v1 + 54);
    shelfW(out, a.x, b.x, a.z, b.z, TH_KEEP.y, 40);
  }
  // The beacon terraces: a lit landing cut into each far-shore range, then the
  // bridge decks reaching them. Both AFTER the ranges (world.ts order), so the
  // level stamps plane the mountains' toes off exactly where the spans land.
  for (const side of [-1, 1]) {
    out.push({
      x: side * TH_BEACON_TERRACE_X,
      z: TH_BRIDGE_Z,
      radius: TH_BEACON_TERRACE_R,
      delta: TH_BRIDGE_Y,
      falloff: 'flat',
      mode: 'level',
    });
    out.push({
      x: side * (TH_BEACON_TERRACE_X + 20),
      z: TH_BRIDGE_Z,
      radius: TH_BEACON_TERRACE_R - 6,
      delta: TH_BRIDGE_Y,
      falloff: 'flat',
      mode: 'level',
    });
    stripW(
      out,
      side * TH_BRIDGE_X0,
      side * TH_BRIDGE_X1,
      TH_BRIDGE_Z,
      TH_BRIDGE_Y,
      TH_BRIDGE_HALF_W + 1,
    );
  }
  causewayTerrain(out);
  // The bergs, last: pillars of ice the sea stamps would otherwise flatten.
  // Two stamps each — a smooth underwater shoulder, then a FLAT ice table, so
  // the whole cap stands proud of the waterline instead of only its very peak.
  for (const b of TH_BERGS) {
    out.push({
      x: b.x,
      z: b.z,
      radius: b.r * 1.9,
      delta: TH_WATER_Y - 14,
      falloff: 'smooth',
      mode: 'level',
    });
    out.push({
      x: b.x,
      z: b.z,
      radius: b.r,
      delta: TH_WATER_Y + TH_BERG_FREEBOARD,
      falloff: 'flat',
      mode: 'level',
    });
  }
  return out;
}

/**
 * The icy sea as DECLARED WATER BODIES.
 *
 * The stamps carve the basins, but carving alone makes no sea: waterLevelAt()
 * answers -Infinity outside a declared lake footprint or naturally-generated
 * open sea, and isOpenSeaAt() deliberately ignores the edit layer (#1518 — an
 * author's crater must not flood). So a world whose every low is stamp-carved
 * gets NO water surface, no swim volume and no rendered sheet unless it also
 * declares the water. These circles trace the carved lows: the moat ring in
 * the chasm, both fjords, their mouths, and the southern ocean. The renderer's
 * zone sheet, the swim rules and the underwater fog all read this one list.
 */
export function citadelLakes(): { x: number; z: number; radius: number }[] {
  const out: { x: number; z: number; radius: number }[] = [];
  // The moat: the ring chasm between the arena terrace and the outer bank.
  const MOAT_R = 126;
  const MOAT_COUNT = 12;
  for (let i = 0; i < MOAT_COUNT; i++) {
    const a = (i / MOAT_COUNT) * Math.PI * 2;
    out.push({ x: Math.cos(a) * MOAT_R, z: Math.sin(a) * MOAT_R, radius: 30 });
  }
  // The fjords: a chain of circles down each glacial channel.
  for (const side of [-1, 1]) {
    for (let z = 190; z <= 740; z += 55) {
      out.push({ x: side * TH_FJORD_X, z, radius: 46 });
    }
    // The mouths, where channel meets the southern ocean.
    out.push({ x: side * 318, z: 105, radius: 60 });
    out.push({ x: side * 345, z: -5, radius: 75 });
  }
  // The open sea south of the bell.
  out.push({ x: 0, z: -230, radius: 100 });
  out.push({ x: -175, z: -215, radius: 90 });
  out.push({ x: 175, z: -215, radius: 90 });
  out.push({ x: -330, z: -80, radius: 95 });
  out.push({ x: 330, z: -80, radius: 95 });
  return out;
}

/** The caldera's massif arc the city stands in: those peaks are suppressed so
 *  the wards are not stamped into the side of a mountain. Angles are the
 *  caldera's own (cos a, sin a) convention, so north is PI/2. The arc widened
 *  with the city: the peninsula is three times the town it replaced. */
export function citadelSuppressesMassifPeak(angle: number): boolean {
  let d = Math.abs(angle - Math.PI / 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d < 1.25;
}

/** Parapet segments the causeway mouth replaces (same convention as above). */
export function citadelOpensParapet(a0: number, a1: number): boolean {
  const half = Math.atan2(TH_CAUSEWAY_HALF_W + 3, TH_CAUSEWAY_Z0);
  const mid = (a0 + a1) / 2;
  let d = Math.abs(mid - Math.PI / 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d < half + (a1 - a0) / 2;
}

/** Rails along the causeway and both bridge-causeways, so the walk over the
 *  drop is a walk and not a fall. Blockers rather than placements: the
 *  balustrade art is placed separately and collision must not depend on it. */
export function citadelBlockers(): NonNullable<WorldContent['blockers']> {
  const out: NonNullable<WorldContent['blockers']> = [];
  const rail = (x0: number, z0: number, x1: number, z1: number, segs: number): void => {
    for (let i = 0; i < segs; i++) {
      out.push({
        x1: x0 + ((x1 - x0) * i) / segs,
        z1: z0 + ((z1 - z0) * i) / segs,
        x2: x0 + ((x1 - x0) * (i + 1)) / segs,
        z2: z0 + ((z1 - z0) * (i + 1)) / segs,
      });
    }
  };
  const gateZ = th(0, TH_LOWER.v0).z;
  for (const side of [-1, 1]) {
    // The Tideway.
    rail(side * TH_CAUSEWAY_HALF_W, TH_CAUSEWAY_Z0, side * TH_CAUSEWAY_HALF_W, gateZ, 7);
    // The bridge-causeways: both edges of each span.
    for (const edge of [-1, 1]) {
      rail(
        side * (TH_BRIDGE_X0 - 2),
        TH_BRIDGE_Z + edge * TH_BRIDGE_HALF_W,
        side * TH_BRIDGE_X1,
        TH_BRIDGE_Z + edge * TH_BRIDGE_HALF_W,
        8,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The city
//
// Laid out ward by ward from the gate up. Every position is in the city frame
// (u across, v along), every size is a HEIGHT in yards, and the footprints come
// out of the measured table above — so a row of houses is spaced by what the
// houses actually occupy rather than by a number that looked right once.
// ---------------------------------------------------------------------------

/** Heights, in yards, of the city's recurring pieces. One place to retune the
 *  whole silhouette. Buildings are tripled from the hamlet-scale first pass;
 *  furniture (lamps, stalls, rails, torches, clutter) deliberately is not. */
export const H = {
  // 16, not 21: the kcas wall face carries protruding decorative masonry
  // blocks, and above ~5x model scale they read as floating bricks from
  // across the chasm. 16 keeps the fortress line while the blocks stay trim.
  curtain: 16,
  innerCurtain: 14,
  gateTower: 55,
  cornerTower: 46,
  keepTower: 64,
  keep: 100,
  townhall: 50,
  // Houses HALVED from the monumental pass (Troy: "the smaller houses should
  // be .5x smaller so they dont look massive but keep the castles towers big").
  // Homes read human again; the keep, towers and curtain keep the skyline.
  house: 9.5,
  houseTall: 11.5,
  tavern: 18,
  workshop: 15,
  market: 15,
  shipyard: 19,
  stables: 13,
  barracks: 20,
  windmill: 26,
  lamp: 5.5,
  barrier: 2.4,
  ship: 38,
  spire: 10,
  crystal: 14,
  /** The arena's cradle pylon, reused as civic monument at three sizes. */
  pylonGate: 58,
  pylonBoulevard: 26,
  pylonBridge: 34,
  /** The skybeacons: colossal lights on the city's shoulders. Placeholder
   *  model until the bespoke beacon asset lands. */
  beacon: 66,
  fountain: 11,
} as const;

function lowerWard(out: PlacedAsset[]): void {
  const w = TH_LOWER;

  // --- the curtain: front wall with the Tide Gate at its middle -------------
  wallRun(out, -w.halfU, 0, w.halfU, 0, H.curtain, {
    pillarEvery: 4,
    gateAtMid: true,
    torches: true,
  });
  // Flanks, running back to the ward's shoulder.
  wallRun(out, -w.halfU, 0, -w.halfU, w.v1, H.curtain, { pillarEvery: 4, torches: true });
  wallRun(out, w.halfU, 0, w.halfU, w.v1, H.curtain, { pillarEvery: 4, torches: true });

  // --- the gate towers and the colossi ---------------------------------------
  for (const side of [-1, 1]) {
    place(out, 'deepglass/warden_tower', side * 16, 0, H.gateTower, {
      rotY: side < 0 ? 0.2 : -0.2,
      collide: foot('deepglass/warden_tower', H.gateTower).w * 0.42,
    });
    // The barbican pair, set back inside the gate court.
    place(out, 'deepglass/warden_tower', side * 26, 14, H.cornerTower, {
      collide: foot('deepglass/warden_tower', H.cornerTower).w * 0.42,
    });
    place(out, 'biome/hex_flag', side * 16, 0, H.gateTower * 0.26, {});
    // The Warden Colossi: two Warden pylons (the arena cradle pylon's authored
    // successor, same envelope), stood upright
    // either side of the gate at full monument scale. From the causeway they
    // frame the whole climb; from the arena they mark where the city begins.
    place(out, 'deepglass/warden_pylon', side * 10, -2, H.pylonGate, {
      collide: 2.6,
      custom: true,
    });
  }
  // No arch model over the opening: the fen bridge arch tried it and read as a
  // dark plank boardwalk floating over the gate. The colossi, the flanking
  // towers and the gap in the curtain carry the gate by themselves.

  // --- the gate court ------------------------------------------------------
  place(out, 'props/eastbrook_noticeboard', -9, 20, 3.4, { rotY: -Math.PI / 2, collide: 0.9 });
  for (const side of [-1, 1]) {
    place(out, 'props/crystal_amethyst_cluster', side * 20, 26, H.crystal, { collide: 2.2 });
    place(out, 'biome/hex_barracks', side * 44, 26, H.barracks, {
      rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      collide: foot('biome/hex_barracks', H.barracks).w * 0.42,
    });
    place(out, 'biome/hexb_stables', side * 52, 44, H.stables, {
      rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      collide: foot('biome/hexb_stables', H.stables).w * 0.4,
    });
    // Guard clutter at the barracks door.
    place(out, 'props/crate_wooden', side * 36, 18, 1.2, { rotY: side * 0.4, collide: 0.5 });
    place(out, 'props/barrel', side * 34, 20, 1.2, { collide: 0.4 });
  }

  // --- the Warden Colonnade: pylons pacing the boulevard up the axis --------
  for (let v = 12; v <= 48; v += 12) {
    for (const side of [-1, 1]) {
      place(out, 'deepglass/warden_pylon', side * 11, v, H.pylonBoulevard, {
        collide: 1.5,
        custom: true,
      });
    }
  }
  lampRow(out, 0, 6, 48, 15, 8.5, H.lamp);
}

/** The explorable buildings' fires, in MODEL yards of each building's
 *  bl_*.py (see the comments inside). Shared by the old peninsula plan below
 *  and the ring city (citadel_ring.ts placeW), so a layout rebuild can never
 *  lose a hearth again: the first ring cut shipped the tavern and bank cold. */
export const TH_BANK_FLAMES: readonly AssetFireEmitter[] = [
  flame('chand-a', 'torch', 0.0, 7.86, -0.93, {
    scale: 0.2,
    width: 0.6,
    height: 0.55,
    opacity: 0.42,
    glow: 2.6,
    glowRange: 16,
    smoke: 0,
  }),
  flame('chand-b', 'torch', 0.0, 7.86, 4.05, {
    scale: 0.2,
    width: 0.6,
    height: 0.55,
    opacity: 0.42,
    glow: 2.6,
    glowRange: 16,
    smoke: 0,
  }),
  flame('vault', 'torch', -8.33, 2.66, -4.86, {
    scale: 0.24,
    opacity: 0.5,
    glow: 1.3,
    glowRange: 7,
    smoke: 0,
  }),
];

/** The Anchor & Antler's fires. Kit coords from bl_tavern_b.py map to model
 *  yards as (x*S, z*S, -y*S) with S = 1.85: the west-wall hearth, a candle at
 *  each end of the long bar, the three lamps hung over the open void, and the
 *  lantern in the belfry that makes the tower read at night. */
export const TH_TAVERN_B_FLAMES: readonly AssetFireEmitter[] = [
  flame('hearth', 'bonfire', -22.24, 0.78, 0.0, { scale: 0.8, glow: 3.0, glowRange: 20, smoke: 0.15 }),
  flame('bar-w', 'torch', -3.7, 2.31, 9.44, { scale: 0.26, opacity: 0.5, glow: 1.7, glowRange: 10, smoke: 0 }),
  flame('bar-e', 'torch', 8.14, 2.31, 9.44, { scale: 0.26, opacity: 0.5, glow: 1.7, glowRange: 10, smoke: 0 }),
  flame('lamp-1', 'torch', -15.54, 5.03, 0.0, { scale: 0.24, width: 0.6, height: 0.55, opacity: 0.45, glow: 2.8, glowRange: 18, smoke: 0 }),
  flame('lamp-2', 'torch', -5.55, 5.03, -1.11, { scale: 0.24, width: 0.6, height: 0.55, opacity: 0.45, glow: 2.8, glowRange: 18, smoke: 0 }),
  flame('lamp-3', 'torch', 5.55, 5.03, -1.11, { scale: 0.24, width: 0.6, height: 0.55, opacity: 0.45, glow: 2.8, glowRange: 18, smoke: 0 }),
  flame('lamp-4', 'torch', 15.54, 5.03, 0.0, { scale: 0.24, width: 0.6, height: 0.55, opacity: 0.45, glow: 2.8, glowRange: 18, smoke: 0 }),
  flame('belfry', 'torch', 0.0, 26.99, 0.0, { scale: 0.28, width: 0.7, height: 0.6, opacity: 0.5, glow: 3.2, glowRange: 28, smoke: 0 }),
];

export const TH_TAVERN_FLAMES: readonly AssetFireEmitter[] = [
  // Model yards of the 12.5 x 10 rebuild (tmp/blender_tidehold/bl_tavern2.py):
  // the west-wall hearth, a candle on the long bar, the loft nightstand.
  flame('hearth', 'bonfire', -8.36, 0.78, -2.31, {
    scale: 0.7,
    glow: 2.6,
    glowRange: 15,
    smoke: 0.15,
  }),
  flame('bar', 'torch', 5.18, 3.37, 7.59, {
    scale: 0.26,
    opacity: 0.5,
    glow: 1.6,
    glowRange: 9,
    smoke: 0,
  }),
  flame('bar-w', 'torch', -5.37, 3.37, 7.59, {
    scale: 0.26,
    opacity: 0.5,
    glow: 1.6,
    glowRange: 9,
    smoke: 0,
  }),
  flame('loft', 'torch', -7.31, 7.92, -8.14, {
    scale: 0.18,
    width: 0.5,
    height: 0.5,
    opacity: 0.42,
    glow: 1.4,
    glowRange: 8,
    smoke: 0,
  }),
  // the three hanging wheel-lights over the hall
  flame('wheel-w', 'torch', -4.81, 4.81, -1.11, {
    scale: 0.2,
    width: 0.6,
    height: 0.55,
    opacity: 0.42,
    glow: 2.4,
    glowRange: 15,
    smoke: 0,
  }),
  flame('wheel-e', 'torch', 4.81, 4.81, -1.11, {
    scale: 0.2,
    width: 0.6,
    height: 0.55,
    opacity: 0.42,
    glow: 2.4,
    glowRange: 15,
    smoke: 0,
  }),
  flame('wheel-bar', 'torch', 0.0, 4.81, 4.81, {
    scale: 0.2,
    width: 0.6,
    height: 0.55,
    opacity: 0.42,
    glow: 2.4,
    glowRange: 15,
    smoke: 0,
  }),
];

export const TH_HALL_FLAMES: readonly AssetFireEmitter[] = [
  flame('hearth', 'bonfire', -9, 1.1, -7.8, {
    scale: 1.05,
    glow: 3.2,
    glowRange: 18,
    smoke: 0.2,
  }),
  flame('dais-a', 'torch', -4, 4.2, 13, { scale: 0.4, glow: 1.8, glowRange: 10, smoke: 0 }),
  flame('dais-b', 'torch', 4, 4.2, 13, { scale: 0.4, glow: 1.8, glowRange: 10, smoke: 0 }),
  flame('chand-a', 'torch', 0.0, 16.15, 7.2, {
    scale: 0.26,
    width: 0.7,
    height: 0.6,
    opacity: 0.42,
    glow: 3.4,
    glowRange: 26,
    smoke: 0,
  }),
  flame('chand-b', 'torch', 0.0, 16.15, 0.0, {
    scale: 0.26,
    width: 0.7,
    height: 0.6,
    opacity: 0.42,
    glow: 3.4,
    glowRange: 26,
    smoke: 0,
  }),
  flame('chand-c', 'torch', 0.0, 16.15, -7.2, {
    scale: 0.26,
    width: 0.7,
    height: 0.6,
    opacity: 0.42,
    glow: 3.4,
    glowRange: 26,
    smoke: 0,
  }),
  flame('aisle-a', 'torch', -3.5, 3.2, 3.2, {
    scale: 0.22,
    width: 0.5,
    height: 0.5,
    opacity: 0.45,
    glow: 2.2,
    glowRange: 12,
    smoke: 0,
  }),
  flame('aisle-b', 'torch', 3.5, 3.2, -2.8, {
    scale: 0.22,
    width: 0.5,
    height: 0.5,
    opacity: 0.45,
    glow: 2.2,
    glowRange: 12,
    smoke: 0,
  }),
];

/** Castle B's fires, model yards (kit x 1.35; z = -kit y): four courtyard
 *  braziers, four down the great hall's aisle, two torches at the gate. */
export const TH_CASTLE_B_FLAMES: readonly AssetFireEmitter[] = [
  flame('yard-sw', 'bonfire', -21.6, 1.15, -5.4, { scale: 0.34, glow: 3.4, glowRange: 22, smoke: 0.1 }),
  flame('yard-se', 'bonfire', 21.6, 1.15, -5.4, { scale: 0.34, glow: 3.4, glowRange: 22, smoke: 0.1 }),
  flame('yard-nw', 'bonfire', -21.6, 1.15, -25.65, { scale: 0.34, glow: 3.4, glowRange: 22, smoke: 0.1 }),
  flame('yard-ne', 'bonfire', 21.6, 1.15, -25.65, { scale: 0.34, glow: 3.4, glowRange: 22, smoke: 0.1 }),
  flame('hall-fw', 'bonfire', -4.59, 1.05, 9.11, { scale: 0.34, glow: 3.4, glowRange: 22, smoke: 0.1 }),
  flame('hall-fe', 'bonfire', 4.59, 1.05, 9.11, { scale: 0.34, glow: 3.4, glowRange: 22, smoke: 0.1 }),
  flame('hall-bw', 'bonfire', -4.59, 1.05, 13.84, { scale: 0.34, glow: 3.4, glowRange: 22, smoke: 0.1 }),
  flame('hall-be', 'bonfire', 4.59, 1.05, 13.84, { scale: 0.34, glow: 3.4, glowRange: 22, smoke: 0.1 }),
  flame('gate-w', 'torch', -3.2, 4.9, -33.0, { scale: 0.3, glow: 2.0, glowRange: 12, smoke: 0.15 }),
  flame('gate-e', 'torch', 3.2, 4.9, -33.0, { scale: 0.3, glow: 2.0, glowRange: 12, smoke: 0.15 }),
  // Troy (2026-09-10): "add some light sources to the braziers, candles and
  // chandeliers". Chandeliers (Light_01) on all three keep floors, the
  // candles on the dais and the tables, the kitchen hearth. Model yards:
  // kit (x, y, z) -> (1.35x, 1.35z, -1.35y); a chandelier's flames hang ~0.4
  // kit under its anchor. The light pool only lights the nearest eight.
  ...([-1, 1] as const).flatMap((sx) => [
    chandelier(`hall-chand-f${sx}`, sx * 4.05, 5.2, 7.43),
    chandelier(`hall-chand-b${sx}`, sx * 4.05, 5.2, 14.18),
    chandelier(`mid-chand${sx}`, sx * 5.4, 12.0, 12.83),
    chandelier(`top-chand${sx}`, sx * 5.4, 18.6, 12.83),
    candle(`dais-candle${sx}`, sx * 4.05, 1.75, 20.1),
  ]),
  chandelier('mid-chand-c', 4.05, 12.0, 15.5),
  chandelier('top-chand-c', 4.05, 18.6, 15.5),
  candle('mid-table', 4.05, 8.3, 10.8),
  candle('top-table', 5.94, 15.1, 10.26),
  candle('solar', -22.95, 8.4, 8.78),
  flame('hearth', 'bonfire', 25.65, 1.0, 15.2, { scale: 0.28, glow: 2.4, glowRange: 14, smoke: 0.12 }),
  // the hearths on the east wall of the library (z 5) and the Warden's floor (z 10)
  flame('mid-hearth', 'bonfire', 16.1, 7.5, 14.2, { scale: 0.26, glow: 2.4, glowRange: 14, smoke: 0.1 }),
  flame('top-hearth', 'bonfire', 16.1, 14.25, 16.2, { scale: 0.26, glow: 2.4, glowRange: 14, smoke: 0.1 }),
];

function chandelier(id: string, x: number, y: number, z: number): AssetFireEmitter {
  return flame(id, 'torch', x, y, z, { scale: 0.2, width: 0.6, height: 0.55, opacity: 0.42, glow: 2.6, glowRange: 16, smoke: 0 });
}

function candle(id: string, x: number, y: number, z: number): AssetFireEmitter {
  return flame(id, 'torch', x, y, z, { scale: 0.1, opacity: 0.5, glow: 1.2, glowRange: 6, smoke: 0 });
}

function marketWard(out: PlacedAsset[]): void {
  const w = TH_MARKET;
  // Flank walls SPLIT at the bridge mouths: the spans leave the city here.
  for (const side of [-1, 1]) {
    wallRun(out, side * w.halfU, w.v0, side * w.halfU, 74, H.curtain, {
      pillarEvery: 5,
      torches: true,
    });
    wallRun(out, side * w.halfU, 84, side * w.halfU, w.v1, H.curtain, {
      pillarEvery: 5,
      torches: true,
    });
  }

  // --- the Fountain Plaza ---------------------------------------------------
  // The heart of the city: the Realm Builder of the Month monument at the
  // meeting of every road (it replaced the Wardens' Fountain on request), with
  // Baldemar the Bald standing beside it (world.ts moves his deepglass self
  // here) so a traveller can portal out from the middle of everything. The
  // statue is the shipped Eastbrook sculpt at Tidehold's grander scale; its
  // projected honouree name and lantern embers are the renderer's
  // RealmBuilderMonumentFx seated at TH_MONUMENT, and its honour-roll card is
  // the inspect entity realm_builder_monument_spawn.ts spawns at the same spot.
  place(
    out,
    'props/eastbrook_realm_builder_monument',
    TH_MONUMENT.u,
    TH_MONUMENT.v,
    TH_MONUMENT.height,
    {
      rotY: TH_MONUMENT.rotY,
      collide: TH_MONUMENT.collide,
      custom: true,
    },
  );
  // The stall ring: twelve stalls facing the water, HUMAN scale on purpose —
  // the market crowd is what makes the monumental shell read as lived-in.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const su = Math.sin(a) * 8;
    const sv = 79 + Math.cos(a) * 8;
    place(out, 'props/eastbrook_market_stall', su, sv, 3.2, {
      // Face the fountain: the stall's front is its local -z.
      rotY: Math.atan2(-Math.sin(a), -Math.cos(a)),
      collide: 1.3,
    });
    if (i % 3 === 0) {
      place(out, 'props/barrel', Math.sin(a) * 10.5, 79 + Math.cos(a) * 10.5, 1.2, {
        collide: 0.4,
      });
    }
  }
  // Lamp and brazier rings around the stalls.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    place(
      out,
      'props/streetlamp_veiled_crystal',
      Math.sin(a) * 12.5,
      79 + Math.cos(a) * 12.5,
      H.lamp,
      {
        rotY: Math.atan2(-Math.sin(a), -Math.cos(a)),
        collide: 0.6,
        custom: true,
      },
    );
  }
  for (const [du, dv] of [
    [-5.5, 73.5],
    [5.5, 73.5],
    [-5.5, 84.5],
    [5.5, 84.5],
  ] as const) {
    place(out, 'biome/kcas_torch', du, dv, 2.6, {});
  }

  // --- the shopfronts: the big trades facing the plaza -----------------------
  const shops: readonly [string, number, number, number, number][] = [
    ['props/eastbrook_inn', -34, 60, 17, Math.PI / 2],
    ['props/eastbrook_weaving_workshop', -34, 96, 12, Math.PI / 2],
    ['biome/hexb_workshop', -52, 90, H.workshop, 0],
    ['biome/hexb_windmill', 56, 96, H.windmill, 0],
  ];
  for (const [id, u, v, h, rotY] of shops) {
    place(out, id, u, v, h, { rotY, collide: foot(id, h).w * 0.42 });
  }
  // The explorable trades (walk in through the door; interiors are dressed and
  // the roof hides from inside). collide is only the opt-in GATE - the real
  // shape is the authored per-asset box set, which leaves the doorways open.
  place(out, 'tidehold/bank', -52, 68, AUTHORED.bank, {
    rotY: -Math.PI / 2,
    collide: 2.5,
    fireEffects: TH_BANK_FLAMES,
  });
  place(out, 'tidehold/tavern', 52, 68, AUTHORED.tavern, {
    rotY: Math.PI / 2,
    collide: 2.5,
    fireEffects: TH_TAVERN_FLAMES,
  });
  // No fire on the smithy: the forge coals, ember sheet and porch lamp used to
  // be flame emitters here, and every one of them floated off the model.
  place(out, 'tidehold/smithy', 46, 96, AUTHORED.smithy, { rotY: Math.PI / 2, collide: 2.5 });
  place(out, 'tidehold/market', 0, 98, AUTHORED.market, { rotY: 0, collide: 2.5 });
  // Filler houses flanking the boulevard: closed, plank-walled, each turned to
  // face the street (rotY pi/2 faces -X, -pi/2 faces +X). Kept off the u=+-34
  // climb lanes and the plaza walks (MARKET_WALKS).
  place(out, 'tidehold/house_a', -26, 58, AUTHORED.house_a, { rotY: -Math.PI / 2, collide: 2.5 });
  place(out, 'tidehold/house_b', 26, 58, AUTHORED.house_b, { rotY: Math.PI / 2, collide: 2.5 });
  place(out, 'tidehold/house_e', -40, 88, AUTHORED.house_e, { rotY: -Math.PI / 2, collide: 2.5 });
  place(out, 'props/banker_chest', -44, 68, 1.9, { rotY: Math.PI / 2, collide: 1.1 });

  // --- the Moorings: sky-ships tied off at the fjord lips --------------------
  for (const side of [-1, 1]) {
    const u = side * 74;
    for (const vDock of [58, 92] as const) {
      place(out, 'biome/hexb_docks', u, vDock, 12, {
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        collide: foot('biome/hexb_docks', 12).w * 0.35,
      });
    }
    place(out, 'biome/hexb_shipyard', side * 62, 100, H.shipyard, {
      rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      collide: foot('biome/hexb_shipyard', H.shipyard).w * 0.4,
    });
    // The great ships hang at the lip with the ice glittering under their keels.
    place(out, 'biome/hex_ship_blue', side * 79, 64, H.ship, {
      rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      collide: 5,
    });
    place(out, 'biome/hex_ship_blue', side * 79, 98, H.ship * 0.85, {
      rotY: side < 0 ? Math.PI / 2 + 0.3 : -Math.PI / 2 - 0.3,
      collide: 4.4,
    });
    place(out, 'biome/hex_anchor', side * 69, 62, 6, { rotY: side * 0.6 });
    for (let i = 0; i < 3; i++) {
      place(out, 'props/dock_platform', side * 70, 56 + i * 4, 1.4, {});
      place(out, 'props/crate_wooden', side * 66, 58 + i * 5, 1.3, { rotY: i * 0.7, collide: 0.5 });
    }
    // Mooring lip rails, broken at the bridge mouth.
    barrierRun(out, side * (w.halfU - 1), w.v0 + 2, side * (w.halfU - 1), 72);
    barrierRun(out, side * (w.halfU - 1), 86, side * (w.halfU - 1), w.v1 - 2);
    // The mooring skybeacons: the harbour lights the whole realm sees.
    place(out, 'props/tidehold_skybeacon', side * 64, 54, H.beacon, { collide: 6 });
  }

  // Lamps down the bridge street, the plaza's own east-west axis.
  for (const uLamp of [-64, -46, -28, 28, 46, 64]) {
    for (const dv of [-6.5, 6.5]) {
      place(out, 'props/streetlamp_veiled_crystal', uLamp, 79 + dv, H.lamp, {
        rotY: dv < 0 ? 0 : Math.PI,
        collide: 0.6,
        custom: true,
      });
    }
  }
  lampRow(out, 0, 56, 102, 18, 9, H.lamp);
}

function highWard(out: PlacedAsset[]): void {
  const w = TH_HIGH;
  wallRun(out, -w.halfU, w.v0, -w.halfU, w.v1, H.curtain, { pillarEvery: 5, torches: true });
  wallRun(out, w.halfU, w.v0, w.halfU, w.v1, H.curtain, { pillarEvery: 5, torches: true });

  // --- the civic front -----------------------------------------------------
  // The Warden's Hall: the explorable castle great hall (throne room) that
  // replaced the sealed townhall shell.
  place(out, 'tidehold/hall', 0, 142, AUTHORED.hall, {
    rotY: 0,
    collide: 2.5,
    fireEffects: TH_HALL_FLAMES,
  });
  place(out, 'props/eastbrook_chapel', -40, 124, 15, {
    rotY: Math.PI / 2,
    collide: foot('props/eastbrook_chapel', 15).w * 0.42,
  });
  place(out, 'props/bell_tower', -54, 124, 30, { collide: 2.6 });
  place(out, 'props/eastbrook_grand_armoury', 44, 126, 49, {
    rotY: -Math.PI / 2,
    collide: foot('props/eastbrook_grand_armoury', 49).w * 0.4,
  });

  // --- the garden the Row is named for -------------------------------------
  place(out, 'props/garden_arch', 0, 112, 6, { rotY: 0 });
  // Wardens' Row houses, flanking the hall's approach.
  place(out, 'tidehold/house_c', -22, 130, AUTHORED.house_c, { rotY: -Math.PI / 2, collide: 2.5 });
  place(out, 'tidehold/house_d', 22, 130, AUTHORED.house_d, { rotY: Math.PI / 2, collide: 2.5 });
  place(out, 'props/eastbrook_civic_well_beacon', 0, 120, 6.6, { collide: 2.2 });
  for (let i = -2; i <= 2; i++) {
    place(out, 'props/flower_bed_round', i * 5, 117, 1.1, {});
    if (i !== 0) {
      place(out, 'props/garden_iron_fence', i * 5, 108, 2.2, { rotY: Math.PI / 2 });
    }
  }
  for (const side of [-1, 1]) {
    place(out, 'props/frostveil_ice_spire', side * 12, 116, H.spire, { rotY: side * 0.5 });
  }

  // --- residences ----------------------------------------------------------
  const homeIds = ['biome/hexb_home_a', 'biome/hexb_home_b'] as const;
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const id = homeIds[(i + (side < 0 ? 0 : 1)) % 2];
      const h = i % 2 === 0 ? H.house : H.houseTall;
      place(out, id, side * (26 + (i % 3) * 12), 112 + Math.floor(i / 3) * 30 + (i % 3) * 6, h, {
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        collide: foot(id, h).w * 0.42,
      });
    }
  }
  lampRow(out, 0, 110, 150, 18, 10, H.lamp);
}

function keepWard(out: PlacedAsset[]): void {
  const w = TH_KEEP;
  // The inner curtain: a closed rectangle with its own gate facing the city.
  wallRun(out, -w.halfU, w.v0, w.halfU, w.v0, H.innerCurtain, {
    pillarEvery: 3,
    gateAtMid: true,
    torches: true,
  });
  wallRun(out, -w.halfU, w.v0, -w.halfU, w.v1, H.innerCurtain, { pillarEvery: 3, torches: true });
  wallRun(out, w.halfU, w.v0, w.halfU, w.v1, H.innerCurtain, { pillarEvery: 3, torches: true });
  wallRun(out, -w.halfU, w.v1, w.halfU, w.v1, H.innerCurtain, { pillarEvery: 3 });

  // --- the keep ------------------------------------------------------------
  // The Warden's Keep: model origin at the keep's centre, courtyard and gate
  // to the south (model -Z = -v at rotY 0). Collision is the authored set in
  // asset_collision_overrides (walls, both stone flights as decks, the gallery
  // and terrace as standable boxes); the roof terrace hides from inside
  // (render/interior_reveal.ts).
  place(out, 'tidehold/castle', 0, 182, AUTHORED.castle, {
    rotY: 0,
    collide: 3,
    // Model yards: kit * S where S = 1.35, and model z = -kit y (the keep's
    // front faces +y in Blender, which exports to -z). Recomputed with the
    // rebuild — the first cut was authored against S = 2.0.
    fireEffects: [
      // Four standing braziers down the hall aisle, between the pillars and
      // the runner. The hall has a real ceiling (the terrace floor), so these
      // are the only light in here: bright and long-ranged on purpose.
      // Moved with the brazier itself in the hand-edit pass (kit -4.559, 0.17).
      flame('brazier-sw', 'bonfire', -6.16, 0.92, -0.23, {
        scale: 0.34,
        glow: 3.4,
        glowRange: 22,
        smoke: 0.1,
      }),
      flame('brazier-se', 'bonfire', 3.51, 0.92, 2.16, {
        scale: 0.34,
        glow: 3.4,
        glowRange: 22,
        smoke: 0.1,
      }),
      flame('brazier-nw', 'bonfire', -3.51, 0.92, -4.59, {
        scale: 0.34,
        glow: 3.4,
        glowRange: 22,
        smoke: 0.1,
      }),
      flame('brazier-ne', 'bonfire', 3.51, 0.92, -4.59, {
        scale: 0.34,
        glow: 3.4,
        glowRange: 22,
        smoke: 0.1,
      }),
      // The dais candelabra, flanking the throne.
      flame('dais-a', 'torch', -3.38, 2.84, 6.89, {
        scale: 0.2,
        width: 0.5,
        height: 0.5,
        opacity: 0.5,
        glow: 2.4,
        glowRange: 14,
        smoke: 0,
      }),
      flame('dais-b', 'torch', 3.38, 2.84, 6.89, {
        scale: 0.2,
        width: 0.5,
        height: 0.5,
        opacity: 0.5,
        glow: 2.4,
        glowRange: 14,
        smoke: 0,
      }),
      // The two gallery braziers were removed in the hand-edit pass, so their
      // flames went with them — a flame with no brazier under it floats.
      // Terrace braziers.
      flame('roof-w', 'torch', -5.06, 14.55, -3.38, {
        scale: 0.3,
        glow: 2.0,
        glowRange: 12,
        smoke: 0.15,
      }),
      flame('roof-e', 'torch', 5.06, 14.55, -3.38, {
        scale: 0.3,
        glow: 2.0,
        glowRange: 12,
        smoke: 0.15,
      }),
      // Courtyard lanterns.
      flame('yard-sw', 'torch', -8.78, 2.7, -12.76, {
        scale: 0.18,
        width: 0.5,
        height: 0.5,
        opacity: 0.45,
        glow: 1.8,
        glowRange: 12,
        smoke: 0,
      }),
      flame('yard-se', 'torch', 8.78, 2.7, -12.76, {
        scale: 0.18,
        width: 0.5,
        height: 0.5,
        opacity: 0.45,
        glow: 1.8,
        glowRange: 12,
        smoke: 0,
      }),
      flame('yard-nw', 'torch', -8.78, 2.7, -24.37, {
        scale: 0.18,
        width: 0.5,
        height: 0.5,
        opacity: 0.45,
        glow: 1.8,
        glowRange: 12,
        smoke: 0,
      }),
      flame('yard-ne', 'torch', 8.78, 2.7, -24.37, {
        scale: 0.18,
        width: 0.5,
        height: 0.5,
        opacity: 0.45,
        glow: 1.8,
        glowRange: 12,
        smoke: 0,
      }),
    ],
  });
  for (const su of [-1, 1]) {
    for (const sv of [0, 1]) {
      place(out, 'deepglass/warden_tower', su * (w.halfU - 5), w.v0 + 6 + sv * 32, H.keepTower, {
        collide: foot('deepglass/warden_tower', H.keepTower).w * 0.42,
      });
      place(out, 'biome/hex_flag', su * (w.halfU - 5), w.v0 + 6 + sv * 32, H.keepTower * 0.22, {});
    }
  }
  // The Warden's court in front of the doors.
  place(out, 'props/crystal_amethyst_cluster', 0, 160, H.crystal * 1.15, { collide: 2.4 });
  for (const side of [-1, 1]) {
    place(out, 'props/frostveil_ice_spire', side * 10, 162, H.spire, { rotY: side * 0.7 });
    place(out, 'biome/kcas_torch', side * 5, 158, 2.6, {});
    // The court skybeacons flank the inner gate.
    place(out, 'props/tidehold_skybeacon', side * 40, 154, H.beacon, { collide: 6 });
  }
  lampRow(out, 0, 156, 192, 15, 9, H.lamp);
}

/** The causeway's dressing: balustrades, lamps and the watch pillars. WORLD. */
function causewayDressing(out: PlacedAsset[]): void {
  const gateZ = th(0, TH_LOWER.v0).z;
  for (const side of [-1, 1]) {
    barrierRunW(
      out,
      side * (TH_CAUSEWAY_HALF_W - 0.8),
      TH_CAUSEWAY_Z0 + 2,
      side * (TH_CAUSEWAY_HALF_W - 0.8),
      gateZ - 4,
    );
  }
  for (let z = TH_CAUSEWAY_Z0 + 5; z < gateZ - 3; z += 11) {
    for (const side of [-1, 1]) {
      placeW(out, 'props/streetlamp_veiled_crystal', side * (TH_CAUSEWAY_HALF_W - 2.6), z, H.lamp, {
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        collide: 0.6,
        custom: true,
      });
    }
  }
  for (const side of [-1, 1]) {
    placeW(out, 'biome/kcas_pillar', side * (TH_CAUSEWAY_HALF_W - 1.5), TH_CAUSEWAY_Z0 + 3, 8, {
      collide: 1.2,
      square: true,
      custom: true,
    });
  }
}

/** The bridge-causeways' dressing and their beacon terraces. WORLD units. */
function bridgeDressing(out: PlacedAsset[]): void {
  for (const side of [-1, 1]) {
    // Rails down both edges of the span.
    for (const edge of [-1, 1]) {
      barrierRunW(
        out,
        side * (TH_BRIDGE_X0 + 4),
        TH_BRIDGE_Z + edge * (TH_BRIDGE_HALF_W - 1.2),
        side * (TH_BRIDGE_X1 - 4),
        TH_BRIDGE_Z + edge * (TH_BRIDGE_HALF_W - 1.2),
      );
    }
    // Lamps pacing the span.
    for (let i = 0; i < 8; i++) {
      const x = side * (TH_BRIDGE_X0 + 8 + ((TH_BRIDGE_X1 - TH_BRIDGE_X0 - 16) * i) / 7);
      for (const edge of [-1, 1]) {
        placeW(
          out,
          'props/streetlamp_veiled_crystal',
          x,
          TH_BRIDGE_Z + edge * (TH_BRIDGE_HALF_W - 2.8),
          H.lamp,
          {
            rotY: edge < 0 ? 0 : Math.PI,
            collide: 0.6,
            custom: true,
          },
        );
      }
    }
    // Pylon pairs at both ends of the span.
    for (const xEnd of [TH_BRIDGE_X0 + 5, TH_BRIDGE_X1 - 5]) {
      for (const edge of [-1, 1]) {
        placeW(
          out,
          'deepglass/warden_pylon',
          side * xEnd,
          TH_BRIDGE_Z + edge * (TH_BRIDGE_HALF_W + 2),
          H.pylonBridge,
          {
            collide: 1.8,
            custom: true,
          },
        );
      }
    }
    // The beacon terrace: the far light each bridge walks to.
    const bx = side * TH_BEACON_TERRACE_X;
    placeW(out, 'props/tidehold_skybeacon', bx + side * 10, TH_BRIDGE_Z, H.beacon, {
      collide: 6,
    });
    placeW(out, 'props/crystal_amethyst_cluster', bx, TH_BRIDGE_Z + 14, H.crystal, {
      collide: 2.2,
    });
    placeW(
      out,
      'props/crystal_amethyst_cluster',
      bx - side * 4,
      TH_BRIDGE_Z - 13,
      H.crystal * 0.75,
      {
        collide: 1.8,
      },
    );
    for (const dz of [-8, 8]) {
      placeW(out, 'props/frostveil_ice_spire', bx + side * 2, TH_BRIDGE_Z + dz, H.spire, {
        rotY: dz * 0.1,
      });
    }
    placeW(out, 'props/streetlamp_veiled_crystal', bx - side * 12, TH_BRIDGE_Z + 8, H.lamp, {
      collide: 0.6,
      custom: true,
    });
    placeW(out, 'props/streetlamp_veiled_crystal', bx - side * 12, TH_BRIDGE_Z - 8, H.lamp, {
      collide: 0.6,
      custom: true,
    });
  }
}

/** The berg fields' ice: spires and clusters riding each frozen pillar. */
function bergDressing(out: PlacedAsset[]): void {
  TH_BERGS.forEach((b, i) => {
    const j = drift(i + 17);
    placeW(out, 'props/frostveil_ice_spire', b.x, b.z, b.spireH, { rotY: j * Math.PI });
    placeW(out, 'props/frostveil_ice_spire', b.x + 3.5, b.z + 2.5, b.spireH * 0.6, {
      rotY: j * 2.7,
    });
    if (b.r >= 9) {
      placeW(out, 'props/crystal_amethyst_cluster', b.x - 3, b.z - 2, b.spireH * 0.5, {});
    }
  });
}

/** Balustrades along each terrace lip, with the ramp mouths left open. */
function terraceRails(out: PlacedAsset[]): void {
  for (const [lo, up] of [
    [TH_LOWER, TH_MARKET],
    [TH_MARKET, TH_HIGH],
    [TH_HIGH, TH_KEEP],
  ] as const) {
    const halfU = Math.min(lo.halfU, up.halfU);
    // Two runs per lip, skipping the ramp corridors.
    const gaps = TH_RAMP_U.map(
      (u) => [u - TH_RAMP_HALF_U - 3, u + TH_RAMP_HALF_U + 3] as const,
    ).sort((a, b) => a[0] - b[0]);
    let cursor = -halfU;
    for (const [g0, g1] of gaps) {
      if (g0 > cursor) barrierRun(out, cursor, up.v0, Math.min(g0, halfU), up.v0, H.barrier);
      cursor = Math.max(cursor, g1);
    }
    if (cursor < halfU) barrierRun(out, cursor, up.v0, halfU, up.v0, H.barrier);
  }
}

/**
 * The density pass.
 *
 * The first layout put the landmarks in the right places and left the ground
 * between them bare, which reads as a film set rather than a city: buildings
 * around the edge and a field in the middle. These are the blocks, the clutter
 * and the second rank of walls that make it somewhere people live.
 */
function densify(out: PlacedAsset[]): void {
  // --- residential blocks along the Tide Gate's flanks ----------------------
  // Six per side now the houses are half height: the halved footprints left
  // four reading as huts scattered on a field.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const id = i % 2 === 0 ? 'biome/hexb_home_a' : 'biome/hexb_home_b';
      const h = i % 2 === 0 ? H.house : H.houseTall;
      place(out, id, side * 60, 8 + i * 7, h, {
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        collide: foot(id, h).w * 0.42,
      });
    }
    // The drill yard behind the barracks.
    place(out, 'biome/hex_target', side * 48, 12, 2.6, { rotY: side < 0 ? 1.2 : -1.2 });
    place(out, 'biome/hex_weaponrack', side * 44, 14, 2.2, { rotY: side * 0.5, collide: 0.6 });
    place(out, 'biome/hex_haybale', side * 50, 36, 1.6, { rotY: side * 0.9, collide: 0.7 });
    place(out, 'biome/hex_trough', side * 58, 36, 1.2, { rotY: side < 0 ? 1.57 : -1.57 });
  }

  // --- the market's second rank: shops behind the plaza ---------------------
  const outerShops: readonly [string, number, number, number][] = [
    ['biome/hexb_home_b', -66, 58, H.houseTall],
    ['biome/hexb_home_a', -66, 96, H.house],
    ['biome/hexb_home_a', 66, 58, H.house],
    ['biome/hexb_home_b', 66, 96, H.houseTall],
    ['biome/hexb_home_a', -18, 58, H.house],
    ['biome/hexb_home_b', 18, 58, H.houseTall],
    ['biome/hexb_home_b', -18, 100, H.houseTall],
    ['biome/hexb_home_a', 18, 100, H.house],
    // Infill for the halved footprints: the plaza block reads continuous.
    ['biome/hexb_home_b', -42, 56, H.houseTall],
    ['biome/hexb_home_a', 42, 56, H.house],
    ['biome/hexb_home_a', -60, 76, H.house],
    ['biome/hexb_home_b', 60, 76, H.houseTall],
  ];
  for (const [id, u, v, h] of outerShops) {
    place(out, id, u, v, h, {
      rotY: u < 0 ? Math.PI / 2 : -Math.PI / 2,
      collide: foot(id, h).w * 0.42,
    });
  }
  // Plaza clutter: the market is a working floor, not a lawn.
  const clutter: readonly [string, number, number, number][] = [
    ['biome/hex_crate_big', -16, 68, 1.6],
    ['biome/hex_crate_open', 16, 68, 1.5],
    ['biome/hex_sack', -15, 88, 1.1],
    ['biome/hex_sack', 15, 88, 1.1],
    ['biome/hex_barrel', -18, 92, 1.2],
    ['biome/hex_barrel', 18, 92, 1.2],
    ['biome/hex_wheelbarrow', -22, 79, 1.4],
    ['biome/hex_lumber', 22, 79, 1.4],
    ['biome/hex_haybale', -20, 64, 1.6],
    ['biome/hex_haybale', 20, 64, 1.6],
  ];
  clutter.forEach(([id, u, v, h], i) => {
    place(out, id, u, v, h, { rotY: i * 0.9, collide: 0.6 });
  });

  // --- the Row: a proper street of houses ----------------------------------
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const id = i % 2 === 0 ? 'biome/hexb_home_b' : 'biome/hexb_home_a';
      const h = i % 2 === 0 ? H.houseTall : H.house;
      place(out, id, side * 62, 110 + i * 6.5, h, {
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
        collide: foot(id, h).w * 0.42,
      });
    }
    place(out, 'biome/hexb_workshop', side * 50, 146, H.workshop, {
      rotY: Math.PI,
      collide: foot('biome/hexb_workshop', H.workshop).w * 0.42,
    });
    place(out, 'props/crystal_amethyst_cluster', side * 28, 148, H.crystal * 0.7, { collide: 1.4 });
  }

  // --- the Seat: a garrison inside the inner curtain ------------------------
  for (const side of [-1, 1]) {
    place(out, 'biome/hex_barracks', side * 36, 170, H.barracks, {
      rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      collide: foot('biome/hex_barracks', H.barracks).w * 0.42,
    });
    place(out, 'deepglass/warden_tower', side * 40, 190, H.cornerTower * 0.8, {
      collide: foot('deepglass/warden_tower', H.cornerTower * 0.8).w * 0.42,
    });
    place(out, 'biome/hex_weaponrack', side * 28, 166, 2.2, { rotY: side * 0.6, collide: 0.6 });
    place(out, 'biome/hex_flag', side * 20, 158, 3.4, {});
  }
}

/**
 * The flourish pass: banners, ramp-mouth lamps and street braziers. Pure
 * theatre — the pieces that make the monumental shell read as a city that is
 * proud of itself, and light the walk so no ward ever goes dark between pools.
 */
function flourish(out: PlacedAsset[]): void {
  // Banners on the boulevard colonnade, one per pylon pair.
  for (let v = 12; v <= 48; v += 12) {
    for (const side of [-1, 1]) {
      place(out, 'biome/hex_flag', side * 12.5, v + 1, 4.2, {
        rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      });
    }
  }
  // A banner ring on the plaza diagonals, outside the lamp ring.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    place(out, 'biome/hex_flag', Math.sin(a) * 15, 79 + Math.cos(a) * 15, 4.6, {
      rotY: Math.atan2(-Math.sin(a), -Math.cos(a)),
    });
  }
  // Lamps at every ramp mouth, top and bottom: the climbs are how the city is
  // read at night, so they get their own waymarks.
  for (const [lo, hi2] of [
    [TH_LOWER, TH_MARKET],
    [TH_MARKET, TH_HIGH],
    [TH_HIGH, TH_KEEP],
  ] as const) {
    for (const u of TH_RAMP_U) {
      for (const side of [-1, 1]) {
        place(
          out,
          'props/streetlamp_veiled_crystal',
          u + side * (TH_RAMP_HALF_U - 1),
          lo.v1 - 13,
          H.lamp,
          {
            collide: 0.6,
            custom: true,
          },
        );
        place(
          out,
          'props/streetlamp_veiled_crystal',
          u + side * (TH_RAMP_HALF_U - 1),
          hi2.v0 + 13,
          H.lamp,
          {
            collide: 0.6,
            custom: true,
          },
        );
      }
    }
  }
  // Warm braziers down the market ward's side streets, between the hearths.
  for (const side of [-1, 1]) {
    for (let v = 58; v <= 100; v += 14) {
      place(out, 'biome/kcas_torch', side * 32, v, 2.6, {});
    }
  }
  // Townhall front banners.
  for (const side of [-1, 1]) {
    place(out, 'biome/hex_flag', side * 9, 137, 5, { rotY: Math.PI });
  }
}

// ---------------------------------------------------------------------------
// Stairs over the ramps
// ---------------------------------------------------------------------------
// Two parts to every climb:
//
//   1. The TERRAIN under it is rampW's stepped plateaus (a level disc per
//      tread): a heightfield, so between two plateaus the ground interpolates
//      up toward the next one. The stone is one SOLID stepped block per
//      flight — an inline built model (MODEL_PATH) whose box for tread i runs
//      from half a yard under the foot plaza up to that tread's top, the full
//      lane width — so the ground is buried inside the masonry from foot to
//      head and can never show through a tread, and the flight's sides are
//      flat walls sitting flush on whatever ground lies beside them (the old
//      courses of loose slabs overhung the wedge under them by a riser each,
//      a sawtooth down both edges, with the ground visible between). Tread
//      tops sit a riser plus STAIR_LIFT above their plateau, above anything
//      the interpolation can reach. One block per flight is also the cheap
//      form: eight triangles a step against the ~250 a course of cobble slabs
//      cost (12 slabs of 20 triangles), and its paving texture is planar at
//      the plaza's own tile, so it reads as the same stone as the ground it
//      meets instead of a cobble smeared across the lane.
//   2. The WALK is a sloped 'collider/plane' volume (citadelColliderVolumes)
//      through the tread-top midpoints, so the body rides the stone within
//      half a riser instead of the plateaus a riser below it. Planes only ever
//      carry a body (world.ts groundHeight), so nothing here blocks; the block
//      itself bakes no collision, so it is walk-through by construction.

/** How far a tread's top sits above its plateau plus one riser, yards: the
 *  margin that keeps the heightfield's rise toward the next plateau inside
 *  the stone. */
const STAIR_LIFT = 0.08;
/** How far below the foot plaza the block's flat bottom lies: enough to stay
 *  buried across a graded plaza, shallow enough to show as a footing where the
 *  ground beside a flight falls away. */
const STAIR_BASE_DEPTH = 0.5;
/** map_doc's MODEL_PATH, the inline built-model placement path. Spelled out
 *  rather than imported: map_doc pulls in world.ts, and this module is reached
 *  from data.ts's zone tables before those exist (an import here made every
 *  deepglass suite fail to load with "zones is not iterable"). Pinned equal to
 *  the export in tests/deepglass_shipped_map.test.ts. */
const MODEL_PATH = 'procedural://model';
/** The stone: the plaza's own paving (TH_SWATCHES 'Plaza Paving'), at the
 *  plaza's tile, so a flight and the ground it lands on are one material. */
// Troy 2026-09-07: the flights wear the Warden Cobbles (Cobblestone001 at the
// street paint's 6 yd), world-planar, so tread and the cobbled ground beside
// them are one pattern. (Sampling the code paint under each foot was tried
// and dropped: Troy's Studio doc repaints the city, so the code's paint map is
// not what he sees.)
const STAIR_TEX = 'Cobblestone001';
const STAIR_TEX_TILE = 6;

/** Vertices a step adds to its flight's mesh: four tread-top corners, four
 *  base corners and the two points where its riser emerges from the step
 *  below. Faces index into these (the sanitizer caps the FLAT vertex array at
 *  MAX_MODEL_MESH_VERTS, and the 60-step causeway must stay well inside it). */
const STAIR_VERTS_PER_STEP = 10;

/** The walking line of a flight climbing from (z0, y0) to (z1, y1): the height
 *  of the tread-top MIDPOINTS as a function of z, offset from y0. */
function stairLineOffset(riser: number): number {
  return riser / 2 + STAIR_LIFT;
}

/**
 * The solid stepped block of one flight, as an inline built model. Local
 * origin at (xCentre, y0 - STAIR_BASE_DEPTH, zMid); +z is world +z whichever
 * way the flight climbs. Only faces that can ever show are emitted: each
 * step's top, its riser (facing downhill, clipped to the part standing proud
 * of the step below), the two side walls from the base, and the head end;
 * bottoms and the faces buried inside neighbouring steps are left out. Every
 * face winds outward (the material is double-sided, so this only sets the
 * flat normals' lighting).
 */
export function stairBlock(
  xCentre: number,
  halfW: number,
  z0: number,
  z1: number,
  y0: number,
  n: number,
  riser: number,
  tread: number,
): PlacedAsset {
  const zMid = (z0 + z1) / 2;
  const dir = z1 >= z0 ? 1 : -1;
  const verts: number[] = [];
  const tris: number[] = [];
  const vert = (x: number, y: number, z: number): number => {
    verts.push(x, y, z);
    return verts.length / 3 - 1;
  };
  // A quad a-b-c-d, wound so its normal has a positive component along the
  // wanted outward direction.
  const quad = (
    a: number,
    b: number,
    c: number,
    d: number,
    nx: number,
    ny: number,
    nz: number,
  ): void => {
    const ux = verts[b * 3] - verts[a * 3];
    const uy = verts[b * 3 + 1] - verts[a * 3 + 1];
    const uz = verts[b * 3 + 2] - verts[a * 3 + 2];
    const vx = verts[c * 3] - verts[a * 3];
    const vy = verts[c * 3 + 1] - verts[a * 3 + 1];
    const vz = verts[c * 3 + 2] - verts[a * 3 + 2];
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) tris.push(a, b, c, a, c, d);
    else tris.push(a, c, b, a, d, c);
  };
  for (let i = 0; i < n; i++) {
    // Tread i caps the terrain plateau spanning [z0 + i*tread, z0 + (i+1)*tread)
    // whose height is y0 + i*riser; its top is a riser plus the lift above it.
    const zNear = z0 + dir * i * tread - zMid; // downhill edge, local
    const zFar = z0 + dir * (i + 1) * tread - zMid; // uphill edge, local
    const top = STAIR_BASE_DEPTH + STAIR_LIFT + (i + 1) * riser;
    // The riser only shows above the step below it (from the base on the
    // first step, whose lower part is buried in the foot plaza).
    const emerge = i === 0 ? 0 : STAIR_BASE_DEPTH + STAIR_LIFT + i * riser;
    // Ten vertices a step (STAIR_VERTS_PER_STEP), in this order.
    const topNearL = vert(-halfW, top, zNear);
    const topNearR = vert(halfW, top, zNear);
    const topFarR = vert(halfW, top, zFar);
    const topFarL = vert(-halfW, top, zFar);
    const baseNearL = vert(-halfW, 0, zNear);
    const baseNearR = vert(halfW, 0, zNear);
    const baseFarR = vert(halfW, 0, zFar);
    const baseFarL = vert(-halfW, 0, zFar);
    const riserL = vert(-halfW, emerge, zNear);
    const riserR = vert(halfW, emerge, zNear);
    // Tread top.
    quad(topNearL, topNearR, topFarR, topFarL, 0, 1, 0);
    // Riser, facing downhill into the walker coming up the flight.
    quad(riserL, riserR, topNearR, topNearL, 0, 0, -dir);
    // Side walls, base to tread top: a flat face flush with the ground beside.
    quad(baseNearL, baseFarL, topFarL, topNearL, -1, 0, 0);
    quad(baseNearR, baseFarR, topFarR, topNearR, 1, 0, 0);
    if (i === n - 1) {
      // Head end, base to top, facing uphill: buried in the head plaza but for
      // the lift, so the block never shows hollow from above it.
      quad(baseFarL, baseFarR, topFarR, topFarL, 0, 0, dir);
    }
  }
  return {
    path: MODEL_PATH,
    x: xCentre,
    z: zMid,
    rotY: 0,
    scale: 1,
    detached: true,
    groundY: y0 - STAIR_BASE_DEPTH,
    meshes: [{ verts, tris }],
    modelTexId: STAIR_TEX,
    modelTexTile: STAIR_TEX_TILE,
  };
}

/** The sloped walking floor over one flight: a tilted collider plane through
 *  the tread-top midpoints. world.ts's tilt convention: the floor DROPS toward
 *  local +z for a positive rotX, so a climb toward +z tilts negative. sizeZ is
 *  the SLANT length (the footprint test runs along the plane's own axis). */
export function stairFloor(
  xCentre: number,
  halfW: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  riser: number,
): ColliderVolume {
  const run = Math.abs(z1 - z0);
  const rise = y1 - y0;
  const dir = z1 >= z0 ? 1 : -1;
  return {
    kind: 'plane',
    x: xCentre,
    z: (z0 + z1) / 2,
    rotY: 0,
    rotX: -dir * Math.atan2(rise, run),
    sizeX: halfW * 2,
    sizeY: (y0 + y1) / 2 + stairLineOffset(riser),
    sizeZ: Math.hypot(run, rise),
    detached: true,
    groundY: 0,
  };
}

/**
 * A flight of stone steps climbing from (z0, y0) to (z1, y1), spanning
 * `halfW` yards either side of `xCentre`: one solid stepped block, and (into
 * `vols`) the sloped floor the body walks on. The block never collides.
 */
function stairRunW(
  out: PlacedAsset[],
  vols: ColliderVolume[],
  xCentre: number,
  halfW: number,
  z0: number,
  z1: number,
  y0: number,
  y1: number,
): void {
  const run = Math.abs(z1 - z0);
  const rise = y1 - y0;
  if (run < 1e-6 || rise <= 0) return;
  // The step count MUST match rampW's exactly. rampW is what actually stamps
  // the walkable ground, and it uses ceil(rise / TH_RAMP_STEP); a different
  // count here put the visible stone up to a full riser off the surface the
  // plane follows, so feet sank to mid-shin through every tread.
  const n = Math.max(1, Math.ceil(Math.abs(rise) / TH_RAMP_STEP));
  const riser = rise / n;
  const tread = run / n;
  vols.push(stairFloor(xCentre, halfW, z0, z1, y0, y1, riser));
  out.push(stairBlock(xCentre, halfW, z0, z1, y0, n, riser, tread));
}

/** Stairs on every climb: the Tideway causeway and the three ward seams. */
function climbStairs(out: PlacedAsset[], vols: ColliderVolume[]): void {
  const gate = th(0, TH_LOWER.v0);
  stairRunW(out, vols, 0, TH_CAUSEWAY_HALF_W, TH_CAUSEWAY_Z0, gate.z, 0, TH_LOWER.y);
  for (const [lo, hi2] of [
    [TH_LOWER, TH_MARKET],
    [TH_MARKET, TH_HIGH],
    [TH_HIGH, TH_KEEP],
  ] as const) {
    for (const u of TH_RAMP_U) {
      const a = th(u, lo.v1 - 12);
      const b = th(u, hi2.v0 + 12);
      stairRunW(out, vols, a.x, TH_RAMP_HALF_U * TH_S, a.z, b.z, lo.y, hi2.y);
    }
  }
}

/** The city's collider volumes: the sloped walking floors over every flight of
 *  stairs (see climbStairs). Everything else in the city collides through its
 *  placements and blockers. */
export function citadelColliderVolumes(): ColliderVolume[] {
  const vols: ColliderVolume[] = [];
  climbStairs([], vols);
  return vols;
}

export function citadelPlacements(): PlacedAsset[] {
  const out: PlacedAsset[] = [];
  causewayDressing(out);
  climbStairs(out, []);
  lowerWard(out);
  marketWard(out);
  highWard(out);
  keepWard(out);
  densify(out);
  terraceRails(out);
  bridgeDressing(out);
  bergDressing(out);
  flourish(out);
  return out;
}

// ---------------------------------------------------------------------------
// Lights, sound, districts
// ---------------------------------------------------------------------------

/** Tide-glass cyan, the same note the bell's lamps ring on. */
export const TH_LAMP_COLOR = 0x7fe6ff;
/** Warmer amber for the hearths, so the city is not one flat colour at night. */
export const TH_HEARTH_COLOR = 0xffb46a;

/**
 * Point lights. The cap is MAX_LIGHTS = 24 for a document and the arena already
 * spends 8, so this is a DELIBERATELY short list — 15 pools that matter (the
 * gate colossi, the fountain, the spans, the keep) rather than one per lamp
 * post. The streetlamp model carries its own emissive, which is what actually
 * reads at distance.
 */
export function citadelLights(): NonNullable<WorldContent['lights']> {
  const spots: readonly [number, number, number, number, number, number?][] = [
    // x, z, y above ground, colour, range, intensity?
    // The gate colossi and the court behind them.
    [-30, 140, 14, TH_LAMP_COLOR, 52, 2.6],
    [30, 140, 14, TH_LAMP_COLOR, 52, 2.6],
    [0, 205, 8, TH_HEARTH_COLOR, 46],
    // The boulevard.
    [0, 280, 9, TH_LAMP_COLOR, 48],
    // The monument's plaza, brightest pool in the city.
    [0, TH_BRIDGE_Z, 10, TH_LAMP_COLOR, 60, 3],
    [-40, TH_BRIDGE_Z, 7, TH_HEARTH_COLOR, 42],
    [40, TH_BRIDGE_Z, 7, TH_HEARTH_COLOR, 42],
    // The mooring beacons.
    [-215, 330, 20, TH_LAMP_COLOR, 55],
    [215, 330, 20, TH_LAMP_COLOR, 55],
    // The far beacon terraces across the ice.
    [-TH_BEACON_TERRACE_X, TH_BRIDGE_Z, 22, TH_LAMP_COLOR, 62, 3],
    [TH_BEACON_TERRACE_X, TH_BRIDGE_Z, 22, TH_LAMP_COLOR, 62, 3],
    // Wardens' Row.
    [0, 512, 7, TH_HEARTH_COLOR, 46],
    // The Warden's Seat: court and crown.
    [0, 640, 9, TH_LAMP_COLOR, 50],
    [0, 686, 34, TH_LAMP_COLOR, 58, 2.6],
    [0, 700, 8, TH_HEARTH_COLOR, 40],
  ];
  return spots.map(([x, z, y, color, range, intensity]) => ({
    x,
    z,
    y,
    color,
    intensity: intensity ?? 2.1,
    range,
  }));
}

export function citadelPointSounds(): NonNullable<WorldContent['pointSounds']> {
  const plaza = th(0, 79);
  const gate = th(0, 6);
  const row = th(0, 128);
  return [
    { x: plaza.x, z: plaza.z, y: 3, sound: 'amb_town', radius: 120, volume: 0.55 },
    { x: gate.x, z: gate.z, y: 3, sound: 'amb_town', radius: 80, volume: 0.35 },
    { x: row.x, z: row.z, y: 3, sound: 'amb_town', radius: 80, volume: 0.35 },
  ];
}

/** Named districts, so the HUD tells a player which ward they are standing in. */
export function citadelLocations(): NonNullable<WorldContent['locations']> {
  const out: NonNullable<WorldContent['locations']> = [];
  for (const w of TH_WARDS) {
    const a = th(-w.halfU, w.v0);
    const b = th(w.halfU, w.v1);
    out.push({ name: w.name, minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z });
  }
  const gateZ = th(0, TH_LOWER.v0).z;
  out.push({
    name: 'The Tideway',
    minX: -TH_CAUSEWAY_HALF_W,
    maxX: TH_CAUSEWAY_HALF_W,
    minZ: TH_CAUSEWAY_Z0,
    maxZ: gateZ,
  });
  out.push({
    name: 'The West Span',
    minX: -TH_BRIDGE_X1,
    maxX: -TH_BRIDGE_X0,
    minZ: TH_BRIDGE_Z - TH_BRIDGE_HALF_W,
    maxZ: TH_BRIDGE_Z + TH_BRIDGE_HALF_W,
  });
  out.push({
    name: 'The East Span',
    minX: TH_BRIDGE_X0,
    maxX: TH_BRIDGE_X1,
    minZ: TH_BRIDGE_Z - TH_BRIDGE_HALF_W,
    maxZ: TH_BRIDGE_Z + TH_BRIDGE_HALF_W,
  });
  // Landmarks inside the wards, listed AFTER them so a reader that takes the
  // last (or smallest) match names the building over the district. Footprints
  // are the placed models' SIZE rows in yards, centred on their city point.
  const landmark = (name: string, u: number, v: number, w: number, d: number): void => {
    const c = th(u, v);
    out.push({ name, minX: c.x - w / 2, maxX: c.x + w / 2, minZ: c.z - d / 2, maxZ: c.z + d / 2 });
  };
  landmark('Wardenhold', 0, 182, 41.4, 47.9); // the keep: seat of Warden Cassia Deepglass
  landmark('Vigil Hall', 0, 142, 22.5, 34.7); // the wardens' hall, where the Seneschal keeps the vigil
  landmark("Tide's Coffer", -52, 68, 20.4, 18.8); // the bank, Coffer-Keeper Ansel Tide
  landmark('The Gilded Gull', 52, 68, 26.8, 22.1); // the tavern
  landmark("Brine's Forge", 46, 96, 21.1, 16.6); // the smithy, Forgewarden Yela Brine
  landmark('The Glass Exchange', 0, 98, 34, 20); // the market pavilion
  landmark("Baldemar's Court", 0, 79, 36, 36); // the fountain plaza and the monument
  for (const side of [-1, 1] as const) {
    out.push({
      name: side < 0 ? 'Westlight Terrace' : 'Eastlight Terrace',
      minX: side * TH_BEACON_TERRACE_X - TH_BEACON_TERRACE_R,
      maxX: side * TH_BEACON_TERRACE_X + TH_BEACON_TERRACE_R,
      minZ: TH_BRIDGE_Z - TH_BEACON_TERRACE_R,
      maxZ: TH_BRIDGE_Z + TH_BEACON_TERRACE_R,
    });
  }
  return out;
}

/** The city is paved: scrub the procedural meadow off every ward, the
 *  causeway, the spans and the beacon terraces. WORLD-space grid. */
export function citadelGrassClear(): NonNullable<WorldContent['grassClear']> {
  const out: { x: number; z: number; r: number }[] = [];
  const gridOver = (x0: number, x1: number, z0: number, z1: number, r = 26, step = 38): void => {
    const cols = Math.max(1, Math.ceil((x1 - x0) / step));
    const rows = Math.max(1, Math.ceil((z1 - z0) / step));
    for (let ri = 0; ri <= rows; ri++) {
      for (let ci = 0; ci <= cols; ci++) {
        out.push({ x: x0 + ((x1 - x0) * ci) / cols, z: z0 + ((z1 - z0) * ri) / rows, r });
      }
    }
  };
  for (const w of TH_WARDS) {
    const a = th(-w.halfU - 6, w.v0);
    const b = th(w.halfU + 6, w.v1);
    gridOver(a.x, b.x, a.z, b.z);
  }
  // The causeway.
  const gateZ = th(0, TH_LOWER.v0).z;
  for (let z = TH_CAUSEWAY_Z0; z <= gateZ; z += 14) {
    out.push({ x: 0, z, r: 15 });
  }
  // The spans and their terraces.
  for (const side of [-1, 1]) {
    for (let x = TH_BRIDGE_X0; x <= TH_BRIDGE_X1; x += 18) {
      out.push({ x: side * x, z: TH_BRIDGE_Z, r: 13 });
    }
    out.push({ x: side * TH_BEACON_TERRACE_X, z: TH_BRIDGE_Z, r: TH_BEACON_TERRACE_R });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ground paint
//
// The texture painter's own layer, authored in code the way shipped_thornhollow
// does it: built-in PBR sets (render/terrain_texture_sets.ts), so the ground
// art resolves from the app bundle on every machine the map opens on. In
// Studio these arrive as ordinary palette swatches — repaint away.
// ---------------------------------------------------------------------------

export const PAINT_PLAZA = 200; // CUSTOM_PAINT_ID_MIN
export const PAINT_STREET = 201;
export const PAINT_WARD = 202;
export const PAINT_KEEP = 203;
export const PAINT_YARD = 204;
export const PAINT_GARDEN = 205;
export const PAINT_FROST = 206;
export const PAINT_CLIFF = 207;
export const PAINT_GRAVEL = 208;

export const TH_SWATCHES: CustomPaintSwatch[] = [
  {
    id: PAINT_PLAZA,
    color: 0x8d8fa0,
    label: 'Plaza Paving',
    textureSha: 'builtin:PavingStones046',
    tileSize: 7,
    saved: true,
  },
  {
    id: PAINT_STREET,
    color: 0x9298a6,
    label: 'Warden Cobbles',
    textureSha: 'builtin:Cobblestone001',
    tileSize: 6,
    saved: true,
  },
  {
    id: PAINT_WARD,
    color: 0x8f9298,
    label: 'Terrace Stone',
    textureSha: 'builtin:Rock054',
    tileSize: 9,
    saved: true,
  },
  {
    id: PAINT_KEEP,
    color: 0x9aa4b8,
    label: 'Warden Tiles',
    textureSha: 'builtin:Tiles001',
    tileSize: 6,
    saved: true,
  },
  {
    id: PAINT_YARD,
    color: 0x6d5c46,
    label: 'Drill Yard',
    textureSha: 'builtin:Ground100',
    tileSize: 7,
    light: 0.06,
    saved: true,
  },
  {
    id: PAINT_GARDEN,
    color: 0x4d6b34,
    label: 'Row Garden',
    textureSha: 'builtin:Grass005',
    tileSize: 8,
    saved: true,
  },
  {
    id: PAINT_FROST,
    color: 0xdfe9f2,
    label: 'Frost Lip',
    textureSha: 'builtin:Snow004',
    tileSize: 9,
    saved: true,
  },
  {
    id: PAINT_CLIFF,
    color: 0x55575e,
    label: 'Sea Cliff',
    textureSha: 'builtin:Cliff002',
    tileSize: 10,
    saved: true,
  },
  {
    id: PAINT_GRAVEL,
    color: 0x8a8478,
    label: 'Mooring Gravel',
    textureSha: 'builtin:Gravel024',
    tileSize: 6,
    saved: true,
  },
];

/** Which swatch paints WORLD (x, z). 255 = unpainted (the biome's own ground —
 *  the arena terrace, the mountains, the sea floor). Mirrors the layout so the
 *  ground reads the city: paving under the plaza, cobbles up the boulevard,
 *  frost on every lip that overhangs the ice. */
function paintAt(x: number, z: number): number {
  const ax = Math.abs(x);
  const gateZ = th(0, TH_LOWER.v0).z;

  // The spans and their terraces.
  if (
    Math.abs(z - TH_BRIDGE_Z) <= TH_BRIDGE_HALF_W &&
    ax >= TH_BRIDGE_X0 - 6 &&
    ax <= TH_BRIDGE_X1
  ) {
    return PAINT_STREET;
  }
  if (Math.hypot(ax - TH_BEACON_TERRACE_X, z - TH_BRIDGE_Z) <= TH_BEACON_TERRACE_R) {
    return Math.hypot(ax - TH_BEACON_TERRACE_X, z - TH_BRIDGE_Z) > TH_BEACON_TERRACE_R - 8
      ? PAINT_FROST
      : PAINT_PLAZA;
  }
  // The Tideway: pale paving, so the walk out of the pale stone arena reads
  // as one continuous processional rather than a dark tar strip.
  if (ax <= TH_CAUSEWAY_HALF_W + 2 && z >= TH_CAUSEWAY_Z0 - 6 && z < gateZ) return PAINT_PLAZA;

  // Inside the wards (with their shelf margin).
  for (const w of TH_WARDS) {
    const a = th(-w.halfU - 6, w.v0);
    const b = th(w.halfU + 6, w.v1);
    if (x < a.x || x > b.x || z < a.z || z > b.z) continue;
    // The frost lip: the outer edge of every shelf, where the ice wind lands.
    if (x < a.x + 9 || x > b.x - 9 || (w.id === 'th_lower' && z < a.z + 9)) return PAINT_FROST;
    const { x: u3, z: zz } = { x: x / TH_S, z: (z - TH_GATE_Z) / TH_S }; // back to city units
    const u = u3;
    const v = zz;
    if (w.id === 'th_lower') {
      // The boulevard up the axis, and the drill yards behind the barracks.
      if (Math.abs(u) <= 13) return PAINT_STREET;
      if (Math.abs(u) >= 40 && Math.abs(u) <= 56 && v >= 6 && v <= 40) return PAINT_YARD;
      return PAINT_WARD;
    }
    if (w.id === 'th_market') {
      // The fountain plaza and the two great cross-streets.
      if (Math.hypot(u, v - 79) <= 17) return PAINT_PLAZA;
      if (Math.abs(v - 79) <= 5.5) return PAINT_STREET;
      if (Math.abs(u) <= 11) return PAINT_STREET;
      if (Math.abs(u) >= 62) return PAINT_GRAVEL;
      return PAINT_WARD;
    }
    if (w.id === 'th_high') {
      // The garden, then the street grid.
      if (Math.abs(u) <= 16 && v >= 108 && v <= 124) return PAINT_GARDEN;
      if (Math.abs(u) <= 9) return PAINT_STREET;
      return PAINT_WARD;
    }
    // The Warden's Seat: tiled court.
    if (Math.abs(u) <= 9 && v <= 166) return PAINT_STREET;
    return PAINT_KEEP;
  }

  // The ramp corridors between wards.
  for (const uRamp of TH_RAMP_U) {
    const p = th(uRamp, 0);
    if (
      Math.abs(x - p.x) <= TH_RAMP_HALF_U * TH_S + 3 &&
      z >= th(0, TH_LOWER.v1 - 14).z &&
      z <= th(0, TH_KEEP.v0 + 14).z
    ) {
      return PAINT_STREET;
    }
  }

  // The arena esplanade: the whole terrace reads as one built floor — pale
  // paving from the plaza out to the parapet, so no meadow grows between the
  // stadium and the drop. (The stadium's own stone rings draw over it; the
  // slope past ~103 falls to the moat and keeps the biome's rock rules.)
  if (Math.hypot(x, z) <= 103) return PAINT_PLAZA;

  // Berg tops: snow on the ice.
  for (const b of TH_BERGS) {
    if (Math.hypot(x - b.x, z - b.z) <= b.r + 2) return PAINT_FROST;
  }

  // The chasm walls keep the biome's own slope-rock rules — painting them
  // dark read as a stain ringing the arena rather than as stone.
  return 255;
}

const TH_PAINT_CELL = 5;

/** The whole map's ground paint. Grid covers the city, the arena and the sea
 *  between; anything the painter never touches stays 255 = the biome's own
 *  ground, so the mountains keep their slope-rock and snow-cap rules. */
export function citadelBiomePaint(): BiomePaint {
  const x0 = -460;
  const x1 = 460;
  const z0 = -250;
  const z1 = 1000;
  const cols = Math.ceil((x1 - x0) / TH_PAINT_CELL);
  const rows = Math.ceil((z1 - z0) / TH_PAINT_CELL);
  const ids: number[] = [];
  for (let r = 0; r < rows; r++) {
    const z = z0 + (r + 0.5) * TH_PAINT_CELL;
    for (let c = 0; c < cols; c++) {
      ids.push(paintAt(x0 + (c + 0.5) * TH_PAINT_CELL, z));
    }
  }
  return { cell: TH_PAINT_CELL, cols, rows, originX: x0, originZ: z0, ids, custom: TH_SWATCHES };
}

// ---------------------------------------------------------------------------
// The people
//
// Every one of them is `dynamic: true` with a RESERVED entity id, spawned by
// citadel_spawn.ts after world init. That is not tidiness: the generic surface
// loop allocates ids as it walks, so forty extra bodies would shift every id
// after them, move the deepball bout's rng with them, and tip the pacing
// assertion in tests/deepglass.test.ts — the exact trap the marshal taught.
//
// APPEND ONLY: entity id is TH_ENTITY_ID_BASE + roster index, so inserting a
// resident in the middle would renumber everyone after them.
// ---------------------------------------------------------------------------

/** Base of the citadel's reserved entity id block. 1_000_000_200/230 are the
 *  arena crowd's and 1_000_000_100+ are Baldemar's, so this starts clear. */
export const TH_ENTITY_ID_BASE = 1_000_000_400;

interface Walk {
  /** Waypoints in city (u, v), walked in order. */
  points: readonly (readonly [number, number, number?])[];
  mode: 'loop' | 'pingpong';
  speed: number;
}

export interface CitadelResident {
  def: NpcDef;
  walk?: Walk;
}

let idCursor = 0;
const roster: CitadelResident[] = [];

function resident(
  def: Omit<NpcDef, 'pos' | 'dynamic' | 'questIds'> & { u: number; v: number },
  walk?: Walk,
): void {
  const { u, v, ...rest } = def;
  // Ring city: the old (u, v) address is re-seated onto the ring (citadel_ring_frame).
  seatResident(rest, ringSeat(u, v), walk);
}

/** A resident seated at an explicit WORLD point — for the keepers whose seat
 *  is a fixed model-space offset of their own building (the innkeeper behind
 *  his bar, the coffer-keeper at his steps), derived from the ring's landmark
 *  seats rather than re-mapped from the old plan. */
function residentAt(
  def: Omit<NpcDef, 'pos' | 'dynamic' | 'questIds'> & { x: number; z: number },
  walk?: Walk,
  walkInWorld = false,
): void {
  const { x, z, ...rest } = def;
  seatResident(rest, { x, z }, walk, walkInWorld);
}

function seatResident(
  rest: Omit<NpcDef, 'pos' | 'dynamic' | 'questIds'>,
  p: { x: number; z: number },
  walk?: Walk,
  walkInWorld = false,
): void {
  const full: NpcDef = { ...rest, pos: { x: p.x, z: p.z }, questIds: [], dynamic: true } as NpcDef;
  // The walk is baked into the DEF, not attached at spawn time. The def is the
  // one record that reaches every world shape — the code-built arena's
  // reserved-id spawner, and a Studio document whose surface loop places the
  // roster itself — and map_doc's sanitizeNpc round-trips `route`, so a def
  // that carries its patrol keeps it through export, import and re-save.
  if (walk) {
    full.route = {
      mode: walk.mode,
      speed: walk.speed,
      points: walk.points.map(([wu, wv, wait]) => {
        // A walk authored in WORLD yards (Castle B's guards, whose seats are
        // kit offsets of their own building) skips the old-plan re-seat.
        const wp = walkInWorld ? { x: wu, z: wv } : ringSeat(wu, wv);
        return wait === undefined ? { x: wp.x, z: wp.z } : { x: wp.x, z: wp.z, wait };
      }),
    };
  }
  roster.push({ def: full, walk });
  idCursor++;
}

// --- the Tide Gate ---------------------------------------------------------

resident({
  id: 'th_gate_captain',
  name: 'Gate-Captain Isolde Brack',
  title: 'Keeper of the Tide Gate',
  u: -7,
  v: 12,
  facing: Math.PI,
  color: 0x9fd8ff,
  greeting:
    'Tidehold keeps the bell, $C, and I keep Tidehold. Causeway is open, the market is loud, ' +
    'and the Warden is in. Mind the rail on the way back down.',
});

for (let i = 0; i < 2; i++) {
  const side = i === 0 ? -1 : 1;
  resident(
    {
      id: `th_gate_watch_${i}`,
      name: i === 0 ? 'Warden Sable Quist' : 'Warden Tomas Reel',
      title: 'Gate Watch',
      u: side * 40,
      v: 10,
      facing: Math.PI,
      color: 0x8fc6e8,
      greeting: 'Walk on. The wards are quiet and I would like them to stay that way.',
    },
    {
      mode: 'pingpong',
      speed: 1.5,
      points: [
        [side * 56, 10, 4],
        [side * 8, 10, 2],
      ],
    },
  );
}

resident(
  {
    id: 'th_lamplighter',
    name: 'Ondry the Lamplighter',
    title: 'Keeper of the Crystal Lamps',
    u: 0,
    v: 20,
    facing: 0,
    color: 0xd8f0ff,
    greeting:
      'Every lamp from the causeway to the Seat, and they all want tending before the light goes. ' +
      'Follow me up if you like, it is the best walk in the city.',
  },
  {
    // The full climb, gate to keep and back down: the one route that shows a
    // player the whole city without them having to find it.
    mode: 'pingpong',
    speed: 1.5,
    points: [
      [0, 14, 3],
      [-34, 48, 1],
      [-12, 79, 4],
      [0, 92, 2],
      [34, 100, 1],
      [30, 124, 3],
      [0, 146, 2],
      [-34, 156, 1],
      [0, 172, 5],
    ],
  },
);

resident({
  id: 'th_stablemaster',
  name: 'Stablemaster Corrin Vane',
  title: 'Tidehold Stables',
  u: -48,
  v: 40,
  facing: -Math.PI / 2,
  color: 0xc7a884,
  greeting:
    'Nothing with wings, nothing with a burner. Just honest horses that never fell off a causeway.',
});

// --- the Glass Market: the fountain ring's four cardinal vendors ------------

resident({
  id: 'th_market_pies',
  name: 'Marla Saltmere',
  title: 'Bread and Brine',
  u: 0,
  v: 69.5,
  facing: 0,
  color: 0xf2c98a,
  vendorItems: ['baked_bread', 'roasted_boar', 'tough_jerky', 'spring_water'],
  greeting:
    'Fresh from the Row ovens, $C. Eat it here, half of it blows off the terrace out there.',
});

resident({
  id: 'th_market_tonics',
  name: 'Apothecary Wren Fell',
  title: 'Tonics and Drams',
  u: 9.5,
  v: 79,
  facing: -Math.PI / 2,
  color: 0xa9e8c8,
  vendorItems: [
    'minor_healing_potion',
    'minor_mana_potion',
    'lesser_healing_potion',
    'lesser_mana_potion',
  ],
  greeting:
    'Bruise tonic, nerve tonic, and something for the drop. Deepball players are my best trade.',
});

resident({
  id: 'th_market_bags',
  name: 'Packmaster Hest',
  title: 'Bags and Bindings',
  u: 0,
  v: 88.5,
  facing: Math.PI,
  color: 0xd6a5e8,
  vendorItems: ['linen_pouch', 'travelers_knapsack'],
  greeting: 'You cannot carry the Glass Market home in your fists, $C. Ask me how I know.',
});

resident({
  id: 'th_market_reagents',
  name: 'Ore-Factor Dunn',
  title: 'Stone, Bar and Bloom',
  u: -9.5,
  v: 79,
  facing: Math.PI / 2,
  color: 0xb9c6d4,
  vendorItems: ['copper_ore', 'iron_ore', 'ironbark_log', 'silverleaf_herb', 'goldleaf_herb'],
  greeting: 'Everything the Row forges comes up the causeway on somebody’s back. Mine, mostly.',
});

resident({
  id: 'th_smith',
  name: 'Forgewarden Yela Brine',
  title: 'The Tidehold Forge',
  u: 28,
  v: 62,
  facing: -Math.PI / 2,
  color: 0xe0a070,
  vendorItems: ['wardplate_cuirass', 'nightweave_tunic', 'veilcloth_robe'],
  greeting:
    'Glass is the Warden’s business. Steel is mine, and mine holds when the glass does not.',
});

// Tide's Coffer's keeper stands at his own steps — model yards (4.3, -17.3)
// of the bank, a stride off the shop window and beside the strongbox, as on
// the old plan — facing the street. Seated off RING_BANK so he follows the
// bank wherever the ring puts it.
{
  const bankSeat = localOffset(pol(RING_BANK.r, RING_BANK.phi), RING_BANK.phi, 4.32, -17.28);
  residentAt({
    id: 'th_banker',
    name: 'Coffer-Keeper Ansel Tide',
    title: 'The Deepglass Vault',
    x: bankSeat.x,
    z: bankSeat.z,
    facing: RING_BANK.phi + Math.PI,
    color: 0xd9c98a,
    banker: true,
    greeting: 'Your coin is safer in the rock than in your pocket over a fifty-yard drop, $C.',
  });
}

resident({
  id: 'th_merchant',
  name: 'Factor Iselle Coralwake',
  title: 'Warden Market',
  u: 0,
  v: 93,
  facing: Math.PI,
  color: 0xa0d8c8,
  market: true,
  greeting:
    'Half the realm sends its goods up here for the fixtures. Buy, sell, and mind the queue.',
});

// Behind the long bar of the Gilded Gull: the bar run sits 7.6 model yards
// toward the tavern's back wall, so he stands a stride behind it (0, 8.9) and
// faces the door. Seated off RING_TAVERN so he follows the tavern.
{
  const barSeat = localOffset(pol(RING_TAVERN.r, RING_TAVERN.phi), RING_TAVERN.phi, 0, 8.9);
  residentAt({
    id: 'th_innkeeper',
    name: 'Innkeeper Dov Marrow',
    title: 'The Gilded Gull',
    x: barSeat.x,
    z: barSeat.z,
    facing: RING_TAVERN.phi + Math.PI,
    color: 0xc8a0a0,
    greeting:
      'Bed, board and a window facing the bell. You will not sleep on match night, but you will not want to. Board is up by the door if you are looking for company.',
  });
}

// Six shoppers working the plaza, so the market is never a room of statues.
const MARKET_WALKS: readonly Walk[] = [
  {
    mode: 'loop',
    speed: 1.15,
    points: [
      [-14, 68, 4],
      [-14, 90, 3],
      [14, 90, 2],
      [14, 68, 3],
    ],
  },
  {
    mode: 'loop',
    speed: 1.05,
    points: [
      [18, 74, 3],
      [0, 64, 2],
      [-18, 74, 4],
      [0, 94, 3],
    ],
  },
  {
    mode: 'pingpong',
    speed: 0.95,
    points: [
      [-58, 79, 6],
      [-13, 79, 5],
    ],
  },
  {
    mode: 'pingpong',
    speed: 1.1,
    points: [
      [58, 79, 5],
      [13, 79, 6],
    ],
  },
  {
    mode: 'loop',
    speed: 1.25,
    points: [
      [-56, 60, 2],
      [-56, 100, 3],
      [-24, 100, 2],
      [-24, 60, 3],
    ],
  },
  {
    mode: 'loop',
    speed: 1.2,
    points: [
      [56, 100, 3],
      [56, 60, 2],
      [24, 60, 3],
      [24, 100, 2],
    ],
  },
];
const MARKET_FOLK: readonly (readonly [string, string, number])[] = [
  ['Netta Halloway', 'Glassmonger', 0xe8d3a8],
  ['Bram Culloch', 'Ropewright', 0xa8c8e8],
  ['Sister Ivo Marn', 'Almswoman of the Tide', 0xd8d8f0],
  ['Sallis Quay', 'Ferry Factor', 0x9ad0b8],
  ['Old Perrin', 'Fixture Tout', 0xd0b090],
  ['Yenna Coll', 'Netmender', 0xb8a8d0],
];
MARKET_FOLK.forEach(([name, title, color], i) => {
  const w = MARKET_WALKS[i];
  resident(
    {
      id: `th_market_folk_${i}`,
      name,
      title,
      u: w.points[0][0],
      v: w.points[0][1],
      facing: 0,
      color,
      greeting:
        'Fixture day, and the whole terrace is up here buying. Mind your purse and your elbows.',
    },
    w,
  );
});

// --- the Moorings ----------------------------------------------------------

for (let i = 0; i < 2; i++) {
  const side = i === 0 ? -1 : 1;
  resident(
    {
      id: `th_dockhand_${i}`,
      name: i === 0 ? 'Dockmaster Ferrow Kell' : 'Riggerwoman Sena Tull',
      title: 'The Moorings',
      u: side * 72,
      v: i === 0 ? 62 : 94,
      facing: side < 0 ? -Math.PI / 2 : Math.PI / 2,
      color: 0x8fbcd8,
      greeting:
        'Ships moor to the rock here and hang over the ice. You get used to it, or you go back down the causeway.',
    },
    {
      mode: 'pingpong',
      speed: 1.2,
      points:
        i === 0
          ? [
              [side * 72, 56, 4],
              [side * 72, 72, 4],
            ]
          : [
              [side * 72, 86, 4],
              [side * 72, 100, 4],
            ],
    },
  );
}

// --- Wardens' Row ----------------------------------------------------------

resident({
  id: 'th_clerk',
  name: 'Clerk Ottoline Vex',
  title: 'The Warden’s Hall',
  u: 0,
  v: 133,
  facing: 0,
  color: 0xcfd8e8,
  greeting:
    'Petitions on the left, fixture disputes on the right, and everything about the causeway rail on my desk.',
});

resident({
  id: 'th_priest',
  name: 'Tidespeaker Halloran',
  title: 'The Chapel of the Still Water',
  u: -40,
  v: 121,
  facing: 0,
  color: 0xdce8f4,
  greeting: 'We keep a bowl of the bell’s own water on the altar. It has never once gone cloudy.',
});

resident({
  id: 'th_armourer',
  name: 'Quartermaster Rook Adlin',
  title: 'The Grand Armoury',
  u: 44,
  v: 118,
  facing: 0,
  color: 0xb0b8c0,
  vendorItems: ['healing_potion', 'mana_potion', 'trail_hardtack', 'meltwater_flask'],
  greeting:
    'Everything the watch carries, and a little of what it should. The Warden pays; you pay less.',
});

const ROW_WALKS: readonly Walk[] = [
  {
    mode: 'loop',
    speed: 1.0,
    points: [
      [-58, 114, 3],
      [-58, 146, 2],
      [-14, 146, 3],
      [-14, 114, 2],
    ],
  },
  {
    mode: 'loop',
    speed: 1.1,
    points: [
      [58, 146, 2],
      [58, 114, 3],
      [14, 114, 2],
      [14, 146, 3],
    ],
  },
  {
    mode: 'pingpong',
    speed: 0.9,
    points: [
      [-8, 110, 6],
      [-8, 148, 5],
    ],
  },
  {
    mode: 'pingpong',
    speed: 1.0,
    points: [
      [8, 148, 5],
      [8, 110, 6],
    ],
  },
];
const ROW_FOLK: readonly (readonly [string, string, number])[] = [
  ['Magister Ilvane Doss', 'Warden’s Household', 0xc0b0e0],
  ['Goodwife Prell', 'Of the Row', 0xe0c0a8],
  ['Anselm Coy', 'Glasswright', 0x9fd0e0],
  ['Little Wren', 'Of the Row', 0xf0d0c0],
];
ROW_FOLK.forEach(([name, title, color], i) => {
  const w = ROW_WALKS[i];
  resident(
    {
      id: `th_row_folk_${i}`,
      name,
      title,
      u: w.points[0][0],
      v: w.points[0][1],
      facing: 0,
      color,
      greeting: 'Up here you can hear the bell when the wind drops. Best address in the city.',
    },
    w,
  );
});

// --- the Warden's Seat -----------------------------------------------------

// Castle B's frame for everyone who lives in it: kit (x, y) of bl_castle_b.py
// -> world, from the castle's own seat (rotY 0). `facing` is the sim yaw with
// forward = (sin, cos).
const CB_SEAT = pol(RING_CASTLE.r, RING_CASTLE.phi);
const cb = (xk: number, yk: number): { x: number; z: number } => ({
  x: CB_SEAT.x + xk * 1.35,
  z: CB_SEAT.z - yk * 1.35,
});
const cbFacing = (from: { x: number; z: number }, to: { x: number; z: number }): number =>
  Math.atan2(to.x - from.x, to.z - from.z);

residentAt({
  id: 'th_warden',
  name: 'Warden Cassia Deepglass',
  title: 'Warden of the Bell',
  x: cb(0, -13.9).x,
  z: cb(0, -13.9).z,
  facing: cbFacing(cb(0, -13.9), cb(0, 20)),
  color: 0x7fe6ff,
  greeting:
    'You came up the whole causeway to look at me, $C? The bell is behind you and it is the only thing ' +
    'here worth the climb. Go and play in it, that is what we keep it for.',
});

residentAt({
  id: 'th_seneschal',
  name: 'Seneschal Aldric Poole',
  title: 'The Warden’s Seat',
  x: cb(3.0, -13.4).x,
  z: cb(3.0, -13.4).z,
  facing: cbFacing(cb(3.0, -13.4), cb(0, 20)),
  color: 0xd0c8b0,
  greeting:
    'The Warden sees petitioners at the turn of the glass. The glass, in this city, is quite large.',
});

// The Warden's Watch, seated in Castle B by KIT offset of the castle itself
// (bl_castle_b.py's plan: x kit -> world x*1.35, y kit -> world z - y*1.35 from
// the castle's seat, rotY 0). Names carry over from the first keep's watch.
// `facing` is the sim's yaw, forward = (sin, cos): a guard looks where told.
// The two by the dais stand between the carpet and the pillar rows (the
// pillars are at x +-6 kit; a seat on one gets shoved off by findSafePos).
const CB_GUARDS: {
  name: string;
  at: [number, number];
  look: [number, number];
  greeting: string;
  walk?: [number, number][];
}[] = [
  { name: 'Guard Ottar', at: [-3.4, 21.2], look: [-3.4, 40], greeting: 'The gate stands open by the Warden’s word. Mind the portcullis if the bell rings.' },
  { name: 'Guard Lisbet', at: [3.4, 21.2], look: [3.4, 40], greeting: 'Keep to the yard, friend. The hall is the Warden’s, and the towers are ours.' },
  { name: 'Guard Vance', at: [-2.8, -0.4], look: [-2.8, 20], greeting: 'The Warden holds court within. Wipe your boots, that carpet came from Goldcrest.' },
  { name: 'Guard Merrin', at: [2.8, -0.4], look: [2.8, 20], greeting: 'Petitioners to the hall, deliveries to the kitchen wing. Which are you?' },
  { name: 'Guard Halvard', at: [-4.0, -11.2], look: [-4.0, 0], greeting: 'Eyes front. The Warden is listening even when she is not looking.' },
  { name: 'Guard Sunniva', at: [4.0, -11.2], look: [4.0, 0], greeting: 'Stand where the carpet ends. No closer, unless she calls you.' },
  { name: 'Guard Roderic', at: [-12, 5], look: [12, 5], greeting: 'Round and round the yard. Someone has to.', walk: [[-12, 5], [-12, 17], [12, 17], [12, 5]] },
  { name: 'Guard Ansel', at: [12, 17], look: [-12, 17], greeting: 'A dry post, a full belly and a view of the fountain. There are worse watches.', walk: [[12, 17], [12, 5], [-12, 5], [-12, 17]] },
  { name: 'Guard Tove', at: [-19, -7], look: [-13, -7], greeting: 'Barracks. Off-watch means asleep, so keep it down.' },
];
CB_GUARDS.forEach((g, i) => {
  const seat = cb(g.at[0], g.at[1]);
  residentAt(
    {
      id: `th_keep_guard_${i}`,
      name: g.name,
      title: 'The Warden’s Watch',
      x: seat.x,
      z: seat.z,
      facing: cbFacing(seat, cb(g.look[0], g.look[1])),
      color: 0x8fb8d8,
      greeting: g.greeting,
    },
    g.walk
      ? {
          mode: 'loop',
          speed: 1.4,
          points: g.walk.map(([xk, yk]) => {
            const w = cb(xk, yk);
            return [w.x, w.z, 2] as [number, number, number];
          }),
        }
      : undefined,
    true,
  );
});

// --- the fountain and the spans (APPENDED: reserved ids follow the roster) --

resident(
  {
    id: 'th_fountain_keeper',
    name: 'Wellmaster Bryn Cadoc',
    title: 'Keeper of the Wardens’ Fountain',
    u: 5,
    v: 74,
    facing: Math.PI / 4,
    color: 0x9fe0e8,
    greeting:
      'The fountain runs with the bell’s own water, $C, piped up under the causeway, if you believe the ' +
      'Wardens. Baldemar likes the spray on his head. Says it keeps the pate shining.',
  },
  {
    mode: 'loop',
    speed: 0.9,
    points: [
      [5, 74, 6],
      [-5, 74, 3],
      [-5, 84, 6],
      [5, 84, 3],
    ],
  },
);

for (let i = 0; i < 2; i++) {
  const side = i === 0 ? -1 : 1;
  resident(
    {
      id: `th_bridge_watch_${i}`,
      name: i === 0 ? 'Spanwarden Kettil Voss' : 'Spanwarden Mara Frost',
      title: i === 0 ? 'The West Span' : 'The East Span',
      u: side * 90,
      v: 79,
      facing: side < 0 ? Math.PI / 2 : -Math.PI / 2,
      color: 0xa8cfe0,
      greeting:
        'A hundred and thirty yards of stone over black ice, and my job is the rail. Look down if you ' +
        'like, everyone does, once.',
    },
    {
      mode: 'pingpong',
      speed: 1.3,
      points: [
        [side * 84, 79, 3],
        [side * 122, 79, 5],
      ],
    },
  );
}

/** The roster, in id order: entity id is TH_ENTITY_ID_BASE + index. */
export const TIDEHOLD_RESIDENTS: readonly CitadelResident[] = roster;

/** Defs keyed by template id, for the world's npcs table. */
export const TIDEHOLD_NPCS: Record<string, NpcDef> = Object.fromEntries(
  roster.map((r) => [r.def.id, r.def]),
);

/** A resident's authored walk. Baked onto the def (see resident()); this
 *  accessor survives for the reserved-id spawner's convenience. */
export function residentRoute(r: CitadelResident): NpcDef['route'] | undefined {
  return r.def.route;
}

// ---------------------------------------------------------------------------
// Looks
//
// Every resident is composed from the character-creator part library rather
// than dropped on a stock townsperson rig, so forty people are forty faces. The
// ROLE below is the only thing the render side needs to know to dress them:
// derived from the template id rather than carried as another field, so a new
// resident is dressed correctly the moment it is named.
// ---------------------------------------------------------------------------

export type TideholdRole =
  | 'warden'
  | 'captain'
  | 'watch'
  | 'noble'
  | 'priest'
  | 'smith'
  | 'trade'
  | 'dock'
  | 'lamp'
  | 'citizen';

export function isTideholdTemplate(templateId: string): boolean {
  return templateId.startsWith('th_');
}

export function tideholdRole(templateId: string): TideholdRole {
  if (templateId === 'th_warden') return 'warden';
  if (templateId === 'th_gate_captain') return 'captain';
  if (
    templateId.startsWith('th_gate_watch') ||
    templateId.startsWith('th_keep_guard') ||
    templateId.startsWith('th_bridge_watch')
  ) {
    return 'watch';
  }
  if (templateId === 'th_seneschal' || templateId === 'th_clerk') return 'noble';
  if (templateId === 'th_priest') return 'priest';
  if (templateId === 'th_smith') return 'smith';
  if (templateId === 'th_lamplighter' || templateId === 'th_fountain_keeper') return 'lamp';
  if (templateId.startsWith('th_dockhand')) return 'dock';
  if (templateId.includes('_folk_')) return 'citizen';
  return 'trade';
}

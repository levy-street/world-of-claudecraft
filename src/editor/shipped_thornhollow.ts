// Thornhollow: a capture-the-flag hollow, built as an ORDINARY editor map.
//
// Ravenrift (sim/battleground_layout.ts) is code-defined geometry, flat floor
// tiles, wall modules, no terrain and no catalogue assets. This map is the other
// way round: every wall, tree, rune pad and flag stand is a plain placement in a
// CustomMap, so the whole editor toolset applies to it. Open it from
// Open -> Shipped -> Thornhollow, drag anything, and save it as your own map.
//
// The shape is the classic two-keep flag race: mirrored keeps at the ends of a
// wooded ravine, two flank ridges for the high road, and the Fightpit sunk into
// the middle for the fights the flags never settle. Everything is POINT
// symmetric ((x, z) -> (-x, -z)), so neither side has an advantage, the same
// contract Ravenrift's editor mode validates.
//
// Three kinds of object live here:
//   * scenery, walls, towers, trees, rocks, rubble. Ordinary placements with
//     their own baked collision, free to move, restyle or delete.
//   * game-mode anchors, each team's flag, respawn ring, spawn banner and
//     graveyard, plus the rune pads. These are translucent collider volumes
//     tagged with `regionRole`, because no model can tell a reader "this is
//     where Crimson respawns". They are inert: nothing blocks, nothing renders
//     in game; they are the machine-readable half of the map.
//   * decks, 'collider/plane' volumes, the only thing in this engine that
//     RAISES walkable ground. They are what makes each keep two storeys: the
//     rampart over the curtain wall, the stairs up to it, and the flag podium.
//     See the "Two storeys" note over keepRampart().
//
// Terrain is authored the same way a maker would author it, as layered height
// stamps; thornhollowHeight() evaluates that same chain, so the slopes are
// provably walkable and the keeps are provably dead flat.

import { boxesForAssetId } from '../sim/asset_collision';
import { COLLIDER_ASSET_IDS } from '../sim/collider_volumes';
import {
  CUSTOM_PAINT_ID_MIN,
  type MapLight,
  type MapLocation,
  type MapPlacement,
  type RegionRole,
} from '../sim/map_doc';
import { terrainBrushWeight } from '../sim/terrain_brush';
import type { BiomePaint, CustomPaintSwatch, HeightStamp } from '../sim/types';
import { type CustomMap, newFlatCustomMap } from './custom_map';
import { makeRng } from './procgen';

// ---------------------------------------------------------------------------
// Footprint
// ---------------------------------------------------------------------------

/** Map rect: the playable hollow plus the wooded slopes that wall it in.
 *  Every span here is the original hollow's, scaled by 1.2, the extra fifth
 *  is what the two fortress keeps below are built out of. */
export const TH_HALF_X = 120;
export const TH_HALF_Z = 226;
/** Play area: inside this rect the ground is walkable and the fight happens. */
export const TH_PLAY_HALF_X = 86;
export const TH_PLAY_HALF_Z = 182;

/** |z| of each team's flag, deep inside its keep's inner court. */
export const TH_FLAG_Z = 167;

// The keep, as a rect on its team's plateau. A castle, not a courtyard: an
// outer curtain 5 yards thick with a walkable rampart on top, a maze of inner
// walls, and a walled flag court at the back.
const KEEP_BACK_Z = 181; // back curtain, outer line
const KEEP_FRONT_Z = 135; // front curtain + gate line
const KEEP_HALF_X = 46; // side curtains, outer line
const CURTAIN_INSET = 5; // inner curtain line, and so the wall's thickness
const KEEP_TOP_Y = 11; // keep plateau height above the ravine floor
/** Height of the rampart walk over the plateau: the top of a scale-2.6 wall
 *  module, so the walk lands on the curtain it runs along instead of hovering
 *  over it. dungeon/wall's baked collision tops out at 2.209 at scale 1, so the
 *  curtain's walkable top is 5.743; the deck sits a hair above that (never
 *  under it), or the stair head meets a 0.04 yd lip on the curtain it cannot
 *  climb. */
const RAMPART_Y = 5.75;
const DECK_W = 4.8; // rampart walk width, and the deck strip's true footprint

// The flag court: the walled hall at the back of each keep.
const HALL_HALF_X = 24;
const HALL_FRONT_Z = 158;
const HALL_BACK_Z = 175;
const PODIUM_Y = 2.5; // the flag stands this high over the court floor
const PODIUM_HALF = 5.5;

/** Fightpit: a bowl in the middle of the hollow. */
const PIT_FLOOR_Y = -9;
const PIT_FLOOR_R = 19; // flat floor
const PIT_LIP_R = 41; // where the bowl meets the ravine floor
const PIT_RIM_R = 25; // where the rim ring of stone stands

/** Flank ridges: the high road down each side. */
const RIDGE_X = 70;
const RIDGE_HALF = 18;
const RIDGE_Y = 7;

/** The wooded slopes: unwalkable by design (rise/run far past 1.5). */
const WOOD_WALL_Y = 30;

/** Loose stone reads small on a map this size, so every rock on it is stepped
 *  up by this, the boulders now break a sightline instead of decorating it. */
const ROCK_UP = 1.35;

export const TH_TEAM_NAMES = ['Crimson', 'Azure'] as const;
type Team = 0 | 1;

// ---------------------------------------------------------------------------
// Height field
// ---------------------------------------------------------------------------

// How the ground is authored.
//
// Terrain stamps compose as a LERP CHAIN (sim/world.ts applyStamp): each one
// pulls the running height toward its own delta by its falloff weight, in array
// order. Two facts follow, and they decide the whole shape of this section.
//
//   * A stamp at full weight OVERWRITES what is under it. That makes LAYERS the
//     natural unit: flatten, then terrace, then ridge, then keep, then pit, then
//     the wooded walls, each laid over the last, exactly the order a maker
//     would sculpt them in.
//   * Weight tapers to zero at a stamp's edge, so a plate's APRON is its slope.
//     Sizing the apron sizes the gradient: a rise R over an apron A tops out at
//     1.5*R/A (the smoothstep's steepest point), which is the single number
//     that decides whether a bank can be run up.
//
// Sampling a height function on a fine grid instead would look right in the
// editor and then betray you: overlapping full-weight cores leave a mosaic of
// flat plates with a step at every seam, and a chain of partial weights drifts
// toward whichever stamps happen to come last in the array, which is not
// mirror-symmetric, so one team would get the high ground.

/** A level plate: flat core at `height`, easing to nothing over `apron`. */
interface Plate {
  /** Rect the flat core must cover. */
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  height: number;
  /** Yards the slope off the plate takes. Rise/apron*1.5 is its steepest run. */
  apron: number;
  /** Radius of each stamp's flat core; smaller tracks a rect edge more tightly. */
  core?: number;
}

function plate(p: Plate): HeightStamp[] {
  const core = p.core ?? 13;
  const radius = core + p.apron;
  // Cores must tile the rect: a grid step of core*1.35 keeps every point of the
  // rect inside some core (the worst case is the cell centre, at step/sqrt(2)).
  const step = core * 1.35;
  const cols = Math.max(1, Math.ceil((p.hx * 2) / step));
  const rows = Math.max(1, Math.ceil((p.hz * 2) / step));
  const out: HeightStamp[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        x: p.cx - p.hx + ((c + 0.5) * (p.hx * 2)) / cols,
        z: p.cz - p.hz + ((r + 0.5) * (p.hz * 2)) / rows,
        radius,
        delta: p.height,
        falloff: 'smooth',
        hardness: core / radius,
        mode: 'level',
      });
    }
  }
  return out;
}

/** A level ridge along a straight run, same core/apron contract as a plate. */
function ridgeRun(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  height: number,
  core: number,
  apron: number,
): HeightStamp[] {
  const radius = core + apron;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const count = Math.max(1, Math.ceil(len / (core * 1.35)));
  const out: HeightStamp[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push({
      x: x1 + (x2 - x1) * t,
      z: z1 + (z2 - z1) * t,
      radius,
      delta: height,
      falloff: 'smooth',
      hardness: core / radius,
      mode: 'level',
    });
  }
  return out;
}

/** A stamp's twin under the map's (x, z) -> (-x, -z) mirror. */
function mirrorStamp(s: HeightStamp): HeightStamp {
  return { ...s, x: -s.x, z: -s.z };
}

/**
 * The ground of Thornhollow, as the layers a maker would sculpt.
 *
 * Every layer is authored for the SOUTHERN half (or straddles the origin
 * self-symmetrically) and mirrored, so the two teams fight the same ground.
 * Aprons are sized against PLAYER_MAX_CLIMB_SLOPE (1.5): everything inside the
 * play area runs at well under it, and the wooded walls are far over it.
 */
export function thornhollowStamps(): HeightStamp[] {
  const out: HeightStamp[] = [];

  // 0. Flatten the built-in heightfield away. Every stamp targets 0, so their
  //    overlaps cannot fight and the result is a true zero to build on.
  for (let z = -TH_HALF_Z; z <= TH_HALF_Z; z += 200) {
    for (let x = -TH_HALF_X; x <= TH_HALF_X; x += 200) {
      out.push({ x, z, radius: 220, delta: 0, falloff: 'flat', mode: 'level' });
    }
  }

  const pair = (stamps: HeightStamp[]): void => {
    out.push(...stamps, ...stamps.map(mirrorStamp));
  };

  // 1. The approach shelf: the ravine floor steps up +5 before each keep.
  //    5yd over a 20yd apron = 0.38 rise/run.
  pair(plate({ cx: 0, cz: -138, hx: 88, hz: 44, height: 5, apron: 20, core: 13 }));

  // 2. The flank ridges: the high road down each side, +7 over the floor.
  //    Each run is authored whole and mirrored onto the opposite flank, so the
  //    ORDER bias inside a run mirrors with it.
  pair(ridgeRun(-RIDGE_X, -125, -RIDGE_X, 125, RIDGE_Y, 8, 15));

  // 3. The keep plateaus: +11, flat right out past the curtain so the fortress
  //    seats true on all four sides. 6yd over a 16yd apron = 0.56 up to the gate.
  pair(
    plate({
      cx: 0,
      cz: -158,
      hx: 52,
      hz: 27,
      height: KEEP_TOP_Y,
      apron: 16,
      core: 12,
    }),
  );

  // 4. The Fightpit: one bowl, its own mirror. 9yd over a 22yd apron = 0.61.
  out.push({
    x: 0,
    z: 0,
    radius: PIT_LIP_R,
    delta: PIT_FLOOR_Y,
    falloff: 'smooth',
    hardness: PIT_FLOOR_R / PIT_LIP_R,
    mode: 'level',
  });

  // 5. Rolling relief on the open ground, ADDITIVE so it never levels a layer
  //    under it, and additive stamps sum, so their order cannot bias anything.
  //    Kept clear of the keeps and the pit floor; at 1.5yd over a 20yd reach it
  //    adds 0.11 rise/run, which is texture, not terrain.
  const relief: HeightStamp[] = [];
  const rng = makeRng(0x7401);
  for (let i = 0; i < 30; i++) {
    const x = (rng() * 2 - 1) * 78;
    const z = -rng() * 112;
    if (Math.hypot(x, z) < 58) continue;
    relief.push({
      x,
      z,
      radius: 20,
      delta: (rng() * 2 - 1) * 1.5,
      falloff: 'smooth',
    });
  }
  pair(relief);

  // 6. The wooded walls, laid last so nothing softens them. A stamp reaches its
  //    full RADIUS, so these are deliberately small (core 5, apron 5): the wall
  //    can then stand two yards outside the play area without its slope leaking
  //    into the fight. 30yd over a 5yd apron is 9 rise/run, a cliff, so the
  //    hollow has no way out but its own two keeps. Several parallel lines per
  //    side carry the cores out to the map edge.
  const WOOD_CORE = 5;
  const WOOD_APRON = 5;
  for (const x of [97, 108, TH_HALF_X]) {
    pair(ridgeRun(-x, -TH_HALF_Z, -x, TH_HALF_Z, WOOD_WALL_Y, WOOD_CORE, WOOD_APRON));
  }
  for (const z of [193, 204, 215, TH_HALF_Z]) {
    pair(ridgeRun(-TH_HALF_X, -z, TH_HALF_X, -z, WOOD_WALL_Y, WOOD_CORE, WOOD_APRON));
  }
  return out;
}

// The chain the stamps above evaluate to, so this module can answer "how high
// is the ground at (x, z)" without a live world. Mirrors sim/world.ts
// applyStamp exactly; tests/editor_thornhollow asserts the two agree.
let stampCache: HeightStamp[] | null = null;

/** The hollow's ground height at (x, z), in yards above the ravine floor. */
export function thornhollowHeight(x: number, z: number): number {
  stampCache ??= thornhollowStamps();
  let h = 0;
  for (const e of stampCache) {
    const d = Math.hypot(x - e.x, z - e.z);
    if (d >= e.radius) continue;
    const w = e.falloff === 'flat' ? 1 : terrainBrushWeight(d / e.radius, e.hardness ?? 0);
    if (w <= 0) continue;
    h = e.mode === 'level' ? h + (e.delta - h) * w : h + e.delta * w;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Ground paint
// ---------------------------------------------------------------------------

const PAINT_MEADOW = CUSTOM_PAINT_ID_MIN; // 200
const PAINT_RIDGE = CUSTOM_PAINT_ID_MIN + 1;
const PAINT_PATH = CUSTOM_PAINT_ID_MIN + 2;
const PAINT_KEEP = CUSTOM_PAINT_ID_MIN + 3;
const PAINT_PIT = CUSTOM_PAINT_ID_MIN + 4;
const PAINT_WOOD = CUSTOM_PAINT_ID_MIN + 5;

/** The map's paint palette: built-in PBR sets, so the ground art resolves from
 *  the app bundle on every machine (render/terrain_texture_sets.ts). */
const THORNHOLLOW_SWATCHES: CustomPaintSwatch[] = [
  {
    id: PAINT_MEADOW,
    color: 0x4f6b1c,
    label: 'Hollow Meadow',
    textureSha: 'builtin:Grass002',
    tileSize: 9,
    saved: true,
  },
  {
    id: PAINT_RIDGE,
    color: 0x456624,
    label: 'Ridge Grass',
    textureSha: 'builtin:Grass004',
    tileSize: 11,
    light: -0.08,
    saved: true,
  },
  {
    id: PAINT_PATH,
    color: 0x3a2f24,
    label: 'Trodden Path',
    textureSha: 'builtin:Ground100',
    tileSize: 7,
    light: 0.12,
    saved: true,
  },
  {
    id: PAINT_KEEP,
    color: 0x5a4a3c,
    label: 'Keep Stone',
    textureSha: 'builtin:Rock054',
    tileSize: 6,
    light: -0.05,
    saved: true,
  },
  {
    id: PAINT_PIT,
    color: 0x3c3f37,
    label: 'Fightpit Rock',
    textureSha: 'builtin:Cliff002',
    tileSize: 8,
    saved: true,
  },
  {
    id: PAINT_WOOD,
    color: 0x272018,
    label: 'Forest Loam',
    textureSha: 'builtin:Ground101',
    tileSize: 8,
    light: 0.1,
    saved: true,
  },
];

/** Which swatch paints (x, z). Mirrors the height field's regions so the ground
 *  reads the terrain: stone in the keeps, rock in the pit, loam under the wood. */
function paintAt(x: number, z: number): number {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const r = Math.hypot(x, z);
  if (ax >= TH_PLAY_HALF_X - 2 || az >= TH_PLAY_HALF_Z - 2) return PAINT_WOOD;
  if (r <= PIT_RIM_R + 1) return PAINT_PIT;
  if (az >= KEEP_FRONT_Z - 1 && ax <= KEEP_HALF_X + 1) return PAINT_KEEP;
  // The centre road and the two flank roads: the lanes the fight actually runs.
  if (ax <= 10 && az <= KEEP_FRONT_Z + 4) return PAINT_PATH;
  if (Math.abs(ax - RIDGE_X) <= 9 && az <= 128) return PAINT_PATH;
  if (Math.abs(ax - RIDGE_X) <= RIDGE_HALF && az <= 136) return PAINT_RIDGE;
  return PAINT_MEADOW;
}

const PAINT_CELL = 4;

function thornhollowPaint(): BiomePaint {
  const cols = Math.ceil((TH_HALF_X * 2) / PAINT_CELL);
  const rows = Math.ceil((TH_HALF_Z * 2) / PAINT_CELL);
  const ids: number[] = [];
  for (let r = 0; r < rows; r++) {
    const z = -TH_HALF_Z + (r + 0.5) * PAINT_CELL;
    for (let c = 0; c < cols; c++) {
      ids.push(paintAt(-TH_HALF_X + (c + 0.5) * PAINT_CELL, z));
    }
  }
  return {
    cell: PAINT_CELL,
    cols,
    rows,
    originX: -TH_HALF_X,
    originZ: -TH_HALF_Z,
    ids,
    custom: THORNHOLLOW_SWATCHES,
  };
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

function put(
  assetId: string,
  x: number,
  z: number,
  opts: Partial<MapPlacement> = {},
): MapPlacement {
  return { assetId, x, z, rotY: 0, scale: 1, collide: false, ...opts };
}

/**
 * Make a placement solid off its BAKED BOX SET, the only collision this map
 * uses.
 *
 * 'baked' reads the asset's authored boxes (sim/asset_collision
 * boxesForAssetId, which prefers the Collision Master overrides in
 * data/asset_collision_overrides.json), so a Lock In in the Collision Master
 * scene retunes this map with it. A hand-written `collideRadius` would pin the
 * placement to a plain circle and cut it out of that loop, so nothing here uses
 * one: every asset this map places has a bake, and
 * tests/editor_thornhollow_collision holds that line.
 *
 * `noBakeRadius` is the fallback for an asset that loses its bake, better a
 * sized circle than a solid object you walk through. Reaching it means the
 * asset needs baking (Collision Master, or scripts/gen_collision_overrides).
 */
function solid(assetId: string, noBakeRadius: number): Partial<MapPlacement> {
  const boxes = boxesForAssetId(assetId);
  return boxes && boxes.length > 0
    ? { collide: true, collisionMode: 'baked' }
    : { collide: true, collisionMode: 'basic', collideRadius: noBakeRadius };
}

/**
 * The point mirror every pair in this map is built through: rotating a
 * placement by pi about the origin, so the two halves are identical fights.
 *
 * rotX is negated, rotZ is not, which looks arbitrary and is not. A tilted
 * plane volume's floor is solved by world.groundHeight as
 * `base + lx*uy + lz*wy` off an Euler frame, and running that solve for the
 * yaw-by-pi twin gives, for a plain rotZ tilt, exactly the mirrored slope
 * already (the yaw flips it); for a plain rotX tilt it gives the SAME slope,
 * which on the far side of the map is the wrong way. Left alone, one team's
 * flag podium had a ramp up and the other had the same ramp pointing down off
 * the back of it. tests/editor_thornhollow_keep compares the two keeps'
 * walkable area cell for cell, which is what catches this.
 */
function mirrored(p: MapPlacement): MapPlacement {
  const out: MapPlacement = { ...p, x: -p.x, z: -p.z, rotY: p.rotY + Math.PI };
  if (p.rotX) out.rotX = -p.rotX;
  return out;
}

/**
 * Build one half of the map and get both. `make` receives the SOUTH team's
 * sign (`sz` = -1) so the code reads as "Crimson's side", and the northern
 * half is derived rather than typed twice, the only way the halves can stay
 * in agreement as the layout is tuned.
 */
function bothHalves(make: (sz: -1) => MapPlacement[]): MapPlacement[] {
  const south = make(-1);
  return [...south, ...south.map(mirrored)];
}

/**
 * Freeze a placement to the keep plateau.
 *
 * A grounded placement seats on groundHeight(), and groundHeight() INCLUDES the
 * plane decks, so a curtain wall standing where the rampart passes over it is
 * lifted onto the rampart and becomes a wall across the walk. Every piece of a
 * keep is therefore detached at KEEP_TOP_Y: the plateau is dead flat under all
 * of it (tests/editor_thornhollow proves that), so freezing costs nothing and
 * makes the decks and the masonry independent of each other.
 */
const seated: Partial<MapPlacement> = { detached: true, groundY: KEEP_TOP_Y };

/** A wall run of kit modules between two points, tiled at their true width. */
function wallRun(
  assetId: string,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  opts: {
    scale?: number;
    name?: string;
    collide?: boolean;
    /** Gizmo Y-lift, for a course stacked on the one below it. */
    y?: number;
    /** Freeze to the keep plateau (see `seated`). */
    seat?: boolean;
  } = {},
): MapPlacement[] {
  const scale = opts.scale ?? 2.6;
  // 'dungeon/wall' and its siblings normalize to 2.18yd wide at scale 1
  // (render/asset_scale.ts), so a module spans 2.18 * scale.
  const span = 2.18 * scale;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const count = Math.max(1, Math.round(len / span));
  const rot = Math.atan2(x2 - x1, z2 - z1) + Math.PI / 2;
  const out: MapPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    out.push(
      put(assetId, x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, {
        rotY: rot,
        scale,
        // Stretch the last fraction of a module away rather than leaving a gap.
        scaleX: len / (count * span),
        ...(opts.y !== undefined ? { y: opts.y } : {}),
        ...(opts.seat ? seated : {}),
        // Through solid() like everything else, so the mode is DECLARED rather
        // than left to effectiveCollisionMode's legacy derive: a wall that
        // relies on the derive silently becomes a circle the day anything gives
        // it a radius. Decorative runs (the grave fences) pass collide: false.
        ...(opts.collide === false ? { collide: false } : solid(assetId, Math.max(0.4, span / 2))),
        name: opts.name ?? 'Wall',
      }),
    );
  }
  return out;
}

/** A translucent authoring volume: draggable in the editor, inert in game. */
function anchor(
  kind: 'box' | 'sphere',
  x: number,
  z: number,
  size: { x: number; y: number; z: number },
  name: string,
  regionRole: RegionRole,
): MapPlacement {
  return put(COLLIDER_ASSET_IDS[kind], x, z, {
    sizeX: size.x,
    sizeY: size.y,
    sizeZ: size.z,
    name,
    regionRole,
  });
}

// ---------------------------------------------------------------------------
// Decks: the second storey
// ---------------------------------------------------------------------------

// Two storeys, honestly.
//
// Walkable ground in this engine is a HEIGHTFIELD: world.groundHeight() takes
// the max of the terrain and every 'collider/plane' volume over a point, so a
// point has exactly one floor. A deck therefore does not add a storey over the
// ground it covers, it REPLACES it. Build a balcony out over a room and the
// room's floor rises to the balcony and the room is gone.
//
// So the keeps are two storeys the way a real castle is: the upper floor runs
// along the TOP OF THE CURTAIN WALL, over ground nobody could stand on anyway,
// and reaches the courtyard only by its stairs. Every deck below sits inside
// the wall's own footprint, and every deck run BREAKS at each gate and sally
// port, a deck laid across a doorway would lift whoever walked through it
// five yards into the air. tests/editor_thornhollow_keep flood-fills the
// finished surface and holds both rules.

/** Yards of deck the flood-fill test walks on; also the tiling step of the
 *  wooden boards laid over each deck. */
const DECK_TILE = 4.4;

/** A flat walkable deck: `height` yards over the plateau, footprint w x d. */
function deck(
  x: number,
  z: number,
  w: number,
  d: number,
  height: number,
  name: string,
  groundY = KEEP_TOP_Y,
): MapPlacement {
  return put(COLLIDER_ASSET_IDS.plane, x, z, {
    // A plane's sizeY is a floor OFFSET and is deliberately NOT scaled, so the
    // Scale tool widens a deck without also lifting it (collider_volumes.ts).
    sizeX: w,
    sizeY: height,
    sizeZ: d,
    collide: true,
    // Frozen to the plateau rather than sampled live, so a later terrain tweak
    // under the keep cannot silently tilt the rampart.
    detached: true,
    groundY,
    // A BLOCKING collider volume is hidden chrome everywhere in this editor
    // (tests/editor_shipped_maps holds the rule): the translucent authoring
    // slab would otherwise sit in the viewport on top of the boards that show
    // where the deck actually is. Editor-only, it still carries the floor in
    // playtest and export, and the Scene Collection eyeball brings it back.
    hidden: true,
    name,
  });
}

/**
 * A sloped walkable deck climbing `rise` over `run` horizontal yards.
 *
 * `axis` is the world axis the climb runs along and `dir` which way is UP, so
 * ('x', -1) reads "climbs toward -x". The tilt goes on rotX/rotZ, the only
 * rotations a plane volume keeps (box and sphere volumes drop theirs), and the
 * along-slope size is the hypotenuse so the FOOTPRINT still spans `run`.
 */
function rampDeck(
  x: number,
  z: number,
  width: number,
  run: number,
  loY: number,
  hiY: number,
  axis: 'x' | 'z',
  dir: -1 | 1,
  name: string,
  groundY = KEEP_TOP_Y,
): MapPlacement {
  const rise = hiY - loY;
  const a = Math.atan2(rise, run);
  const along = run / Math.cos(a);
  // world.groundHeight solves the tilted plane as floor = base + lx*uy + lz*wy;
  // with a single tilt that reduces to base + (world offset) * tan(a), rising
  // toward +x for rotZ > 0 and toward -z for rotX > 0.
  const tilt = axis === 'x' ? { rotZ: dir * a } : { rotX: -dir * a };
  return put(COLLIDER_ASSET_IDS.plane, x, z, {
    sizeX: axis === 'x' ? along : width,
    sizeY: (loY + hiY) / 2 - groundY,
    sizeZ: axis === 'x' ? width : along,
    collide: true,
    detached: true,
    groundY,
    hidden: true, // blocking volume = hidden chrome; see deck()
    ...tilt,
    name,
  });
}

/** The boards a maker sees standing on a deck: plain tiles, never solid (the
 *  plane under them is the floor, and a second collider would fight it). */
function deckBoards(
  x: number,
  z: number,
  w: number,
  d: number,
  height: number,
  assetId = 'dungeon/floor_wood_large',
): MapPlacement[] {
  const out: MapPlacement[] = [];
  const cols = Math.max(1, Math.round(w / DECK_TILE));
  const rows = Math.max(1, Math.round(d / DECK_TILE));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push(
        put(assetId, x - w / 2 + ((c + 0.5) * w) / cols, z - d / 2 + ((r + 0.5) * d) / rows, {
          // The tile normalizes to 2.2yd, so this seats it edge to edge.
          scale: (Math.max(w / cols, d / rows) / 2.2) * 1.02,
          y: height,
          ...seated,
          name: 'Rampart boards',
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Game-mode anchors: flags, respawn rings, banners, graveyards, rune pads
// ---------------------------------------------------------------------------

const FLAG_ASSET = ['dungeon/banner_triple_red', 'dungeon/banner_triple_blue'] as const;
const BANNER_ASSET = ['dungeon/banner_shield_red', 'dungeon/banner_shield_blue'] as const;

/** Each team's five respawn spots, on the field side of its own gate. */
function spawnRing(sz: -1 | 1): { x: number; z: number }[] {
  return [
    { x: 0, z: sz * 128 },
    { x: -9, z: sz * 130 },
    { x: 9, z: sz * 130 },
    { x: -4.5, z: sz * 125 },
    { x: 4.5, z: sz * 125 },
  ];
}

/** Graveyard plot centre: outside its own keep, on that team's flank. */
function graveyardAt(sz: -1 | 1): { x: number; z: number } {
  return { x: sz * 52, z: sz * 118 };
}

/** Sprint pads: the keep approaches, both ridge crowns, and the two lanes that
 *  feed the Fightpit's side gaps. Six, so the map always has a run on offer. */
export const TH_SPEED_RUNES: { x: number; z: number }[] = [
  { x: 0, z: -108 },
  { x: 0, z: 108 },
  { x: -RIDGE_X, z: 0 },
  { x: RIDGE_X, z: 0 },
  { x: -34, z: -74 },
  { x: 34, z: 74 },
];

/** Power pads: the contested ground. One pair on the Fightpit lip and one pair
 *  out on the flank lanes, so holding both means splitting the team. */
export const TH_POWER_RUNES: { x: number; z: number }[] = [
  { x: 31, z: -52 },
  { x: -31, z: 52 },
  { x: -RIDGE_X + 4, z: -96 },
  { x: RIDGE_X - 4, z: 96 },
];

function anchorPlacements(): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (const team of [0, 1] as Team[]) {
    const sz = team === 0 ? -1 : 1;
    const side = TH_TEAM_NAMES[team];
    out.push(
      put(FLAG_ASSET[team], 0, sz * TH_FLAG_Z, {
        rotY: team === 0 ? 0 : Math.PI,
        scale: 2.1,
        // On top of the podium deck, which is what makes taking a flag a climb.
        y: PODIUM_Y,
        name: `${side} flag`,
        regionRole: team === 0 ? 'flag0' : 'flag1',
      }),
      put(BANNER_ASSET[team], 0, sz * (KEEP_FRONT_Z - 4), {
        rotY: team === 0 ? 0 : Math.PI,
        scale: 1.7,
        name: `${side} spawn banner`,
        regionRole: team === 0 ? 'banner0' : 'banner1',
      }),
    );
    spawnRing(sz).forEach((spot, i) => {
      out.push(
        anchor(
          'sphere',
          spot.x,
          spot.z,
          { x: 2, y: 2, z: 2 },
          `${side} spawn ${i + 1}`,
          team === 0 ? 'spawn0' : 'spawn1',
        ),
      );
    });
    const plot = graveyardAt(sz);
    out.push(
      anchor(
        'box',
        plot.x,
        plot.z,
        { x: 18, y: 4, z: 14 },
        `${side} graveyard`,
        team === 0 ? 'graveyard0' : 'graveyard1',
      ),
    );
  }
  for (const rune of TH_SPEED_RUNES) {
    out.push(anchor('box', rune.x, rune.z, { x: 3, y: 0.4, z: 3 }, 'Sprint rune', 'speedRune'));
  }
  for (const rune of TH_POWER_RUNES) {
    out.push(anchor('box', rune.x, rune.z, { x: 3, y: 0.4, z: 3 }, 'Power rune', 'powerRune'));
  }
  return out;
}

/** The visible pad under each rune anchor, so a maker sees where the buff is. */
function runeDressing(): MapPlacement[] {
  const out: MapPlacement[] = [];
  for (const [i, rune] of [...TH_SPEED_RUNES, ...TH_POWER_RUNES].entries()) {
    out.push(
      put('dungeon/floor_tile_small_decorated', rune.x, rune.z, {
        scale: 2.6,
        rotY: i * 0.7,
        name: 'Rune pad',
      }),
      put('dungeon/path_a', rune.x, rune.z, {
        scale: 1.9,
        y: 0.12,
        name: 'Rune glyph',
      }),
    );
  }
  return out;
}

/**
 * Supply caches: the crates a fight actually forms around.
 *
 * Four mirrored pairs plus the pit's own, each a knot of hard cover you can
 * break a sightline behind and a landmark to call a rotate to. They are solid
 * scenery, not pickups, the buffs are the rune pads above.
 */
function supplyCache(x: number, z: number, seed: number, label: string): MapPlacement[] {
  const rng = makeRng(seed);
  const out: MapPlacement[] = [
    put('dungeon/crates_stacked', x, z, {
      scale: 2.1,
      rotY: rng() * Math.PI,
      ...solid('dungeon/crates_stacked', 1.4),
      name: `${label} crates`,
    }),
    put('dungeon/crate_large', x + 3.4, z - 1.6, {
      scale: 2,
      rotY: rng() * Math.PI,
      ...solid('dungeon/crate_large', 1.3),
      name: `${label} crate`,
    }),
    put('dungeon/crate_small', x - 2.9, z + 2.4, {
      scale: 1.9,
      rotY: rng() * Math.PI,
      ...solid('dungeon/crate_small', 1.1),
      name: `${label} crate`,
    }),
    put('dungeon/barrel_large', x - 3.6, z - 2.6, {
      scale: 1.6,
      ...solid('dungeon/barrel_large', 1.2),
      name: `${label} barrel`,
    }),
    put('dungeon/chest_large', x + 1.2, z + 3.2, {
      scale: 1.8,
      rotY: rng() * Math.PI,
      ...solid('dungeon/chest_large', 1.2),
      name: `${label} supply chest`,
    }),
    put('props/crate_wooden', x + 4.2, z + 2.8, {
      scale: 1.5,
      rotY: rng() * Math.PI,
      ...solid('props/crate_wooden', 1.2),
      name: `${label} crate`,
    }),
  ];
  return out;
}

function supplyCaches(): MapPlacement[] {
  const out: MapPlacement[] = [];
  // Mirrored pairs: mid lane, flank lane, keep approach, ridge shoulder.
  const spots: { x: number; z: number; label: string }[] = [
    { x: -26, z: -62, label: 'Lane' },
    { x: 44, z: -88, label: 'Flank' },
    { x: -12, z: -116, label: 'Approach' },
    { x: RIDGE_X - 10, z: -34, label: 'Ridge' },
  ];
  spots.forEach((s, i) => {
    const half = supplyCache(s.x, s.z, 0xca5e + i, s.label);
    out.push(...half, ...half.map(mirrored));
  });
  // The pit's own cache, on the origin's mirror line so it belongs to nobody.
  out.push(
    put('dungeon/crates_stacked', -6, 11, {
      scale: 2.2,
      rotY: 0.6,
      ...solid('dungeon/crates_stacked', 1.4),
      name: 'Pit crates',
    }),
    put('dungeon/crates_stacked', 6, -11, {
      scale: 2.2,
      rotY: 0.6 + Math.PI,
      ...solid('dungeon/crates_stacked', 1.4),
      name: 'Pit crates',
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// The keeps
// ---------------------------------------------------------------------------

/**
 * The curtain: two parallel wall lines CURTAIN_INSET apart, so the rampart on
 * top has real thickness under it instead of hovering over a single course.
 *
 * `gapsX` / `gapsZ` are the openings, the main gate and the two sally ports.
 * Both wall lines and the rampart deck break at exactly the same intervals,
 * which is the whole trick: a deck laid over a doorway raises the ground the
 * doorway is for.
 */
interface Opening {
  /** Centre of the opening along the wall's own axis, and its half width. */
  at: number;
  half: number;
}

/** Emit a wall line along one axis, skipping each opening. */
function wallLine(
  axis: 'x' | 'z',
  fixed: number,
  from: number,
  to: number,
  openings: Opening[],
  opts: {
    scale?: number;
    name?: string;
    y?: number;
    assetId?: string;
    seat?: boolean;
  } = {},
): MapPlacement[] {
  const id = opts.assetId ?? 'dungeon/wall';
  const cuts = [...openings].sort((a, b) => a.at - b.at);
  const out: MapPlacement[] = [];
  let cursor = Math.min(from, to);
  const end = Math.max(from, to);
  const seg = (a: number, b: number): void => {
    if (b - a < 1.2) return;
    if (axis === 'x') out.push(...wallRun(id, a, fixed, b, fixed, opts));
    else out.push(...wallRun(id, fixed, a, fixed, b, opts));
  };
  for (const c of cuts) {
    seg(cursor, c.at - c.half);
    cursor = Math.max(cursor, c.at + c.half);
  }
  seg(cursor, end);
  return out;
}

/**
 * One team's fortress. Everything is authored in Crimson's frame (sz = -1) and
 * point-mirrored for Azure, so the two keeps are the same fight.
 *
 * Ground floor: a gate, two sally ports, and a maze of inner walls between them
 * and the flag court, so the last thirty yards is a series of choices rather
 * than a sprint. Upper floor: the rampart, reached by four stairs, overlooking
 * every one of those choices, which is the team play. One defender up there
 * calling and shooting is worth two in the maze.
 */
function keep(sz: -1): MapPlacement[] {
  const out: MapPlacement[] = [];
  const back = sz * KEEP_BACK_Z;
  const front = sz * KEEP_FRONT_Z;
  const innerBack = sz * (KEEP_BACK_Z - CURTAIN_INSET);
  const innerFront = sz * (KEEP_FRONT_Z + CURTAIN_INSET);
  const outerX = KEEP_HALF_X;
  const innerX = KEEP_HALF_X - CURTAIN_INSET;

  // -- the curtain ---------------------------------------------------------
  const GATE_HALF = 6; // the main gate, dead centre of the front wall
  const PORT_Z = sz * 158; // the sally port in each side wall
  const PORT_HALF = 5;
  const gate: Opening[] = [{ at: 0, half: GATE_HALF }];
  const port: Opening[] = [{ at: PORT_Z, half: PORT_HALF }];

  for (const line of [
    { z: front, openings: gate },
    { z: innerFront, openings: gate },
    { z: back, openings: [] as Opening[] },
    { z: innerBack, openings: [] as Opening[] },
  ]) {
    out.push(
      ...wallLine('x', line.z, -outerX, outerX, line.openings, {
        name: 'Curtain wall',
        seat: true,
      }),
    );
  }
  for (const sx of [-1, 1]) {
    for (const x of [sx * outerX, sx * innerX]) {
      out.push(
        ...wallLine('z', x, sz * KEEP_FRONT_Z, sz * KEEP_BACK_Z, port, {
          name: 'Curtain wall',
          seat: true,
        }),
      );
    }
  }

  // The parapet: a battlement course standing on the OUTER line at rampart
  // height, so the walk has hard cover on its outward side and a clean drop on
  // its inward one. Same openings, so it never roofs a doorway either.
  const parapet = {
    scale: 2.6,
    y: RAMPART_Y,
    name: 'Parapet',
    assetId: 'dungeon/barrier',
    seat: true,
  };
  out.push(
    ...wallLine('x', front, -outerX, outerX, gate, parapet),
    ...wallLine('x', back, -outerX, outerX, [], parapet),
  );
  for (const sx of [-1, 1]) {
    out.push(...wallLine('z', sx * outerX, sz * KEEP_FRONT_Z, sz * KEEP_BACK_Z, port, parapet));
  }

  // -- the gate and the sally ports ----------------------------------------
  // NOT dungeon/arch_gate: that model is a gate with its DOOR SHUT, and its
  // bake says so, a slab across the middle of the opening. It reads as a gate
  // in the asset browser and walls the keep up in play. The plain stone arch
  // bakes two jambs and a lintel, so the span between them is genuinely open
  // and the lintel passes overhead (colliders.ts passesUnder).
  for (const z of [front, innerFront]) {
    out.push(
      put('biome/dungeon_arch_stone', 0, z, {
        scale: 6,
        ...seated,
        ...solid('biome/dungeon_arch_stone', 1.6),
        name: 'Keep gate',
      }),
    );
  }
  for (const sx of [-1, 1]) {
    out.push(
      put('biome/dungeon_arch_stone', sx * outerX, PORT_Z, {
        rotY: Math.PI / 2,
        scale: 3.6,
        ...seated,
        ...solid('biome/dungeon_arch_stone', 1.5),
        name: 'Sally port',
      }),
      put('biome/dungeon_arch_stone', sx * innerX, PORT_Z, {
        rotY: Math.PI / 2,
        scale: 3.6,
        ...seated,
        ...solid('biome/dungeon_arch_stone', 1.5),
        name: 'Sally port',
      }),
      // Corner towers, one at each end of the curtain.
      put('city/wall_tower', sx * outerX, front, {
        scale: 1.6,
        ...seated,
        rotY: sx > 0 ? Math.PI / 2 : -Math.PI / 2,
        ...solid('city/wall_tower', 4.2),
        name: 'Keep tower',
      }),
      put('city/wall_tower', sx * outerX, back, {
        scale: 1.6,
        ...seated,
        rotY: sx > 0 ? Math.PI / 2 : -Math.PI / 2,
        ...solid('city/wall_tower', 4.2),
        name: 'Keep tower',
      }),
    );
  }
  return out;
}

/**
 * The rampart: the keep's upper floor.
 *
 * A ring of decks laid along the middle of the curtain, outer line at
 * KEEP_HALF_X, inner at KEEP_HALF_X - CURTAIN_INSET, so the walk sits between
 * the two courses and never overhangs the courtyard. It BREAKS at the gate and
 * at both sally ports (see the Decks note), which is why the ring is authored
 * as six runs instead of four.
 */
function keepRampart(sz: -1): MapPlacement[] {
  const out: MapPlacement[] = [];
  const mid = KEEP_HALF_X - CURTAIN_INSET / 2; // centreline between the courses
  const frontMid = sz * (KEEP_FRONT_Z + CURTAIN_INSET / 2);
  const backMid = sz * (KEEP_BACK_Z - CURTAIN_INSET / 2);
  const GATE_HALF = 6;
  const PORT_Z = sz * 158;
  const PORT_HALF = 5;

  // Front runs, one either side of the gate; they reach out to the side walls
  // so the corners overlap and the ring is continuous to walk around.
  for (const sx of [-1, 1]) {
    const x0 = sx * (mid + CURTAIN_INSET / 2);
    const x1 = sx * GATE_HALF;
    out.push(
      deck((x0 + x1) / 2, frontMid, Math.abs(x0 - x1), DECK_W, RAMPART_Y, 'Rampart'),
      ...deckBoards((x0 + x1) / 2, frontMid, Math.abs(x0 - x1), DECK_W, RAMPART_Y),
    );
  }
  // Back run, unbroken.
  out.push(
    deck(0, backMid, (mid + CURTAIN_INSET / 2) * 2, DECK_W, RAMPART_Y, 'Rampart'),
    ...deckBoards(0, backMid, (mid + CURTAIN_INSET / 2) * 2, DECK_W, RAMPART_Y),
  );
  // Side runs, split at each sally port.
  for (const sx of [-1, 1]) {
    for (const span of [
      { a: sz * KEEP_FRONT_Z, b: PORT_Z - sz * PORT_HALF },
      { a: PORT_Z + sz * PORT_HALF, b: sz * KEEP_BACK_Z },
    ]) {
      const cz = (span.a + span.b) / 2;
      const d = Math.abs(span.a - span.b);
      out.push(
        deck(sx * mid, cz, DECK_W, d, RAMPART_Y, 'Rampart'),
        ...deckBoards(sx * mid, cz, DECK_W, d, RAMPART_Y),
      );
    }
  }

  // -- the four stairs -----------------------------------------------------
  // Each climbs from the courtyard floor straight at the side wall. Its
  // footprint is a stair: the ground under it rises with it, which is what a
  // stair is. The inner curtain is solid up to the rampart height across its
  // whole depth (dungeon/wall bakes 0.191 deep either side of its line at
  // scale 1, so 0.5 yd at 2.6), so a flight that only topped out at the deck's
  // edge would still be under the wall top where a body first brushes the
  // wall's inner face, and the climb would stall at that lip. So each flight
  // tops out one body clear of that face and a flat landing at rampart height
  // carries the walk across the wall onto the side run.
  const STAIR_W = 5;
  const STAIR_RUN = 12;
  const WALL_HALF_D = 0.5; // the curtain module's half depth at scale 2.6
  const STAIR_CLEAR = 0.6; // past PLAYER_BODY_RADIUS (0.5)
  const deckEdgeX = mid - DECK_W / 2; // the side run's inner edge
  const topX = KEEP_HALF_X - CURTAIN_INSET - WALL_HALF_D - STAIR_CLEAR; // the flight's head
  const landW = deckEdgeX + 0.5 - topX; // overlapping the side run by half a yard
  for (const sx of [-1, 1]) {
    for (const cz of [sz * 146, sz * 170]) {
      const cx = sx * (topX - STAIR_RUN / 2);
      out.push(
        deck(sx * (topX + landW / 2), cz, landW, STAIR_W, RAMPART_Y, 'Rampart landing'),
        put('dungeon/floor_wood_large', sx * (topX + landW / 2), cz, {
          scale: (STAIR_W / 2.2) * 1.02,
          scaleX: landW / STAIR_W,
          y: RAMPART_Y,
          ...seated,
          name: 'Stair landing',
        }),
      );
      out.push(
        rampDeck(
          cx,
          cz,
          STAIR_W,
          STAIR_RUN,
          KEEP_TOP_Y,
          KEEP_TOP_Y + RAMPART_Y,
          'x',
          sx > 0 ? 1 : -1,
          'Rampart stair',
        ),
      );
      // The flight a maker sees, laid on the slope the deck actually is.
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        out.push(
          put('dungeon/floor_wood_large', sx * (topX - STAIR_RUN + t * STAIR_RUN), cz, {
            scale: (STAIR_W / 2.2) * 1.02,
            scaleZ: 1,
            y: RAMPART_Y * t,
            ...seated,
            name: 'Stair tread',
          }),
        );
      }
    }
  }

  // The inner railing, broken where the stairs land so you can get on and off,
  // and broken again at two drop-downs per side, the rampart's fast way back
  // into the fight.
  const railGaps: Opening[] = [
    { at: sz * 146, half: 4 },
    { at: sz * 170, half: 4 },
    { at: sz * 158, half: 6 },
    { at: sz * 138, half: 3.5 },
  ];
  for (const sx of [-1, 1]) {
    // Stops short of both corners on purpose. A rail carried the full length of
    // the side would stand exactly across the square where the side deck and
    // the front/back deck overlap, which is the ONLY way round the ring, so
    // the rampart would come apart into four balconies. The bare corners are
    // also the walk's other drop-downs.
    out.push(
      ...wallLine(
        'z',
        sx * (mid - DECK_W / 2),
        sz * (KEEP_FRONT_Z + DECK_W + 1.5),
        sz * (KEEP_BACK_Z - DECK_W - 1.5),
        railGaps,
        {
          scale: 2.2,
          y: RAMPART_Y,
          name: 'Rampart rail',
          assetId: 'dungeon/barrier',
          seat: true,
        },
      ),
    );
  }
  return out;
}

/**
 * The flag court: the walled hall at the back of the keep, with the flag on a
 * podium in the middle of it.
 *
 * Three ways in (a front door and one in each side wall) so a carrier is never
 * cornered by a single body in a single doorway, and three ways up onto the
 * podium for the same reason. The court is open to the sky on purpose, the
 * rampart looks down into it, which is what makes holding the rampart worth a
 * player.
 */
function flagCourt(sz: -1): MapPlacement[] {
  const out: MapPlacement[] = [];
  const front = sz * HALL_FRONT_Z;
  const back = sz * HALL_BACK_Z;
  const doorZ = sz * 167;
  out.push(
    ...wallLine('x', front, -HALL_HALF_X, HALL_HALF_X, [{ at: 0, half: 4.5 }], {
      name: 'Court wall',
      seat: true,
    }),
    ...wallLine('x', back, -HALL_HALF_X, HALL_HALF_X, [], {
      name: 'Court wall',
      seat: true,
    }),
  );
  for (const sx of [-1, 1]) {
    out.push(
      ...wallLine('z', sx * HALL_HALF_X, front, back, [{ at: doorZ, half: 4.5 }], {
        name: 'Court wall',
        seat: true,
      }),
      put('biome/dungeon_arch_stone', sx * HALL_HALF_X, doorZ, {
        rotY: Math.PI / 2,
        scale: 3.4,
        ...seated,
        ...solid('biome/dungeon_arch_stone', 1.5),
        name: 'Court door',
      }),
    );
  }
  out.push(
    put('dungeon/arch', 0, front, {
      scale: 4.4,
      ...seated,
      ...solid('dungeon/arch', 1.5),
      name: 'Court door',
    }),
  );

  // -- the podium ----------------------------------------------------------
  const pz = sz * TH_FLAG_Z;
  out.push(
    deck(0, pz, PODIUM_HALF * 2, PODIUM_HALF * 2, PODIUM_Y, 'Flag podium'),
    ...deckBoards(0, pz, PODIUM_HALF * 2, PODIUM_HALF * 2, PODIUM_Y, 'dungeon/floor_tile_large'),
    put('dungeon/floor_foundation_allsides', 0, pz, {
      scale: 2.4,
      scaleY: 0.3,
      y: PODIUM_Y,
      ...seated,
      name: 'Flag plinth',
    }),
  );
  // Three ramps up: one facing the door, one on each side.
  const RAMP_RUN = 5;
  out.push(
    // Minus sz: the ramp faces the court DOOR, which is on the field side of
    // the podium, not the back wall behind it.
    rampDeck(
      0,
      pz - sz * (PODIUM_HALF + RAMP_RUN / 2),
      6,
      RAMP_RUN,
      KEEP_TOP_Y,
      KEEP_TOP_Y + PODIUM_Y,
      'z',
      sz > 0 ? 1 : -1,
      'Podium ramp',
    ),
  );
  for (const sx of [-1, 1]) {
    out.push(
      rampDeck(
        sx * (PODIUM_HALF + RAMP_RUN / 2),
        pz,
        6,
        RAMP_RUN,
        KEEP_TOP_Y,
        KEEP_TOP_Y + PODIUM_Y,
        'x',
        sx > 0 ? -1 : 1,
        'Podium ramp',
      ),
    );
  }
  // Court dressing: the standard's lanterns, the braziers that light the fight.
  out.push(
    put('dungeon/lantern_standing', -PODIUM_HALF - 1.5, pz, {
      scale: 1.7,
      ...seated,
      ...solid('dungeon/lantern_standing', 0.8),
      name: 'Flag lantern',
    }),
    put('dungeon/lantern_standing', PODIUM_HALF + 1.5, pz, {
      scale: 1.7,
      ...seated,
      ...solid('dungeon/lantern_standing', 0.8),
      name: 'Flag lantern',
    }),
    put('props/bonfire', -HALL_HALF_X + 5, back - sz * 4, {
      scale: 1.6,
      ...seated,
      name: 'Court brazier',
    }),
    put('props/bonfire', HALL_HALF_X - 5, back - sz * 4, {
      scale: 1.6,
      ...seated,
      name: 'Court brazier',
    }),
  );
  for (const bx of [-14, 14]) {
    out.push(
      put('dungeon/banner_patterna_white', bx, back - sz * 1.2, {
        rotY: sz < 0 ? 0 : Math.PI,
        scale: 2.4,
        y: 2.2,
        ...seated,
        name: 'Court banner',
      }),
    );
  }
  return out;
}

/**
 * The courtyard maze: the ground floor between the gate and the flag court.
 *
 * Three routes, all of them crossing: straight up the middle past a barbican
 * that splits you left or right, or in through either sally port and along a
 * flank. Every run has a way out sideways, so the maze is a series of reads
 * rather than a corridor you die in.
 */
function keepMaze(sz: -1): MapPlacement[] {
  const out: MapPlacement[] = [];
  const w = (x1: number, z1: number, x2: number, z2: number, name = 'Inner wall'): MapPlacement[] =>
    wallRun('dungeon/wall', x1, sz * z1, x2, sz * z2, {
      scale: 2.4,
      name,
      seat: true,
    });

  out.push(
    // The barbican: a screen five yards inside the gate. You cannot see the
    // court from the gate, and you cannot run at it straight.
    ...w(-10, 146, 10, 146, 'Barbican'),
    ...w(-10, 146, -10, 141, 'Barbican'),
    ...w(10, 146, 10, 141, 'Barbican'),
    // Two spurs off the front curtain, cutting the courtyard into three slots.
    ...w(-24, 140, -24, 149),
    ...w(24, 140, 24, 149),
    // The cross wall, with a gap on each flank: the second read.
    ...w(-38, 152, -16, 152),
    ...w(16, 152, 38, 152),
    // The sally-port pockets: coming in the side does not open onto the court
    // door either, it opens onto this.
    ...w(-38, 163, -27, 163),
    ...w(38, 163, 27, 163),
    ...w(-27, 163, -27, 172),
    ...w(27, 163, 27, 172),
  );

  // Hard cover in the slots, so the maze has things to fight around and not
  // just walls to run along.
  const rng = makeRng(sz < 0 ? 0x3a11 : 0x3a12);
  const cover: { x: number; z: number }[] = [
    { x: -32, z: 144 },
    { x: 32, z: 144 },
    { x: -17, z: 157 },
    { x: 17, z: 157 },
    { x: 0, z: 152 },
    { x: -34, z: 174 },
    { x: 34, z: 174 },
  ];
  for (const [i, c] of cover.entries()) {
    const id = i % 2 === 0 ? 'dungeon/crates_stacked' : 'dungeon/barrel_small_stack';
    out.push(
      put(id, c.x, sz * c.z, {
        scale: 1.9 + rng() * 0.4,
        rotY: rng() * Math.PI,
        ...seated,
        ...solid(id, 1.3),
        name: 'Court stores',
      }),
    );
  }
  // Pillars along the middle slot: cover you can round without losing speed.
  for (const px of [-6, 6]) {
    for (const pz of [150, 156]) {
      out.push(
        put('dungeon/pillar', px, sz * pz, {
          scale: 2.4,
          ...seated,
          ...solid('dungeon/pillar', 0.9),
          name: 'Court pillar',
        }),
      );
    }
  }
  // The quartermaster's corner and the muster fire, behind the gate.
  out.push(
    put('props/weapon_stand', -20, sz * 143, {
      scale: 1.8,
      ...seated,
      ...solid('props/weapon_stand', 1.2),
      name: 'Arms rack',
    }),
    put('props/weapon_stand', 20, sz * 143, {
      scale: 1.8,
      ...seated,
      ...solid('props/weapon_stand', 1.2),
      name: 'Arms rack',
    }),
    put('biome/camp_fire_pit', 0, sz * 141, {
      scale: 1.8,
      ...seated,
      name: 'Muster fire',
    }),
    put('props/tent_open', -33, sz * 139, {
      scale: 2.6,
      rotY: 0.4,
      ...seated,
      name: 'Muster tent',
    }),
    put('props/tent_open', 33, sz * 139, {
      scale: 2.6,
      rotY: -0.4,
      ...seated,
      name: 'Muster tent',
    }),
    put('props/timber_pillar', -14, sz * 139, {
      scale: 2.2,
      ...seated,
      ...solid('props/timber_pillar', 1.2),
      name: 'Post',
    }),
    put('props/timber_pillar', 14, sz * 139, {
      scale: 2.2,
      ...seated,
      ...solid('props/timber_pillar', 1.2),
      name: 'Post',
    }),
  );
  // Torches up the inner curtain, so the maze reads at night.
  for (const sx of [-1, 1]) {
    for (const tz of [142, 154, 166, 178]) {
      out.push(
        put('dungeon/torch_mounted', sx * (KEEP_HALF_X - CURTAIN_INSET - 0.9), sz * tz, {
          rotY: sx > 0 ? -Math.PI / 2 : Math.PI / 2,
          scale: 2,
          y: 3.4,
          ...seated,
          name: 'Wall torch',
        }),
      );
    }
  }
  return out;
}

/** The graveyard each team releases its spirits at: a fenced plot on the rise
 *  outside its own keep, walled off from the lane by a low crumbled run. */
function graveyard(sz: -1): MapPlacement[] {
  const { x: cx, z: cz } = graveyardAt(sz);
  const out: MapPlacement[] = [
    ...wallRun('dungeon/fence_broken', cx - 9, cz - 7, cx + 9, cz - 7, {
      scale: 2,
      name: 'Grave fence',
      collide: false,
    }),
    ...wallRun('dungeon/fence_broken', cx - 9, cz + 7, cx + 9, cz + 7, {
      scale: 2,
      name: 'Grave fence',
      collide: false,
    }),
    put('dungeon/fence_gate', cx, cz - 7, {
      scale: 2.2,
      ...solid('dungeon/fence_gate', 1.2),
      name: 'Grave gate',
    }),
    put('props/gravestone_cross', cx, cz + 3.5, {
      scale: 2.4,
      ...solid('props/gravestone_cross', 1.2),
      name: 'Great cross',
    }),
    put('dungeon/post_lantern', cx - 8, cz - 6, {
      scale: 2,
      ...solid('dungeon/post_lantern', 0.7),
      name: 'Grave lantern',
    }),
    put('dungeon/post_lantern', cx + 8, cz - 6, {
      scale: 2,
      ...solid('dungeon/post_lantern', 0.7),
      name: 'Grave lantern',
    }),
  ];
  const graves = ['dungeon/grave_a', 'dungeon/gravestone', 'dungeon/gravemarker_b'];
  const rng = makeRng(sz < 0 ? 0x7a1c : 0x7a1d);
  for (let i = 0; i < 10; i++) {
    const gx = cx - 7 + (i % 5) * 3.5;
    const gz = cz - 3 + Math.floor(i / 5) * 5;
    const grave = graves[i % graves.length];
    out.push(
      put(grave, gx, gz, {
        scale: 1.5 + rng() * 0.3,
        rotY: (rng() - 0.5) * 0.5,
        ...solid(grave, 1.2),
        name: 'Grave',
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// The Fightpit
// ---------------------------------------------------------------------------

/**
 * The bowl in the middle of the hollow. The TERRAIN is a walkable dish (its
 * steepest run is 0.61 rise/run, well under the 1.5 climb limit); what makes it
 * a pit is the ring of broken stone standing on its lip, cut by four gaps on
 * the cardinal lanes, so you commit to a known entrance to drop in, and you
 * fight your way back out of one.
 */
function fightpit(): MapPlacement[] {
  const GAP = 0.3; // radians of open lane at each of the four cardinal gaps
  const SEGMENTS = 48;
  const rng = makeRng(0x1eed);
  // Only the southern half of the ring is authored; the north is its mirror,
  // so the two teams drop into the same pit from the same distance.
  const half: MapPlacement[] = [];
  for (let i = 0; i < SEGMENTS / 2; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    // Skip the four cardinal gaps: the pit's ways in and out.
    const nearCardinal = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].some((c) => {
      const d = Math.abs(((a - c + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      return d < GAP;
    });
    if (nearCardinal) continue;
    const heavy = i % 3 === 0;
    half.push(
      put(
        heavy ? 'props/rock_tall_a' : 'foliage/rock_2',
        Math.cos(a) * PIT_RIM_R,
        Math.sin(a) * PIT_RIM_R,
        {
          rotY: a + rng() * 0.6,
          scale: (heavy ? 2.6 + rng() * 0.7 : 3.4 + rng() * 1.2) * ROCK_UP,
          ...solid(heavy ? 'props/rock_tall_a' : 'foliage/rock_2', heavy ? 3.1 : 3.6),
          name: 'Pit rim',
        },
      ),
    );
  }
  // Two gate stones flanking each gap, so the entrances read as entrances.
  for (const a of [0, Math.PI / 2]) {
    for (const s of [-1, 1]) {
      const g = a + s * (GAP + 0.1);
      half.push(
        put('props/column_broken', Math.cos(g) * PIT_RIM_R, Math.sin(g) * PIT_RIM_R, {
          scale: 3.2,
          rotY: g,
          ...solid('props/column_broken', 1.5),
          name: 'Pit gate stone',
        }),
      );
    }
  }

  // The floor of the pit: cover to break the sightlines, and the bones of
  // everyone who has settled an argument down here.
  half.push(
    put('dungeon/rubble_large', -9, 5, {
      scale: 2.8,
      ...solid('dungeon/rubble_large', 1.2),
      name: 'Rubble',
    }),
    put('dungeon/rubble_half', 5.5, 10, {
      scale: 2.4,
      ...solid('dungeon/rubble_half', 1.2),
      name: 'Rubble',
    }),
    put('props/column_broken', -13, -7, {
      scale: 3,
      ...solid('props/column_broken', 1.2),
      name: 'Broken column',
    }),
    put('props/rock_large_d', 12, 6, {
      scale: 3.2,
      ...solid('props/rock_large_d', 2.4),
      name: 'Pit boulder',
    }),
    put('dungeon/bone_c', -3.5, 7, { scale: 1.6, name: 'Bones' }),
    put('dungeon/sword_shield_broken', -7, -2.5, {
      scale: 1.5,
      name: 'Broken arms',
    }),
    put('dungeon/skull', 3, 4, { scale: 1.2, name: 'Skull' }),
  );
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4]) {
    half.push(
      put('props/bonfire', Math.cos(a) * (PIT_RIM_R - 3), Math.sin(a) * (PIT_RIM_R - 3), {
        scale: 1.7,
        name: 'Pit brazier',
      }),
    );
  }

  // The toppled monument sits ON the origin, so it is its own mirror.
  const out: MapPlacement[] = [
    ...half,
    ...half.map(mirrored),
    put('props/statue_block', 0, 0, {
      scale: 3.4,
      ...solid('props/statue_block', 3.4),
      name: 'Fallen monument',
    }),
  ];
  return out;
}

// ---------------------------------------------------------------------------
// Mid field: the roads, the cover, the ruins
// ---------------------------------------------------------------------------

/** Cover between the Fightpit and one team's keep, and on that flank ridge. */
function midField(sz: -1): MapPlacement[] {
  const out: MapPlacement[] = [
    // A ruined farmstead on the west lane, the classic mid-map body block.
    ...wallRun('dungeon/wall_broken', -48, sz * 72, -31, sz * 72, {
      scale: 2.4,
      name: 'Ruin wall',
    }),
    ...wallRun('dungeon/wall_broken', -48, sz * 72, -48, sz * 86, {
      scale: 2.4,
      name: 'Ruin wall',
    }),
    put('dungeon/wall_archedwindow_open', -40, sz * 86, {
      scale: 2.4,
      ...solid('dungeon/wall_archedwindow_open', 1.2),
      name: 'Ruin wall',
    }),
    put('props/cart', -42, sz * 79, {
      scale: 2,
      rotY: 0.6,
      ...solid('props/cart', 1.2),
      name: 'Cart',
    }),
    put('dungeon/haybale', -36, sz * 78, {
      scale: 2,
      ...solid('dungeon/haybale', 1.2),
      name: 'Haybale',
    }),

    // A watch camp on the east lane.
    put('biome/camp_tent', 41, sz * 77, {
      scale: 3,
      rotY: -0.5,
      ...solid('biome/camp_tent', 1.2),
      name: 'Watch tent',
    }),
    put('biome/camp_fire_pit', 36, sz * 72, { scale: 1.7, name: 'Watch fire' }),
    put('biome/camp_bedroll', 44, sz * 72, {
      scale: 1.6,
      ...solid('biome/camp_bedroll', 1.2),
      name: 'Bedroll',
    }),
    put('props/barrel', 37, sz * 80, {
      scale: 1.6,
      ...solid('props/barrel', 1.2),
      name: 'Barrel',
    }),

    // The keep approach: staggered cover so the last 40 yards is never a
    // straight sprint at the gate.
    ...wallRun('dungeon/barrier_half', -22, sz * 106, -5, sz * 106, {
      scale: 2.4,
      name: 'Approach barricade',
    }),
    ...wallRun('dungeon/barrier_half', 7, sz * 122, 24, sz * 122, {
      scale: 2.4,
      name: 'Approach barricade',
    }),
    put('dungeon/wagon', -15, sz * 128, {
      scale: 2.2,
      rotY: 1.2,
      ...solid('dungeon/wagon', 1.2),
      name: 'Wagon',
    }),
    put('props/timber_pillar', 17, sz * 110, {
      scale: 2.4,
      ...solid('props/timber_pillar', 1.2),
      name: 'Post',
    }),
    put('props/timber_pillar', -27, sz * 115, {
      scale: 2.4,
      ...solid('props/timber_pillar', 1.2),
      name: 'Post',
    }),

    // The flank ridge crown: a rock spine with a gap you have to find, and the
    // stone arch that marks the top of the high road.
    put('biome/city_arch', -RIDGE_X, sz * 36, {
      scale: 4.2,
      rotY: Math.PI / 2,
      ...solid('biome/city_arch', 1.2),
      name: 'Ridge arch',
    }),
    put('props/rock_tall_h', -RIDGE_X - 7, sz * 55, {
      scale: 3 * ROCK_UP,
      ...solid('props/rock_tall_h', 3.4),
      name: 'Ridge rock',
    }),
    put('props/rock_tall_a', -RIDGE_X + 6, sz * 65, {
      scale: 2.8 * ROCK_UP,
      ...solid('props/rock_tall_a', 3.1),
      name: 'Ridge rock',
    }),
    put('foliage/rock_3', -RIDGE_X - 2, sz * 84, {
      scale: 4.5 * ROCK_UP,
      ...solid('foliage/rock_3', 3.4),
      name: 'Ridge rock',
    }),
    put('props/rock_large_f', -RIDGE_X + 9, sz * 20, {
      scale: 3.4 * ROCK_UP,
      ...solid('props/rock_large_f', 2.4),
      name: 'Ridge rock',
    }),

    // A log bridge over the gully where the ridge meets the shelf: the shortcut.
    put('dungeon/trunk_large_b', -RIDGE_X + 14, sz * 103, {
      scale: 3.2,
      rotY: 0.9,
      ...solid('dungeon/trunk_large_b', 2.2),
      name: 'Fallen trunk',
    }),
  ];
  return out;
}

// ---------------------------------------------------------------------------
// The wood
// ---------------------------------------------------------------------------

const BIG_TREES = [
  'foliage/oak_1',
  'foliage/oak_2',
  'foliage/oak_3',
  'foliage/oak_5',
  'foliage/pine_1',
  'foliage/pine_2',
  'foliage/pine_3',
  'foliage/pine_5',
  'foliage/twisted_1',
  'foliage/twisted_3',
] as const;

/**
 * Ground the surrounding wood must keep off: the fight itself, and a clear
 * margin around each keep. The keeps back onto the treeline, so without the
 * second rule a jittered belt tree lands inside the back wall.
 */
function woodMustAvoid(x: number, z: number): boolean {
  if (Math.abs(x) < TH_PLAY_HALF_X - 4 && Math.abs(z) < TH_PLAY_HALF_Z - 4) return true;
  return Math.abs(x) < KEEP_HALF_X + 10 && Math.abs(z) < KEEP_BACK_Z + 8;
}

/**
 * The wall of old growth that rings the hollow. Trees normalize to 7.5yd at
 * scale 1 (render/asset_scale.ts targetHeightFor), so these stand 20-36 yards
 * tall, and they stand ON the +30 slopes, which is what closes the sky over
 * the map and hides the world edge from inside the fight.
 */
function surroundingWood(): MapPlacement[] {
  const out: MapPlacement[] = [];
  const rng = makeRng(0xf0e51);
  // Three staggered belts, each denser and taller than the one inside it.
  const belts = [
    { inset: 2, rows: 3, step: 11, scale: [2.6, 3.5] },
    { inset: 13, rows: 3, step: 12, scale: [3.1, 4.2] },
    { inset: 25, rows: 2, step: 13, scale: [3.4, 4.8] },
  ] as const;
  for (const belt of belts) {
    for (let row = 0; row < belt.rows; row++) {
      const dx = TH_PLAY_HALF_X + belt.inset + row * 6;
      const dz = TH_PLAY_HALF_Z + belt.inset + row * 6;
      if (dx > TH_HALF_X - 1 && dz > TH_HALF_Z - 1) continue;
      // Run the belt around the rect: the two long sides, then the two ends.
      const ring: { x: number; z: number }[] = [];
      for (let z = -dz; z <= dz; z += belt.step) {
        for (const sx of [-1, 1]) ring.push({ x: sx * Math.min(dx, TH_HALF_X - 2), z });
      }
      for (let x = -dx; x <= dx; x += belt.step) {
        for (const sz of [-1, 1]) ring.push({ x, z: sz * Math.min(dz, TH_HALF_Z - 2) });
      }
      for (const spot of ring) {
        const x = spot.x + (rng() - 0.5) * belt.step * 0.8;
        const z = spot.z + (rng() - 0.5) * belt.step * 0.8;
        if (woodMustAvoid(x, z)) continue;
        if (Math.abs(x) > TH_HALF_X - 2 || Math.abs(z) > TH_HALF_Z - 2) continue;
        const id = BIG_TREES[Math.floor(rng() * BIG_TREES.length)];
        out.push(
          put(id, x, z, {
            rotY: rng() * Math.PI * 2,
            scale: belt.scale[0] + rng() * (belt.scale[1] - belt.scale[0]),
            scaleY: 0.92 + rng() * 0.3,
            ...solid(id, 1.6),
            name: 'Great tree',
          }),
        );
      }
    }
  }
  return out;
}

/**
 * The trees that stand INSIDE the fight: the treeline hugging the play edge,
 * plus landmark oaks on the flank ridges. Kept clear of the lanes, the keeps
 * and the pit, so the map still plays open.
 */
function innerWood(): MapPlacement[] {
  const out: MapPlacement[] = [];
  const rng = makeRng(0xc0ffee);
  const plots = [graveyardAt(-1), graveyardAt(1)];
  const caches = [
    { x: -26, z: -62 },
    { x: 26, z: 62 },
    { x: 44, z: -88 },
    { x: -44, z: 88 },
    { x: -12, z: -116 },
    { x: 12, z: 116 },
    { x: RIDGE_X - 10, z: -34 },
    { x: -RIDGE_X + 10, z: 34 },
  ];
  for (let i = 0; i < 320; i++) {
    const x = (rng() * 2 - 1) * (TH_PLAY_HALF_X - 2);
    const z = (rng() * 2 - 1) * (TH_PLAY_HALF_Z - 2);
    const ax = Math.abs(x);
    const az = Math.abs(z);
    // Keep the fight clear: no trees on the roads, in the keeps, in the pit,
    // on the graveyards, on the supply caches or on the rune pads.
    if (Math.hypot(x, z) < PIT_LIP_R + 7) continue;
    if (ax < 16 && az < KEEP_FRONT_Z) continue;
    if (az > KEEP_FRONT_Z - 10 && ax < KEEP_HALF_X + 12) continue;
    if (Math.abs(ax - RIDGE_X) < 11 && az < 128) continue;
    if ([...TH_SPEED_RUNES, ...TH_POWER_RUNES].some((r) => Math.hypot(r.x - x, r.z - z) < 13)) {
      continue;
    }
    if (caches.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) continue;
    if (plots.some((p) => Math.abs(p.x - x) < 16 && Math.abs(p.z - z) < 14)) continue;
    // Density rises toward the treeline, so the middle stays a battlefield.
    const edge = Math.max(ax / TH_PLAY_HALF_X, az / TH_PLAY_HALF_Z);
    if (rng() > 0.18 + edge * edge * 1.5) continue;
    const scale = 2.1 + rng() * 1.4 + edge * 0.8;
    const id = BIG_TREES[Math.floor(rng() * BIG_TREES.length)];
    out.push(
      put(id, x, z, {
        rotY: rng() * Math.PI * 2,
        scale,
        scaleY: 0.9 + rng() * 0.35,
        ...solid(id, Math.max(1.1, scale * 0.42)),
        name: 'Tree',
      }),
    );
  }
  return out;
}

/** Ground cover: bushes, ferns, mushrooms and loose stone. Nothing blocks. */
function undergrowth(): MapPlacement[] {
  const out: MapPlacement[] = [];
  const rng = makeRng(0x5eed17);
  const kinds = [
    'foliage/bush',
    'foliage/bush_flowers',
    'foliage/fern',
    'foliage/fern',
    'foliage/mushroom',
    'foliage/rock_1',
    'foliage/rock_2',
  ];
  for (let i = 0; i < 780; i++) {
    const x = (rng() * 2 - 1) * (TH_HALF_X - 3);
    const z = (rng() * 2 - 1) * (TH_HALF_Z - 3);
    if (Math.hypot(x, z) < PIT_FLOOR_R) continue;
    // The keeps are swept: nothing loose inside a curtain wall.
    if (Math.abs(z) > KEEP_FRONT_Z - 2 && Math.abs(x) < KEEP_HALF_X + 2) continue;
    if (Math.abs(x) < 9 && Math.abs(z) < KEEP_FRONT_Z) continue; // the centre road
    const id = kinds[Math.floor(rng() * kinds.length)];
    const rock = id.startsWith('foliage/rock');
    out.push(
      put(id, x, z, {
        rotY: rng() * Math.PI * 2,
        scale: rock ? (1.4 + rng() * 2.6) * ROCK_UP : 1 + rng() * 1.1,
        name: rock ? 'Stone' : 'Undergrowth',
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lights, locations, atmosphere
// ---------------------------------------------------------------------------

/** Authored point lights (MAX_LIGHTS is 24, so these are chosen, not scattered). */
function lights(): MapLight[] {
  const out: MapLight[] = [];
  for (const sz of [-1, 1] as const) {
    out.push(
      {
        x: -9,
        z: sz * (KEEP_FRONT_Z - 6),
        y: 3,
        color: 0xffb254,
        intensity: 34,
        range: 30,
      },
      {
        x: 9,
        z: sz * (KEEP_FRONT_Z - 6),
        y: 3,
        color: 0xffb254,
        intensity: 34,
        range: 30,
      },
      {
        x: 0,
        z: sz * TH_FLAG_Z,
        y: KEEP_TOP_Y + PODIUM_Y + 4,
        color: sz < 0 ? 0xff6b5e : 0x6ba4ff,
        intensity: 46,
        range: 40,
      },
      { x: 0, z: sz * 141, y: 3, color: 0xffa845, intensity: 26, range: 26 },
      {
        x: graveyardAt(sz).x,
        z: graveyardAt(sz).z - sz * 6,
        y: 3.5,
        color: 0x9fd6c8,
        intensity: 22,
        range: 26,
      },
      {
        x: -RIDGE_X * sz,
        z: sz * 36,
        y: 4,
        color: 0xffc07a,
        intensity: 18,
        range: 22,
      },
    );
  }
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    out.push({
      x: Math.cos(a) * (PIT_RIM_R - 3),
      z: Math.sin(a) * (PIT_RIM_R - 3),
      y: 3,
      color: 0xff9a3c,
      intensity: 30,
      range: 32,
    });
  }
  return out;
}

/** HUD location names. Original to World of ClaudeCraft, like the map itself. */
function locations(): MapLocation[] {
  return [
    {
      name: 'Crimson Keep',
      minX: -KEEP_HALF_X,
      minZ: -TH_PLAY_HALF_Z,
      maxX: KEEP_HALF_X,
      maxZ: -130,
    },
    {
      name: 'Azure Keep',
      minX: -KEEP_HALF_X,
      minZ: 130,
      maxX: KEEP_HALF_X,
      maxZ: TH_PLAY_HALF_Z,
    },
    {
      name: 'The Fightpit',
      minX: -PIT_LIP_R,
      minZ: -PIT_LIP_R,
      maxX: PIT_LIP_R,
      maxZ: PIT_LIP_R,
    },
    {
      name: 'Whistlerock Ridge',
      minX: -TH_PLAY_HALF_X,
      minZ: -128,
      maxX: -50,
      maxZ: 128,
    },
    {
      name: 'Sablepine Ridge',
      minX: 50,
      minZ: -128,
      maxX: TH_PLAY_HALF_X,
      maxZ: 128,
    },
    {
      name: 'Thornhollow',
      minX: -TH_HALF_X,
      minZ: -TH_HALF_Z,
      maxX: TH_HALF_X,
      maxZ: TH_HALF_Z,
    },
  ];
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/** Everything that stands in the hollow, in one list. */
export function thornhollowPlacements(): MapPlacement[] {
  return [
    ...surroundingWood(),
    ...innerWood(),
    ...undergrowth(),
    ...bothHalves(keep),
    ...bothHalves(keepRampart),
    ...bothHalves(keepMaze),
    ...bothHalves(flagCourt),
    ...bothHalves(graveyard),
    ...bothHalves(midField),
    ...fightpit(),
    ...supplyCaches(),
    ...runeDressing(),
    ...anchorPlacements(),
  ];
}

/**
 * Thornhollow as an editable map document.
 *
 * The playtest spawn is inside Crimson's keep, a step behind its flag, so
 * pressing Playtest drops the maker straight into the fight they just authored.
 */
export function thornhollowMap(name: string, id: string, now: number): CustomMap {
  const map = newFlatCustomMap(name, id, now, {
    width: TH_HALF_X * 2,
    height: TH_HALF_Z * 2,
  });
  map.meta.description =
    'Thornhollow: a capture-the-flag hollow in the old growth under Thornpeak. ' +
    'Crimson and Azure race the ravine floor for each other’s banner, each behind ' +
    'a two-storey keep, and the Fightpit at its heart settles what the flags cannot.';
  map.content.zones[0].name = 'Thornhollow';
  map.terrainEdits = thornhollowStamps();
  map.biomePaint = thornhollowPaint();
  map.placements = thornhollowPlacements();
  map.playerStart = { x: 0, z: -TH_FLAG_Z + 22 };
  map.lights = lights();
  map.locations = locations();
  map.skybox = 'builtin:vale_day';
  // Auto-texturing off: the ground is painted by hand above, and the rim rule
  // would draw distant peaks over the wood that walls this map in.
  map.terrainStyle = {
    slopeRock: false,
    snowCaps: false,
    rimMountains: false,
    shoreSand: false,
  };
  // A high, thin cloud deck: light through the canopy, no rain over the fight.
  map.weather = { mode: 'auto', clouds: { coverage: 0.32, height: 78 } };
  map.lighting = {
    sunIntensity: 2.5,
    sunColor: 0xfff0d2,
    hemiIntensity: 0.75,
    skyColor: 0x9fc0e8,
    envScale: 1.05,
    sunAzimuthDeg: 118,
    sunElevationDeg: 46,
  };
  // The wood is the map's horizon, so decor has to render out to it.
  map.assetViewDistance = 400;
  return map;
}

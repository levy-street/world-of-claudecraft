// The Sowfield, Eastbrook's boarball ground, as plain numbers. Like
// dungeon_layout.ts this module is the single source of truth for FOUR
// consumers that must never drift: the terrain flatten arm (src/sim/world.ts),
// the movement/camera colliders (src/sim/colliders.ts staticWorldColliders),
// the ball's analytic wall reflection (src/sim/social/vale_cup.ts), and the
// render dressing (src/render/vale_cup_stadium.ts).
//
// All coordinates are WORLD coordinates in southern Eastbrook Vale (zone 1).
// The site is the measured empty basin between the Copper Dig (west), the
// Bandit Camp (east), Reliquary Hill (north), and the world-rim ramp that
// starts at z = -150 (docs/prd/vale-cup.md has the survey). Compass: +z is
// north, so the pitch's long axis runs east-west and the goals face east/west.
// Sim layer: no three.js imports.
import type { Collider } from './colliders';

// ---------------------------------------------------------------------------
// Site footprint
// ---------------------------------------------------------------------------
export const SOWFIELD_CENTER = { x: -11, z: -112 };

// Flattened plateau (terrain arm): rectangle + smooth falloff ring. The level
// sits just above the vale's soft land floor (-3.1) so the site never reads
// as a pond and the approach slope from town stays gentle. Depth (z) is boxed
// in: the world-rim ramp starts rising at z = -150 (guarded by
// tests/terrain_walls) and Reliquary Hill sits north around z = -60, so the
// flatten keeps its proven zMin -141 (falloff 8 reaches -149, one yard clear of
// the rim). The enlarged pitch grows mostly along x, which has open basin.
export const SOWFIELD_FLAT = {
  xMin: -56,
  xMax: 34,
  zMin: -141,
  zMax: -83,
  height: -2.6,
  falloff: 8, // yards of smoothstep ring outside the rectangle
};

// Decoration exclusion (world.ts generateDecorations arm): keep procedural
// trees/rocks off the whole shell INCLUDING the flatten's falloff apron (a tree
// seated on the blend ring reads as leaning into the stadium).
export const SOWFIELD_EXCLUDE = { xMin: -66, xMax: 44, zMin: -151, zMax: -73 };

// ---------------------------------------------------------------------------
// The pitch. Boards (low solid walls) enclose it; the ball banks off them so
// there is no out of play. The two goal mouths are gaps in the east and west
// boards backed by net pockets, so a rolling ball ends up IN the pocket.
// Sized for a full 5v5: 74 wide (goal to goal) by 30 deep, centered on the
// basin, so ten fighters and the ball are not cramped. Width carries most of
// the growth because the basin has open room along x but is rim-boxed in z.
// ---------------------------------------------------------------------------
export const PITCH = { xMin: -48, xMax: 26, zMin: -127, zMax: -97 };
export const PITCH_CENTER = { x: -11, z: -112 };
export const BOARD_H = 1.2; // visual board height; colliders are full-height OBBs
const BOARD_T = 0.5; // board half thickness

export const GOAL_HALF_W = 6; // goal mouth half width (12 wide, scaled to the bigger pitch)
export const GOAL_DEPTH = 2.5; // net pocket depth behind the goal line
export const GOAL_Z_MIN = PITCH_CENTER.z - GOAL_HALF_W;
export const GOAL_Z_MAX = PITCH_CENTER.z + GOAL_HALF_W;
// Crossbar height (matches the rendered goal frame, vale_cup_stadium.ts goalPostH):
// a ball crossing the line ABOVE this sails over and does not score, which is the
// accuracy cost of an over-powered charged shot.
export const GOAL_HEIGHT = 2.5;

// Goal lines (the scoring planes): west goal belongs to team A, east to team B.
export const GOAL_LINE_WEST_X = PITCH.xMin;
export const GOAL_LINE_EAST_X = PITCH.xMax;

// Keeper's box: the Grip passive applies inside your own box.
export const GOAL_BOX_DEPTH = 8;
export const GOAL_BOX_HALF_W = 9;

export interface VcWallSegment {
  // axis-aligned segment the ball reflects off; nx/nz is the INWARD normal
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  nx: number;
  nz: number;
}

// Every board line the ball banks off, in world coordinates. The goal mouths
// are open (no segment) so shots roll into the net pockets; the pockets' own
// back/side walls stop the ball dead (the module treats pocket hits as goal
// settle, not a bank).
export const PITCH_WALLS: VcWallSegment[] = [
  // north board (inward normal points south, -z)
  { x1: PITCH.xMin, z1: PITCH.zMax, x2: PITCH.xMax, z2: PITCH.zMax, nx: 0, nz: -1 },
  // south board (inward normal points north, +z)
  { x1: PITCH.xMin, z1: PITCH.zMin, x2: PITCH.xMax, z2: PITCH.zMin, nx: 0, nz: 1 },
  // west board, two segments flanking the goal mouth (inward normal +x)
  { x1: PITCH.xMin, z1: PITCH.zMin, x2: PITCH.xMin, z2: GOAL_Z_MIN, nx: 1, nz: 0 },
  { x1: PITCH.xMin, z1: GOAL_Z_MAX, x2: PITCH.xMin, z2: PITCH.zMax, nx: 1, nz: 0 },
  // east board, two segments flanking the goal mouth (inward normal -x)
  { x1: PITCH.xMax, z1: PITCH.zMin, x2: PITCH.xMax, z2: GOAL_Z_MIN, nx: -1, nz: 0 },
  { x1: PITCH.xMax, z1: GOAL_Z_MAX, x2: PITCH.xMax, z2: PITCH.zMax, nx: -1, nz: 0 },
];

// ---------------------------------------------------------------------------
// Kickoff spawns (world coords). Team A defends the WEST goal, team B the
// EAST. Index 0 is the kickoff taker's spot when that team has the kickoff.
// ---------------------------------------------------------------------------
export interface VcSpawnPoint {
  x: number;
  z: number;
  facing: number;
}

// facing: the sim convention is facing f points along (sin f, cos f), so east
// (+x) is PI/2 and west (-x) is -PI/2. Team A spawns in the west half facing
// east toward the enemy goal; B mirrors it.
const FACE_EAST = Math.PI / 2;
const FACE_WEST = -Math.PI / 2;

export const VC_SPAWNS_A: VcSpawnPoint[] = [
  { x: -16, z: -112, facing: FACE_EAST }, // kickoff taker, near center
  { x: -26, z: -104, facing: FACE_EAST },
  { x: -26, z: -120, facing: FACE_EAST },
  { x: -38, z: -107, facing: FACE_EAST },
  { x: -38, z: -117, facing: FACE_EAST },
];
export const VC_SPAWNS_B: VcSpawnPoint[] = VC_SPAWNS_A.map((s) => ({
  // mirror across the pitch center x
  x: 2 * PITCH_CENTER.x - s.x,
  z: s.z,
  facing: FACE_WEST,
}));

// Where non-participants are nudged to if they stand on the pitch during a
// live match, and where fighters are returned after (the stands rail).
export const SPECTATOR_LINE_Z = PITCH.zMax + 3;

// ---------------------------------------------------------------------------
// Stands + dressing anchors (render reads these; stand walls collide).
// ---------------------------------------------------------------------------
export const STAND_NORTH = { xMin: -42, xMax: 20, zMin: -96, zMax: -87 };
export const STAND_SOUTH = { xMin: -42, xMax: 20, zMin: -138, zMax: -129 };

// The public gate gap in the north board rail (players hop the boards; the
// gate is the flavor entrance through the stands).
export const GATE = { x: -11, z: -85, halfW: 3 };

// Groundskeeper Bram (queue master) and the Copper Pail plinth, by the gate.
export const BRAM_POS = { x: -6, z: -82, facing: Math.PI };
export const PLINTH_POS = { x: -16, z: -82 };

// Eight nation banner poles along the south stand back wall, west to east.
export const BANNER_POLES: { x: number; z: number }[] = Array.from({ length: 8 }, (_, i) => ({
  x: -40 + i * 8,
  z: -139,
}));
// The two competing teams' flags flank the gate on match days.
export const MATCH_FLAG_POLES: { x: number; z: number }[] = [
  { x: -17, z: -86 },
  { x: -5, z: -86 },
];

// Brazier floodlights at the four pitch corners (render: fireLights budget).
export const BRAZIERS: { x: number; z: number }[] = [
  { x: PITCH.xMin - 2, z: PITCH.zMin - 2 },
  { x: PITCH.xMin - 2, z: PITCH.zMax + 2 },
  { x: PITCH.xMax + 2, z: PITCH.zMin - 2 },
  { x: PITCH.xMax + 2, z: PITCH.zMax + 2 },
];

/** Inside the stadium shell (music/ambience/presence predicate). */
export function isAtSowfield(x: number, z: number): boolean {
  return (
    x >= SOWFIELD_FLAT.xMin - 6 &&
    x <= SOWFIELD_FLAT.xMax + 6 &&
    z >= SOWFIELD_FLAT.zMin - 6 &&
    z <= SOWFIELD_FLAT.zMax + 6
  );
}

/**
 * Inside the full stadium footprint including the flatten's falloff apron. This
 * is the same rectangle that keeps procedural trees/rocks off the shell
 * (world.ts generateDecorations), reused to keep wild grass tufts, ground
 * plants, and ambient critters off the pitch and its immediate surrounds so the
 * Sowfield reads as a proper mown football ground.
 */
export function isInSowfieldShell(x: number, z: number): boolean {
  return (
    x >= SOWFIELD_EXCLUDE.xMin &&
    x <= SOWFIELD_EXCLUDE.xMax &&
    z >= SOWFIELD_EXCLUDE.zMin &&
    z <= SOWFIELD_EXCLUDE.zMax
  );
}

/** Inside the playing surface (pitch rules apply). */
export function isOnPitch(x: number, z: number): boolean {
  return x >= PITCH.xMin && x <= PITCH.xMax && z >= PITCH.zMin && z <= PITCH.zMax;
}

// ---------------------------------------------------------------------------
// Parallel practice instances. Practice matches play on private copies of the
// pitch far from the one physical Sowfield, so many run at once without touching
// the real match. Each copy is the SAME pitch geometry shifted by an ORIGIN
// offset (the real Sowfield match uses {0,0}); match code adds match.origin to
// every geometry read. Origins sit far past every instance band (x >= 4773 is a
// delve, arena at 4200, dungeons from 900) and 400yd apart, so interest scoping
// (~130yd) keeps each practice pitch fully private and clear of all other
// entities. Practice players are clamped to their copy's pitch, so the region's
// collider routing out there never matters.
export const VC_PRACTICE_SLOTS = 8; // max concurrent practice matches per realm
const VC_PRACTICE_BASE_X = 30000;
const VC_PRACTICE_SLOT_DZ = 400;

export function vcPracticeOrigin(slot: number): { x: number; z: number } {
  return { x: VC_PRACTICE_BASE_X, z: slot * VC_PRACTICE_SLOT_DZ };
}

// ---------------------------------------------------------------------------
// Walkable grandstand tiers. The stands rise AWAY from the pitch in two seated
// tiers; the ground itself steps up (the boss-dais pattern: raised walkable
// ground is the heightfield, colliders only block in 2D), so players can climb
// the bleachers and sit up in the stands. Each tier is a flat landing reached by
// a short ramp at its pitch-facing front; the ramp rise/run stays under the
// movement climb limit (PLAYER_MAX_CLIMB_SLOPE = 1.5) so the terrain is walkable,
// not a cliff you skid off. The render (vale_cup_stadium.ts) seats the decks and
// benches on this same lifted ground, and world.ts adds the lift to the Sowfield
// flatten. The stand footprints sit clear of the pitch, so the playing surface
// (and the ball) stays perfectly flat.
export const VC_STAND_TIER_DEPTH = 4.6; // yards deep per seated tier
// Landing height per tier: matches the rendered wooden deck tops (the render
// builds decks at these heights on the flat baseline) so the walkable ground
// (groundHeight) lands a climbing player exactly on each deck.
export const VC_STAND_TIER_HEIGHTS = [0.55, 1.28] as const;
const VC_STAND_RAMP = 1.4; // yards of walkable ramp at each tier's front

/** Height the grandstand ground is raised at (x, z), 0 outside the stands. A
 *  tiered ramp: flat landings joined by short walkable ramps (see above). */
export function sowfieldStandLift(x: number, z: number): number {
  for (const stand of [STAND_NORTH, STAND_SOUTH]) {
    if (x < stand.xMin - 0.5 || x > stand.xMax + 0.5) continue;
    const front = stand === STAND_NORTH ? stand.zMin : stand.zMax;
    const away = stand === STAND_NORTH ? 1 : -1; // +z is away from the pitch, north stand
    const rel = (z - front) * away; // distance from the pitch-facing front, into the stand
    const total = VC_STAND_TIER_DEPTH * VC_STAND_TIER_HEIGHTS.length;
    if (rel < 0 || rel > total) continue;
    const tier = Math.min(VC_STAND_TIER_HEIGHTS.length - 1, Math.floor(rel / VC_STAND_TIER_DEPTH));
    const prev = tier === 0 ? 0 : VC_STAND_TIER_HEIGHTS[tier - 1];
    const cur = VC_STAND_TIER_HEIGHTS[tier];
    const within = rel - tier * VC_STAND_TIER_DEPTH;
    const t = Math.min(1, within / VC_STAND_RAMP); // ramp up over the tier's front
    return prev + (cur - prev) * t;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Collision set, appended to the overworld static grid (colliders.ts). Boards
// are building-style solid OBBs (NOT isFence: a fence would hard-stop the
// rolling ball's resolveMovement-free physics is analytic, but PLAYER movement
// uses these, and fences are jump-through which would let players hop in mid
// match: the boards gap at the gate instead). Net pockets and goal posts are
// solid. Stand fronts are solid so the crowd stays off the pitch.
// ---------------------------------------------------------------------------
export function valeCupColliders(): Collider[] {
  const out: Collider[] = [];
  const midZ = (PITCH.zMin + PITCH.zMax) / 2;
  const midX = (PITCH.xMin + PITCH.xMax) / 2;
  // The whole site sits on the flattened plateau, so the camera-occlusion tops
  // are plain constants (no seed needed): low boards never pull the chase cam
  // in (camGhost) but the renderer can still fade one crossing the eye line.
  const boardTop = SOWFIELD_FLAT.height + BOARD_H;
  const postTop = SOWFIELD_FLAT.height + 2.4;

  // north board with the gate gap
  const gateL = GATE.x - GATE.halfW;
  const gateR = GATE.x + GATE.halfW;
  out.push({
    type: 'obb',
    x: (PITCH.xMin + gateL) / 2,
    z: PITCH.zMax,
    hw: (gateL - PITCH.xMin) / 2,
    hd: BOARD_T,
    rot: 0,
    cameraTopY: boardTop,
    camGhost: true,
  });
  out.push({
    type: 'obb',
    x: (gateR + PITCH.xMax) / 2,
    z: PITCH.zMax,
    hw: (PITCH.xMax - gateR) / 2,
    hd: BOARD_T,
    rot: 0,
    cameraTopY: boardTop,
    camGhost: true,
  });
  // south board, full length
  out.push({
    type: 'obb',
    x: midX,
    z: PITCH.zMin,
    hw: (PITCH.xMax - PITCH.xMin) / 2,
    hd: BOARD_T,
    rot: 0,
    cameraTopY: boardTop,
    camGhost: true,
  });
  // west + east boards flanking the goal mouths
  for (const [gx] of [[PITCH.xMin], [PITCH.xMax]] as const) {
    const southHd = (GOAL_Z_MIN - PITCH.zMin) / 2;
    const northHd = (PITCH.zMax - GOAL_Z_MAX) / 2;
    out.push({
      type: 'obb',
      x: gx,
      z: PITCH.zMin + southHd,
      hw: BOARD_T,
      hd: southHd,
      rot: 0,
      cameraTopY: boardTop,
      camGhost: true,
    });
    out.push({
      type: 'obb',
      x: gx,
      z: GOAL_Z_MAX + northHd,
      hw: BOARD_T,
      hd: northHd,
      rot: 0,
      cameraTopY: boardTop,
      camGhost: true,
    });
  }
  // goal posts (circles at the mouth corners) + net pockets (back/side walls)
  for (const side of [-1, 1] as const) {
    const lineX = side === -1 ? PITCH.xMin : PITCH.xMax;
    const backX = lineX + side * GOAL_DEPTH;
    out.push({
      type: 'circle',
      x: lineX,
      z: GOAL_Z_MIN,
      r: 0.35,
      cameraTopY: postTop,
      camGhost: true,
    });
    out.push({
      type: 'circle',
      x: lineX,
      z: GOAL_Z_MAX,
      r: 0.35,
      cameraTopY: postTop,
      camGhost: true,
    });
    // pocket back wall
    out.push({
      type: 'obb',
      x: backX,
      z: midZ,
      hw: BOARD_T * 0.6,
      hd: GOAL_HALF_W + 0.6,
      rot: 0,
      cameraTopY: boardTop,
      camGhost: true,
    });
    // pocket side rails
    for (const gz of [GOAL_Z_MIN, GOAL_Z_MAX]) {
      out.push({
        type: 'obb',
        x: lineX + (side * GOAL_DEPTH) / 2,
        z: gz,
        hw: GOAL_DEPTH / 2,
        hd: BOARD_T * 0.6,
        rot: 0,
        cameraTopY: boardTop,
        camGhost: true,
      });
    }
  }
  // stand BACK rails: the tiers are walkable (the ground steps up, see
  // sowfieldStandLift) so players can climb the bleachers and sit up top; the
  // only barrier is a solid rail along the rear of the top tier so nobody walks
  // off the back of the raised stand. The pitch-facing front is open (you climb
  // in from there), and the pitch boards still keep the crowd off the pitch.
  for (const stand of [STAND_NORTH, STAND_SOUTH]) {
    const front = stand === STAND_NORTH ? stand.zMin : stand.zMax;
    const away = stand === STAND_NORTH ? 1 : -1;
    const backZ = front + away * (VC_STAND_TIER_DEPTH * VC_STAND_TIER_HEIGHTS.length);
    const backTop =
      SOWFIELD_FLAT.height + VC_STAND_TIER_HEIGHTS[VC_STAND_TIER_HEIGHTS.length - 1] + 1.1;
    out.push({
      type: 'obb',
      x: (stand.xMin + stand.xMax) / 2,
      z: backZ,
      hw: (stand.xMax - stand.xMin) / 2 + 0.2,
      hd: 0.3,
      rot: 0,
      cameraTopY: backTop,
      camGhost: true,
    });
  }
  // the Copper Pail plinth
  out.push({
    type: 'circle',
    x: PLINTH_POS.x,
    z: PLINTH_POS.z,
    r: 0.9,
    cameraTopY: SOWFIELD_FLAT.height + 1.8,
    camGhost: true,
  });
  return out;
}

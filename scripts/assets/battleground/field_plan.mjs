// The THORNHOLLOW FIELDS PLAN: the gameplay-authoritative geometry of the 5v5
// capture-the-flag battleground, restated as plain data.
//
// Every number here is the ORIGINAL Thornhollow Fields layout (the combat-tuned field:
// three chambers, two curtains pierced by a main gate and a gatehouse each, a
// keep whose mouth is the only way in, the hollow heart ruin, and the cover
// that breaks each straight charge). The map builder dresses this plan with the
// Thornhollow art kit; it never moves a wall, a pad or a spawn. Anything that
// changes where a fighter can stand belongs HERE, and only here.
//
// Field-local coordinates: x across, z along the length, y up.
// Team 0 (Crimson) holds -z, team 1 (Azure) +z, and the whole plan is
// point-symmetric ((x, z) -> (-x, -z)), so neither side plays a different map.
//
// Pure and deterministic: plain data plus derived geometry, no rng, no clock.

// ---------------------------------------------------------------------------
// Footprint
// ---------------------------------------------------------------------------

export const HALF_X = 50;
export const HALF_Z = 140;
/** Wall half-thickness: the plan's walls are 2yd through. */
export const WALL_T = 1;
/** |z| of each team's flag stand. */
export const FLAG_Z = 118;

// Keep enclosure: a back wall behind the flag and two SOLID side walls, open
// only toward the field. The keep mouth is the one way in or out.
export const KEEP_HALF_X = 16;
export const KEEP_BACK_DZ = 10; // back wall this far behind the flag
export const KEEP_SIDE_HD = 10; // side walls span back wall to mouth line
export const KEEP_MOUTH_DZ = 10; // mouth line this far field-side of the flag

/** The z line of each curtain wall: the chamber boundaries. */
export const CURTAIN_Z = 56;

// ---------------------------------------------------------------------------
// Anchors the game mode reasons about
// ---------------------------------------------------------------------------

export const BASES = [
  {
    team: 0,
    flag: { x: 0, z: -FLAG_Z },
    // The ring flanks the flag stand on its field side (never on it) and sits
    // clear of the back wall, so a fighter who materializes here spawns into
    // open court with the stand and the mouth both in view, never wedged
    // against stone.
    spawns: [
      { x: -7, z: -117 },
      { x: 0, z: -113 },
      { x: 7, z: -117 },
      { x: -3.5, z: -114.5 },
      { x: 3.5, z: -114.5 },
    ],
    // Just inside the keep's back wall (inner face |z| = 127), not buried in it.
    banner: { x: 0, z: -126 },
  },
  {
    team: 1,
    flag: { x: 0, z: FLAG_Z },
    spawns: [
      { x: 7, z: 117 },
      { x: 0, z: 113 },
      { x: -7, z: 117 },
      { x: 3.5, z: 114.5 },
      { x: -3.5, z: 114.5 },
    ],
    banner: { x: 0, z: 126 },
  },
];

/** One pad at each curtain's courtyard-side mouth, by the main gate. */
export const POWER_RUNES = [
  { x: 13, z: -48 }, // south main gate's courtyard mouth
  { x: -13, z: 48 }, // north mirror
];

/** One at each flag approach plus two mid-field flanks. */
export const SPEED_RUNES = [
  { x: 0, z: -91 }, // Crimson flag approach
  { x: 0, z: 91 }, // Azure flag approach
  { x: -38, z: 0 }, // west flank, in the courtyard
  { x: 38, z: 0 }, // east flank
];

/** A fenced plot in the map corner beside each keep, on its gatehouse-opposite
 *  flank, so the keep interior stays a clean fight space. */
export const GRAVEYARDS = [
  { x: 33, z: -130, hw: 9, hd: 6 }, // Crimson: east corner (its gatehouse is west)
  { x: -33, z: 130, hw: 9, hd: 6 }, // Azure mirror
];

// ---------------------------------------------------------------------------
// Walls: every rectangle a fighter has to go around
// ---------------------------------------------------------------------------

/**
 * @typedef {{x:number,z:number,hw:number,hd:number,kind:string}} PlanWall
 * `kind` picks the art course the dresser builds: how tall the run stands and
 * which kit piece it is made of. It never changes the footprint.
 */

/** The four perimeter ramparts. */
export const PERIMETER_WALLS = [
  { x: -HALF_X, z: 0, hw: WALL_T, hd: HALF_Z, kind: 'rampart' },
  { x: HALF_X, z: 0, hw: WALL_T, hd: HALF_Z, kind: 'rampart' },
  { x: 0, z: -HALF_Z, hw: HALF_X, hd: WALL_T, kind: 'rampart' },
  { x: 0, z: HALF_Z, hw: HALF_X, hd: WALL_T, kind: 'rampart' },
];

/** Keep walls for one team: a back wall and two SOLID side walls. */
export function keepWallSegments(team) {
  const dir = team === 0 ? -1 : 1;
  const flagZ = team === 0 ? -FLAG_Z : FLAG_Z;
  const backZ = flagZ + dir * KEEP_BACK_DZ;
  const segs = [{ x: 0, z: backZ, hw: KEEP_HALF_X, hd: WALL_T, kind: 'keep' }];
  for (const sx of [-KEEP_HALF_X, KEEP_HALF_X]) {
    segs.push({ x: sx, z: flagZ, hw: WALL_T, hd: KEEP_SIDE_HD, kind: 'keep' });
  }
  return segs;
}

/**
 * The keep's interior box for one team: x across the keep's full width, z from
 * the back wall to the mouth line. The form-up containment reads this, so the
 * gate can never drift from the walls it stands in for.
 */
export function keepInteriorBounds(team) {
  const dir = team === 0 ? -1 : 1;
  const flagZ = team === 0 ? -FLAG_Z : FLAG_Z;
  const backZ = flagZ + dir * KEEP_BACK_DZ;
  const mouthZ = flagZ - dir * KEEP_MOUTH_DZ;
  return {
    minX: -KEEP_HALF_X,
    maxX: KEEP_HALF_X,
    minZ: Math.min(backZ, mouthZ),
    maxZ: Math.max(backZ, mouthZ),
  };
}

/**
 * The two curtain walls at z = +-CURTAIN_Z, each pierced by exactly TWO
 * crossings: the main gate (10yd, off-centre) and the gatehouse room. Every
 * segment butt-joins what it meets, never overlaps it.
 */
export const CURTAIN_WALLS = [
  { x: -41.5, z: -56, hw: 7.5, hd: WALL_T, kind: 'curtain' }, // rampart to gatehouse west wall
  { x: -5, z: -56, hw: 13, hd: WALL_T, kind: 'curtain' }, // gatehouse east wall to main gate
  { x: 33.5, z: -56, hw: 15.5, hd: WALL_T, kind: 'curtain' }, // main gate to the rampart
  { x: 41.5, z: 56, hw: 7.5, hd: WALL_T, kind: 'curtain' }, // north curtain, point mirror
  { x: 5, z: 56, hw: 13, hd: WALL_T, kind: 'curtain' },
  { x: -33.5, z: 56, hw: 15.5, hd: WALL_T, kind: 'curtain' },
];

/** The 10yd main gate through each curtain, between the two segments. */
export const MAIN_GATES = [
  { x: 13, z: -56, half: 5 },
  { x: -13, z: 56, half: 5 },
];

/**
 * The gatehouses: a room straddling each curtain (16yd wide, 20yd long over its
 * end walls) with OFFSET doors (enter the field-side door on one half, exit the
 * courtyard-side door on the other), so crossing it is a jog past ambush
 * corners, not a straight run. Each sits on its team's gatehouse flank
 * (Crimson west, Azure east), and the walls butt-join the curtain segments.
 */
export const GATEHOUSE_WALLS = [
  { x: -33, z: -56, hw: WALL_T, hd: 9, kind: 'gatehouse' }, // south gatehouse, west wall
  { x: -19, z: -56, hw: WALL_T, hd: 9, kind: 'gatehouse' }, // east wall
  { x: -29, z: -65, hw: 4, hd: WALL_T, kind: 'gatehouse' }, // field-side wall (door x -25..-20)
  { x: -23.5, z: -47, hw: 4.5, hd: WALL_T, kind: 'gatehouse' }, // courtyard side (door x -32..-28)
  { x: 33, z: 56, hw: WALL_T, hd: 9, kind: 'gatehouse' }, // north gatehouse, point mirror
  { x: 19, z: 56, hw: WALL_T, hd: 9, kind: 'gatehouse' },
  { x: 29, z: 65, hw: 4, hd: WALL_T, kind: 'gatehouse' },
  { x: 23.5, z: 47, hw: 4.5, hd: WALL_T, kind: 'gatehouse' },
];

/** The two gatehouse rooms, for floor paint and interior dressing. */
export const GATEHOUSE_ROOMS = [
  { x: -26, z: -56, hw: 7, hd: 9 },
  { x: 26, z: 56, hw: 7, hd: 9 },
];

/**
 * Mouth barricades: one LOW wall 2yd field-side of each keep mouth, offset
 * across the mouth span so the straight line from the field to the flag is
 * broken. Sits OUTSIDE keepInteriorBounds, so the form-up containment never
 * reads it.
 */
export const KEEP_BARRICADES = [
  { x: -3, z: -106, hw: 8, hd: WALL_T, kind: 'barricade' },
  { x: 3, z: 106, hw: 8, hd: WALL_T, kind: 'barricade' },
];

/**
 * Chamber cover: the hollow heart ruin and flanking cover inside the Ruin
 * Courtyard, plus wing baffles and the staggered S-approach in each field
 * chamber. The 16yd heart is what seals main-gate-to-main-gate sight.
 */
export const HEART_RUIN = { x: 0, z: 0, hw: 8, hd: 8, kind: 'ruin' };

export const COVER_WALLS = [
  { x: -16, z: -22, hw: 7, hd: 1, kind: 'cover' }, // courtyard sightline breakers
  { x: 16, z: 22, hw: 7, hd: 1, kind: 'cover' },
  { x: 26, z: -30, hw: 1, hd: 7, kind: 'cover' },
  { x: -26, z: 30, hw: 1, hd: 7, kind: 'cover' },
  { x: -30, z: -98, hw: 9, hd: 1, kind: 'cover' }, // wing baffles near each keep mouth
  { x: 30, z: 98, hw: 9, hd: 1, kind: 'cover' },
  { x: 10, z: -84, hw: 12, hd: 1, kind: 'cover' }, // the staggered S-approach
  { x: -10, z: 84, hw: 12, hd: 1, kind: 'cover' },
  { x: -18, z: -70, hw: 12, hd: 1, kind: 'cover' },
  { x: 18, z: 70, hw: 12, hd: 1, kind: 'cover' },
];

export const COVER_PILLARS = [
  { x: -30, z: -14 },
  { x: 30, z: -14 },
  { x: 0, z: -42 },
  { x: 30, z: 14 },
  { x: -30, z: 14 },
  { x: 0, z: 42 },
];

export const COVER_CRATES = [
  { x: -10, z: -102 }, // field cover on each approach
  { x: 10, z: 102 },
  { x: 14, z: -76 },
  { x: -14, z: 76 },
  { x: -42, z: -60 }, // by each rampart flank
  { x: 42, z: 60 },
  { x: 41, z: -4 }, // cover beside each flank rune
  { x: -41, z: 4 },
  { x: -26, z: -58 }, // the ambush crates inside each gatehouse
  { x: 26, z: 58 },
  { x: -27, z: -51 },
  { x: 27, z: 51 },
];

/**
 * The big rock formations of the Ruin Courtyard and the field chambers, point
 * mirrored. Their tops stay BELOW the eye line: movement cover a runner rounds
 * or vaults, never sight cover a caster is blocked by.
 */
export const RUBBLE_PILES = [
  { x: 9.5, z: -10.5, kind: 'small' }, // hugging the heart's corners
  { x: -9.5, z: 10.5, kind: 'small' },
  { x: -20, z: -50, kind: 'large' }, // the great mounds at the curtain feet
  { x: 20, z: 50, kind: 'large' },
  { x: 43, z: -24, kind: 'large' }, // rampart-side formations
  { x: -43, z: 24, kind: 'large' },
  { x: 3, z: -33, kind: 'large' }, // mid-courtyard set pieces
  { x: -3, z: 33, kind: 'large' },
  { x: -33, z: -20, kind: 'small' },
  { x: 33, z: 20, kind: 'small' },
  { x: -16, z: -9, kind: 'small' }, // by the heart's west face
  { x: 16, z: 9, kind: 'small' },
  { x: 30, z: -51, kind: 'small' }, // at the sealed curtain runs
  { x: -30, z: 51, kind: 'small' },
  { x: -44, z: -36, kind: 'small' },
  { x: 44, z: 36, kind: 'small' },
];

export const RUBBLE_RADIUS = { large: 4.6, small: 2.0 };

/**
 * Graveyard rails: a real barrier with a 4yd entrance at the field-facing
 * corner. Their top sits above eye height, so spell sight through them is
 * honestly blocked.
 */
export const GRAVEYARD_FENCE_TOP = 1.8;
export const GRAVEYARD_FENCES = [
  // Crimson yard: west + east rails, a south rail butt-joined between them, and
  // a north rail leaving the 4yd entrance at the keep-side corner.
  { x: 24, z: -130, hw: WALL_T, hd: 6, kind: 'fence' },
  { x: 42, z: -130, hw: WALL_T, hd: 6, kind: 'fence' },
  { x: 33, z: -136, hw: 8, hd: WALL_T, kind: 'fence' },
  { x: 35, z: -124, hw: 6, hd: WALL_T, kind: 'fence' },
  // Azure point mirrors.
  { x: -24, z: 130, hw: WALL_T, hd: 6, kind: 'fence' },
  { x: -42, z: 130, hw: WALL_T, hd: 6, kind: 'fence' },
  { x: -33, z: 136, hw: 8, hd: WALL_T, kind: 'fence' },
  { x: -35, z: 124, hw: 6, hd: WALL_T, kind: 'fence' },
];

/** Every wall rectangle on the field, in one list. */
export function planWalls() {
  return [
    ...PERIMETER_WALLS,
    ...keepWallSegments(0),
    ...keepWallSegments(1),
    HEART_RUIN,
    ...COVER_WALLS,
    ...CURTAIN_WALLS,
    ...GATEHOUSE_WALLS,
    ...KEEP_BARRICADES,
    ...GRAVEYARD_FENCES,
  ];
}

/** Is (x, z) inside any wall rectangle, grown by `pad`? */
export function insideAnyWall(x, z, pad = 0) {
  for (const w of planWalls()) {
    if (Math.abs(x - w.x) <= w.hw + pad && Math.abs(z - w.z) <= w.hd + pad) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Named places (the M map tints the keeps and reads its team line from these)
// ---------------------------------------------------------------------------

export const LOCATIONS = [
  { name: 'Crimson Keep', minX: -18, minZ: -HALF_Z, maxX: 18, maxZ: -(FLAG_Z - KEEP_MOUTH_DZ) },
  { name: 'Azure Keep', minX: -18, minZ: FLAG_Z - KEEP_MOUTH_DZ, maxX: 18, maxZ: HALF_Z },
  { name: 'The Ruin Courtyard', minX: -HALF_X, minZ: -CURTAIN_Z, maxX: HALF_X, maxZ: CURTAIN_Z },
  { name: 'Crimson Field', minX: -HALF_X, minZ: -108, maxX: HALF_X, maxZ: -CURTAIN_Z },
  { name: 'Azure Field', minX: -HALF_X, minZ: CURTAIN_Z, maxX: HALF_X, maxZ: 108 },
  { name: 'Thornhollow Fields', minX: -HALF_X, minZ: -HALF_Z, maxX: HALF_X, maxZ: HALF_Z },
];

// ---------------------------------------------------------------------------
// The routes the ground paint wears in (paint only: no collision, no gameplay)
// ---------------------------------------------------------------------------

/** Canonical (team 0) route polylines; the builder mirrors them for team 1. */
export const ROUTE_LINES = [
  // Keep road: out of the mouth, down the middle of the field chamber.
  [
    { x: 0, z: -132 },
    { x: 0, z: -112 },
    { x: 0, z: -100 },
    { x: 2, z: -92 },
  ],
  // Main-gate branch: east around the S-approach and through the arch.
  [
    { x: 2, z: -92 },
    { x: 5, z: -80 },
    { x: 4, z: -72 },
    { x: 9, z: -64 },
    { x: 13, z: -52 },
  ],
  // Gatehouse branch: west around the wing baffle, through the offset doors.
  [
    { x: 2, z: -92 },
    { x: -8, z: -88 },
    { x: -21, z: -80 },
    { x: -22, z: -68 },
    { x: -22, z: -60 },
    { x: -30, z: -52 },
    { x: -30, z: -44 },
  ],
  // Courtyard lane: the main gate around the heart's east face toward the mirror.
  [
    { x: 13, z: -50 },
    { x: 19, z: -40 },
    { x: 20, z: -22 },
    { x: 14, z: -6 },
    { x: 6, z: 6 },
  ],
  // Courtyard flank lane: the gatehouse door across the west of the heart.
  [
    { x: -30, z: -44 },
    { x: -34, z: -30 },
    { x: -33, z: -8 },
    { x: -24, z: 8 },
  ],
];

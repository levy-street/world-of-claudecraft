// The Deepglass, as plain numbers (docs/prd/deepglass.md).
//
// Like vale_cup_layout.ts this module is the single source of truth for every
// consumer that must never drift: the standalone arena world (./world.ts), the
// ball's analytic bell reflection (./ball.ts), the flooded-flight clamp
// (src/sim/player_motion.ts), the match driver (./match.ts) and the render
// dressing (src/render/deepglass.ts).
//
// Sim layer: no three.js imports, no rng, no clocks.
//
// The bell is a TRUE SPHERE. In the standalone dev arena it is centred on the
// world origin; the Sowfield integration moves DEEPGLASS_CENTER to
// (-11, 41, -110) and nothing else in this module changes.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// The bell
// ---------------------------------------------------------------------------

/** Flat slate height of the standalone arena world. */
export const DG_FLOOR_Y = 0;

/**
 * Centre of the glass sphere. y is absolute world height.
 *
 * Derived from the base rather than written down, because the sphere's SIZE is
 * now a knob (DG_ARENA_SCALE): the bell rests in a stone cradle at a fixed
 * height above the slate, so growing the sphere has to lift its centre by the
 * same amount or the bottom of the play volume ends up underground.
 */
export const DEEPGLASS_CENTER: Vec3 = { x: 0, y: 0, z: 0 }; // y filled in below

/**
 * The scale-up, applied to the SPHERE and everything that positions inside it.
 *
 * The bell was 76 yd across and the field played tight: with ten bodies at
 * 26 yd/s the whole arena was two seconds wide, so there was no space to run
 * into and every loose ball became a scrum. A third bigger opens the midfield
 * without touching the sport's own numbers — the goal aperture, the ball, the
 * bodies and the speeds are all unchanged, so what grows is only the room.
 *
 * Deliberately expressed as a factor rather than folded into the constants: the
 * spawns, the pads, the powerup sites and the currents all key off the same
 * figures, and a factor keeps them in step by construction.
 */
export const DG_ARENA_SCALE = 1.3;

/** Inner face of the glass. Was 76 yd across; DG_ARENA_SCALE opens it out. */
export const DEEPGLASS_RADIUS = 38 * DG_ARENA_SCALE;

/** Clamp radius for a player body (glass minus a body's width). */
export const DEEPGLASS_PLAY_R = DEEPGLASS_RADIUS - 1.6;

/** The stone cradle ring that carries the bell. The ONLY flat-ground need. */
export const DEEPGLASS_CRADLE_R = 20 * DG_ARENA_SCALE;

/** Bottom of the glass: the sphere rests this high above the slate. Fixed —
 *  the cradle does not move when the bell grows. */
export const DEEPGLASS_BASE_Y = 3;
// The centre follows the base and the radius. (Assigned rather than declared
// const-with-value so the radius above can be the knob.)
DEEPGLASS_CENTER.y = DEEPGLASS_BASE_Y + DEEPGLASS_RADIUS;
/** Crown of the glass. */
export const DEEPGLASS_TOP_Y = DEEPGLASS_CENTER.y + DEEPGLASS_RADIUS;

/** Height of the glass above the slate at horizontal distance `d` from the
 *  axis, or null when `d` is outside the sphere's shadow. Drives the cradle
 *  arch height and the render's overhang. */
export function glassHeightAt(d: number): number | null {
  if (d >= DEEPGLASS_RADIUS) return null;
  return DEEPGLASS_CENTER.y - Math.sqrt(DEEPGLASS_RADIUS * DEEPGLASS_RADIUS - d * d);
}

// ---------------------------------------------------------------------------
// Goal holes. Team A defends WEST (-x), team B defends EAST (+x), matching the
// Vale Cup convention exactly so every 'A' | 'B' scoring path is unchanged.
//
// The goals live IN THE GLASS now: two circular holes cut through the bell on
// the ±x axis, with the authored goal housing hanging just OUTSIDE each one.
// Scoring is escape — the ball leaves the bell through a hole (ball.ts
// escapedThroughHole) and settles in the housing's pocket. The rings used to
// hang 10 yards inside the glass with an invisible "goal wall" across the
// mouth; the holes replace both, and the wall rule with them.
// ---------------------------------------------------------------------------

/**
 * Radius of the hole cut through the glass — the physical goal mouth.
 *
 * NOT scaled with the arena, on purpose. This is the sport's difficulty: a
 * bigger arena should mean more room to play, not a bigger target.
 */
export const DG_HOLE_R = 8.2; // was 7.4; widened a touch each side on request
/**
 * The radius the ball's CENTRE must pass inside to fit through the hole
 * (DG_HOLE_R minus the ball's 1.68 yd radius).
 * This is the actual scoring test (ball.ts). Written as a literal rather than
 * derived because layout.ts must not import ball.ts (the dependency runs the
 * other way); the pair is asserted equal in tests/deepglass.test.ts.
 */
export const DG_HOLE_PASS_R = 6.52;
/** Radius of the drawn target ring hanging in each hole. Slightly inside the
 *  pass radius so a shot that grazes the drawn ring genuinely scores. */
export const DG_RING_RADIUS = 6;
/** How far outside the glass the ball settles after a goal (the housing's
 *  pocket seat, measured from the glass along the axis). */
export const DG_POCKET_DEPTH = 5;

/** Distance from the bell's axis to each hole's rim plane: the x where a
 *  DG_HOLE_R hole's edge meets the sphere. The drawn rings sit here. */
export const DG_RING_OFFSET = Math.sqrt(
  DEEPGLASS_RADIUS * DEEPGLASS_RADIUS - DG_HOLE_R * DG_HOLE_R,
);

export const DG_RING_WEST_X = DEEPGLASS_CENTER.x - DG_RING_OFFSET;
export const DG_RING_EAST_X = DEEPGLASS_CENTER.x + DG_RING_OFFSET;

/** The bell's cross-section radius at a ring plane — the "mouth" the ring
 *  hangs inside. With the ring planes at the hole rims this IS the hole
 *  radius; kept as a derived export so render consumers cannot drift. */
export const DG_RING_MOUTH_R = Math.sqrt(
  DEEPGLASS_RADIUS * DEEPGLASS_RADIUS - DG_RING_OFFSET * DG_RING_OFFSET,
);

/** Where each goal HOUSING (the authored gate model, render-only dressing)
 *  roots: just outside the glass on the goal axis. */
export const DG_GOAL_HOUSING_OFFSET = DEEPGLASS_RADIUS + 2.2;

// ---------------------------------------------------------------------------
// Kickoff spawns (world coords, 3D). Team A in the west half facing east.
// Index 0 is the kickoff taker. Team B mirrors across the bell's axis, exactly
// as VC_SPAWNS_B does today.
// ---------------------------------------------------------------------------

export interface DgSpawnPoint extends Vec3 {
  facing: number;
}

// facing: the sim convention is facing f points along (sin f, cos f).
const FACE_EAST = Math.PI / 2;
const FACE_WEST = -Math.PI / 2;

/** Seats as OFFSETS from the bell's centre, in the pre-scale geometry. Every
 *  position inside the sphere is written this way so one factor moves the whole
 *  arena and nothing can be left behind at an old absolute coordinate. */
const SPAWN_OFFSETS: readonly { x: number; y: number; z: number }[] = [
  { x: -8, y: 0, z: 0 }, // kickoff taker, near centre
  { x: -18, y: 9, z: 10 },
  { x: -18, y: -9, z: -10 },
  { x: -26, y: 7, z: -12 },
  { x: -26, y: -7, z: 12 },
];

/** Lift an in-bell offset into world coordinates at the current arena scale. */
export function dgPoint(dx: number, dy: number, dz: number): Vec3 {
  return {
    x: DEEPGLASS_CENTER.x + dx * DG_ARENA_SCALE,
    y: DEEPGLASS_CENTER.y + dy * DG_ARENA_SCALE,
    z: DEEPGLASS_CENTER.z + dz * DG_ARENA_SCALE,
  };
}

export const DG_SPAWNS_A: readonly DgSpawnPoint[] = SPAWN_OFFSETS.map((o) => ({
  ...dgPoint(o.x, o.y, o.z),
  facing: FACE_EAST,
}));

export const DG_SPAWNS_B: readonly DgSpawnPoint[] = DG_SPAWNS_A.map((s) => ({
  x: 2 * DEEPGLASS_CENTER.x - s.x,
  y: s.y,
  z: s.z,
  facing: FACE_WEST,
}));

/** Where the ball is placed for a kickoff. */
export const DG_BALL_KICKOFF: Vec3 = { ...DEEPGLASS_CENTER };

/** Where a DEMOLISHED body comes back: in front of its own goal, facing the
 *  play (team A defends the west ring, so it respawns west and faces east).
 *  Rocket League's respawn seat, one per side. */
export const DG_RESPAWN_A: DgSpawnPoint = { ...dgPoint(-28, 0, 0), facing: FACE_EAST };
export const DG_RESPAWN_B: DgSpawnPoint = {
  x: 2 * DEEPGLASS_CENTER.x - DG_RESPAWN_A.x,
  y: DG_RESPAWN_A.y,
  z: DG_RESPAWN_A.z,
  facing: FACE_WEST,
};

// ---------------------------------------------------------------------------
// Boost pads. Twelve lit vents, SYMMETRIC under the x-mirror so neither half is
// favoured: one at the centre, four on the centre ring, three per half.
// ---------------------------------------------------------------------------

export const DG_PAD_RADIUS = 2.5; // pickup reach

/**
 * A lit vent. `big` ones fill the tank outright; the rest are top-ups.
 *
 * The split is Rocket League's, and it is what makes the bell a MAP rather than
 * an empty sphere: the five full vents sit on the x = 0 plane, so every one of
 * them is equidistant from both goals and has to be contested, while the small
 * ones lie on the running lines toward each ring where you take them in passing.
 */
export interface DgBoostPad extends Vec3 {
  big: boolean;
}

function mirrorPads(half: readonly DgBoostPad[]): DgBoostPad[] {
  const out: DgBoostPad[] = [];
  for (const p of half) {
    out.push(p);
    out.push({ x: 2 * DEEPGLASS_CENTER.x - p.x, y: p.y, z: p.z, big: p.big });
  }
  return out;
}

export const DG_BOOST_PADS: readonly DgBoostPad[] = [
  // dead centre — the contested one
  { ...dgPoint(0, 0, 0), big: true },
  // the centre ring: four pads on the x = 0 plane, above/below/north/south
  { ...dgPoint(0, 22, 0), big: true },
  { ...dgPoint(0, -22, 0), big: true },
  { ...dgPoint(0, 0, 22), big: true },
  { ...dgPoint(0, 0, -22), big: true },
  // three per half, on the run toward each ring
  ...mirrorPads([
    { ...dgPoint(-16, 11, 14), big: false },
    { ...dgPoint(-16, -11, -14), big: false },
    { ...dgPoint(-24, 0, 0), big: false },
  ]),
];

// ---------------------------------------------------------------------------
// Powerups. Two of them, on the bell's vertical axis so neither half is
// favoured and both are a genuine detour off the midfield running lines: you
// have to leave the ball to go and get one.
// ---------------------------------------------------------------------------

export type DgPowerupKind = 'zap' | 'overburn';

export interface DgPowerupSite extends Vec3 {
  kind: DgPowerupKind;
}

/** Reach for taking a powerup. Wider than a boost vent — this is a prize, and
 *  missing it by half a yard at 26 yd/s is not interesting. */
export const DG_POWERUP_RADIUS = 3.4;

export const DG_POWERUP_SITES: readonly DgPowerupSite[] = [
  // The floor of the bell: the Tidewarden's Lance, deep down where you have to
  // dive off the play to fetch it.
  { ...dgPoint(0, -27, 0), kind: 'zap' },
  // The crown: Overburn, the mirror climb.
  { ...dgPoint(0, 27, 0), kind: 'overburn' },
];

// ---------------------------------------------------------------------------
// Pure geometry helpers. Everything that asks "where is this relative to the
// bell?" routes through here so no consumer can drift.
// ---------------------------------------------------------------------------

/** Squared distance from the bell's centre. */
export function distSqFromCentre(x: number, y: number, z: number): number {
  const dx = x - DEEPGLASS_CENTER.x;
  const dy = y - DEEPGLASS_CENTER.y;
  const dz = z - DEEPGLASS_CENTER.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Inside the playable volume (a body's clamp radius).
 *
 *  The tolerance is load-bearing, not decoration: {@link clampToBell} lands a
 *  body EXACTLY on the clamp sphere, and `centre + delta * (radius / d)` can
 *  round a unit or two past `radius`. Without the slack, a body the clamp just
 *  placed would immediately read as outside. */
const BELL_EPS = 1e-6;
export function insideBell(x: number, y: number, z: number): boolean {
  const limit = DEEPGLASS_PLAY_R + BELL_EPS;
  return distSqFromCentre(x, y, z) <= limit * limit;
}

/** Inside the bell's ground SHADOW — the footprint the overhang covers. Used by
 *  the world build to keep the slate clear and by the render for the cradle. */
export function inBellShadow(x: number, z: number): boolean {
  const dx = x - DEEPGLASS_CENTER.x;
  const dz = z - DEEPGLASS_CENTER.z;
  return dx * dx + dz * dz <= DEEPGLASS_RADIUS * DEEPGLASS_RADIUS;
}

/**
 * Clamp a point back inside the bell, returning true when it had escaped. The
 * body is pushed along the radial normal to exactly `radius` from the centre —
 * the player counterpart to the ball's analytic reflection.
 */
export function clampToBell(p: Vec3, radius = DEEPGLASS_PLAY_R): boolean {
  const dx = p.x - DEEPGLASS_CENTER.x;
  const dy = p.y - DEEPGLASS_CENTER.y;
  const dz = p.z - DEEPGLASS_CENTER.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 <= radius * radius) return false;
  const d = Math.sqrt(d2) || 1;
  const k = radius / d;
  p.x = DEEPGLASS_CENTER.x + dx * k;
  p.y = DEEPGLASS_CENTER.y + dy * k;
  p.z = DEEPGLASS_CENTER.z + dz * k;
  return true;
}

/** Unit inward normal of the glass at a point (points back toward the centre).
 *  Writes into `out` to stay allocation-free on the tick path. */
export function bellInwardNormal(p: Vec3, out: Vec3): void {
  const dx = DEEPGLASS_CENTER.x - p.x;
  const dy = DEEPGLASS_CENTER.y - p.y;
  const dz = DEEPGLASS_CENTER.z - p.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  out.x = dx / d;
  out.y = dy / d;
  out.z = dz / d;
}

// The old segment/ring-plane goal test (ringCrossed) is gone: scoring is
// escape through a hole now, and it lives with the ball physics
// (ball.ts escapedThroughHole) where the glass reflection also lives.

/** Centre of a side's ring: A defends west, B defends east. */
export function ringCentreFor(side: 'A' | 'B'): Vec3 {
  return {
    x: side === 'A' ? DG_RING_WEST_X : DG_RING_EAST_X,
    y: DEEPGLASS_CENTER.y,
    z: DEEPGLASS_CENTER.z,
  };
}

/** The ring a side ATTACKS (the opposite one). */
export function targetRingFor(side: 'A' | 'B'): Vec3 {
  return ringCentreFor(side === 'A' ? 'B' : 'A');
}

// ---------------------------------------------------------------------------
// The seating bowl. These used to live in render/deepglass_stadium.ts alone,
// with the crowd cards keeping a numeric-identical mirror; now the WORLD needs
// them too (the bowl finally collides), so they graduate to the layout module
// like every other number three consumers must agree on. The stadium draws
// these, deepglass_crowd_cards seats fans on them, and world.ts stands blockers
// on them — none of the three may restate a figure.
// ---------------------------------------------------------------------------

/** Inner lip of the seating bowl — clear of the bell's shadow. */
export const DG_BOWL_INNER_R = DEEPGLASS_RADIUS + 14;
/** Outer wall of the bowl. */
export const DG_BOWL_OUTER_R = DEEPGLASS_RADIUS + 50;
export const DG_BOWL_TIERS = 6;
export const DG_BOWL_TOP_Y = 27;
/** The north entrance: radians of the bowl left open for the causeway. */
export const DG_BOWL_GAP = 0.42;
/** The processional causeway in from the arrival point. */
export const DG_CAUSEWAY_HALF_W = 7;
export const DG_CAUSEWAY_Z_NEAR = DEEPGLASS_RADIUS + 3;
export const DG_CAUSEWAY_Z_FAR = DEEPGLASS_RADIUS + 62;
/** Top face of the causeway's raised deck (the walkable floor height). */
export const DG_CAUSEWAY_DECK_TOP_Y = 0.55;

// ---------------------------------------------------------------------------
// Team identity
// ---------------------------------------------------------------------------

/**
 * The two sides' colours, and the ONE place they are written down.
 *
 * Amber defends the west ring, Tide the east. Three surfaces show this and they
 * must not drift, because the whole point is that a player reads a side at a
 * glance: the score strip (ui/deepglass_hud.ts), the aura shell around every
 * body (render/deepglass_aura.ts), and the nameplate text
 * (render/nameplate_painter.ts). It lives here for the same reason every other
 * shared number does — this module is the source of truth no consumer may
 * re-derive — even though a colour is otherwise a presentation concern.
 */
export const DG_TEAM_COLOR: Readonly<Record<'A' | 'B', number>> = {
  A: 0xffc27a, // Amber
  B: 0x7fd8ff, // Tide
};

/** The same two colours as CSS hex, for the DOM surfaces. */
export function dgTeamCss(side: 'A' | 'B'): string {
  return `#${DG_TEAM_COLOR[side].toString(16).padStart(6, '0')}`;
}

/** The side's name, as the HUD and the goal callout say it. */
export const DG_TEAM_NAME: Readonly<Record<'A' | 'B', string>> = {
  A: 'Amber',
  B: 'Tide',
};

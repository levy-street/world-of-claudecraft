// Pure planning math for Balgath's ranged-punish kit and his cleave telegraph (see
// balgath_ranged_fx.ts for the Three half).
//
// Three/DOM/i18n-free and deterministic: the caller passes normalized progress, never a
// clock, so a Vitest drives every curve directly and the RENDER_PURE_CORES purity sweep in
// tests/architecture.test.ts covers the file.

/**
 * The cue ids and the soak mark, agreed with the sim rather than imported from it.
 *
 * mob/boss_ranged_mechanics.ts is a SimContext consumer; importing it here would drag the
 * simulation into the render bundle for four strings. tests/balgath_ranged_fx_core.test.ts
 * welds each one to the sim's own export instead.
 */
export const BALGATH_BOULDER_ABILITY = 'mob_balgath_boulder';
export const BALGATH_GLARE_ABILITY = 'mob_balgath_glare';
export const BALGATH_BURDEN_ABILITY = 'mob_balgath_burden';
export const BALGATH_BURDEN_AURA_ID = 'balgath_barrow_burden';

/** Half the glare line's width, yards; matches the template's glare.halfWidth. */
export const BALGATH_GLARE_HALF_WIDTH = 2.5;
/** Radius of the burden soak circle, yards; matches the template's burden.radius. */
export const BALGATH_BURDEN_RADIUS = 6;

/**
 * Seconds into the boulder wind-up at which the rock leaves his hands: the release frame
 * of the authored Balgath_Toss clip. The flight takes whatever is left of the wind-up, so
 * the rock always lands on the tick the damage does.
 */
export const BALGATH_BOULDER_RELEASE_SECONDS = 1.45;
/** Seconds the rock is still in the ground before he tears it free. */
export const BALGATH_BOULDER_RIP_SECONDS = 0.55;
/** Seconds by which the rock is held over his head. */
export const BALGATH_BOULDER_LIFT_SECONDS = 1.1;

/**
 * Where his fists hold the boulder, in multiples of his entity scale off his feet and
 * facing: forward, to each side, and up. MEASURED on the Balgath_Toss clip (forward
 * kinematics on the shipped rig, tests/balgath_boss_assets.test.ts re-measures them): the
 * dig at the rip frame has the fists 1.27 ahead and 0.67 out; at the lift frame they are
 * overhead, 0.47 ahead and 0.70 out with the wrists at 3.64 up, so the rock between the
 * palms rides at about 3.9. The old Tripo body heaved it to 3.35; this one lifts it clear
 * over his crown.
 */
export const BALGATH_BOULDER_GRIP = Object.freeze({ forward: 1.27, side: 0.67 });
export const BALGATH_BOULDER_OVERHEAD = Object.freeze({ forward: 0.47, side: 0.7, height: 3.9 });

/** World radius of the thrown boulder (the GLB is normalized to a unit radius). */
export const BALGATH_BOULDER_SCALE = 1.4;

/** Camera trauma for the ranged landings: a boulder is a jolt, the burden a slam. */
export const BALGATH_BOULDER_TRAUMA = 0.32;
export const BALGATH_BURDEN_TRAUMA = 0.36;
export const BALGATH_GLARE_TRAUMA = 0.18;

/** How long the fired glare beam stays on screen, seconds. */
export const BALGATH_GLARE_BEAM_SECONDS = 0.7;
/** How long the shatter chunks of a landed boulder fly, seconds. */
export const BALGATH_SHATTER_SECONDS = 1.3;
/** How long the cleave's travelling dust wave takes to cross the arc, seconds. */
export const BALGATH_CLEAVE_WAVE_SECONDS = 0.42;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The ground mark's fill fraction at wind-up progress `t` (0..1).
 *
 * Grows from the centre out and reaches the rim EXACTLY at the landing, so "the fill hit
 * the edge" is the read for "it lands now". Eased so the last half second visibly
 * accelerates: that is when the decision to move has to have been made.
 */
export function telegraphFill(t: number): number {
  const x = clamp01(t);
  return 0.08 + 0.92 * x * x * (1.35 - 0.35 * x);
}

/**
 * Rim pulse brightness at wind-up progress `t`: a steady beat that quickens toward the
 * landing. `reducedMotion` pins it to a constant, since the fill already carries timing.
 */
export function telegraphRimAlpha(t: number, elapsed: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.95;
  const rate = 4 + 10 * clamp01(t);
  return 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(elapsed * rate));
}

/**
 * Where the boulder is, `elapsed` seconds into a wind-up of `duration` seconds.
 *
 * Three beats, matching the clip: it sits in the ground at his hands until he tears it
 * free, rises to over his head, then leaves his hands at the release frame and flies a
 * parabola that lands on `land` exactly when the wind-up ends. `hand` is the grip point
 * low in front of him, `overhead` the lifted point.
 */
export function boulderPosition(
  elapsed: number,
  duration: number,
  hand: Vec3Like,
  overhead: Vec3Like,
  land: Vec3Like,
): Vec3Like {
  const release = Math.min(BALGATH_BOULDER_RELEASE_SECONDS, duration * 0.8);
  const lift = Math.min(BALGATH_BOULDER_LIFT_SECONDS, release * 0.8);
  const rip = Math.min(BALGATH_BOULDER_RIP_SECONDS, lift * 0.6);
  if (elapsed <= rip) return { ...hand };
  if (elapsed <= lift) {
    const k = easeInOut((elapsed - rip) / Math.max(0.001, lift - rip));
    return lerp3(hand, overhead, k);
  }
  if (elapsed <= release) {
    // A short wind back before the throw.
    const k = (elapsed - lift) / Math.max(0.001, release - lift);
    return { x: overhead.x, y: overhead.y + Math.sin(k * Math.PI) * 0.6, z: overhead.z };
  }
  const k = clamp01((elapsed - release) / Math.max(0.001, duration - release));
  const flat = lerp3(overhead, land, k);
  const span = Math.hypot(land.x - overhead.x, land.z - overhead.z);
  const apex = Math.max(5, span * 0.32);
  return { x: flat.x, y: flat.y + 4 * apex * k * (1 - k), z: flat.z };
}

/** Whether the rock has left his hands yet (drives the dust trail and the tumble). */
export function boulderInFlight(elapsed: number, duration: number): boolean {
  return elapsed > Math.min(BALGATH_BOULDER_RELEASE_SECONDS, duration * 0.8);
}

function lerp3(a: Vec3Like, b: Vec3Like, k: number): Vec3Like {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

function easeInOut(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * The world-space corners of the glare line's rectangle (origin end first), for a line
 * of `length` along unit (dirX, dirZ). Drawn at exactly the width the sim hits.
 */
export function glareRectCorners(
  originX: number,
  originZ: number,
  dirX: number,
  dirZ: number,
  length: number,
  halfWidth = BALGATH_GLARE_HALF_WIDTH,
): [number, number][] {
  const px = dirZ;
  const pz = -dirX;
  const ex = originX + dirX * length;
  const ez = originZ + dirZ * length;
  return [
    [originX + px * halfWidth, originZ + pz * halfWidth],
    [originX - px * halfWidth, originZ - pz * halfWidth],
    [ex - px * halfWidth, ez - pz * halfWidth],
    [ex + px * halfWidth, ez + pz * halfWidth],
  ];
}

/**
 * Where the cleave's travelling wave is along the arc, as an angle offset from the aim,
 * `elapsed` seconds after the arm lands. The arm sweeps from the -half edge to the +half
 * edge (the direction the sim carries a player who jumped it), so the dust follows it.
 */
export function cleaveWaveAngle(elapsed: number, halfArc: number): number {
  const k = clamp01(elapsed / BALGATH_CLEAVE_WAVE_SECONDS);
  return -halfArc + 2 * halfArc * k;
}

/**
 * Height of the cleave's "jump" chevrons above the ground at wind-up progress `t`: they
 * climb as the arm comes, so the telegraph literally points up.
 */
export function cleaveChevronLift(t: number, elapsed: number, reducedMotion: boolean): number {
  const base = 0.35 + 1.1 * clamp01(t);
  if (reducedMotion) return base;
  return base + 0.18 * Math.sin(elapsed * 9);
}

/**
 * The burden vortex's spin (radians per second) and how far it has come down toward the
 * carrier's head at progress `t`: it starts high and lazy and ends low and fast, so the
 * landing is readable from the vortex alone.
 */
export function burdenVortexPlan(t: number): { spin: number; height: number; radius: number } {
  const x = clamp01(t);
  return { spin: 1.4 + 6.2 * x * x, height: 5.4 - 1.6 * x, radius: 1.7 - 0.55 * x };
}

/** Occupancy the burden marker shows: players inside its circle, as the sim counts them. */
export function playersInsideBurden(
  center: { x: number; z: number },
  players: Iterable<{ pos: { x: number; z: number }; dead?: boolean }>,
  radius = BALGATH_BURDEN_RADIUS,
): number {
  let n = 0;
  for (const p of players) {
    if (p.dead) continue;
    if (Math.hypot(p.pos.x - center.x, p.pos.z - center.z) <= radius) n++;
  }
  return n;
}

/**
 * Seconds the burden mark outlives its wind-up (the sim's BURDEN_AURA_GRACE, welded by
 * tests/balgath_ranged_fx_core.test.ts): the mark is stripped on the landing tick.
 */
export const BALGATH_BURDEN_AURA_GRACE = 0.25;

/**
 * Burden wind-up progress from its aura: 0 at the mark, 1 at the landing. The grace the
 * mark carries past the landing is taken off both ends, so the timer ring closes exactly
 * when the weight comes down rather than a quarter second early.
 */
export function burdenProgress(aura: { remaining?: number; duration?: number }): number {
  const windup = Math.max(0.01, (aura.duration ?? 0.01) - BALGATH_BURDEN_AURA_GRACE);
  return clamp01(1 - ((aura.remaining ?? 0) - BALGATH_BURDEN_AURA_GRACE) / windup);
}

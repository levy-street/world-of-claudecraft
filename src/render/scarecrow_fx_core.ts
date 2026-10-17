// Old Thatchgrin's visual layer, the pure half (no Three, no DOM): where his thrown gourd
// flies, how a burning patch of stubble fades in and gutters out, and how much fire a
// patch throws at each quality. scarecrow_fx.ts owns the objects and reads these.
//
// Timing contract with the sim and the clip (seasonal/scarecrow_kit.ts, scarecrow_clips.py):
// the ring goes down at the throw's START and the gourd lands when the ring's windup ends.
// The clip releases at GOURD_RELEASE_SEC, so the gourd is in the air for the rest of the
// windup and lands on the ring's last frame.

export const THATCHGRIN_TEMPLATE = 'gourdlight_thatchgrin';
export const GOURD_ABILITY = 'mob_thatchgrin_gourd';
export const CHAFF_ABILITY = 'mob_thatchgrin_chaff';
export const SUMMON_ABILITY = 'mob_thatchgrin_summon';

/** Seconds into the Throw clip when the gourd leaves his left hand. */
export const GOURD_RELEASE_SEC = 1.0;
/** Seconds into the Summon clip when his arms peak and the crows burst off. */
export const SUMMON_PEAK_SEC = 1.4;
/** Death clip beats: the stakes fold, the heap lands (scarecrow_clips.py death_keys). */
export const DEATH_FOLD_SEC = 1.3;
export const DEATH_HEAP_SEC = 1.9;

/** The left hand at release, in the boss's own frame (world yards at his drawn size):
 *  to his left, out in front, high over his head. */
export const GOURD_HAND_LOCAL = { left: 1.4, forward: 1.6, up: 6.2 } as const;

/** World point of a local (left, forward, up) offset from a body at (x, z) facing `facing`. */
export function bodyLocalToWorld(
  x: number,
  z: number,
  facing: number,
  left: number,
  forward: number,
): { x: number; z: number } {
  // the rig's left is model +X, which a facing of f turns to (cos f, -sin f)
  return {
    x: x + Math.cos(facing) * left + Math.sin(facing) * forward,
    z: z - Math.sin(facing) * left + Math.cos(facing) * forward,
  };
}

/** A lobbed arc from a to b: straight in plan, a parabola over it peaking `apex` above
 *  the higher end at the middle. `t` 0..1. */
export function gourdArc(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number,
  apex: number,
): { x: number; y: number; z: number } {
  const k = Math.max(0, Math.min(1, t));
  const lift = 4 * apex * k * (1 - k);
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k + lift,
    z: a.z + (b.z - a.z) * k,
  };
}

/** How high the lob climbs: a short throw still arcs, a long one arcs higher. */
export function gourdApex(distance: number): number {
  return 2.5 + Math.min(1, distance / 40) * 5.5;
}

/** A burning patch's strength 0..1: it catches over the first 0.35 s, burns steady, and
 *  gutters out over its last 1.2 s. */
export function chaffStrength(age: number, total: number): number {
  if (age < 0 || age >= total) return 0;
  const catchUp = Math.min(1, age / 0.35);
  const left = total - age;
  const gutter = Math.min(1, left / 1.2);
  return catchUp * gutter;
}

/** Flame embers a patch emits per frame call at a quality 0..1 (the floor keeps the patch
 *  readable on the lowest tier: burning ground is something a player acts on). */
export function chaffFlameCalls(quality: number): number {
  return Math.max(3, Math.round(3 + 5 * Math.max(0, Math.min(1, quality))));
}

// ---------------------------------------------------------------------------
// Gourdfall (the pumpkin rain) and the Swelling Gourd (seasonal/scarecrow_kit.ts,
// scarecrow_swell.ts): the pure timing and shaping scarecrow_fx.ts draws from.
// ---------------------------------------------------------------------------

export const SWELL_ABILITY = 'mob_thatchgrin_swell';
export const SWELLING_GOURD_TEMPLATE = 'gourdlight_swelling_gourd';

/** Seconds a falling pumpkin is visible before it lands: it drops out of the sky on a
 *  steep slant, so the ring reads first and the pumpkin arrives on the ring's last frame. */
export const FALL_SEC = 0.85;
/** Where a falling pumpkin starts, relative to its ring: high overhead, a little off to
 *  one side so the trail reads as a slant, not a stalk. */
export const FALL_HEIGHT = 26;
export const FALL_SLANT = 7;

/** The visible window of the i-th pumpkin of a rain whose ring went down at `ringAt` and
 *  lands `landIn` seconds later: it appears FALL_SEC before landing (never before the ring). */
export function fallWindow(ringAt: number, landIn: number): { start: number; end: number } {
  const end = ringAt + Math.max(0.05, landIn);
  return { start: Math.max(ringAt, end - FALL_SEC), end };
}

/** A falling pumpkin's point at t (0..1): a straight slanted drop, gently accelerating. */
export function fallPoint(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  const k = Math.max(0, Math.min(1, t));
  const e = k * k * 0.35 + k * 0.65;
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    z: from.z + (to.z - from.z) * e,
  };
}

/** The sky point a pumpkin falls from, for a ring at (x, z) on ground y, slanted by an
 *  angle derived from the ring itself (deterministic, so two clients agree). */
export function fallOrigin(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const a = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % (Math.PI * 2);
  return { x: x + Math.cos(a) * FALL_SLANT, y: y + FALL_HEIGHT, z: z + Math.sin(a) * FALL_SLANT };
}

/** Seconds the gourd heaves up out of the stubble at its rise. */
export const SWELL_RISE_SEC = 0.9;

/** The Swelling Gourd's drawn size, from its fuse progress `p` (0 at the rise, 1 at the
 *  burst), the seconds since it rose, and a free-running clock `time`: it heaves up from
 *  the ground with a little overshoot, then swells steadily as it ripens, and in the last
 *  quarter of its fuse throbs faster and faster, the read that it is about to go. */
export function swellScale(p: number, sinceRise: number, time: number): number {
  const q = Math.max(0, Math.min(1, p));
  const r = Math.max(0, Math.min(1, sinceRise / SWELL_RISE_SEC));
  const back = 1 + 2.2 * (r - 1) ** 3 + 1.2 * (r - 1) ** 2;
  const rise = 0.2 + 0.8 * back;
  const swell = 1 + 0.42 * q ** 1.5;
  return rise * swell * (1 + swellThrob(q, time) * 0.05);
}

/** The late-fuse throb, -1..1 (0 for the first three quarters of the fuse): its rate
 *  climbs from 3 to 13 beats a second as the fuse runs out. */
export function swellThrob(p: number, time: number): number {
  const late = Math.max(0, (Math.max(0, Math.min(1, p)) - 0.75) / 0.25);
  if (late <= 0) return 0;
  const hz = 3 + 10 * late;
  return Math.sin(time * hz * Math.PI * 2) * late;
}

/** The gourd's inner glow (halo opacity 0..1): a low ember at its rise, blazing at its
 *  burst, pulsing with the throb. */
export function swellGlow(p: number, time: number): number {
  const q = Math.max(0, Math.min(1, p));
  return Math.max(0, Math.min(1, 0.3 + 0.6 * q + 0.15 * swellThrob(q, time)));
}

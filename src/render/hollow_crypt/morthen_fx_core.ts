// PURE plan of Morthen the Lich Bishop's own presentation (morthen_fx.ts, his
// Blender body scripts/assets/hollow_crypt_creatures/build_morthen.py): which
// stance he holds (the bell staff, or after his Last Rites the scythe it
// unfolds into), the rig gestures that switch it, where his soul fire, smoke
// and bell sit on the body, and the timings of the transform, the scythe
// trails and the dissolve. No three, no DOM, no clock of its own; in
// RENDER_PURE_CORES, tested by tests/morthen_lich.test.ts.
//
// The stance is read off his health fraction alone, a field every host
// mirrors (the offline Sim and the online ClientWorld alike), so every client
// sees the staff unfold at the same line with no wire or IWorld change: the
// transform is presentation, never a mechanic.

import { MORTHEN_LAST_RITES_FRACTION } from '../../sim/encounters/hollow_crypt/ids';

export type MorthenStance = 'staff' | 'scythe';

/** Rig gestures (VisualDef.phaseClips / attackByAbility keys, never casts). */
export const MORTHEN_SCYTHE_UNFOLD = 'crypt_morthen_scythe_unfold';
export const MORTHEN_SCYTHE_HELD = 'crypt_morthen_scythe_held';
export const MORTHEN_STAFF_HELD = 'crypt_morthen_staff_held';
/** The Shadow Pulse's gesture: the bell tolled (or the scythe raised). */
export const MORTHEN_TOLL = 'crypt_morthen_toll';

/** Above this health fraction he is whole again (a wipe, an evade): the blade
 *  folds back into the staff. The gap to the Last Rites line is hysteresis, so
 *  a heal inside the phase never flips the stance back and forth. */
export const MORTHEN_STAFF_RESTORED_FRACTION = 0.95;

/** The stance for this health fraction, given the last one (null: first sight). */
export function morthenStance(prev: MorthenStance | null, hpFraction: number): MorthenStance {
  if (!Number.isFinite(hpFraction)) return prev ?? 'staff';
  if (hpFraction <= MORTHEN_LAST_RITES_FRACTION) return 'scythe';
  if (hpFraction >= MORTHEN_STAFF_RESTORED_FRACTION) return 'staff';
  return prev ?? 'staff';
}

/**
 * The gesture to hand the rig for a stance step. Only a live staff-to-scythe
 * edge plays the unfolding (the Transform clip); first sight, a late joiner and
 * the periodic refresh all swap silently, and a restored staff never replays
 * anything.
 */
export function morthenStanceGesture(prev: MorthenStance | null, next: MorthenStance): string {
  if (next === 'scythe') return prev === 'staff' ? MORTHEN_SCYTHE_UNFOLD : MORTHEN_SCYTHE_HELD;
  return MORTHEN_STAFF_HELD;
}

/** Seconds between the idempotent stance refreshes (a rebuilt or re-pooled
 *  visual starts on the staff; the next refresh puts the scythe back). */
export const MORTHEN_STANCE_REFRESH_SEC = 1;

// ---- the body, measured off the Blender rig (authored yards, x right, y up, z forward) ----
/** The soul fire caged in his ribs. */
export const MORTHEN_RIBS = { x: 0, y: 3.45, z: 0.16 } as const;
/** The slit eye of soul fire on his mitre's front plate (rest pose; the v2
 *  body dropped the shoulder candles, so the sparks rise off the mitre). */
export const MORTHEN_MITRE_EYE = { x: 0, y: 5.3, z: 0.32 } as const;
/** The base of the smoke he trails. */
export const MORTHEN_SMOKE_BASE = { x: 0, y: 0.6, z: 0 } as const;
/** The reach of his scythe from his centre (the trail's radius). */
export const MORTHEN_SCYTHE_REACH = 4.2;

/** A body point in the world: authored offset scaled, turned by his facing. */
export function morthenAnchor(
  pos: { x: number; y: number; z: number },
  facing: number,
  scale: number,
  at: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  return {
    x: pos.x + (at.x * c + at.z * s) * scale,
    y: pos.y + at.y * scale,
    z: pos.z + (-at.x * s + at.z * c) * scale,
  };
}

// ---- timings (seconds; the clips are keyed at 24 fps) -----------------------------------------
/** The blade leaves the crest this long into the Transform clip (frames 15 to 25). */
export const TRANSFORM_UNFOLD_SEC = 0.85;
/** The great reaping arc that ends the unfolding lands across his front (frame 54). */
export const TRANSFORM_SLAM_SEC = 2.2;
/** A melee swing's cut (frames 9 to 16 at the default 1.3 attack rate), after the hit event. */
export const SWING_CUT_START_SEC = 0.24;
export const SWING_CUT_SEC = 0.28;
/** The staff strike's bell meets its victim (frame 14 at 1.3). */
export const STAFF_STRIKE_SEC = 0.42;
/** The dissolve after death: the smoke rises and the souls leave for this long. */
export const DISSOLVE_SEC = 3.2;

/** How far round its arc a swing's trail has cut `t` seconds after the hit
 *  (null before it starts and after it fades). `head` is the leading edge,
 *  `tail` the fading one, both 0..1 of the arc; `alpha` the trail's strength. */
export function scytheTrail(t: number): { head: number; tail: number; alpha: number } | null {
  const k = (t - SWING_CUT_START_SEC) / SWING_CUT_SEC;
  if (k < 0 || k > 1.6) return null;
  const head = Math.min(1, k * k * (3 - 2 * k) * 1.05);
  const tail = Math.max(0, Math.min(1, (k - 0.35) / 1.2));
  const alpha = k <= 1 ? 1 : Math.max(0, 1 - (k - 1) / 0.6);
  return { head, tail, alpha };
}

// ---- the souls he hoards --------------------------------------------------------------------
// Soul flames circle him, drawn by the effect layer as soft light trailing ghost fire back
// along the orbit (the Blender body carries no solid souls).
export const MORTHEN_SOUL_COUNT = 6;
/** The orbit's radius at rest (authored yards); a cast draws it wider. */
export const MORTHEN_SOUL_RADIUS = 1.6;
/** The orbit's mean height (authored yards), about his ribs. */
export const MORTHEN_SOUL_HEIGHT = 3.3;

/**
 * Where soul `k` flies `t` seconds in, as an authored offset from his centre (x right,
 * y up, z forward). A cast widens, lifts and hurries the ring (he gathers them); the
 * scythe stance hurries it further.
 */
export function soulOrbit(
  k: number,
  t: number,
  casting: boolean,
  rites: boolean,
): { x: number; y: number; z: number } {
  return soulOrbitInto({ x: 0, y: 0, z: 0 }, k, t, casting, rites);
}

/** soulOrbit into a caller-owned point (the per-frame path allocates nothing). */
export function soulOrbitInto<T extends { x: number; y: number; z: number }>(
  out: T,
  k: number,
  t: number,
  casting: boolean,
  rites: boolean,
): T {
  const speed = (rites ? 1.25 : 0.85) * (casting ? 1.6 : 1);
  const a = t * speed + (k * Math.PI * 2) / MORTHEN_SOUL_COUNT;
  const r = MORTHEN_SOUL_RADIUS * (casting ? 1.3 : 1) * (1 + 0.1 * Math.sin(t * 0.7 + k * 2.1));
  out.x = Math.cos(a) * r;
  out.y = MORTHEN_SOUL_HEIGHT + (casting ? 0.5 : 0) + 0.55 * Math.sin(t * 0.8 + k * 1.7);
  out.z = Math.sin(a) * r;
  return out;
}

/** The dissolve's smoke rate and soul release (0..1) `t` seconds after death. */
export function dissolveLevels(t: number): { smoke: number; souls: number; flash: number } {
  if (t < 0 || t > DISSOLVE_SEC) return { smoke: 0, souls: 0, flash: 0 };
  const smoke = t < 0.4 ? t / 0.4 : Math.max(0, 1 - (t - 0.4) / (DISSOLVE_SEC - 0.4)) ** 0.7;
  const souls = t < 0.6 ? 0 : Math.max(0, 1 - (t - 0.6) / 1.8);
  const flash = Math.max(0, 1 - t / 0.5);
  return { smoke, souls, flash };
}

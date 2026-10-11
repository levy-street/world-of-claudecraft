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

/** Reap the Unquiet lands: the scythe brought round in a flat reaping sweep
 *  (the ScytheSweep one-shot; the bar itself winds up on ScytheSummon). */
export const MORTHEN_REAP_SWEEP = 'crypt_morthen_reap_sweep';

// ---- how he floats -----------------------------------------------------------------------
// He never touches the floor, but he must not tower out of the default camera
// either: the soul-smoke funnel under his robes SINKS into the floor (the rite
// ring swallowing it), so the whole body and the face under the mitre read
// from the camera a player fights him with, while the robes still trail over
// the flags and the smoke still boils out round him. One constant drives the
// manifest's `hover`, every body anchor below and the corpse's rise.

/** The rig's lowest point over its origin half a second into Idle (the smoke
 *  funnel's tip), in authored yards: the art guide's body draws 2.28 yd per rig
 *  unit at its manifest `height`, and the tip sits 0.073 units up. */
export const MORTHEN_REST_MINZ = 0.166;
/** How deep (authored yards) his smoke funnel sinks under the floor: most of
 *  it, so the lowest tatters of his robe still float clear of the flags (rig
 *  1.23, about 0.4 yd up at his 1.35) over the smoke's last wisps. */
export const MORTHEN_SINK = 0.92;
/** The manifest's `hover` for crypt_morthen_lich (the funnel tip this far
 *  under the pivot). */
export const MORTHEN_HOVER = MORTHEN_REST_MINZ - MORTHEN_SINK;
/** Where the rig's origin sits over his pivot (authored yards): every body
 *  anchor below is measured in the rig's own frame and lifted by this. */
export const MORTHEN_RIG_Y = MORTHEN_HOVER - MORTHEN_REST_MINZ;

/** How much larger than his authored rig he is drawn, over his template scale:
 *  grown so he stands as tall over the flags as the body he replaced (7.85 yd at
 *  his 1.35; the authored rig alone stood 6.88), his mitre eye 6.8 yd up. */
export const MORTHEN_GROWTH = 1.14;

/** World yards per authored yard for a Morthen of template `scale`: what every
 *  body anchor below is multiplied by. */
export function morthenDrawScale(scale: number): number {
  return (scale || 1) * MORTHEN_GROWTH;
}

/** The lowest an emitter on his body may sit over the floor under him (his
 *  smoke base is under the floor now: it boils out at the flags instead). */
export function morthenEmitY(anchorY: number, floorY: number, scale: number): number {
  return Math.max(anchorY, floorY + 0.3 * scale);
}

// ---- the body, measured off the Blender rig (authored yards, x right, y up, z forward) ----
/** The soul fire caged in his ribs (the green glow under the cope's clasp). */
export const MORTHEN_RIBS = { x: 0, y: 4.15, z: 0.36 } as const;
/** The green eye on his mitre's front plate (rest pose; the sparks rise off it). */
export const MORTHEN_MITRE_EYE = { x: 0, y: 5.34, z: 0.46 } as const;
/** The base of the smoke he trails. */
export const MORTHEN_SMOKE_BASE = { x: 0, y: 0.6, z: 0 } as const;
/** The reach of his scythe from his centre (the trail's radius): the blade's
 *  tip crosses his front 1.8 to 2.8 yd out. */
export const MORTHEN_SCYTHE_REACH = 2.5;
/** The rig-frame height (authored yards) both reaps cross his front at: he
 *  stoops into the cut, so the blade passes at a player's chest. */
export const MORTHEN_SCYTHE_Y = 2.5;

/** A body point in the world: authored (rig-frame) offset lifted onto his
 *  pivot (MORTHEN_RIG_Y, the sink), scaled, turned by his facing. */
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
    y: pos.y + (at.y + MORTHEN_RIG_Y) * scale,
    z: pos.z + (-at.x * s + at.z * c) * scale,
  };
}

/** A rig-frame height (authored yards) over his pivot in the world. */
export function morthenBodyY(pivotY: number, rigY: number, scale: number): number {
  return pivotY + (rigY + MORTHEN_RIG_Y) * scale;
}

// ---- timings (seconds; the clips are keyed at 30 fps, frame 1 at 0 s) ---------------------------
/** The blade leaves the crest this long into the Transform clip (frames 22 to 34). */
export const TRANSFORM_UNFOLD_SEC = 0.85;
/** The great reaping arc that ends the unfolding lands across his front (frame 67). */
export const TRANSFORM_SLAM_SEC = 2.2;
/** A melee swing's cut (frames 10 to 21 at the default 1.3 attack rate), after the hit event. */
export const SWING_CUT_START_SEC = 0.24;
export const SWING_CUT_SEC = 0.28;
/** The staff strike's ring head meets its victim (frame 17 at 1.3). */
export const STAFF_STRIKE_SEC = 0.42;
/** The dissolve after death: the smoke rises and the souls leave for this long. */
export const DISSOLVE_SEC = 3.2;
/** As he falls, the body is lifted back out of the floor by the sink, over
 *  this share of his Death clip (from the reel at frame 7 to the heap at
 *  frame 42 of 75), so the folded vestments come to rest ON the flags. In the
 *  manifest's units (his authored yards grown by MORTHEN_GROWTH). */
export const MORTHEN_DEATH_LIFT = {
  yards: MORTHEN_SINK * MORTHEN_GROWTH,
  from: 0.1,
  to: 0.55,
} as const;

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
export const MORTHEN_SOUL_HEIGHT = 4.0;

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

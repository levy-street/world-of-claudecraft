// Pure plan for the Sunken Bastion's fifth-pass visuals (bastion_gaol_fx.ts and
// bastion_reaper_fx.ts): how the Turnkey's cage shadow and Ossick's anchor mark
// fill, how hot the anchor chain runs as its victim nears the pit, how a
// shackle pair's chain hangs or strains, and how the reaper's pool and sweep
// fill before the scythe lands. Every answer derives from the sim's own
// encounter constants, so the ring a player reads is the reach the sim tests.
//
// Three-free, DOM-free, deterministic.

import {
  OSSICK_TUNING,
  PIT_RIM,
  shackleRange,
  TURNKEY_TUNING,
  VAEL_TUNING,
} from '../../sim/encounters/sunken_bastion/ids';

/** The cage shadow's radius under a marked player (the cage's own footprint). */
export const CAGE_MARK_RADIUS = 1.9;
/** The anchor mark's radius under its target (the victim's own spot). */
export const ANCHOR_MARK_RADIUS = 1.6;
/** Where the anchor's ring sits on its body (the winch chain's end), in yards
 *  up from its foot (gaol_props.py ANCHOR_H plus the ring). */
export const ANCHOR_RING_HEIGHT = 4.5;
/** The pit's rim, the line a hauled player must never reach. */
export const PIT_RIM_RADIUS = PIT_RIM;
/** How long the pool shows before the scythe lands (the sweep fan's clock). */
export const REAPER_WARNING_SECONDS = VAEL_TUNING.poolSeconds + VAEL_TUNING.riseSeconds;
/** The sweep's reach and arc, exactly the sim's. */
export const REAPER_SWEEP_RANGE = VAEL_TUNING.sweepRange;
export const REAPER_SWEEP_ARC_DEG = VAEL_TUNING.sweepArcDeg;
/** The shadow pool's own disc (under the rising reaper). */
export const REAPER_POOL_RADIUS = 2.4;
/** The heroic Grave Shadow's burning reach, exactly the sim's. */
export const GRAVE_SHADOW_RADIUS = VAEL_TUNING.graveRadius;

/** Ossick's anchor slung on his back is its own mesh: it hides while an anchor of
 *  his lies on a victim (the one he threw, hauled by the winch) and is back on
 *  him once none does. The gaol effects re-send the gesture, so a view built
 *  mid-fight shows the right state (VisualDef.meshToggles). */
export const OSSICK_ANCHOR_BACK_MESH = 'OssickAnchorBack';
export const OSSICK_ANCHOR_AWAY_GESTURE = 'bastion_ossick_anchor_away';
export const OSSICK_ANCHOR_HOME_GESTURE = 'bastion_ossick_anchor_home';

/** The gesture for Ossick's slung anchor given how many thrown anchors lie out. */
export function ossickAnchorGesture(anchorsOut: number): string {
  return anchorsOut > 0 ? OSSICK_ANCHOR_AWAY_GESTURE : OSSICK_ANCHOR_HOME_GESTURE;
}

/** 0..1 how far the reaper's warning has run, from the pool's first sight. */
export function reaperWarningFill(age: number): number {
  if (REAPER_WARNING_SECONDS <= 0) return 1;
  return Math.min(1, Math.max(0, age / REAPER_WARNING_SECONDS));
}

/** 0 when the anchor bites, 1 at the pit's rim: the chain heats as it hauls. */
export function anchorHeat(dist: number, startDist: number): number {
  const span = startDist - PIT_RIM;
  if (span <= 1e-6) return 1;
  return Math.min(1, Math.max(0, 1 - (dist - PIT_RIM) / span));
}

/** The shackle chain between a pair `dist` apart with `range` of reach: its
 *  sag (slack hangs, taut is straight), and whether it bites. */
export function shackleLook(
  dist: number,
  range: number,
): { strained: boolean; sag: number; tension: number } {
  const r = range > 0 ? range : shackleRange(false);
  const tension = Math.min(1, Math.max(0, dist / r));
  return { strained: dist > r, sag: Math.max(0.05, (r - dist) * 0.28), tension };
}

/** The ring the pair must keep inside: centred between them, half the reach. */
export function shackleRingRadius(range: number): number {
  return (range > 0 ? range : shackleRange(false)) / 2;
}

/** The escape the cage shows on its own body (the same number the prompt
 *  reads): 0 locked to 1 broken. */
export function cageCrack(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - hp / maxHp));
}

/** Seconds a cage stands before it crushes (for the cage's ember warning). */
export const CAGE_CRUSH_SECONDS = TURNKEY_TUNING.cageMax;
/** Seconds the winch holds before it hauls (the chain winds taut). */
export const ANCHOR_SETTLE_SECONDS = OSSICK_TUNING.anchorSettle;

// ---- the Fog Veil's emergence -------------------------------------------------------

/** Vael's Emerge clip (scripts/assets/sunken_bastion_creatures/reaper.py: keys
 *  1 to 15 at 24 fps), shared by the Reaping Scythe's rise and the veil's. */
export const VAEL_EMERGE_CLIP_SECONDS = 15 / 24;
/** The rate that plays Emerge ONCE over the veil's rise bar (the clip is half
 *  the bar: at rate 1 it looped, the figure rising, dropping back under the
 *  flags and rising again). */
export const VAEL_VEIL_RISE_CLIP_RATE = VAEL_EMERGE_CLIP_SECONDS / VAEL_TUNING.veilRiseSeconds;

/** The Emerge clip's root height (model units over the feet) at its keys,
 *  clip seconds: under the flags, rising, the wind-up at full height. */
const EMERGE_ROOT: readonly (readonly [number, number])[] = [
  [0, -10.5],
  [5 / 24, -3.5],
  [10 / 24, 0.19],
  [VAEL_EMERGE_CLIP_SECONDS, 0.19],
];
/** How deep the root sits when the whole figure is under the flags. */
const EMERGE_UNDER = 10.5;

/** 0..1 how much of a rising figure stands above the flags, `age` seconds
 *  into the veil's rise (the clip at its rise rate). */
export function veilRiseEmerged(age: number): number {
  const t = Math.max(0, age) * VAEL_VEIL_RISE_CLIP_RATE;
  let root = EMERGE_ROOT[EMERGE_ROOT.length - 1][1];
  for (let i = 0; i + 1 < EMERGE_ROOT.length; i++) {
    const [t0, y0] = EMERGE_ROOT[i];
    const [t1, y1] = EMERGE_ROOT[i + 1];
    if (t > t1) continue;
    root = y0 + (y1 - y0) * ((t - t0) / (t1 - t0));
    break;
  }
  return Math.min(1, Math.max(0, 1 + root / EMERGE_UNDER));
}

/** How long the dark water keeps boiling after a figure has risen. */
export const VEIL_BOIL_FADE_SECONDS = 0.9;
/** The boil's full radius on the flags round a rising figure. */
export const VEIL_BOIL_RADIUS = 4.2;

/** The dark water boiling on the flags where a veil figure rises, `age`
 *  seconds into its rise: it wells up before the hood breaks the surface,
 *  holds while the body climbs out, and drains away once it stands. */
export function veilBoilAlpha(age: number): number {
  if (age < 0) return 0;
  const rise = VAEL_TUNING.veilRiseSeconds;
  const swell = Math.min(1, age / 0.18);
  const drain = age <= rise ? 1 : Math.max(0, 1 - (age - rise) / VEIL_BOIL_FADE_SECONDS);
  return swell * drain;
}

/** The boil's spread (share of VEIL_BOIL_RADIUS) `age` seconds into the rise. */
export function veilBoilScale(age: number): number {
  if (age < 0) return 0;
  const grow = Math.min(1, age / 0.45);
  return 0.55 + 0.45 * (1 - (1 - grow) * (1 - grow));
}

/** Whether a figure's boil has fully drained. */
export function veilBoilDone(age: number): boolean {
  return age > VAEL_TUNING.veilRiseSeconds + VEIL_BOIL_FADE_SECONDS;
}

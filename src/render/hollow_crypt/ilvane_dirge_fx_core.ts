// PURE (RENDER_PURE_CORES): the plan of Cantor Ilvane's Dirge of the Hollow
// (ilvane_dirge_fx.ts), every clock and size read off the sim's tuning
// (src/sim/encounters/hollow_crypt/ilvane_ids.ts) and its loft layout. No
// Three, no DOM, no clock of its own: a Vitest drives any moment of the song.
//
//   the build-up   her swell over the bar: the dark aura round her widening
//                  and rising, the shadow choir's voices spiralling up it, the
//                  Bone Organ's pipes kindling behind her (dirgeSwell,
//                  voiceSpiral, ORGAN_PIPES);
//   the sight cue  the loft floor she can see (exposed) and the hatched
//                  shadow wedges the choir pillars throw (the shared sight
//                  field, ../trash_engine_fx/sight_field_core.ts, out to the
//                  sim's own dirgeRadius); a beam of song to every player she
//                  sees;
//   the release    a shock of dark sound racing out over the lit floor and
//                  stopping dead at each pillar (dirgeWave), the silenced
//                  marked for as long as the silence holds (silenceMark).

import { HOLLOW_CRYPT_FIELD } from '../../sim/content/hollow_crypt_layout';
import { ILVANE_TUNING } from '../../sim/encounters/hollow_crypt/ilvane_ids';

/** The Dirge's reach on the floor: the sim's own radius, never a look. */
export const DIRGE_RADIUS = ILVANE_TUNING.dirgeRadius;

/** Seconds the shock of sound takes to race out to the radius, and how long
 *  its dark wake lingers on the lit floor after it passes. */
export const DIRGE_WAVE_SECONDS = 0.6;
export const DIRGE_WAVE_LINGER = 1.1;

/** Height (yd over her floor) of her voice, at her heart where the song rises
 *  (the Sing clip's chest at its peak): the beams and the burst leave it. */
export const DIRGE_VOICE_Y = 4.4;

export interface DirgeSwell {
  /** The aura's radius and height round her (yd). */
  radius: number;
  height: number;
  /** 0..1 strength of the aura, the voices and the organ's kindling. */
  power: number;
  /** Seconds between two shadow voices leaving her (fewer early, a choir late). */
  voiceEvery: number;
}

/** Her swell `fill` (0 as the bar opens, 1 as it lands) into the bar. */
export function dirgeSwell(fill: number): DirgeSwell {
  const f = Math.min(1, Math.max(0, fill));
  // Slow to gather, then a surge in the last third (the song's crescendo).
  const ease = f * f * (3 - 2 * f);
  const surge = Math.max(0, (f - 0.66) / 0.34);
  return {
    radius: 1.6 + 1.8 * ease + 0.6 * surge * surge,
    height: 3.2 + 4.3 * ease,
    power: Math.min(1, 0.25 + 0.6 * ease + 0.3 * surge),
    voiceEvery: 0.11 - 0.07 * ease,
  };
}

/** The `k`-th of `n` shadow voices `t` seconds into its climb: where it is
 *  round her (angle in radians, sim convention, radius and height in yd). */
export function voiceSpiral(
  t: number,
  k: number,
  n: number,
): { angle: number; radius: number; height: number } {
  const phase = (k / Math.max(1, n)) * Math.PI * 2;
  return {
    angle: phase + t * 2.4,
    radius: 1.4 + 0.9 * Math.sin(t * 1.7 + k),
    height: 0.4 + t * 2.2,
  };
}

/** The shock of sound `elapsed` seconds after the Dirge landed: its front
 *  (yd out) and its brightness. */
export function dirgeWave(
  elapsed: number,
  radius = DIRGE_RADIUS,
): { front: number; alpha: number } {
  const t = Math.min(1, Math.max(0, elapsed / DIRGE_WAVE_SECONDS));
  const ease = 1 - (1 - t) ** 2.2;
  const after = Math.max(0, elapsed - DIRGE_WAVE_SECONDS);
  const alpha = elapsed < DIRGE_WAVE_SECONDS ? 1 : Math.max(0, 1 - after / DIRGE_WAVE_LINGER);
  return { front: radius * ease, alpha };
}

/** A silence mark's strength: a pop as it lands, steady, then a fade over its
 *  last second (`remaining` of the aura's `duration` seconds). */
export function silenceMark(remaining: number, duration: number): number {
  if (remaining <= 0 || duration <= 0) return 0;
  const age = duration - remaining;
  const pop = Math.min(1, age / 0.15);
  const out = Math.min(1, remaining / 1);
  return Math.max(0, Math.min(pop, out));
}

/** A pop scale for the silence mark (overshoots as it lands). */
export function silenceMarkScale(remaining: number, duration: number): number {
  const age = Math.max(0, duration - remaining);
  if (age >= 0.35) return 1;
  const k = age / 0.35;
  return 0.4 + 0.6 * k + 0.35 * Math.sin(k * Math.PI);
}

/** One pipe of the Bone Organ (instance-local): its foot and its length. */
export interface OrganPipe {
  x: number;
  z: number;
  /** Its foot over the loft floor, and its length up from there (yd). */
  base: number;
  length: number;
  /** Seed (0..1) for its flicker. */
  seed: number;
}

const ORGAN = HOLLOW_CRYPT_FIELD.props.find((p) => p.kind === 'hc_bone_organ');

/**
 * The Bone Organ's pipes, read off the organ prop: a rank across its width,
 * tallest in the middle, just in front of its face (the organ faces the loft,
 * down -z).
 */
export const ORGAN_PIPES: readonly OrganPipe[] = (() => {
  if (!ORGAN) return [];
  const half = (ORGAN.hw ?? 9) - 1.2;
  const depth = ORGAN.hd ?? 1.4;
  const tall = ORGAN.h ?? 12;
  const n = 9;
  const out: OrganPipe[] = [];
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    out.push({
      x: ORGAN.x + u * half,
      z: ORGAN.z - depth - 0.25,
      base: 2.4,
      length: (tall - 3.2) * (1 - 0.42 * u * u),
      seed: (((i * 0.618) % 1) + 1) % 1,
    });
  }
  return out;
})();

/** Where the organ stands (instance-local), for its swell and its burst. */
export const ORGAN_SPOT: { x: number; z: number } = ORGAN
  ? { x: ORGAN.x, z: ORGAN.z }
  : { x: 0, z: 170 };

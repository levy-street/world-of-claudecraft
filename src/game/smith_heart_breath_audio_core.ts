// WHICH sound the Smith's Heart's Guardian of the Breath makes, and WHEN
// (docs/design/raid/smith_heart.md 7.2). Pure: no WebAudio, no DOM. The
// adapter (smith_heart_breath_audio.ts) plays these off the fight's own cues
// (the `spellfx` events breath_ids.ts BREATH_CUES and breath_isle_ids.ts
// ISLE_CUES name), the wind object's phases, the guardian's bars, the Knotted
// Gale's balls and the local player's own auras, all mirrored entity state,
// so offline and online sound the same.
//
//   a cue          a positioned one-shot, one or two layers (a strike, the
//                  leaping bolt, the cradle's discharge, the tear, the swell,
//                  a gale's toss, the calm landing, a player over the lip, the
//                  Summit Roar and its wave, the isles' rides and Bulwark)
//   the wind       a gathering howl before each blow, the gale's loop while
//                  it blows (and phase 2's gusts), a dying sigh into the calm
//   a bar          its charge sized to the bar (the indrawn breath, the
//                  storm breaking)
//   the gales      a whirling loop at the nearest loose gale (heroic)
//   the Knotted    (mythic) its own takes: the ball dropping, taken up, carried
//   Gale           (a loop at the carrier), its fuse running out (a WARNING),
//                  the portals opening and crossed, the throw, the burst
//   the ride       the wind past a rider's ears, a loop while they ride
//   the marks      a mark landing on the local player (Drawn Lightning, a
//                  portal opening at their feet), in their own ear
//
// Every sample is the fight's own (`heart_breath_*`, scripts/sfx/
// sfx_prompts.mjs and smith_heart_mechanic_sfx.mjs). Readable, punchy, never
// tiring: the strikes of a barrage fall close together, so they are cooled.
// A WARNING (a fuse, a portal opening, the gather) swells with no hit; an
// IMPACT (a strike, the burst, the roar's wave) is a hard transient.

import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  type BreathWindPhase,
} from '../sim/encounters/smith_heart/breath_ids';
import { ISLE_AURAS, ISLE_CUES } from '../sim/encounters/smith_heart/breath_isle_ids';
import { HEART_MARK, type HeartMarkSound, markSound } from './smith_heart_mark_audio';

export interface BreathSound {
  key: string;
  gain: number;
  rate: number;
  cooldown: number;
  at: 'source' | 'target' | 'point';
}

const S = (
  key: string,
  gain: number,
  at: BreathSound['at'],
  rate = 1,
  cooldown = 0.08,
): BreathSound => ({ key: `heart_breath_${key}`, gain, rate, cooldown, at });

/** The layered one-shot each fight cue plays (keyed by the cue's ability id). */
export const BREATH_CUE_SOUNDS: Readonly<Record<string, readonly BreathSound[]>> = {
  // The Summit Roar leaves the maw: the mountain's blast over the exhale.
  [BREATH_CUES.gust]: [S('summit_roar', 1, 'source'), S('exhale', 0.55, 'source')],
  // Its wave strikes a player (many at once: one voice, cooled).
  [BREATH_CUES.roarHit]: [S('roar_hit', 0.9, 'target', 1, 0.12)],
  // A barrage drops two strikes at once, every 0.8 s: one voice, cooled.
  [BREATH_CUES.strike]: [S('strike', 0.9, 'point', 1, 0.18)],
  // Each leg of the fork is a cue: one zap per leg.
  [BREATH_CUES.fork]: [S('fork', 0.85, 'target', 1, 0.07)],
  [BREATH_CUES.discharge]: [S('discharge', 1, 'point')],
  [BREATH_CUES.tear]: [S('tear', 1, 'source')],
  [BREATH_CUES.swell]: [S('swell', 0.55, 'source', 1, 1.5)],
  [BREATH_CUES.toss]: [S('toss', 0.85, 'target', 1, 0.25)],
  [BREATH_CUES.calmLand]: [S('calm_land', 0.8, 'point')],
  // The Knotted Gale (mythic): its own takes.
  [BREATH_CUES.knotLand]: [S('knot_spawn', 1, 'point', 1, 0.3)],
  [BREATH_CUES.portalOpen]: [S('portal_open', 0.9, 'point', 1, 0.2)],
  // The second pair (C and D) pitched lower: the same take, told apart by ear.
  [BREATH_CUES.portalOpenPair2]: [S('portal_open', 0.9, 'point', 0.82, 0.2)],
  [BREATH_CUES.knotTake]: [S('knot_take', 1, 'point', 1, 0.2)],
  [BREATH_CUES.portalHop]: [S('portal_hop', 1, 'target', 1.08, 0.1)],
  [BREATH_CUES.portalHopPair2]: [S('portal_hop', 1, 'target', 0.9, 0.1)],
  [BREATH_CUES.knotThrow]: [S('knot_throw', 1, 'point', 1, 0.2)],
  [BREATH_CUES.knotBurst]: [
    S('knot_burst', 1, 'point', 1, 0.5),
    S('discharge', 0.45, 'point', 0.8, 0.5),
  ],
  [BREATH_CUES.anchor]: [S('calm_land', 0.4, 'target', 1.35, 0.2)],
  [BREATH_CUES.fall]: [S('fall', 0.9, 'point', 1, 0.4)],
  // The Islands of the Wind.
  [ISLE_CUES.bulwarkUp]: [S('bulwark_up', 1, 'source', 1, 0.5)],
  [ISLE_CUES.bulwarkBreak]: [S('bulwark_break', 1, 'source', 1, 0.5)],
  // Held too long, it bursts by itself on the raid: the break, deeper, and a blast.
  [ISLE_CUES.bulwarkBurst]: [
    S('bulwark_break', 1, 'source', 0.8, 0.5),
    S('knot_burst', 0.7, 'source', 0.9, 0.5),
  ],
  [ISLE_CUES.mended]: [S('calm_land', 0.45, 'target', 1.2, 0.6)],
  [ISLE_CUES.rideUp]: [S('ride_up', 1, 'point', 1, 0.3)],
  [ISLE_CUES.rideDown]: [S('ride_down', 0.9, 'point', 1, 0.3)],
  [ISLE_CUES.isleWake]: [S('isle_wake', 0.9, 'point', 1, 0.3)],
};

/** Is this event's ability one the fight's sound plays (the HUD's generic
 *  nova or burst sound skipped for it)? */
export function breathSoundClaims(ability: string | undefined): boolean {
  return ability !== undefined && Object.hasOwn(BREATH_CUE_SOUNDS, ability);
}

/** A bar's charge: its sample and the sample's own length in seconds. */
export interface BreathBarSound {
  key: string;
  seconds: number;
  gain: number;
}

export const BREATH_BAR_SOUNDS: Readonly<Record<string, BreathBarSound>> = {
  [BREATH_CASTS.inhale]: { key: 'heart_breath_inhale', seconds: 5, gain: 1 },
  [BREATH_CASTS.storm]: { key: 'heart_breath_storm_break', seconds: 4, gain: 1 },
};

/** A bar's charge fitted to its bar, kept within a breath of its own pitch. */
export function breathBarRate(sound: BreathBarSound, barSeconds: number): number {
  if (!(barSeconds > 0)) return 1;
  return Math.max(0.85, Math.min(1.2, sound.seconds / barSeconds));
}

/** The wind's own sounds. */
export const BREATH_WIND_SOUNDS = {
  gather: { key: 'heart_breath_gather', gain: 0.85 },
  calm: { key: 'heart_breath_calm', gain: 0.6 },
  blow: { key: 'heart_breath_blow_loop', gain: 0.7, fadeOut: 1.2 },
  gale: { key: 'heart_breath_gale_loop', gain: 0.65, fadeOut: 0.6 },
} as const;

/** What a change of the wind's phase plays: a one-shot at the change, and
 *  whether the gale's loop runs through the new phase. */
export function windPhaseSound(
  from: BreathWindPhase | null,
  to: BreathWindPhase | null,
): { oneShot: 'gather' | 'calm' | null; blowing: boolean } {
  const blowing = to === 'blow' || to === 'gust';
  if (to === from) return { oneShot: null, blowing };
  if (to === 'gather' || to === 'gustgather') return { oneShot: 'gather', blowing };
  if ((from === 'blow' || from === 'gust') && !blowing) return { oneShot: 'calm', blowing };
  return { oneShot: null, blowing };
}

/** The Knotted Gale's loop and its fuse: the carried ball churning at its
 *  carrier, and the fuse's WARNING once a ball has `fuseWarnAt` seconds left. */
export const BREATH_KNOT_SOUNDS = {
  carry: { key: 'heart_breath_knot_carry_loop', gain: 0.7, fadeOut: 0.4 },
  fuse: { key: 'heart_breath_knot_fuse', gain: 1 },
  /** 3 s since the fuse was halved to 10 s (2026-11-07): at 5 s it rang over
   *  the portals opening. */
  fuseWarnAt: 3,
} as const;

/** The wind past a rider's ears while the gale carries them. */
export const BREATH_RIDE_LOOP = {
  key: 'heart_breath_ride_loop',
  gain: 0.65,
  fadeOut: 0.8,
} as const;

/** Does a ball's fuse going `from` to `to` seconds sound its warning (once,
 *  as it passes the mark)? */
export function knotFuseWarnDue(from: number, to: number): boolean {
  return from > BREATH_KNOT_SOUNDS.fuseWarnAt && to <= BREATH_KNOT_SOUNDS.fuseWarnAt && to > 0;
}

/** The fight's marks in the marked player's own ear. */
export const BREATH_MARK_SOUNDS: Readonly<Record<string, HeartMarkSound>> = {
  [BREATH_AURAS.drawn]: HEART_MARK.storm,
  [BREATH_AURAS.portalA]: markSound(HEART_MARK.storm, 0.85, 1.1),
  [BREATH_AURAS.portalB]: markSound(HEART_MARK.storm, 0.85, 1.1),
  [BREATH_AURAS.portalC]: markSound(HEART_MARK.storm, 0.85, 0.9),
  [BREATH_AURAS.portalD]: markSound(HEART_MARK.storm, 0.85, 0.9),
};

/** The aura a rider wears through the ride (its loop in their ears). */
export const BREATH_RIDING_AURA = ISLE_AURAS.riding;

/** Every sample the fight plays, for preloading once. */
export const BREATH_SFX_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(BREATH_CUE_SOUNDS).flatMap((list) => list.map((s) => s.key)),
    ...Object.values(BREATH_BAR_SOUNDS).map((s) => s.key),
    ...Object.values(BREATH_WIND_SOUNDS).map((s) => s.key),
    ...Object.values(BREATH_MARK_SOUNDS).map((s) => s.key),
    BREATH_KNOT_SOUNDS.carry.key,
    BREATH_KNOT_SOUNDS.fuse.key,
    BREATH_RIDE_LOOP.key,
  ]),
].sort();

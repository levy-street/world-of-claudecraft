// WHICH sound the Smith's Heart's Guardian of the Breath makes, and WHEN
// (docs/design/raid/smith_heart.md 7.2). Pure: no WebAudio, no DOM. The
// adapter (smith_heart_breath_audio.ts) plays these off the fight's own cues
// (the `spellfx` events breath_ids.ts BREATH_CUES names), the wind object's
// phases and the guardian's bars, all mirrored entity state, so offline and
// online sound the same.
//
//   a cue          one positioned one-shot (a strike, the leaping bolt, the
//                  cradle's discharge, the tear, the swell, a gale's toss,
//                  the calm landing, a player over the lip, the exhale)
//   the wind       a gathering howl before each blow, the gale's loop while
//                  it blows (and phase 2's gusts), a dying sigh into the calm
//   a bar          its charge sized to the bar (the indrawn breath, the
//                  storm breaking)
//   the gales      a whirling loop at the nearest loose gale (heroic)
//
// Every sample is the fight's own (`heart_breath_*`, scripts/sfx/
// sfx_prompts.mjs). Readable, punchy, never tiring: the strikes of a barrage
// fall close together, so they are cooled.

import {
  BREATH_CASTS,
  BREATH_CUES,
  type BreathWindPhase,
} from '../sim/encounters/smith_heart/breath_ids';

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

/** The one-shot each fight cue plays (keyed by the cue's ability id). */
export const BREATH_CUE_SOUNDS: Readonly<Record<string, BreathSound>> = {
  [BREATH_CUES.gust]: S('exhale', 1, 'source'),
  // A barrage drops two strikes at once, every 0.8 s: one voice, cooled.
  [BREATH_CUES.strike]: S('strike', 0.9, 'point', 1, 0.18),
  // Each leg of the fork is a cue: one zap per leg, a little higher each.
  [BREATH_CUES.fork]: S('fork', 0.85, 'target', 1, 0.07),
  [BREATH_CUES.discharge]: S('discharge', 1, 'point'),
  [BREATH_CUES.tear]: S('tear', 1, 'source'),
  [BREATH_CUES.swell]: S('swell', 0.55, 'source', 1, 1.5),
  [BREATH_CUES.toss]: S('toss', 0.85, 'target', 1, 0.25),
  [BREATH_CUES.calmLand]: S('calm_land', 0.8, 'point'),
  [BREATH_CUES.anchor]: S('calm_land', 0.4, 'target', 1.35, 0.2),
  [BREATH_CUES.fall]: S('fall', 0.9, 'point', 1, 0.4),
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

/** Every sample the fight plays, for preloading once. */
export const BREATH_SFX_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(BREATH_CUE_SOUNDS).map((s) => s.key),
    ...Object.values(BREATH_BAR_SOUNDS).map((s) => s.key),
    ...Object.values(BREATH_WIND_SOUNDS).map((s) => s.key),
  ]),
].sort();

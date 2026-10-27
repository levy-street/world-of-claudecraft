// WHICH sound the Smith's Heart's Guardian of the Quench makes, and WHEN
// (docs/design/raid/smith_heart.md 7.3). Pure: no WebAudio, no DOM. The
// adapter (smith_heart_quench_audio.ts) plays these off the fight's own cues
// (the `spellfx` events quench_ids.ts QUENCH_CUES names), the guardian's
// awakening bar, the cracks as they appear and the local player's own cold,
// all mirrored entity state, so offline and online sound the same.
//
//   a cue        one positioned one-shot (a freeze, a shatter, a hole
//                opening, a plunge and a climb, the blades waking, an echo,
//                the crossing, the shore ice heaving up, the lake refreezing)
//   a crack      the ice groaning where a crack appears
//   the bar      the awakening's charge fitted to its bar
//   the cold     a frosty breath in the local player's ear as their own bar
//                passes three quarters (their warning, once each rise)
//
// Every sample is the fight's own (`heart_quench_*`, scripts/sfx/
// sfx_prompts.mjs). Readable, punchy, never tiring: the four blades echo
// together, so an echo is one voice, cooled.

import { QUENCH_CASTS, QUENCH_CUES } from '../sim/encounters/smith_heart/quench_ids';

export interface QuenchSound {
  key: string;
  gain: number;
  rate: number;
  cooldown: number;
  at: 'source' | 'target' | 'point';
}

const S = (
  key: string,
  gain: number,
  at: QuenchSound['at'],
  rate = 1,
  cooldown = 0.08,
): QuenchSound => ({ key: `heart_quench_${key}`, gain, rate, cooldown, at });

/** The one-shot each fight cue plays (keyed by the cue's ability id). */
export const QUENCH_CUE_SOUNDS: Readonly<Record<string, QuenchSound>> = {
  [QUENCH_CUES.freeze]: S('freeze', 0.9, 'target', 1, 0.15),
  [QUENCH_CUES.shatter]: S('shatter', 1, 'point', 1, 0.12),
  [QUENCH_CUES.hole]: S('hole', 1, 'point', 1, 0.2),
  [QUENCH_CUES.plunge]: S('plunge', 0.9, 'target', 1, 0.15),
  [QUENCH_CUES.climb]: S('climb', 0.7, 'target', 1, 0.2),
  [QUENCH_CUES.wake]: S('wake', 1, 'source'),
  // The four blades echo together: one voice, cooled.
  [QUENCH_CUES.echo]: S('echo', 0.9, 'point', 1, 0.3),
  [QUENCH_CUES.cross]: S('cross', 1, 'point', 1, 0.5),
  [QUENCH_CUES.rim]: S('rim', 0.9, 'source', 1, 1),
  [QUENCH_CUES.thaw]: S('rim', 0.7, 'source', 0.85, 1),
};

/** Is this event's ability one the fight's sound plays (the HUD's generic
 *  nova or burst sound skipped for it)? */
export function quenchSoundClaims(ability: string | undefined): boolean {
  return ability !== undefined && Object.hasOwn(QUENCH_CUE_SOUNDS, ability);
}

/** The ice groaning under a crack as it appears. */
export const QUENCH_CRACK_SOUND = { key: 'heart_quench_crack', gain: 0.8, cooldown: 0.4 } as const;

/** The local player's own cold past three quarters (the shared frost cast
 *  sample, soft, until the fight has a take of its own). */
export const QUENCH_COLD_SOUND = { key: 'cast_frost', gain: 0.45, at: 75 } as const;

/** A bar's charge: its sample and the sample's own length in seconds. */
export interface QuenchBarSound {
  key: string;
  seconds: number;
  gain: number;
}

export const QUENCH_BAR_SOUNDS: Readonly<Record<string, QuenchBarSound>> = {
  [QUENCH_CASTS.wake]: { key: 'heart_quench_wake_charge', seconds: 4, gain: 1 },
};

/** A bar's charge fitted to its bar, kept within a breath of its own pitch. */
export function quenchBarRate(sound: QuenchBarSound, barSeconds: number): number {
  if (!(barSeconds > 0)) return 1;
  return Math.max(0.85, Math.min(1.2, sound.seconds / barSeconds));
}

/** Does the local player's cold crossing from `from` to `to` sound its
 *  warning (the rise past the mark; once until it falls back under)? */
export function coldWarningDue(from: number, to: number): boolean {
  return from < QUENCH_COLD_SOUND.at && to >= QUENCH_COLD_SOUND.at;
}

/** Every sample the fight plays, for preloading once. */
export const QUENCH_SFX_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(QUENCH_CUE_SOUNDS).map((s) => s.key),
    ...Object.values(QUENCH_BAR_SOUNDS).map((s) => s.key),
    QUENCH_CRACK_SOUND.key,
    QUENCH_COLD_SOUND.key,
  ]),
].sort();

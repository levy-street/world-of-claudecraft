// WHICH sound the Smith's Heart's Hammer Council makes, and WHEN (docs/design/
// raid/smith_heart.md 5.18 and 7.1). Pure: no WebAudio, no DOM. The adapter
// (smith_heart_council_audio.ts) plays these off the council's own cues (the
// `spellfx` events council_ids.ts COUNCIL_CUES names) and off the cast bars and
// marks every client already mirrors, so offline and online sound the same.
//
//   a cue          one positioned one-shot (a pillar rising, cracking, falling,
//                  the rock landing, a soul taking the stone, a pip struck, a
//                  soul pillar bursting, the Echo's blast, a slab's crush, the
//                  Wrath landing, a Seam Bolt, Hammer's Weight)
//   a bar          its charge, sized to the bar (Mountain's Wrath, the Echo of
//                  Wrath, the Song of the Seam)
//   the rock       its fall, as the boulder comes into view over its soak
//   the slab       a grinding loop while a Walking Slab drags itself
//   the song       each Endless Song pulse louder and deeper as the song grows
//
// Every sample is the council's own (`heart_council_*`, scripts/sfx/
// sfx_prompts.mjs). Readable, punchy, never tiring: a cue repeated every two
// seconds (the heroic pulse) is kept low and cooled down.

import {
  COUNCIL_CASTS,
  COUNCIL_CUES,
  endlessSongMult,
  COUNCIL_TUNING as T,
} from '../sim/encounters/smith_heart/council_ids';

export interface CouncilSound {
  key: string;
  gain: number;
  /** Playback rate: below 1 is deeper and slower. */
  rate: number;
  /** Seconds before the same key may play again. */
  cooldown: number;
  /** Where it plays: the event's source entity, its target, or its point. */
  at: 'source' | 'target' | 'point';
}

const S = (
  key: string,
  gain: number,
  at: CouncilSound['at'],
  rate = 1,
  cooldown = 0.08,
): CouncilSound => ({ key: `heart_council_${key}`, gain, rate, cooldown, at });

/** The one-shot each council cue plays (keyed by the cue's ability id). */
export const COUNCIL_CUE_SOUNDS: Readonly<Record<string, CouncilSound>> = {
  [COUNCIL_CUES.rise]: S('pillar_rise', 0.95, 'source'),
  [COUNCIL_CUES.crack]: S('pillar_crack', 0.85, 'source'),
  [COUNCIL_CUES.collapse]: S('pillar_collapse', 1, 'point'),
  [COUNCIL_CUES.settle]: S('pillar_collapse', 0.45, 'point', 0.8, 0.4),
  [COUNCIL_CUES.rockImpact]: S('rock_impact', 1, 'point'),
  // Every standing pillar pulses on the same tick: one soft hum, cooled.
  [COUNCIL_CUES.pulse]: S('pillar_pulse', 0.32, 'source', 1, 1.2),
  [COUNCIL_CUES.inherit]: S('soul_take', 0.6, 'target', 0.85, 0.5),
  [COUNCIL_CUES.soulTake]: S('soul_take', 1, 'target'),
  [COUNCIL_CUES.soulPip]: S('soul_pip', 1, 'source'),
  [COUNCIL_CUES.soulBurst]: S('soul_burst', 1, 'point'),
  [COUNCIL_CUES.echoBlast]: S('echo_blast', 1, 'source'),
  [COUNCIL_CUES.slabCrush]: S('slab_crush', 1, 'target', 1, 0.3),
  // The song's pulse grows: songPulseSound below sets its gain and rate.
  [COUNCIL_CUES.songPulse]: S('song_pulse', 0.6, 'source'),
  // The Wrath landing (its nova on the caster), a Seam Bolt on its mark,
  // Hammer's Weight's slab on the tank.
  [COUNCIL_CASTS.wrath]: S('wrath_blast', 1, 'source'),
  [COUNCIL_CASTS.bolt]: S('seam_bolt', 0.85, 'target', 1, 0.15),
  [COUNCIL_CASTS.weight]: S('rock_impact', 0.7, 'target', 1.25),
};

/** Is this event's ability one the council's sound plays (the HUD's generic
 *  nova sound skipped for it)? */
export function councilSoundClaims(ability: string | undefined): boolean {
  return ability !== undefined && Object.hasOwn(COUNCIL_CUE_SOUNDS, ability);
}

/** The Endless Song's pulse at `pulses` sung before it: louder and deeper as
 *  the song grows to its cap (the sim's own multiplier). Fills `out`. */
export function songPulseSound(pulses: number, out: CouncilSound): CouncilSound {
  const base = COUNCIL_CUE_SOUNDS[COUNCIL_CUES.songPulse];
  const share = (endlessSongMult(pulses) - 1) / (T.songPulseCap - 1);
  out.key = base.key;
  out.at = base.at;
  out.cooldown = base.cooldown;
  out.gain = 0.55 + 0.45 * share;
  out.rate = 1.04 - 0.16 * share;
  return out;
}

/** A bar's charge: its sample and the sample's own length in seconds (the
 *  adapter fits it to the bar). */
export interface CouncilBarSound {
  key: string;
  seconds: number;
  gain: number;
}

export const COUNCIL_BAR_SOUNDS: Readonly<Record<string, CouncilBarSound>> = {
  [COUNCIL_CASTS.wrath]: { key: 'heart_council_wrath_charge', seconds: 4, gain: 0.95 },
  [COUNCIL_CASTS.echo]: { key: 'heart_council_echo_charge', seconds: 3, gain: 0.95 },
  [COUNCIL_CASTS.song]: { key: 'heart_council_song_cast', seconds: 3, gain: 0.8 },
  [COUNCIL_CASTS.songUnbroken]: { key: 'heart_council_song_cast', seconds: 3, gain: 0.8 },
};

/** A bar's charge sized to its bar: the rate that fits the sample to the
 *  bar's length, kept within a breath of the sample's own pitch. */
export function barSoundRate(sound: CouncilBarSound, barSeconds: number): number {
  if (!(barSeconds > 0)) return 1;
  return Math.max(0.85, Math.min(1.2, sound.seconds / barSeconds));
}

/** The rock's fall plays as the boulder comes into view over its soak (the
 *  renderer's own lead, council_fx_core.ts ROCK_FALL_SECONDS). */
export const ROCK_FALL_SOUND = { key: 'heart_council_rock_fall', lead: 1.2, gain: 0.9 } as const;

/** The Walking Slab's grind: a loop while it drags itself. */
export const SLAB_GRIND_SOUND = {
  key: 'heart_council_slab_grind',
  gain: 0.75,
  /** Yards a frame it must move to count as dragging. */
  moving: 0.004,
  /** Seconds it keeps grinding after it stops (a pick between two goals). */
  hold: 0.35,
} as const;

/** Every sample the council plays, for preloading once. */
export const COUNCIL_SFX_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(COUNCIL_CUE_SOUNDS).map((s) => s.key),
    ...Object.values(COUNCIL_BAR_SOUNDS).map((s) => s.key),
    ROCK_FALL_SOUND.key,
    SLAB_GRIND_SOUND.key,
  ]),
].sort();

// WHICH sound the Smith's Heart's Guardian of the Heat makes, and WHEN
// (docs/design/raid/smith_heart.md 7.4). Pure: no WebAudio, no DOM. The
// adapter (smith_heart_heat_audio.ts) plays these off the fight's own cues
// (the `spellfx` events heat_ids.ts HEAT_CUES names), the guardian's Shed Heat
// bar, the channel's state as it changes, the heat on the guardian and the
// local player's own Crystal Burn, all mirrored entity state, so offline and
// online sound the same.
//
//   a cue        a positioned one-shot, layered from one or more samples (a
//                ray, a ray sent back, the pulse, the wind-up, Hearthburst, a
//                crystal rising and burning out, the channel's flow, embers,
//                the stoking, the Hearth settling at the fall)
//   the bar      Shed Heat's charge fitted to its bar
//   the channel  its brimming (a rush building) as it starts
//   the heat     a swell in the local player's ear as the heat passes 75
//                (once each rise), the overheat's warning stays the cue's
//   a burn       a sizzle in the local player's ear each time their own
//                Crystal Burn gains a stack
//
// No sample is the fight's own yet: the ElevenLabs credits ran out, so every
// sound is built from the pack's existing samples, pitched and layered here
// (the takes to generate later are `HEAT_*` in scripts/sfx/sfx_prompts.mjs).
// Readable, punchy, never tiring: the pulse every 3 s is soft and short.

import { HEAT_CASTS, HEAT_CUES } from '../sim/encounters/smith_heart/heat_ids';

export interface HeatSound {
  key: string;
  gain: number;
  rate: number;
  cooldown: number;
  at: 'source' | 'target' | 'point';
}

const S = (
  key: string,
  gain: number,
  at: HeatSound['at'],
  rate = 1,
  cooldown = 0.08,
): HeatSound => ({ key, gain, rate, cooldown, at });

/** The layered one-shot each fight cue plays (keyed by the cue's ability id). */
export const HEAT_CUE_SOUNDS: Readonly<Record<string, readonly HeatSound[]>> = {
  // A ray: a short fire cast, a crystal's ring over it.
  [HEAT_CUES.beam]: [
    S('cast_fire', 0.45, 'target', 1.3, 0.25),
    S('ui_aura_glass_ping', 0.25, 'source', 1.5, 0.25),
  ],
  // Sent back: a deep fire bolt swallowed by the guardian.
  [HEAT_CUES.beamBack]: [
    S('proj_fire', 0.55, 'target', 0.7, 0.3),
    S('ui_aura_glass_ping', 0.2, 'source', 0.8, 0.3),
  ],
  // The pulse: soft and short (every 3 s, never tiring).
  [HEAT_CUES.pulse]: [S('scorch', 0.28, 'source', 0.72, 1)],
  // The wind-up from 90: a charge swelling under a rising roar of fire.
  [HEAT_CUES.windup]: [
    S('heart_council_wrath_charge', 0.95, 'source', 0.8, 2),
    S('heart_breath_swell', 0.6, 'source', 0.75, 2),
  ],
  // Hearthburst: a wrath's blast, a meteor and a pyroblast together.
  [HEAT_CUES.overheat]: [
    S('heart_council_wrath_blast', 1, 'source', 0.9, 1),
    S('meteor', 0.85, 'source', 0.8, 1),
    S('pyroblast', 0.6, 'source', 0.7, 1),
  ],
  // A crystal tears up out of the basalt.
  [HEAT_CUES.rise]: [
    S('heart_council_pillar_rise', 0.75, 'point', 1.25, 0.2),
    S('ui_aura_glass_ping', 0.35, 'point', 0.7, 0.2),
  ],
  // A crystal burns out: glass breaking.
  [HEAT_CUES.fade]: [S('heart_quench_shatter', 0.5, 'point', 1.3, 0.2)],
  // The channel's fire runs down it.
  [HEAT_CUES.flow]: [
    S('hoard_tide_rush', 0.85, 'point', 0.75, 1),
    S('flamestrike', 0.6, 'point', 0.8, 1),
  ],
  [HEAT_CUES.embers]: [S('rift_lava_tick', 0.6, 'point', 0.9, 0.2)],
  [HEAT_CUES.stoke]: [S('heart_council_pillar_pulse', 0.7, 'source', 0.6, 1)],
  [HEAT_CUES.settle]: [S('heart_council_pillar_collapse', 0.7, 'source', 0.8, 1)],
};

/** Is this event's ability one the fight's sound plays (the HUD's generic
 *  nova, beam or burst sound skipped for it)? */
export function heatSoundClaims(ability: string | undefined): boolean {
  return ability !== undefined && Object.hasOwn(HEAT_CUE_SOUNDS, ability);
}

/** A bar's charge: its sample and the sample's own length in seconds. */
export interface HeatBarSound {
  key: string;
  seconds: number;
  gain: number;
}

export const HEAT_BAR_SOUNDS: Readonly<Record<string, HeatBarSound>> = {
  [HEAT_CASTS.shed]: { key: 'heart_council_echo_charge', seconds: 2.5, gain: 0.8 },
};

/** A bar's charge fitted to its bar, kept within a breath of its own pitch. */
export function heatBarRate(sound: HeatBarSound, barSeconds: number): number {
  if (!(barSeconds > 0)) return 1;
  return Math.max(0.85, Math.min(1.2, sound.seconds / barSeconds));
}

/** The channel's brimming: a rush building toward the flow. */
export const HEAT_BRIM_SOUND = { key: 'hoard_tide_build', gain: 0.75, rate: 0.8 } as const;

/** The heat passing three quarters, in the local player's ear. */
export const HEAT_RISING_SOUND = {
  key: 'heart_breath_swell',
  gain: 0.4,
  rate: 0.7,
  at: 75,
} as const;

/** The local player's Crystal Burn gaining a stack. */
export const HEAT_BURN_SOUND = { key: 'rift_lava_tick', gain: 0.4, rate: 1.25 } as const;

/** Does the heat crossing from `from` to `to` sound its warning (the rise past
 *  the mark; once until it falls back under)? */
export function heatWarningDue(from: number, to: number): boolean {
  return from < HEAT_RISING_SOUND.at && to >= HEAT_RISING_SOUND.at;
}

/** Every sample the fight plays, for preloading once. */
export const HEAT_SFX_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(HEAT_CUE_SOUNDS).flatMap((list) => list.map((s) => s.key)),
    ...Object.values(HEAT_BAR_SOUNDS).map((s) => s.key),
    HEAT_BRIM_SOUND.key,
    HEAT_RISING_SOUND.key,
    HEAT_BURN_SOUND.key,
  ]),
].sort();

// WHICH sound the Smith's Heart's Guardian of the Heat makes, and WHEN
// (docs/design/raid/smith_heart.md 7.4). Pure: no WebAudio, no DOM. The
// adapter (smith_heart_heat_audio.ts) plays these off the fight's own cues
// (the `spellfx` events heat_ids.ts HEAT_CUES names), the guardian's bars,
// the fight's objects as they change state (a swell starting to roll, a river
// starting to flow, a Wakefire band igniting) and the local player's own
// marks, all mirrored entity state, so offline and online sound the same.
//
//   a cue        a positioned one-shot, layered from one or more samples (the
//                fist landing, a swell rolling, a flare, the sink and the
//                rise, a river, a Falling Cinder, a Wellspawn climbing out
//                and feeding the wellspring, a Kindling Mark, a seed landing
//                and bursting, a Seedflame hatching, Wakefire igniting, a
//                Rolling Cinder landing, struck back and bursting, the
//                wellspring settling at the fall)
//   a bar        Basalt Fist's charge fitted to it
//   the marks    in the local player's ear: a Kindling Mark landing on them,
//                a Rolling Cinder or a Seedflame turning to hunt them, and
//                each new stack of Cinder Grip on a tank (louder at the swap)
//   the Wheel    (mythic) its red slices heating (a WARNING) and erupting
//   the cinder   a Rolling Cinder's roll, a loop at the nearest one
//
// Every sample is the fight's own (`heart_heat_*`, scripts/sfx/
// smith_heart_mechanic_sfx.mjs; until 2026-11-05 every cue was borrowed from
// the pack, the credits having run out). The heaviest blows keep a second
// layer from the Council's stone under their own take, for weight. A WARNING (the fist's
// charge, a band or a slice heating, a mark) swells with no hit; an IMPACT
// (the fist, an ignition, an eruption, a burst) is a hard transient.

import { HEAT_AURAS, HEAT_CASTS, HEAT_CUES } from '../sim/encounters/smith_heart/heat_ids';
import { HEART_MARK, type HeartMarkSound, markSound } from './smith_heart_mark_audio';

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
  // Basalt Fist lands: its own slam, a rock's crunch and a wrath's blast under it.
  [HEAT_CUES.fist]: [
    S('heart_heat_fist_land', 1, 'point', 1, 0.5),
    S('heart_council_rock_impact', 0.5, 'point', 0.8, 0.5),
    S('heart_council_wrath_blast', 0.4, 'point', 0.85, 0.5),
  ],
  // A Molten Swell starts to roll.
  [HEAT_CUES.swell]: [S('heart_heat_swell', 0.85, 'point', 1, 0.3)],
  // Hearth Flare on a far player.
  [HEAT_CUES.flare]: [S('heart_heat_flare', 0.5, 'target', 1, 0.25)],
  // It sinks into the wellspring; it rises again.
  [HEAT_CUES.sink]: [S('heart_heat_sink', 1, 'source', 1, 1)],
  [HEAT_CUES.rise]: [S('heart_heat_rise', 1, 'source', 1, 1)],
  // A river of the first flame starts to flow (soft: three at a time).
  [HEAT_CUES.river]: [S('heart_heat_river', 0.45, 'point', 1, 0.6)],
  // A Falling Cinder strikes (soft and short: one every few seconds).
  [HEAT_CUES.bolt]: [S('heart_heat_bolt', 0.4, 'target', 1, 0.15)],
  // A Wellspawn climbs out; one feeds the wellspring (a blast on the raid).
  [HEAT_CUES.spawn]: [S('heart_heat_spawn', 0.6, 'point', 1, 0.2)],
  [HEAT_CUES.feed]: [S('heart_heat_feed', 1, 'point', 1, 0.4)],
  // A Wellkeeper marks a player (the keeper's beam; the mark itself rings in
  // its player's ear).
  [HEAT_CUES.kindling]: [S('heart_heat_kindling', 0.6, 'target', 1, 0.3)],
  // A Hearthseed lands; it bursts (a deep detonation).
  [HEAT_CUES.seed]: [S('heart_heat_seed', 0.5, 'point', 1, 0.12)],
  [HEAT_CUES.seedBurst]: [S('heart_heat_seed_burst', 0.9, 'point', 1, 0.15)],
  [HEAT_CUES.hatch]: [S('heart_heat_hatch', 0.5, 'point', 1, 0.15)],
  // Wakefire ignites a band: a roar of flame over the floor.
  [HEAT_CUES.ignite]: [S('heart_heat_ignite', 1, 'point', 1, 0.6)],
  // A Rolling Cinder lands, is struck back, bursts on its quarry.
  [HEAT_CUES.cinderLand]: [S('heart_heat_cinder_land', 1, 'point', 1, 0.5)],
  [HEAT_CUES.cinderKnock]: [S('heart_heat_cinder_knock', 0.8, 'target', 1, 0.2)],
  [HEAT_CUES.cinderBurst]: [
    S('heart_heat_cinder_burst', 1, 'point', 1, 0.4),
    S('heart_council_wrath_blast', 0.4, 'point', 0.95, 0.4),
  ],
  [HEAT_CUES.settle]: [S('heart_heat_settle', 0.9, 'source', 1, 1)],
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
  [HEAT_CASTS.fist]: { key: 'heart_heat_fist_charge', seconds: 3, gain: 1 },
};

/** A bar's charge fitted to its bar, kept within a breath of its own pitch. */
export function heatBarRate(sound: HeatBarSound, barSeconds: number): number {
  if (!(barSeconds > 0)) return 1;
  return Math.max(0.85, Math.min(1.2, sound.seconds / barSeconds));
}

/** A Wakefire band beginning to build (its WARNING, a rush of heat rising). */
export const HEAT_ZONE_BUILD_SOUND = { key: 'heart_heat_zone_build', gain: 0.8, rate: 1 } as const;

/** The Wheel of the Hearth (mythic): its red slices heating (a WARNING, one
 *  voice for a round's three) and erupting. */
export const HEAT_WHEEL_SOUNDS = {
  warn: { key: 'heart_heat_wheel_warn', gain: 1 },
  burn: { key: 'heart_heat_wheel_erupt', gain: 1 },
} as const;

/** A Rolling Cinder's roll: a loop at the nearest one. */
export const HEAT_CINDER_LOOP = {
  key: 'heart_heat_cinder_roll',
  gain: 0.75,
  fadeOut: 0.6,
} as const;

/** The marks in the local player's ear: one landing on them, so a player
 *  always hears that the mechanic chose them. */
export const HEAT_MARK_SOUNDS: Readonly<Record<string, HeartMarkSound>> = {
  [HEAT_AURAS.kindling]: HEART_MARK.fire,
  [HEAT_AURAS.hunted]: markSound(HEART_MARK.fire, 1, 0.8),
};

/** Cinder Grip on a tank: each new stack a sizzle, louder and deeper from the
 *  swap (the tanks trade it around `swapAt` stacks). */
export const HEAT_GRIP_SOUND = { key: 'heart_heat_grip', gain: 0.45, swapAt: 5 } as const;

/** The sizzle for a grip of `stacks`: soft below the swap, then loud and low. */
export function gripSound(stacks: number): { gain: number; rate: number } {
  if (stacks >= HEAT_GRIP_SOUND.swapAt) return { gain: 1, rate: 0.85 };
  return { gain: HEAT_GRIP_SOUND.gain, rate: 1 };
}

/** Every sample the fight plays, for preloading once. */
export const HEAT_SFX_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(HEAT_CUE_SOUNDS).flatMap((list) => list.map((s) => s.key)),
    ...Object.values(HEAT_BAR_SOUNDS).map((s) => s.key),
    ...Object.values(HEAT_MARK_SOUNDS).map((s) => s.key),
    HEAT_ZONE_BUILD_SOUND.key,
    HEAT_WHEEL_SOUNDS.warn.key,
    HEAT_WHEEL_SOUNDS.burn.key,
    HEAT_CINDER_LOOP.key,
    HEAT_GRIP_SOUND.key,
  ]),
].sort();

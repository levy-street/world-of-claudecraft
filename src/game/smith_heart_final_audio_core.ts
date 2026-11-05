// WHICH sound the Smith's Heart's final boss, the Masterless Strength, makes,
// and WHEN (docs/design/raid/smith_heart.md 7.5). Pure: no WebAudio, no DOM.
// The adapter (smith_heart_final_audio.ts) plays these off the fight's own
// cues (the `spellfx` events final_ids.ts FINAL_CUES and final_phase_ids.ts
// FINAL_PHASE_CUES name), the boss's and the Splinters' bars, the footprints
// as they appear, the boss's Overload and phase auras and the local player's
// own marks and cold, all mirrored entity state, so offline and online sound
// the same.
//
//   a cue          a positioned one-shot, one or more layers: the quarter
//                  change (it takes root; Vein Shock on Heroic), the Overload's
//                  pulse (louder and deeper as the bar fills) and burst, each
//                  quarter's kit, the intermissions, the final phase and each
//                  turn of its mix, Masterless Fury, Mythic's hidden phase (the
//                  kneel, the rebirth, a quarter cracking and falling, a body
//                  falling with it, the ring)
//   a bar          its WARNING fitted to it: Basalt Fist, Leaping Bolt, Weight
//                  of the Anvil on the boss; Shearing Blow, Rime Toll and Gale
//                  Pounce on a Splinter
//   a footprint    its WARNING as it appears: a Fire Whirl rising, Bellows Wind
//                  gathering (its gale a loop while it blows), Groaning Ice, a
//                  Storm Orb, a Tremor Crack
//   the Overload   the active bar passing three quarters: a crystal straining
//   the floor      Mythic's broken Anvil rising back whole after a kill or wipe
//   the marks      a mark on the local player (Ember Mark, Drawn Lightning,
//                  Crushed, Bursting Coal, Wind-Tethered), and their own cold
//                  past half and four fifths, in their own ear
//
// Every sample is the raid's own (`heart_final_*` in scripts/sfx/
// smith_heart_mechanic_sfx.mjs, and the guardians' takes where a quarter
// borrows a guardian's mechanic). A WARNING swells with no hit; an IMPACT is
// a hard transient.

import { FINAL_AURAS, FINAL_CASTS, FINAL_CUES } from '../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS,
  FINAL_PHASE_CASTS,
  FINAL_PHASE_CUES,
} from '../sim/encounters/smith_heart/final_phase_ids';
import { HEART_MARK, type HeartMarkSound, markSound } from './smith_heart_mark_audio';
import { QUENCH_COLD_SOUNDS } from './smith_heart_quench_audio_core';

export interface FinalSound {
  key: string;
  gain: number;
  rate: number;
  cooldown: number;
  at: 'source' | 'target' | 'point';
  /** Only on this event type (a cue id used both as a beam and a burst). */
  on?: 'spellfx' | 'spellfxAt';
}

const S = (
  key: string,
  gain: number,
  at: FinalSound['at'],
  rate = 1,
  cooldown = 0.08,
  on?: FinalSound['on'],
): FinalSound => (on ? { key, gain, rate, cooldown, at, on } : { key, gain, rate, cooldown, at });

const F = (name: string) => `heart_final_${name}`;

/** The layered one-shot each fight cue plays (keyed by the cue's ability id). */
export const FINAL_CUE_SOUNDS: Readonly<Record<string, readonly FinalSound[]>> = {
  // ---- the rules ----
  // The Overload's pulse (its gain and rate follow the bar: overloadPulseSound).
  [FINAL_CUES.pulse]: [S(F('overload_pulse'), 0.7, 'source', 1, 0.5)],
  [FINAL_CUES.burst]: [
    S(F('overload_burst'), 1, 'source', 1, 1),
    S('heart_council_wrath_blast', 0.4, 'source', 0.85, 1),
  ],
  // A quarter change: it takes root in the new quarter (every tier); Vein
  // Shock's wave through the raid on Heroic and Mythic.
  [FINAL_CUES.root]: [S(F('quarter_shift'), 1, 'source', 1, 0.5)],
  [FINAL_CUES.shock]: [S(F('vein_shock'), 1, 'point', 1, 0.5)],
  // Heart Unbound ticks every second in the ring: soft, cooled.
  [FINAL_CUES.unbound]: [S(F('unbound'), 0.6, 'source', 1, 0.8)],
  // ---- the Heat quarter ----
  [FINAL_CUES.whirl]: [S(F('whirl'), 0.75, 'target', 1, 0.2)],
  [FINAL_CUES.embers]: [S('heart_heat_seed_burst', 0.7, 'point', 1.15, 0.15)],
  [FINAL_CUES.forgeFire]: [S('heart_heat_ignite', 0.6, 'point', 1.2, 0.3)],
  // ---- the Quench quarter ----
  [FINAL_CUES.freeze]: [S('heart_quench_freeze', 0.9, 'target', 1, 0.15)],
  [FINAL_CUES.iceBreak]: [S('heart_quench_hole', 1, 'point', 1, 0.2)],
  // ---- the Breath quarter ----
  [FINAL_CUES.bolt]: [S('heart_breath_fork', 0.85, 'target', 1, 0.07)],
  [FINAL_CUES.arc]: [S('heart_breath_fork', 0.55, 'target', 1.25, 0.25)],
  [FINAL_CUES.orbTaken]: [S(F('orb_take'), 0.9, 'point', 1, 0.15)],
  [FINAL_CUES.orbBurst]: [S('heart_breath_discharge', 1, 'point', 0.9, 0.3)],
  // ---- the Hammer quarter ----
  [FINAL_CUES.tremor]: [S(F('tremor'), 0.9, 'point', 1, 0.12)],
  [FINAL_CUES.anvil]: [
    S(F('anvil_fall'), 1, 'point', 1, 0.5),
    S('heart_council_rock_impact', 0.45, 'point', 0.75, 0.5),
  ],
  [FINAL_CUES.shell]: [S(F('stone_shell'), 0.8, 'target', 1, 0.2)],
  [FINAL_CUES.settle]: [S(F('kneel'), 0.8, 'source', 0.9, 1)],
  // ---- the intermissions ----
  [FINAL_PHASE_CUES.leap]: [S(F('stride'), 1, 'point', 1, 1)],
  [FINAL_PHASE_CUES.shield]: [S(F('shield_up'), 1, 'source', 1, 1)],
  [FINAL_PHASE_CUES.rise]: [S(F('splinter_rise'), 1, 'point', 1, 0.3)],
  [FINAL_PHASE_CUES.pour]: [S(F('pour'), 0.9, 'target', 1, 0.4)],
  [FINAL_PHASE_CUES.shear]: [S(F('shear'), 1, 'source', 1, 0.2)],
  // Bursting Coal: the mark's beam (a kindling), then the burst at its player.
  [FINAL_PHASE_CUES.coal]: [
    S('heart_heat_kindling', 0.6, 'target', 0.9, 0.3, 'spellfx'),
    S('heart_heat_seed_burst', 1, 'point', 0.9, 0.2, 'spellfxAt'),
  ],
  [FINAL_PHASE_CUES.toll]: [S(F('toll'), 1, 'source', 1, 0.5)],
  [FINAL_PHASE_CUES.pounce]: [
    S('heart_breath_roar_hit', 1, 'point', 0.9, 0.3),
    S('heart_breath_toss', 0.5, 'point', 1, 0.3),
  ],
  // Buffeting Gale strikes every second round its Splinter: soft, cooled.
  [FINAL_PHASE_CUES.buffet]: [S('heart_breath_toss', 0.4, 'source', 1.1, 0.8)],
  [FINAL_PHASE_CUES.splinter]: [S(F('overload_pulse'), 0.45, 'source', 1.2, 1)],
  [FINAL_PHASE_CUES.release]: [S(F('shield_break'), 1, 'source', 1, 1)],
  // ---- the final phase ----
  [FINAL_PHASE_CUES.awaken]: [S(F('awaken'), 1, 'point', 1, 1)],
  // Each turn of the mix: the anvil's boom (the element's sting rides with it:
  // mixTurnSting).
  [FINAL_PHASE_CUES.mixTurn]: [S(F('mix_turn'), 0.9, 'point', 1, 1)],
  [FINAL_PHASE_CUES.fury]: [S(F('fury'), 0.8, 'source', 1, 1)],
  // ---- Mythic's hidden phase ----
  [FINAL_PHASE_CUES.kneel]: [S(F('kneel'), 1, 'point', 1, 1)],
  [FINAL_PHASE_CUES.rebirth]: [S(F('rebirth'), 1, 'point', 1, 1)],
  [FINAL_PHASE_CUES.unmade]: [S(F('unmade'), 1, 'point', 1, 1)],
  [FINAL_PHASE_CUES.quarterCrack]: [S(F('quarter_crack'), 1, 'point', 1, 1)],
  [FINAL_PHASE_CUES.quarterFall]: [S(F('quarter_fall'), 1, 'point', 1, 1)],
  [FINAL_PHASE_CUES.bodyFall]: [S(F('body_fall'), 0.9, 'point', 1, 0.2)],
  [FINAL_PHASE_CUES.ringCrack]: [S(F('quarter_crack'), 1, 'point', 1.15, 1)],
  [FINAL_PHASE_CUES.ringBreak]: [
    S(F('quarter_fall'), 1, 'point', 0.85, 1),
    S(F('overload_burst'), 0.6, 'point', 0.8, 1),
  ],
};

/** Is this event's ability one the fight's sound plays (the HUD's generic
 *  nova, beam or burst sound skipped for it)? */
export function finalSoundClaims(ability: string | undefined): boolean {
  return ability !== undefined && Object.hasOwn(FINAL_CUE_SOUNDS, ability);
}

/** The Overload pulse at a bar `fill` (0 to 1): louder and deeper as it
 *  fills, as the pulse itself hits harder (final_ids.ts pulseScale). */
export function overloadPulseSound(fill: number): { gain: number; rate: number } {
  const f = Math.max(0, Math.min(1, fill));
  return { gain: 0.5 + 0.5 * f, rate: 1.06 - 0.16 * f };
}

/** The element's sting under a turn of the final phase's mix, by the cue's
 *  school (fire the whirls, frost the ice, nature the bolt, physical the
 *  Anvil). */
export const MIX_TURN_STING: Readonly<Record<string, HeartMarkSound>> = {
  fire: markSound(HEART_MARK.fire, 0.7),
  frost: markSound(HEART_MARK.frost, 0.7),
  nature: markSound(HEART_MARK.storm, 0.7),
  physical: markSound(HEART_MARK.stone, 0.7),
};

/** A bar's warning: its sample and the sample's own length in seconds. */
export interface FinalBarSound {
  key: string;
  seconds: number;
  gain: number;
}

/** The boss's bars and the Splinters' (each a warning: move, or kick). */
export const FINAL_BAR_SOUNDS: Readonly<Record<string, FinalBarSound>> = {
  [FINAL_CASTS.fist]: { key: 'heart_heat_fist_charge', seconds: 3, gain: 1 },
  [FINAL_CASTS.bolt]: { key: F('bolt_charge'), seconds: 2, gain: 1 },
  [FINAL_CASTS.anvil]: { key: F('anvil_warn'), seconds: 5, gain: 1 },
  [FINAL_PHASE_CASTS.shear]: { key: F('shear_warn'), seconds: 2, gain: 1 },
  [FINAL_PHASE_CASTS.toll]: { key: 'heart_quench_wake_charge', seconds: 4, gain: 0.8 },
  [FINAL_PHASE_CASTS.pounce]: { key: 'heart_breath_gather', seconds: 2.5, gain: 0.8 },
};

/** A bar's warning fitted to its bar, kept within a breath of its own pitch. */
export function finalBarRate(sound: FinalBarSound, barSeconds: number): number {
  if (!(barSeconds > 0)) return 1;
  return Math.max(0.85, Math.min(1.2, sound.seconds / barSeconds));
}

/** The footprint kinds (render/smith_heart_fx/final_kit_fx_core.ts
 *  finalObjectKind) a sound greets as they appear. */
export type FinalFootprintKind =
  | 'whirlWarn'
  | 'whirl'
  | 'emberPool'
  | 'forgePool'
  | 'windWarn'
  | 'windBlow'
  | 'crack'
  | 'orb'
  | 'tremor'
  | 'anvil';

/** The WARNING a footprint sounds as it appears (null: its cue or bar speaks). */
export const FINAL_FOOTPRINT_SOUNDS: Readonly<
  Partial<Record<FinalFootprintKind, { key: string; gain: number; rate: number }>>
> = {
  whirlWarn: { key: 'heart_heat_spawn', gain: 0.75, rate: 1.1 },
  windWarn: { key: 'heart_breath_gather', gain: 0.85, rate: 1 },
  crack: { key: 'heart_quench_crack', gain: 0.85, rate: 1 },
  orb: { key: 'heart_breath_knot_spawn', gain: 0.7, rate: 1.25 },
  tremor: { key: F('tremor_warn'), gain: 0.9, rate: 1 },
};

/** Bellows Wind's gale, a loop while it blows. */
export const FINAL_GALE_LOOP = { key: 'heart_breath_blow_loop', gain: 0.65, fadeOut: 1 } as const;

/** The Overload's WARNING: the active bar passing `at` percent (rearmed once
 *  it drains under `rearm`). */
export const FINAL_OVERLOAD_RISING = {
  key: F('overload_rising'),
  gain: 1,
  at: 75,
  rearm: 60,
} as const;

/** Does a bar going `from` to `to` percent sound the Overload's warning? */
export function overloadRisingDue(from: number, to: number): boolean {
  return from < FINAL_OVERLOAD_RISING.at && to >= FINAL_OVERLOAD_RISING.at;
}

/** Mythic's floor rising back whole after a kill, a wipe or a reset. */
export const FINAL_REBUILD_SOUND = { key: F('rebuild'), gain: 1 } as const;

/** Does a collapse's fallen quarters going `from` to `to` (masks) mean the
 *  floor is rising back (some fell, now none)? */
export function rebuildDue(from: number, to: number): boolean {
  return from !== 0 && to === 0;
}

/** The fight's marks in the marked player's own ear. */
export const FINAL_MARK_SOUNDS: Readonly<Record<string, HeartMarkSound>> = {
  [FINAL_AURAS.ember]: HEART_MARK.fire,
  [FINAL_AURAS.drawn]: HEART_MARK.storm,
  [FINAL_AURAS.crushed]: markSound(HEART_MARK.stone, 0.9, 0.85),
  [FINAL_PHASE_AURAS.coal]: markSound(HEART_MARK.fire, 1, 0.85),
  [FINAL_PHASE_AURAS.tether]: markSound(HEART_MARK.storm, 1, 0.85),
};

/** Every sample the fight plays, for preloading once. */
export const FINAL_SFX_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(FINAL_CUE_SOUNDS).flatMap((list) => list.map((s) => s.key)),
    ...Object.values(FINAL_BAR_SOUNDS).map((s) => s.key),
    ...Object.values(FINAL_FOOTPRINT_SOUNDS).map((s) => s?.key ?? ''),
    ...Object.values(MIX_TURN_STING).map((s) => s.key),
    ...Object.values(FINAL_MARK_SOUNDS).map((s) => s.key),
    FINAL_GALE_LOOP.key,
    FINAL_OVERLOAD_RISING.key,
    QUENCH_COLD_SOUNDS.warn.key,
    QUENCH_COLD_SOUNDS.danger.key,
    FINAL_REBUILD_SOUND.key,
  ]),
]
  .filter((k) => k !== '')
  .sort();

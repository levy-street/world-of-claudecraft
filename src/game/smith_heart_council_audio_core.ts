// WHICH sound the Smith's Heart's Hammer Council makes, and WHEN (docs/design/
// raid/smith_heart.md 5.18 and 7.1). Pure: no WebAudio, no DOM. The adapter
// (smith_heart_council_audio.ts) plays these off the council's own cues (the
// `spellfx` events council_ids.ts COUNCIL_CUES names) and off the cast bars and
// marks every client already mirrors, so offline and online sound the same.
//
//   a cue          one positioned one-shot (a pillar rising, cracking, falling,
//                  the rock landing, a soul taking the stone, a pip struck, a
//                  soul pillar bursting, the Echo's blast, Mountain's Rush
//                  striking, the Wrath landing, a Seam Bolt, Hammer's Weight)
//   a bar          its charge, sized to the bar (Mountain's Wrath, the Echo of
//                  Wrath, the Song of the Seam)
//   the rock       its gather call as its mark goes on (the raid's one share
//                  sound), its fall as the boulder comes into view
//   the Wake       its bar's stone grinding up (never the rock's sound)
//   the song       each Endless Song pulse louder and deeper as the song grows
//   the shelter    a crowded pillar groaning under the Wrath (Narrow Shelter)
//   the marks      a mark landing on the local player, in their own ear
//
// Every sample is the council's own (`heart_council_*`, scripts/sfx/
// sfx_prompts.mjs) but the rock's gather call, the raid's shared one. Readable, punchy, never tiring: a cue repeated every two
// seconds (the heroic pulse) is kept low and cooled down.

import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_DEV_CUES,
  endlessSongMult,
  COUNCIL_TUNING as T,
} from '../sim/encounters/smith_heart/council_ids';
import { TANK_BUSTER_AURA } from '../sim/encounters/smith_heart/tank_buster_ids';
import {
  HEART_MARK,
  HEART_TANK_BUSTER_SOUND,
  type HeartMarkSound,
  markSound,
} from './smith_heart_mark_audio';

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
  // Stone Thrum: every risen pillar rings the raid on the same tick, a
  // second off Restless Stone's beat: one brighter hum, cooled the same.
  [COUNCIL_CUES.risenPulse]: S('pillar_pulse', 0.4, 'source', 1.15, 1.2),
  [COUNCIL_CUES.inherit]: S('soul_take', 0.6, 'target', 0.85, 0.5),
  // Grieving Fury: the soul lands in the survivor with a deep burst; each
  // landing's heal a bright swell (the heal event's own chime rides beside).
  [COUNCIL_CUES.furyWake]: S('soul_burst', 1, 'source', 0.78),
  [COUNCIL_CUES.furyHeal]: S('bond_pulse', 0.85, 'source', 1.1, 0.7),
  [COUNCIL_CUES.soulTake]: S('soul_take', 1, 'target'),
  [COUNCIL_CUES.soulPip]: S('soul_pip', 1, 'source'),
  [COUNCIL_CUES.soulBurst]: S('soul_burst', 1, 'point'),
  [COUNCIL_CUES.echoBlast]: S('echo_blast', 1, 'source'),
  // Mountain's Rush's wind-up (a WARNING: the Guardian plants and gathers,
  // stone grinding, no hit) and its run striking home (the IMPACT: a giant's
  // body slam), each its own take.
  [COUNCIL_CUES.rushWindup]: S('rush_windup', 1, 'point', 1, 0.3),
  [COUNCIL_CUES.rushImpact]: S('rush_impact', 1, 'point', 1, 0.3),
  // The cursed pillar: the rise's burst, a low dark hum, a soul pillar's
  // burst as it breaks; Resonance's ring, the song's
  // hum kept low; the mythic collapse, the rock's impact cooled down.
  [COUNCIL_CUES.cursedRise]: S('pillar_rise', 0.95, 'source', 0.85),
  [COUNCIL_CUES.cursedPulse]: S('pillar_pulse', 0.4, 'source', 0.75, 1.2),
  [COUNCIL_CUES.cursedBreak]: S('soul_burst', 1, 'point', 0.9),
  [COUNCIL_CUES.resonancePulse]: S('resonance', 0.5, 'source', 1, 0.6),
  [COUNCIL_CUES.quarryCollapse]: S('rock_impact', 0.45, 'point', 1.1, 0.5),
  // The song's pulse grows: songPulseSound below sets its gain and rate.
  [COUNCIL_CUES.songPulse]: S('song_pulse', 0.6, 'source'),
  // The Wrath landing (its nova on the caster), a Seam Bolt on its mark,
  // Hammer's Weight's slab on the tank.
  [COUNCIL_CASTS.wrath]: S('wrath_blast', 1, 'source'),
  // The pull's war cry: the stone grinding as each member gathers itself;
  // its blow's crush plays on the blow (render/smith_heart_fx/
  // council_pull_fx_core.ts COUNCIL_PULL_BEAT).
  [COUNCIL_CUES.pull]: S('slab_grind', 0.55, 'source', 1.3, 0.2),
  [COUNCIL_CASTS.bolt]: S('seam_bolt', 0.85, 'target', 1, 0.15),
  [COUNCIL_CASTS.weight]: S('rock_impact', 0.7, 'target', 1.25),
};

/** Is this event's ability one the council's sound plays (the HUD's generic
 *  nova sound skipped for it)? */
export function councilSoundClaims(ability: string | undefined): boolean {
  // The deaths' dev replay cue is silent here: the death scene's own sounds
  // play off its beats (render/smith_heart_fx/council_death_fx.ts).
  if (ability === COUNCIL_DEV_CUES.deathReplay) return true;
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
  // Wake the Stone (the pillars coming): stone grinding up out of the floor,
  // its own sound since the team's playtest of 2026-11-25 (the Wake and the
  // rock had sounded the same: both only the stone sting).
  [COUNCIL_CASTS.wake]: { key: 'heart_council_slab_grind', seconds: 2.5, gain: 0.75 },
};

/** A bar's charge sized to its bar: the rate that fits the sample to the
 *  bar's length, kept within a breath of the sample's own pitch. */
export function barSoundRate(sound: CouncilBarSound, barSeconds: number): number {
  if (!(barSeconds > 0)) return 1;
  return Math.max(0.85, Math.min(1.2, sound.seconds / barSeconds));
}

/** The rock's mark, heard by the whole raid round its player as it goes on
 *  (the team's playtest of 2026-11-25: the soak must read the first time, and
 *  apart from Wake the Stone): the raid's GATHER call, the very warning of the
 *  Masterless Strength's Weight of the Anvil (the fight's other group share),
 *  a heavy weight hanging overhead, rising for the mark's 5 s. One sound for
 *  every share in the raid. Played only as a mark goes on (never late). */
export const ROCK_MARK_SOUND = {
  key: 'heart_final_anvil_warn',
  seconds: 5,
  gain: 0.85,
  /** A mark first seen with more than this much of it gone plays nothing. */
  fresh: 0.6,
} as const;

/** The rock's mark's sound fitted to its mark (the sample's own 5 s). */
export function rockMarkRate(markSeconds: number): number {
  if (!(markSeconds > 0)) return 1;
  return Math.max(0.85, Math.min(1.2, ROCK_MARK_SOUND.seconds / markSeconds));
}

/** The rock's fall plays as the boulder comes into view over its soak (the
 *  renderer's own lead, council_fx_core.ts ROCK_FALL_SECONDS). */
export const ROCK_FALL_SOUND = { key: 'heart_council_rock_fall', lead: 1.2, gain: 0.9 } as const;

/** Narrow Shelter: a pillar one too many hide behind groans (a WARNING,
 *  heard as it crowds, never again until it clears). */
export const SHELTER_STRAIN_SOUND = {
  key: 'heart_council_shelter_strain',
  gain: 0.9,
  cooldown: 1.2,
} as const;

/** Does the crowded count going `from` to `to` sound the strain? Only as a
 *  pillar newly crowds. */
export function shelterStrainDue(from: number, to: number): boolean {
  return to > from && to > 0;
}

/** The council's marks in the marked player's own ear: the Rush's mark, a
 *  Wake the Stone mark, the Falling Rock's mark, Resonance. */
export const COUNCIL_MARK_SOUNDS: Readonly<Record<string, HeartMarkSound>> = {
  [COUNCIL_AURAS.rushMark]: HEART_MARK.stone,
  [COUNCIL_AURAS.wakeMark]: markSound(HEART_MARK.stone, 0.8, 1.15),
  // The rock's mark is no stone sting: the whole raid hears its gather call
  // (ROCK_MARK_SOUND), its marked player too.
  [COUNCIL_AURAS.resonance]: markSound(HEART_MARK.stone, 0.75, 1.3),
};

/** Mountain's Rush's alarm in the marked player's own ear, over the stone's
 *  sting: the war horn of the shared alert palette (aura_cue_catalog.ts), loud,
 *  so the mark is heard as a call to run behind a pillar (the owner's playtest
 *  of 2026-11-12: the sting alone went unnoticed). */
export const RUSH_MARK_ALARM: Readonly<Record<string, HeartMarkSound>> = {
  [COUNCIL_AURAS.rushMark]: { key: 'ui_aura_blaring_horn', gain: 1, rate: 1 },
  // Hammer's Weight on its tank (the tank buster alert's sound).
  [TANK_BUSTER_AURA]: HEART_TANK_BUSTER_SOUND,
};

/** Every sample the council plays, for preloading once. */
export const COUNCIL_SFX_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(COUNCIL_CUE_SOUNDS).map((s) => s.key),
    ...Object.values(COUNCIL_BAR_SOUNDS).map((s) => s.key),
    ...Object.values(COUNCIL_MARK_SOUNDS).map((s) => s.key),
    ...Object.values(RUSH_MARK_ALARM).map((s) => s.key),
    ROCK_FALL_SOUND.key,
    ROCK_MARK_SOUND.key,
    SHELTER_STRAIN_SOUND.key,
  ]),
].sort();

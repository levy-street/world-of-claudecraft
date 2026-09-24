// WHICH sound a Buried Hoard mechanic makes, and WHEN in its cue's life. Pure: no
// WebAudio, no DOM. The adapter (hoard_mechanic_audio.ts) plays a beat as the
// cue's clock crosses it, at the cue's place in the world.
//
// Every key is a sample the game already ships (src/game/sfx_manifest.generated.ts):
// these mechanics are told by re-pitched forge, stone, water, root and spider
// sounds, so nothing new rides the SFX pipeline. Each beat's moment comes from the
// mechanic's own shared sim core, so a sound lands on the frame its blow does.

import { BOULDER } from '../sim/rift/hoard_boulder_core';
import { COCOON } from '../sim/rift/hoard_cocoon_core';
import { FORGE_HAMMER } from '../sim/rift/hoard_forge_hammer_core';
import { TENTACLES } from '../sim/rift/hoard_tentacles_core';
import type { HoardBossCueVariant } from '../sim/rift/types';

export interface HoardMechanicBeat {
  /** Seconds into the cue. */
  at: number;
  key: string;
  gain: number;
  /** Playback rate: below 1 is deeper and slower. */
  rate: number;
}

const beat = (at: number, key: string, gain = 0.8, rate = 1): HoardMechanicBeat => ({
  at,
  key,
  gain,
  rate,
});

const BEATS: Partial<Record<HoardBossCueVariant, readonly HoardMechanicBeat[]>> = {
  // ---- Emberforge: the Hammer of the Forge
  'ember-hammer': [beat(0, 'intimidating_shout', 0.7, 0.78)],
  'ember-hammer-strike': [
    // It comes into view falling, lands like an anvil struck, and throws its ring.
    beat(FORGE_HAMMER.warningSec - FORGE_HAMMER.fallSec, 'melee_swing_heavy', 0.75, 0.55),
    beat(FORGE_HAMMER.warningSec, 'ui_aura_anvil_strike', 1, 0.62),
    beat(FORGE_HAMMER.warningSec, 'rift_boulder_impact', 0.9, 0.8),
    beat(FORGE_HAMMER.warningSec + 0.08, 'flamestrike', 0.7, 0.85),
  ],
  // ---- Grask: the Rolling Boulder
  'brute-boulder-throw': [
    beat(0, 'mob_ogre_aggro', 0.8, 0.85),
    beat(Math.max(0, BOULDER.warningSec - 0.35), 'melee_swing_heavy', 0.8, 0.5),
  ],
  'brute-boulder': [beat(0, 'rift_boulder_roll', 0.9, 0.9)],
  // The charge: the rumble as he goes.
  'brute-charge': [beat(0, 'rift_boulder_roll', 0.8, 0.7)],
  // A thread of silk landing on a player.
  'venom-silk': [beat(0, 'impact_leather', 0.5, 1.4)],
  'brute-boulder-return': [beat(0, 'rift_boulder_roll', 0.85, 1.25)],
  'brute-boulder-crush': [
    beat(0, 'rift_boulder_impact', 1, 0.7),
    beat(0.05, 'impact_bone', 0.7, 0.8),
  ],
  // ---- The Abyssal Maw: the tentacles
  'tide-tentacle': [
    beat(0, 'move_swim', 0.55, 0.6),
    beat(TENTACLES.spawnWarningSec, 'move_splash', 0.95, 0.7),
    beat(TENTACLES.spawnWarningSec, 'hoard_tide_crash', 0.55, 1.35),
  ],
  'tide-whip': [
    beat(TENTACLES.whipTelegraphSec - 0.12, 'melee_swing_heavy', 0.85, 0.7),
    beat(TENTACLES.whipTelegraphSec, 'impact_flesh', 0.8, 0.75),
  ],
  'tide-sweep': [beat(TENTACLES.sweepTelegraphSec, 'melee_swing_heavy', 0.9, 0.48)],
  'tide-grab': [
    beat(TENTACLES.grabTelegraphSec - 0.1, 'melee_swing_light', 0.7, 0.6),
    beat(TENTACLES.grabTelegraphSec, 'entangling_roots', 0.85, 0.8),
  ],
  'tide-tentacle-fall': [
    beat(0, 'mob_mudfin_death', 0.8, 0.6),
    beat(0.35, 'move_splash', 0.7, 0.85),
  ],
  // ---- Broodmother Vysska: the cocoon
  'brood-cocoon': [
    beat(0, 'mob_spider_aggro', 0.75, 0.8),
    beat(COCOON.warningSec, 'entangling_roots', 0.9, 1.15),
  ],
  'brood-cocoon-end': [beat(0, 'impact_leather', 0.9, 0.8)],
};

export function hoardMechanicBeats(
  variant: HoardBossCueVariant | undefined,
): readonly HoardMechanicBeat[] | undefined {
  return variant ? BEATS[variant] : undefined;
}

/** Every sample the beats use, for preloading once. */
export const HOARD_MECHANIC_SFX_KEYS: readonly string[] = [
  ...new Set(Object.values(BEATS).flatMap((beats) => (beats ?? []).map((b) => b.key))),
].sort();

/** A beat already this far behind when its cue is first seen is skipped: someone
 *  who walks in mid-mechanic hears what happens next, never a burst of what did. */
export const HOARD_MECHANIC_LATE_SEC = 0.3;

export interface HoardMechanicDue {
  /** Bit i set: play beat i now. */
  play: number;
  /** Every beat played or skipped so far. */
  fired: number;
}

/** Which of a cue's beats are due. `fired` is what has already played (or been
 *  skipped); `firstSight` marks the cue's first frame. Written into `out`: this
 *  runs every frame a mechanic is live, so it allocates nothing. */
export function hoardMechanicDue(
  beats: readonly HoardMechanicBeat[],
  elapsed: number,
  fired: number,
  firstSight: boolean,
  out: HoardMechanicDue,
): HoardMechanicDue {
  out.play = 0;
  out.fired = fired;
  for (let i = 0; i < beats.length; i++) {
    const bit = 1 << i;
    if (out.fired & bit || elapsed < beats[i].at) continue;
    out.fired |= bit;
    if (!firstSight || elapsed - beats[i].at <= HOARD_MECHANIC_LATE_SEC) out.play |= bit;
  }
  return out;
}

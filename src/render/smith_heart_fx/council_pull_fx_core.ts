// The Hammer Council's pull beat as numbers (the team's playtest of
// 2026-11-25: "the Hammers have no entrance"). "The quarry wakes"
// (council_entrance_core.ts) plays once per council, the first time the raid
// comes down; every later pull (after a wipe, the run back) was a silent
// aggro. Now each pull opens with a short war cry on the sim's pull cue
// (COUNCIL_CUES.pull, council.ts cryPull): the Guardian drives his fists into
// the floor (the entrance's own punch gesture) and the Quarry answers with a
// shockwave, a ring of split stone, a wall of dust and thrown rock; the Seam
// Singer gives her note (the entrance's note gesture), its rings of ochre
// light racing out over the floor.
//
// Presentation only, on the sim's own tick: nothing is held, the fight runs
// from the cue (the boss swings on through it; the gesture is a one-shot over
// the body). It is a moment, never replayed late (a client that misses the
// cue misses the beat) and gone with a wipe (no state outlives the pull).
// Every beat draws on every tier; the low tier thins the dust and the rock,
// reduced motion takes the shake and halves the rock.
//
// Three-free, DOM-free, deterministic.

import type { CouncilRole } from '../../sim/encounters/smith_heart/council_ids';
import { COUNCIL_AWAKEN_CLIP, COUNCIL_ENTRANCE_GESTURES } from './council_entrance_core';

/** The beat's sounds on its blow (the cue's own grind plays as it arrives:
 *  game/smith_heart_council_audio_core.ts COUNCIL_CUE_SOUNDS). */
export interface PullBeatSound {
  at: number;
  key: string;
  gain: number;
  rate: number;
}

export interface PullBeatSpec {
  /** The one-shot sent through the gesture seam as the cue arrives. */
  gesture: string;
  /** Seconds from the cue to the blow (its clip's contact). */
  impactAt: number;
  /** The shockwave's reach and the inner hot ring's (yards). */
  wave: number;
  hot: number;
  /** The wave's colour and the hot ring's. */
  waveColor: number;
  hotColor: number;
  /** Thrown rock and dust at the blow (before the tier's density). */
  rock: number;
  dust: number;
  /** The camera's shake near the blow and how far it reaches. */
  shake: number;
  shakeReach: number;
  sounds: readonly PullBeatSound[];
}

/** Seconds a beat runs (its last sound and ring have played by then). */
export const PULL_BEAT_SECONDS = 2.6;

export const COUNCIL_PULL_BEAT: Readonly<Record<CouncilRole, PullBeatSpec>> = {
  guardian: {
    gesture: COUNCIL_ENTRANCE_GESTURES.guardianPunch,
    impactAt: COUNCIL_AWAKEN_CLIP.punchContact,
    wave: 26,
    hot: 9,
    waveColor: 0x6a4626,
    hotColor: 0xffa040,
    rock: 34,
    dust: 26,
    shake: 0.42,
    shakeReach: 46,
    sounds: [
      {
        at: COUNCIL_AWAKEN_CLIP.punchContact,
        key: 'heart_council_slab_crush',
        gain: 1,
        rate: 0.72,
      },
      {
        at: COUNCIL_AWAKEN_CLIP.punchContact + 0.04,
        key: 'heart_council_wrath_blast',
        gain: 0.5,
        rate: 1.3,
      },
    ],
  },
  singer: {
    gesture: COUNCIL_ENTRANCE_GESTURES.singerNote,
    impactAt: COUNCIL_AWAKEN_CLIP.noteContact / COUNCIL_AWAKEN_CLIP.noteRate,
    wave: 22,
    hot: 7,
    waveColor: 0xf0c070,
    hotColor: 0xfff0c8,
    rock: 0,
    dust: 10,
    shake: 0.18,
    shakeReach: 34,
    sounds: [
      {
        at: COUNCIL_AWAKEN_CLIP.noteContact / COUNCIL_AWAKEN_CLIP.noteRate,
        key: 'heart_council_song_pulse',
        gain: 0.95,
        rate: 0.88,
      },
    ],
  },
};

/** Did the beat cross `at` between `prev` and `now` (seconds from its cue)? */
export function pullCrossed(prev: number, now: number, at: number): boolean {
  return prev < at && now >= at;
}

/** Every sample the beat plays (preloaded with the council's own). */
export const COUNCIL_PULL_SFX_KEYS: readonly string[] = [
  ...new Set(Object.values(COUNCIL_PULL_BEAT).flatMap((b) => b.sounds.map((s) => s.key))),
].sort();

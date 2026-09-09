// The six tracks, as data.
//
// Every track is the SAME core and the SAME painter, differing only by the rows
// it accepts and the shape those rows take. Six copies of a bar frame would have
// been six places to fix a bug; a descriptor table is one, and adding a seventh
// track later is a row here plus its container, never a new module.
//
// The split is by QUESTION, not by aura kind, which is why Guardian Covenant
// appears in two of them: one cast, two auras, and either can be dispelled
// without the other, so a single row would keep showing a protection that is
// already gone.

import type { TranslationKey } from '../../i18n.catalog';
import {
  type AuraTrackCategory,
  type AuraTrackEntry,
  type AuraTrackRowShape,
  DEFENSIVE_COOLDOWN_SEC,
} from './aura_track_catalog';

/** The BOOL_SETTINGS keys that switch the tracks on, named here rather than as
 *  `BoolSettingKey` because this is a pure core and may not import from
 *  src/game; tests/options_view.test.ts pins that each is a real setting. */
export type AuraTrackSettingKey =
  | 'showDefensivesTrack'
  | 'showSelfBuffTrack'
  | 'showOffensiveTrack'
  | 'showUtilityTrack'
  | 'showFriendlyTrack'
  | 'showShieldTrack';

export interface AuraTrackDescriptor {
  /** Stable id: the settings key suffix, the frame-spec id, and the test pin. */
  id: string;
  /** The container in index.html the Hud resolves once. */
  elementId: string;
  /** localStorage key its position and size persist under. */
  storageKey: string;
  /** The BOOL_SETTINGS key that switches this track on. */
  settingKey: AuraTrackSettingKey;
  /** Frame name chip while the interface is unlocked, and the frame's own
   *  accessible name. */
  labelKey: TranslationKey;
  /** How every row in this track reads. */
  shape: AuraTrackRowShape;
  /** Rows this track accepts. `entry` is the catalog record and `onSelf` says
   *  whether the aura was found on the player or on someone else. Pure: no host
   *  state, so a track's membership is decidable from a Vitest. */
  accepts(entry: AuraTrackEntry, onSelf: boolean): boolean;
}

// WHICH SIDE A ROW IS ON IS `onSelf`, THE UNIT THE AURA WAS FOUND ON.
//
// An earlier cut derived it from the ABILITY instead (where a spell can land)
// and got two things wrong at once: nothing stopped a self-only buff being
// accepted onto an ally row, and Patch Up, a heal on your pet that the content
// marks `requiresTarget: false`, was read as a self buff and went missing from
// the ally track it belongs to. Where an aura CAN land is a fact about the
// ability; where it DID land is a fact about the unit, and only the caller has
// it.
//
// Reading `onSelf` also makes Guardian Covenant work with no special case: the
// cast leaves TWO auras, one on you and one on the ally, so the self track picks
// up its half and the friendly track the other, and a dispel that takes one
// leaves the other row standing. That is what the two-bar request asked for, and
// it falls out rather than being arranged.

const PROTECTIVE: ReadonlySet<AuraTrackCategory> = new Set<AuraTrackCategory>(['guard', 'hot']);

export const AURA_TRACKS: readonly AuraTrackDescriptor[] = [
  {
    // "Am I covered right now." The emergency buttons: a long cooldown means you
    // pressed this once and will not get it back soon, so the seconds are the
    // whole message.
    id: 'defensives',
    elementId: 'aura-track-defensives',
    storageKey: 'woc_hud_frame_track_defensives',
    settingKey: 'showDefensivesTrack',
    labelKey: 'hudChrome.auraTracks.defensives',
    shape: 'timer',
    accepts: (entry, onSelf) =>
      onSelf && entry.category === 'guard' && entry.cooldown >= DEFENSIVE_COOLDOWN_SEC,
  },
  {
    // "What is my rotation keeping up." The short, repeatable mitigation and the
    // heals you put on yourself.
    id: 'self',
    elementId: 'aura-track-self',
    storageKey: 'woc_hud_frame_track_self',
    settingKey: 'showSelfBuffTrack',
    labelKey: 'hudChrome.auraTracks.self',
    shape: 'timer',
    accepts: (entry, onSelf) =>
      onSelf &&
      PROTECTIVE.has(entry.category) &&
      !(entry.category === 'guard' && entry.cooldown >= DEFENSIVE_COOLDOWN_SEC),
  },
  {
    // "What is boosting me, and how long have I got." Output windows, including
    // the ones you put on someone else: the question is about damage done, and
    // the protective tracks are about damage taken.
    id: 'power',
    elementId: 'aura-track-power',
    storageKey: 'woc_hud_frame_track_power',
    settingKey: 'showOffensiveTrack',
    labelKey: 'hudChrome.auraTracks.power',
    shape: 'timer',
    accepts: (entry) => entry.category === 'power',
  },
  {
    // "How am I moving, and am I hidden." The one track with two row shapes: a
    // sprint is a timer, stealth is a MODE the painter draws without a number.
    id: 'utility',
    elementId: 'aura-track-utility',
    storageKey: 'woc_hud_frame_track_utility',
    settingKey: 'showUtilityTrack',
    labelKey: 'hudChrome.auraTracks.utility',
    shape: 'timer',
    accepts: (entry) => entry.category === 'utility',
  },
  {
    // "Who am I keeping up." One row per ally-and-spell pair, the keying the
    // target-dot family uses per enemy-and-dot pair. The track that grows in a
    // raid, which is why it is the one with a name in every row.
    id: 'friendly',
    elementId: 'aura-track-friendly',
    storageKey: 'woc_hud_frame_track_friendly',
    settingKey: 'showFriendlyTrack',
    labelKey: 'hudChrome.auraTracks.friendly',
    shape: 'timer',
    accepts: (entry, onSelf) => !onSelf && PROTECTIVE.has(entry.category),
  },
  {
    // "How much is left of it." The only track whose number is not a clock: an
    // absorb's stored value IS its remaining shield, spent by incoming damage
    // while its duration runs in parallel, and whichever reaches zero first ends
    // it. Its rows print points and keep the seconds behind them.
    id: 'shields',
    elementId: 'aura-track-shields',
    storageKey: 'woc_hud_frame_track_shields',
    settingKey: 'showShieldTrack',
    labelKey: 'hudChrome.auraTracks.shields',
    shape: 'points',
    accepts: (entry) => entry.category === 'absorb',
  },
] as const;

/** Look one up by id (the Hud composes by id; tests pin by id). */
export function auraTrackDescriptor(id: string): AuraTrackDescriptor | undefined {
  return AURA_TRACKS.find((track) => track.id === id);
}

/** The prefix `interface_unlock_core` generates each track's HUD frame id with. */
export const AURA_TRACK_FRAME_PREFIX = 'auraTrack_';

/** The descriptor behind a HUD frame id, or undefined when the id names another
 *  frame. The frame specs are generated as `auraTrack_<id>`, so the unlock core
 *  and the Hud reverse that here rather than re-deriving the prefix. */
export function auraTrackForFrameId(frameId: string): AuraTrackDescriptor | undefined {
  if (!frameId.startsWith(AURA_TRACK_FRAME_PREFIX)) return undefined;
  return auraTrackDescriptor(frameId.slice(AURA_TRACK_FRAME_PREFIX.length));
}

// Which authored BODY gesture a hoard boss plays for which cue, and when. Pure:
// no Three.js, no DOM. The adapter (hoard_boss_gestures.ts) finds the boss and
// hands the gesture to the renderer's ordinary one-shot route, where it resolves
// through the visual's attackByAbility map (src/render/characters/manifest.ts).
//
// A hoard cue is a floor telegraph the sim resolves on its own clock; nothing in
// it names an ability the boss "swings", so without this his body idles through
// his own frontal. The gesture is cosmetic: it never decides a hit, and a rig
// without the clip simply keeps its stock attack.

import { type IceAgeTimeline, iceAgeTimeline } from '../sim/rift/hoard_ice_age_core';
import type { HoardBossCueVariant } from '../sim/rift/types';

/** Gesture ids: keys of a visual's attackByAbility, never sim ability ids. */
export const HOARD_GESTURE_FROST_GUST = 'hoard_gesture_frost_gust';
export const HOARD_GESTURE_ICE_AGE_RELEASE = 'hoard_gesture_ice_age_release';
export const HOARD_GESTURE_CALL_HAMMER = 'hoard_gesture_call_hammer';
export const HOARD_GESTURE_EMBER_FRONTAL = 'hoard_gesture_ember_frontal';
export const HOARD_GESTURE_CALL_STORM = 'hoard_gesture_call_storm';

export interface HoardBossGesture {
  /** The boss that owns the cue. */
  template: string;
  gesture: string;
  /** Seconds into the cue the gesture STARTS, so its key frame meets the hit. */
  startAt(total: number): number;
}

/** FrostFrontal's arms drive forward this long after the clip starts
 *  (scripts/assets/hoard_bosses/frost_fix.py, clip_frontal). */
export const FROST_GUST_RELEASE_SEC = 0.72;

/** The Tyrant's frontal reuses his rig's two-handed chop, whose maul comes down
 *  this long after the clip starts at its authored speed. */
export const EMBER_FRONTAL_RELEASE_SEC = 0.8;

// Read on every frame a cue is live: no allocation.
const LINE: IceAgeTimeline = {
  impactAt: 0,
  castAt: 0,
  castSec: 0,
  blastAt: 0,
  breakAt: 0,
  endAt: 0,
};

const GESTURES: Partial<Record<HoardBossCueVariant, HoardBossGesture>> = {
  'frost-gust': {
    template: 'rift_boss_frost',
    gesture: HOARD_GESTURE_FROST_GUST,
    startAt: (total) => Math.max(0, total - FROST_GUST_RELEASE_SEC),
  },
  // A call is the OPENING of its mechanic: the carrier cue's first moment.
  'ember-hammer': {
    template: 'rift_boss_ember',
    gesture: HOARD_GESTURE_CALL_HAMMER,
    startAt: () => 0,
  },
  'ember-frontal': {
    template: 'rift_boss_ember',
    gesture: HOARD_GESTURE_EMBER_FRONTAL,
    startAt: (total) => Math.max(0, total - EMBER_FRONTAL_RELEASE_SEC),
  },
  'storm-orbital': {
    template: 'rift_boss_storm',
    gesture: HOARD_GESTURE_CALL_STORM,
    startAt: () => 0,
  },
  'frost-iceage': {
    template: 'rift_boss_frost',
    gesture: HOARD_GESTURE_ICE_AGE_RELEASE,
    // The held cast clip ends with the cast bar; the blast throws the arms down.
    startAt: (total) => iceAgeTimeline(total, LINE).blastAt,
  },
};

export function hoardBossGesture(
  variant: HoardBossCueVariant | undefined,
): HoardBossGesture | undefined {
  return variant ? GESTURES[variant] : undefined;
}

/** How late a gesture may still start. A cue first seen after that (a player who
 *  walked in mid-cast, a mirror that reconnected) skips it rather than playing a
 *  wind-up for a hit that has already landed. */
export const HOARD_GESTURE_GRACE_SEC = 0.35;

export function hoardGestureDue(gesture: HoardBossGesture, total: number, remaining: number) {
  const late = total - remaining - gesture.startAt(total);
  return late >= 0 && late <= HOARD_GESTURE_GRACE_SEC;
}

// Pure, host-agnostic core for the in-rift HUD tracker (issue #2655): the
// current floor position ("Floor N of M") plus the live "closes in" countdown
// on the rift's backing world event. No DOM and no i18n runtime import: the
// countdown is split into whole hour/minute/second parts here, and the thin
// HUD controller (rift_floor_tracker_controller.ts) splices them into a
// localized t() template, mirroring the raid_lockout.ts precedent.
//
// timerSeconds is null for a rift with no backing RiftEvent (a /dev-spawned
// rift, see sim/rift/race.ts: dev portals are "deliberately outside the global
// race"), so the HUD degrades to floor-progress-only rather than a bogus timer.
// It is ALSO null once the countdown reaches zero: riftEventMsRemaining() keeps
// returning 0 after the backing RiftEvent's portal closes (the run inside keeps
// playing out, so the event is not deleted until trimEventHistory purges it), and
// a "Closes in 0:00" line stuck on screen indefinitely reads as broken rather than
// informative. Hiding it the moment it hits zero degrades the same way the
// dev-portal case already does, in both worlds at once (this core is the single
// place both Sim and ClientWorld route through).
// It is derived from IWorld.riftEventMsRemaining(), which each world (offline
// Sim, online ClientWorld) recomputes fresh from its own clock on every call
// (the same "no snapshot round trip" idiom as raidLockouts()), so simply
// re-reading the model on a poll is enough to tick the countdown down live.

import { vaultSeedTier } from '../../../sim/rift/vault_seed';
import type { IWorld } from '../../../world_api';

export interface RiftFloorTrackerModel {
  /** 1-based current floor, for "Floor {current} of {total}" display
   *  (RiftFloorView.floorIndex is 0-based). */
  floor: number;
  floorCount: number;
  /** Whole seconds remaining before the backing rift event stops admitting new
   *  parties, or null when there is no such event (a dev-spawned rift). */
  timerSeconds: number | null;
  /** A Buried Hoard (a treasure map's one-room vault, src/sim/rift/vault_seed.ts):
   *  the tracker names it as such and drops the floor line. */
  hoard: boolean;
  /** What a hoard asks right now: kill its keeper, open the chest the keeper
   *  left, or nothing more (the chest is open). Always 'keeper' outside a hoard. */
  hoardStage: HoardTrackerStage;
}

export type HoardTrackerStage = 'keeper' | 'chest' | 'claimed';

/** The stage, from the run's reward chest as this client sees it (absent until
 *  the keeper falls). Pure: the controller finds the chest, this names the stage. */
export function hoardTrackerStage(
  chest: { templateId: string } | null | undefined,
): HoardTrackerStage {
  if (!chest) return 'keeper';
  return chest.templateId === 'hoard_reward_chest' ? 'chest' : 'claimed';
}

/** Null outside a rift (world.riftFloor is null). */
export function riftFloorTrackerModel(
  world: Pick<IWorld, 'riftFloor' | 'riftEventMsRemaining'>,
  hoardChest?: { templateId: string } | null,
): RiftFloorTrackerModel | null {
  const floor = world.riftFloor;
  if (!floor) return null;
  const msRemaining = world.riftEventMsRemaining();
  const wholeSeconds = msRemaining === null ? null : Math.floor(msRemaining / 1000);
  return {
    floor: floor.floorIndex + 1,
    floorCount: floor.floorCount,
    timerSeconds: wholeSeconds === null || wholeSeconds <= 0 ? null : wholeSeconds,
    hoard: vaultSeedTier(floor.seed) !== null,
    hoardStage: hoardTrackerStage(hoardChest),
  };
}

export interface RiftTimerParts {
  hours: number;
  minutes: number;
  seconds: number;
}

/** Whole hour/minute/second parts of a remaining span, so the consumer can pick
 *  between an "H:MM:SS" and a "M:SS" clock template (an ordinary rift portal
 *  lives up to an hour; a community one can run up to six). */
export function riftTimerParts(totalSeconds: number): RiftTimerParts {
  const s = Math.max(0, Math.floor(totalSeconds));
  return {
    hours: Math.floor(s / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

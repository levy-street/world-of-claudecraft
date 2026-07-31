// Bow-native ranged attack cycle (pure, three-free; stow_transition.ts pattern).
//
// The v04 hunter rig authors its ranged kit as a real archer sequence:
//   draw (Spellcasting, ~1.03s) -> hold (2H_Ranged_Shoot loop, live aim sway)
//   -> release (Bow_Release, 0.70s: string snap at ~0.15s, then follow-through
//   back to the relaxed carry pose the draw starts from).
// The three clips chain pose-exactly, so the cycle loops seamlessly:
// carry -> draw -> hold -> snap -> carry -> draw ...
//
// THE TIMING CONTRACT: the release's string-snap frame must land exactly on the
// moment the sim launches the projectile. The release is therefore split in two:
//   'arm'   - the pre-snap anticipation [0 .. releaseArmAt], SCRUBBED against the
//             authoritative countdown (self swing timer, or the replicated cast
//             remaining), never free-running. A stalled shot (target stepped out
//             of the window, cast pushback) just stops or retreats the scrub.
//   'loose' - snap + follow-through [releaseArmAt .. end], free-running, entered
//             ONLY on the sim's actual launch event. The snap can never play for
//             a shot that did not happen.
// Remote hunters replicate neither autoAttack nor swingTimer (self-only wire
// fields), so they run on launch events alone: loose on the event, then draw and
// hold again while the recent-shot window lasts. Casts (Long Draw) replicate
// castRemaining for every entity, so remote rigs scrub those exactly too.
//
// This module owns the phase and timing decisions so they are Node-testable;
// visual.ts stays the thin consumer that plays/fades/scrubs the actions, and the
// renderer feeds per-frame facts through AnimState (writeBowShotInputs).

import { ABILITIES, CLASSES } from '../../sim/content/classes';

export type BowPhase = 'off' | 'draw' | 'hold' | 'arm' | 'loose';

/** What the visual must do on this tick: start a phase's action, or nothing. */
export type BowAct = 'none' | 'draw' | 'hold' | 'arm' | 'loose' | 'lower';

export interface BowCycleState {
  phase: BowPhase;
  /** Seconds a rig with no local shot prediction (a remote hunter) keeps the
   *  bow raised after its last observed launch. */
  remoteWindow: number;
}

export function createBowCycle(): BowCycleState {
  return { phase: 'off', remoteWindow: 0 };
}

export interface BowFrameInput {
  dt: number;
  /** The body may run the cycle this frame (alive, grounded, standing still). */
  poseOk: boolean;
  /** Intent: auto-shot on a live target inside the ranged window, or casting
   *  a projectile shot (writeBowShotInputs). */
  engaged: boolean;
  /** This rig's engagement is authoritative (the local player): the
   *  recent-shot window never keeps ITS bow up, so the cycle folds the moment
   *  the target dies or auto-attack drops. Remote rigs (false) ride the
   *  window between observed launches instead. */
  localIntent: boolean;
  /** Seconds until the predicted launch; null = unknown (remote auto-shot). */
  timeToShot: number | null;
  /** A ranged projectile actually launched this frame (the sim event). */
  launch: boolean;
  /** The draw one-shot finished (reported back by the visual). */
  drawDone: boolean;
  /** The release one-shot finished (reported back by the visual). */
  looseDone: boolean;
}

export interface BowCycleConfig {
  /** Seconds into the release clip where the string snaps (the launch frame). */
  armAt: number;
}

/** How long a remote rig stays drawn waiting for the next observed shot; a bit
 *  over the slowest auto-shot cadence so the bow does not bob between shots. */
export const BOW_REMOTE_WINDOW_S = 4;

/** Countdown slack before an armed release retreats to the hold: a stalled shot
 *  (pushback, target dancing on the range edge) larger than this un-arms. */
export const BOW_ARM_SLACK_S = 0.3;

/** The draw may compress this much under haste; beyond it the hold shortens. */
export const BOW_DRAW_MAX_TIMESCALE = 2.5;

/** Advance one frame. Mutates `st`, returns the action the visual must take.
 *  'none' means stay the course (the visual self-heals a displaced hold loop). */
export function tickBowCycle(st: BowCycleState, input: BowFrameInput, cfg: BowCycleConfig): BowAct {
  st.remoteWindow = input.launch ? BOW_REMOTE_WINDOW_S : Math.max(0, st.remoteWindow - input.dt);
  const wants = input.poseOk && (input.engaged || (!input.localIntent && st.remoteWindow > 0));
  const shotImminent = input.timeToShot !== null && input.timeToShot <= cfg.armAt;
  switch (st.phase) {
    case 'off':
      if (input.launch && input.poseOk) {
        st.phase = 'loose';
        return 'loose';
      }
      if (wants) {
        st.phase = 'draw';
        return 'draw';
      }
      return 'none';
    case 'draw':
      if (input.launch) {
        st.phase = 'loose';
        return 'loose';
      }
      if (!wants) {
        st.phase = 'off';
        return 'lower';
      }
      if (shotImminent) {
        st.phase = 'arm';
        return 'arm';
      }
      if (input.drawDone) {
        st.phase = 'hold';
        return 'none'; // the visual already handed draw -> hold in onFinished
      }
      return 'none';
    case 'hold':
      if (input.launch) {
        st.phase = 'loose';
        return 'loose';
      }
      if (!wants) {
        st.phase = 'off';
        return 'lower';
      }
      if (shotImminent) {
        st.phase = 'arm';
        return 'arm';
      }
      return 'none';
    case 'arm':
      if (input.launch) {
        st.phase = 'loose';
        return 'loose';
      }
      if (!wants) {
        st.phase = 'off';
        return 'lower';
      }
      if (input.timeToShot === null || input.timeToShot > cfg.armAt + BOW_ARM_SLACK_S) {
        st.phase = 'hold';
        return 'hold';
      }
      return 'none'; // the visual scrubs via bowArmScrubTime
    case 'loose':
      if (input.launch) return 'loose'; // instant re-shot: snap again
      if (!input.poseOk) {
        st.phase = 'off';
        return 'lower';
      }
      if (input.looseDone) {
        if (wants) {
          st.phase = 'draw';
          return 'draw';
        }
        st.phase = 'off';
        return 'lower';
      }
      return 'none';
  }
}

/** Scrub position for an armed release: the pre-snap segment tracks the shot
 *  countdown 1:1, clamped so a stalled countdown parks at full draw. */
export function bowArmScrubTime(armAt: number, timeToShot: number): number {
  return Math.min(armAt, Math.max(0, armAt - timeToShot));
}

/** Draw playback speed so the draw completes before the release must arm.
 *  Unknown countdowns (remote rigs, casts still syncing) draw at authored pace. */
export function bowDrawTimeScale(
  drawDuration: number,
  armAt: number,
  timeToShot: number | null,
): number {
  if (timeToShot === null) return 1;
  const available = timeToShot - armAt - 0.08;
  if (available <= 0) return BOW_DRAW_MAX_TIMESCALE;
  return Math.min(BOW_DRAW_MAX_TIMESCALE, Math.max(1, drawDuration / available));
}

// ---------------------------------------------------------------------------
// Renderer-side input derivation
// ---------------------------------------------------------------------------

/** The margins around the sim's ranged window inside which the bow stays up:
 *  the sim gate is exact, so without slack a target dancing on the boundary
 *  would bob the bow up and down every frame. */
const RANGE_SLACK_NEAR = 0.5;
const RANGE_SLACK_FAR = 1.5;

export interface BowShotEntityFacts {
  kind: string;
  /** The player's class on every host (see visualKeyFor). */
  templateId: string;
  autoAttack: boolean;
  swingTimer: number;
  castingAbility: string | null;
  castRemaining: number;
}

export interface BowShotAnimState {
  bowEngaged?: boolean;
  bowLocalIntent?: boolean;
  bowTimeToShot?: number | null;
}

/** Derive the cycle's per-frame facts from an entity (writes into the shared
 *  AnimState scratch: no allocation on the per-entity render path).
 *  - A projectile CAST (Long Draw) engages for every entity: castRemaining is
 *    replicated, so remote rigs scrub the release exactly like the local one.
 *  - AUTO-SHOT prediction is self-only (autoAttack and swingTimer are self-only
 *    wire fields); remote auto-shots ride the launch-event window instead. */
export function writeBowShotInputs(
  st: BowShotAnimState,
  e: BowShotEntityFacts,
  isSelf: boolean,
  distToLiveTarget: number | null,
): void {
  st.bowEngaged = false;
  st.bowLocalIntent = isSelf && e.kind === 'player';
  st.bowTimeToShot = null;
  if (e.kind !== 'player') return;
  if (e.castingAbility && ABILITIES[e.castingAbility]?.projectile === true) {
    st.bowEngaged = true;
    st.bowTimeToShot = Math.max(0, e.castRemaining);
    return;
  }
  if (!isSelf || !e.autoAttack || distToLiveTarget === null) return;
  const ranged = CLASSES[e.templateId as keyof typeof CLASSES]?.ranged;
  if (!ranged) return;
  if (
    distToLiveTarget <= ranged.maxRange + RANGE_SLACK_FAR &&
    distToLiveTarget >= ranged.minRange - RANGE_SLACK_NEAR
  ) {
    st.bowEngaged = true;
    st.bowTimeToShot = Math.max(0, e.swingTimer);
  }
}

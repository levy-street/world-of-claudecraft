// Pure, host-agnostic view model for the show-jumping race bottom strip (the
// Highwatch stables paddock race).
//
// This is the pure-core half of the pure-core + thin-consumer split (root
// CLAUDE.md Conventions; reference vendor_view.ts). It maps the raw
// IWorld.MountRaceView into a render model the thin painter
// (mount_race_strip.ts) draws. DOM/Three/i18n-free so
// tests/mount_race_view.test.ts can drive it directly. The painter renders every
// player-visible string through the hudChrome.mountRace.* t() keys. It exposes
// only whole seconds plus a bar fraction (importing only the sim TICK_RATE
// constant, no DOM).

import { TICK_RATE } from '../sim/types';
import type { MountRaceView } from '../world_api';

export interface MountRaceRenderModel {
  /** False when the strip has nothing to paint: no race, or the pre-GO countdown
   *  (the center-screen 3..2..1 element owns that phase, not the strip). */
  active: boolean;
  /** Whole seconds left on the lap timer (ceil, so it reads "1" until truly 0). */
  secondsLeft: number | null;
  /** Lap-timer bar fill fraction [0..1]. */
  timeFraction: number | null;
}

const IDLE_MODEL: MountRaceRenderModel = {
  active: false,
  secondsLeft: null,
  timeFraction: null,
};

/** Build the strip's render model from the authoritative self view. Null (not
 *  racing) OR the countdown phase maps to the shared IDLE_MODEL instance: the
 *  strip paints only during the timed lap. Allocation-light. */
export function mountRaceRenderModel(view: MountRaceView | null): MountRaceRenderModel {
  if (!view || view.phase !== 'racing') return IDLE_MODEL;
  const secondsLeft = Math.ceil(view.ticksLeft / TICK_RATE);
  const timeFraction =
    view.timeLimitTicks > 0 ? Math.max(0, Math.min(1, view.ticksLeft / view.timeLimitTicks)) : 0;
  return { active: true, secondsLeft, timeFraction };
}

/** Compact signature of everything the strip paint depends on: the per-frame
 *  repaintIfChanged safety net compares this against the last paint and only
 *  touches the DOM when it changes. The timer is bucketed to whole seconds so the
 *  online mirror's wall-clock drift repaints once a second, not every frame; the
 *  phase is included so the countdown-to-racing flip repaints. */
export function mountRaceRenderSig(view: MountRaceView): string {
  const secBucket = Math.ceil(view.ticksLeft / TICK_RATE);
  return `${view.raceId}|${view.phase}|${secBucket}`;
}

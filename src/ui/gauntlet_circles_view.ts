// Pure view-core for the Great Pull's shrinking-circle input overlay.
// DOM/Three/i18n-free and deterministic: it maps the viewer's wire circle (an
// absolute spawn time plus a rolled full-shrink duration; sizes are abstract
// units the client renders as CSS px 1:1) and the estimated sim time into a
// flat render model. The painter (gauntlet_circles_painter.ts) turns the model
// into DOM through the elided writers and rolls the circle's screen position
// on its side (client-chosen, cosmetic, never scored: only spawn time + shrink
// rate are authoritative).

import type { GauntletRunView } from '../sim/types';

/** The near-target band, as a fraction of the target size: while the ring is
 * within it the painter lights the ring so the player learns where the hard
 * pulls live. Cosmetic only; the sim grades the real force at receipt. */
export const GAUNTLET_CIRCLE_NEAR_FRAC = 0.2;

/** The flat render model the circles painter consumes. */
export interface GauntletCircleModel {
  /** Whether the circle shows at all (spawned, not yet expired, viewer live). */
  visible: boolean;
  /** The circle id a click must name (IWorld gauntletPullCircle); -1 hidden. */
  id: number;
  /** Current outer-ring diameter in CSS px, quarter-px quantized: fine enough
   *  that a 60fps shrink reads as one continuous glide, coarse enough that an
   *  unchanged frame still elides its write. */
  sizePx: number;
  /** The fixed target-indicator diameter, whole CSS px. */
  targetPx: number;
  /** True inside the near-target band (the painter lights the ring). */
  near: boolean;
  /** 0..1 shrink progress (0 fresh, 1 gone). */
  fraction: number;
}

/** The per-frame input: the viewer's run projection and the estimated sim time. */
export interface GauntletCircleInput {
  run: GauntletRunView | null;
  time: number;
}

// The one reused model container (per-frame core: no per-frame allocation).
const MODEL: GauntletCircleModel = {
  visible: false,
  id: -1,
  sizePx: 0,
  targetPx: 0,
  near: false,
  fraction: 0,
};

function hidden(): GauntletCircleModel {
  MODEL.visible = false;
  MODEL.id = -1;
  MODEL.sizePx = 0;
  MODEL.targetPx = 0;
  MODEL.near = false;
  MODEL.fraction = 0;
  return MODEL;
}

/** Map the viewer's run projection + sim time into the circle render model.
 * Returns a REUSED container: consume it synchronously, never retain it. */
export function gauntletCircleModel(input: GauntletCircleInput): GauntletCircleModel {
  const { run, time } = input;
  // The wire already nulls the circle for spectators; the phase/finish gates
  // ride the substate too (run.pull only exists during the live trial).
  const circle = run && !run.spectating ? (run.pull?.circle ?? null) : null;
  if (!circle || circle.shrinkS <= 0 || time < circle.spawnAt) return hidden();
  const size = circle.startSize - (circle.startSize / circle.shrinkS) * (time - circle.spawnAt);
  if (size <= 0) return hidden(); // expired client-side; the sim re-deals
  MODEL.visible = true;
  MODEL.id = circle.id;
  MODEL.sizePx = Math.max(1, Math.round(size * 4) / 4);
  MODEL.targetPx = Math.round(circle.targetSize);
  MODEL.near = Math.abs(size - circle.targetSize) <= circle.targetSize * GAUNTLET_CIRCLE_NEAR_FRAC;
  MODEL.fraction = Math.min(1, Math.max(0, (time - circle.spawnAt) / circle.shrinkS));
  return MODEL;
}

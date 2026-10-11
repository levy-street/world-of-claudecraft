// When the client itself paces rendered frames (the frame rate ceiling,
// src/game/frame_cadence_core.ts), the wall interval between frames is a
// choice, not a cost: read raw, a held 33 ms rhythm is over every tier's frame
// budget and is exactly the shape the external frame cap detector probes for.
// What still measures the machine is how often a frame MISSES its chosen slot,
// so that share stands in for the interval on the governor's frame axis.
//
// Pure: a share in, the frame-ms reading the governor judges out.

/** Share of rendered frames that may arrive late before the frame axis reads
 *  over budget. A ratio of frames, never a millisecond bound. */
export const CHOSEN_CADENCE_ALLOWED_MISS_SHARE = 0.1;
/** A held rhythm reads this far under the recover line, so recovery is
 *  allowed at a miss share near zero and closes well before the budget. */
const HELD_RHYTHM_RECOVER_SHARE = 0.8;
/** Past this many times the allowed share the reading stops growing. */
const MAX_PRESSURE_MULTIPLE = 4;

/** Marker for "no chosen cadence": the governor reads the wall interval. */
export const NO_CHOSEN_CADENCE = -1;

/**
 * The frame-ms reading for a chosen cadence: the held rhythm sits under
 * `recoverFrameMs`, the allowed miss share lands exactly on `dropFrameMs`
 * (pressure 1), and it keeps growing past it toward the urgent line.
 */
export function chosenCadenceFrameMs(
  missShare: number,
  dropFrameMs: number,
  recoverFrameMs: number,
): number {
  const held = recoverFrameMs * HELD_RHYTHM_RECOVER_SHARE;
  const ratio = Math.min(
    MAX_PRESSURE_MULTIPLE,
    Math.max(0, missShare) / CHOSEN_CADENCE_ALLOWED_MISS_SHARE,
  );
  return held + (dropFrameMs - held) * ratio;
}

const NOMINAL_FRAME_MS = 1000 / 60;

/**
 * The interval the load-reading consumers judge (GPU-prep headroom, the view
 * creation budget, the entry detail horizon, the shader-warm pause). Under a
 * chosen cadence a held frame reads as a nominal one and only the time past
 * the chosen interval counts as lateness; with none the wall interval stands.
 */
export function chosenCadenceLoadMs(intervalMs: number, chosenIntervalMs: number): number {
  if (!(chosenIntervalMs > 0)) return intervalMs;
  return NOMINAL_FRAME_MS + Math.max(0, intervalMs - chosenIntervalMs);
}

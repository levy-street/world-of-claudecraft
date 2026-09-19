// The player's frame rate ceiling, seen from the game: a stored number
// (Settings keeps numbers and booleans only) mapped to the cadence core's
// intent, plus the pure reading the options row shows under its buttons.
// What is stored is an INTENT. Nothing about the display is ever persisted: the
// divisor is re-derived from the measured refresh rate, so a new monitor or a
// window dragged to another screen needs no migration.

import type { RefreshVerdict } from './display_refresh_estimator_core';
import { ceilingDivisor, type FrameCeilingIntent } from './frame_cadence_core';

/** The stored values, in the order the options row lists them. */
export const FRAME_RATE_CAP_VALUES = { auto: 0, display: 1, sixty: 2, thirty: 3 } as const;

export type FrameRateCapChoice = keyof typeof FRAME_RATE_CAP_VALUES;

export function frameRateCapChoiceFromValue(value: number): FrameRateCapChoice {
  const rounded = Math.round(value);
  if (rounded === FRAME_RATE_CAP_VALUES.auto) return 'auto';
  if (rounded === FRAME_RATE_CAP_VALUES.sixty) return 'sixty';
  if (rounded === FRAME_RATE_CAP_VALUES.thirty) return 'thirty';
  return 'display';
}

/** The ceiling an explicit choice asks for; null for Auto, which the automatic
 *  mode resolves from what the machine demonstrably holds. */
export function explicitCeilingIntent(choice: FrameRateCapChoice): FrameCeilingIntent | null {
  if (choice === 'sixty') return 60;
  if (choice === 'thirty') return 30;
  if (choice === 'display') return 0;
  return null;
}

export type FrameRateCapReading =
  | { kind: 'none' }
  | { kind: 'inert' }
  | { kind: 'paced'; fps: number; refreshHz: number }
  | { kind: 'unpaced'; fps: number };

/** What an intent does on the display as it is read right now. Computed from
 *  the display reading alone, so the row is right the instant it is picked.
 *  `displayRead` is false while the estimator has not had its say yet (the first
 *  seconds in the world): `unknown` then means "not read yet", not "no display
 *  rhythm", and the row states nothing rather than the vsync-off wording on a
 *  display that is about to read as paced. The line is resolved when the panel
 *  is built and never corrects itself, so it must not be wrong when it appears. */
export function frameRateCapReading(
  intent: FrameCeilingIntent,
  verdict: RefreshVerdict,
  refreshHz: number,
  displayRead = true,
): FrameRateCapReading {
  if (intent === 0) return { kind: 'none' };
  if (verdict === 'unknown' && !displayRead) return { kind: 'none' };
  if (verdict !== 'paced' || !(refreshHz > 0)) return { kind: 'unpaced', fps: intent };
  const divisor = ceilingDivisor(refreshHz, intent);
  if (divisor === 1) return { kind: 'inert' };
  return { kind: 'paced', fps: Math.round(refreshHz / divisor), refreshHz: Math.round(refreshHz) };
}

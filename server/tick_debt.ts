// Pure fixed-step debt planning. The caller stores debtAfterSeconds before it
// executes any scheduled tick so a failed tick cannot replay the same debt.

export interface TickDebtPlan {
  ticks: number;
  debtAfterSeconds: number;
  droppedSeconds: number;
  capped: boolean;
}

export interface TickCallbackPlan extends TickDebtPlan {
  cadenceElapsedSeconds: number;
}

export const DEFAULT_MAX_CATCH_UP_TICKS = 4;
export const DEFAULT_MAX_CADENCE_ELAPSED_SECONDS = 0.5;

export function planTickDebt(
  accumulatedSeconds: number,
  elapsedSeconds: number,
  stepSeconds: number,
  maxCatchUpTicks = DEFAULT_MAX_CATCH_UP_TICKS,
): TickDebtPlan {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    throw new RangeError('stepSeconds must be finite and greater than zero');
  }
  if (!Number.isInteger(maxCatchUpTicks) || maxCatchUpTicks < 1) {
    throw new RangeError('maxCatchUpTicks must be a positive integer');
  }

  const accumulated =
    Number.isFinite(accumulatedSeconds) && accumulatedSeconds > 0 ? accumulatedSeconds : 0;
  const elapsed = Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0;
  const total = accumulated + elapsed;
  const dueTicks = Math.floor((total + Number.EPSILON) / stepSeconds);
  const ticks = Math.min(dueTicks, maxCatchUpTicks);
  const capped = dueTicks > maxCatchUpTicks;

  if (!capped) {
    return {
      ticks,
      debtAfterSeconds: Math.max(0, total - ticks * stepSeconds),
      droppedSeconds: 0,
      capped: false,
    };
  }

  // Retain only the sub-tick remainder. Carrying any whole overdue tick would
  // let repeated overloaded callbacks grow an event-loop death spiral.
  const remainder = total - dueTicks * stepSeconds;
  const droppedSeconds = (dueTicks - ticks) * stepSeconds;
  return {
    ticks,
    debtAfterSeconds: Math.max(0, remainder),
    droppedSeconds,
    capped: true,
  };
}

export function planTickCallback(
  accumulatedSeconds: number,
  rawElapsedSeconds: number,
  stepSeconds: number,
  maxCatchUpTicks = DEFAULT_MAX_CATCH_UP_TICKS,
  maxCadenceElapsedSeconds = DEFAULT_MAX_CADENCE_ELAPSED_SECONDS,
): TickCallbackPlan {
  if (!Number.isFinite(maxCadenceElapsedSeconds) || maxCadenceElapsedSeconds < 0) {
    throw new RangeError('maxCadenceElapsedSeconds must be finite and non-negative');
  }
  const elapsed =
    Number.isFinite(rawElapsedSeconds) && rawElapsedSeconds > 0 ? rawElapsedSeconds : 0;
  return {
    ...planTickDebt(accumulatedSeconds, elapsed, stepSeconds, maxCatchUpTicks),
    // Periodic social and persistence work retains the legacy stall cap.
    // Simulation debt and dropped-time accounting use the full wall time.
    cadenceElapsedSeconds: Math.min(elapsed, maxCadenceElapsedSeconds),
  };
}

// The clock and timer ports a background job takes through its injected seam
// (the keep-forever housing growth monitor, server/freehold_receipt_growth_monitor.ts),
// bound once here so the composition root carries one call instead of the
// closures. Every timer is unref'd: telemetry must never hold the process open
// on its own, and each cancel clears exactly the timer it armed.

export interface UnrefTimerPorts {
  readonly nowMs: () => number;
  /** Arm a one-shot deadline; the returned function cancels it. */
  readonly scheduleDeadline: (callback: () => void, ms: number) => () => void;
  /** Arm a repeating beat; the returned function stops it. */
  readonly scheduleRepeating: (callback: () => void, ms: number) => () => void;
}

export function unrefTimerPorts(): UnrefTimerPorts {
  return {
    nowMs: Date.now,
    scheduleDeadline: (callback, ms) => {
      const timer = setTimeout(callback, ms);
      timer.unref();
      return () => clearTimeout(timer);
    },
    scheduleRepeating: (callback, ms) => {
      const timer = setInterval(callback, ms);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

// Smoothed round-trip cost of the local player's movement intent: how long it
// takes an input to come back echoed in an authoritative snapshot, plus how
// unsteady that number is. Both feed display-only latency compensation (the
// adaptive self alpha lead and the self-motion predictor's window), never a
// gameplay outcome.

const ECHO_EMA_ALPHA = 0.2;

export class InputEchoTracker {
  echoMs = 0;
  jitterMs = 0;

  /** Fold one frame's echo samples in, oldest first. Negative or non-finite
   *  samples are ignored (a malformed frame must not poison the mean). */
  fold(samples: number[]): void {
    for (const sample of samples) {
      if (Number.isFinite(sample) && sample >= 0) {
        // Jitter is the mean absolute deviation against the PRIOR mean (measuring
        // it after the EMA update would bias it low).
        const prevMean = this.echoMs;
        this.echoMs = prevMean === 0 ? sample : prevMean + ECHO_EMA_ALPHA * (sample - prevMean);
        const dev = prevMean === 0 ? 0 : Math.abs(sample - prevMean);
        this.jitterMs =
          this.jitterMs === 0 ? dev : this.jitterMs + ECHO_EMA_ALPHA * (dev - this.jitterMs);
      }
    }
  }
}

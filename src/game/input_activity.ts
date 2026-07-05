// Input-activity meter for the "APM" perf-overlay readout

const WINDOW_MS = 60_000;

export class InputActivityMeter {
  private readonly times: number[] = []; // edge timestamps (ms), oldest first
  private sinceDrain = 0;                // edges since the last drainCount()

  /** Record one discrete player input edge at `nowMs`. */
  record(nowMs: number): void {
    this.times.push(nowMs);
    this.sinceDrain++;
    this.prune(nowMs);
  }

  /** Edges in the trailing 60 s window (a per-minute rate, since the window is 60 s). */
  apm(nowMs: number): number {
    this.prune(nowMs);
    return this.times.length;
  }

  /** Edges recorded since the previous drain; resets the counter (for the heartbeat). */
  drainCount(): number {
    const n = this.sinceDrain;
    this.sinceDrain = 0;
    return n;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - WINDOW_MS;
    let i = 0;
    while (i < this.times.length && this.times[i] < cutoff) i++;
    if (i > 0) this.times.splice(0, i);
  }
}

/** The raw player input events. `pointerdown` unifies mouse, touch and pen, so
 * it covers desktop clicks, the mobile virtual joysticks and on-screen action
 * taps with one listener. */
const TRACKED_EVENTS = ['keydown', 'pointerdown', 'wheel'] as const;

/** Subscribe `meter` to player input on `target` (default `window`). Records one
 *  edge per press, skipping auto-repeat keydowns (a held key is one edge).
 *  Returns a cleanup that removes the listeners. */
export function installInputActivityTracking(
  meter: InputActivityMeter,
  target: EventTarget,
  now: () => number,
): () => void {
  const onEdge = (e: Event): void => {
    if (!e.isTrusted) return;
    if (e.type === 'keydown' && (e as KeyboardEvent).repeat) return;
    meter.record(now());
  };
  for (const type of TRACKED_EVENTS) {
    target.addEventListener(type, onEdge, { capture: true, passive: true });
  }
  return () => {
    for (const type of TRACKED_EVENTS) {
      target.removeEventListener(type, onEdge, { capture: true } as EventListenerOptions);
    }
  };
}

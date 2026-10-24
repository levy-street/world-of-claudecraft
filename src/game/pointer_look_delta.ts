// Normalize pointer mouse-look deltas to one cross-browser unit.
//
// MouseEvent.movementX / movementY are NOT reported in the same unit across
// engines (w3c/pointerlock#42, #23; w3c/uievents#40):
//   - Chromium reports them in PHYSICAL device pixels, independent of both the
//     OS device-scale-factor and the page zoom.
//   - Gecko (Firefox) reports them in CSS pixels, i.e. physical pixels divided
//     by devicePixelRatio (which folds in the OS HiDPI scale AND the page zoom).
// By definition devicePixelRatio is exactly the physical-per-CSS-pixel ratio, so
// on any display where it is not 1 (a retina Mac, a scaled Windows desktop, or
// any non-100% browser zoom) the same physical mouse motion yields a Gecko delta
// that is 1/devicePixelRatio of the Chromium delta, so the camera rotates at the
// wrong speed there while Chromium feels correct. Mouse-look sensitivity is tuned
// against the Chromium physical-pixel unit, so we convert Gecko's CSS-pixel delta
// back to physical pixels by multiplying by devicePixelRatio. Every other engine
// is a pass-through, so Chromium and WebKit behavior is byte-for-byte unchanged.
//
// Pure and DOM-free (the caller passes the engine flag and the live ratio) so it
// unit-tests without a browser, the same pattern as pointer_lock.ts / click_move.ts.

export interface PointerLookDeltaInput {
  /** Raw event.movementX. */
  readonly movementX: number;
  /** Raw event.movementY. */
  readonly movementY: number;
  /** True only for the Gecko/Firefox engine (the one that reports CSS pixels). */
  readonly isGecko: boolean;
  /** window.devicePixelRatio at read time (OS scale multiplied by page zoom). */
  readonly devicePixelRatio: number;
}

export interface PointerLookDelta {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Convert a raw movementX/movementY pair into the Chromium physical-pixel unit
 * the mouse-look sensitivity is tuned against. Only Gecko diverges, so for every
 * other engine this returns the deltas unchanged (Chromium/WebKit parity). A
 * non-finite or non-positive ratio falls back to 1 so a bogus reading can never
 * scale the delta to zero (frozen camera) or blow it up.
 */
export function normalizePointerLookDelta(input: PointerLookDeltaInput): PointerLookDelta {
  const { movementX, movementY, isGecko, devicePixelRatio } = input;
  if (!isGecko) return { dx: movementX, dy: movementY };
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { dx: movementX * dpr, dy: movementY * dpr };
}

// Reject the bogus single-event jumps a pointer-locked mouse can report.
//
// Mouse-look integrates every movementX/movementY it is handed, so one wrong
// reading turns straight into a visible camera snap. Two sources are known:
//   - The event right after the lock engages. The browser warps the OS cursor
//     as the lock lands and the warp can surface as one large delta (the jump
//     players see at the start of a right-drag).
//   - Isolated spikes mid-drag. High polling-rate mice (1000 Hz and up) on
//     Windows deliver far more events per second, so an occasional bad reading
//     from the OS cursor-recentering path is far more likely to land (Firefox
//     shipped a fix for one such accumulation bug, Mozilla bug 2055058).
// The raw-input lock (pointer_lock_request.ts) removes most of the second
// source where the browser supports it; this guard is the backstop everywhere.
//
// The rule is built so that real motion is never thrown away:
//   - A spike is judged by SPEED (pixels per millisecond, from the event
//     timestamps), not by size. Browsers merge queued moves into one event
//     during a main-thread hitch, so a big delta that took 150 ms to build is
//     ordinary motion at the usual speed and passes.
//   - It must also clear an absolute size floor, so small readings never count.
//   - A suspect is HELD for one event, not discarded. If the next event moves
//     at a comparable speed (a fast flick from rest, sustained large motion, or
//     a warp immediately undone by its counter-warp), both apply together; only
//     a suspect followed by calm motion is dropped as an isolated spike.
// Without timestamps (tests, or a host that omits them) every event counts as
// one nominal millisecond, which turns speed back into plain size.
// Units are the physical pixels normalizePointerLookDelta returns, independent
// of the look sensitivity.

/** At or below this size (physical px) a delta is never a spike. */
export const LOOK_SPIKE_FLOOR_PX = 250;
/** A delta above the floor is suspect when it moves this many times faster than recent motion. */
export const LOOK_SPIKE_RATIO = 8;
/** How many recent accepted deltas define the recent speed. */
export const LOOK_SPIKE_HISTORY = 8;
/** Smallest elapsed time a speed is divided by, so same-timestamp events stay finite. */
export const LOOK_SPIKE_MIN_DT_MS = 1;
/** Elapsed time assumed for the first event of a press (one 60 Hz frame). */
export const LOOK_SPIKE_FIRST_DT_MS = 1000 / 60;

interface LookSample {
  readonly dx: number;
  readonly dy: number;
  readonly mag: number;
  readonly dt: number;
}

export class LookDeltaGuard {
  private readonly recent: LookSample[] = [];
  private held: LookSample | null = null;
  private lastTimeMs: number | null = null;
  private skipNext = false;
  /** Deltas discarded since construction; read by the unit tests. */
  dropped = 0;

  /** Forget the recent motion for a fresh press, including a held suspect and a pending skip. */
  reset(): void {
    this.recent.length = 0;
    this.held = null;
    this.lastTimeMs = null;
    this.skipNext = false;
  }

  /** Drop the next non-zero delta (and any held suspect): the pointer lock just engaged. */
  skipNextDelta(): void {
    if (this.held) this.dropped++;
    this.held = null;
    this.skipNext = true;
  }

  /**
   * The delta the camera should turn by for this event, or null when nothing
   * applies yet (a dropped reading, or a suspect held for one event). A
   * confirmed held suspect comes back summed with this event's delta.
   */
  filter(dx: number, dy: number, timeStampMs?: number): PointerLookDelta | null {
    const mag = Math.hypot(dx, dy);
    if (!Number.isFinite(mag)) {
      this.dropped++;
      return null;
    }
    if (mag === 0) return { dx, dy };
    const sample: LookSample = { dx, dy, mag, dt: this.elapsedMs(timeStampMs) };
    if (this.skipNext) {
      this.skipNext = false;
      this.dropped++;
      return null;
    }
    const held = this.held;
    if (held) {
      this.held = null;
      if (speed(sample) * LOOK_SPIKE_RATIO >= speed(held)) {
        this.remember(held);
        this.remember(sample);
        return { dx: held.dx + dx, dy: held.dy + dy };
      }
      this.dropped++;
    }
    if (mag > LOOK_SPIKE_FLOOR_PX && speed(sample) > LOOK_SPIKE_RATIO * this.recentSpeed()) {
      this.held = sample;
      return null;
    }
    this.remember(sample);
    return { dx, dy };
  }

  private elapsedMs(timeStampMs: number | undefined): number {
    if (timeStampMs === undefined || !Number.isFinite(timeStampMs)) return LOOK_SPIKE_MIN_DT_MS;
    const last = this.lastTimeMs;
    this.lastTimeMs = timeStampMs;
    return last === null ? LOOK_SPIKE_FIRST_DT_MS : Math.max(0, timeStampMs - last);
  }

  private recentSpeed(): number {
    let mag = 0;
    let dt = 0;
    for (const s of this.recent) {
      mag += s.mag;
      dt += s.dt;
    }
    return mag / Math.max(dt, LOOK_SPIKE_MIN_DT_MS);
  }

  private remember(sample: LookSample): void {
    this.recent.push(sample);
    if (this.recent.length > LOOK_SPIKE_HISTORY) this.recent.shift();
  }
}

function speed(sample: LookSample): number {
  return sample.mag / Math.max(sample.dt, LOOK_SPIKE_MIN_DT_MS);
}

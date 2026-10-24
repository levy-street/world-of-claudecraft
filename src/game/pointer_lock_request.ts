// Request the mouse-look pointer lock with raw (unadjusted) mouse input.
//
// A plain requestPointerLock() hands the page movement that has been through
// the OS pointer path: acceleration ("Enhance pointer precision" on Windows)
// and the cursor recentering that pointer lock relies on. That path is where
// sudden camera jumps come from on high polling-rate mice. Chromium (and so the
// Electron desktop shell) accepts `{ unadjustedMovement: true }` to read the
// device directly instead, which also gives a 1:1 feel independent of the OS
// acceleration curve.
//
// Fallback: a browser or platform that cannot provide raw input rejects the
// request with NotSupportedError. We then remember that for the session and
// tell the caller, which re-requests on its next mouse move (Chromium allows
// that deferred request) and so falls back to a plain lock. An engine that
// predates the options argument simply ignores it and grants a plain lock.
//
// Gecko is left on the plain request: Firefox only grants a lock synchronously
// inside the mousedown handler (pointer_lock.ts pointerLockNeedsSyncGesture), so
// an asynchronous fallback after a rejection would be denied and leave that
// drag with no lock at all.
//
// DOM-free apart from the target it is handed, so it unit-tests with a fake.

export interface PointerLockTarget {
  requestPointerLock?: (options?: { unadjustedMovement?: boolean }) => Promise<void> | void;
}

function isNotSupported(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'NotSupportedError';
}

export class RawPointerLockRequester {
  private rawUnsupported = false;
  private rawEnabled = true;

  /** @param allowRaw false keeps every request plain (the Gecko path). */
  constructor(private readonly allowRaw: boolean) {}

  /** Whether the next request will ask for raw input. */
  get requestsRaw(): boolean {
    return this.allowRaw && this.rawEnabled && !this.rawUnsupported;
  }

  /** The player setting: false keeps every request plain (OS-adjusted movement). */
  setRawEnabled(on: boolean): void {
    this.rawEnabled = on;
  }

  /**
   * Request the lock on `target`. `onRawUnsupported` runs once raw input turns
   * out to be unavailable, so the caller can re-arm its own one-request-per-drag
   * flag and let the next move request a plain lock. Any other rejection (a
   * denied or superseded request) is swallowed: the caller's pointerlockerror
   * handler already owns that path.
   */
  request(target: PointerLockTarget, onRawUnsupported: () => void): void {
    if (typeof target.requestPointerLock !== 'function') return;
    if (!this.requestsRaw) {
      this.plain(target);
      return;
    }
    let result: Promise<void> | void;
    try {
      result = target.requestPointerLock({ unadjustedMovement: true });
    } catch (err) {
      // A synchronous throw is not the spec'd failure mode. Fall back to a
      // plain request right away, still inside the same event handler, so
      // this drag is never left without a lock. A NotSupported throw, or a
      // TypeError from an engine that rejects the options argument, also
      // means raw input is unavailable for the session.
      if (isNotSupported(err) || err instanceof TypeError) this.rawUnsupported = true;
      this.plain(target);
      return;
    }
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch((err: unknown) => {
        if (!isNotSupported(err)) return;
        this.rawUnsupported = true;
        onRawUnsupported();
      });
    }
  }

  private plain(target: PointerLockTarget): void {
    try {
      const result = target.requestPointerLock?.();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {});
      }
    } catch {
      /* a denied request surfaces through pointerlockerror */
    }
  }
}

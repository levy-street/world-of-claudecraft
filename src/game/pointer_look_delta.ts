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

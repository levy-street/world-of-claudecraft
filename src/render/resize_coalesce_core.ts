// Two decisions the viewport-resize path needs and neither the renderer nor a
// browser is required to make.
//
// A single user drag emits a burst of resize events, and the renderer answered
// every one of them with a full reallocation of the post chain (nineteen render
// targets on the composer tiers, plus the drawing buffer itself). Worse, most
// of that burst asks for a buffer that is already allocated: fullscreenchange,
// visualViewport scroll, the orientation follow-up timers, and the device-pixel
// ratio watch all fire on states where the CSS size never moved.
//
// So: collapse a burst onto ONE pass on the next frame, and inside that pass
// reallocate only when the DRAWING-BUFFER extent actually changes. The extent
// is what every target is sized from, which is why a device-pixel-ratio change
// with an identical CSS size still reallocates (it moves the extent) while a
// scroll or a repeated event does not.
//
// The extent alone is NOT the whole identity, though, and browser zoom is why:
// zooming to 150 percent shrinks a 1920x1080 CSS viewport to 1280x720 and
// raises the ratio to 1.5, so the extent comes out 1920x1080 either way. The
// pass also writes the renderer's own pixel ratio, which `applyRenderRegion`
// reads back against the live CSS height to size point sprites, so skipping on
// a matching extent alone would leave that scale wrong by the zoom factor. The
// recorded identity is therefore the extent AND the ratio that produced it.

export interface DrawingBufferExtent {
  readonly width: number;
  readonly height: number;
}

/**
 * The backing-store extent `WebGLRenderer.setSize(width, height, false)` would
 * produce at this pixel ratio. Three floors the product, so this floors it too:
 * a rounding difference here would reallocate on every pass.
 */
export function drawingBufferExtent(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): DrawingBufferExtent {
  return {
    width: Math.max(1, Math.floor(cssWidth * pixelRatio)),
    height: Math.max(1, Math.floor(cssHeight * pixelRatio)),
  };
}

/** A drawing-buffer extent plus the pixel ratio the renderer was left holding. */
export interface AllocatedResolution extends DrawingBufferExtent {
  readonly pixelRatio: number;
}

export function allocatedResolutionEquals(
  a: AllocatedResolution | null,
  b: AllocatedResolution | null,
): boolean {
  return (
    a !== null &&
    b !== null &&
    a.width === b.width &&
    a.height === b.height &&
    a.pixelRatio === b.pixelRatio
  );
}

export interface ResizeCoalescer {
  /**
   * Ask for one viewport pass on the next scheduled frame; a burst collapses
   * onto that one pass.
   *
   * @param schedule defers a callback to the next frame (the host passes
   *   `requestAnimationFrame`); a test passes a queue it drains by hand.
   */
  request(schedule: (callback: () => void) => void): void;
  /**
   * Whether this pass must reallocate, given the extent it would produce.
   * Records the extent, so the next identical pass answers false.
   */
  shouldAllocate(cssWidth: number, cssHeight: number, pixelRatio: number): boolean;
  /** Forget the allocated resolution, so the next pass reallocates unconditionally. */
  reset(): void;
  /** The resolution currently allocated, or null before the first pass. */
  allocated(): AllocatedResolution | null;
}

/** @param run the one viewport pass a coalesced burst produces. */
export function createResizeCoalescer(run: () => void): ResizeCoalescer {
  let pending = false;
  let allocated: AllocatedResolution | null = null;
  return {
    request(schedule: (callback: () => void) => void): void {
      if (pending) return;
      pending = true;
      schedule(() => {
        // Cleared BEFORE the pass, so a resize the pass itself provokes still
        // books the next frame instead of being swallowed as a duplicate.
        pending = false;
        run();
      });
    },
    shouldAllocate(cssWidth: number, cssHeight: number, pixelRatio: number): boolean {
      const next = { ...drawingBufferExtent(cssWidth, cssHeight, pixelRatio), pixelRatio };
      if (allocatedResolutionEquals(allocated, next)) return false;
      allocated = next;
      return true;
    },
    reset(): void {
      allocated = null;
    },
    allocated(): AllocatedResolution | null {
      return allocated;
    },
  };
}

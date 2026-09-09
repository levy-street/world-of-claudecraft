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
// So: collapse a burst onto ONE pass, and inside that pass reallocate only when
// the DRAWING-BUFFER extent actually changes.
//
// WHEN that one pass runs is load-bearing, and this core deliberately does not
// schedule it. An earlier revision booked its own `requestAnimationFrame`, and
// that flashed the whole screen black on every resize: the game loop
// re-registers its frame callback at the top of each frame, so a callback
// booked later from a resize event runs AFTER the frame that was already
// queued. The canvas was resized and cleared once the frame had been painted,
// and nothing repainted until the next one. The host therefore DRAINS this
// coalescer at the start of its frame, before anything draws, so the
// reallocation and the render that follows it land in the same turn. The extent
// is what every target is sized from, which is why a device-pixel-ratio change
// with an identical CSS size still reallocates (it moves the extent) while a
// scroll or a repeated event does not.
//
// The extent alone is NOT the whole identity, though, and browser zoom is why:
// zooming to 150 percent shrinks a 1920x1080 CSS viewport to 1280x720 and
// raises the ratio to 1.5, so the extent comes out 1920x1080 either way. The
// pass writes more than storage: the renderer's own pixel ratio, which
// `applyRenderRegion` reads back against the live CSS height to size point
// sprites, and the logical size the ripple projection takes its aspect from.
// So the recorded identity is every INPUT the pass consumes, the CSS size and
// the ratio, and the extent is what makes a ratio change matter rather than
// being the identity itself.

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

/** Everything one viewport pass consumes, plus the extent those inputs produce. */
export interface AppliedResolution {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelRatio: number;
  readonly extent: DrawingBufferExtent;
}

export function appliedResolutionEquals(
  a: AppliedResolution | null,
  b: AppliedResolution | null,
): boolean {
  return (
    a !== null &&
    b !== null &&
    a.cssWidth === b.cssWidth &&
    a.cssHeight === b.cssHeight &&
    a.pixelRatio === b.pixelRatio
  );
}

export interface ResizeCoalescer {
  /** Ask for one viewport pass; a burst collapses onto that one pass. */
  request(): void;
  /**
   * Run the pending pass, if any. The host calls this at the top of its frame,
   * before it draws, which is the whole reason this core does no scheduling of
   * its own (see the header). Cheap and safe to call every frame.
   */
  flush(): void;
  /**
   * Whether this pass must reallocate, given the extent it would produce.
   * Records the extent, so the next identical pass answers false.
   */
  shouldAllocate(cssWidth: number, cssHeight: number, pixelRatio: number): boolean;
  /** The resolution currently applied, or null before the first pass. */
  applied(): AppliedResolution | null;
}

/** @param run the one viewport pass a coalesced burst produces, on `flush`. */
export function createResizeCoalescer(run: () => void): ResizeCoalescer {
  let pending = false;
  let applied: AppliedResolution | null = null;
  return {
    request(): void {
      pending = true;
    },
    flush(): void {
      if (!pending) return;
      // Cleared BEFORE the pass, so a resize the pass itself provokes books the
      // next frame instead of being swallowed as a duplicate.
      pending = false;
      run();
    },
    shouldAllocate(cssWidth: number, cssHeight: number, pixelRatio: number): boolean {
      const next: AppliedResolution = {
        cssWidth,
        cssHeight,
        pixelRatio,
        extent: drawingBufferExtent(cssWidth, cssHeight, pixelRatio),
      };
      if (appliedResolutionEquals(applied, next)) return false;
      applied = next;
      return true;
    },
    applied(): AppliedResolution | null {
      return applied;
    },
  };
}

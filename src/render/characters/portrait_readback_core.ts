// Pure buffer math for the portrait capture's asynchronous GPU readback, plus
// the predicate that picks between that path and the synchronous canvas one.
// No GL, no DOM: the adapter (portrait_snapshot.ts) owns the render target, the
// fence-backed readback and the PNG encode, and calls in here for the two
// software conversions that stand between a readPixels buffer and canvas
// ImageData.
//
// Two conversions in software, both needed for the async result to match what
// canvas.toBlob produced off the default framebuffer:
// - ORIENTATION. readPixels numbers rows from the BOTTOM-left, ImageData from
//   the TOP-left, so the rows are reversed one scanline at a time.
// - ALPHA. The drawing buffer and a render target both hold PREMULTIPLIED
//   colour (that is how three blends), while ImageData and the PNG that
//   toBlob wrote are UNPREMULTIPLIED. Skipping this darkens every partially
//   covered texel, which on a portrait is the whole antialiased silhouette.
//
// The sRGB TRANSFER is NOT one of them: the adapter gives the target texture
// the renderer's output colour space, so for an UnsignedByte RGBA texture
// three allocates SRGB8_ALPHA8 (`getInternalFormat`, three 0.185.1) and WebGL2
// converts linear to sRGB IN HARDWARE as the framebuffer is written. The bytes
// readPixels hands back are already encoded exactly as the canvas path's were.
// Encoding them again in software washes every portrait out.

/** RGBA. */
const CHANNELS = 4;

/** Bytes a `width` x `height` RGBA readback needs. */
export function portraitReadbackByteLength(width: number, height: number): number {
  return width * height * CHANNELS;
}

/** One premultiplied channel back to its straight value. Alpha 0 carries no
 *  colour at all (nothing was blended into it), so it stays 0 rather than
 *  dividing by zero. */
export function unpremultiplyByte(channel: number, alpha: number): number {
  if (alpha <= 0) return 0;
  if (alpha >= 255) return channel;
  return Math.min(255, Math.round((channel * 255) / alpha));
}

/**
 * Flip `source` (bottom-up, premultiplied, straight from readPixels) into
 * `dest` (top-down, straight alpha, ready for `new ImageData`). Both buffers
 * are `portraitReadbackByteLength(width, height)` long and are caller-owned,
 * so a repeated capture at one size allocates nothing.
 *
 * There is deliberately NO colour transfer here. The capture's render target
 * carries the renderer's output colour space, and for an UnsignedByte RGBA
 * texture whose space has the sRGB transfer three allocates SRGB8_ALPHA8
 * (`getInternalFormat`, three 0.185.1), so WebGL2 performs the linear to sRGB
 * conversion in HARDWARE as the framebuffer is written. The bytes readPixels
 * returns are therefore already encoded exactly as the old canvas path's were,
 * and encoding again here washes every portrait out.
 */
export function flipUnpremultiplyInto(
  source: ArrayLike<number>,
  dest: { [index: number]: number; length: number },
  width: number,
  height: number,
): void {
  const stride = width * CHANNELS;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * stride;
    const to = y * stride;
    for (let x = 0; x < stride; x += CHANNELS) {
      const alpha = source[from + x + 3];
      dest[to + x] = unpremultiplyByte(source[from + x], alpha);
      dest[to + x + 1] = unpremultiplyByte(source[from + x + 1], alpha);
      dest[to + x + 2] = unpremultiplyByte(source[from + x + 2], alpha);
      dest[to + x + 3] = alpha;
    }
  }
}

/** What the adapter knows about its context when it has to choose a path. */
export interface PortraitReadbackSupport {
  /** The renderer exposes `readRenderTargetPixelsAsync`. */
  hasAsyncReadback: boolean;
  /** An earlier async capture on this context failed (a rejected readback, a
   *  render target that would not read, a 2D context that would not encode). */
  failedBefore: boolean;
  /** The WebGL context is lost. */
  contextLost: boolean;
  /** Another capture already owns this target's shared buffers. */
  captureInFlight: boolean;
}

/**
 * True when the capture should render into a render target and read it back
 * behind a fence. False sends it down the synchronous default-framebuffer
 * path instead: slower (`toBlob` stalls the main thread on the readback) but
 * always available, which is what keeps a failure from dropping portraits.
 */
export function asyncPortraitReadbackUsable(support: PortraitReadbackSupport): boolean {
  return (
    support.hasAsyncReadback &&
    !support.failedBefore &&
    !support.contextLost &&
    !support.captureInFlight
  );
}

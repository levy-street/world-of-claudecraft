import * as THREE from 'three';
import { notePortraitArmLatched, notePortraitCaptureArm } from '../gpu_prep_events';
import {
  disposePortraitEncodeWorker,
  encodeCanvasBitmapPng,
  portraitBitmapEncodeSupport,
} from './portrait_bitmap_encode';
import { bitmapPortraitTransferUsable } from './portrait_bitmap_transfer_core';
import { encodeCanvasPng, encodeRgbaPngDataUrl } from './portrait_png_encode';
import {
  asyncPortraitReadbackUsable,
  flipUnpremultiplyInto,
  portraitReadbackByteLength,
} from './portrait_readback_core';

// The portrait capture's transfer adapter: the thin GL half over the pure
// cores (portrait_bitmap_transfer_core.ts, portrait_readback_core.ts), the
// worker encode (portrait_bitmap_encode.ts) and the PNG encode
// (portrait_png_encode.ts).
//
// THREE ARMS, in this order, each one falling through to the next:
//
// 1. TRANSFER. Draw into the rig's own drawing buffer, snapshot it with
//    createImageBitmap and transfer that bitmap to the encode worker. The
//    bytes never enter this thread at all, which is what an integrated GPU
//    cares about: measured on a Mesa iGPU under a loaded ride, p50 0 ms of
//    main-thread blocking per capture against 116 ms for arm 2, and not one
//    capture in 24 blocking for over 16 ms.
// 2. READBACK. Render into a WebGLRenderTarget and read it back through
//    three's fence-backed readRenderTargetPixelsAsync. Needs no worker, and
//    still beats arm 3 on a discrete GPU, but it ends with the pixels in a JS
//    ArrayBuffer: getBufferSubData blocks 28 to 76 ms on an iGPU because the
//    fence only says the data is READY, not that pulling it across is free.
// 3. CANVAS. The original path: draw into the default framebuffer and let
//    canvas.toBlob do a synchronous readback plus a deferred encode. Slowest
//    on the main thread, but it needs no worker, no fence and no render
//    target, so it is what keeps any failure above from dropping portraits.
//
// Arms 1 and 3 draw into the SAME default framebuffer and the same drawn frame
// serves either, which is why a transfer that cannot even start (no worker) is
// still encodable synchronously without a second draw.
//
// WHY THIS EXISTS. The capture used to render into the offscreen rig's DEFAULT
// framebuffer (preserveDrawingBuffer: true) and call canvas.toBlob. toBlob
// defers the PNG ENCODE, but it performs the GPU readback SYNCHRONOUSLY on the
// main thread: measured at 1477 ms of self time across a post-entry ride, 67 to
// 118 ms per portrait unit, once every prewarm-lane slot for the first minute of
// play. The lane grants a unit a slot, not a budget, so nothing capped it.
//
// So the capture renders into a WebGLRenderTarget and reads it back through
// three's readRenderTargetPixelsAsync, which issues readPixels into a
// PIXEL_PACK_BUFFER, plants a fenceSync, polls it off the frame, and only then
// runs getBufferSubData. The main thread pays the draw and the command
// submission; the transfer waits for the GPU on its own.
//
// Two things change between the paths, and both are undone in software before
// the encode so the output matches what toBlob wrote: readPixels numbers rows
// from the bottom while ImageData numbers them from the top, and both the
// drawing buffer and the target hold premultiplied colour while a PNG holds
// straight alpha. Both live in the pure core. The sRGB transfer is NOT one of
// them: the target texture carries the renderer's output colour space, so three
// allocates it SRGB8_ALPHA8 and the GPU encodes linear to sRGB on write.

/** Matches the offscreen rig's `antialias: true` drawing buffer, so the
 *  silhouette a render target captures is the one the default framebuffer
 *  produced. */
const PORTRAIT_SNAPSHOT_SAMPLES = 4;

/**
 * LIVENESS BACKSTOP, not a pacing knob: nothing waits on it in normal
 * operation, and it can only ever shorten a wait that is already broken.
 *
 * three's readback polls its fence through `probeAsync`, which rejects on
 * WAIT_FAILED but re-polls TIMEOUT_EXPIRED forever, with no timeout and no
 * cancellation. A fence that never signals on a live context is therefore a
 * promise that NEVER SETTLES, and this capture's promise is what the
 * serialised preview lane advances on and what holds a released-tail slot in
 * the shared GPU queue: one wedge stops every later preview unit and halves
 * the queue's tail budget for the session.
 *
 * The bound is deliberately three orders of magnitude above the measured
 * healthy cost (3.8 ms on a discrete GPU, 32.6 ms on a Mesa iGPU): a readback
 * that has not landed by now is broken, not slow, on any machine. Expiring it
 * costs one portrait and the async path for the session (every later capture
 * takes the synchronous one), never a slower portrait.
 */
export const PORTRAIT_READBACK_LIVENESS_BACKSTOP_MS = 10_000;

/** The renderer surface this adapter uses. `THREE.WebGLRenderer` satisfies it
 *  structurally; naming it keeps the path selection testable without a GL
 *  context. */
export interface PortraitSnapshotRenderer {
  readonly domElement: HTMLCanvasElement;
  /** three types this as a plain string on the renderer. */
  readonly outputColorSpace: string;
  getContext(): { isContextLost(): boolean };
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  getActiveCubeFace(): number;
  getActiveMipmapLevel(): number;
  setRenderTarget(
    target: THREE.WebGLRenderTarget | null,
    activeCubeFace?: number,
    activeMipmapLevel?: number,
  ): void;
  readRenderTargetPixelsAsync?(
    target: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: Uint8Array,
  ): Promise<unknown>;
}

/**
 * One square capture surface for a portrait rig, reused by every capture on
 * that rig (target, readback buffer and flipped buffer are all allocated once).
 * Owned by the rig and disposed with it.
 */
export class PortraitSnapshotTarget {
  private target: THREE.WebGLRenderTarget | null = null;
  private pixels: Uint8Array | null = null;
  private topDown: Uint8ClampedArray<ArrayBuffer> | null = null;
  /** Latched by any async failure, so one broken readback costs one portrait
   *  and every later capture takes the synchronous path instead. */
  private asyncFailed = false;
  /** The same latch for the transfer arm: one worker failure costs one
   *  portrait and sends every later capture down the readback arm. Separate
   *  from `asyncFailed` because the two arms fail for unrelated reasons and a
   *  worker that dies must not cost the rig its fence-backed readback too. */
  private bitmapFailed = false;
  /** Bumped by dispose. A readback issued against the released buffers lands
   *  with a stale generation and writes nothing. */
  private generation = 0;
  /** True from the draw until the transfer arm has copied that frame out of
   *  the rig's ONE default framebuffer. A second capture in that window would
   *  draw over the frame this one is still snapshotting, so it takes the
   *  readback arm instead. */
  private snapshotInFlight = false;
  /** True from the moment an async readback is issued until its bytes have
   *  been flipped out. `pixels` and `topDown` are shared by every capture on
   *  this rig while the lane above only dedupes per cache KEY, so a second
   *  concurrent capture takes the synchronous path rather than racing for
   *  those buffers. */
  private captureInFlight = false;

  constructor(private readonly size: number) {}

  /**
   * Draw one portrait and encode it as a PNG data URL.
   *
   * `draw` MUST be called before this returns its promise, on every arm: the
   * caller (runPortraitPrewarm) releases and disposes the subject as soon as
   * the promise exists, so nothing may be drawn after the first await. That is
   * also why the path is chosen up front rather than after a failure: once the
   * readback has been issued there is no subject left to re-render.
   */
  capture(renderer: PortraitSnapshotRenderer, draw: () => void): Promise<string | null> {
    const contextLost = this.contextLost(renderer);
    const support = portraitBitmapEncodeSupport();
    if (
      bitmapPortraitTransferUsable({
        hasCreateImageBitmap: support.hasCreateImageBitmap,
        hasWorker: support.hasWorker,
        hasOffscreenCanvas: support.hasOffscreenCanvas,
        failedBefore: this.bitmapFailed,
        contextLost,
        snapshotInFlight: this.snapshotInFlight,
      })
    ) {
      const transferred = this.captureViaTransfer(renderer, draw);
      // Null means the transfer never started, and the draw closure is still
      // valid: the readback arm re-draws (into its own target) rather than
      // letting this one capture pay the synchronous encode.
      if (transferred) return transferred;
    }
    return this.captureViaReadback(renderer, draw, contextLost);
  }

  /**
   * The readback arm, and the synchronous canvas arm below it: render into the
   * target and read it back behind three's fence, or fall back to the draw
   * plus `toBlob` that needs neither fence nor worker.
   */
  private captureViaReadback(
    renderer: PortraitSnapshotRenderer,
    draw: () => void,
    contextLost: boolean,
  ): Promise<string | null> {
    const readAsync = renderer.readRenderTargetPixelsAsync;
    const usable = asyncPortraitReadbackUsable({
      hasAsyncReadback: typeof readAsync === 'function',
      failedBefore: this.asyncFailed,
      contextLost,
      captureInFlight: this.captureInFlight,
    });
    if (!readAsync || !usable) return this.captureSync(renderer, draw);

    const target = this.ensureTarget(renderer);
    const pixels = this.ensurePixels();
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMipmapLevel = renderer.getActiveMipmapLevel();
    let readback: Promise<unknown>;
    try {
      renderer.setRenderTarget(target);
      draw();
      // three resolves a multisampled target at the END of render(), into the
      // same single-sample framebuffer the readback binds, so unbinding here is
      // safe and keeps the rig's state exactly as the caller left it.
      renderer.setRenderTarget(previousTarget, previousFace, previousMipmapLevel);
      readback = readAsync.call(renderer, target, 0, 0, this.size, this.size, pixels);
    } catch {
      renderer.setRenderTarget(previousTarget, previousFace, previousMipmapLevel);
      this.latchReadback();
      // Still inside the caller's synchronous window, so the subject is mounted
      // and the fallback can draw it.
      return this.captureSync(renderer, draw);
    }

    this.captureInFlight = true;
    const generation = this.generation;
    return this.awaitReadback(readback, pixels).then((landed) => {
      // A dispose released `pixels` and `topDown` while this readback was in
      // flight, and a capture on the rebuilt rig may already own the new ones
      // AND the in-flight claim: flipping here would write a pre-rebuild frame
      // into a live buffer, and clearing the claim would free it under that
      // capture.
      if (generation !== this.generation) return null;
      this.captureInFlight = false;
      if (!landed) return null;
      const dest = this.ensureTopDown();
      flipUnpremultiplyInto(pixels, dest, this.size, this.size);
      return encodeRgbaPngDataUrl(dest, this.size, this.size).then((url) => {
        if (url === null) this.latchReadback();
        else notePortraitCaptureArm('readback');
        return url;
      });
    });
  }

  /**
   * Resolve true when the readback landed, false when it failed OR when the
   * liveness backstop expired first. Either failure latches, so the capture
   * always settles and every later one takes the synchronous path.
   *
   * Landing is judged on the fulfilment VALUE, never on fulfilment alone:
   * `readRenderTargetPixelsAsync` returns undefined without throwing and
   * without writing a byte when the target has no `__webglFramebuffer` yet
   * (three 0.185.1), and `pixels` is shared across captures, so treating that
   * as landed would encode the PREVIOUS portrait and cache it under this key.
   * The success path hands back the very buffer it filled.
   */
  private awaitReadback(readback: Promise<unknown>, pixels: Uint8Array): Promise<boolean> {
    // Captured with the readback, not read at latch time: a graphics rebuild
    // during an in-flight capture disposes this rig and CLEARS `asyncFailed`,
    // so a stale rejection landing afterwards would latch the fence-backed arm
    // off for the REBUILT rig and cost it every later portrait. The commit
    // paths below already carry this guard; the latches are the ones that
    // outlive their own capture.
    const generation = this.generation;
    const latchIfCurrent = (): void => {
      if (generation === this.generation) this.latchReadback();
    };
    return new Promise<boolean>((resolve) => {
      const backstop = setTimeout(() => {
        latchIfCurrent();
        resolve(false);
      }, PORTRAIT_READBACK_LIVENESS_BACKSTOP_MS);
      const settle = (landed: boolean): void => {
        clearTimeout(backstop);
        if (!landed) latchIfCurrent();
        resolve(landed);
      };
      readback.then(
        (value) => settle(value === pixels),
        () => settle(false),
      );
    });
  }

  /**
   * The transfer arm: draw into the rig's default framebuffer and hand that
   * frame to the encode worker as a transferable ImageBitmap.
   *
   * `encodeCanvasBitmapPng` calls `createImageBitmap` in the same synchronous
   * block as the draw, but the HTML spec does NOT promise the pixel copy
   * happens at call time (the copy runs in a queued task), so the claim is held
   * until the snapshot promise resolves rather than released at the call. That
   * is correct under both readings: if the copy really is synchronous the extra
   * hold only costs a concurrent capture its top arm, and if it is not, the
   * hold is what keeps a later draw out of the frame being copied.
   *
   * Known gap, deliberately not closed here: `captureSync` draws into this same
   * default framebuffer and takes NO claim, and it is reachable while a
   * snapshot is in flight (transfer arm skipped on the claim, then the readback
   * arm unusable because it is latched or already busy). Closing it needs a
   * capture that can defer its draw, and the contract above forbids that: the
   * caller releases the subject as soon as the promise exists. Nothing here is
   * shared between transfer captures, so unlike the readback arm two of them
   * may run at once.
   */
  private captureViaTransfer(
    renderer: PortraitSnapshotRenderer,
    draw: () => void,
  ): Promise<string | null> | null {
    draw();
    this.snapshotInFlight = true;
    const release = (): void => {
      this.snapshotInFlight = false;
    };
    const encode = encodeCanvasBitmapPng(renderer.domElement, this.size, release);
    if (!encode) {
      // Never started (no worker could be built): nothing was copied, so the
      // claim goes back at once and the caller picks another arm.
      release();
      this.latchTransfer();
      return null;
    }
    const generation = this.generation;
    return encode.then((url) => {
      // A dispose released this rig while the encode was in flight; the URL
      // belongs to a pre-rebuild frame and must not be committed, and the
      // latch must not fire against a rig that no longer exists.
      if (generation !== this.generation) return null;
      if (url === null) this.latchTransfer();
      else notePortraitCaptureArm('transfer');
      return url;
    });
  }

  /** Latch an arm off for the rest of this rig's life, once, and leave the
   *  evidence: a host that silently loses an arm just gets slower, and the
   *  counters are the only place that shows up. */
  private latchTransfer(): void {
    if (this.bitmapFailed) return;
    this.bitmapFailed = true;
    notePortraitArmLatched('transfer');
  }

  private latchReadback(): void {
    if (this.asyncFailed) return;
    this.asyncFailed = true;
    notePortraitArmLatched('readback');
  }

  /** Release the target, its buffers and the encode worker (graphics rebuild,
   *  page teardown). A fresh context gets a fresh chance at both async arms. */
  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.pixels = null;
    this.topDown = null;
    this.asyncFailed = false;
    this.bitmapFailed = false;
    this.captureInFlight = false;
    this.snapshotInFlight = false;
    this.generation++;
    disposePortraitEncodeWorker();
  }

  /** The original path: render into the default framebuffer and let toBlob do
   *  the (synchronous) readback. Slower, but it needs no extension and no
   *  render target, so it is what keeps a failure from dropping portraits. */
  private captureSync(
    renderer: PortraitSnapshotRenderer,
    draw: () => void,
  ): Promise<string | null> {
    draw();
    notePortraitCaptureArm('canvas');
    return encodeCanvasPng(renderer.domElement);
  }

  private contextLost(renderer: PortraitSnapshotRenderer): boolean {
    try {
      return renderer.getContext().isContextLost();
    } catch {
      return true;
    }
  }

  private ensureTarget(renderer: PortraitSnapshotRenderer): THREE.WebGLRenderTarget {
    const existing = this.target;
    if (existing) return existing;
    const target = new THREE.WebGLRenderTarget(this.size, this.size, {
      depthBuffer: true,
      stencilBuffer: false,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      samples: PORTRAIT_SNAPSHOT_SAMPLES,
    });
    // Load bearing, and not for sampling: for an UnsignedByte RGBA texture
    // whose colour space carries the sRGB transfer three allocates
    // SRGB8_ALPHA8 (getInternalFormat, three 0.185.1), and WebGL2 then encodes
    // linear to sRGB in hardware as the framebuffer is written. That is what
    // reproduces the canvas path's bytes; drop this and every portrait comes
    // back dark, encode a second time in software and every one washes out.
    target.texture.colorSpace = renderer.outputColorSpace;
    target.texture.generateMipmaps = false;
    this.target = target;
    return target;
  }

  private ensurePixels(): Uint8Array {
    const existing = this.pixels;
    if (existing) return existing;
    const pixels = new Uint8Array(portraitReadbackByteLength(this.size, this.size));
    this.pixels = pixels;
    return pixels;
  }

  private ensureTopDown(): Uint8ClampedArray<ArrayBuffer> {
    const existing = this.topDown;
    if (existing) return existing;
    const topDown = new Uint8ClampedArray(portraitReadbackByteLength(this.size, this.size));
    this.topDown = topDown;
    return topDown;
  }
}

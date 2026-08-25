// The path predicate for the portrait capture's fastest transfer: draw into
// the rig's own drawing buffer, hand the frame to a worker as an ImageBitmap,
// and never pull a byte across to the main thread at all.
//
// No DOM and no GL: the adapter (portrait_snapshot.ts) owns the draw, and the
// worker client (portrait_bitmap_encode.ts) owns the transfer, so what is left
// here is the decision, which a Vitest can pin without a canvas or a Worker.
//
// WHY THIS PATH EXISTS. Both older arms end with the pixels in main-thread
// memory, and on an integrated GPU that transfer is the cost. Measured on a
// Mesa iGPU during a loaded ride (24 interleaved captures of one subject per
// arm), main-thread blocking per capture:
//   render target + readRenderTargetPixelsAsync: p50 116 ms, every single
//     capture blocking for over 16 ms in one chunk (getBufferSubData 46 ms
//     and the encode's synchronous half 58 ms per capture);
//   ImageBitmap encoded on the main thread: p50 5 ms but p95 234 ms, because
//     convertToBlob still snapshots the canvas on this thread;
//   ImageBitmap TRANSFERRED to a worker: p50 0 ms, p95 2.6 ms, max 15.4 ms,
//     and not one capture blocked for over 16 ms.
// The bytes are the problem, not the encode: an ImageBitmap is transferable,
// so the browser moves the frame to the worker's thread and the readback and
// the PNG encode both happen there.

/** What the adapter knows about its host when it has to choose this path. */
export interface PortraitBitmapTransferSupport {
  /** `createImageBitmap` exists, so the drawn frame can be snapshotted. */
  hasCreateImageBitmap: boolean;
  /** `Worker` exists AND a worker could be constructed. */
  hasWorker: boolean;
  /** `OffscreenCanvas` exists, which is what the worker encodes through. */
  hasOffscreenCanvas: boolean;
  /** An earlier bitmap capture on this rig failed (a worker error, a bitmap
   *  that would not snapshot, an encode that produced no data URL). */
  failedBefore: boolean;
  /** The WebGL context is lost, so there is no frame to snapshot. */
  contextLost: boolean;
  /** Another capture has drawn into the rig's ONE default framebuffer and is
   *  still waiting for its snapshot of it. */
  snapshotInFlight: boolean;
}

/**
 * True when the capture should draw into the rig's default framebuffer and
 * transfer the frame to the encode worker. False falls through to the render
 * target readback, and then to the synchronous canvas encode: both slower on
 * the main thread, but neither needs a worker.
 *
 * `snapshotInFlight` is the same discipline the readback arm applies to its
 * shared buffers, for the one thing this arm shares: the rig's single default
 * framebuffer. `createImageBitmap` is specified to copy the source, but it
 * resolves asynchronously, so a second capture drawing between the call and
 * the copy is a race whose loser caches ANOTHER character's face under its
 * own key. Serialising the window instead of trusting the copy costs the
 * second concurrent capture the readback arm, exactly as it does today.
 */
export function bitmapPortraitTransferUsable(support: PortraitBitmapTransferSupport): boolean {
  return (
    support.hasCreateImageBitmap &&
    support.hasWorker &&
    support.hasOffscreenCanvas &&
    !support.failedBefore &&
    !support.contextLost &&
    !support.snapshotInFlight
  );
}

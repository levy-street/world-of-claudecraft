// The portrait capture's PNG encode, off the gameplay thread.
//
// Receives one transferred ImageBitmap per request (the frame the rig just
// drew), paints it into an OffscreenCanvas and encodes it as the same
// `data:image/png;base64,...` string every other capture arm produces. Both
// heavy steps, the GPU readback that convertToBlob performs and the PNG
// encode itself, happen on this thread; the main thread only posts a
// transferable and waits.
//
// The bitmap is CLOSED on every path: it holds the decoded frame, and one leak
// per capture is a portrait's worth of memory that never comes back.

type WorkerRequest = { requestId: number; bitmap: ImageBitmap; size: number };
type WorkerResponse = { requestId: number; url?: string; error?: string };
type WorkerScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
};

const scope = globalThis as unknown as WorkerScope;

/** One canvas per size, reused across captures: every portrait on a rig is the
 *  same square, so this allocates once. */
const canvases = new Map<number, OffscreenCanvas>();

function canvasFor(size: number): OffscreenCanvas {
  const existing = canvases.get(size);
  if (existing) return existing;
  const canvas = new OffscreenCanvas(size, size);
  canvases.set(size, canvas);
  return canvas;
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Portrait PNG did not read back as a data URL'));
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Portrait PNG read failed')),
    );
    reader.readAsDataURL(blob);
  });
}

async function encode(bitmap: ImageBitmap, size: number): Promise<string> {
  try {
    // The SIZE the adapter asked for, never the bitmap's own: every arm has to
    // emit the same square, and a rig whose drawing buffer ever differs from
    // the portrait size would otherwise make this arm alone disagree.
    const canvas = canvasFor(size > 0 ? size : Math.max(bitmap.width, bitmap.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Portrait encode worker has no 2D context');
    // The rig draws a transparent headshot, and a reused canvas still holds the
    // previous one: without the clear, a smaller silhouette keeps the older
    // portrait's edges.
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blobDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

scope.addEventListener('message', (event) => {
  const { requestId, bitmap, size } = event.data;
  void encode(bitmap, size)
    .then((url) => scope.postMessage({ requestId, url }))
    .catch((error: unknown) =>
      scope.postMessage({
        requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
});

// No public surface: this file is a worker ENTRY, loaded by URL from
// portrait_bitmap_encode.ts. The empty export is what makes it a module for
// `type: "module"` (and for the test that imports it to drive its handler).
export {};

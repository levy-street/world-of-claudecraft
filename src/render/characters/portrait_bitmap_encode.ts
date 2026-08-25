// The main-thread half of the worker encode: snapshot the frame the portrait
// rig just drew as an ImageBitmap and TRANSFER it to portrait_encode_worker.ts,
// which does the readback and the PNG encode on its own thread.
//
// The snapshot is taken at CALL time, exactly as `canvas.toBlob` takes it, so
// the adapter must call this in the same synchronous block as the draw: a
// later capture on the shared rig would otherwise be the frame that is
// encoded. Nothing after that call touches the frame on this thread.
//
// One worker per page, created lazily on the first capture and reused by every
// later one (a worker per portrait would pay a module load per capture). Module
// state rather than per-rig state because the rig itself is a singleton
// (portrait.ts `ensureRig`), and its dispose is what releases this.
// Every way it
// can fail, no `Worker`, no `createImageBitmap`, a construction that throws, a
// runtime error, a request that never answers, ends the same way: the caller
// gets null, this module stops offering the path, and the adapter falls through
// to the arms that need no worker.

/**
 * LIVENESS BACKSTOP, not a pacing knob, and the twin of the readback's
 * (portrait_snapshot.ts): nothing waits on it in normal operation and it can
 * only shorten a wait that is already broken. A worker that has been handed a
 * bitmap and never answers would otherwise leave a promise that never settles,
 * which is what the serialised preview lane advances on. Three orders of
 * magnitude above the measured healthy cost (p50 0 ms of main-thread block,
 * about 115 ms of wall time on a loaded Mesa iGPU).
 */
export const PORTRAIT_ENCODE_LIVENESS_BACKSTOP_MS = 10_000;

type WorkerResponse = { requestId: number; url?: string; error?: string };

let worker: Worker | null = null;
let workerUnavailable = false;
// Bumped by every dispose. A failure that started before a graphics rebuild
// must not latch the transfer arm off for the rig that replaced it: dispose
// deliberately CLEARS `workerUnavailable` to give the new rig a fresh chance,
// and an in-flight rejection, backstop or worker error landing afterwards
// would silently take it away again. Sync failures need no guard; only the
// ones that can outlive their own capture carry the epoch.
let epoch = 0;
let nextRequestId = 1;
const waiters = new Map<number, (url: string | null) => void>();

/** What {@link bitmapPortraitTransferUsable} needs to know about this host.
 *  Read at call time, never cached, so a test (and a rebuilt rig) sees the
 *  environment it actually has. */
export function portraitBitmapEncodeSupport(): {
  hasCreateImageBitmap: boolean;
  hasWorker: boolean;
  hasOffscreenCanvas: boolean;
} {
  const scope = globalThis as {
    createImageBitmap?: unknown;
    Worker?: unknown;
    OffscreenCanvas?: unknown;
  };
  return {
    hasCreateImageBitmap: typeof scope.createImageBitmap === 'function',
    hasWorker: typeof scope.Worker === 'function' && !workerUnavailable,
    hasOffscreenCanvas: typeof scope.OffscreenCanvas === 'function',
  };
}

/**
 * Encode what `canvas` holds right now as a PNG data URL, on the worker.
 *
 * `size` is the square the caller drew, not something read off the bitmap: the
 * adapter owns the portrait size and every arm must emit that resolution.
 *
 * `onSnapshot` fires exactly once, as soon as the frame has been copied out of
 * the drawing buffer (or the copy has failed), which is when the caller may let
 * another capture draw into it again.
 *
 * Returns null (not a promise) when the path could not even be STARTED, which
 * is still inside the caller's synchronous window: the drawn frame is
 * untouched and the caller can pick another arm without re-drawing. A promise
 * resolving null is a LATE failure instead, and costs that one portrait.
 */
export function encodeCanvasBitmapPng(
  canvas: HTMLCanvasElement,
  size: number,
  onSnapshot?: () => void,
): Promise<string | null> | null {
  const support = portraitBitmapEncodeSupport();
  // Checked before the worker is built, not after: a host missing any one of
  // these cannot use the path at all, and constructing a worker it will never
  // post to is a module load for nothing.
  if (!support.hasCreateImageBitmap || !support.hasWorker || !support.hasOffscreenCanvas) {
    return null;
  }
  const active = ensureWorker();
  if (!active) return null;
  const create = (
    globalThis as {
      createImageBitmap?: (source: HTMLCanvasElement, options?: ImageBitmapOptions) => unknown;
    }
  ).createImageBitmap;
  if (typeof create !== 'function') return null;
  let snapshot: Promise<ImageBitmap>;
  try {
    // Both options pinned rather than left to the host. The drawing buffer
    // holds PREMULTIPLIED colour and `toBlob` reads it with no colour
    // conversion, so those are the semantics every other arm's output was
    // measured against; a host defaulting to unpremultiplied, or converting
    // into a display colour space, would ship haloed or shifted portrait edges
    // to that host alone.
    snapshot = create(canvas, {
      premultiplyAlpha: 'premultiply',
      colorSpaceConversion: 'none',
    }) as Promise<ImageBitmap>;
  } catch {
    markUnavailable();
    return null;
  }
  const at = epoch;
  return snapshot.then(
    (bitmap) => {
      onSnapshot?.();
      return transfer(active, bitmap, size, at);
    },
    () => {
      onSnapshot?.();
      markUnavailableAt(at);
      return null;
    },
  );
}

/** Release the worker (graphics rebuild, page teardown). Pending requests
 *  settle with null rather than hanging, and a rebuilt rig gets a fresh chance
 *  at the worker path. */
export function disposePortraitEncodeWorker(): void {
  epoch++;
  terminate();
  workerUnavailable = false;
}

function ensureWorker(): Worker | null {
  if (workerUnavailable) return null;
  if (worker) return worker;
  const support = portraitBitmapEncodeSupport();
  if (!support.hasWorker || !support.hasOffscreenCanvas) return null;
  let created: Worker;
  try {
    created = new Worker(new URL('./portrait_encode_worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    workerUnavailable = true;
    return null;
  }
  created.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const waiter = waiters.get(response.requestId);
    if (!waiter) return;
    waiters.delete(response.requestId);
    // A per-request error is this portrait's loss, not the worker's: the
    // adapter latches the rig off the path, and the worker stays up for the
    // requests already in flight.
    waiter(typeof response.url === 'string' ? response.url : null);
  });
  const at = epoch;
  const fail = (): void => markUnavailableAt(at);
  created.addEventListener('error', fail);
  created.addEventListener('messageerror', fail);
  worker = created;
  return created;
}

function transfer(
  active: Worker,
  bitmap: ImageBitmap,
  size: number,
  at: number,
): Promise<string | null> {
  // The snapshot is asynchronous, so the worker this request was meant for can
  // die (or be disposed) between the call and the bitmap. Posting to it anyway
  // would leave a request nothing ever answers, held open until the backstop.
  if (worker !== active) {
    bitmap.close();
    return Promise.resolve(null);
  }
  const requestId = nextRequestId++;
  return new Promise<string | null>((resolve) => {
    const backstop = setTimeout(() => {
      waiters.delete(requestId);
      markUnavailableAt(at);
      resolve(null);
    }, PORTRAIT_ENCODE_LIVENESS_BACKSTOP_MS);
    waiters.set(requestId, (url) => {
      clearTimeout(backstop);
      resolve(url);
    });
    try {
      active.postMessage({ requestId, bitmap, size }, [bitmap]);
    } catch {
      clearTimeout(backstop);
      waiters.delete(requestId);
      bitmap.close();
      markUnavailableAt(at);
      resolve(null);
    }
  });
}

/** Stop offering the path for the rest of the session (or until a dispose),
 *  and settle everything still waiting. */
function markUnavailable(): void {
  terminate();
  workerUnavailable = true;
}

/** The same, from a path that may have outlived its own rig (see `epoch`). */
function markUnavailableAt(at: number): void {
  if (at === epoch) markUnavailable();
}

function terminate(): void {
  worker?.terminate();
  worker = null;
  const pending = [...waiters.values()];
  waiters.clear();
  for (const waiter of pending) waiter(null);
}

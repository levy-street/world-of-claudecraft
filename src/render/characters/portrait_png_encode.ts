// The portrait capture's PNG encode, the one DOM-touching step of the readback
// path. Split out of portrait_snapshot.ts so the adapter's path selection can
// be unit tested without a 2D canvas (jsdom has no canvas backend), and so both
// capture arms, the async render-target readback and the synchronous
// default-framebuffer fallback, encode through the exact same call.
//
// The output contract is fixed by the consumers (see portrait.ts): a
// `data:image/png;base64,...` string, cached and handed straight to an <img>
// src or a CSS url(). Every arm resolves that or null; null commits nothing and
// leaves the consumer on its class crest.

/** Bitmap sources this module can serialize. */
type EncodableCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * Encode a canvas as a transparent PNG data URL.
 *
 * `toBlob` snapshots the bitmap AT CALL TIME, so a later render into a shared
 * rig cannot bleed into this capture; only the PNG encode itself is deferred.
 * Resolves null on any encode failure (including a synchronous throw, which
 * must not become an unhandled rejection).
 */
export function encodeCanvasPng(canvas: EncodableCanvas): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
        canvas.convertToBlob({ type: 'image/png' }).then(
          (blob) => readBlobAsDataUrl(blob, resolve),
          () => resolve(null),
        );
        return;
      }
      (canvas as HTMLCanvasElement).toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        readBlobAsDataUrl(blob, resolve);
      }, 'image/png');
    } catch {
      resolve(null);
    }
  });
}

function readBlobAsDataUrl(blob: Blob | null, resolve: (url: string | null) => void): void {
  if (!blob) {
    resolve(null);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(blob);
}

/**
 * Encode straight-alpha, top-down RGBA bytes (what
 * `flipUnpremultiplyInto` produces) as a PNG data URL, by way of a 2D
 * canvas. Resolves null when no 2D context is available, which sends the
 * capture back down the synchronous fallback for good.
 */
export function encodeRgbaPngDataUrl(
  bytes: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<string | null> {
  let canvas: EncodableCanvas;
  try {
    canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
    if (!(typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas)) {
      const element = canvas as HTMLCanvasElement;
      element.width = width;
      element.height = height;
    }
    const context = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) return Promise.resolve(null);
    context.putImageData(new ImageData(bytes, width, height), 0, 0);
  } catch {
    return Promise.resolve(null);
  }
  return encodeCanvasPng(canvas);
}

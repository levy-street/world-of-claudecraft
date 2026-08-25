// Two async primitives the renderer's screenshot and budget paths need, and nothing else.
//
// Lifted out of renderer.ts because neither touches the scene: one wraps a timer, the other
// wraps `canvas.toBlob`. The coordinator was carrying them only because that is where they
// were first written.

/** A timer as a promise. Floors at 0 so a negative budget still yields to the event loop. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

/**
 * `canvas.toBlob` as a data URL, resolving null on any failure.
 *
 * Never rejects, and that is the contract: the callers are screenshot and diagnostic paths
 * where a tainted canvas, an unsupported mime type, or a browser that simply hands back no
 * blob must degrade to "no image" rather than take the frame down. `toBlob` itself can throw
 * synchronously (a security error on a tainted canvas), which is why the try wraps the call
 * and not just the callback.
 */
export function canvasDataUrlAsync(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.addEventListener('load', () =>
            resolve(typeof reader.result === 'string' ? reader.result : null),
          );
          reader.addEventListener('error', () => resolve(null));
          reader.readAsDataURL(blob);
        },
        type,
        quality,
      );
    } catch {
      resolve(null);
    }
  });
}

// One canvas helper, lifted out of renderer.ts: the screenshot path is the
// only caller and nothing about it belongs to the frame loop.

/** Encode a copied 2D canvas without paying Canvas.toDataURL's synchronous
 *  compression cost on the UI thread. FileReader keeps the server-facing data
 *  URL contract while both compression and blob reading happen asynchronously. */
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

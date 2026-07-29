export type HdrPixelData = Uint16Array<ArrayBufferLike> | Float32Array<ArrayBufferLike>;

export interface ResampledHdr<T extends HdrPixelData = HdrPixelData> {
  data: T;
  width: number;
  height: number;
}

/**
 * Nearest-neighbour resize for decoded RGBA HDR pixels. PMREM immediately
 * convolves this source across every roughness level, so preserving HDR
 * samples matters while an expensive reconstruction filter does not. Keeping
 * this pure lets the decode worker resize before transferring its buffer.
 */
export function resampleHdrRgba<T extends HdrPixelData>(
  data: T,
  width: number,
  height: number,
  maxWidth: number,
): ResampledHdr<T> {
  const sourceWidth = Math.max(1, Math.floor(width));
  const sourceHeight = Math.max(1, Math.floor(height));
  const targetWidth = Math.max(1, Math.min(sourceWidth, Math.floor(maxWidth)));
  if (targetWidth === sourceWidth) return { data, width: sourceWidth, height: sourceHeight };

  const targetHeight = Math.max(1, Math.round((sourceHeight * targetWidth) / sourceWidth));
  const Ctor = data.constructor as new (length: number) => T;
  const resized = new Ctor(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor(((y + 0.5) * sourceHeight) / targetHeight),
    );
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor(((x + 0.5) * sourceWidth) / targetWidth),
      );
      const from = (sourceY * sourceWidth + sourceX) * 4;
      const to = (y * targetWidth + x) * 4;
      resized[to] = data[from];
      resized[to + 1] = data[from + 1];
      resized[to + 2] = data[from + 2];
      resized[to + 3] = data[from + 3];
    }
  }
  return { data: resized, width: targetWidth, height: targetHeight };
}

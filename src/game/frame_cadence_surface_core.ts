// The drawn surface's size class, for the automatic Frame Rate Limit: a verdict
// formed on a small window says nothing about a fullscreen one. A class change
// is a ratio of pixel counts, so an ordinary resize never invalidates anything.

export const SURFACE_CLASS_FACTOR = 1.5;

/** Whether `pixels` left the class `referencePixels` stands for. An unknown
 *  surface (0) never changes class: no reading is no evidence. */
export function surfaceClassChanged(referencePixels: number, pixels: number): boolean {
  if (!(referencePixels > 0) || !(pixels > 0)) return false;
  const ratio = pixels > referencePixels ? pixels / referencePixels : referencePixels / pixels;
  return ratio >= SURFACE_CLASS_FACTOR;
}

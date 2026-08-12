/** True when a texture image can feed CanvasRenderingContext2D.drawImage. A
 *  CompressedTexture's image is a plain {width,height} descriptor that PASSES
 *  a width-truthiness check and then throws inside drawImage, which is how a
 *  KTX2 colour layer took the whole renderer down at world build (the splat
 *  albedo pack); callers degrade such a source to their fail-safe instead.
 *  Every check is typeof-guarded so the predicate runs (and is tested) in
 *  plain Node, where it answers false for everything. */
export function isCanvasDrawableImage(img: unknown): img is CanvasImageSource {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return true;
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) return true;
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return true;
  if (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas) return true;
  return false;
}

// Off-main-thread image decode for loadBitmapTexture (loader.ts). An image
// element decodes inside the WebGL upload call, on the main thread; a
// createImageBitmap decode runs off it, so the upload that follows is a copy.
// three never sets the unpack flags for an ImageBitmap source (WebGL ignores
// them there), so the bitmap itself is decoded the way the image path
// uploads: flipped, unpremultiplied, and with no colour conversion, which is
// the unpack three picks for every sRGB or linear texture (their primaries
// match the working space) and for NoColorSpace alike.

export const BITMAP_DECODE_OPTIONS: ImageBitmapOptions = {
  imageOrientation: 'flipY',
  premultiplyAlpha: 'none',
  colorSpaceConversion: 'none',
};

/** Whether this browser gets the decode path: Chromium only (Chrome, Edge,
 *  the Electron shell), the one engine the texel identity is proven on
 *  (tests/browser/bitmap_texture_pixels.browser.test.ts). A browser that
 *  silently ignored an option would upload premultiplied or unflipped texels
 *  with no error to fall back on, so WebKit and Gecko keep the image path. */
export function imageBitmapDecodeSupported(
  userAgent: string | undefined,
  hasCreateImageBitmap: boolean,
): boolean {
  return hasCreateImageBitmap && !!userAgent && /(Chrome|Chromium)\/\d+/.test(userAgent);
}

export function browserDecodesImageBitmap(): boolean {
  return imageBitmapDecodeSupported(
    typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    typeof createImageBitmap === 'function',
  );
}

export async function fetchImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`image fetch failed: ${response.status} ${url}`);
  return response.blob();
}

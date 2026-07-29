// Pure, host-agnostic land/ocean classifier for the continent-overview art plate.
//
// WHY IT EXISTS. The continent overview used to mark each zone with its literal
// world-space rectangle, so the whole plate was covered in a grid of boxes and a
// hover highlight was a box too. A zone's world bounds really are a rectangle, so
// the only way to highlight a zone ORGANICALLY is to intersect that rectangle with
// the painted LAND: the wash then follows the coastline (and skips the inland
// lakes and rivers) instead of drawing a rectangle over the sea.
//
// WHAT IT DOES. Takes the decoded plate's RGBA pixels and returns an RGBA mask
// where land is opaque white and open water is transparent, with a soft edge. The
// classifier is a hue test (map ocean is markedly bluer than any painted terrain),
// the softening is a separable box blur, and the gain pass pushes the blurred
// interior back to fully opaque so only the coastline itself stays feathered (it
// also erases lone misclassified pixels, whose blurred coverage never survives it).
//
// The pure-core half of the split: no DOM, no canvas, no color tokens. The painter
// helper (continent_land_mask.ts) owns document.createElement and the ImageData
// round-trip; the painter (continent_map_painter.ts) owns the tint. DOM-free and
// deterministic so tests/continent_land_mask_core.test.ts drives it directly.

/** How much bluer than red a pixel must be to count as open water. Deep and
 *  shallow sea both clear it by a wide margin, and green canopy or brown rock is
 *  nowhere near it; the frostveil snowfields sit right ON the threshold, which is
 *  why the green margin below is the one actually holding them. */
export const OCEAN_BLUE_OVER_RED = 25;
/** The same test against green, which separates sea from the plate's teal-tinted
 *  shallows without swallowing the snowfields (near-neutral, blue barely ahead). */
export const OCEAN_BLUE_OVER_GREEN = 12;
/** Box-blur radius, in plate pixels, applied to the binary coverage. */
export const LAND_MASK_BLUR_RADIUS = 2;
/** Post-blur gain. Above 1 so the blurred INTERIOR saturates back to opaque and
 *  only the coast keeps a gradient; an isolated misclassified pixel stays far
 *  below opaque and reads as nothing. */
export const LAND_MASK_EDGE_GAIN = 1.6;

const OPAQUE = 255;

/** True when a plate pixel is open water rather than land. */
export function isOceanPixel(r: number, g: number, b: number): boolean {
  return b > r + OCEAN_BLUE_OVER_RED && b > g + OCEAN_BLUE_OVER_GREEN;
}

/** Separable box blur over an 8-bit coverage plane, in place of a real blur
 *  filter (Canvas2D `filter` is not on the whole browser matrix). Two running-sum
 *  passes, so the cost is O(pixels) regardless of the radius. */
function boxBlur(src: Uint8ClampedArray, width: number, height: number, radius: number): void {
  if (radius <= 0) return;
  const span = radius * 2 + 1;
  const row = new Uint8ClampedArray(Math.max(width, height));
  // Horizontal pass.
  for (let y = 0; y < height; y++) {
    const base = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k));
        sum += src[base + sx];
      }
      row[x] = sum / span;
    }
    for (let x = 0; x < width; x++) src[base + x] = row[x];
  }
  // Vertical pass.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k));
        sum += src[sy * width + x];
      }
      row[y] = sum / span;
    }
    for (let y = 0; y < height; y++) src[y * width + x] = row[y];
  }
}

/**
 * Build the land mask for a decoded continent plate.
 *
 * Returns a fresh RGBA buffer (4 bytes per pixel, the ImageData layout the helper
 * puts straight back onto its canvas): white everywhere, alpha 255 over land,
 * 0 over open water, and a short ramp across the coastline. The input's own alpha
 * is ignored; the shipped plate has no alpha channel at all.
 */
export function buildLandMaskRgba(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  blurRadius: number = LAND_MASK_BLUR_RADIUS,
): Uint8ClampedArray {
  const count = width * height;
  const coverage = new Uint8ClampedArray(count);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    coverage[i] = isOceanPixel(pixels[p], pixels[p + 1], pixels[p + 2]) ? 0 : OPAQUE;
  }
  boxBlur(coverage, width, height, blurRadius);
  const out = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    out[p] = OPAQUE;
    out[p + 1] = OPAQUE;
    out[p + 2] = OPAQUE;
    out[p + 3] = coverage[i] * LAND_MASK_EDGE_GAIN;
  }
  return out;
}

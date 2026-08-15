// Painter-side helper: turns the decoded continent plate into a reusable LAND
// MASK canvas the continent painter composites its zone wash through.
//
// The classification and the soft edge are pure and live in
// continent_land_mask_core.ts; this module owns the two things a pure core cannot
// do, and nothing else: minting its own detached canvas and the ImageData
// round-trip (draw the plate, read its pixels, write the mask back). The result is
// COLORLESS on purpose (opaque white over land, transparent over water): the
// painter tints it per redraw from the resolved --color-map-* tokens, so a theme
// change never invalidates the mask.
//
// ONE-TIME COST, BOUNDED RESOLUTION. The mask is built once per session (the plate
// is static) and rasterized at most MASK_MAX_DIMENSION on its long axis, which is
// already larger than the map canvas ever blits it at, so the blur and the pixel
// walk stay well clear of the plate's native pixel count.
//
// FAILURE IS EXPECTED, NOT EXCEPTIONAL. `getImageData` throws on a canvas tainted
// by a cross-origin plate, and a context is not guaranteed at all, so every path
// returns null and the painter falls back to its flat rectangle wash.
//
// DOM: needs `document.createElement('canvas')`, so this is a painter-side helper,
// not a pure core. Host-agnostic otherwise (no window, no getComputedStyle, no
// color literals, no clock), registered in UI_PAINTER_HELPERS in
// tests/architecture.test.ts, which holds it to exactly that. Keep the
// registration in sync if this file is moved or renamed.

import { buildLandMaskRgba } from './continent_land_mask_core';

/** Longest side the mask is rasterized at. The continent plate is blitted into a
 *  canvas a few hundred px on a side, so a larger mask buys no visible edge. */
export const MASK_MAX_DIMENSION = 768;

/** Scale the plate down to fit MASK_MAX_DIMENSION, never up (a small plate keeps
 *  its own pixels rather than being interpolated into a bigger buffer). */
export function maskDimensions(
  width: number,
  height: number,
  cap: number = MASK_MAX_DIMENSION,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > 0) || !Number.isFinite(longest)) return { width: 0, height: 0 };
  const scale = Math.min(1, cap / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Build the land mask for a decoded continent plate, or null when it cannot be
 * built (no 2D context, a degenerate size, or a tainted canvas). `sourceWidth` /
 * `sourceHeight` are the plate's natural pixel size; the caller passes them so
 * this helper never has to reach for a DOM class to read them off the image.
 */
export function buildLandMaskCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): HTMLCanvasElement | null {
  const { width, height } = maskDimensions(sourceWidth, sourceHeight);
  if (width < 1 || height < 1) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(source, 0, 0, width, height);
    const plate = ctx.getImageData(0, 0, width, height);
    const mask = ctx.createImageData(width, height);
    mask.data.set(buildLandMaskRgba(plate.data, width, height));
    ctx.putImageData(mask, 0, 0);
  } catch {
    // A cross-origin plate taints the canvas and getImageData throws; the caller
    // falls back to the flat rectangle wash.
    return null;
  }
  return canvas;
}

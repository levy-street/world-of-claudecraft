// Display color of a custom paint swatch with its hue/light adjust applied,
// so the 2D paint overlay and the palette thumbnails stay roughly
// representative of what the adjusted texture paints. Pure math (no Three),
// mirroring the splat shader's grey-axis hue rotation and light blend.

import type { CustomPaintSwatch } from '../sim/types';

export function adjustedSwatchColor(sw: CustomPaintSwatch): number {
  const hs = sw.hueShift ?? 0;
  const lt = sw.light ?? 0;
  if (hs === 0 && lt === 0) return sw.color;
  let r = ((sw.color >> 16) & 0xff) / 255;
  let g = ((sw.color >> 8) & 0xff) / 255;
  let b = (sw.color & 0xff) / 255;
  if (hs !== 0) {
    // Rodrigues rotation of the rgb vector around the grey axis, the same
    // formula the shader's wocHueRotate applies to the ground albedo.
    const a = (hs / 180) * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const k = 0.5773502691896258; // 1/sqrt(3)
    const proj = k * k * (r + g + b) * (1 - ca);
    const nr = r * ca + k * (b - g) * sa + proj;
    const ng = g * ca + k * (r - b) * sa + proj;
    const nb = b * ca + k * (g - r) * sa + proj;
    r = nr;
    g = ng;
    b = nb;
  }
  if (lt > 0) {
    // Screen toward white, matching the shader's mix(alb, 1.0, light * 0.75).
    r += (1 - r) * lt * 0.75;
    g += (1 - g) * lt * 0.75;
    b += (1 - b) * lt * 0.75;
  } else if (lt < 0) {
    const m = 1 + lt * 0.75;
    r *= m;
    g *= m;
    b *= m;
  }
  const c8 = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return (c8(r) << 16) | (c8(g) << 8) | c8(b);
}

// Regression for #1639: the significant-contributor dev-tier name glow used an
// all-blurred text-shadow stack (0 0 4px / 0 0 2px in the tier color) that, at the
// 12px nameplate font size, smeared the letterforms and read as out-of-focus text
// instead of a halo around sharp text. The fix keeps a crisp 1px ring (zero-blur
// offset shadows in the tier color) so the glyph edges stay sharp, with only a
// single small faint blur behind it for the halo. Pin "crisp ring present, no
// smear-blur" against the source (no real browser needed).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');

// Isolate the .np-sig-dev rule body.
const m = css.match(/\.np-name\.np-sig-dev\s*\{([\s\S]*?)\}/);

describe('dev-tier nameplate glow stays crisp (#1639)', () => {
  it('the .np-sig-dev rule exists', () => {
    expect(m).not.toBeNull();
  });

  it('keeps at most a single small blurred halo layer (not the old two-layer smear)', () => {
    const body = m![1];
    // The old smear stacked TWO zero-offset blurs over the glyphs (0 0 4px + 0 0 2px).
    // The fix keeps at most ONE faint halo behind the crisp ring, bounded small.
    // Match a 0-offset blur in EITHER the tier color or the softened --dev-ring, so a revert
    // to the old --dev-outline smear still reds this.
    const blurLayers = [...body.matchAll(/0\s+0\s+(\d+)px\s+var\(--dev-(?:outline|ring)\)/g)];
    expect(blurLayers.length).toBeLessThanOrEqual(1);
    for (const layer of blurLayers) {
      expect(Number(layer[1])).toBeLessThanOrEqual(3);
    }
  });

  it('draws a crisp zero-blur outline ring in the softened tier color (sharp glyph edges)', () => {
    const body = m![1];
    // The ring is drawn in --dev-ring, a color-mix that keeps the per-tier --dev-outline hue
    // but lowers the alpha so the outline is a subtle badge, not a heavy stroke (#1639 review).
    // Assert the softened color derives from the tier color (no hardcoded hue)...
    expect(body).toMatch(/--dev-ring:\s*color-mix\([^;]*var\(--dev-outline\)[^;]*\)/);
    // ...and that all eight crisp zero-blur offset layers are present. An offset is either
    // `Npx` or a bare unitless `0`, so the four CARDINALS (`1px 0 0`, `0 1px 0`) count
    // alongside the four DIAGONALS (`1px 1px 0`). The halo `0 0 3px` (non-zero blur) and the
    // base `0 1px 1px #000` do not match. The old smear had zero of these.
    const ringLayers = [...body.matchAll(/(?:-?\d+px|0)\s+(?:-?\d+px|0)\s+0\s+var\(--dev-ring\)/g)];
    expect(ringLayers.length).toBeGreaterThanOrEqual(8);
  });
});

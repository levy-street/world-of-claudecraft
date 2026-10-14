import { describe, expect, it } from 'vitest';

import {
  PAINT_LAYER_UNIFORMS_GLSL,
  PAINT_NORMAL_GLSL,
  paintLayerSampleGlsl,
} from '../src/render/terrain_paint_layers';

// Every MIPMAPPED tap in the paint path sits inside a per-pixel branch, and
// GLSL leaves dFdx/dFdy UNDEFINED in divergent flow. An undefined derivative
// picks a garbage LOD for the whole 2x2 quad, which draws as scattered pale
// screen-aligned squares over painted ground (SPACEY, 2026-09-22). So every one
// of them must be textureGrad with derivatives taken up in uniform flow.
//
// The paint FIELD is the one exception: NearestFilter, no mipmaps, so it has
// no LOD to get wrong.

// Level 2 = every pass compiled in, which is what the gradient rules must hold for.
const PAINT_GLSL = [PAINT_LAYER_UNIFORMS_GLSL, paintLayerSampleGlsl(2), PAINT_NORMAL_GLSL].join(
  '\n',
);

/** Sampler argument of every implicit-LOD call. `textureGrad(` does not match:
 *  the pattern requires the paren straight after `texture` / `texture2D`. */
function implicitSamplers(src: string): string[] {
  return [...src.matchAll(/\btexture(?:2D)?\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
}

describe('painted relief tiers with the ground beside it', () => {
  // Painted relief used to ignore the relief ladder entirely, so `?trelief=off`
  // (and a low graphics tier) turned the splat ground's relief off while the
  // painted ground kept both its shading AND its AO taps.
  const cavityCompiledIn = (lvl: number): boolean =>
    /true &&\s*wocPainted0 && wocDepth/.test(paintLayerSampleGlsl(lvl));
  const directionalCompiledIn = (lvl: number): boolean =>
    /true &&\s*wocRlf > 0\.02/.test(paintLayerSampleGlsl(lvl));

  it('compiles nothing at level 0, cavity at 1, the directional passes at 2', () => {
    expect([cavityCompiledIn(0), directionalCompiledIn(0)]).toEqual([false, false]);
    expect([cavityCompiledIn(1), directionalCompiledIn(1)]).toEqual([true, false]);
    expect([cavityCompiledIn(2), directionalCompiledIn(2)]).toEqual([true, true]);
  });

  it('leaves no AO tap behind at level 0', () => {
    // The whole point: a tier with relief off must not pay for the taps.
    const off = paintLayerSampleGlsl(0);
    expect(off).toContain('false &&');
    expect(directionalCompiledIn(0)).toBe(false);
  });
});

describe('paint shader texture gradients', () => {
  it('takes every mipmapped tap with explicit gradients', () => {
    // uPaintField is nearest + un-mipmapped; everything else must be Grad.
    expect([...new Set(implicitSamplers(PAINT_GLSL))].sort()).toEqual(['uPaintField']);
  });

  it('samples the tile arrays only through textureGrad', () => {
    for (const sampler of ['uPaintTiles', 'uPaintNormTiles', 'uPaintAoTiles']) {
      const uses = [...PAINT_GLSL.matchAll(new RegExp(`\\w+\\s*\\(\\s*${sampler}\\b`, 'g'))].map(
        (m) => m[0],
      );
      expect(uses.length).toBeGreaterThan(0); // anti-vacuity: the tap still exists
      for (const use of uses) expect(use).toContain('textureGrad');
    }
  });

  it('takes the normal tap derivatives before the branches that use them', () => {
    const decl = PAINT_NORMAL_GLSL.indexOf('vec2 wocPnDx = dFdx(');
    const branch = PAINT_NORMAL_GLSL.indexOf('if (wocPaintW > 0.001');
    expect(decl).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(branch);
  });

  it('divides the derivative by the same per-pixel period as the uv', () => {
    // A gradient taken AFTER the divide is discontinuous at every slot
    // boundary, because a different swatch is a different tile size.
    expect(PAINT_NORMAL_GLSL).toContain('wocPnDx / wocPnPeriod');
    expect(PAINT_NORMAL_GLSL).toContain('wocPnDy / wocPnPeriod');
  });
});

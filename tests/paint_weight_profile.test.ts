// Pins the fragment paint weight profile in terrain_paint_layers.ts's
// PAINT_LAYER_SAMPLE_GLSL, mirrored in JS: bilinear over the 2x2 surrounding
// cell centres with a smoothstep on the fraction.
//
// Two regressions this guards (both shipped at once, both user-visible):
//   - solid paint must weigh EXACTLY 1.0: an earlier 0.94 cap left 6% of the
//     base splat (leaf litter) bleeding through fully painted ground;
//   - the boundary must be a smooth one-cell gradient: the earlier four
//     equal-weight diagonal taps quantized edges into blocky quarter steps.
import { describe, expect, it } from 'vitest';
import { PAINT_LAYER_SAMPLE_GLSL } from '../src/render/terrain_paint_layers';

// JS mirror of the GLSL: cellPainted answers per integer cell. The final
// smoothstep(0, 0.5, n) remap makes painted cells solid edge to edge and
// pushes the whole fade into the unpainted neighbour band.
function weightAt(px: number, cellPainted: (i: number) => boolean): number {
  const c = px - 0.5; // grid origin 0, cell size 1 (uPaintGrid.z = 1)
  const i = Math.floor(c);
  const t = c - i;
  const s = t * t * (3 - 2 * t); // smoothstep
  let w = 0;
  if (cellPainted(i)) w += 1 - s;
  if (cellPainted(i + 1)) w += s;
  const u = Math.min(1, Math.max(0, w / 0.5));
  return u * u * (3 - 2 * u);
}

describe('paint weight profile', () => {
  it('solid paint weighs exactly 1.0 (no base splat bleed)', () => {
    for (const x of [0.5, 0.75, 1.0, 1.33, 2.5]) {
      expect(weightAt(x, () => true)).toBeCloseTo(1.0, 6);
    }
    // The GLSL must not re-introduce a cap.
    expect(PAINT_LAYER_SAMPLE_GLSL).not.toContain('0.94');
  });

  it('an isolated painted cell peaks at 1.0 over its own centre', () => {
    const painted = (i: number): boolean => i === 3;
    expect(weightAt(3.5, painted)).toBeCloseTo(1.0, 6);
  });

  it('the edge is a smooth monotone gradient across one cell, not steps', () => {
    // cells < 2 painted, >= 2 not: boundary between centres 1.5 and 2.5
    const painted = (i: number): boolean => i < 2;
    const samples: number[] = [];
    for (let x = 1.5; x <= 2.5 + 1e-9; x += 0.1) samples.push(weightAt(x, painted));
    expect(samples[0]).toBeCloseTo(1.0, 6);
    expect(samples[samples.length - 1]).toBeCloseTo(0.0, 6);
    // Painted cells are SOLID all the way to their own border: the fade
    // lives entirely in the unpainted band beyond it.
    expect(weightAt(2.0, painted)).toBeCloseTo(1.0, 6);
    expect(weightAt(1.9, painted)).toBeCloseTo(1.0, 6);
    for (let k = 1; k < samples.length; k++) {
      // monotone
      expect(samples[k]).toBeLessThanOrEqual(samples[k - 1] + 1e-9);
      // No blocky jumps: adjacent 0.1-cell samples stay under the smooth
      // S-curve's own maximum slope. The fade spans the half cell beyond
      // the painted border, so the curve is steeper than the old
      // centre-to-centre blend but still continuous.
      expect(samples[k - 1] - samples[k]).toBeLessThan(0.45);
    }
  });

  it('the GLSL carries the bilinear + smoothstep shape this mirror models', () => {
    expect(PAINT_LAYER_SAMPLE_GLSL).toContain('smoothstep');
    expect(PAINT_LAYER_SAMPLE_GLSL).toContain('wocBW');
  });
});

import { describe, expect, it } from 'vitest';
import { paletteGradeUniforms } from '../src/render/palette_lab/palette_grade';
import { OUTPUT_GRADE_FRAGMENT_SHADER, OutputGradePass } from '../src/render/post_output_grade';

describe('palette lab grade arm', () => {
  it('is compiled out of the stock string, which keeps its exact gain line', () => {
    const shader = OUTPUT_GRADE_FRAGMENT_SHADER;
    const arm = shader.indexOf('#ifdef PALETTE_GRADE\n    // Palette lab: the look owns');
    const stockLine = shader.indexOf('c = pow(max(vec3(0.0), c * GAIN + LIFT), GAMMA);');
    expect(arm).toBeGreaterThan(-1);
    // The stock line is the #else arm right after the lab's own line.
    expect(stockLine).toBeGreaterThan(arm);
    expect(shader.slice(arm, stockLine)).toContain('#else');
    // The look's grade runs after the stock saturation, before the vignette.
    const call = shader.indexOf('c = paletteGrade(c);');
    expect(call).toBeGreaterThan(shader.indexOf('c = mix(vec3(l), c, 1.07);'));
    expect(call).toBeLessThan(shader.indexOf('c *= 1.0 - 0.08 * smoothstep'));
  });

  it('shares ONE uniform block across every grade pass that opts in', () => {
    const time = { value: 0 };
    const a = new OutputGradePass(time, null, { paletteGrade: true });
    const b = new OutputGradePass(time, null, { fxaa: true, paletteGrade: true });
    const shared = paletteGradeUniforms();
    expect(a.material.uniforms.uPalWB).toBe(shared.uPalWB);
    expect(b.material.uniforms.uPalGreen).toBe(shared.uPalGreen);
    a.dispose();
    b.dispose();
  });

  it('leaves a pass without the option untouched', () => {
    const pass = new OutputGradePass({ value: 0 }, null);
    expect(pass.material.uniforms.uPalWB).toBeUndefined();
    pass.dispose();
  });
});

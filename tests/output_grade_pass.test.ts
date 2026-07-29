import { describe, expect, it } from 'vitest';
import { OutputGradePass, OutputGradeShader } from '../src/render/output_grade_pass';

describe('OutputGradePass', () => {
  it('keeps OutputPass color conversion ahead of the existing display grade', () => {
    const fragment = OutputGradeShader.fragmentShader;
    const sampleAt = fragment.indexOf('texture2D(tDiffuse');
    const toneMapAt = fragment.indexOf('ACESFilmicToneMapping(gl_FragColor.rgb)');
    const transferAt = fragment.indexOf('sRGBTransferOETF(gl_FragColor)');
    const gradeAt = fragment.indexOf('c * GAIN + LIFT');
    const grainAt = fragment.indexOf('fract(sin(');

    expect(sampleAt).toBeGreaterThan(-1);
    expect(toneMapAt).toBeGreaterThan(sampleAt);
    expect(transferAt).toBeGreaterThan(toneMapAt);
    expect(gradeAt).toBeGreaterThan(transferAt);
    expect(grainAt).toBeGreaterThan(gradeAt);
  });

  it('shares the live time uniform rather than cloning it', () => {
    const time = { value: 3.5 };
    const pass = new OutputGradePass(time);

    expect(pass.uniforms.uTime).toBe(time);
    time.value = 7;
    expect(pass.uniforms.uTime.value).toBe(7);
    pass.dispose();
  });
});

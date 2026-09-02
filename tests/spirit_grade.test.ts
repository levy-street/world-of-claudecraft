// @vitest-environment jsdom
//
// Spirit (ghost) mode moved off the CSS canvas filter and into the renderer's
// output grade pass. These pins hold both halves: the eased amount the uniform
// carries, and which of the two arms is armed on which tier.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUTPUT_GRADE_FRAGMENT_SHADER, OutputGradePass } from '../src/render/post_output_grade';
import {
  SPIRIT_GRADE_ATTRIBUTE,
  SPIRIT_GRADE_CSS,
  SPIRIT_GRADE_SHADER,
  SpiritGrade,
} from '../src/render/spirit_grade';
import {
  advanceSpiritGrade,
  createSpiritGradeState,
  cssEase,
  SPIRIT_GRADE_EASE_SEC,
} from '../src/render/spirit_grade_core';

const readSource = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

const FRAME = 1 / 60;

function run(ghost: boolean, seconds: number, state = createSpiritGradeState()): number {
  const frames = Math.round(seconds / FRAME);
  let value = state.value;
  for (let i = 0; i < frames; i++) value = advanceSpiritGrade(state, FRAME, ghost);
  return value;
}

describe('spirit grade timing core', () => {
  it('is the CSS ease keyword, cubic-bezier(0.25, 0.1, 0.25, 1)', () => {
    expect(cssEase(0)).toBe(0);
    expect(cssEase(1)).toBe(1);
    // Reference values for cubic-bezier(0.25, 0.1, 0.25, 1).
    expect(cssEase(0.25)).toBeCloseTo(0.408511, 4);
    expect(cssEase(0.5)).toBeCloseTo(0.802403, 4);
    expect(cssEase(0.75)).toBeCloseTo(0.960459, 4);
    // Monotone, and eased rather than linear (it overshoots the diagonal).
    let previous = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const value = cssEase(Math.min(1, p));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(cssEase(0.5)).toBeGreaterThan(0.5);
  });

  it('reaches full drain in the transition duration and holds there', () => {
    const state = createSpiritGradeState();
    expect(state.value).toBe(0);
    expect(run(true, SPIRIT_GRADE_EASE_SEC * 0.5, state)).toBeGreaterThan(0);
    expect(run(true, SPIRIT_GRADE_EASE_SEC * 0.5, state)).toBeCloseTo(1, 6);
    expect(run(true, 2, state)).toBe(1);
  });

  it('eases back to zero on resurrect and never snaps mid-fade', () => {
    const state = createSpiritGradeState();
    run(true, 2, state);
    expect(state.value).toBe(1);
    const half = run(false, SPIRIT_GRADE_EASE_SEC * 0.5, state);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(run(false, SPIRIT_GRADE_EASE_SEC, state)).toBe(0);
  });

  it('a flip mid-transition restarts from the CURRENT value, the CSS behaviour', () => {
    const state = createSpiritGradeState();
    const partial = run(true, SPIRIT_GRADE_EASE_SEC * 0.4, state);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
    // Resurrecting now must ease DOWN from where the fade got to, not from 1.
    advanceSpiritGrade(state, FRAME, false);
    expect(state.from).toBeCloseTo(partial, 6);
    expect(state.value).toBeLessThan(partial);
    expect(run(false, SPIRIT_GRADE_EASE_SEC, state)).toBe(0);
  });

  it('settles immediately under reduced motion, as the CSS rule did', () => {
    const state = createSpiritGradeState();
    expect(advanceSpiritGrade(state, FRAME, true, true)).toBe(1);
    expect(advanceSpiritGrade(state, FRAME, false, true)).toBe(0);
  });
});

describe('spirit grade wiring', () => {
  it('drives the post chain and stamps the canvas as the shader arm', () => {
    const canvas = document.createElement('canvas');
    const pushed: number[] = [];
    const grade = new SpiritGrade(canvas, { setSpiritGrade: (v) => pushed.push(v) });
    expect(canvas.dataset[SPIRIT_GRADE_ATTRIBUTE]).toBe(SPIRIT_GRADE_SHADER);
    grade.update(FRAME, true);
    grade.update(FRAME, true);
    expect(pushed).toHaveLength(2);
    expect(pushed[1]).toBeGreaterThan(pushed[0]);
    expect(pushed[0]).toBeGreaterThan(0);
  });

  it('stamps the CSS fallback arm when the tier has no post chain', () => {
    const canvas = document.createElement('canvas');
    const grade = new SpiritGrade(canvas, null);
    expect(canvas.dataset[SPIRIT_GRADE_ATTRIBUTE]).toBe(SPIRIT_GRADE_CSS);
    // Still advances (harmless), just with nothing to push it into.
    expect(grade.update(FRAME, true)).toBeGreaterThan(0);
  });

  it('honours the reduced-motion source it is given', () => {
    const canvas = document.createElement('canvas');
    const grade = new SpiritGrade(canvas, null, () => true);
    expect(grade.update(FRAME, true)).toBe(1);
  });
});

describe('the grade pass carries the tint', () => {
  it('exposes uSpirit at zero and folds it into the final colour', () => {
    const pass = new OutputGradePass({ value: 0 });
    expect(pass.uniforms.uSpirit.value).toBe(0);
    expect(OUTPUT_GRADE_FRAGMENT_SHADER).toContain('uniform float uSpirit;');
    // The classic look: full desaturation times 0.88 brightness, with BOTH
    // functions interpolated the way a CSS filter list is.
    expect(OUTPUT_GRADE_FRAGMENT_SHADER).toContain('SPIRIT_BRIGHTNESS = 0.88');
    expect(OUTPUT_GRADE_FRAGMENT_SHADER).toContain(
      'c = mix(c, vec3(grey), uSpirit) * (1.0 - (1.0 - SPIRIT_BRIGHTNESS) * uSpirit);',
    );
    pass.dispose();
  });
});

describe('the CSS filter is the low-tier fallback only', () => {
  const css = readSource('../src/styles/base.css');

  it('arms the canvas filter and its transition only on the css-stamped arm', () => {
    expect(css).toContain(
      "#game-canvas[data-spirit-grade='css'] {\n    transition: filter 0.6s ease;",
    );
    expect(css).toContain(
      "body.spirit-mode #game-canvas[data-spirit-grade='css'] {\n    filter: grayscale(1) brightness(0.88);",
    );
  });

  it('no longer filters or transitions the canvas unconditionally', () => {
    expect(css).not.toContain('body.spirit-mode #game-canvas {');
    // The bare #game-canvas rule keeps no filter transition of its own, so a
    // composer/grade tier never promotes the canvas into its own surface.
    const bare = css.slice(css.indexOf('  #game-canvas {'));
    expect(bare.slice(0, bare.indexOf('}'))).not.toContain('transition');
  });

  it('the renderer stamps the arm from the live post chain', () => {
    const renderer = readSource('../src/render/renderer.ts');
    expect(renderer).toContain('new SpiritGrade(canvas, this.post, () => this.reducedMotion())');
    expect(renderer).toContain('this.spiritGrade.update(dt, p.dead && p.ghost);');
  });
});

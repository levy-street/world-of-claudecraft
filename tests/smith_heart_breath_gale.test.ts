// The Storm Cornice's gales as wind with a body (the AAA pass's third round,
// src/render/smith_heart_fx/breath_gale_glsl.ts): torn masses of cloud wound
// up the column and thickest at its silhouette, a few streaks only, debris
// flecks, a dense dust skirt; the dust at its foot soft billows that overlap,
// never a ring of small puffs; the painter takes its shaders from the module.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FUNNEL_FRAG,
  GALE_BODY_ALPHA,
  GALE_FOOT_DUST,
  GALE_GRIT,
  WIND_FUNNEL_VERT,
} from '../src/render/smith_heart_fx/breath_gale_glsl';

describe('breath_gale_glsl: a gale is a body of air', () => {
  it('carries its look in torn cloud masses, the streaks only a share', () => {
    expect(FUNNEL_FRAG).toContain('float torn = smoothstep(0.3, 0.64, mass)');
    expect(FUNNEL_FRAG).toContain('float fleck');
    expect(FUNNEL_FRAG).toContain('float skirt');
    expect(FUNNEL_FRAG).toContain('streak * 0.35');
    expect(GALE_BODY_ALPHA).toBeGreaterThan(0.8);
    // The silhouette fills in (seen through more of itself).
    expect(WIND_FUNNEL_VERT).toContain('vFace');
    expect(FUNNEL_FRAG).toContain('edge * edge');
    // No pow() of a value that can go negative.
    expect(FUNNEL_FRAG).not.toMatch(/pow\(/);
  });

  it('rolls soft swelling billows of dust at its foot, never popcorn', () => {
    expect(GALE_FOOT_DUST.size[1]).toBeGreaterThan(GALE_FOOT_DUST.size[0] * 2.5);
    expect(GALE_FOOT_DUST.size[1]).toBeGreaterThan(4);
    expect(GALE_FOOT_DUST.alpha).toBeLessThan(0.4);
    expect(GALE_GRIT.size[0]).toBeLessThan(0.3);
  });

  it('is the painter’s one funnel program', () => {
    const src = readFileSync('src/render/smith_heart_fx/breath_fight_fx.ts', 'utf8');
    expect(src).toContain("from './breath_gale_glsl'");
    expect(src).not.toContain('const FUNNEL_FRAG');
    expect(src).not.toContain('const WIND_FUNNEL_VERT');
    expect(src).toContain('GALE_FOOT_DUST.rate');
  });
});

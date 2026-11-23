import { describe, expect, it } from 'vitest';
import {
  type OceanSurfaceShaderOptions,
  oceanSamplerNames,
  oceanSurfaceFragment,
  oceanSurfaceVertex,
} from '../src/render/ocean/ocean_surface_glsl';

const opts = (over: Partial<OceanSurfaceShaderOptions> = {}): OceanSurfaceShaderOptions => ({
  cascades: 4,
  underside: false,
  shoreEdgeFade: false,
  zoneHaze: true,
  ssrSteps: 22,
  apron: false,
  ...over,
});

const samplers = (src: string): string[] =>
  [
    ...src.matchAll(/uniform\s+(sampler2D|samplerCube|sampler2DArray)\s+(\w+)\s*(,\s*(\w+))?/g),
  ].flatMap((m) => (m[4] ? [m[2], m[4]] : [m[2]]));

describe('ocean surface shader', () => {
  it('stays inside the WebGL2 minimum of sixteen samplers per stage, at its richest', () => {
    // The fragment stage also reads the shadow-free scene capture and the haze
    // field; four cascades with every arm compiled in is the worst case.
    const frag = oceanSurfaceFragment(opts());
    const vert = oceanSurfaceVertex(opts());
    expect(new Set(samplers(frag)).size).toBeLessThanOrEqual(16);
    expect(new Set(samplers(vert)).size).toBeLessThanOrEqual(16);
  });

  it('declares exactly the cascade samplers the material binds', () => {
    for (const cascades of [3, 4]) {
      const frag = oceanSurfaceFragment(opts({ cascades }));
      const names = oceanSamplerNames(cascades);
      for (const name of names.shade) expect(frag).toContain(`uniform sampler2D ${name};`);
      expect(frag).not.toContain(`uOceanShade${cascades};`);
      const vert = oceanSurfaceVertex(opts({ cascades }));
      for (const name of names.disp) expect(vert).toContain(`uniform sampler2D ${name};`);
    }
  });

  it('compiles the screen-space trace in only when asked, and never from below', () => {
    expect(oceanSurfaceFragment(opts({ ssrSteps: 0 }))).not.toContain('oceanSsr');
    expect(oceanSurfaceFragment(opts())).toContain('for (int i = 0; i < 22; i++)');
  });

  it('keeps the palette lab override and the realm character on every arm', () => {
    for (const underside of [false, true]) {
      const frag = oceanSurfaceFragment(opts({ underside }));
      expect(frag).toContain('mix(charA.rgb, uDeep, uWaterPalette)');
      expect(frag).toContain('#ifdef WATER_UNDERSIDE');
    }
  });

  it('never orders smoothstep edges backwards on a literal pair', () => {
    // smoothstep(a, b, x) with a >= b is undefined in GLSL; spell falling ramps
    // as 1.0 - smoothstep(b, a, x).
    for (const src of [oceanSurfaceFragment(opts()), oceanSurfaceVertex(opts())]) {
      for (const m of src.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
        expect(Number(m[1]), m[0]).toBeLessThan(Number(m[2]));
      }
    }
  });

  it('compiles the apron discard only into the apron variant', () => {
    expect(oceanSurfaceFragment(opts())).toContain('#ifdef OCEAN_APRON');
    expect(oceanSurfaceFragment(opts())).toContain('if (i >= uSheetRectCount) break;');
  });

  it('never lets the debug switch read terms the from-below arm lacks', () => {
    expect(oceanSurfaceFragment(opts())).toContain(
      '#if defined(OCEAN_DEBUG_TERMS) && !defined(WATER_UNDERSIDE)',
    );
  });
});

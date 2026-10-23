import { describe, expect, it } from 'vitest';
import {
  FIRE_ADVECT_COMBUST_FRAG,
  FIRE_DIVERGENCE_FRAG,
  FIRE_JACOBI_FRAG,
  FIRE_PROJECT_FRAG,
} from '../src/render/fire/fire_simulation_glsl';
import {
  type FireSurfaceShaderOptions,
  fireSurfaceFragment,
  fireSurfaceVertex,
} from '../src/render/fire/fire_surface_glsl';

const opts = (over: Partial<FireSurfaceShaderOptions> = {}): FireSurfaceShaderOptions => ({
  marchSteps: 24,
  shimmer: true,
  ...over,
});

const samplers = (src: string): string[] =>
  [
    ...src.matchAll(/uniform\s+(sampler2D|samplerCube|sampler2DArray)\s+(\w+)\s*(,\s*(\w+))?/g),
  ].flatMap((m) => (m[4] ? [m[2], m[4]] : [m[2]]));

describe('fire surface and solver shaders', () => {
  it('stays well inside the WebGL2 minimum of sixteen samplers per stage', () => {
    const frag = fireSurfaceFragment(opts());
    const vert = fireSurfaceVertex();
    expect(new Set(samplers(frag)).size).toBeLessThanOrEqual(16);
    expect(new Set(samplers(vert)).size).toBeLessThanOrEqual(16);
  });

  it('compiles scene-refraction heat shimmer only when shimmer is enabled', () => {
    const withShimmer = fireSurfaceFragment(opts({ shimmer: true }));
    const withoutShimmer = fireSurfaceFragment(opts({ shimmer: false }));
    expect(withShimmer).toContain('vec3 refracted = sceneRefract(');
    expect(withoutShimmer).not.toContain('vec3 refracted = sceneRefract(');
  });

  it('never orders smoothstep edges backwards on a literal pair and uses zero pow() calls', () => {
    const sources = [
      fireSurfaceVertex(),
      fireSurfaceFragment(opts({ shimmer: true, debugTerms: true })),
      fireSurfaceFragment(opts({ shimmer: false, debugTerms: false })),
      FIRE_ADVECT_COMBUST_FRAG,
      FIRE_DIVERGENCE_FRAG,
      FIRE_JACOBI_FRAG,
      FIRE_PROJECT_FRAG,
    ];
    for (const src of sources) {
      for (const m of src.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) {
        expect(Number(m[1]), m[0]).toBeLessThan(Number(m[2]));
      }
      // Guard against unprotected pow( calls that could poison bloom with NaN.
      expect(src).not.toContain('pow(');
    }
  });
});

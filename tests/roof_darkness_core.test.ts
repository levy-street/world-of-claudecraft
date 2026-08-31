// Pins for the roof darkness shader patchers (src/render/roof_darkness_core.ts):
// anchor placement, idempotence, the post-fog ordering, and the ramp bounds
// the ignivar rooms rely on.
import { describe, expect, it } from 'vitest';
import {
  patchRoofDarknessFragmentShader,
  patchRoofDarknessVertexShader,
  ROOF_DARK_END_Y,
  ROOF_DARK_FRAGMENT_ANCHOR,
  ROOF_DARK_START_Y,
  ROOF_DARK_VERTEX_ANCHOR,
} from '../src/render/roof_darkness_core';

const VERTEX_TEMPLATE = `void main() {
  #include <begin_vertex>
  #include <project_vertex>
  #include <fog_vertex>
}`;

const FRAGMENT_TEMPLATE = `void main() {
  gl_FragColor = vec4( outgoingLight, diffuseColor.a );
  #include <tonemapping_fragment>
  #include <fog_fragment>
}`;

describe('patchRoofDarknessVertexShader', () => {
  it('injects the world-Y varying write at the project anchor', () => {
    const patched = patchRoofDarknessVertexShader(VERTEX_TEMPLATE);
    expect(patched).toContain('varying float vRoofDarkWorldY;');
    expect(patched).toContain('vRoofDarkWorldY = roofWorld.y;');
    expect(patched).toContain(ROOF_DARK_VERTEX_ANCHOR);
    expect(patched).toContain('USE_INSTANCING');
  });

  it('is idempotent and leaves anchor-less sources untouched', () => {
    const once = patchRoofDarknessVertexShader(VERTEX_TEMPLATE);
    expect(patchRoofDarknessVertexShader(once)).toBe(once);
    expect(patchRoofDarknessVertexShader('void main() {}')).toBe('void main() {}');
  });
});

describe('patchRoofDarknessFragmentShader', () => {
  it('applies the black ramp AFTER fog so fogged distance still darkens', () => {
    const patched = patchRoofDarknessFragmentShader(FRAGMENT_TEMPLATE);
    expect(patched).toContain('uniform float uRoofDarkStrength;');
    const fogAt = patched.indexOf(ROOF_DARK_FRAGMENT_ANCHOR);
    const rampAt = patched.indexOf('smoothstep( uRoofDarkStart, uRoofDarkEnd, vRoofDarkWorldY )');
    expect(fogAt).toBeGreaterThan(-1);
    expect(rampAt).toBeGreaterThan(fogAt);
  });

  it('is idempotent and leaves anchor-less sources untouched', () => {
    const once = patchRoofDarknessFragmentShader(FRAGMENT_TEMPLATE);
    expect(patchRoofDarknessFragmentShader(once)).toBe(once);
    expect(patchRoofDarknessFragmentShader('void main() {}')).toBe('void main() {}');
  });
});

describe('ramp bounds', () => {
  it('starts above play height and completes past the double wall top', () => {
    expect(ROOF_DARK_START_Y).toBeGreaterThan(8);
    expect(ROOF_DARK_END_Y).toBeGreaterThan(16);
    expect(ROOF_DARK_START_Y).toBeLessThan(ROOF_DARK_END_Y);
  });
});

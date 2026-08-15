import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The paint-free carpet ring (terrain.ts GRASS_PAINT_RING_GLSL): inside the
// dense blade carpet the soil shows the plain photo grass; the painted
// meadow ramps in across the carpet's own outer fade. These pins hold the
// three properties the live regression taught us to guard.
describe('meadow paint ring', () => {
  const terrain = readFileSync(new URL('../src/render/terrain.ts', import.meta.url), 'utf8');

  it('gates the ring on the shared carpet uniform in BOTH shader arms', () => {
    // the snippet is spliced via one shared constant, so presence of the
    // constant plus two splice sites is the both-arms guarantee
    expect(terrain).toContain('const GRASS_PAINT_RING_GLSL');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal shader template source.
    const splices = terrain.split('${GRASS_PAINT_RING_GLSL}').length - 1;
    expect(splices, 'rich and plain arms both splice the ring').toBe(2);
    expect(terrain).toContain('uCarpetRing.z > 0.0');
  });

  it('reuses the carpet fade constant so the two fades cannot drift', () => {
    expect(terrain).toContain('MEADOW_CARPET_FADE_START.toFixed(2)');
  });

  it('tone continuity is a clamped CPU constant, never sampler arithmetic', () => {
    // the white-ground regression came from dividing one live sampler tap by
    // another (a biased top-mip tap); pin the ABSENCE of that mechanism and
    // the presence of the clamped constant lift
    expect(terrain).not.toMatch(/texture2D\(uGrass,\s*tuv,\s*\d/);
    expect(terrain).toContain('plainGrassLift');
    expect(terrain).toMatch(/Math\.min\(2\.5, Math\.max\(0\.4/);
  });

  it('the renderer publishes the ring beside the shared clock', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer.split('sharedUniforms.uCarpetRing.value.set').length - 1).toBe(2);
  });
});

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { applyEnvSheen, envSheenFragment } from '../src/render/characters/env_sheen';
import { VISUALS } from '../src/render/characters/manifest';

// VisualDef.envSheen: the WOC bodies' dark authored atlases read the sky environment's
// albedo-free dielectric reflection as one grey film (the 2026-09-28 in-game A/B: env off
// removed it, emissive off and matte did not). The body keeps a quarter of that reflection on
// non-metal surfaces; metal keeps all of it; the diffuse sky fill and direct light are untouched.

const FRAGMENT = [
  'void main() {',
  '#include <lights_fragment_begin>',
  '#include <lights_fragment_maps>',
  '#include <lights_fragment_end>',
  '}',
].join('\n');

describe('the env sheen scale', () => {
  it('scales only the gathered env reflection, by metalness, after the IBL chunk', () => {
    const out = envSheenFragment(FRAGMENT, 0.25);
    const at = out.indexOf('#include <lights_fragment_maps>');
    const scale = out.indexOf('radiance *= mix( 0.250, 1.0, metalnessFactor );');
    expect(scale).toBeGreaterThan(at);
    expect(scale).toBeLessThan(out.indexOf('#include <lights_fragment_end>'));
    expect(out).toContain('#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )');
    expect(out).not.toContain('iblIrradiance *=');
    // a program without the chunk (the low tier's Lambert rebuild) is left as it was
    const lambert = 'void main() {\n#include <lights_fragment_begin>\n}';
    expect(envSheenFragment(lambert, 0.25)).toBe(lambert);
  });

  it('chains after the hooks a material already carries, under a program key of its own', () => {
    const mat = new THREE.MeshStandardMaterial();
    const earlier = vi.fn((shader: { fragmentShader: string }) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        'void main() { // rim',
      );
    });
    mat.onBeforeCompile = earlier;
    mat.customProgramCacheKey = () => 'rim-key';
    const plainKey = mat.customProgramCacheKey();
    applyEnvSheen(mat, 0.25);
    const shader = { fragmentShader: FRAGMENT, vertexShader: '', uniforms: {} };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(earlier).toHaveBeenCalledOnce();
    expect(shader.fragmentShader).toContain('// rim');
    expect(shader.fragmentShader).toContain('mix( 0.250, 1.0, metalnessFactor )');
    const key = mat.customProgramCacheKey();
    expect(key).not.toBe(plainKey);
    expect(key).toContain('env-sheen:0.250');
    expect(key).toContain('rim-key');
    const other = new THREE.MeshStandardMaterial();
    other.onBeforeCompile = earlier;
    other.customProgramCacheKey = () => 'rim-key';
    applyEnvSheen(other, 0.5);
    expect(other.customProgramCacheKey()).not.toBe(key);
  });

  it('is set on every WOC body (both fits) and on nothing else', () => {
    // the player bodies (the Tideglass Reflections are copies of them, sheen included)
    const woc = Object.entries(VISUALS).filter(
      ([key, def]) => key.startsWith('player_') && def.wocCharacter,
    );
    expect(woc.length).toBe(18);
    for (const [key, def] of woc) expect(def.envSheen, key).toBe(0.25);
    for (const [key, def] of Object.entries(VISUALS)) {
      if (!def.wocCharacter) expect(def.envSheen, key).toBeUndefined();
    }
  });
});

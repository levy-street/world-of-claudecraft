import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { applyEnvSheen } from '../src/render/characters/env_sheen';
import { VISUALS } from '../src/render/characters/manifest';

// VisualDef.envSheen: the WOC bodies' dark authored atlases read the sky environment's
// albedo-free reflection as one grey film (the 2026-09-28 in-game A/B: env off removed it,
// emissive off and matte did not; the 2026-10-29 capture in Eastbrook's painted look still
// measured 2 to 3 code values of it at the old quarter share). The shares and the line live in
// env_sheen_core.ts (tests/env_sheen_core.test.ts); this pins the three.js layer and the defs.

const FRAGMENT = [
  'void main() {',
  '#include <lights_fragment_begin>',
  '#include <lights_fragment_maps>',
  '#include <lights_fragment_end>',
  '}',
].join('\n');

describe('the env sheen layer', () => {
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
    applyEnvSheen(mat, 0.1);
    const shader = { fragmentShader: FRAGMENT, vertexShader: '', uniforms: {} };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(earlier).toHaveBeenCalledOnce();
    expect(shader.fragmentShader).toContain('// rim');
    expect(shader.fragmentShader).toContain(
      'radiance *= mix( 0.100, 0.400, saturate( metalnessFactor * 2.500 ) );',
    );
    const key = mat.customProgramCacheKey();
    expect(key).not.toBe(plainKey);
    expect(key).toContain('env-sheen:0.100:0.400:0.400');
    expect(key).toContain('rim-key');
    const other = new THREE.MeshStandardMaterial();
    other.onBeforeCompile = earlier;
    other.customProgramCacheKey = () => 'rim-key';
    applyEnvSheen(other, 0.5);
    expect(other.customProgramCacheKey()).not.toBe(key);
    // recorded for the clone re-attach (material_clone_hooks.ts)
    expect(mat.userData.envSheen).toBe(0.1);
  });

  it('is set on every WOC body (both fits) at a tenth, and on nothing else', () => {
    // the player bodies (the Tideglass Reflections are copies of them, sheen included)
    const woc = Object.entries(VISUALS).filter(
      ([key, def]) => key.startsWith('player_') && def.wocCharacter,
    );
    expect(woc.length).toBe(18);
    for (const [key, def] of woc) expect(def.envSheen, key).toBe(0.1);
    for (const [key, def] of Object.entries(VISUALS)) {
      if (!def.wocCharacter) expect(def.envSheen, key).toBeUndefined();
    }
  });
});

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { shareWeaponVfxFrameUniforms } from '../src/render/weapon_vfx_uniforms';

describe('weapon VFX frame uniforms', () => {
  it('shares time and scale cells without changing their initial values', () => {
    const first = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, own: { value: 2 } },
    });
    const second = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, own: { value: 3 } },
    });
    const shared = shareWeaponVfxFrameUniforms([first, second]);
    expect(first.uniforms.uTime).toBe(shared.time);
    expect(second.uniforms.uTime).toBe(shared.time);
    expect(first.uniforms.uScale).toBe(shared.scale);
    expect(second.uniforms.uScale).toBe(shared.scale);
    expect(shared.scale?.value).toBe(600);
    expect(first.uniforms.own.value).toBe(2);
    expect(second.uniforms.own.value).toBe(3);

    shared.time.value = 4.5;
    if (shared.scale) shared.scale.value = 900;
    expect(first.uniforms.uTime.value).toBe(4.5);
    expect(second.uniforms.uScale.value).toBe(900);
  });

  it('handles materials without animated uniforms', () => {
    const plain = new THREE.MeshBasicMaterial();
    const shared = shareWeaponVfxFrameUniforms([plain]);
    expect(shared.time.value).toBe(0);
    expect(shared.scale).toBeNull();
  });
});

import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { WarriorPowerForms } from '../src/render/ability_vfx/warrior_power_forms';

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const { Texture } = await import('three');
  const texture = new Texture();
  return { warriorSteelTexture: () => texture, warriorBloodTexture: () => texture };
});

it('keeps the prepared material and uniforms while reduced motion disables all wave displacement', () => {
  const pool = new WarriorPowerForms(new THREE.Scene());
  const material = pool.meshes[1].material;
  const shader = {
    ...THREE.ShaderLib.standard,
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
  } as Parameters<typeof material.onBeforeCompile>[0];
  const key = material.customProgramCacheKey();
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  const time = shader.uniforms.uWarriorRageTime,
    motion = shader.uniforms.uWarriorRageMotion;
  const ribbons = { appendHeld: vi.fn() } as unknown as AbilityVfxRibbons;
  let x = 0;
  const draw = (reduced: boolean) =>
    pool.draw(
      0,
      0.1,
      reduced,
      (_id, _fraction, out = new THREE.Vector3()) => out.set(x, 1, 0),
      () => x,
      ribbons,
    );
  draw(false);
  expect(time.value).toBeGreaterThan(0);
  expect(motion.value).toBe(1);
  draw(true);
  x = 100;
  draw(true);
  expect(time.value).toBe(0);
  expect(motion.value).toBe(0);
  expect(material.customProgramCacheKey()).toBe(key);
  expect(shader.uniforms.uWarriorRageTime).toBe(time);
  expect(shader.uniforms.uWarriorRageMotion).toBe(motion);
  expect(material.blending).toBe(THREE.AdditiveBlending);
  expect(material.depthWrite).toBe(false);
  // The existing emissive vertex-colour layer survives the new shader hook.
  expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb');
  pool.dispose();
});

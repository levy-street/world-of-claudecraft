import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  createSpiritVeilMaterial,
  SpiritVeilRig,
  spiritVeilDepthMaterial,
  spiritVeilPaletteOf,
} from '../src/render/characters/ghost_veil';
import {
  attachWocHeadMergedTint,
  attachWocHeadTint,
  setWocHeadTint,
} from '../src/render/characters/woc_head_tint';

function compile(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(shader as never, {} as never);
  return shader;
}

describe('WOC albedo in the spirit veil', () => {
  it('shares live tint uniforms without multiplying source colour twice or changing programs', () => {
    const source = new THREE.MeshStandardMaterial({ color: 0x804020 });
    const tint = attachWocHeadTint(source, 'hair', [0.2, 0.1, 0.05]);
    const veil = createSpiritVeilMaterial(source, 'march');
    const key = veil.customProgramCacheKey();
    const shader = compile(veil);
    expect(veil.color).toEqual(source.color);
    expect(shader.uniforms.uVeilSrcColor.value).toEqual(new THREE.Color(1, 1, 1));
    expect(shader.uniforms.uWocHtTint).toBe(tint.tint);
    setWocHeadTint(tint, [0.1, 0.5, 0.9]);
    expect(shader.uniforms.uWocHtTint.value).toEqual(new THREE.Vector3(0.1, 0.5, 0.9));
    expect(veil.customProgramCacheKey()).toBe(key);
  });

  it('preserves grouped far-head discard, palette changes and owned-depth disposal', () => {
    const body = new THREE.MeshStandardMaterial();
    const head = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const slots = attachWocHeadMergedTint(head, true);
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material[]>(new THREE.BoxGeometry(), [
      createSpiritVeilMaterial(body, 'march'),
      createSpiritVeilMaterial(head, 'march'),
    ]);
    const rig = new SpiritVeilRig();
    rig.sync([mesh], []);
    const sibling = mesh.getObjectByName('spirit_veil_depth') as THREE.Mesh;
    const depths = sibling.material as THREE.MeshBasicMaterial[];
    expect(depths).toHaveLength(2);
    expect(depths[0]).toBe(spiritVeilDepthMaterial('depth:r:0', 'march'));
    const shader = compile(depths[1]);
    expect(shader.uniforms.uWocHmSurf).toBe(slots.surf);
    expect(shader.fragmentShader).toContain('!gl_FrontFacing) discard');
    const colorShader = compile(mesh.material[1]);
    expect(colorShader.fragmentShader).not.toContain('totalEmissiveRadiance');
    expect(colorShader.uniforms.uWocHmSurf).toBe(slots.surf);
    rig.sync([mesh], []);
    expect(sibling.material).toBe(depths);
    const disposeOwned = vi.fn();
    const disposeShared = vi.fn();
    depths[1].addEventListener('dispose', disposeOwned);
    depths[0].addEventListener('dispose', disposeShared);
    const previous = mesh.material;
    mesh.material = [
      createSpiritVeilMaterial(body, 'wolf'),
      createSpiritVeilMaterial(head, 'wolf'),
    ];
    rig.sync([mesh], []);
    const next = sibling.material as THREE.MeshBasicMaterial[];
    expect(next).not.toBe(depths);
    expect(next.map(spiritVeilPaletteOf)).toEqual(['wolf', 'wolf']);
    expect(compile(next[1]).uniforms.uWocHmSurf).toBe(slots.surf);
    previous[1].dispose();
    previous[1].dispose();
    expect(disposeOwned).toHaveBeenCalledTimes(1);
    expect(disposeShared).not.toHaveBeenCalled();
    mesh.material = [body, head];
    rig.sync([mesh], []);
    expect(sibling.parent).toBeNull();
  });
});

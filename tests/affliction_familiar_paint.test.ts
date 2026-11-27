import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rotmarkPaintedCopy } from '../src/render/affliction_familiar_paint';

function sourceModel(): { root: THREE.Group; material: THREE.MeshStandardMaterial } {
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  return { root, material };
}

function onlyMaterial(root: THREE.Object3D): THREE.MeshStandardMaterial {
  return (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
}

describe('Rotmark familiar paint', () => {
  it('paints a copy and leaves the loader cache model as shipped', () => {
    const { root, material } = sourceModel();
    const copy = rotmarkPaintedCopy(root);
    const painted = onlyMaterial(copy);

    expect(painted).not.toBe(material);
    expect(painted.map).toBe(material.map);
    expect(painted.userData.rotmarkPainted).toBe(true);
    expect(painted.customProgramCacheKey().endsWith('|rotmark-familiar-paint-v2')).toBe(true);
    expect(material.userData.rotmarkPainted).toBeUndefined();
    expect(material.customProgramCacheKey()).not.toContain('rotmark-familiar-paint');
  });

  it('swaps the purple, teal, and navy bands into the base color chunk', () => {
    const copy = rotmarkPaintedCopy(sourceModel().root);
    const shader = {
      fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n}',
    } as THREE.WebGLProgramParametersWithUniforms;
    onlyMaterial(copy).onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.fragmentShader).toContain('vec3 rotmarkBand(');
    expect(shader.fragmentShader.match(/diffuseColor\.rgb = rotmarkBand\(/g)).toHaveLength(3);
    expect(shader.fragmentShader).toContain('#include <map_fragment>');
  });
});

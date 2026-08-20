// The material texture-slot walk (material_texture_slots.ts): the one slot
// list the renderer's texture prewarm and boot scene collection share, and
// the visible-only contract of the object walk (the boot collection mirrors
// what the initial frame draws; a live entity view is walked in full).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  collectObjectTextures,
  MATERIAL_TEXTURE_KEYS,
  materialSlotTextures,
} from '../src/render/material_texture_slots';

describe('material texture slots', () => {
  it('names every built-in map slot once', () => {
    expect([...MATERIAL_TEXTURE_KEYS].sort()).toEqual(
      [
        'alphaMap',
        'aoMap',
        'bumpMap',
        'displacementMap',
        'emissiveMap',
        'envMap',
        'gradientMap',
        'lightMap',
        'map',
        'metalnessMap',
        'normalMap',
        'roughnessMap',
        'specularMap',
      ].sort(),
    );
    expect(new Set(MATERIAL_TEXTURE_KEYS).size).toBe(MATERIAL_TEXTURE_KEYS.length);
  });

  it('reads only the bound slots of a material', () => {
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map, normalMap });
    expect(materialSlotTextures(material)).toEqual([map, normalMap]);
    expect(materialSlotTextures(new THREE.MeshBasicMaterial())).toEqual([]);
  });

  it('collects across a subtree, deduplicated, and skips hidden subtrees only when asked', () => {
    const shared = new THREE.Texture();
    const hiddenOnly = new THREE.Texture();
    const root = new THREE.Group();
    const a = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ map: shared }),
    );
    const b = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshStandardMaterial({ map: shared }),
      new THREE.MeshStandardMaterial({ emissiveMap: hiddenOnly }),
    ]);
    const hidden = new THREE.Group();
    hidden.visible = false;
    hidden.add(b);
    root.add(a, hidden);

    expect([...collectObjectTextures(root, true)]).toEqual([shared]);
    expect(new Set(collectObjectTextures(root, false))).toEqual(new Set([shared, hiddenOnly]));
    // traverseVisible skips a hidden ROOT too: the boot collection of a
    // hidden group yields nothing, the full walk still everything.
    root.visible = false;
    expect([...collectObjectTextures(root, true)]).toEqual([]);
    expect(new Set(collectObjectTextures(root, false))).toEqual(new Set([shared, hiddenOnly]));
    root.visible = true;
    // An existing set accumulates instead of being replaced.
    const into = new Set<THREE.Texture>([hiddenOnly]);
    expect(collectObjectTextures(root, true, into)).toBe(into);
    expect(into).toEqual(new Set([hiddenOnly, shared]));
  });
});

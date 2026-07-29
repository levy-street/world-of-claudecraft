import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CharacterVisual } from '../src/render/characters/visual';

function tintHarness(): { visual: CharacterVisual; mesh: THREE.Mesh } {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  mesh.name = 'Hair';
  const model = new THREE.Group();
  model.add(mesh);
  const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
  const state = visual as unknown as Record<string, unknown>;
  state.model = model;
  state.originalMaterials = new Map([[mesh, mesh.material]]);
  state.cosmeticTintMaterials = new Map();
  return { visual, mesh };
}

describe('cosmetic tint material ownership', () => {
  it('disposes the previous owned clone when a tint changes or resets', () => {
    const { visual, mesh } = tintHarness();
    const tint = (
      visual as unknown as { tintCosmeticMeshes(names: string[], color?: number): void }
    ).tintCosmeticMeshes.bind(visual);

    tint(['Hair'], 0x112233);
    const first = mesh.material as THREE.Material;
    const disposeFirst = vi.spyOn(first, 'dispose');

    tint(['Hair'], 0x445566);
    expect(disposeFirst).toHaveBeenCalledOnce();
    const second = mesh.material as THREE.Material;
    const disposeSecond = vi.spyOn(second, 'dispose');

    tint(['Hair'], undefined);
    expect(disposeSecond).toHaveBeenCalledOnce();
    expect(mesh.material).toBe(mesh.userData.cosmeticBase);
  });

  it('selects one face, applies beard rules, falls back to hair zero, and accepts black', () => {
    const names = ['MaleFace', 'FemaleFace', 'MaleHair0', 'MaleHair1', 'FemaleHair', 'Beard'];
    const model = new THREE.Group();
    const meshes = new Map<string, THREE.Mesh>();
    for (const name of names) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
      mesh.name = name;
      meshes.set(name, mesh);
      model.add(mesh);
    }
    const visual = Object.create(CharacterVisual.prototype) as CharacterVisual;
    const state = visual as unknown as Record<string, unknown>;
    state.model = model;
    state.def = {
      cosmetics: {
        faces: [
          {
            face: ['MaleFace'],
            hair: [['MaleHair0'], ['MaleHair1']],
            beard: ['Beard'],
          },
          { face: ['FemaleFace'], hair: [['FemaleHair']] },
        ],
        hairMeshes: ['MaleHair0', 'MaleHair1', 'FemaleHair', 'Beard'],
        faceMeshes: ['MaleFace', 'FemaleFace'],
      },
    };
    state.face = -1;
    state.hairStyle = -1;
    state.beard = false;
    state.hairColor = undefined;
    state.faceColor = undefined;
    state.originalMaterials = new Map();
    state.cosmeticTintMaterials = new Map();

    visual.setCosmetics(99, true, 0x000000, 0x000000, 1);

    expect(meshes.get('MaleFace')?.visible).toBe(false);
    expect(meshes.get('FemaleFace')?.visible).toBe(true);
    expect(meshes.get('Beard')?.visible).toBe(false);
    expect(meshes.get('FemaleHair')?.visible).toBe(true);
    expect(meshes.get('MaleHair0')?.visible).toBe(false);
    const femaleHair = meshes.get('FemaleHair');
    const femaleFace = meshes.get('FemaleFace');
    expect(femaleHair).toBeDefined();
    expect(femaleFace).toBeDefined();
    if (!femaleHair || !femaleFace) throw new Error('missing cosmetic harness mesh');
    expect((femaleHair.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0);
    expect((femaleFace.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0);

    visual.setCosmetics(1, false, undefined, undefined, 0);
    expect(meshes.get('MaleFace')?.visible).toBe(true);
    expect(meshes.get('FemaleFace')?.visible).toBe(false);
    expect(meshes.get('MaleHair1')?.visible).toBe(true);
    expect(meshes.get('Beard')?.visible).toBe(false);
  });
});

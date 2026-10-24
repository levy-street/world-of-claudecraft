// The starter shield through the REAL attach path (assets.ts setHeldOffhand -> attachProp ->
// applyMaterials), with only the loader stubbed: the plate is tagged at attach, in the hand and
// in the carry alike, and its material is built without the character rim, while the sword
// beside it keeps the rim. tests/tinted_material.test.ts pins the material rule on a hand-set
// tag and tests/starter_weapon_models.test.ts the set itself; this is the link between them.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: vi.fn(),
  registerDeferredPreload: vi.fn((start: () => unknown) => start()),
}));

/** Every url serves one textured box: enough for the attach path, which only walks meshes. */
const stubGltf = () => {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 0.1),
    new THREE.MeshStandardMaterial({ map: new THREE.Texture(), roughness: 0.9, metalness: 0 }),
  );
  mesh.name = 'prop';
  scene.add(mesh);
  return { scene, animations: [] };
};

const meshesOf = (holder: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  holder.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

afterEach(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.resetModules();
});

describe('a flat starter plate through the attach path', () => {
  it('is tagged at attach and built without the rim, in the hand and in the carry', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));
    const assets = await import('../src/render/characters/assets');
    const { VISUALS } = await import('../src/render/characters/manifest');
    const gfx = await import('../src/render/gfx');
    const { cloneMaterialWithHooks } = await import('../src/render/material_clone_hooks');
    await assets.charactersReady();
    const restoreGfx = gfx.gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    try {
      const def = VISUALS.player_warrior;
      // the three bones the attach path asks a rig for: both hand slots and the carry bone
      const root = new THREE.Group();
      for (const name of ['handslotl', 'handslotr', 'chest']) {
        const bone = new THREE.Object3D();
        bone.name = name;
        root.add(bone);
      }
      for (const stowed of [false, true]) {
        const [shield] = assets.setHeldOffhand(root, def, 'eastbrook_buckler', null, stowed);
        const [sword] = assets.setHeldWeapon(root, def, 'worn_sword', null, stowed);
        expect(shield, `shield holder, stowed ${stowed}`).toBeDefined();
        expect(sword, `sword holder, stowed ${stowed}`).toBeDefined();
        // the carry re-parents onto the chest; the hand holds on its slot
        expect(shield.parent?.name).toBe(stowed ? 'chest' : 'handslotl');
        assets.applyMaterials(root, def, 0xffffff);

        const [plate] = meshesOf(shield);
        const [blade] = meshesOf(sword);
        expect(plate.userData.rimless, `stowed ${stowed}`).toBe(true);
        expect(blade.userData.rimless, `stowed ${stowed}`).toBeUndefined();
        const plateMat = plate.material as THREE.Material;
        const bladeMat = blade.material as THREE.Material;
        expect(gfx.hasRimGlow(plateMat), `stowed ${stowed}`).toBe(false);
        expect(gfx.hasRimGlow(bladeMat), `stowed ${stowed}`).toBe(true);

        // An effect clone (a stealth fade, an aura tint, a skin isolation) re-attaches only
        // the hooks its source carried: a plate's clone stays rimless, on the plate's program.
        const plateClone = cloneMaterialWithHooks(plateMat);
        expect(gfx.hasRimGlow(plateClone)).toBe(false);
        expect(plateClone.customProgramCacheKey()).toBe(plateMat.customProgramCacheKey());
        const bladeClone = cloneMaterialWithHooks(bladeMat);
        expect(gfx.hasRimGlow(bladeClone)).toBe(true);
        expect(bladeClone.customProgramCacheKey()).toBe(bladeMat.customProgramCacheKey());
        // and the two are different programs: the rim is a shader patch
        expect(plateMat.customProgramCacheKey()).not.toBe(bladeMat.customProgramCacheKey());
      }
    } finally {
      restoreGfx();
    }
  });
});

// @vitest-environment happy-dom
// Bug: the far-LOD baked character mesh ignored the player's selected body
// skin. tintedFarMaterials() baked this.farMaterials once in the
// CharacterVisual constructor with no skin/emissive texture ever passed, and
// setSkin() only rebuilt the near rig (applySkinMaterials only touched
// this.model). A player wearing a non-default body skin visibly popped back
// to the model's embedded default texture the instant the renderer's
// distance LOD switched them onto the far mesh (~58-75yd band, see
// showsStaticFarMesh in renderer.ts). This test drives the real
// construction + setSkin path (mocked GLTF/texture loader only) and
// compares the near-rig body mesh's texture against the far-mesh's texture
// after a skin swap.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// player_paladin has no `show` allowlist (so a plain, non-skinned stub mesh
// stays visible through assembleModel's accessory filter) and a real
// alternate skin at index 1, matching the production data this bug hit.
const VISUAL_KEY = 'player_paladin';

// The bones both paladin synthesis factories validate on their source clip
// (ROTATION_OFFSETS in paladin_templars_verdict_clip.ts / _bastion_sweep_).
const SYNTH_SOURCE_BONES = [
  'hips',
  'spine',
  'chest',
  'head',
  'upperarmr',
  'lowerarmr',
  'upperarml',
  'lowerarml',
  'upperlegr',
  'lowerlegr',
  'upperlegl',
  'lowerlegl',
];

function stubSourceClip(name: string): THREE.AnimationClip {
  const tracks = SYNTH_SOURCE_BONES.map(
    (bone) =>
      new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  );
  return new THREE.AnimationClip(name, 1, tracks);
}

function stubGltf() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  scene.add(mesh);
  return {
    scene,
    animations: [
      new THREE.AnimationClip('Idle', 1, []),
      // prepareVisual synthesizes the paladin Verdict/Sweep clips from these
      // two sources and fails closed when either is missing or lacks the
      // per-bone quaternion tracks, so the stub rig must carry both like the
      // shipped paladin GLB does.
      stubSourceClip('2H_Melee_Attack_Chop'),
      stubSourceClip('1H_Melee_Attack_Slice_Diagonal'),
    ],
  };
}

describe('far-LOD mesh follows the selected body skin', () => {
  it('rebuilds the far-mesh material from the current skin after setSkin', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      // Tag each loaded texture with the URL it came from so the test can
      // tell the alternate-skin atlas apart from the embedded default.
      loadTexture: vi.fn((url: string) =>
        Promise.resolve(Object.assign(new THREE.Texture(), { name: url })),
      ),
      // loadSkinTexInto requests the .ktx2 sibling for a textures/skins/ atlas;
      // tag it back to the .png identity so this test still names the alt skin
      // by the SKINS entry it came from, not by which loader fetched it.
      loadKtx2Texture: vi.fn((url: string) =>
        Promise.resolve(
          Object.assign(new THREE.Texture(), { name: url.replace(/\.ktx2$/, '.png') }),
        ),
      ),
      releaseGltf: vi.fn(),
    }));
    const { charactersReady, prepareVisual } = await import('../src/render/characters/assets');
    await charactersReady();
    const { CharacterVisual } = await import('../src/render/characters/visual');
    const { SKINS } = await import('../src/render/characters/manifest');

    const altSkinUrl = SKINS[VISUAL_KEY]?.[1];
    expect(altSkinUrl).toBeTruthy();

    const visual = new CharacterVisual(VISUAL_KEY, 0xffffff, 0);
    visual.setSkin(1);

    // Near rig: the equipped body mesh must show the alternate atlas.
    let nearMap: THREE.Texture | null = null;
    visual.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.bodyMesh) {
        nearMap = (mesh.material as THREE.MeshStandardMaterial).map;
      }
    });
    expect(nearMap).not.toBeNull();
    expect((nearMap as unknown as THREE.Texture).name).toBe(altSkinUrl);

    // Far LOD mesh: baked once per key, found by its shared (memoized)
    // geometry. The shadow-only proxy mesh shares that SAME geometry (see
    // the constructor), so match on the tinted-material array shape too:
    // tintedFarMaterials always returns an array, while the shadow proxy's
    // singleton shadowOnlyMat() is a lone, non-array material.
    const prep = prepareVisual(VISUAL_KEY);
    let farMaterial: THREE.Material | THREE.Material[] | undefined;
    visual.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry === prep.idleGeo && Array.isArray(mesh.material)) {
        farMaterial = mesh.material;
      }
    });
    expect(farMaterial).toBeDefined();
    const farMats = Array.isArray(farMaterial) ? farMaterial : [farMaterial];
    expect(farMats.length).toBeGreaterThan(0);
    const farMap = (farMats[0] as THREE.MeshStandardMaterial).map;

    // This is the bug: the far mesh must match the near rig's selected skin,
    // not the model's embedded default texture (map === null).
    expect(farMap).not.toBeNull();
    expect((farMap as unknown as THREE.Texture).name).toBe(altSkinUrl);

    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });
});

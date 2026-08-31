import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

function stubGltf(withEmissiveFx = true) {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  body.name = 'body';
  scene.add(body);

  if (withEmissiveFx) {
    const emissive = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshStandardMaterial(),
    );
    emissive.name = 'authored_emissive_fx';
    emissive.userData.shadowCaster = false;
    scene.add(emissive);
  }
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
}

describe('character shadow proxy', () => {
  it('bakes authored emissive FX into the visible far LOD but not its shadow geometry', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf())),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));

    const { charactersReady, prepareVisual } = await import('../src/render/characters/assets');
    await charactersReady();
    const prep = prepareVisual('mob_elemental');
    expect(prep.idleGeo).not.toBeNull();
    expect(prep.shadowGeo).not.toBeNull();
    expect(prep.shadowGeo).not.toBe(prep.idleGeo);
    expect(prep.shadowGeo?.getAttribute('position').count).toBeLessThan(
      prep.idleGeo?.getAttribute('position').count ?? 0,
    );

    const { CharacterVisual } = await import('../src/render/characters/visual');
    const visual = new CharacterVisual('mob_elemental', 0xffffff, 0);
    let farLod: THREE.Mesh | undefined;
    let shadowProxy: THREE.Mesh | undefined;
    visual.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry === prep.idleGeo) farLod = mesh;
      if (mesh.geometry === prep.shadowGeo) shadowProxy = mesh;
    });
    expect(farLod).toBeDefined();
    expect(shadowProxy).toBeDefined();
    expect(shadowProxy?.castShadow).toBe(true);
    visual.dispose();

    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });

  it('reuses the visible idle geometry when every authored mesh casts shadows', async () => {
    vi.resetModules();
    vi.doMock('../src/render/assets/loader', () => ({
      loadGltf: vi.fn(() => Promise.resolve(stubGltf(false))),
      loadHdr: vi.fn(() => new Promise(() => undefined)),
      loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
      releaseGltf: vi.fn(),
    }));

    const { charactersReady, prepareVisual } = await import('../src/render/characters/assets');
    await charactersReady();
    const prep = prepareVisual('mob_elemental');
    expect(prep.shadowGeo).toBe(prep.idleGeo);

    vi.doUnmock('../src/render/assets/loader');
    vi.resetModules();
  });
});

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  loadTexture: vi.fn(),
  releaseGltf: vi.fn(),
  registerPreload: vi.fn(),
}));

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  loadTexture: mocks.loadTexture,
  releaseGltf: mocks.releaseGltf,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Eastbrook Grand Armoury preload', () => {
  it('registers the exact shipping GLB before a browser renderer can build the landmark', async () => {
    vi.stubGlobal('window', { location: { search: '' } });
    vi.stubGlobal('location', { search: '' });
    const scene = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ vertexColors: true });
    stone.name = 'ArmouryStone';
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stone));
    mocks.loadGltf.mockReturnValue(Promise.resolve({ scene }));
    const atlas = new THREE.Texture();
    mocks.loadTexture.mockResolvedValue(atlas);

    const module = await import('../src/render/eastbrook_grand_armoury');

    expect(mocks.loadGltf).toHaveBeenCalledTimes(1);
    expect(mocks.loadGltf).toHaveBeenCalledWith('/models/props/eastbrook_grand_armoury.glb');
    expect(mocks.loadTexture).toHaveBeenCalledTimes(1);
    expect(mocks.loadTexture).toHaveBeenCalledWith('/textures/eastbrook_surface_atlas.webp');
    expect(mocks.registerPreload).toHaveBeenCalledTimes(2);
    const registered = mocks.registerPreload.mock.calls.map(([promise]) => promise);
    expect(registered.every((promise) => promise instanceof Promise)).toBe(true);
    await Promise.all(registered);

    const building = {
      kind: 'inn',
      landmark: 'eastbrook_grand_armoury',
      x: 17.5,
      z: -5.5,
      w: 13,
      d: 9,
      rot: -Math.PI / 2,
    } as const;
    const first = module.eastbrookGrandArmouryInternalsForTest.buildView(building, () => 1.5);
    const second = module.eastbrookGrandArmouryInternalsForTest.buildView(building, () => 1.5);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) throw new Error('preloaded armoury fixture did not build');
    expect(first.group).not.toBe(second.group);
    expect(first.group.position.toArray()).toEqual([17.5, 0.1499999999999999, -5.5]);
    expect(first.group.rotation.y).toBe(-Math.PI / 2);
    expect(first.group.scale.toArray()).toEqual([1, 1, 1]);
    expect(first.cameraTopY).toBe(16.5);
    expect(second.group.position.toArray()).toEqual(first.group.position.toArray());
    expect(second.group.rotation.y).toBe(first.group.rotation.y);
    expect(second.group.scale.toArray()).toEqual(first.group.scale.toArray());
    expect(second.cameraTopY).toBe(first.cameraTopY);

    const uneven = module.eastbrookGrandArmouryInternalsForTest.buildView(building, (x, z) =>
      Math.abs(x - 17) < 1e-8 && Math.abs(z + 4.5) < 1e-8 ? -5 : 1.5,
    );
    expect(uneven).not.toBeNull();
    if (!uneven) throw new Error('uneven-terrain armoury fixture did not build');
    expect(uneven.group.userData.foundationSkirtDepth).toBeCloseTo(5.15, 8);
    expect(uneven.group.userData.foundationSkirtDraws).toBe(1);
    const skirt = uneven.group.getObjectByName('eastbrookGrandArmouryFoundationSkirt');
    expect(skirt).toBeInstanceOf(THREE.Mesh);
    const skirtBounds = new THREE.Box3().setFromObject(skirt as THREE.Mesh);
    expect(skirtBounds.max.x - skirtBounds.min.x).toBeCloseTo(13, 8);
    expect(skirtBounds.max.z - skirtBounds.min.z).toBeCloseTo(9, 8);
    expect(mocks.releaseGltf).toHaveBeenCalledTimes(1);
    expect(mocks.releaseGltf).toHaveBeenCalledWith('/models/props/eastbrook_grand_armoury.glb');
  });
});

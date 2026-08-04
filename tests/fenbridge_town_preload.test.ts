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
  registerDeferredPreload: (start: () => Promise<unknown>) => mocks.registerPreload(start()),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Fenbridge town preload ownership', () => {
  it.each([
    ['Low', '?gfx=low'],
    ['Standard', '?gfx=ultra'],
  ] as const)(
    'preloads all 13 prop templates and leaves the one muster-order lifecycle to quest objects on %s',
    async (_materialPath, search) => {
      vi.stubGlobal('window', { location: { search } });
      vi.stubGlobal('location', { search });
      const scene = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ color: 0x4e5650 });
      material.name = 'FenbridgeOpaque';
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
      mocks.loadGltf.mockResolvedValue({ scene });
      const textureByUrl = new Map(
        [
          '/textures/fenbridge_surface_atlas.webp',
          '/textures/fenbridge_surface_normal.webp',
          '/textures/fenbridge_surface_roughness.webp',
        ].map((url) => [url, new THREE.Texture()] as const),
      );
      const textureDisposeSpies = [...textureByUrl.values()].map((texture) =>
        vi.spyOn(texture, 'dispose'),
      );
      mocks.loadTexture.mockImplementation(
        (url: string, options: { srgb?: boolean } | undefined) => {
          const texture = textureByUrl.get(url) ?? new THREE.Texture();
          if (options?.srgb) texture.colorSpace = THREE.SRGBColorSpace;
          return Promise.resolve(texture);
        },
      );

      const town = await import('../src/render/fenbridge_town');
      expect(town.FENBRIDGE_TOWN_PROP_ASSET_URLS).toHaveLength(13);
      expect(town.FENBRIDGE_TOWN_ASSET_URLS).toHaveLength(14);
      expect(new Set(town.FENBRIDGE_TOWN_ASSET_URLS).size).toBe(14);
      expect(mocks.loadGltf.mock.calls.map(([url]) => url)).toEqual(
        town.FENBRIDGE_TOWN_PROP_ASSET_URLS,
      );
      const textureUrls = mocks.loadTexture.mock.calls.map(([url]) => url);
      expect(textureUrls.filter((url) => url.startsWith('/textures/fenbridge_surface_'))).toEqual([
        '/textures/fenbridge_surface_atlas.webp',
        '/textures/fenbridge_surface_normal.webp',
        '/textures/fenbridge_surface_roughness.webp',
      ]);

      const questUrl = '/models/quest/fenbridge_muster_order.glb';
      const authoredQuestScene = new THREE.Group();
      authoredQuestScene.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(1, 0.2, 0.6),
          new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true }),
        ),
      );
      mocks.loadGltf.mockImplementation((url: string) =>
        Promise.resolve({ scene: url === questUrl ? authoredQuestScene : scene }),
      );
      const quest = await import('../src/render/quest_objects');
      expect(quest.questObjectPreloadInternalsForTest.questObjectUrl.fen_muster_order).toBe(
        questUrl,
      );
      expect(
        quest.questObjectPreloadInternalsForTest.usesLegacyScrollDecoration('fen_muster_order'),
      ).toBe(false);
      expect(
        quest.questObjectPreloadInternalsForTest.usesLegacyScrollDecoration(
          'weathered_ledger_page',
        ),
      ).toBe(true);
      expect(
        quest.questObjectPreloadInternalsForTest.usesSharedSurfaceDetail('fen_muster_order'),
      ).toBe(false);
      expect(quest.questObjectPreloadInternalsForTest.castsDynamicShadow('fen_muster_order')).toBe(
        false,
      );
      expect(mocks.loadGltf.mock.calls.filter(([url]) => url === questUrl)).toHaveLength(1);
      await Promise.all(mocks.registerPreload.mock.calls.map(([promise]) => promise));
      const authoredMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
      });
      authoredMaterial.name = 'FenbridgeOpaque';
      expect(
        (
          quest.questObjectPreloadInternalsForTest.convertMaterial(
            authoredMaterial,
            'fen_muster_order',
          ) as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial
        ).vertexColors,
      ).toBe(false);
      const order = quest.buildGroundQuestObject('fen_muster_order', 101);
      order.group.updateMatrixWorld(true);
      expect(order.height).toBeCloseTo(new THREE.Box3().setFromObject(order.group).max.y, 10);
      expect(order.height).toBeCloseTo(0.27, 6);
      let texturedMeshes = 0;
      order.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        texturedMeshes += 1;
        expect(object.geometry.getAttribute('uv')).not.toBeNull();
        const material = object.material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
        expect(material.map).toBe(textureByUrl.get('/textures/fenbridge_surface_atlas.webp'));
        expect(material.vertexColors).toBe(false);
        if (search === '?gfx=low') {
          expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
        } else {
          expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
          const standard = material as THREE.MeshStandardMaterial;
          expect(standard.normalMap).toBe(
            textureByUrl.get('/textures/fenbridge_surface_normal.webp'),
          );
          expect(standard.roughnessMap).toBe(
            textureByUrl.get('/textures/fenbridge_surface_roughness.webp'),
          );
          expect(standard.metalnessMap).toBe(
            textureByUrl.get('/textures/fenbridge_surface_roughness.webp'),
          );
          expect(standard.roughness).toBe(1);
          expect(standard.metalness).toBe(1);
          expect(standard.normalScale.toArray()).toEqual([0.82, 0.82]);
        }
      });
      expect(texturedMeshes).toBeGreaterThan(0);
      quest.questObjectCacheInternalsForTest.resetProceduralCaches();
      for (const dispose of textureDisposeSpies) expect(dispose).not.toHaveBeenCalled();

      const data = await import('../src/sim/data');
      data.setActiveWorldContent(data.BUILTIN_WORLD);
      const view = town.buildFenbridgeTownView(20_061);
      expect(view.group.name).toBe(town.FENBRIDGE_TOWN_ROOT_NAME);
      const townMaterials = new Set<THREE.Material>();
      view.group.traverse((object) => {
        if (object instanceof THREE.Mesh) townMaterials.add(object.material as THREE.Material);
      });
      expect(townMaterials.size).toBeGreaterThan(0);
      for (const material of townMaterials) {
        const surface = material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
        if (search === '?gfx=low') {
          expect(surface).toBeInstanceOf(THREE.MeshLambertMaterial);
          expect(surface.map).toBe(textureByUrl.get('/textures/fenbridge_surface_atlas.webp'));
          expect(surface.vertexColors).toBe(false);
        } else if (
          surface instanceof THREE.MeshStandardMaterial &&
          surface.emissive.getHex() === 0
        ) {
          expect(surface.map).toBe(textureByUrl.get('/textures/fenbridge_surface_atlas.webp'));
          expect(surface.vertexColors).toBe(false);
          expect(surface.normalMap).toBe(
            textureByUrl.get('/textures/fenbridge_surface_normal.webp'),
          );
          expect(surface.roughnessMap).toBe(
            textureByUrl.get('/textures/fenbridge_surface_roughness.webp'),
          );
          expect(surface.metalnessMap).toBe(
            textureByUrl.get('/textures/fenbridge_surface_roughness.webp'),
          );
          expect(surface.roughness).toBe(1);
          expect(surface.metalness).toBe(1);
        } else {
          expect(surface.map).toBeNull();
          expect(surface.vertexColors).toBe(true);
        }
      }
      for (const texture of textureByUrl.values()) {
        expect(texture.anisotropy).toBe(4);
        expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
        expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
      }
      expect(textureByUrl.get('/textures/fenbridge_surface_atlas.webp')?.colorSpace).toBe(
        THREE.SRGBColorSpace,
      );
      expect(textureByUrl.get('/textures/fenbridge_surface_normal.webp')?.colorSpace).toBe(
        THREE.NoColorSpace,
      );
      expect(textureByUrl.get('/textures/fenbridge_surface_roughness.webp')?.colorSpace).toBe(
        THREE.NoColorSpace,
      );
      expect(mocks.releaseGltf.mock.calls.map(([url]) => url)).toEqual(
        town.FENBRIDGE_TOWN_PROP_ASSET_URLS,
      );
      expect(mocks.releaseGltf).not.toHaveBeenCalledWith(questUrl);
      for (const dispose of textureDisposeSpies) expect(dispose).not.toHaveBeenCalled();
      data.setActiveWorldContent(null);
    },
  );
});

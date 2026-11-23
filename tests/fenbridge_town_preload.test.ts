import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  loadTexture: vi.fn(),
  releaseGltf: vi.fn(),
  registerPreload: vi.fn(),
}));

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  loadTexture: mocks.loadTexture,
  // The surface-detail families (worn_stone.ts, pulled in transitively) load
  // their compressed siblings; share the mock so their calls land in the same
  // stream the prefix filters below already ignore.
  loadKtx2Texture: mocks.loadTexture,
  releaseGltf: mocks.releaseGltf,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
  // Deferred lane: start the thunk immediately so these registration-order and
  // asset-set assertions observe the same promises the eager lane produced.
  registerDeferredPreload: (start: () => Promise<unknown>) => mocks.registerPreload(start()),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

/** The painted model a URL names, whichever look folder it ships in. */
function paintedModelName(url: string): string | null {
  return /\/tidehold\/(?:fenrire\/)?([a-z_]+)\.glb$/.exec(url)?.[1] ?? null;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

/** A one-box model scene, as the mocked loader hands it back. */
function boxScene(): THREE.Group {
  const scene = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x4e5650 });
  material.name = 'FenbridgeOpaque';
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  return scene;
}

/** The URLs the town extracts into its vertex-colour batches, in preload order. */
const TEMPLATE_URLS = [
  FENBRIDGE_LAYOUT.civic.cistern.assetId,
  FENBRIDGE_LAYOUT.civic.provisionStall.assetId,
  FENBRIDGE_LAYOUT.civic.musterBoard.assetId,
  FENBRIDGE_LAYOUT.repeated.boardwalks[0].assetId,
];

/** The ring models the walled town drew. Fenbridge stands open now: neither is
 *  preloaded or requested here, and both stay shipped for Studio. */
const RETIRED_RING_URLS = [
  '/models/props/fenbridge_palisade_wing.glb',
  '/models/props/fenbridge_gate_arch.glb',
] as const;

describe('Fenbridge town preload ownership', () => {
  // Re-pinned for the painted town: five placed Tidehold buildings replaced the
  // seven template shells (src/render/eastbrook_placed_building.ts), the shape
  // tests/eastbrook_town_preload.test.ts pins for Eastbrook. A painted
  // building's URL names the MODEL and stays the key everything is looked up
  // by; the FILE it is read from follows the profile's texture tier
  // (prepareTownSource in src/render/fenbridge_town.ts), so the third column is
  // the file suffix the five buildings load with: the half-size maps on Low,
  // the model's own file on Standard.
  it.each([
    ['Low', '?gfx=low', '.half.glb'],
    ['Standard', '?gfx=ultra', '.glb'],
  ] as const)(
    'preloads the five painted buildings at the %s texture tier beside four prop templates and leaves the muster order to quest objects',
    async (tier, search, placedFileSuffix) => {
      vi.stubGlobal('window', { location: { search } });
      vi.stubGlobal('location', { search });
      const scene = boxScene();
      const sourceMaterial = meshesOf(scene)[0].material as THREE.Material;
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
      const propUrls = [...town.FENBRIDGE_TOWN_PROP_ASSET_URLS];
      const buildingUrls = [...town.fenbridgeTownInternalsForTest.buildingAssetUrls];
      // The seven template shells (fenbridge_*.glb, the tannery and the scout
      // lodge among them) left the set and the five painted models arrived,
      // one per layout row, so the prop set went 13 to 11 and, with the muster
      // order, the whole set 14 to 12. Re-pinned for the open town: the
      // palisade wing and the gate arch left with the ring, so the prop set is
      // 9 and the whole set 10.
      expect(propUrls).toHaveLength(9);
      expect(town.FENBRIDGE_TOWN_ASSET_URLS).toHaveLength(10);
      expect(new Set(town.FENBRIDGE_TOWN_ASSET_URLS).size).toBe(10);
      for (const retired of RETIRED_RING_URLS) {
        expect(town.FENBRIDGE_TOWN_ASSET_URLS, retired).not.toContain(retired);
      }
      expect(buildingUrls).toEqual(FENBRIDGE_LAYOUT.buildings.map((building) => building.assetId));
      expect(buildingUrls.map(paintedModelName)).toEqual([
        'house_a',
        'tavern',
        'hall',
        'shop_b',
        'shop_a',
      ]);
      expect(propUrls).toEqual([...buildingUrls, ...TEMPLATE_URLS]);
      expect(TEMPLATE_URLS.map(paintedModelName)).toEqual(TEMPLATE_URLS.map(() => null));
      // One deferred preload per URL, in URL order, each registered the moment
      // its thunk starts the load. Only the painted buildings swap the FILE for
      // their texture tier (placedTextureTierPath); every template prop loads
      // its own URL on every tier, and the quest URL is never loaded here.
      const expectedFiles = propUrls.map((url) =>
        buildingUrls.includes(url) ? url.replace(/\.glb$/, placedFileSuffix) : url,
      );
      const loadedFiles = mocks.loadGltf.mock.calls.map(([url]) => url);
      expect(loadedFiles).toEqual(expectedFiles);
      for (const retired of RETIRED_RING_URLS) {
        expect(loadedFiles, retired).not.toContain(retired);
      }
      expect(loadedFiles.filter((file) => file.endsWith('.half.glb'))).toHaveLength(
        tier === 'Low' ? buildingUrls.length : 0,
      );
      const registrationOrders = new Set(mocks.registerPreload.mock.invocationCallOrder);
      for (const order of mocks.loadGltf.mock.invocationCallOrder) {
        expect(registrationOrders).toContain(order + 1);
      }
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
      // Each painted building was found under its MODEL url, whichever tier
      // file it was read from, and stood on its own clone of the loaded
      // model's material: never the template batches' town atlas.
      const buildingMeshes = new Set<THREE.Mesh>();
      for (const building of FENBRIDGE_LAYOUT.buildings) {
        const group = view.group.getObjectByName(`fenbridgeBuilding:${building.id}`);
        expect(group, building.id).toBeInstanceOf(THREE.Group);
        expect(group?.userData.assetUrl, building.id).toBe(building.assetId);
        const meshes = meshesOf(group as THREE.Object3D);
        expect(meshes, building.id).toHaveLength(1);
        for (const mesh of meshes) {
          buildingMeshes.add(mesh);
          const own = mesh.material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
          expect(own, building.id).not.toBe(sourceMaterial);
          expect(own.name, building.id).toBe('FenbridgeOpaque');
          expect(own, building.id).toBeInstanceOf(
            search === '?gfx=low' ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial,
          );
          expect(own.map, building.id).toBeNull();
        }
      }
      expect(new Set([...buildingMeshes].map((mesh) => mesh.material)).size).toBe(
        FENBRIDGE_LAYOUT.buildings.length,
      );
      const townMaterials = new Set<THREE.Material>();
      view.group.traverse((object) => {
        if (object instanceof THREE.Mesh && !buildingMeshes.has(object)) {
          townMaterials.add(object.material as THREE.Material);
        }
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
      // Only the four assets the vertex-colour bake copies out of are released.
      // The painted buildings keep their GLB cache entries resident: every
      // clone draws the maps of its model's loader-cache scene, so releasing
      // one would break a later same-page rebuild. The quest renderer owns the
      // muster order's lifecycle.
      expect(mocks.releaseGltf.mock.calls.map(([url]) => url)).toEqual(TEMPLATE_URLS);
      expect(mocks.releaseGltf).not.toHaveBeenCalledWith(questUrl);
      // A rebuild on the same page finds every painted building again, still
      // under its model url, and releases nothing more.
      const rebuilt = town.buildFenbridgeTownView(20_061);
      for (const building of FENBRIDGE_LAYOUT.buildings) {
        const group = rebuilt.group.getObjectByName(`fenbridgeBuilding:${building.id}`);
        expect(group, building.id).toBeInstanceOf(THREE.Group);
        expect(group?.userData.assetUrl, building.id).toBe(building.assetId);
      }
      expect(mocks.releaseGltf.mock.calls.map(([url]) => url)).toEqual(TEMPLATE_URLS);
      for (const dispose of textureDisposeSpies) expect(dispose).not.toHaveBeenCalled();
      data.setActiveWorldContent(null);
    },
  );

  it('re-reads only the painted buildings at a new texture tier and drops each file it retires', async () => {
    // Added for the painted town: prepareFenbridgeTownProfileAssets is the
    // graphics-profile preparer (src/render/assets/graphics_profile.ts), called
    // with the TARGET profile before the live settings switch, and
    // resetFenbridgeTownProfileCaches its derived-cache reset.
    vi.stubGlobal('window', { location: { search: '?gfx=ultra' } });
    vi.stubGlobal('location', { search: '?gfx=ultra' });
    // One scene per FILE, so a building's geometry says which file stood it.
    const sceneByFile = new Map<string, THREE.Group>();
    mocks.loadGltf.mockImplementation((file: string) => {
      const scene = boxScene();
      sceneByFile.set(file, scene);
      return Promise.resolve({ scene });
    });
    mocks.loadTexture.mockImplementation(() => Promise.resolve(new THREE.Texture()));
    const town = await import('../src/render/fenbridge_town');
    await Promise.all(mocks.registerPreload.mock.calls.map(([promise]) => promise));
    const buildingUrls = [...town.fenbridgeTownInternalsForTest.buildingAssetUrls];
    const halfFile = (url: string): string => url.replace(/\.glb$/, '.half.glb');
    // Standard read every painted building's own file at boot.
    expect(mocks.loadGltf.mock.calls.map(([file]) => file)).toEqual([
      ...buildingUrls,
      ...TEMPLATE_URLS,
    ]);

    const data = await import('../src/sim/data');
    data.setActiveWorldContent(data.BUILTIN_WORLD);
    const geometryOf = (root: THREE.Object3D, id: string): THREE.BufferGeometry => {
      const group = root.getObjectByName(`fenbridgeBuilding:${id}`);
      if (!group) throw new Error(`the town lost ${id}`);
      return meshesOf(group)[0].geometry;
    };
    const fileGeometry = (file: string): THREE.BufferGeometry => {
      const scene = sceneByFile.get(file);
      if (!scene) throw new Error(`${file} was never loaded`);
      return meshesOf(scene)[0].geometry;
    };
    const full = town.buildFenbridgeTownView(20_061);
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      expect(geometryOf(full.group, building.id), building.id).toBe(fileGeometry(building.assetId));
    }
    expect(mocks.releaseGltf.mock.calls.map(([file]) => file)).toEqual(TEMPLATE_URLS);
    mocks.loadGltf.mockClear();
    mocks.releaseGltf.mockClear();

    // The profile moves to the half tier: only the five painted buildings load
    // again, from their half-size files, and the full file each one replaces
    // leaves the GLB cache. No template prop is loaded or released.
    await town.prepareFenbridgeTownProfileAssets({ placedTextureTier: 'half' });
    expect(mocks.loadGltf.mock.calls.map(([file]) => file)).toEqual(buildingUrls.map(halfFile));
    expect(mocks.releaseGltf.mock.calls.map(([file]) => file)).toEqual(buildingUrls);
    // Asking again for the tier already resident loads and releases nothing.
    await town.prepareFenbridgeTownProfileAssets({ placedTextureTier: 'half' });
    expect(mocks.loadGltf).toHaveBeenCalledTimes(buildingUrls.length);
    expect(mocks.releaseGltf).toHaveBeenCalledTimes(buildingUrls.length);

    // A rebuild keeps the buildings it prepared until the profile reset, which
    // makes the next rebuild re-read each one from the file its new tier
    // loaded; the template batches are extracted once and never re-read.
    const beforeReset = town.buildFenbridgeTownView(20_061);
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      expect(geometryOf(beforeReset.group, building.id), building.id).toBe(
        fileGeometry(building.assetId),
      );
    }
    town.resetFenbridgeTownProfileCaches();
    const half = town.buildFenbridgeTownView(20_061);
    for (const building of FENBRIDGE_LAYOUT.buildings) {
      expect(geometryOf(half.group, building.id), building.id).toBe(
        fileGeometry(halfFile(building.assetId)),
      );
    }
    expect(mocks.loadGltf).toHaveBeenCalledTimes(buildingUrls.length);
    expect(mocks.releaseGltf).toHaveBeenCalledTimes(buildingUrls.length);
    data.setActiveWorldContent(null);
  });
});

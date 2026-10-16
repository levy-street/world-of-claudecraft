import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  loadTexture: vi.fn(),
  releaseGltf: vi.fn(),
  registerPreload: vi.fn(),
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

describe('Eastbrook town preload', () => {
  // Re-pinned 2026-10 for the Tidehold rebuild: six placed buildings replaced
  // the eleven kit shells (src/render/eastbrook_placed_building.ts). A placed
  // building's URL names the MODEL and stays the key everything is looked up
  // by; the FILE it is read from follows the profile's texture tier
  // (townSourceFile in src/render/eastbrook_town.ts), so the third column is
  // the file suffix the six buildings load with: the half-size maps on Low,
  // the model's own file on Standard.
  it.each([
    ['Low', '?gfx=low', '.half.glb'],
    ['Standard', '?gfx=ultra', '.glb'],
  ] as const)(
    'registers all nine shipping assets plus both support models on %s',
    async (_materialPath, search, placedFileSuffix) => {
      vi.stubGlobal('window', { location: { search } });
      vi.stubGlobal('location', { search });
      const scene = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({ vertexColors: true });
      material.name = 'TownOpaque';
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
      const gltfLoad = deferred<{ scene: THREE.Group }>();
      mocks.loadGltf.mockReturnValue(gltfLoad.promise);
      const atlas = new THREE.Texture();
      const textureLoad = deferred<THREE.Texture>();
      mocks.loadTexture.mockReturnValue(textureLoad.promise);

      const module = await import('../src/render/eastbrook_town');
      const allUrls = [...module.EASTBROOK_TOWN_ASSET_URLS];
      const newUrls = [...module.EASTBROOK_TOWN_NEW_ASSET_URLS];
      // Re-pinned for owner refinement round 6: the town gained three coastal
      // buildings, and one of them seats hexb_market.glb, a kit shell
      // Eastbrook had never used, so the deduped URL set grows by exactly one
      // (the other two re-use hexb_home_a and hexb_home_b shells the town
      // already loads).
      // Re-pinned 2026-10 for the Tidehold rebuild: the seven kit shell URLs
      // (eleven lots over seven models) leave and the six painted Tidehold
      // models arrive, one lot each, so the deduped set goes 10 to 9: the six
      // buildings, the monument, the market stall and the wall wing. The two
      // support models make 11.
      expect(newUrls).toHaveLength(9);
      expect(new Set(newUrls).size).toBe(9);
      expect(allUrls).toHaveLength(11);
      const placedUrls = [
        '/models/tidehold/bank.glb',
        '/models/tidehold/smithy.glb',
        '/models/tidehold/tavern.glb',
        '/models/tidehold/hall.glb',
        '/models/tidehold/shop_a.glb',
        '/models/tidehold/house_b.glb',
      ];
      expect(newUrls.slice(0, placedUrls.length)).toEqual(placedUrls);
      expect(allUrls.filter((url) => url.startsWith('/models/tidehold/'))).toEqual(placedUrls);
      expect(allUrls.some((url) => url.startsWith('/models/biome/'))).toBe(false);
      // One load per URL, in URL order. Only the placed buildings swap the
      // FILE for their texture tier; every other asset loads its own URL on
      // every tier.
      const expectedFiles = allUrls.map((url) =>
        placedUrls.includes(url) ? url.replace(/\.glb$/, placedFileSuffix) : url,
      );
      const loadedFiles = mocks.loadGltf.mock.calls.map(([url]) => url);
      expect(loadedFiles).toEqual(expectedFiles);
      expect(loadedFiles[0]).toBe(`/models/tidehold/bank${placedFileSuffix}`);
      expect(loadedFiles.filter((file) => file.endsWith('.half.glb'))).toHaveLength(
        placedFileSuffix === '.half.glb' ? placedUrls.length : 0,
      );
      const eastbrookTextureUrls = [
        '/textures/eastbrook_surface_atlas.webp',
        '/textures/eastbrook_surface_normal.webp',
        '/textures/eastbrook_surface_rough.webp',
      ];
      const registrationOrders = new Set(mocks.registerPreload.mock.invocationCallOrder);
      for (const order of mocks.loadGltf.mock.invocationCallOrder) {
        expect(registrationOrders).toContain(order + 1);
      }
      const eastbrookTextureLoads = mocks.loadTexture.mock.calls
        .map(([url], index) => ({
          url,
          order: mocks.loadTexture.mock.invocationCallOrder[index],
        }))
        .filter(({ url }) => eastbrookTextureUrls.includes(url));
      expect(eastbrookTextureLoads.map(({ url }) => url)).toEqual(eastbrookTextureUrls);
      for (const { order } of eastbrookTextureLoads) {
        expect(registrationOrders).toContain(order + 1);
      }
      const registered = mocks.registerPreload.mock.calls.map(([promise]) => promise);
      let gateSettled = false;
      const gate = Promise.all(registered).then(() => {
        gateSettled = true;
      });
      await Promise.resolve();
      expect(gateSettled).toBe(false);
      gltfLoad.resolve({ scene });
      await Promise.resolve();
      expect(gateSettled).toBe(false);
      textureLoad.resolve(atlas);
      await gate;

      const data = await import('../src/sim/data');
      // A custom world WITHOUT the town: the gate is data-driven
      // (authored_town_gate.ts), so an editor copy that still carries
      // Eastbrook's buildings correctly gets the real town; this arm pins the
      // other side, a world whose maker removed them builds an empty root.
      data.setActiveWorldContent({
        ...data.BUILTIN_WORLD,
        zones: [],
        props: { ...data.BUILTIN_WORLD.props, buildings: [] },
      });
      const custom = module.buildEastbrookTownView(20061);
      expect(custom.group.name).toBe(module.EASTBROOK_TOWN_ROOT_NAME);
      expect(custom.group.children).toEqual([]);
      // Everything that keeps its OWN materials keeps its GLB cache entry
      // resident: the clones share that entry's decoded textures, so releasing
      // it would break a later same-page rebuild (the keepsOwnMaterials path in
      // eastbrook_town.ts, docs/design/eastbrook-revamp/site-plan.md). That is
      // the five kit buildings, whose clones share decoded KTX2 palette
      // textures, plus the Realm Builder monument, which is off the merged
      // micro-batch precisely so it can keep its baked albedo.
      // Re-pinned 2026-10 for the Tidehold rebuild: the kit buildings are gone
      // from the town's set and the six placed buildings take their place in
      // this rule, for the same reason: every clone draws the painted atlases
      // of its model's loader-cache scene. What is left to release is the four
      // assets the vertex-colour bake copies out of: the stall, the wall wing,
      // the bench and the fence.
      const keepsOwnMaterials = (url: string): boolean =>
        url.startsWith('/models/tidehold/') || url === EASTBROOK_LAYOUT.civic.monument.assetId;
      expect(allUrls.filter(keepsOwnMaterials)).toEqual([
        ...placedUrls,
        EASTBROOK_LAYOUT.civic.monument.assetId,
      ]);
      const released = allUrls.filter((url) => !keepsOwnMaterials(url));
      expect(released).toEqual([
        EASTBROOK_LAYOUT.market.stalls[0].assetId,
        EASTBROOK_LAYOUT.wall.assetId,
        EASTBROOK_LAYOUT.civic.benches[0].assetId,
        EASTBROOK_LAYOUT.fences[0].assetId,
      ]);
      expect(mocks.releaseGltf.mock.calls.map(([url]) => url)).toEqual(released);

      data.setActiveWorldContent(data.BUILTIN_WORLD);
      const first = module.buildEastbrookTownView(20061);
      const second = module.buildEastbrookTownView(20061);
      expect(first.group.name).toBe(module.EASTBROOK_TOWN_ROOT_NAME);
      expect(second.group.name).toBe(module.EASTBROOK_TOWN_ROOT_NAME);
      expect(first.group).not.toBe(second.group);
      // Both rebuilds found every placed building's source under its MODEL
      // url, whichever tier file it was read from, and stood it: the group
      // names the model, never the tier file.
      for (const view of [first, second]) {
        for (const building of EASTBROOK_LAYOUT.buildings) {
          const group = view.group.getObjectByName(`eastbrookBuilding:${building.id}`);
          expect(group, building.id).toBeInstanceOf(THREE.Group);
          expect(group?.userData.assetUrl, building.id).toBe(building.assetId);
          expect(placedUrls).toContain(building.assetId);
        }
      }
      // The six placed buildings keep their GLB cache entries resident: their
      // clones share the model's painted atlases, so releasing would break a
      // later same-page rebuild (the placed path in eastbrook_town.ts and
      // eastbrook_placed_building.ts). No tier file is released either: the
      // tier never changed under this page.
      expect(mocks.releaseGltf.mock.calls.map(([url]) => url)).toEqual(released);
      data.setActiveWorldContent(null);
    },
  );
});

// Mount program prewarm (#2571): mounts had ZERO prewarm coverage before this
// module existed, so the first sighting of any mount (yours or another
// player's) could freeze a live frame, worse still on hardware without
// KHR_parallel_shader_compile, where the runtime fallback gate
// (gateSwapFlagOnCompile) is a no-op. Pins the catalog-derived key list (no
// separate hand-maintained list to drift, unlike the gap this module closes)
// and the hidden, off-screen, prewarm-tagged rig contract renderer.ts's
// vfx.mount-programs manifest entry stages and compiles.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import { MOUNT_VISUAL_SPECS } from '../src/render/mount_visuals';
import { MOUNT_KEYS } from '../src/sim/content/mounts';

function stubGltf(): { scene: THREE.Group; animations: THREE.AnimationClip[] } {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  scene.add(mesh);
  return { scene, animations: [] };
}

async function importMountPrewarm(loadGltf: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf,
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    loadKtx2Texture: vi.fn(() => Promise.resolve(new THREE.Texture())),
    releaseGltf: vi.fn(),
  }));
  const { charactersReady, mountAssetsReady } = await import('../src/render/characters/assets');
  await charactersReady();
  const mountPrewarm = await import('../src/render/mount_prewarm');
  return { ...mountPrewarm, mountAssetsReady };
}

describe('mountPrewarmKeys', () => {
  it('covers every catalog MountKey, derived rather than hand-listed', async () => {
    const { mountPrewarmKeys } = await importMountPrewarm(vi.fn(() => Promise.resolve(stubGltf())));
    expect(mountPrewarmKeys().sort()).toEqual([...MOUNT_KEYS].sort());
  });
});

describe('buildMountPrewarmVisual', () => {
  it('lazily fetches the mount GLB and builds a hidden, off-screen, prewarm-tagged rig', async () => {
    const loadGltf = vi.fn(() => Promise.resolve(stubGltf()));
    const { buildMountPrewarmVisual, mountPrewarmKeys } = await importMountPrewarm(loadGltf);
    const [key] = mountPrewarmKeys();
    const visual = await buildMountPrewarmVisual(key);
    expect(visual).not.toBeNull();
    expect(visual?.root.name).toBe(`prewarm-mount:${key}`);
    expect(visual?.root.position.toArray()).toEqual([0, -1000, 0]);
    expect(visual?.root.userData.renderCategory).toBe('prewarm');
    // Nothing preloaded this mount before the call: the lazy fetch actually ran.
    expect(loadGltf).toHaveBeenCalled();
  });

  it('returns null, never throws, when the mount asset never arrives', async () => {
    // The reject only takes effect AFTER import/charactersReady have already
    // resolved every URL successfully, and the target key is one charactersReady()
    // has not already warmed: the failure is isolated to the one fetch this
    // test actually exercises, never the module's own boot.
    const loadGltf = vi.fn((_url: string) => Promise.resolve(stubGltf()));
    const { buildMountPrewarmVisual, mountPrewarmKeys, mountAssetsReady } =
      await importMountPrewarm(loadGltf);
    const key = mountPrewarmKeys().find(
      (candidate) => !mountAssetsReady(MOUNT_VISUAL_SPECS[candidate].visualKey),
    );
    if (!key) throw new Error('every mount asset is already resident after charactersReady()');
    const failingUrl = VISUALS[MOUNT_VISUAL_SPECS[key].visualKey]?.url;
    expect(failingUrl).toBeTruthy();
    loadGltf.mockImplementation((url: string) =>
      url === failingUrl ? Promise.reject(new Error('network down')) : Promise.resolve(stubGltf()),
    );
    await expect(buildMountPrewarmVisual(key)).resolves.toBeNull();
    expect(loadGltf).toHaveBeenCalledWith(failingUrl);
  });

  it('times out a stalled lazy fetch without waiting forever', async () => {
    const loadGltf = vi.fn((_url: string) => Promise.resolve(stubGltf()));
    const { buildMountPrewarmVisual, mountPrewarmKeys, mountAssetsReady } =
      await importMountPrewarm(loadGltf);
    const key = mountPrewarmKeys().find(
      (candidate) => !mountAssetsReady(MOUNT_VISUAL_SPECS[candidate].visualKey),
    );
    if (!key) throw new Error('every mount asset is already resident after charactersReady()');
    const stalledUrl = VISUALS[MOUNT_VISUAL_SPECS[key].visualKey]?.url;
    expect(stalledUrl).toBeTruthy();
    loadGltf.mockImplementation((url: string) =>
      url === stalledUrl ? new Promise(() => undefined) : Promise.resolve(stubGltf()),
    );

    vi.useFakeTimers();
    try {
      const visual = buildMountPrewarmVisual(key);
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(visual).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(loadGltf).toHaveBeenCalledWith(stalledUrl);
  });

  it('evicts a rejected fetch so a later sighting of the same mount can retry', async () => {
    const loadGltf = vi.fn((_url: string) => Promise.resolve(stubGltf()));
    const { buildMountPrewarmVisual, mountPrewarmKeys, mountAssetsReady } =
      await importMountPrewarm(loadGltf);
    const key = mountPrewarmKeys().find(
      (candidate) => !mountAssetsReady(MOUNT_VISUAL_SPECS[candidate].visualKey),
    );
    if (!key) throw new Error('every mount asset is already resident after charactersReady()');
    const failingUrl = VISUALS[MOUNT_VISUAL_SPECS[key].visualKey]?.url;
    expect(failingUrl).toBeTruthy();
    loadGltf.mockImplementation((url: string) =>
      url === failingUrl ? Promise.reject(new Error('network down')) : Promise.resolve(stubGltf()),
    );
    await expect(buildMountPrewarmVisual(key)).resolves.toBeNull();
    const failingCalls = loadGltf.mock.calls.filter(([url]) => url === failingUrl).length;
    expect(failingCalls).toBe(1);
    loadGltf.mockImplementation(() => Promise.resolve(stubGltf()));
    const visual = await buildMountPrewarmVisual(key);
    expect(visual).not.toBeNull();
    const totalCalls = loadGltf.mock.calls.filter(([url]) => url === failingUrl).length;
    expect(totalCalls).toBe(2);
  });
});

describe('stageMountPrewarmVisual', () => {
  it('creates and adds the shared group to the scene on first use, then reuses it', async () => {
    const loadGltf = vi.fn(() => Promise.resolve(stubGltf()));
    const { stageMountPrewarmVisual, mountPrewarmKeys } = await importMountPrewarm(loadGltf);
    const [keyA, keyB] = mountPrewarmKeys();
    const scene = new THREE.Scene();

    const first = await stageMountPrewarmVisual(scene, null, keyA);
    expect(first).not.toBeNull();
    // The group is the ONLY thing ever added directly to the scene; the rig
    // is parented into the group, never into the scene alongside it (the
    // bug: Object3D.add reparents its argument, so adding a rig to both the
    // group and the scene silently detached it from the group).
    expect(scene.children).toEqual([first?.group]);
    expect(first?.visual.root.parent).toBe(first?.group);

    const second = await stageMountPrewarmVisual(scene, first?.group ?? null, keyB);
    expect(second?.group).toBe(first?.group);
    // Still only one child of the scene: the group was not re-added.
    expect(scene.children).toEqual([first?.group]);
    expect(first?.group.children).toEqual([first?.visual.root, second?.visual.root]);
  });

  it('returns null and leaves the group untouched when the mount asset never arrives', async () => {
    const loadGltf = vi.fn((_url: string) => Promise.resolve(stubGltf()));
    const { stageMountPrewarmVisual, mountPrewarmKeys, mountAssetsReady } =
      await importMountPrewarm(loadGltf);
    const key = mountPrewarmKeys().find(
      (candidate) => !mountAssetsReady(MOUNT_VISUAL_SPECS[candidate].visualKey),
    );
    if (!key) throw new Error('every mount asset is already resident after charactersReady()');
    const failingUrl = VISUALS[MOUNT_VISUAL_SPECS[key].visualKey]?.url;
    expect(failingUrl).toBeTruthy();
    loadGltf.mockImplementation((url: string) =>
      url === failingUrl ? Promise.reject(new Error('network down')) : Promise.resolve(stubGltf()),
    );
    const scene = new THREE.Scene();
    const result = await stageMountPrewarmVisual(scene, null, key);
    expect(result).toBeNull();
    expect(scene.children).toEqual([]);
  });

  it('resident-only staging never starts a missing mount fetch', async () => {
    const loadGltf = vi.fn((_url: string) => Promise.resolve(stubGltf()));
    const { stageResidentMountPrewarmVisual, mountPrewarmKeys, mountAssetsReady } =
      await importMountPrewarm(loadGltf);
    const key = mountPrewarmKeys().find(
      (candidate) => !mountAssetsReady(MOUNT_VISUAL_SPECS[candidate].visualKey),
    );
    if (!key) throw new Error('every mount asset is already resident after charactersReady()');
    const missingUrl = VISUALS[MOUNT_VISUAL_SPECS[key].visualKey]?.url;
    expect(missingUrl).toBeTruthy();
    loadGltf.mockClear();
    loadGltf.mockImplementation((url: string) =>
      url === missingUrl ? new Promise(() => undefined) : Promise.resolve(stubGltf()),
    );

    const scene = new THREE.Scene();
    const result = stageResidentMountPrewarmVisual(scene, null, key);

    expect(result).toBeNull();
    expect(scene.children).toEqual([]);
    expect(loadGltf).not.toHaveBeenCalledWith(missingUrl);
  });
});

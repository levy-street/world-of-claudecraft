import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WocCharacterManifest } from '../src/render/characters/woc_character_manifest';

// The assembled HIGH armor pack in the store (woc_armor_packs.ts, 2026-10-03): asking for it
// fetches a set's medium file and its top file together, it is laid together once both are in
// hand, it holds its medium pack resident for as long as it is (a medium pack is never freed
// under a high one), freeing it disposes only what it made, its top parse is let go at once,
// and a failed top fetch leaves the medium file drawing and is asked again after the cooldown.
// Only the loader and the graphics profile are stubbed.

const manifest: WocCharacterManifest = {
  schemaVersion: 1,
  rigId: 'high-pack-fixture',
  fit: 'male',
  baseNodes: ['Character_Body'],
  appearance: {},
  defaultAppearance: {},
  armorSlots: { head: { label: 'Head' }, arms: { label: 'Arms' } },
  items: {
    male_test_helm: { label: 'Helm', slot: 'head', set: 'test', nodes: ['Armor_Test_Helm'] },
    male_test_shoulders: {
      label: 'Shoulders',
      slot: 'arms',
      set: 'test',
      nodes: ['Armor_Test_Shoulder_L'],
    },
  },
  defaultEquipment: { head: 'male_test_helm', arms: 'male_test_shoulders' },
  animationNames: [],
};

function bones(): { root: THREE.Group; spine: THREE.Bone; list: THREE.Bone[] } {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'root';
  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.set(0, 1, 0);
  root.add(hips);
  hips.add(spine);
  root.updateMatrixWorld(true);
  return { root, spine, list: [hips, spine] };
}

function tri(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 1, 0, 0.2, 1.2, 0, -0.2, 1.4, 0], 3),
  );
  g.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  g.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  return g;
}

/** The character: a base body on the rig. */
function model(): THREE.Group {
  const r = bones();
  const body = new THREE.SkinnedMesh(tri(), new THREE.MeshBasicMaterial());
  body.name = 'Character_Body';
  r.root.add(body);
  body.bind(new THREE.Skeleton(r.list));
  return r.root;
}

interface Level {
  data: Uint8Array;
  width: number;
  height: number;
}

function chain(width: number, height: number, levels = 99): Level[] {
  const out: Level[] = [];
  let w = width;
  let h = height;
  while (out.length < levels) {
    out.push({ data: new Uint8Array(Math.max(16, w * h)).fill(w), width: w, height: h });
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return out;
}

function compressed(name: string, levels: Level[]): THREE.CompressedTexture {
  const t = new THREE.CompressedTexture(
    levels as unknown as THREE.CompressedTextureMipmap[],
    levels[0].width,
    levels[0].height,
    THREE.RGBA_ASTC_4x4_Format,
    THREE.UnsignedByteType,
  );
  t.name = name;
  t.minFilter = levels.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** The medium file: a skinned helm and a rigid pad on one material over half-size maps. */
function mediumFile() {
  const r = bones();
  const orm = compressed('full_data_atlas', chain(4, 2));
  const material = new THREE.MeshStandardMaterial({
    name: 'full atlas 0',
    map: compressed('full_color_atlas', chain(8, 4)),
    normalMap: compressed('full_normal_atlas', chain(4, 2)),
    roughnessMap: orm,
    metalnessMap: orm,
    aoMap: orm,
  });
  const helm = new THREE.SkinnedMesh(tri(), material);
  helm.name = 'Armor_Test_Helm';
  r.root.add(helm);
  helm.bind(new THREE.Skeleton(r.list));
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
  pad.name = 'Armor_Test_Shoulder_L';
  r.spine.add(pad);
  return { scene: r.root, animations: [] };
}

/** The top file: one degenerate mesh, one material holding each top level in its slot. */
function topFile() {
  const orm = compressed('full_data_atlas', chain(8, 4, 1));
  const material = new THREE.MeshStandardMaterial({
    name: 'full atlas top',
    map: compressed('full_color_atlas', chain(16, 8, 1)),
    normalMap: compressed('full_normal_atlas', chain(8, 4, 1)),
    roughnessMap: orm,
    metalnessMap: orm,
    aoMap: orm,
  });
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = 'top_levels';
  root.add(mesh);
  return { scene: root, animations: [] };
}

type Parse = { scene: THREE.Object3D; animations: never[] };

/** `throwOnce`: the first assembly throws (a broken file), the next ones run as written. */
async function harness(opts: { throwOnce?: boolean } = {}) {
  vi.resetModules();
  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  const fetches: string[] = [];
  const released: string[] = [];
  vi.doMock('../src/render/gfx', () => ({
    GFX: { tier: 'high', constrainedMemory: false, anisotropy: 8, normalAnisotropy: 4 },
  }));
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(
      (url: string) =>
        new Promise((resolve, reject) => {
          fetches.push(url);
          pending.set(url, { resolve, reject });
        }),
    ),
    releaseGltf: vi.fn((url: string) => released.push(url)),
  }));
  if (opts.throwOnce) {
    vi.doMock('../src/render/characters/woc_armor_top_levels', async () => {
      const actual = await vi.importActual<
        typeof import('../src/render/characters/woc_armor_top_levels')
      >('../src/render/characters/woc_armor_top_levels');
      let thrown = false;
      return {
        ...actual,
        assembleWocArmorTop: (...args: Parameters<typeof actual.assembleWocArmorTop>) => {
          if (!thrown) {
            thrown = true;
            throw new Error('a broken top file');
          }
          return actual.assembleWocArmorTop(...args);
        },
      };
    });
  }
  const packs = await import('../src/render/characters/woc_armor_packs');
  const core = await import('../src/render/characters/woc_armor_core');
  const dressing = await import('../src/render/characters/woc_armor_dressing');
  const mips = await import('../src/render/assets/ktx2_mip_release');
  const anisotropy = await import('../src/render/texture_anisotropy');
  mips.ktx2MipReleaseInternalsForTest.reset();
  let now = 0;
  packs.setWocArmorClockForTest(() => now);
  const high = core.wocArmorPackUrl('male', 'test', 'high');
  const medium = core.wocArmorPackUrl('male', 'test', 'medium');
  /** The parse each url landed with last. */
  const parses = new Map<string, Parse>();
  /** The top parse's textures disposed so far, by name. */
  const disposedTop: string[] = [];
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };
  return {
    packs,
    core,
    dressing,
    mips,
    anisotropy,
    high,
    medium,
    fetches,
    released,
    parses,
    advance: (ms: number) => {
      now += ms;
    },
    disposedTop,
    land: async (url: string) => {
      const parse = url === high ? topFile() : mediumFile();
      if (url === high) {
        for (const texture of contents(parse.scene).textures) {
          texture.addEventListener('dispose', () => disposedTop.push(texture.name));
        }
      }
      parses.set(url, parse);
      const settle = pending.get(url);
      pending.delete(url);
      settle?.resolve(parse);
      await flush();
    },
    fail: async (url: string) => {
      const settle = pending.get(url);
      pending.delete(url);
      settle?.reject(new Error('offline'));
      await flush();
    },
    pending,
  };
}

/** Every texture a scene's materials draw, and every material and geometry, for spying. */
function contents(scene: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    const material = mesh.material as THREE.Material;
    materials.add(material);
    for (const value of Object.values(material)) {
      if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
    }
  });
  return { materials, textures, geometries };
}

/** Count `dispose` calls on everything a scene draws. */
function watchDisposal(scene: THREE.Object3D) {
  const c = contents(scene);
  const spies = [...c.materials, ...c.textures, ...c.geometries].map((o) => vi.spyOn(o, 'dispose'));
  return { ...c, disposed: () => spies.reduce((n, s) => n + s.mock.calls.length, 0) };
}

const meshNamed = (root: THREE.Object3D, name: string) => root.getObjectByName(name) as THREE.Mesh;

afterEach(() => {
  vi.doUnmock('../src/render/gfx');
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/characters/woc_armor_top_levels');
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('the assembled high armor pack', () => {
  it('fetches the top file and the medium file together and lays the top levels over the medium maps', async () => {
    const h = await harness();
    const ready: string[] = [];
    h.packs.onWocArmorPackReady((url) => ready.push(url));
    h.packs.ensureWocArmorPack(h.high);
    expect(h.high.endsWith('/armor/male_test_top.glb')).toBe(true);
    expect([...h.fetches].sort()).toEqual([h.medium, h.high].sort());
    // the medium pack is the high pack's from the ask on
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(1);
    // the top levels land first: nothing to lay them over yet
    await h.land(h.high);
    expect(h.packs.wocArmorPackResident(h.high)).toBe(false);
    expect(h.released).toEqual([]);
    await h.land(h.medium);
    expect(ready).toEqual([h.medium, h.high]);
    expect(h.packs.wocArmorPackResident(h.high)).toBe(true);
    expect(h.packs.wocArmorPackGeneration(h.high)).toBeGreaterThan(
      h.packs.wocArmorPackGeneration(h.medium),
    );
    // the top parse is let go at once: its cache entry and what the loader made for it, its
    // level 0 data living on in the combined textures
    expect(h.released).toEqual([h.high]);
    expect([...h.disposedTop].sort()).toEqual([
      'full_color_atlas',
      'full_data_atlas',
      'full_normal_atlas',
    ]);
    const top = contents(h.parses.get(h.high)?.scene as THREE.Object3D);
    for (const texture of top.textures) {
      expect((texture as THREE.CompressedTexture).mipmaps[0].data.length).toBeGreaterThan(0);
    }
    // a character wears it like any pack: the medium file's parts on the full maps
    const body = model();
    const container = h.packs.attachWocArmorPack(body, h.high, 'test', manifest);
    expect(container).not.toBeNull();
    const helm = meshNamed(body, 'Armor_Test_Helm');
    const pad = meshNamed(body, 'Armor_Test_Shoulder_L');
    const mediumHelm = meshNamed(
      h.parses.get(h.medium)?.scene as THREE.Object3D,
      'Armor_Test_Helm',
    );
    const mediumMaterial = mediumHelm.material as THREE.MeshStandardMaterial;
    const material = helm.material as THREE.MeshStandardMaterial;
    expect(material).not.toBe(mediumMaterial);
    expect(pad.material).toBe(material);
    expect(h.packs.wocArmorFileMaterial(helm)).toBe(material);
    const map = material.map as THREE.CompressedTexture;
    expect(map.image).toEqual({ width: 16, height: 8 });
    expect(map.mipmaps.slice(1)).toEqual((mediumMaterial.map as THREE.CompressedTexture).mipmaps);
    expect((material.normalMap as THREE.CompressedTexture).image).toEqual({ width: 8, height: 4 });
    expect(material.aoMap).toBe(material.roughnessMap);
    // the rigid part draws the medium parse's own geometry; the skinned part a rebake of it
    expect(pad.geometry).toBe(
      meshNamed(h.parses.get(h.medium)?.scene as THREE.Object3D, 'Armor_Test_Shoulder_L').geometry,
    );
    expect(helm.geometry).not.toBe(mediumHelm.geometry);
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(1);
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(1);
  });

  it('keeps the full maps CPU levels resident like every character texture, with the tier anisotropy', async () => {
    const h = await harness();
    // the game entry's opt-in: world-only textures drop their CPU levels after an upload
    h.mips.enableKtx2MipRelease(() => false);
    h.packs.ensureWocArmorPack(h.high);
    await h.land(h.medium);
    await h.land(h.high);
    const body = model();
    h.packs.attachWocArmorPack(body, h.high, 'test', manifest);
    const material = meshNamed(body, 'Armor_Test_Helm').material as THREE.MeshStandardMaterial;
    const map = material.map as THREE.CompressedTexture & {
      onUpdate: ((t: unknown) => void) | null;
    };
    // a preview renderer uploads these on its own context too: an upload keeps every level
    map.onUpdate?.(map);
    expect(h.mips.ktx2MipReleaseInternalsForTest.stateOf(map)).toBeNull();
    for (const level of map.mipmaps) expect(level.data.length).toBeGreaterThan(0);
    expect(map.source.dataReady).toBe(true);
    // the loader's polish on the textures it never saw, registered for a later budget
    expect(map.anisotropy).toBe(8);
    expect(material.normalMap?.anisotropy).toBe(4);
    const registered = h.anisotropy.textureAnisotropyInternalsForTest
      .registrations()
      .map((r) => r.ref.deref());
    expect(registered).toContain(map);
    expect(registered).toContain(material.normalMap);
  });

  it('frees itself first and only what it made, then the medium file after its own window', async () => {
    const h = await harness();
    h.packs.ensureWocArmorPack(h.high);
    await h.land(h.medium);
    await h.land(h.high);
    const body = model();
    const container = h.packs.attachWocArmorPack(body, h.high, 'test', manifest);
    const helm = meshNamed(body, 'Armor_Test_Helm');
    const own = watchDisposal(body);
    const prepared = vi.spyOn(helm.geometry, 'dispose');
    const mediumScene = h.parses.get(h.medium)?.scene as THREE.Object3D;
    const medium = watchDisposal(mediumScene);
    // the pad is the medium parse's geometry: not the high pack's to free
    expect(medium.geometries.has(meshNamed(body, 'Armor_Test_Shoulder_L').geometry)).toBe(true);
    h.packs.releaseWocArmorContainer(container as THREE.Object3D);
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(0);
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([h.high]);
    expect(h.packs.wocArmorPackResident(h.high)).toBe(false);
    // what it made: its material clone, its combined textures, its prepared geometry
    expect(prepared).toHaveBeenCalled();
    const material = helm.material as THREE.MeshStandardMaterial;
    expect(own.materials.has(material)).toBe(true);
    expect(own.disposed()).toBeGreaterThanOrEqual(5);
    // ...and nothing of the medium file's, which only now starts its own idle window
    expect(medium.disposed()).toBe(0);
    expect(h.packs.wocArmorPackResident(h.medium)).toBe(true);
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(0);
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS - 1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    h.advance(1);
    expect(h.packs.sweepWocArmorPacks()).toEqual([h.medium]);
    expect(medium.disposed()).toBeGreaterThan(0);
    expect(h.released).toEqual([h.high, h.medium]);
  });

  it('never frees the medium file under a high pack: its last wearer leaving frees nothing', async () => {
    const h = await harness();
    h.packs.ensureWocArmorPack(h.high);
    await h.land(h.medium);
    await h.land(h.high);
    // a crowd character on the medium file, the local player on the high pack
    const crowd = model();
    const own = model();
    const mediumWorn = h.packs.attachWocArmorPack(crowd, h.medium, 'test', manifest);
    const highWorn = h.packs.attachWocArmorPack(own, h.high, 'test', manifest);
    const medium = watchDisposal(h.parses.get(h.medium)?.scene as THREE.Object3D);
    h.packs.releaseWocArmorContainer(mediumWorn as THREE.Object3D);
    // the medium file's last wearer is gone, and its pack is still the high pack's
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(1);
    h.advance(100 * h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([]);
    expect(h.packs.wocArmorPackResident(h.medium)).toBe(true);
    expect(medium.disposed()).toBe(0);
    // the local player's armor still draws the medium file's levels below the top one
    const map = (meshNamed(own, 'Armor_Test_Helm').material as THREE.MeshStandardMaterial)
      .map as THREE.CompressedTexture;
    expect(map.mipmaps[1].data.length).toBeGreaterThan(0);
    // the high pack goes first, then the medium file after a window of its own
    h.packs.releaseWocArmorContainer(highWorn as THREE.Object3D);
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([h.high]);
    expect(h.packs.wocArmorPackResident(h.medium)).toBe(true);
    h.advance(h.core.WOC_ARMOR_IDLE_EVICT_MS);
    expect(h.packs.sweepWocArmorPacks()).toEqual([h.medium]);
    expect(medium.disposed()).toBeGreaterThan(0);
  });

  it('never fetches the top file while its medium file waits out a failed fetch', async () => {
    const h = await harness();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.packs.ensureWocArmorPack(h.medium);
    await h.fail(h.medium);
    h.fetches.length = 0;
    // the medium file cools down, and the top file waits for it: neither is fetched
    h.packs.ensureWocArmorPack(h.high);
    expect(h.fetches).toEqual([]);
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(0);
    h.advance(8000);
    h.packs.ensureWocArmorPack(h.high);
    expect([...h.fetches].sort()).toEqual([h.medium, h.high].sort());
    await h.land(h.high);
    await h.land(h.medium);
    expect(h.packs.wocArmorPackResident(h.high)).toBe(true);
  });

  it('gives up on an assembly that throws, never left loading, and assembles on the retry', async () => {
    const h = await harness({ throwOnce: true });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    h.packs.ensureWocArmorPack(h.high);
    await h.land(h.medium);
    await h.land(h.high);
    expect(h.packs.wocArmorPackResident(h.high)).toBe(false);
    // its top parse let go, its hold on the medium file given back, the medium file drawing on
    expect(h.released).toEqual([h.high]);
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(0);
    expect(h.packs.wocArmorPackResident(h.medium)).toBe(true);
    h.fetches.length = 0;
    h.packs.ensureWocArmorPack(h.high);
    expect(h.fetches).toEqual([]); // the cooldown, not a pack stuck loading
    h.advance(8000);
    h.packs.ensureWocArmorPack(h.high);
    expect(h.fetches).toEqual([h.high]);
    await h.land(h.high);
    expect(h.packs.wocArmorPackResident(h.high)).toBe(true);
  });

  it('gives up with its medium file, letting the top parse go, and asks for both after the cooldown', async () => {
    const h = await harness();
    h.packs.ensureWocArmorPack(h.high);
    await h.fail(h.medium);
    // the top levels land with nothing to lay them over
    await h.land(h.high);
    expect(h.packs.wocArmorPackResident(h.high)).toBe(false);
    expect(h.released).toEqual([h.high]);
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(0);
    h.fetches.length = 0;
    h.packs.ensureWocArmorPack(h.high);
    expect(h.fetches).toEqual([]);
    h.advance(8000);
    h.packs.ensureWocArmorPack(h.high);
    expect([...h.fetches].sort()).toEqual([h.medium, h.high].sort());
    await h.land(h.medium);
    await h.land(h.high);
    expect(h.packs.wocArmorPackResident(h.high)).toBe(true);
  });
});

describe('the local player streaming its high pack', () => {
  /** A full-detail character on the high preset; its host reveals at once (no gate). */
  async function dressed() {
    const h = await harness();
    const host = {
      model: model(),
      adopt: vi.fn((_node: THREE.Object3D): void => undefined),
      forget: vi.fn((_node: THREE.Object3D): void => undefined),
      reveal: vi.fn((_node: THREE.Object3D, live?: (prepared: boolean) => void): void => {
        live?.(true);
      }),
      rigDrawn: (): boolean => true,
    };
    const d = new h.dressing.WocArmorDressing(host, manifest);
    d.want(['test']);
    return { h, host, d };
  }

  it('draws the medium file while the top levels stream, then the high pack', async () => {
    const { h, d } = await dressed();
    expect([...h.fetches].sort()).toEqual([h.medium, h.high].sort());
    await h.land(h.medium);
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);
    expect(d.isWaiting).toBe(true);
    await h.land(h.high);
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.high }]);
    expect(d.isWaiting).toBe(false);
    // the medium file's own wearer is gone; the high pack still holds it
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(1);
    expect(h.packs.wocArmorPackRefs(h.high)).toBe(1);
    d.dispose();
  });

  it('keeps the medium file drawing when the top fetch fails, and asks again after the cooldown', async () => {
    const { h, d } = await dressed();
    await h.land(h.medium);
    d.poll();
    await h.fail(h.high);
    expect(d.poll()).toBe(false);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);
    expect(h.packs.wocArmorPackResident(h.medium)).toBe(true);
    // only the stand-in's own reference is left on the medium file
    expect(h.packs.wocArmorPackRefs(h.medium)).toBe(1);
    h.fetches.length = 0;
    h.advance(7999);
    d.poll();
    expect(h.fetches).toEqual([]);
    h.advance(1);
    d.poll();
    expect(h.fetches).toEqual([h.high]);
    await h.land(h.high);
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.high }]);
    d.dispose();
  });

  it('draws a crowd character on the medium file and never fetches the top levels for it', async () => {
    const h = await harness();
    const host = {
      model: model(),
      adopt: vi.fn(),
      forget: vi.fn(),
      reveal: vi.fn((_node: THREE.Object3D, live?: (prepared: boolean) => void) => live?.(true)),
      rigDrawn: () => true,
    };
    const d = new h.dressing.WocArmorDressing(host, manifest, 'crowd');
    d.want(['test']);
    expect(h.fetches).toEqual([h.medium]);
    await h.land(h.medium);
    expect(d.poll()).toBe(true);
    expect(d.attachedFiles).toEqual([{ set: 'test', url: h.medium }]);
    expect(d.isWaiting).toBe(false);
    d.dispose();
  });
});

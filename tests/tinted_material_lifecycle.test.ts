// Lifecycle of the shared tinted-material cache (characters/assets.ts): the
// claims lease keeps every mounted clone pinned (eviction can never dispose a
// material a live mesh draws with), released leases let dead-source keys and
// stale rift colors age out through the bounded idle LRU, and an evicted key
// rebuilds identically from a live source on its next request. Each test
// imports the module fresh (vi.resetModules) so the module-level cache starts
// empty every time.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisualDef } from '../src/render/characters/manifest';
import { TINTED_MATERIAL_IDLE_CACHE_MAX } from '../src/render/characters/tinted_material_cache_core';

type AssetsModule = typeof import('../src/render/characters/assets');
type GfxModule = typeof import('../src/render/gfx');

async function loadAssets(): Promise<{
  assets: AssetsModule;
  restoreGfx: () => void;
}> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: vi.fn(),
    registerDeferredPreload: vi.fn((start: () => unknown) => start()),
  }));
  const gfx = (await import('../src/render/gfx')) as GfxModule;
  const restoreGfx = gfx.gfxInternalsForTest.overrideSettings({ standardMaterials: true });
  const assets = (await import('../src/render/characters/assets')) as AssetsModule;
  return { assets, restoreGfx };
}

afterEach(() => {
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/assets/preload');
  vi.resetModules();
});

/** Track disposals without changing behavior. */
function disposeSpy(mat: THREE.Material) {
  return vi.spyOn(mat, 'dispose');
}

describe('tinted material cache lifecycle', () => {
  it('shares one clone between two leases and keeps it alive until both release (a premature dispose goes red)', async () => {
    const { assets, restoreGfx } = await loadAssets();
    try {
      const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const leaseA: Set<string> = new Set();
      const leaseB: Set<string> = new Set();

      const forA = assets.tintedMaterial(source, 0x336699, 0.4, null, null, 'body', leaseA);
      const forB = assets.tintedMaterial(source, 0x336699, 0.4, null, null, 'body', leaseB);
      // Sharing pin: two visuals with the same (source, tint) share one clone.
      expect(forB).toBe(forA);
      expect(leaseA).toEqual(leaseB);
      const spy = disposeSpy(forA);

      // Visual A goes away; B still mounts the clone. Flood the idle LRU far
      // past its bound: the claimed entry must survive untouched.
      assets.releaseTintedMaterials(leaseA);
      for (let i = 0; i < TINTED_MATERIAL_IDLE_CACHE_MAX * 2; i++) {
        assets.tintedMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff }), i, 0.4);
      }
      expect(spy).not.toHaveBeenCalled();
      // Still served shared for a third lease.
      const leaseC: Set<string> = new Set();
      expect(assets.tintedMaterial(source, 0x336699, 0.4, null, null, 'body', leaseC)).toBe(forA);

      // Last mounts release: the entry idles, and idle pressure disposes it.
      assets.releaseTintedMaterials(leaseB);
      assets.releaseTintedMaterials(leaseC);
      for (let i = 0; i < TINTED_MATERIAL_IDLE_CACHE_MAX * 2; i++) {
        assets.tintedMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff }), 0x1000 + i, 0.4);
      }
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      restoreGfx();
    }
  }, 20000);

  it('reclaims and disposes dead-source entries once released (the C3 leak pin)', async () => {
    const { assets, restoreGfx } = await loadAssets();
    try {
      // A source that then "dies" (its owner disposes and drops it, as the
      // recolour LRU does): its key can never be requested again, so the only
      // way out is the idle LRU.
      const dying = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const lease: Set<string> = new Set();
      const clone = assets.tintedMaterial(dying, 0x883311, 0.4, null, null, 'body', lease);
      const spy = disposeSpy(clone);
      assets.releaseTintedMaterials(lease);
      dying.dispose();

      const before = assets.tintedMaterialInternalsForTest.cacheSize();
      expect(before).toBe(1);
      for (let i = 0; i < TINTED_MATERIAL_IDLE_CACHE_MAX * 2; i++) {
        assets.tintedMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff }), i, 0.4);
      }
      // The dead-source clone was disposed and the cache is bounded.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(assets.tintedMaterialInternalsForTest.cacheSize()).toBeLessThanOrEqual(
        TINTED_MATERIAL_IDLE_CACHE_MAX,
      );
    } finally {
      restoreGfx();
    }
  }, 20000);

  it('keeps the cache bounded while rift colors cycle through the acquire-time retint path', async () => {
    const { assets, restoreGfx } = await loadAssets();
    try {
      // The C1 residual: pooled reuse re-tints per instance, so every distinct
      // rift color used to mint a permanently retained clone set. Simulate the
      // exact applySkinMaterials sequence: claim the new color's sweep into a
      // fresh lease, then release the previous lease.
      const body = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      const root = new THREE.Group();
      root.add(body);
      const def = { tint: 'entity', tintStrength: 0.35 } as VisualDef;

      const colors = Array.from(
        { length: TINTED_MATERIAL_IDLE_CACHE_MAX + 40 },
        (_, i) => 0x100000 + i * 37,
      );
      const spies: ReturnType<typeof disposeSpy>[] = [];
      let lease: Set<string> = new Set();
      for (const color of colors) {
        const next: Set<string> = new Set();
        assets.applyMaterials(root, def, color, null, null, next);
        spies.push(disposeSpy(body.material as THREE.Material));
        assets.releaseTintedMaterials(lease);
        lease = next;
      }

      // Bounded: one live color plus at most the idle bound stays resident.
      expect(assets.tintedMaterialInternalsForTest.cacheSize()).toBeLessThanOrEqual(
        TINTED_MATERIAL_IDLE_CACHE_MAX + 1,
      );
      // The oldest colors' clones were genuinely disposed...
      expect(spies[0]).toHaveBeenCalledTimes(1);
      expect(spies[1]).toHaveBeenCalledTimes(1);
      // ...while the mounted (current color) clone was not.
      expect(spies[spies.length - 1]).not.toHaveBeenCalled();
    } finally {
      restoreGfx();
    }
  }, 20000);

  it('rebuilds an evicted entry identically when re-requested with a live source (transparency pin)', async () => {
    const { assets, restoreGfx } = await loadAssets();
    try {
      const source = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        roughness: 0.2,
        name: 'body_cloth',
      });
      const lease: Set<string> = new Set();
      const first = assets.tintedMaterial(
        source,
        0x336699,
        0.4,
        null,
        null,
        'body',
        lease,
      ) as THREE.MeshStandardMaterial;
      const firstHex = first.color.getHex();
      const firstRoughness = first.roughness;
      assets.releaseTintedMaterials(lease);
      for (let i = 0; i < TINTED_MATERIAL_IDLE_CACHE_MAX * 2; i++) {
        assets.tintedMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff }), i, 0.4);
      }

      const rebuilt = assets.tintedMaterial(source, 0x336699, 0.4) as THREE.MeshStandardMaterial;
      // A genuinely fresh clone (the old one was evicted and disposed)...
      expect(rebuilt).not.toBe(first);
      // ...that is derived identically: same tint lerp, same roughness clamp.
      expect(rebuilt.color.getHex()).toBe(firstHex);
      expect(rebuilt.roughness).toBe(firstRoughness);
      expect(rebuilt.type).toBe(first.type);
    } finally {
      restoreGfx();
    }
  }, 20000);

  it('claims idempotently per lease: one sweep meeting a source twice claims once and releases cleanly', async () => {
    const { assets, restoreGfx } = await loadAssets();
    try {
      const source = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const lease: Set<string> = new Set();
      const a = assets.tintedMaterial(source, 0x224466, 0.4, null, null, 'body', lease);
      const b = assets.tintedMaterial(source, 0x224466, 0.4, null, null, 'body', lease);
      expect(b).toBe(a);
      expect(lease.size).toBe(1);
      const spy = disposeSpy(a);

      // One release balances the one claim: the entry idles (evictable), it
      // was not left over-pinned by the duplicate call.
      assets.releaseTintedMaterials(lease);
      for (let i = 0; i < TINTED_MATERIAL_IDLE_CACHE_MAX * 2; i++) {
        assets.tintedMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff }), i, 0.4);
      }
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      restoreGfx();
    }
  }, 20000);

  it('resetCharacterProfileCaches disposes idle clones now and claimed clones only on release', async () => {
    const { assets, restoreGfx } = await loadAssets();
    try {
      const idleSource = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const idleLease: Set<string> = new Set();
      const idleClone = assets.tintedMaterial(
        idleSource,
        0x111111,
        0.4,
        null,
        null,
        'body',
        idleLease,
      );
      const idleSpy = disposeSpy(idleClone);
      assets.releaseTintedMaterials(idleLease);

      const liveSource = new THREE.MeshStandardMaterial({ color: 0xffffff });
      const liveLease: Set<string> = new Set();
      const liveClone = assets.tintedMaterial(
        liveSource,
        0x222222,
        0.4,
        null,
        null,
        'body',
        liveLease,
      );
      const liveSpy = disposeSpy(liveClone);

      assets.resetCharacterProfileCaches();
      // Idle disposed immediately; the mounted clone survives the reset...
      expect(idleSpy).toHaveBeenCalledTimes(1);
      expect(liveSpy).not.toHaveBeenCalled();
      // ...and disposes the moment its visual releases, instead of idling.
      assets.releaseTintedMaterials(liveLease);
      expect(liveSpy).toHaveBeenCalledTimes(1);
      expect(assets.tintedMaterialInternalsForTest.cacheSize()).toBe(0);
    } finally {
      restoreGfx();
    }
  }, 20000);
});

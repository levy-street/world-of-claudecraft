// The Drakelands kit lane end to end, over the real modules with the GLB
// loader faked: which host preloads the kit at boot, the lane that loads it on
// iOS, and the guard that makes the ember features (Wyrmwatch and the
// Forgefather's Isle fortress, whose colliders the sim builds whatever the
// renderer does) refuse to build before the kit is resident.
import type * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createZoneStreamRecheck } from '../src/render/zone_streaming';
import { ZONES } from '../src/sim/data';

const h = vi.hoisted(() => ({
  ios: false,
  requested: [] as string[],
  fail: new Set<string>(),
}));

vi.mock('../src/render/gfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/gfx')>();
  return {
    ...actual,
    GFX: {
      ...actual.GFX,
      get iosMemoryProfile() {
        return h.ios;
      },
    },
  };
});

vi.mock('../src/render/assets/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/assets/loader')>();
  const { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } = await import('three');
  return {
    ...actual,
    releaseGltf: () => undefined,
    loadGltf: async (url: string) => {
      h.requested.push(url);
      await Promise.resolve();
      if (h.fail.delete(url)) throw new Error(`asset load failed: ${url}`);
      // One textured mesh per file, sized by the url so the parts differ.
      const size = 1 + (url.length % 7);
      const material = new MeshStandardMaterial({ map: new Texture() });
      material.name = url;
      const mesh = new Mesh(new BoxGeometry(size, size * 2, size / 2), material);
      const scene = new Group();
      scene.add(mesh);
      return { scene };
    },
  };
});

type Modules = {
  preload: typeof import('../src/render/assets/preload');
  lane: typeof import('../src/render/drakelands_kit_lane');
  ember: typeof import('../src/render/ember_features');
  ignivar: typeof import('../src/render/ignivar_env_props');
};

async function freshModules(ios: boolean): Promise<Modules> {
  vi.resetModules();
  h.ios = ios;
  h.requested.length = 0;
  h.fail.clear();
  return {
    preload: await import('../src/render/assets/preload'),
    lane: await import('../src/render/drakelands_kit_lane'),
    ember: await import('../src/render/ember_features'),
    ignivar: await import('../src/render/ignivar_env_props'),
  };
}

function kitUrls(m: Modules): Set<string> {
  return new Set([
    ...Object.values(m.ignivar.IGNIVAR_ENV_PROP_URLS),
    ...Object.values(m.ember.emberFeaturesInternalsForTest.propUrls),
  ]);
}

function requestedKitUrls(m: Modules): string[] {
  const kit = kitUrls(m);
  return h.requested.filter((url) => kit.has(url)).sort();
}

/** Open the boot lane the way startGame does and let every thunk settle. */
async function boot(m: Modules): Promise<void> {
  m.preload.beginDeferredPreloads();
  await Promise.allSettled(m.preload.preloadInternalsForTest.tasks());
}

/** What the build hands the scene: every drawable, its instancing and slots. */
function buildSignature(group: THREE.Object3D): string[] {
  const rows: string[] = [];
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? (mesh as THREE.InstancedMesh).count
      : 0;
    for (const material of materials) {
      const std = material as THREE.MeshStandardMaterial;
      rows.push(
        [
          mesh.name,
          material.type,
          material.name,
          instanced,
          mesh.geometry.getAttribute('position')?.count ?? 0,
          std.map ? 'map' : '-',
          std.emissiveMap ? 'emissiveMap' : '-',
          mesh.castShadow ? 'cast' : '-',
        ].join('|'),
      );
    }
  });
  return rows;
}

beforeEach(() => {
  h.requested.length = 0;
  h.fail.clear();
});

describe('desktop and Android keep the boot preload', () => {
  it('loads the whole kit when the deferred lane opens and never needs the lane', async () => {
    const m = await freshModules(false);
    expect(requestedKitUrls(m)).toEqual([]);
    await boot(m);
    expect(requestedKitUrls(m)).toEqual([...kitUrls(m)].sort());
    expect(m.ember.emberFeatureAssetsResident()).toBe(true);
    // Resident, so the zone prepare has nothing to await (its control flow
    // is the one it had before the lane existed).
    expect(m.lane.drakelandsKitLoadFor('ember')).toBeNull();
    expect(m.lane.drakelandsKitLoadFor('fen')).toBeNull();
    // The visible-zone lane never holds a zone back, never re-arms its
    // recheck, and never starts a load.
    const before = h.requested.length;
    const recheck = { x: 404, z: 1900, far: 340 };
    const holds = m.lane.drakelandsKitRecheck(ZONES, 404, 1900, 340, recheck);
    for (const zone of ZONES) expect(holds(zone.biome), zone.id).toBe(false);
    expect(recheck).toEqual({ x: 404, z: 1900, far: 340 });
    expect(h.requested.length).toBe(before);
    expect(() => m.ember.buildEmberFeatures(1)).not.toThrow();
  });
});

describe('the iOS memory profile loads the kit on approach', () => {
  it('fetches none of the kit when the boot lane opens', async () => {
    const m = await freshModules(true);
    await boot(m);
    expect(requestedKitUrls(m)).toEqual([]);
    expect(m.ember.emberFeatureAssetsResident()).toBe(false);
    expect(m.ignivar.ignivarEnvPropsSettled()).toBe(false);
  });

  it('refuses to build the features or the fortress before the kit is resident', async () => {
    const m = await freshModules(true);
    await boot(m);
    expect(() => m.ember.buildEmberFeatures(1)).toThrow(/not resident/);
    const fortress = await import('../src/render/forgefather_fortress');
    expect(() => fortress.buildForgefatherFortress()).toThrow(/not settled/);
  });

  it('loads exactly the boot set through the lane and builds the same scene', async () => {
    const desktop = await freshModules(false);
    await boot(desktop);
    const desktopUrls = requestedKitUrls(desktop);
    const desktopBuild = buildSignature(desktop.ember.buildEmberFeatures(1).group);
    expect(desktopBuild.length).toBeGreaterThan(40);

    const ios = await freshModules(true);
    await boot(ios);
    const load = ios.lane.drakelandsKitLoadFor('ember');
    expect(load).not.toBeNull();
    await load;
    expect(requestedKitUrls(ios)).toEqual(desktopUrls);
    expect(ios.ember.emberFeatureAssetsResident()).toBe(true);
    expect(ios.lane.drakelandsKitLoadFor('ember')).toBeNull();
    expect(buildSignature(ios.ember.buildEmberFeatures(1).group)).toEqual(desktopBuild);
  });

  it('shares one load between the prefetch and the prepare', async () => {
    const m = await freshModules(true);
    await boot(m);
    const recheck = createZoneStreamRecheck();
    // Far from the Drakelands: nothing starts.
    m.lane.drakelandsKitRecheck(ZONES, 0, 0, 340, recheck);
    expect(requestedKitUrls(m)).toEqual([]);
    // Within the prepare horizon plus the margin: the kit starts loading.
    m.lane.drakelandsKitRecheck(ZONES, 404, 1300, 340, recheck);
    const started = requestedKitUrls(m).length;
    expect(started).toBeGreaterThan(0);
    // The prepare joins the same load instead of starting a second one.
    const load = m.lane.drakelandsKitLoadFor('ember');
    expect(load).not.toBeNull();
    await load;
    expect(requestedKitUrls(m)).toEqual([...kitUrls(m)].sort());
    m.lane.drakelandsKitRecheck(ZONES, 404, 1900, 340, recheck);
    expect(requestedKitUrls(m)).toEqual([...kitUrls(m)].sort());
  });

  it('holds the Drakelands out of the visible-zone queue until the kit lands, then re-arms it', async () => {
    const m = await freshModules(true);
    await boot(m);
    // The camera at Gibbetmere's latitude: in the trigger's reach.
    const recheck = { x: 404, z: 1300, far: 340 };
    const holds = m.lane.drakelandsKitRecheck(ZONES, 404, 1300, 340, recheck);
    expect(requestedKitUrls(m).length).toBeGreaterThan(0);
    // Only the zone whose features need the kit waits; the lane keeps
    // preparing every other zone meanwhile.
    for (const zone of ZONES) expect(holds(zone.biome), zone.id).toBe(zone.biome === 'ember');
    expect(recheck.x).toBe(404);
    // A prepare that must build now joins the same load and awaits it.
    await m.lane.drakelandsKitLoadFor('ember');
    // The kit landed: the zone is released and the recheck is re-armed, so
    // the next frame queues it even if the camera has not moved.
    expect(holds('ember')).toBe(false);
    expect(Number.isNaN(recheck.x)).toBe(true);
  });

  it('keeps holding after a failed load, without re-arming the recheck every frame', async () => {
    const m = await freshModules(true);
    await boot(m);
    h.fail.add(m.ember.emberFeaturesInternalsForTest.propUrls.lily);
    const recheck = { x: 404, z: 1300, far: 340 };
    const holds = m.lane.drakelandsKitRecheck(ZONES, 404, 1300, 340, recheck);
    await expect(m.lane.drakelandsKitLoadFor('ember')).rejects.toThrow(/asset load failed/);
    expect(holds('ember')).toBe(true);
    expect(recheck.x).toBe(404);
    // The next recheck in reach starts the retry, which fetches the one file.
    const before = h.requested.length;
    m.lane.drakelandsKitRecheck(ZONES, 404, 1324, 340, recheck);
    await m.lane.drakelandsKitLoadFor('ember');
    expect(h.requested.slice(before)).toEqual([
      m.ember.emberFeaturesInternalsForTest.propUrls.lily,
    ]);
    expect(holds('ember')).toBe(false);
    expect(Number.isNaN(recheck.x)).toBe(true);
  });

  it('keeps the features unbuilt after a failed load and retries only what is missing', async () => {
    const m = await freshModules(true);
    await boot(m);
    const pool = m.ember.emberFeaturesInternalsForTest.propUrls.pool;
    h.fail.add(pool);
    const first = m.lane.drakelandsKitLoadFor('ember');
    await expect(first).rejects.toThrow(/asset load failed/);
    expect(m.ember.emberFeatureAssetsResident()).toBe(false);
    expect(() => m.ember.buildEmberFeatures(1)).toThrow(/not resident/);
    // The templates settled (they are fail-soft per asset), so the retry
    // fetches the one prop that failed and re-bakes nothing.
    expect(m.ignivar.ignivarEnvPropsSettled()).toBe(true);
    const before = h.requested.length;
    const retry = m.lane.drakelandsKitLoadFor('ember');
    expect(retry).not.toBeNull();
    expect(retry).not.toBe(first);
    await retry;
    expect(h.requested.slice(before)).toEqual([pool]);
    expect(m.ember.emberFeatureAssetsResident()).toBe(true);
    expect(() => m.ember.buildEmberFeatures(1)).not.toThrow();
  });

  it('leaves the other biomes alone', async () => {
    const m = await freshModules(true);
    await boot(m);
    for (const zone of ZONES) {
      if (zone.biome === 'ember') continue;
      expect(m.lane.drakelandsKitLoadFor(zone.biome), zone.id).toBeNull();
    }
    expect(requestedKitUrls(m)).toEqual([]);
  });
});

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { assetsReady, beginDeferredPreloads } from '../src/render/assets/preload';
import { CannonEncounterVisual } from '../src/render/cannon_encounter_visual';
import { gfxInternalsForTest } from '../src/render/gfx';
import '../src/render/props';
import '../src/render/stations';

// The loader double keeps the real cache contract (one parse per url until
// releaseGltf drops the entry) and records every parse, so a second fetch of
// the barrel shows up as a second parse.
const loader = vi.hoisted(() => {
  // stations.ts registers its deferred preloads only where a window exists.
  (globalThis as { window?: unknown }).window ??= globalThis;
  const cache = new Map<string, Promise<{ scene: unknown }>>();
  const parses = new Map<string, { scene: unknown; mesh: unknown }[]>();
  return { cache, parses };
});

vi.mock('../src/render/assets/loader', async () => {
  const T = await import('three');
  return {
    loadGltf: (url: string) => {
      let p = loader.cache.get(url);
      if (!p) {
        const mesh = new T.Mesh(
          new T.BoxGeometry(1, 2, 1),
          new T.MeshStandardMaterial({ name: 'Wood' }),
        );
        mesh.name =
          url === '/models/props/barrel.glb'
            ? 'parsed-barrel-source-mesh'
            : `parsed-source-mesh:${url}`;
        const scene = new T.Group();
        scene.add(mesh);
        const list = loader.parses.get(url) ?? [];
        list.push({ scene, mesh });
        loader.parses.set(url, list);
        p = Promise.resolve({ scene });
        loader.cache.set(url, p);
      }
      return p;
    },
    releaseGltf: (url: string) => {
      loader.cache.delete(url);
    },
  };
});
vi.mock('../src/render/characters/assets', () => ({ charactersReady: async () => {} }));
vi.mock('../src/render/characters', () => ({
  CharacterVisual: class {
    root = new THREE.Group();
    height = 2.6;
    setShadow() {}
    setProxyShadow() {}
    update() {}
    dispose() {}
  },
}));

const BARREL_URL = '/models/props/barrel.glb';
const BARREL_MESH_NAME = 'parsed-barrel-source-mesh';

function cannonBarrelMeshes(visual: CannonEncounterVisual): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  visual.group.traverse((o) => {
    if (o.name === BARREL_MESH_NAME) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

describe('cannon encounter barrel', () => {
  it('reuses the one barrel parse after props.ts extracts and releases it', async () => {
    // props.ts extracts each source as it lands and releases its loader entry
    // on the iOS memory profile; on the desktop path buildProps does the same
    // before the cannon prepares. Either way the entry is gone by then.
    const restore = gfxInternalsForTest.overrideSettings({ iosMemoryProfile: true });
    try {
      beginDeferredPreloads();
      await assetsReady().catch(() => undefined);
      expect(loader.cache.has(BARREL_URL)).toBe(false);
      expect(loader.parses.get(BARREL_URL)).toHaveLength(1);

      const visual = new CannonEncounterVisual(new THREE.Scene(), () => 0);
      await visual.readyForEntry;

      const parses = (loader.parses.get(BARREL_URL) ?? []) as { mesh: THREE.Mesh }[];
      expect(parses).toHaveLength(1);
      const [{ mesh }] = parses;
      const meshes = cannonBarrelMeshes(visual);
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) {
        expect(m).not.toBe(mesh);
        expect(m.geometry).toBe(mesh.geometry);
        expect(m.material).toBe(mesh.material);
      }
      visual.dispose();
    } finally {
      restore();
    }
  });
});

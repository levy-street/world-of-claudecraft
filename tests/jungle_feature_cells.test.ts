import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { gfxInternalsForTest } from '../src/render/gfx';
import { buildJungleFeatures, reachCoconutSpots } from '../src/render/jungle_features';
import { sweepZoneFeatures, zoneFeatureEntryFor } from '../src/render/zone_feature_sweep';

const preload = vi.hoisted(() => ({ tasks: [] as (() => Promise<unknown>)[] }));
vi.mock('../src/render/assets/preload', () => ({
  registerDeferredPreload: (task: () => Promise<unknown>) => preload.tasks.push(task),
}));
vi.mock('../src/render/assets/loader', () => ({
  loadGltf: async (url: string) => {
    const scene = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    material.name = url;
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    return { scene };
  },
}));
beforeAll(async () => {
  await Promise.all(preload.tasks.map((task) => task()));
});

function coconuts(group: THREE.Group): THREE.InstancedMesh[] {
  return group.children.filter(
    (o) =>
      (o as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material?.name ===
      '/models/props/fallen_coconuts.glb',
  ) as THREE.InstancedMesh[];
}

describe('jungle coconut integration', () => {
  it('enables cells on desktop and constrained Low, leaving other tiers unsplit', () => {
    for (const hints of [{}, { maxTouchPoints: 5, coarsePointer: true, narrowViewport: true }]) {
      expect(gfxInternalsForTest.settingsFor('low', hints).coconutCellSize).toBe(128);
      for (const tier of ['medium', 'high', 'ultra', 'insane'] as const)
        expect(gfxInternalsForTest.settingsFor(tier, hints).coconutCellSize).toBe(0);
    }
  });

  it('builds every cell before attach, registers shadow casters, and releases owned resources once', () => {
    const restore = gfxInternalsForTest.overrideSettings({ coconutCellSize: 64 });
    try {
      const view = buildJungleFeatures(42);
      const cells = coconuts(view.group);
      expect(cells.length).toBeGreaterThan(1);
      expect(cells.reduce((count, cell) => count + cell.count, 0)).toBe(
        reachCoconutSpots(42).length,
      );
      const entry = zoneFeatureEntryFor(view.group, {
        centerX: 2000,
        centerZ: 0,
        halfX: 1,
        halfZ: 1,
      });
      sweepZoneFeatures([entry], 0, 0, 10000, 100);
      for (const cell of cells) {
        expect(entry.shadowCasters).toContain(cell);
        expect(cell.castShadow).toBe(false);
      }
      sweepZoneFeatures([entry], 2000, 0, 10000, 100);
      expect(cells.every((cell) => cell.castShadow)).toBe(true);
      const materialDispose = vi.spyOn(cells[0].material as THREE.Material, 'dispose');
      const geometryDispose = vi.spyOn(cells[0].geometry, 'dispose');
      const meshDisposes = cells.map((cell) => vi.spyOn(cell, 'dispose'));
      view.dispose();
      view.dispose();
      for (const dispose of meshDisposes) expect(dispose).toHaveBeenCalledOnce();
      expect(geometryDispose).toHaveBeenCalledOnce();
      expect(materialDispose).not.toHaveBeenCalled();
      expect(coconuts(view.group)).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('the control arm retains one batch per part and all placements', () => {
    const restore = gfxInternalsForTest.overrideSettings({ coconutCellSize: 0 });
    try {
      const view = buildJungleFeatures(42);
      expect(coconuts(view.group)).toHaveLength(1);
      expect(coconuts(view.group)[0].count).toBe(reachCoconutSpots(42).length);
      const banyans = view.group.children.filter(
        (child) => !(child as THREE.Mesh).isMesh && child.children.length === 2,
      );
      expect(banyans.length).toBeGreaterThan(0);
      view.dispose();
    } finally {
      restore();
    }
  });
});

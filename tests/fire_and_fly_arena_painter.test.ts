// The Fire and Fly arena painter on the tiers that draw the open world's kit
// (src/render/fire_and_fly_arena.ts): the foliage parts are stand-in meshes so
// the tree ring, rocks and understory build in Node. Pins what the arena casts
// per tier, that every slot shares one set of named materials, and what an
// open-field registry releases with a slot and what it never touches.

import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stubs = vi.hoisted(() => ({
  parts: new Map<string, { geometry: unknown; material: unknown; isLeaf: boolean }[]>(),
  grassMaterials: 0,
}));

vi.mock('../src/render/foliage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/foliage')>();
  const three = await import('three');
  return {
    ...actual,
    extractParts: (url: string) => {
      const cached = stubs.parts.get(url);
      if (cached) return cached;
      const material = () =>
        new three.MeshStandardMaterial({ map: new three.Texture(), alphaTest: 0.4 });
      const parts = /rock_/.test(url)
        ? [{ geometry: new three.BoxGeometry(), material: material(), isLeaf: false }]
        : [
            { geometry: new three.CylinderGeometry(), material: material(), isLeaf: false },
            { geometry: new three.SphereGeometry(), material: material(), isLeaf: true },
          ];
      stubs.parts.set(url, parts);
      return parts;
    },
    createGrassTuftMaterial: () => {
      stubs.grassMaterials++;
      return new three.MeshStandardMaterial({ map: new three.Texture(), alphaTest: 0.3 });
    },
  };
});

vi.mock('../src/render/textures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/textures')>();
  const three = await import('three');
  return {
    ...actual,
    flowerTuftTexture: () => new three.Texture(),
    radialGlowTexture: () => new three.CanvasTexture({} as never),
  };
});

vi.mock('../src/render/sky', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/sky')>()),
  ensureSkyAssetsAt: () => Promise.resolve(),
}));

import { buildFireAndFlyArenaInterior } from '../src/render/fire_and_fly_arena';
import { gfxInternalsForTest } from '../src/render/gfx';
import { ghostHideAttribute } from '../src/render/instanced_dither_fade';
import { createOwnedInteriorResourceRegistry } from '../src/render/interior_resource_lifecycle';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { collectOpenFieldResources } from '../src/render/open_field_interiors';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';

const ARENA_INDEX = DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].index;
const FULL = { tier: 'high', standardMaterials: true, leanFoliage: false } as const;
const LEAN_MEDIUM = { tier: 'medium', standardMaterials: true, leanFoliage: true } as const;

let restoreGfx: () => void = () => {};

function onTier(settings: typeof FULL | typeof LEAN_MEDIUM): void {
  restoreGfx();
  restoreGfx = gfxInternalsForTest.overrideSettings(settings);
}

function build(slot: number): THREE.Group {
  const origin = instanceOrigin(ARENA_INDEX, slot);
  const group = buildFireAndFlyArenaInterior({ lowGfx: false, origin });
  group.position.set(origin.x, 0, origin.z);
  return group;
}

function borrowed(): { geometries: Set<unknown>; materials: Set<unknown> } {
  const geometries = new Set<unknown>();
  const materials = new Set<unknown>();
  for (const parts of stubs.parts.values()) {
    for (const part of parts) {
      geometries.add(part.geometry);
      materials.add(part.material);
    }
  }
  return { geometries, materials };
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh || (node as THREE.Points).isPoints)
      found.push(node as THREE.Mesh);
  });
  return found;
}

beforeEach(() => setDitherFadeEnabledForTest(false));

afterEach(() => {
  restoreGfx();
  restoreGfx = () => {};
  setDitherFadeEnabledForTest(null);
});

describe('the arena painter on the kit tiers', () => {
  it("casts the sun-side canopies and the rocks on a full tier, nothing on the lean foliage tier, the open world's rule", () => {
    onTier(FULL);
    const full = meshes(build(0));
    const rocks = full.filter((mesh) => mesh.parent?.name === 'fireAndFlyRocks');
    expect(rocks.length).toBeGreaterThan(0);
    for (const rock of rocks) expect(rock.castShadow).toBe(true);
    const trees = full.filter((mesh) => mesh.parent?.name === 'fireAndFlyTrees');
    expect(trees.some((mesh) => mesh.castShadow)).toBe(true);
    expect(trees.some((mesh) => !mesh.castShadow)).toBe(true);

    onTier(LEAN_MEDIUM);
    const lean = meshes(build(1));
    expect(lean.filter((mesh) => mesh.parent?.name === 'fireAndFlyTrees').length).toBeGreaterThan(
      0,
    );
    for (const mesh of lean) expect(mesh.castShadow).toBe(false);
  });

  it('draws every slot with one set of named materials, made once for the page', () => {
    onTier(FULL);
    const made = stubs.grassMaterials;
    const first = meshes(build(2));
    const second = meshes(build(3));
    const { materials: kit } = borrowed();
    const own = (list: THREE.Mesh[]) =>
      new Set(list.map((mesh) => mesh.material as THREE.Material).filter((m) => !kit.has(m)));
    const mine = own(first);
    expect(mine.size).toBeGreaterThanOrEqual(6);
    for (const material of mine) expect(material.name).toMatch(/^fireAndFly:/);
    expect(own(second)).toEqual(mine);
    for (const material of own(second)) expect(mine.has(material)).toBe(true);
    // The grass and flower cards draw one texture each for the page, not a
    // fresh canvas per slot.
    expect(stubs.grassMaterials - made).toBeLessThanOrEqual(2);
  });

  it("releases a slot's instance buffers and ghost-hide shells, never the open world's parts", () => {
    onTier(FULL);
    setDitherFadeEnabledForTest(true);
    const group = build(4);
    const { geometries, materials } = borrowed();
    const disposed = new Set<unknown>();
    const watch = (target: THREE.EventDispatcher<{ dispose: object }>) =>
      target.addEventListener('dispose', () => disposed.add(target));
    const instanced = meshes(group).filter(
      (mesh) => (mesh as THREE.InstancedMesh).isInstancedMesh,
    ) as THREE.InstancedMesh[];
    const shells = instanced.filter((mesh) => ghostHideAttribute(mesh) !== null);
    expect(shells.length).toBeGreaterThan(0);
    for (const mesh of instanced) watch(mesh as never);
    for (const geometry of geometries) watch(geometry as never);
    for (const material of materials) watch(material as never);
    const arenaMaterials = new Set(meshes(group).map((mesh) => mesh.material as THREE.Material));
    for (const material of arenaMaterials) watch(material as never);
    const shellGeometries = shells.map((mesh) => mesh.geometry);
    for (const shell of shellGeometries) watch(shell as never);

    const registry = createOwnedInteriorResourceRegistry();
    collectOpenFieldResources(group, registry);
    const report = registry.dispose();
    expect(report.errors).toEqual([]);

    for (const mesh of instanced) expect(disposed.has(mesh)).toBe(true);
    for (const shell of shellGeometries) {
      expect(disposed.has(shell)).toBe(true);
      // Detached before its dispose, so the shared buffers outlive it.
      expect(shell.getAttribute('position')).toBeUndefined();
    }
    for (const geometry of geometries) {
      expect(disposed.has(geometry)).toBe(false);
      expect((geometry as THREE.BufferGeometry).getAttribute('position')).toBeDefined();
    }
    for (const material of arenaMaterials) expect(disposed.has(material)).toBe(false);
  });
});

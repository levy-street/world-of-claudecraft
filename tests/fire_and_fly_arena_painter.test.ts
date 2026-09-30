// The Fire and Fly arena painter on the tiers that draw the open world's kit
// (src/render/fire_and_fly_arena.ts): the foliage parts are stand-in meshes so
// the tree ring, rocks and understory build in Node. Pins what the arena casts
// per tier, that every slot shares one set of named materials, and what an
// open-field registry releases with a slot and what it never touches.

import * as THREE from 'three';
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
import { fireAndFlyDrawnTrees } from '../src/render/fire_and_fly_arena_core';
import {
  FIRE_AND_FLY_PREBUILD_NAME,
  FireAndFlyArenaPrebuild,
} from '../src/render/fire_and_fly_arena_prebuild';
import { GFX, gfxInternalsForTest } from '../src/render/gfx';
import type { IdleScheduler } from '../src/render/idle_queue';
import { ghostHideAttribute } from '../src/render/instanced_dither_fade';
import { createOwnedInteriorResourceRegistry } from '../src/render/interior_resource_lifecycle';
import { setDitherFadeEnabledForTest } from '../src/render/occluder_dither_fade';
import { collectOpenFieldResources } from '../src/render/open_field_interiors';
import { FIRE_AND_FLY_DUNGEON_ID } from '../src/sim/content/fire_and_fly_arena';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
} from '../src/sim/content/world_quest_fire_and_fly';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { FIRE_AND_FLY_TREES } from '../src/sim/fire_and_fly_field';

const ARENA_INDEX = DUNGEONS[FIRE_AND_FLY_DUNGEON_ID].index;
const FULL = { tier: 'high', standardMaterials: true, leanFoliage: false } as const;
const LEAN_MEDIUM = { tier: 'medium', standardMaterials: true, leanFoliage: true } as const;
const MEDIUM = { tier: 'medium', standardMaterials: true, leanFoliage: false } as const;
const LOW = { tier: 'low', standardMaterials: false, leanFoliage: true } as const;
type Tier = typeof FULL | typeof LEAN_MEDIUM | typeof MEDIUM | typeof LOW;

let restoreGfx: () => void = () => {};

function onTier(settings: Tier): void {
  restoreGfx();
  restoreGfx = gfxInternalsForTest.overrideSettings(settings);
}

function build(slot: number): THREE.Group {
  const origin = instanceOrigin(ARENA_INDEX, slot);
  const group = buildFireAndFlyArenaInterior({ lowGfx: !GFX.standardMaterials, origin });
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

/** The sim trees a built arena draws (their indices), matched by trunk position. */
function drawnTreeSpots(root: THREE.Object3D, slot: number): number[] {
  const origin = instanceOrigin(ARENA_INDEX, slot);
  const trees = root.getObjectByName('fireAndFlyTrees');
  const found = new Set<number>();
  const at = new THREE.Matrix4();
  const position = new THREE.Vector3();
  for (const mesh of trees ? meshes(trees) : []) {
    const batch = mesh as THREE.InstancedMesh;
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, at);
      position.setFromMatrixPosition(at);
      // Float32 instance matrices far from the world origin: match within a hand.
      const index = FIRE_AND_FLY_TREES.findIndex(
        (tree) =>
          Math.abs(position.x - origin.x - tree.x) < 0.05 &&
          Math.abs(position.z - origin.z - tree.z) < 0.05,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      found.add(index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function planned(density: 'full' | 'medium' | 'low'): number[] {
  return fireAndFlyDrawnTrees(density)
    .map((tree) => FIRE_AND_FLY_TREES.indexOf(tree))
    .sort((a, b) => a - b);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const talkingToAlder = {
  player: {
    pos: { x: FIRE_AND_FLY_NPC_DEF.pos.x + 2, z: FIRE_AND_FLY_NPC_DEF.pos.z },
    level: 60,
    dead: false,
    ghost: false,
    targetId: FIRE_AND_FLY_NPC_ID,
  },
  worldQuestLog: new Map([[FIRE_AND_FLY_QUEST_ID, { state: 'active' as const }]]),
  turretSession: null,
};

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

  it('draws the whole ring on high, about 60 percent on medium and 35 percent on low', () => {
    onTier(FULL);
    expect(drawnTreeSpots(build(5), 5)).toEqual(planned('full'));
    expect(planned('full').length).toBe(FIRE_AND_FLY_TREES.length);
    onTier(MEDIUM);
    expect(drawnTreeSpots(build(5), 5)).toEqual(planned('medium'));
    // The static preset decides, not the foliage lean a weak medium GPU also gets.
    onTier(LEAN_MEDIUM);
    expect(drawnTreeSpots(build(6), 6)).toEqual(planned('medium'));
    onTier(LOW);
    expect(drawnTreeSpots(build(5), 5)).toEqual(planned('low'));
  });

  it('prebuilds hidden the very tree set the live arena then draws, on every tier', async () => {
    const now: IdleScheduler = (callback) => callback();
    for (const [tier, density] of [
      [FULL, 'full'],
      [MEDIUM, 'medium'],
      [LOW, 'low'],
    ] as const) {
      onTier(tier);
      const scene = new THREE.Scene();
      const prebuild = new FireAndFlyArenaPrebuild(scene, undefined, { idle: now });
      prebuild.update(talkingToAlder, 0);
      prebuild.update(talkingToAlder, 50);
      for (let i = 0; i < 8; i++) await flush();
      const holder = scene.getObjectByName(FIRE_AND_FLY_PREBUILD_NAME);
      if (!holder) throw new Error('no prebuilt copy');
      const hidden = drawnTreeSpots(holder, 0);
      expect(hidden).toEqual(planned(density));
      expect(drawnTreeSpots(build(9), 9)).toEqual(hidden);
      prebuild.dispose();
    }
  });
});

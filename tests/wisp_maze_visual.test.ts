import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WISP_MAZE_WALL_CELLS,
  WISP_MAZE_WALL_HEIGHT,
  WISP_MAZE_WORLD_CELLS,
} from '../src/render/wisp_maze_core';
import {
  WISP_GUARDIAN_COLORS,
  WISP_GUARDIAN_FRIGHTENED_COLOR,
} from '../src/render/wisp_maze_guardians';
import {
  type WispMazeKit,
  type WispMazeKitPart,
  wispMazeKitInternalsForTest,
} from '../src/render/wisp_maze_kit';
import {
  planWispMazeHedges,
  WISP_MAZE_HEDGE_KINDS,
  WISP_MAZE_KIT_CELL,
} from '../src/render/wisp_maze_kit_core';
import { WispMazeVisual } from '../src/render/wisp_maze_visual';
import { WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { createWispMaze, WISP_MAZE_LAYOUT } from '../src/sim/minigames/wisp_maze';
import type { IWorld } from '../src/world_api';

function hedgeMeshes(visual: WispMazeVisual): THREE.InstancedMesh[] {
  const walls = visual.group.getObjectByName('wisp-maze-walls')!;
  return walls.children.filter(
    (child): child is THREE.InstancedMesh =>
      child instanceof THREE.InstancedMesh && !child.name.endsWith('-glow'),
  );
}

function painted(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return geometry;
}

/** A tiny stand-in for the baked Blender kit: every piece, every material slot. */
function fixtureKit(): WispMazeKit {
  const part = (solid: boolean, tint: boolean, glow: boolean): WispMazeKitPart => ({
    solid: solid ? painted(new THREE.BoxGeometry(1, 1, 1)) : null,
    tint: tint ? painted(new THREE.BoxGeometry(1, 1, 1)) : null,
    glow: glow ? painted(new THREE.BoxGeometry(0.2, 0.2, 0.2)) : null,
  });
  const kit = new Map<string, WispMazeKitPart>();
  for (const kind of WISP_MAZE_HEDGE_KINDS)
    kit.set(`Hedge${kind}`, part(true, false, kind === 'Gate'));
  kit.set('LanternPost', part(true, false, true));
  const stone = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0.05, 0);
  kit.set('Flagstones', { solid: painted(stone), tint: null, glow: null });
  kit.set('Spirit', part(true, true, true));
  for (let i = 0; i < 5; i++) {
    kit.set(`Crest${i}`, {
      solid: painted(new THREE.ConeGeometry(0.1 + i * 0.05, 0.3, 4)),
      tint: painted(new THREE.OctahedronGeometry(0.1 + i * 0.03)),
      glow: null,
    });
  }
  return kit;
}

afterEach(() => wispMazeKitInternalsForTest.install(null));

describe('personal wisp maze world projection', () => {
  it('holds every hedge and guardian behind the required entry gate and never resurrects disposed content', async () => {
    let release = () => {};
    const gate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const scene = new THREE.Scene();
    const visual = new WispMazeVisual(scene, () => 2, gate);
    expect(gate).toHaveBeenCalledWith(visual.group);
    expect(visual.group.visible).toBe(false);
    expect(visual.group.getObjectByName('wisp-guardian-3')).toBeDefined();
    const hedges = hedgeMeshes(visual);
    expect(hedges.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(WISP_MAZE_WALL_CELLS.length);
    visual.dispose();
    release();
    await visual.readyForEntry;
    expect(scene.children).not.toContain(visual.group);
  });

  it('fills exactly the collision tiles with the stand-in kit, removes collected lights and hides outside the trial', async () => {
    const visual = new WispMazeVisual(new THREE.Scene(), () => 2);
    await visual.readyForEntry;
    const state = createWispMaze(3);
    const worldQuestLog = new Map([[WISP_MAZE_QUEST_ID, { wispMaze: state }]]);
    const world = { worldQuestLog, player: { dead: false } } as unknown as IWorld;
    visual.update(world, true);
    expect(visual.group.visible).toBe(true);
    // No kit in Node: every wall cell is the plain block the collision box is.
    const plan = planWispMazeHedges(WISP_MAZE_LAYOUT);
    const matrix = new THREE.Matrix4();
    const box = new THREE.Box3();
    let seen = 0;
    for (const mesh of hedgeMeshes(visual)) {
      const kind = mesh.name.replace('wisp-maze-hedge-', '');
      const cells = plan.filter((spot) => spot.kind === kind);
      expect(mesh.count).toBe(cells.length);
      mesh.geometry.computeBoundingBox();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        box.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix);
        const at = WISP_MAZE_WORLD_CELLS[cells[i].cell];
        expect(box.min.x).toBeCloseTo(at.x - WISP_MAZE_LAYOUT.pitch / 2);
        expect(box.max.x).toBeCloseTo(at.x + WISP_MAZE_LAYOUT.pitch / 2);
        expect(box.min.z).toBeCloseTo(at.z - WISP_MAZE_LAYOUT.pitch / 2);
        expect(box.max.z).toBeCloseTo(at.z + WISP_MAZE_LAYOUT.pitch / 2);
        expect(box.min.y).toBeCloseTo(2);
        expect(box.max.y).toBeCloseTo(2 + WISP_MAZE_WALL_HEIGHT);
        seen++;
      }
    }
    expect(seen).toBe(WISP_MAZE_WALL_CELLS.length);
    const lights = visual.group.getObjectByName('wisp-maze-lights') as THREE.InstancedMesh;
    const powers = visual.group.getObjectByName('wisp-maze-radiant-lights') as THREE.InstancedMesh;
    expect(lights.count + powers.count).toBe(WISP_MAZE_LAYOUT.openCells.length);
    state.collected = [...WISP_MAZE_LAYOUT.openCells];
    visual.update(world, true);
    expect(lights.count + powers.count).toBe(0);
    worldQuestLog.clear();
    visual.update(world);
    expect(visual.group.visible).toBe(false);
    visual.dispose();
  });

  it('dresses the maze from the baked kit: pieces per cell, gates, lanterns and a draped floor', async () => {
    wispMazeKitInternalsForTest.install(fixtureKit());
    // A sloped lawn: the floor must follow it stone by stone.
    const ground = (x: number, z: number) => 3 + x * 0.01 - z * 0.02;
    const visual = new WispMazeVisual(new THREE.Scene(), ground);
    await visual.readyForEntry;
    const plan = planWispMazeHedges(WISP_MAZE_LAYOUT);
    const byKind = new Map(hedgeMeshes(visual).map((mesh) => [mesh.name, mesh]));
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const kind of WISP_MAZE_HEDGE_KINDS) {
      const cells = plan.filter((spot) => spot.kind === kind);
      const mesh = byKind.get(`wisp-maze-hedge-${kind}`);
      if (!cells.length) {
        expect(mesh).toBeUndefined();
        continue;
      }
      expect(mesh!.count).toBe(cells.length);
      cells.forEach((spot, i) => {
        mesh!.getMatrixAt(i, matrix);
        matrix.decompose(position, rotation, scale);
        const at = WISP_MAZE_WORLD_CELLS[spot.cell];
        expect(position.x).toBeCloseTo(at.x);
        expect(position.z).toBeCloseTo(at.z);
        expect(position.y).toBeCloseTo(ground(at.x, at.z));
        expect(scale.x).toBeCloseTo(WISP_MAZE_LAYOUT.pitch / WISP_MAZE_KIT_CELL);
        expect(scale.y).toBeCloseTo(1);
        const turned = new THREE.Euler().setFromQuaternion(rotation, 'YXZ');
        const expected = spot.quarterTurns * (Math.PI / 2);
        expect(Math.cos(turned.y)).toBeCloseTo(Math.cos(expected));
        expect(Math.sin(turned.y)).toBeCloseTo(Math.sin(expected));
      });
    }
    const gateGlow = visual.group.getObjectByName(
      'wisp-maze-hedge-Gate-glow',
    ) as THREE.InstancedMesh;
    expect(gateGlow.count).toBe(2);
    const lanterns = visual.group.getObjectByName('wisp-maze-lanterns-glow') as THREE.InstancedMesh;
    expect(lanterns.count).toBe(4);
    // One draped stone per corridor cell in the fixture, each vertex on the slope.
    const floor = visual.group.getObjectByName('wisp-maze-flagstones') as THREE.Mesh;
    const stones = floor.geometry.getAttribute('position');
    expect(stones.count).toBe(WISP_MAZE_LAYOUT.openCells.length * 4);
    expect(floor.geometry.index?.count).toBe(WISP_MAZE_LAYOUT.openCells.length * 6);
    for (let i = 0; i < stones.count; i++) {
      expect(stones.getY(i)).toBeCloseTo(ground(stones.getX(i), stones.getZ(i)) + 0.02 + 0.05);
    }
    // Each spirit wears its own crest over the shared leaf body.
    const crests = [0, 1, 2, 3, 4].map(
      (i) => (visual.group.getObjectByName(`wisp-guardian-crest-${i}`) as THREE.Mesh).geometry,
    );
    expect(new Set(crests).size).toBe(5);
    for (let i = 0; i < 5; i++) {
      for (const part of ['leaves', 'twigs', 'eyes', 'crest-twigs']) {
        expect(
          visual.group.getObjectByName(`wisp-guardian-${part}-${i}`),
          `${part} ${i}`,
        ).toBeDefined();
      }
    }
    visual.dispose();
  });

  it('disposes only what it owns: never the shared kit geometry or the cached solid material', async () => {
    const kit = fixtureKit();
    wispMazeKitInternalsForTest.install(kit);
    const visual = new WispMazeVisual(new THREE.Scene(), () => 1);
    await visual.readyForEntry;
    const disposed = new Set<unknown>();
    const watch = (resource: THREE.EventDispatcher<{ dispose: object }> | null | undefined) =>
      resource?.addEventListener('dispose', () => disposed.add(resource));
    for (const part of kit.values()) for (const g of [part.solid, part.tint, part.glow]) watch(g);
    const hedge = visual.group.getObjectByName('wisp-maze-hedge-Straight') as THREE.InstancedMesh;
    const solid = hedge.material as THREE.Material;
    const floor = visual.group.getObjectByName('wisp-maze-flagstones') as THREE.Mesh;
    const glow = (visual.group.getObjectByName('wisp-maze-lanterns-glow') as THREE.Mesh)
      .material as THREE.Material;
    const clones = [0, 1, 2, 3, 4].flatMap((i) =>
      ['leaves', 'eyes'].map(
        (part) =>
          (visual.group.getObjectByName(`wisp-guardian-${part}-${i}`) as THREE.Mesh)
            .material as THREE.Material,
      ),
    );
    let instanceBuffersFreed = 0;
    hedge.addEventListener('dispose', () => instanceBuffersFreed++);
    for (const owned of [solid, floor.geometry, glow, ...clones]) watch(owned);
    visual.dispose();
    for (const part of kit.values())
      for (const g of [part.solid, part.tint, part.glow])
        if (g) expect(disposed.has(g)).toBe(false);
    expect(disposed.has(solid)).toBe(false);
    expect(disposed.has(floor.geometry)).toBe(true);
    expect(disposed.has(glow)).toBe(true);
    for (const clone of clones) expect(disposed.has(clone)).toBe(true);
    expect(instanceBuffersFreed).toBe(1);
  });

  it('keeps five crested hunters, pale frightened state and power aura on reduced motion', async () => {
    const visual = new WispMazeVisual(new THREE.Scene(), () => 0);
    await visual.readyForEntry;
    const state = createWispMaze(7, 'hard');
    expect(state.enemies).toHaveLength(5);
    const actors = Array.from(
      { length: 5 },
      (_, i) => visual.group.getObjectByName(`wisp-guardian-${i}`)!,
    );
    const leaves = (i: number) =>
      (visual.group.getObjectByName(`wisp-guardian-leaves-${i}`) as THREE.Mesh)
        .material as THREE.MeshLambertMaterial;
    const eyes = (i: number) =>
      (visual.group.getObjectByName(`wisp-guardian-eyes-${i}`) as THREE.Mesh)
        .material as THREE.MeshLambertMaterial;
    const crests = [0, 1, 2, 3, 4].map(
      (i) => (visual.group.getObjectByName(`wisp-guardian-crest-${i}`) as THREE.Mesh).geometry,
    );
    expect(new Set(crests).size).toBe(5);
    visual.sync(state, false);
    for (let i = 0; i < 5; i++) {
      expect(leaves(i).color.getHex()).toBe(WISP_GUARDIAN_COLORS[i]);
      expect(eyes(i).emissiveIntensity).toBe(1);
    }
    for (const reduce of [false, true]) {
      state.powerUntilTick = 10;
      visual.sync(state, reduce);
      expect(visual.group.getObjectByName('wisp-maze-player-aura')?.visible).toBe(true);
      for (let i = 0; i < 5; i++) {
        expect(leaves(i).color.getHex()).toBe(WISP_GUARDIAN_FRIGHTENED_COLOR);
        expect(eyes(i).emissiveIntensity).toBe(0.2);
      }
      state.enemies[0].banishedUntilTick = 5;
      visual.sync(state, reduce);
      expect(actors[0].visible).toBe(false);
      state.tick = 10;
      visual.sync(state, reduce);
      expect(actors[0].visible).toBe(true);
      expect(visual.group.getObjectByName('wisp-maze-player-aura')?.visible).toBe(false);
      if (reduce) {
        // Reduced motion: the hunters hold their hover and never sway.
        for (const actor of actors) {
          expect(actor.position.y).toBeCloseTo(0.25);
          expect(actor.children[0].rotation.z).toBe(0);
        }
      }
      state.tick = 0;
      state.enemies[0].banishedUntilTick = 0;
    }
    visual.dispose();
  });
});

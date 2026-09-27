import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  WISP_MAZE_WALL_CELLS,
  WISP_MAZE_WALL_HEIGHT,
  WISP_MAZE_WORLD_CELLS,
} from '../src/render/wisp_maze_core';
import { WispMazeVisual } from '../src/render/wisp_maze_visual';
import { WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { createWispMaze, WISP_MAZE_LAYOUT } from '../src/sim/minigames/wisp_maze';
import type { IWorld } from '../src/world_api';

describe('personal wisp maze world projection', () => {
  it('holds every wall and guardian behind the required entry gate and never resurrects disposed content', async () => {
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
    expect((visual.group.getObjectByName('wisp-maze-walls') as THREE.InstancedMesh).count).toBe(
      WISP_MAZE_WALL_CELLS.length,
    );
    visual.dispose();
    release();
    await visual.readyForEntry;
    expect(scene.children).not.toContain(visual.group);
  });

  it('matches collision tile extents, removes collected lights and hides all personal content outside the trial', async () => {
    const visual = new WispMazeVisual(new THREE.Scene(), () => 2);
    await visual.readyForEntry;
    const state = createWispMaze(3);
    const worldQuestLog = new Map([[WISP_MAZE_QUEST_ID, { wispMaze: state }]]);
    const world = {
      worldQuestLog,
      player: { dead: false },
    } as unknown as IWorld;
    visual.update(world, true);
    expect(visual.group.visible).toBe(true);
    const walls = visual.group.getObjectByName('wisp-maze-walls') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    walls.getMatrixAt(0, matrix);
    const position = new THREE.Vector3().setFromMatrixPosition(matrix);
    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    const expected = WISP_MAZE_WORLD_CELLS[WISP_MAZE_WALL_CELLS[0]];
    expect(position.x).toBe(expected.x);
    expect(position.z).toBe(expected.z);
    expect(position.y).toBeCloseTo(2 + WISP_MAZE_WALL_HEIGHT / 2);
    expect(scale.x).toBe(WISP_MAZE_LAYOUT.pitch);
    expect(scale.z).toBe(WISP_MAZE_LAYOUT.pitch);
    expect(scale.y).toBeCloseTo(WISP_MAZE_WALL_HEIGHT);
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

  it('keeps five different construct silhouettes, pale frightened state and power aura on reduced motion', async () => {
    const visual = new WispMazeVisual(new THREE.Scene(), () => 0);
    await visual.readyForEntry;
    const state = createWispMaze(7, 'hard');
    expect(state.enemies).toHaveLength(5);
    const actors = Array.from(
      { length: 5 },
      (_, i) => visual.group.getObjectByName(`wisp-guardian-${i}`)!,
    );
    const shapeSignatures = actors.map((actor) =>
      JSON.stringify(
        actor.children.map((child) => ({
          shape: (child as THREE.Mesh).geometry.type,
          scale: child.scale.toArray(),
        })),
      ),
    );
    expect(new Set(shapeSignatures).size).toBe(5);
    const childCounts = actors.map((actor) => actor.children.length);
    for (const reduce of [false, true]) {
      state.powerUntilTick = 10;
      visual.sync(state, reduce);
      expect(visual.group.getObjectByName('wisp-maze-player-aura')?.visible).toBe(true);
      for (const actor of actors)
        expect(
          ((actor.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial).color.getHex(),
        ).toBe(0xd9f8ff);
      state.enemies[0].banishedUntilTick = 5;
      visual.sync(state, reduce);
      expect(actors[0].visible).toBe(false);
      state.tick = 10;
      visual.sync(state, reduce);
      expect(actors[0].visible).toBe(true);
      expect(visual.group.getObjectByName('wisp-maze-player-aura')?.visible).toBe(false);
      expect(actors.map((actor) => actor.children.length)).toEqual(childCounts);
      state.tick = 0;
      state.enemies[0].banishedUntilTick = 0;
    }
    visual.dispose();
  });
});

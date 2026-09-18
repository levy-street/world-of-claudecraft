import * as THREE from 'three';
import { WISP_MAZE_QUEST_ID, WISP_MAZE_SITE } from '../sim/content/world_quest_wisp_maze';
import { WISP_MAZE_LAYOUT, type WispMazeState } from '../sim/minigames/wisp_maze';
import type { IWorld } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import { surfaceMat } from './gfx';
import {
  WISP_MAZE_WALL_CELLS,
  WISP_MAZE_WALL_HEIGHT,
  WISP_MAZE_WORLD_CELLS,
  wispGuardianFacing,
  wispGuardianVisible,
  wispMazeVisible,
} from './wisp_maze_core';
import { WispMazeGuardians } from './wisp_maze_guardians';
import { worldQuestTraceMaterials } from './world_quest_trace_materials';

/** Private world-space trial. Everything is allocated and gated before entry. */
export class WispMazeVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private ready = false;
  private disposed = false;
  private readonly content = new THREE.Group();
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly sphere = new THREE.OctahedronGeometry(1);
  // The pickups are the thieves' coin purses: a squat low-poly sack, tied at the
  // neck by the flattened top ring, so it reads as loot beside the radiant wisps.
  private readonly pouch = new THREE.SphereGeometry(1, 7, 5);
  private readonly ring = new THREE.RingGeometry(0.82, 1.04, 24);
  private readonly scratch = new THREE.Object3D();
  private readonly collected = new Uint8Array(WISP_MAZE_LAYOUT.cols * WISP_MAZE_LAYOUT.rows);
  private readonly powerCells = new Set<number>(WISP_MAZE_LAYOUT.powerCells);
  private readonly cellGroundHeights: Float64Array;
  private readonly guardians = new WispMazeGuardians();
  private readonly materials = worldQuestTraceMaterials();
  private readonly walls: THREE.InstancedMesh;
  private readonly wisps: THREE.InstancedMesh;
  private readonly powers: THREE.InstancedMesh;
  private readonly aura: THREE.Mesh;
  private readonly shields: THREE.Mesh[] = [];

  constructor(
    scene: THREE.Object3D,
    private readonly groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.cellGroundHeights = new Float64Array(
      WISP_MAZE_WORLD_CELLS.map((position) => groundAt(position.x, position.z)),
    );
    this.group.name = 'personal-wisp-maze';
    this.group.visible = false;
    this.group.add(this.content);
    this.content.add(this.guardians.group);
    this.walls = new THREE.InstancedMesh(
      this.box,
      surfaceMat({ color: 0x48645f, roughness: 0.95 }),
      WISP_MAZE_WALL_CELLS.length,
    );
    this.walls.name = 'wisp-maze-walls';
    this.walls.frustumCulled = false;
    for (let i = 0; i < WISP_MAZE_WALL_CELLS.length; i++) {
      const position = WISP_MAZE_WORLD_CELLS[WISP_MAZE_WALL_CELLS[i]];
      this.instance(
        this.walls,
        i,
        position.x,
        position.z,
        WISP_MAZE_WALL_HEIGHT / 2,
        WISP_MAZE_LAYOUT.pitch,
        WISP_MAZE_WALL_HEIGHT,
        WISP_MAZE_LAYOUT.pitch,
      );
    }
    this.walls.instanceMatrix.needsUpdate = true;
    this.content.add(this.walls);
    this.wisps = this.pool(
      'wisp-maze-lights',
      this.materials.gold,
      WISP_MAZE_LAYOUT.openCells.length,
      this.pouch,
    );
    this.powers = this.pool(
      'wisp-maze-radiant-lights',
      this.materials.blue,
      WISP_MAZE_LAYOUT.powerCells.length,
    );
    this.aura = new THREE.Mesh(this.ring, this.materials.blue);
    this.aura.name = 'wisp-maze-player-aura';
    this.aura.rotation.x = -Math.PI / 2;
    this.content.add(this.aura);
    for (let i = 0; i < this.guardians.actors.length; i++) {
      const shield = new THREE.Mesh(this.ring, this.materials.gold);
      shield.rotation.x = -Math.PI / 2;
      this.content.add(shield);
      this.shields.push(shield);
    }
    this.content.visible = false;
    this.readyForEntry = attachSceneGroupGated(scene, this.group, compileGate, () => this.disposed)
      .then(() => {
        this.ready = !this.disposed;
        this.group.visible = false;
      })
      .catch(() => {
        if (!this.disposed) this.ready = true;
      });
  }

  private pool(
    name: string,
    material: THREE.Material,
    capacity: number,
    geometry: THREE.BufferGeometry = this.sphere,
  ): THREE.InstancedMesh {
    const pool = new THREE.InstancedMesh(geometry, material, capacity);
    pool.name = name;
    pool.count = 0;
    pool.frustumCulled = false;
    pool.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.content.add(pool);
    return pool;
  }

  private instance(
    pool: THREE.InstancedMesh,
    index: number,
    x: number,
    z: number,
    lift: number,
    sx: number,
    sy: number,
    sz: number,
    groundY = this.groundAt(x, z),
  ): void {
    this.scratch.position.set(x, groundY + lift, z);
    this.scratch.scale.set(sx, sy, sz);
    this.scratch.updateMatrix();
    pool.setMatrixAt(index, this.scratch.matrix);
  }

  update(world: IWorld, reducedMotion = false): void {
    const state = world.worldQuestLog.get(WISP_MAZE_QUEST_ID)?.wispMaze;
    this.group.visible = this.ready && !this.disposed && wispMazeVisible(state, world.player.dead);
    this.content.visible = this.group.visible;
    if (this.group.visible && state) this.sync(state, reducedMotion);
  }

  sync(state: WispMazeState, reducedMotion = false): void {
    this.collected.fill(0);
    for (const cell of state.collected) this.collected[cell] = 1;
    this.wisps.count = this.powers.count = 0;
    for (const cell of WISP_MAZE_LAYOUT.openCells) {
      if (this.collected[cell]) continue;
      const position = WISP_MAZE_WORLD_CELLS[cell];
      const power = this.powerCells.has(cell);
      const pool = power ? this.powers : this.wisps;
      const size = power ? 0.44 : 0.24;
      // Purses sit on the ground; only the radiant wisps hover and bob.
      const lift = power
        ? 0.95 + (reducedMotion ? 0 : Math.sin(state.tick * 0.07 + cell) * 0.09)
        : size * 0.8;
      this.instance(
        pool,
        pool.count++,
        position.x,
        position.z,
        lift,
        size,
        power ? size * 1.3 : size * 0.8,
        size,
        this.cellGroundHeights[cell],
      );
    }
    this.wisps.instanceMatrix.needsUpdate = this.powers.instanceMatrix.needsUpdate = true;
    const powered = state.powerUntilTick > state.tick;
    for (let i = 0; i < this.guardians.actors.length; i++) {
      const actor = this.guardians.actors[i];
      const enemy = state.enemies.find((candidate) => candidate.id === i);
      actor.visible = !!enemy && wispGuardianVisible(enemy, state.tick);
      this.shields[i].visible = actor.visible && !!enemy && enemy.shieldUntilTick > state.tick;
      if (!enemy || !actor.visible) continue;
      const x = WISP_MAZE_SITE.x + enemy.x,
        z = WISP_MAZE_SITE.z + enemy.z;
      const hover = reducedMotion ? 0.25 : 0.25 + Math.sin(state.tick * 0.16 + i * 1.7) * 0.08;
      actor.position.set(x, this.groundAt(x, z) + hover, z);
      actor.rotation.y = wispGuardianFacing(enemy);
      this.shields[i].position.set(x, this.groundAt(x, z) + 0.12, z);
      this.guardians.setFrightened(i, powered);
    }
    this.aura.visible = powered;
    const x = WISP_MAZE_SITE.x + state.playerX,
      z = WISP_MAZE_SITE.z + state.playerZ;
    this.aura.position.set(x, this.groundAt(x, z) + 0.12, z);
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    this.walls.dispose();
    this.wisps.dispose();
    this.powers.dispose();
    this.box.dispose();
    this.sphere.dispose();
    this.pouch.dispose();
    this.ring.dispose();
    this.guardians.dispose();
  }
}

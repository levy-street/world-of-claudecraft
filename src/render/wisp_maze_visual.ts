import * as THREE from 'three';
import { WISP_MAZE_QUEST_ID, WISP_MAZE_SITE } from '../sim/content/world_quest_wisp_maze';
import { WISP_MAZE_LAYOUT, type WispMazeState } from '../sim/minigames/wisp_maze';
import type { IWorld } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import { surfaceMat } from './gfx';
import { markOwnedMaterial } from './shared_resource';
import {
  WISP_MAZE_WORLD_CELLS,
  wispGuardianFacing,
  wispGuardianVisible,
  wispMazeVisible,
} from './wisp_maze_core';
import { WispMazeGuardians } from './wisp_maze_guardians';
import { type WispMazeKit, type WispMazeKitPart, wispMazeKit } from './wisp_maze_kit';
import {
  planWispMazeHedges,
  WISP_MAZE_HEDGE_KINDS,
  WISP_MAZE_KIT_CELL,
  wispMazeFlagstoneTurns,
  wispMazeLanternSpots,
} from './wisp_maze_kit_core';
import { worldQuestTraceMaterials } from './world_quest_trace_materials';

/** Flagstones ride this far over the lawn they are draped on. */
const FLOOR_LIFT = 0.02;
/** The flagstones' top (the kit authors them 0.07 thick): purses rest on it. */
const STONE_TOP = FLOOR_LIFT + 0.07;

/**
 * Private world-space trial, dressed from the maze kit: a clipped hedge piece
 * in every wall cell (wisp_maze_kit_core picks it from the cell's wall
 * neighbours, so each fills exactly the cell the sim blocks), closed gates
 * under leafy arches at the entrances, lanterns at the corners, flagstones
 * down every corridor. Everything is allocated and gated before entry.
 */
export class WispMazeVisual {
  readonly group = new THREE.Group();
  readonly readyForEntry: Promise<void>;
  private ready = false;
  private disposed = false;
  private readonly content = new THREE.Group();
  private readonly sphere = new THREE.OctahedronGeometry(1);
  // The pickups are the thieves' coin purses: a squat low-poly sack, tied at the
  // neck by the flattened top ring, so it reads as loot beside the radiant wisps.
  private readonly pouch = new THREE.SphereGeometry(1, 7, 5);
  private readonly ring = new THREE.RingGeometry(0.82, 1.04, 24);
  private readonly scratch = new THREE.Object3D();
  private readonly collected = new Uint8Array(WISP_MAZE_LAYOUT.cols * WISP_MAZE_LAYOUT.rows);
  private readonly powerCells = new Set<number>(WISP_MAZE_LAYOUT.powerCells);
  private readonly cellGroundHeights: Float64Array;
  private readonly kit: WispMazeKit;
  private readonly solid: THREE.Material;
  private readonly glow: THREE.MeshBasicMaterial;
  private readonly guardians: WispMazeGuardians;
  private readonly materials = worldQuestTraceMaterials();
  private readonly walls = new THREE.Group();
  private readonly instanced: THREE.InstancedMesh[] = [];
  private readonly floor: THREE.Mesh | null;
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
    this.kit = wispMazeKit();
    // Lit and vertex-painted: the Evergarden's sun shades the kit's facets.
    this.solid = surfaceMat({ color: 0xffffff, vertexColors: true, roughness: 0.95 });
    this.glow = markOwnedMaterial(
      new THREE.MeshBasicMaterial({ name: 'wisp-maze-lantern-glow', vertexColors: true }),
    );
    this.guardians = new WispMazeGuardians(this.kit, this.solid);
    this.content.add(this.guardians.group);
    this.walls.name = 'wisp-maze-walls';
    this.buildHedges();
    this.content.add(this.walls);
    this.floor = this.buildFloor();
    if (this.floor) this.content.add(this.floor);
    this.buildLanterns();
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

  /** One instanced draw per hedge piece (and one for any glow it carries). */
  private buildHedges(): void {
    const plan = planWispMazeHedges(WISP_MAZE_LAYOUT);
    const scale = WISP_MAZE_LAYOUT.pitch / WISP_MAZE_KIT_CELL;
    for (const kind of WISP_MAZE_HEDGE_KINDS) {
      const spots = plan.filter((spot) => spot.kind === kind);
      const part = this.kit.get(`Hedge${kind}`);
      if (!spots.length || !part) continue;
      this.instances(`wisp-maze-hedge-${kind}`, part, this.walls, spots.length, (i) => {
        const spot = spots[i];
        const at = WISP_MAZE_WORLD_CELLS[spot.cell];
        return [
          at.x,
          this.cellGroundHeights[spot.cell],
          at.z,
          spot.quarterTurns * (Math.PI / 2),
          scale,
        ];
      });
    }
  }

  private buildLanterns(): void {
    const part = this.kit.get('LanternPost');
    if (!part) return;
    const spots = wispMazeLanternSpots(WISP_MAZE_LAYOUT, WISP_MAZE_LAYOUT.pitch);
    this.instances('wisp-maze-lanterns', part, this.content, spots.length, (i) => {
      const x = WISP_MAZE_SITE.x + spots[i].x;
      const z = WISP_MAZE_SITE.z + spots[i].z;
      return [x, this.groundAt(x, z), z, spots[i].rotationY, 1];
    });
  }

  private instances(
    name: string,
    part: WispMazeKitPart,
    parent: THREE.Object3D,
    count: number,
    pose: (i: number) => [number, number, number, number, number],
  ): void {
    for (const [geometry, material, suffix] of [
      [part.solid, this.solid, ''],
      [part.glow, this.glow, '-glow'],
    ] as const) {
      if (!geometry) continue;
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = `${name}${suffix}`;
      mesh.frustumCulled = false;
      for (let i = 0; i < count; i++) {
        const [x, y, z, rotationY, scale] = pose(i);
        this.scratch.position.set(x, y, z);
        this.scratch.rotation.set(0, rotationY, 0);
        this.scratch.scale.set(scale, 1, scale);
        this.scratch.updateMatrix();
        mesh.setMatrixAt(i, this.scratch.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.instanced.push(mesh);
      parent.add(mesh);
    }
    this.scratch.rotation.set(0, 0, 0);
  }

  /**
   * The corridors' flagstones as one draped mesh: the kit's one authored cell,
   * turned per cell so it never repeats in step, every vertex seated on the
   * lawn beneath it so no stone floats or sinks where the ground is not flat.
   */
  private buildFloor(): THREE.Mesh | null {
    const source = this.kit.get('Flagstones')?.solid;
    if (!source) return null;
    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    const color = source.getAttribute('color');
    const index = source.index;
    const cells = WISP_MAZE_LAYOUT.openCells;
    const count = position.count;
    const positions = new Float32Array(cells.length * count * 3);
    const normals = new Float32Array(cells.length * count * 3);
    const colors = new Float32Array(cells.length * count * 3);
    // Kept indexed: every cell's copy shares the source's triangle list.
    const perCell = index ? index.count : count;
    const indices = new Uint32Array(cells.length * perCell);
    let k = 0;
    const scale = WISP_MAZE_LAYOUT.pitch / WISP_MAZE_KIT_CELL;
    let o = 0;
    for (const cell of cells) {
      const base = o / 3;
      for (let t = 0; t < perCell; t++) indices[k++] = base + (index ? index.getX(t) : t);
      const at = WISP_MAZE_WORLD_CELLS[cell];
      const turn = wispMazeFlagstoneTurns(cell) * (Math.PI / 2);
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      for (let i = 0; i < count; i++, o += 3) {
        const lx = position.getX(i) * scale;
        const lz = position.getZ(i) * scale;
        // three's rotation.y: x' = x cos + z sin, z' = -x sin + z cos
        const x = at.x + lx * cos + lz * sin;
        const z = at.z - lx * sin + lz * cos;
        positions[o] = x;
        positions[o + 1] = this.groundAt(x, z) + FLOOR_LIFT + position.getY(i);
        positions[o + 2] = z;
        const nx = normal ? normal.getX(i) : 0;
        const nz = normal ? normal.getZ(i) : 0;
        normals[o] = nx * cos + nz * sin;
        normals[o + 1] = normal ? normal.getY(i) : 1;
        normals[o + 2] = -nx * sin + nz * cos;
        colors[o] = color ? color.getX(i) : 1;
        colors[o + 1] = color ? color.getY(i) : 1;
        colors[o + 2] = color ? color.getZ(i) : 1;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.solid);
    mesh.name = 'wisp-maze-flagstones';
    mesh.frustumCulled = false;
    return mesh;
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
      // Purses sit on the flagstones; only the radiant wisps hover and bob.
      const lift = power
        ? 0.95 + (reducedMotion ? 0 : Math.sin(state.tick * 0.07 + cell) * 0.09)
        : size * 0.8 + (this.floor ? STONE_TOP : 0);
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
      const hover = this.guardians.pose(i, state.tick, reducedMotion);
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
    // Kit geometry and the shared solid material outlive this view; the
    // instance buffers, the draped floor and the lantern glow are its own.
    for (const mesh of this.instanced) mesh.dispose();
    this.floor?.geometry.dispose();
    this.glow.dispose();
    this.wisps.dispose();
    this.powers.dispose();
    this.sphere.dispose();
    this.pouch.dispose();
    this.ring.dispose();
    this.guardians.dispose();
  }
}

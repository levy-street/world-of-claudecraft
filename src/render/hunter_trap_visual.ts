import * as THREE from 'three';
import type { ActiveHunterTrap } from '../world_api';
import { hasHunterTrapRestraint, hunterJawAngle } from './hunter_trap_core';
import {
  hunterJawGeometry,
  hunterPressurePlateGeometry,
  hunterTrapMaterial,
} from './hunter_trap_geometry';

const CAPACITY = 256;
const EDGE_VERTICES = 96;
interface TrapEntity {
  dead: boolean;
  auras: readonly { id: string; kind: string; remaining: number }[];
}
interface TrapBody {
  group: THREE.Group;
  height: number;
}
interface Placement {
  slot: number;
  x: number;
  z: number;
  radius: number;
  y: number;
  edges: Float32Array;
}

/** A fixed, shared batch: two hardware draws plus one terrain-draped frost trace.
 * No particles, textures, scene objects or buffers are allocated when a trap fires.
 * Restraints read the victim's aura; disappearing traps never imply a trigger. */
export class HunterTrapVisuals {
  readonly group = new THREE.Group();
  readonly jaws = new THREE.InstancedMesh(hunterJawGeometry(), hunterTrapMaterial(), CAPACITY * 4);
  readonly plates = new THREE.InstancedMesh(
    hunterPressurePlateGeometry(),
    hunterTrapMaterial(),
    CAPACITY * 2,
  );
  readonly boundary: THREE.LineSegments;
  private readonly vertices = new Float32Array(CAPACITY * EDGE_VERTICES * 3);
  private readonly placements = new Map<string, Placement>();
  private readonly seen = new Set<string>();
  private readonly pose = new THREE.Object3D();
  private readonly basis = new THREE.Matrix4();
  private readonly product = new THREE.Matrix4();
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene | THREE.Group,
    private readonly groundY: (x: number, z: number) => number,
  ) {
    this.group.name = 'hunter-persistent-traps';
    this.jaws.name = 'hunter-forged-jaws';
    this.plates.name = 'hunter-pressure-plates';
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.vertices, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setDrawRange(0, 0);
    this.boundary = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x74bdc2,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      }),
    );
    this.boundary.name = 'hunter-trigger-reach';
    this.boundary.renderOrder = 4;
    for (const mesh of [this.jaws, this.plates]) {
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // One world-spanning batch; individual placements have already passed
      // the authoritative event-interest horizon. Avoid a stale instance bound.
      mesh.frustumCulled = false;
    }
    this.boundary.frustumCulled = false;
    this.group.add(this.jaws, this.plates, this.boundary);
    this.group.visible = false;
    scene.add(this.group);
  }

  sync(
    active: readonly ActiveHunterTrap[],
    entities?: ReadonlyMap<number, TrapEntity>,
    bodies?: ReadonlyMap<number, TrapBody>,
  ): void {
    if (this.disposed) return;
    this.seen.clear();
    let hardware = 0,
      traces = 0;
    let boundaryDirty = false;
    for (const trap of active) {
      if (traces >= CAPACITY) break;
      if (trap.remaining <= 0) continue;
      this.seen.add(trap.id);
      let placement = this.placements.get(trap.id);
      if (
        !placement ||
        placement.x !== trap.x ||
        placement.z !== trap.z ||
        placement.radius !== trap.radius
      ) {
        placement = this.place(trap);
        this.placements.set(trap.id, placement);
      }
      this.basis.makeTranslation(trap.x, placement.y + 0.025, trap.z);
      this.writeHardware(
        hardware++,
        this.basis,
        1,
        hunterJawAngle(trap.armTime, trap.armRemaining),
      );
      if (placement.slot !== traces) {
        placement.slot = traces;
        this.vertices.set(placement.edges, traces * EDGE_VERTICES * 3);
        boundaryDirty = true;
      }
      traces++;
    }
    for (const id of this.placements.keys()) if (!this.seen.has(id)) this.placements.delete(id);
    // Interpolated displayed body position, rather than a second simulation
    // position, keeps cuffs attached through movement and crowd LOD swaps.
    if (entities && bodies) {
      let restraints = 0;
      for (const [id, body] of bodies) {
        if (restraints >= CAPACITY) break;
        const entity = entities.get(id);
        if (!entity || !body.group.visible || !hasHunterTrapRestraint(entity)) continue;
        body.group.updateWorldMatrix(true, false);
        this.writeHardware(
          hardware++,
          body.group.matrixWorld,
          Math.max(0.3, body.height / 1.8) * 0.5,
          hunterJawAngle(0, 0, true),
        );
        restraints++;
      }
    }
    this.jaws.count = hardware * 2;
    this.plates.count = hardware;
    for (const mesh of [this.jaws, this.plates]) {
      mesh.instanceMatrix.clearUpdateRanges();
      if (mesh.count > 0) {
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.boundary.geometry.setDrawRange(0, traces * EDGE_VERTICES);
    const positions = this.boundary.geometry.attributes.position as THREE.BufferAttribute;
    if (boundaryDirty && traces > 0) {
      positions.clearUpdateRanges();
      positions.addUpdateRange(0, traces * EDGE_VERTICES * 3);
      positions.needsUpdate = true;
    }
    this.group.visible = hardware > 0;
  }

  private writeHardware(index: number, basis: THREE.Matrix4, scale: number, angle: number): void {
    this.pose.position.set(0, 0, 0);
    this.pose.scale.setScalar(scale);
    this.pose.rotation.set(0, 0, 0);
    this.pose.updateMatrix();
    this.product.multiplyMatrices(basis, this.pose.matrix);
    this.plates.setMatrixAt(index, this.product);
    for (let side = 0; side < 2; side++) {
      // YXZ keeps both hinged halves rising inward, including the mirrored jaw.
      this.pose.rotation.set(-angle, side * Math.PI, 0, 'YXZ');
      this.pose.updateMatrix();
      this.product.multiplyMatrices(basis, this.pose.matrix);
      this.jaws.setMatrixAt(index * 2 + side, this.product);
    }
  }

  private place(trap: ActiveHunterTrap): Placement {
    const edges = new Float32Array(EDGE_VERTICES * 3);
    let cursor = 0;
    const point = (angle: number, r: number) => {
      const x = trap.x + Math.cos(angle) * r,
        z = trap.z + Math.sin(angle) * r;
      edges[cursor++] = x;
      edges[cursor++] = this.groundY(x, z) + 0.055;
      edges[cursor++] = z;
    };
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      // Broken frost branches terminate at the true trigger radius from the
      // first frame. Their inward split gives Hunter its own ground language.
      point(a - 0.024, trap.radius);
      point(a + 0.024, trap.radius);
      point(a, trap.radius);
      point(a - 0.045, trap.radius - 0.25 - (i % 3) * 0.07);
      point(a - 0.045, trap.radius - 0.25 - (i % 3) * 0.07);
      point(a + 0.01, trap.radius - 0.43);
    }
    return {
      slot: -1,
      x: trap.x,
      z: trap.z,
      radius: trap.radius,
      y: this.groundY(trap.x, trap.z),
      edges,
    };
  }

  clear(): void {
    this.sync([]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.group.removeFromParent();
    this.jaws.dispose();
    this.plates.dispose();
    this.boundary.geometry.dispose();
    (this.boundary.material as THREE.Material).dispose();
  }
}

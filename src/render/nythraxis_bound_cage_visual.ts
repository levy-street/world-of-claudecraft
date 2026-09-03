// The Binding Sigil's cage: while Nythraxis carries the Bound stun a ring of
// bone bars (the Tripo cage model, or a procedural ring of bars until it has
// loaded) rises out of the floor around him, and sinks back the moment the
// stun ends. Driven by the boss entity's auras, which both worlds mirror, so
// the online client gets it for free. Timing math lives in
// nythraxis_bound_cage_core.ts; this painter owns the meshes.

import * as THREE from 'three';
import { NYTHRAXIS_BOSS_ID } from '../sim/types';
import {
  type NythraxisCageBossLike,
  type NythraxisCageFootprint,
  nythraxisBoundStunOf,
  nythraxisCageLift,
  nythraxisCageRadiusFor,
  nythraxisCageScaleFor,
  nythraxisCageSunk,
} from './nythraxis_bound_cage_core';
import { nythraxisPropAsset } from './nythraxis_fire_assets';

export const NYTHRAXIS_CAGE_VISUAL_NAME = 'nythraxis-bound-cage';
export const NYTHRAXIS_CAGE_FALLBACK_NAME = 'nythraxis-bound-cage-bars';

const FALLBACK_BARS = 14;
const FALLBACK_HEIGHT = 6;
const FALLBACK_BONE = 0xd9cfb4;
const FALLBACK_RUNE = 0x8f5cff;

interface CageVisual {
  bossId: number;
  group: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  /** The model's own height after scaling, the distance it rises through. */
  height: number;
  floorY: number;
  stunElapsed: number;
  sinkElapsed: number | null;
  usesAsset: boolean;
}

/** A procedural ring of bars: what stands in until the cage model has loaded. */
function buildFallbackCage(radius: number): {
  group: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  height: number;
} {
  const group = new THREE.Group();
  group.name = NYTHRAXIS_CAGE_FALLBACK_NAME;
  const bone = new THREE.MeshBasicMaterial({ color: FALLBACK_BONE, toneMapped: false });
  const rune = new THREE.MeshBasicMaterial({
    color: FALLBACK_RUNE,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const bar = new THREE.CylinderGeometry(0.16, 0.22, FALLBACK_HEIGHT, 6);
  bar.translate(0, FALLBACK_HEIGHT / 2, 0);
  const bars = new THREE.InstancedMesh(bar, bone, FALLBACK_BARS);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < FALLBACK_BARS; index++) {
    const angle = (index / FALLBACK_BARS) * Math.PI * 2;
    dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    dummy.rotation.set(0, -angle, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bars.setMatrixAt(index, dummy.matrix);
  }
  bars.instanceMatrix.needsUpdate = true;
  group.add(bars);
  const rim = new THREE.TorusGeometry(radius, 0.12, 8, 48).rotateX(Math.PI / 2);
  rim.translate(0, FALLBACK_HEIGHT * 0.55, 0);
  group.add(new THREE.Mesh(rim, rune));
  return { group, materials: [bone, rune], geometries: [bar, rim], height: FALLBACK_HEIGHT };
}

/** The cage mesh for a boss of this footprint: the model when loaded, else the ring of bars. */
export function buildNythraxisBoundCage(boss: NythraxisCageFootprint): {
  group: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
  height: number;
  usesAsset: boolean;
} {
  const radius = nythraxisCageRadiusFor(boss);
  const root = new THREE.Group();
  root.name = NYTHRAXIS_CAGE_VISUAL_NAME;
  root.userData.renderCategory = 'ui3d';
  root.userData.cageRadius = radius;
  const asset = nythraxisPropAsset('cage');
  if (!asset) {
    const fallback = buildFallbackCage(radius);
    root.add(fallback.group);
    return {
      group: root,
      materials: fallback.materials,
      geometries: fallback.geometries,
      height: fallback.height,
      usesAsset: false,
    };
  }
  const scale = nythraxisCageScaleFor(radius, Math.max(asset.width, asset.depth));
  const materials: THREE.Material[] = [];
  for (const part of asset.parts) {
    const material = part.material.clone();
    materials.push(material);
    const mesh = new THREE.Mesh(part.geometry, material);
    mesh.scale.setScalar(scale);
    root.add(mesh);
  }
  // Geometry is the shared prepared asset: nothing to dispose per cage.
  return { group: root, materials, geometries: [], height: asset.height * scale, usesAsset: true };
}

function disposeCage(cage: CageVisual): void {
  for (const geometry of cage.geometries) geometry.dispose();
  for (const material of cage.materials) material.dispose();
  cage.group.traverse((object) => {
    const instanced = object as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) instanced.dispose();
  });
  cage.group.removeFromParent();
}

export class NythraxisBoundCageVisuals {
  private readonly cages = new Map<number, CageVisual>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  /** One cage per Bound boss; a boss whose stun ended keeps its cage while it sinks. */
  syncWorld(world: { entities: ReadonlyMap<number, NythraxisCageBossLike> }): void {
    const seen = new Set<number>();
    for (const entity of world.entities.values()) {
      if (entity.templateId !== NYTHRAXIS_BOSS_ID) continue;
      const stun = nythraxisBoundStunOf(entity);
      const existing = this.cages.get(entity.id);
      if (!stun) {
        if (existing && existing.sinkElapsed === null) existing.sinkElapsed = 0;
        continue;
      }
      seen.add(entity.id);
      const elapsed = Math.max(0, stun.duration - stun.remaining);
      if (existing) {
        // A fresh Bound while the last cage was still sinking: it rises again.
        if (existing.sinkElapsed !== null) {
          existing.sinkElapsed = null;
          existing.stunElapsed = 0;
        } else {
          existing.stunElapsed = elapsed;
        }
        existing.group.position.x = entity.pos.x;
        existing.group.position.z = entity.pos.z;
        continue;
      }
      const built = buildNythraxisBoundCage(entity);
      const floorY = this.groundY(entity.pos.x, entity.pos.z);
      built.group.position.set(entity.pos.x, floorY - built.height, entity.pos.z);
      this.scene.add(built.group);
      this.cages.set(entity.id, {
        bossId: entity.id,
        group: built.group,
        materials: built.materials,
        geometries: built.geometries,
        height: built.height,
        floorY,
        stunElapsed: elapsed,
        sinkElapsed: null,
        usesAsset: built.usesAsset,
      });
    }
    // A boss that vanished (reset, kill) drops its cage at once.
    for (const [bossId, cage] of this.cages) {
      if (seen.has(bossId) || world.entities.has(bossId)) continue;
      disposeCage(cage);
      this.cages.delete(bossId);
    }
  }

  update(dt: number, _reducedMotion = false): void {
    const step = Math.max(0, dt);
    for (const [bossId, cage] of this.cages) {
      if (cage.sinkElapsed !== null) {
        cage.sinkElapsed += step;
        if (nythraxisCageSunk(cage.sinkElapsed)) {
          disposeCage(cage);
          this.cages.delete(bossId);
          continue;
        }
      } else {
        cage.stunElapsed += step;
      }
      const lift = nythraxisCageLift(cage.stunElapsed, cage.sinkElapsed);
      cage.group.position.y = cage.floorY - cage.height * (1 - lift);
    }
  }

  get count(): number {
    return this.cages.size;
  }

  dispose(): void {
    for (const cage of this.cages.values()) disposeCage(cage);
    this.cages.clear();
  }
}

/** A cage at the origin for the crypt prewarm, so its materials link before the first Bound. */
export function buildNythraxisBoundCagePrewarmVisual(): THREE.Group {
  return buildNythraxisBoundCage({ scale: 3.1 }).group;
}

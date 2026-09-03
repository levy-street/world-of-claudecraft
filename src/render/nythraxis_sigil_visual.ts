// Nythraxis Binding Sigil: an authoritative gold floor decal with eight rune
// spokes and a clockwise countdown sweep. Each row owns its dynamic sweep
// buffer and materials, and every resource retires when the row vanishes.
// Graphics tiers never reach this actionable painter.

import * as THREE from 'three';
import type { ActiveNythraxisBindingSigil } from '../sim/nythraxis_binding_sigil';
import {
  NYTHRAXIS_SIGIL_GROUND_LIFT,
  NYTHRAXIS_SIGIL_PALETTE,
  NYTHRAXIS_SIGIL_SPOKE_COUNT,
  NYTHRAXIS_SIGIL_SWEEP_SEGMENTS,
  type NythraxisSigilSpokePose,
  nythraxisSigilRimOpacity,
  nythraxisSigilSpokePoseInto,
  nythraxisSigilSweepAngle,
} from './nythraxis_sigil_core';

export const NYTHRAXIS_SIGIL_VISUAL_NAME = 'nythraxis-binding-sigil';
export const NYTHRAXIS_SIGIL_FILL_NAME = 'nythraxis-binding-sigil-fill';
export const NYTHRAXIS_SIGIL_RIM_NAME = 'nythraxis-binding-sigil-rim';
export const NYTHRAXIS_SIGIL_SPOKES_NAME = 'nythraxis-binding-sigil-spokes';
export const NYTHRAXIS_SIGIL_SWEEP_NAME = 'nythraxis-binding-sigil-sweep';

const TWO_PI = Math.PI * 2;
const SWEEP_START = Math.PI / 2;
const SPOKE_GEOMETRY = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

interface SigilVisual {
  group: THREE.Group;
  fill: THREE.Mesh;
  rim: THREE.Mesh;
  spokes: THREE.InstancedMesh;
  sweep: THREE.Mesh;
  sweepPositions: Float32Array;
  fillMaterial: THREE.MeshBasicMaterial;
  rimMaterial: THREE.MeshBasicMaterial;
  sweepMaterial: THREE.MeshBasicMaterial;
  x: number;
  z: number;
  radius: number;
  duration: number;
  remaining: number;
  phase: number;
}

function sigilMaterial(
  color: number,
  opacity: number,
  blending: THREE.Blending,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function buildSweepGeometry(): { geometry: THREE.BufferGeometry; positions: Float32Array } {
  const positions = new Float32Array(NYTHRAXIS_SIGIL_SWEEP_SEGMENTS * 4 * 3);
  const indices = new Uint16Array(NYTHRAXIS_SIGIL_SWEEP_SEGMENTS * 6);
  for (let segment = 0; segment < NYTHRAXIS_SIGIL_SWEEP_SEGMENTS; segment++) {
    const vertex = segment * 4;
    const offset = segment * 6;
    indices[offset] = vertex;
    indices[offset + 1] = vertex + 1;
    indices[offset + 2] = vertex + 2;
    indices[offset + 3] = vertex;
    indices[offset + 4] = vertex + 2;
    indices[offset + 5] = vertex + 3;
  }
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return { geometry, positions };
}

function writeSweep(visual: SigilVisual): void {
  const visibleAngle = nythraxisSigilSweepAngle(visual.remaining, visual.duration);
  const step = TWO_PI / NYTHRAXIS_SIGIL_SWEEP_SEGMENTS;
  const innerRadius = visual.radius * 0.71;
  const outerRadius = visual.radius * 0.8;
  for (let segment = 0; segment < NYTHRAXIS_SIGIL_SWEEP_SEGMENTS; segment++) {
    const startProgress = Math.min(visibleAngle, segment * step);
    const endProgress = Math.min(visibleAngle, (segment + 1) * step);
    const start = SWEEP_START - startProgress;
    const end = SWEEP_START - endProgress;
    const base = segment * 12;
    const positions = visual.sweepPositions;
    positions[base] = Math.cos(start) * innerRadius;
    positions[base + 1] = 0;
    positions[base + 2] = Math.sin(start) * innerRadius;
    positions[base + 3] = Math.cos(start) * outerRadius;
    positions[base + 4] = 0;
    positions[base + 5] = Math.sin(start) * outerRadius;
    positions[base + 6] = Math.cos(end) * outerRadius;
    positions[base + 7] = 0;
    positions[base + 8] = Math.sin(end) * outerRadius;
    positions[base + 9] = Math.cos(end) * innerRadius;
    positions[base + 10] = 0;
    positions[base + 11] = Math.sin(end) * innerRadius;
  }
  visual.sweep.geometry.getAttribute('position').needsUpdate = true;
  visual.sweep.userData.visibleAngle = visibleAngle;
}

function poseSpokes(spokes: THREE.InstancedMesh, radius: number): void {
  const dummy = new THREE.Object3D();
  const pose: NythraxisSigilSpokePose = { x: 0, z: 0, yaw: 0, length: 0, width: 0 };
  for (let index = 0; index < NYTHRAXIS_SIGIL_SPOKE_COUNT; index++) {
    nythraxisSigilSpokePoseInto(pose, index, radius);
    dummy.position.set(pose.x, 0, pose.z);
    dummy.rotation.set(0, pose.yaw, 0);
    dummy.scale.set(pose.width, 1, pose.length);
    dummy.updateMatrix();
    spokes.setMatrixAt(index, dummy.matrix);
  }
  spokes.instanceMatrix.needsUpdate = true;
  spokes.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius);
}

function visualFromGroup(group: THREE.Group, row: ActiveNythraxisBindingSigil): SigilVisual {
  return {
    group,
    fill: group.userData.fill as THREE.Mesh,
    rim: group.userData.rim as THREE.Mesh,
    spokes: group.userData.spokes as THREE.InstancedMesh,
    sweep: group.userData.sweep as THREE.Mesh,
    sweepPositions: group.userData.sweepPositions as Float32Array,
    fillMaterial: group.userData.fillMaterial as THREE.MeshBasicMaterial,
    rimMaterial: group.userData.rimMaterial as THREE.MeshBasicMaterial,
    sweepMaterial: group.userData.sweepMaterial as THREE.MeshBasicMaterial,
    x: row.x,
    z: row.z,
    radius: row.radius,
    duration: row.duration,
    remaining: row.remaining,
    phase: 0,
  };
}

export function buildNythraxisBindingSigil(
  row: ActiveNythraxisBindingSigil,
  groundY: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = NYTHRAXIS_SIGIL_VISUAL_NAME;
  group.position.set(row.x, groundY + NYTHRAXIS_SIGIL_GROUND_LIFT, row.z);
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.sigilId = row.id;
  group.userData.sourceId = row.sourceId;
  group.userData.radius = row.radius;
  group.userData.duration = row.duration;
  group.userData.remaining = row.remaining;

  const fillMaterial = sigilMaterial(NYTHRAXIS_SIGIL_PALETTE.fill, 0.2, THREE.NormalBlending);
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(row.radius * 0.88, 64).rotateX(-Math.PI / 2),
    fillMaterial,
  );
  fill.name = NYTHRAXIS_SIGIL_FILL_NAME;
  fill.renderOrder = 10;
  group.add(fill);

  const rimMaterial = sigilMaterial(NYTHRAXIS_SIGIL_PALETTE.rim, 0.86, THREE.AdditiveBlending);
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(row.radius * 0.88, row.radius, 64).rotateX(-Math.PI / 2),
    rimMaterial,
  );
  rim.name = NYTHRAXIS_SIGIL_RIM_NAME;
  rim.position.y = 0.01;
  rim.renderOrder = 11;
  group.add(rim);

  const spokes = new THREE.InstancedMesh(SPOKE_GEOMETRY, rimMaterial, NYTHRAXIS_SIGIL_SPOKE_COUNT);
  spokes.name = NYTHRAXIS_SIGIL_SPOKES_NAME;
  spokes.position.y = 0.015;
  spokes.renderOrder = 12;
  poseSpokes(spokes, row.radius);
  group.add(spokes);

  const sweepMaterial = sigilMaterial(NYTHRAXIS_SIGIL_PALETTE.sweep, 0.94, THREE.AdditiveBlending);
  const { geometry: sweepGeometry, positions: sweepPositions } = buildSweepGeometry();
  sweepGeometry.boundingSphere?.set(new THREE.Vector3(), row.radius);
  const sweep = new THREE.Mesh(sweepGeometry, sweepMaterial);
  sweep.name = NYTHRAXIS_SIGIL_SWEEP_NAME;
  sweep.position.y = 0.025;
  sweep.renderOrder = 13;
  group.add(sweep);

  group.userData.fill = fill;
  group.userData.rim = rim;
  group.userData.spokes = spokes;
  group.userData.sweep = sweep;
  group.userData.sweepPositions = sweepPositions;
  group.userData.fillMaterial = fillMaterial;
  group.userData.rimMaterial = rimMaterial;
  group.userData.sweepMaterial = sweepMaterial;
  const visual = visualFromGroup(group, row);
  group.userData.visual = visual;
  writeSweep(visual);
  return group;
}

function disposeVisual(visual: SigilVisual): void {
  visual.fill.geometry.dispose();
  visual.rim.geometry.dispose();
  visual.sweep.geometry.dispose();
  visual.spokes.dispose();
  visual.fillMaterial.dispose();
  visual.rimMaterial.dispose();
  visual.sweepMaterial.dispose();
  visual.group.removeFromParent();
}

export class NythraxisBindingSigilVisuals {
  private readonly visuals = new Map<string, SigilVisual>();
  private readonly activeIds = new Set<string>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  sync(rows: readonly ActiveNythraxisBindingSigil[]): void {
    if (rows.length === 0 && this.visuals.size === 0) return;
    this.activeIds.clear();
    for (const row of rows) {
      this.activeIds.add(row.id);
      const existing = this.visuals.get(row.id);
      if (existing) {
        const shapeChanged =
          existing.x !== row.x ||
          existing.z !== row.z ||
          existing.radius !== row.radius ||
          existing.duration !== row.duration;
        if (!shapeChanged) {
          if (existing.remaining !== row.remaining) {
            existing.remaining = row.remaining;
            existing.group.userData.remaining = row.remaining;
            writeSweep(existing);
          }
          continue;
        }
        disposeVisual(existing);
        this.visuals.delete(row.id);
      }
      const group = buildNythraxisBindingSigil(row, this.groundY(row.x, row.z));
      this.scene.add(group);
      this.visuals.set(row.id, group.userData.visual as SigilVisual);
    }
    for (const [id, visual] of this.visuals) {
      if (this.activeIds.has(id)) continue;
      disposeVisual(visual);
      this.visuals.delete(id);
    }
  }

  syncWorld(world: { activeNythraxisBindingSigils: readonly ActiveNythraxisBindingSigil[] }): void {
    this.sync(world.activeNythraxisBindingSigils);
  }

  update(dt: number, reducedMotion = false): void {
    const step = Math.max(0, dt);
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) visual.phase = (visual.phase + step * 1.35) % TWO_PI;
      visual.rimMaterial.opacity = nythraxisSigilRimOpacity(visual.phase, reducedMotion);
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeVisual(visual);
    this.visuals.clear();
    this.activeIds.clear();
  }
}

export function buildNythraxisBindingSigilPrewarmVisual(): THREE.Group {
  return buildNythraxisBindingSigil(
    {
      id: 'prewarm-binding-sigil',
      sourceId: 0,
      x: 0,
      z: 0,
      radius: 4,
      duration: 15,
      remaining: 7.5,
    },
    0,
  );
}

// Nythraxis Gravefire: one terrain-draped strip per authoritative lit window.
// Every row owns one preallocated BufferGeometry. Snapshot changes rewrite its
// positions in place, while cached one-yard height samples are taken only as
// the advancing window reaches them. Graphics tiers never reach this painter.

import * as THREE from 'three';
import {
  type ActiveNythraxisGravefire,
  NYTHRAXIS_GRAVEFIRE_LENGTH,
} from '../sim/nythraxis_gravefire';
import {
  NYTHRAXIS_GRAVEFIRE_GROUND_LIFT,
  NYTHRAXIS_GRAVEFIRE_PALETTE,
  type NythraxisGravefirePlan,
  type NythraxisGravefirePulse,
  nythraxisGravefirePlanInto,
  nythraxisGravefirePulseInto,
} from './nythraxis_gravefire_core';

export const NYTHRAXIS_GRAVEFIRE_VISUAL_NAME = 'nythraxis-gravefire';
export const NYTHRAXIS_GRAVEFIRE_STRIP_NAME = 'nythraxis-gravefire-strip';

const MAX_SEGMENTS = NYTHRAXIS_GRAVEFIRE_LENGTH;
const QUAD_VERTEX_COUNT = 4;
const QUAD_INDEX_COUNT = 6;
const LAYER_COUNT = 5;
const UNDERLAY_LAYER = 0;
const CORE_LAYER = 1;
const LEFT_RIM_LAYER = 2;
const RIGHT_RIM_LAYER = 3;
const HEAD_LAYER = 4;
const TWO_PI = Math.PI * 2;

interface GravefireVisual {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  positions: Float32Array;
  underlayMaterial: THREE.MeshBasicMaterial;
  coreMaterial: THREE.MeshBasicMaterial;
  rimMaterial: THREE.MeshBasicMaterial;
  headMaterial: THREE.MeshBasicMaterial;
  sampledHeights: Float32Array;
  sampled: Uint8Array;
  plan: NythraxisGravefirePlan;
  groundY: (x: number, z: number) => number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  tail: number;
  head: number;
  halfWidth: number;
  phase: number;
}

function stripMaterial(
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

function buildStripGeometry(): { geometry: THREE.BufferGeometry; positions: Float32Array } {
  const positions = new Float32Array(MAX_SEGMENTS * LAYER_COUNT * QUAD_VERTEX_COUNT * 3);
  const indices = new Uint16Array(MAX_SEGMENTS * LAYER_COUNT * QUAD_INDEX_COUNT);
  let indexOffset = 0;
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    for (let segment = 0; segment < MAX_SEGMENTS; segment++) {
      const vertex = (layer * MAX_SEGMENTS + segment) * QUAD_VERTEX_COUNT;
      indices[indexOffset++] = vertex;
      indices[indexOffset++] = vertex + 1;
      indices[indexOffset++] = vertex + 2;
      indices[indexOffset++] = vertex;
      indices[indexOffset++] = vertex + 2;
      indices[indexOffset++] = vertex + 3;
    }
  }
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    const materialIndex =
      layer === UNDERLAY_LAYER ? 0 : layer === HEAD_LAYER ? 3 : layer === CORE_LAYER ? 1 : 2;
    geometry.addGroup(
      layer * MAX_SEGMENTS * QUAD_INDEX_COUNT,
      MAX_SEGMENTS * QUAD_INDEX_COUNT,
      materialIndex,
    );
  }
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return { geometry, positions };
}

function ensureHeightSample(visual: GravefireVisual, yard: number): number {
  const index = Math.min(NYTHRAXIS_GRAVEFIRE_LENGTH, Math.max(0, yard));
  if (visual.sampled[index] === 0) {
    visual.sampledHeights[index] = visual.groundY(
      visual.x + visual.dirX * index,
      visual.z + visual.dirZ * index,
    );
    visual.sampled[index] = 1;
  }
  return visual.sampledHeights[index];
}

function heightAtDistance(visual: GravefireVisual, distance: number): number {
  const clamped = Math.min(NYTHRAXIS_GRAVEFIRE_LENGTH, Math.max(0, distance));
  const lower = Math.floor(clamped);
  const upper = Math.ceil(clamped);
  const low = ensureHeightSample(visual, lower);
  if (upper === lower) return low;
  const high = ensureHeightSample(visual, upper);
  return low + (high - low) * (clamped - lower);
}

function writeQuad(
  visual: GravefireVisual,
  layer: number,
  segment: number,
  start: number,
  end: number,
  offsetA: number,
  offsetB: number,
  lift: number,
): void {
  const base = (layer * MAX_SEGMENTS + segment) * QUAD_VERTEX_COUNT * 3;
  const crossX = -visual.dirZ;
  const crossZ = visual.dirX;
  const startX = visual.x + visual.dirX * start;
  const startZ = visual.z + visual.dirZ * start;
  const endX = visual.x + visual.dirX * end;
  const endZ = visual.z + visual.dirZ * end;
  const startY = heightAtDistance(visual, start) + lift;
  const endY = heightAtDistance(visual, end) + lift;
  const positions = visual.positions;

  positions[base] = startX + crossX * offsetA;
  positions[base + 1] = startY;
  positions[base + 2] = startZ + crossZ * offsetA;
  positions[base + 3] = startX + crossX * offsetB;
  positions[base + 4] = startY;
  positions[base + 5] = startZ + crossZ * offsetB;
  positions[base + 6] = endX + crossX * offsetB;
  positions[base + 7] = endY;
  positions[base + 8] = endZ + crossZ * offsetB;
  positions[base + 9] = endX + crossX * offsetA;
  positions[base + 10] = endY;
  positions[base + 11] = endZ + crossZ * offsetA;
}

function writeLayerWindow(
  visual: GravefireVisual,
  layer: number,
  start: number,
  end: number,
  offsetA: number,
  offsetB: number,
  lift: number,
): void {
  let cursor = start;
  let used = 0;
  while (cursor < end - 1e-6 && used < MAX_SEGMENTS) {
    const next = Math.min(end, Math.floor(cursor) + 1);
    writeQuad(visual, layer, used, cursor, next, offsetA, offsetB, lift);
    cursor = next;
    used++;
  }
  for (; used < MAX_SEGMENTS; used++) {
    writeQuad(visual, layer, used, end, end, 0, 0, lift);
  }
}

function rewriteStrip(visual: GravefireVisual): void {
  const { plan } = visual;
  const halfWidth = plan.halfWidth;
  const inner = halfWidth * 0.82;
  writeLayerWindow(
    visual,
    UNDERLAY_LAYER,
    plan.tail,
    plan.head,
    -halfWidth,
    halfWidth,
    NYTHRAXIS_GRAVEFIRE_GROUND_LIFT - 0.015,
  );
  writeLayerWindow(
    visual,
    CORE_LAYER,
    plan.tail,
    plan.head,
    -inner,
    inner,
    NYTHRAXIS_GRAVEFIRE_GROUND_LIFT,
  );
  writeLayerWindow(
    visual,
    LEFT_RIM_LAYER,
    plan.tail,
    plan.head,
    -halfWidth,
    -inner,
    NYTHRAXIS_GRAVEFIRE_GROUND_LIFT + 0.01,
  );
  writeLayerWindow(
    visual,
    RIGHT_RIM_LAYER,
    plan.tail,
    plan.head,
    inner,
    halfWidth,
    NYTHRAXIS_GRAVEFIRE_GROUND_LIFT + 0.01,
  );
  writeLayerWindow(
    visual,
    HEAD_LAYER,
    plan.headCapTail,
    plan.head,
    -inner,
    inner,
    NYTHRAXIS_GRAVEFIRE_GROUND_LIFT + 0.02,
  );
  visual.mesh.geometry.getAttribute('position').needsUpdate = true;
  const sphere = visual.mesh.geometry.boundingSphere;
  if (sphere) {
    const middle = (plan.tail + plan.head) * 0.5;
    sphere.center.set(
      (plan.tailX + plan.headX) * 0.5,
      heightAtDistance(visual, middle) + NYTHRAXIS_GRAVEFIRE_GROUND_LIFT,
      (plan.tailZ + plan.headZ) * 0.5,
    );
    sphere.radius = Math.max(1, plan.length * 0.5 + halfWidth + 1);
  }
}

function visualFromGroup(
  group: THREE.Group,
  groundY: (x: number, z: number) => number,
  row: ActiveNythraxisGravefire,
): GravefireVisual {
  const visual: GravefireVisual = {
    group,
    mesh: group.userData.mesh as GravefireVisual['mesh'],
    positions: group.userData.positions as Float32Array,
    underlayMaterial: group.userData.underlayMaterial as THREE.MeshBasicMaterial,
    coreMaterial: group.userData.coreMaterial as THREE.MeshBasicMaterial,
    rimMaterial: group.userData.rimMaterial as THREE.MeshBasicMaterial,
    headMaterial: group.userData.headMaterial as THREE.MeshBasicMaterial,
    sampledHeights: new Float32Array(NYTHRAXIS_GRAVEFIRE_LENGTH + 1),
    sampled: new Uint8Array(NYTHRAXIS_GRAVEFIRE_LENGTH + 1),
    plan: {
      tail: 0,
      head: 0,
      tailX: 0,
      tailZ: 0,
      headX: 0,
      headZ: 0,
      headCapTail: 0,
      length: 0,
      halfWidth: 0,
    },
    groundY,
    x: row.x,
    z: row.z,
    dirX: row.dirX,
    dirZ: row.dirZ,
    tail: row.tail,
    head: row.head,
    halfWidth: row.halfWidth,
    phase: 0,
  };
  nythraxisGravefirePlanInto(visual.plan, row);
  return visual;
}

export function buildNythraxisGravefireStrip(
  row: ActiveNythraxisGravefire,
  groundY: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = NYTHRAXIS_GRAVEFIRE_VISUAL_NAME;
  group.userData.renderCategory = 'ui3d';
  group.userData.actionable = true;
  group.userData.gravefireId = row.id;
  group.userData.sourceId = row.sourceId;
  group.userData.halfWidth = row.halfWidth;

  const underlayMaterial = stripMaterial(
    NYTHRAXIS_GRAVEFIRE_PALETTE.underlay,
    0.68,
    THREE.NormalBlending,
  );
  const coreMaterial = stripMaterial(NYTHRAXIS_GRAVEFIRE_PALETTE.core, 0.87, THREE.NormalBlending);
  const rimMaterial = stripMaterial(NYTHRAXIS_GRAVEFIRE_PALETTE.rim, 0.9, THREE.AdditiveBlending);
  const headMaterial = stripMaterial(
    NYTHRAXIS_GRAVEFIRE_PALETTE.head,
    0.93,
    THREE.AdditiveBlending,
  );
  const { geometry, positions } = buildStripGeometry();
  const mesh = new THREE.Mesh(geometry, [
    underlayMaterial,
    coreMaterial,
    rimMaterial,
    headMaterial,
  ]);
  mesh.name = NYTHRAXIS_GRAVEFIRE_STRIP_NAME;
  mesh.renderOrder = 14;
  mesh.userData.renderCategory = 'ui3d';
  mesh.userData.actionable = true;
  group.add(mesh);

  group.userData.mesh = mesh;
  group.userData.positions = positions;
  group.userData.underlayMaterial = underlayMaterial;
  group.userData.coreMaterial = coreMaterial;
  group.userData.rimMaterial = rimMaterial;
  group.userData.headMaterial = headMaterial;
  const visual = visualFromGroup(group, groundY, row);
  group.userData.visual = visual;
  rewriteStrip(visual);
  return group;
}

function applyRow(visual: GravefireVisual, row: ActiveNythraxisGravefire): void {
  const axisChanged =
    visual.x !== row.x ||
    visual.z !== row.z ||
    visual.dirX !== row.dirX ||
    visual.dirZ !== row.dirZ;
  const windowChanged =
    axisChanged ||
    visual.tail !== row.tail ||
    visual.head !== row.head ||
    visual.halfWidth !== row.halfWidth;
  if (!windowChanged) return;
  visual.x = row.x;
  visual.z = row.z;
  visual.dirX = row.dirX;
  visual.dirZ = row.dirZ;
  visual.tail = row.tail;
  visual.head = row.head;
  visual.halfWidth = row.halfWidth;
  nythraxisGravefirePlanInto(visual.plan, row);
  visual.group.userData.halfWidth = row.halfWidth;
  if (axisChanged) visual.sampled.fill(0);
  rewriteStrip(visual);
}

function disposeVisual(visual: GravefireVisual): void {
  visual.mesh.geometry.dispose();
  visual.underlayMaterial.dispose();
  visual.coreMaterial.dispose();
  visual.rimMaterial.dispose();
  visual.headMaterial.dispose();
  visual.group.removeFromParent();
}

export class NythraxisGravefireVisuals {
  private readonly visuals = new Map<string, GravefireVisual>();
  private readonly activeIds = new Set<string>();
  private readonly pulse: NythraxisGravefirePulse = { core: 0, rim: 0, head: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
  ) {}

  sync(rows: readonly ActiveNythraxisGravefire[]): void {
    if (rows.length === 0 && this.visuals.size === 0) return;
    this.activeIds.clear();
    for (const row of rows) {
      this.activeIds.add(row.id);
      const existing = this.visuals.get(row.id);
      if (existing) {
        applyRow(existing, row);
        continue;
      }
      const group = buildNythraxisGravefireStrip(row, this.groundY);
      this.scene.add(group);
      this.visuals.set(row.id, group.userData.visual as GravefireVisual);
    }
    for (const [id, visual] of this.visuals) {
      if (this.activeIds.has(id)) continue;
      disposeVisual(visual);
      this.visuals.delete(id);
    }
  }

  syncWorld(world: { activeNythraxisGravefires: readonly ActiveNythraxisGravefire[] }): void {
    this.sync(world.activeNythraxisGravefires);
  }

  update(dt: number, reducedMotion = false): void {
    const step = Math.max(0, dt);
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) visual.phase = (visual.phase + step * 1.8) % TWO_PI;
      const pulse = nythraxisGravefirePulseInto(this.pulse, visual.phase, reducedMotion);
      visual.coreMaterial.opacity = pulse.core;
      visual.rimMaterial.opacity = pulse.rim;
      visual.headMaterial.opacity = pulse.head;
    }
  }

  dispose(): void {
    for (const visual of this.visuals.values()) disposeVisual(visual);
    this.visuals.clear();
    this.activeIds.clear();
  }
}

export function buildNythraxisGravefirePrewarmVisual(): THREE.Group {
  return buildNythraxisGravefireStrip(
    {
      id: 'prewarm-gravefire',
      sourceId: 0,
      x: 0,
      z: 0,
      dirX: 0,
      dirZ: 1,
      tail: 0,
      head: 8,
      halfWidth: 1.5,
      remaining: 1,
    },
    () => 0,
  );
}

export const nythraxisGravefireVisualInternalsForTest = {
  maxSegments: MAX_SEGMENTS,
  layerCount: LAYER_COUNT,
  coreLayer: CORE_LAYER,
  headLayer: HEAD_LAYER,
};

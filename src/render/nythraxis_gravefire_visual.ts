// Nythraxis Gravefire: one line of grave-fire per authoritative lit window.
// The footprint (the window times the half-width, exactly what the sim burns)
// is a terrain-draped strip: a dark scorched underlay, a faint glow down the
// middle, a bright legible edge line on each side, and a brighter two-yard
// head cap. On top of it a fixed budget of instanced flame tongues, scattered
// deterministically along the lit yards, makes it read as fire rather than as
// a painted stripe. Every row owns one preallocated strip geometry (positions
// rewritten in place as the window slides, one-yard ground samples cached as
// the head reaches them) and one instanced tongue mesh (the tongue geometry
// itself is module-shared, nythraxis_flame_tongue.ts). Graphics tiers never
// reach this painter: the footprint is actionable on every preset.

import * as THREE from 'three';
import {
  type ActiveNythraxisGravefire,
  NYTHRAXIS_GRAVEFIRE_LENGTH,
} from '../sim/nythraxis_gravefire';
import { METEOR_FLAME_GEOMETRY_HALF_HEIGHT } from './mage_ground_fx';
import { NythraxisFireInstances, nythraxisPropAsset } from './nythraxis_fire_assets';
import { NYTHRAXIS_FLAME_TONGUE_MAX_HEIGHT } from './nythraxis_flame_tongue';
import {
  NYTHRAXIS_GRAVEFIRE_EDGE_WIDTH,
  NYTHRAXIS_GRAVEFIRE_GLOW_FRACTION,
  NYTHRAXIS_GRAVEFIRE_GROUND_LIFT,
  NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY,
  NYTHRAXIS_GRAVEFIRE_MODELLED_TONGUES_PER_YARD,
  NYTHRAXIS_GRAVEFIRE_PALETTE,
  NYTHRAXIS_GRAVEFIRE_TONGUE_UPDATE_SECONDS,
  NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD,
  type NythraxisGravefirePlan,
  type NythraxisGravefirePulse,
  type NythraxisGravefireTonguePose,
  nythraxisGravefirePlanInto,
  nythraxisGravefirePulseInto,
  nythraxisGravefireTongueCount,
  nythraxisGravefireTonguePoseInto,
} from './nythraxis_gravefire_core';

export const NYTHRAXIS_GRAVEFIRE_VISUAL_NAME = 'nythraxis-gravefire';
export const NYTHRAXIS_GRAVEFIRE_STRIP_NAME = 'nythraxis-gravefire-strip';
export const NYTHRAXIS_GRAVEFIRE_TONGUES_NAME = 'nythraxis-gravefire-tongues';

const MAX_SEGMENTS = NYTHRAXIS_GRAVEFIRE_LENGTH;
const QUAD_VERTEX_COUNT = 4;
const QUAD_INDEX_COUNT = 6;
// Strip layers, each a run of one-yard quads along the window.
const UNDERLAY_LAYER = 0;
const GLOW_LAYER = 1;
const LEFT_EDGE_LAYER = 2;
const RIGHT_EDGE_LAYER = 3;
const HEAD_LAYER = 4;
const LAYER_COUNT = 5;
// Material slots the layers draw with.
const UNDERLAY_MATERIAL = 0;
const GLOW_MATERIAL = 1;
const EDGE_MATERIAL = 2;
const HEAD_MATERIAL = 3;
const TWO_PI = Math.PI * 2;

interface GravefireVisual {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  positions: Float32Array;
  underlayMaterial: THREE.MeshBasicMaterial;
  glowMaterial: THREE.MeshBasicMaterial;
  edgeMaterial: THREE.MeshBasicMaterial;
  headMaterial: THREE.MeshBasicMaterial;
  fire: NythraxisFireInstances;
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
  tongueElapsed: number;
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
  const materialFor = (layer: number): number => {
    if (layer === UNDERLAY_LAYER) return UNDERLAY_MATERIAL;
    if (layer === GLOW_LAYER) return GLOW_MATERIAL;
    if (layer === HEAD_LAYER) return HEAD_MATERIAL;
    return EDGE_MATERIAL;
  };
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    geometry.addGroup(
      layer * MAX_SEGMENTS * QUAD_INDEX_COUNT,
      MAX_SEGMENTS * QUAD_INDEX_COUNT,
      materialFor(layer),
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
  const glow = halfWidth * NYTHRAXIS_GRAVEFIRE_GLOW_FRACTION;
  const edgeInner = Math.max(0, halfWidth - NYTHRAXIS_GRAVEFIRE_EDGE_WIDTH);
  const lift = NYTHRAXIS_GRAVEFIRE_GROUND_LIFT;
  writeLayerWindow(
    visual,
    UNDERLAY_LAYER,
    plan.tail,
    plan.head,
    -halfWidth,
    halfWidth,
    lift - 0.015,
  );
  writeLayerWindow(visual, GLOW_LAYER, plan.tail, plan.head, -glow, glow, lift);
  writeLayerWindow(
    visual,
    LEFT_EDGE_LAYER,
    plan.tail,
    plan.head,
    -halfWidth,
    -edgeInner,
    lift + 0.01,
  );
  writeLayerWindow(
    visual,
    RIGHT_EDGE_LAYER,
    plan.tail,
    plan.head,
    edgeInner,
    halfWidth,
    lift + 0.01,
  );
  writeLayerWindow(visual, HEAD_LAYER, plan.headCapTail, plan.head, -glow, glow, lift + 0.02);
  visual.mesh.geometry.getAttribute('position').needsUpdate = true;
  const sphere = visual.mesh.geometry.boundingSphere;
  if (sphere) {
    const middle = (plan.tail + plan.head) * 0.5;
    sphere.center.set(
      (plan.tailX + plan.headX) * 0.5,
      heightAtDistance(visual, middle) + lift,
      (plan.tailZ + plan.headZ) * 0.5,
    );
    sphere.radius = Math.max(1, plan.length * 0.5 + halfWidth + 1);
  }
}

const TONGUE_POSE: NythraxisGravefireTonguePose = {
  along: 0,
  across: 0,
  y: 0,
  height: 0,
  width: 0,
  yaw: 0,
  visible: false,
};
const TONGUE_DUMMY = new THREE.Object3D();

/** Tongues per yard for the fire a line draws: the modelled bank is sparser than the quads. */
function tonguesPerYard(usesAsset: boolean): number {
  return usesAsset
    ? NYTHRAXIS_GRAVEFIRE_MODELLED_TONGUES_PER_YARD
    : NYTHRAXIS_GRAVEFIRE_TONGUES_PER_YARD;
}

/** The fire for one line: the modelled Gravefire bank when loaded, else the procedural quad. */
function newGravefireFire(): NythraxisFireInstances {
  return new NythraxisFireInstances(
    'gravefire',
    nythraxisGravefireTongueCount(tonguesPerYard(nythraxisPropAsset('gravefire') !== null)),
    {
      color: NYTHRAXIS_GRAVEFIRE_PALETTE.tongue,
      opacity: NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY.tongue,
      unitHeight: NYTHRAXIS_FLAME_TONGUE_MAX_HEIGHT,
    },
    NYTHRAXIS_GRAVEFIRE_TONGUES_NAME,
    15,
  );
}

/** Re-pose every tongue instance for the current window and phase. */
function poseTongues(visual: GravefireVisual, reducedMotion: boolean): void {
  const { plan, fire } = visual;
  const crossX = -visual.dirZ;
  const crossZ = visual.dirX;
  // The modelled tongue is a run of flame along its own X axis with its foot at
  // y 0: lay it along the line, keeping the hashed yaw as a small jitter so the
  // run never tiles. The procedural quad is centred and faces any way.
  const heading = Math.atan2(-visual.dirZ, visual.dirX);
  const halfHeight = fire.usesAsset ? 0 : METEOR_FLAME_GEOMETRY_HALF_HEIGHT;
  const perYard = tonguesPerYard(fire.usesAsset);
  for (let index = 0; index < fire.count; index++) {
    const pose = nythraxisGravefireTonguePoseInto(
      TONGUE_POSE,
      index,
      plan,
      visual.phase,
      reducedMotion,
      halfHeight,
      perYard,
    );
    if (!pose.visible) {
      TONGUE_DUMMY.position.set(0, -1000, 0);
      TONGUE_DUMMY.rotation.set(0, 0, 0);
      TONGUE_DUMMY.scale.set(0, 0, 0);
    } else {
      TONGUE_DUMMY.position.set(
        visual.x + visual.dirX * pose.along + crossX * pose.across,
        heightAtDistance(visual, pose.along) + NYTHRAXIS_GRAVEFIRE_GROUND_LIFT + pose.y,
        visual.z + visual.dirZ * pose.along + crossZ * pose.across,
      );
      TONGUE_DUMMY.rotation.set(
        0,
        fire.usesAsset ? heading + (pose.yaw - Math.PI) * 0.12 : pose.yaw,
        0,
      );
      // The modelled bank keeps its authored proportions (near-uniform scale,
      // a little shorter along the line so neighbours interleave); the quad
      // takes its own width.
      if (fire.usesAsset) {
        TONGUE_DUMMY.scale.set(pose.height * 0.75, pose.height, pose.height);
      } else {
        TONGUE_DUMMY.scale.set(pose.width, pose.height, pose.width);
      }
    }
    TONGUE_DUMMY.updateMatrix();
    fire.setMatrixAt(index, TONGUE_DUMMY.matrix);
  }
  fire.commit();
  const sphere = visual.mesh.geometry.boundingSphere;
  if (sphere) fire.setBoundingSphere(sphere.center, sphere.radius + fire.unitHeight);
}

/** Once the model has loaded, a line still drawing the procedural quad swaps over. */
function upgradeFire(visual: GravefireVisual, reducedMotion: boolean): void {
  if (visual.fire.usesAsset || !nythraxisPropAsset('gravefire')) return;
  visual.fire.dispose();
  visual.fire = newGravefireFire();
  visual.fire.addTo(visual.group);
  visual.group.userData.fire = visual.fire;
  poseTongues(visual, reducedMotion);
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
    glowMaterial: group.userData.glowMaterial as THREE.MeshBasicMaterial,
    edgeMaterial: group.userData.edgeMaterial as THREE.MeshBasicMaterial,
    headMaterial: group.userData.headMaterial as THREE.MeshBasicMaterial,
    fire: group.userData.fire as NythraxisFireInstances,
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
    tongueElapsed: 0,
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

  const opacity = NYTHRAXIS_GRAVEFIRE_LAYER_OPACITY;
  const palette = NYTHRAXIS_GRAVEFIRE_PALETTE;
  const underlayMaterial = stripMaterial(palette.underlay, opacity.underlay, THREE.NormalBlending);
  const glowMaterial = stripMaterial(palette.glow, opacity.glow, THREE.AdditiveBlending);
  const edgeMaterial = stripMaterial(palette.edge, opacity.edge, THREE.AdditiveBlending);
  const headMaterial = stripMaterial(palette.head, opacity.head, THREE.AdditiveBlending);
  const { geometry, positions } = buildStripGeometry();
  const mesh = new THREE.Mesh(geometry, [
    underlayMaterial,
    glowMaterial,
    edgeMaterial,
    headMaterial,
  ]);
  mesh.name = NYTHRAXIS_GRAVEFIRE_STRIP_NAME;
  mesh.renderOrder = 14;
  mesh.userData.renderCategory = 'ui3d';
  mesh.userData.actionable = true;
  group.add(mesh);

  const fire = newGravefireFire();
  fire.addTo(group);

  group.userData.mesh = mesh;
  group.userData.positions = positions;
  group.userData.underlayMaterial = underlayMaterial;
  group.userData.glowMaterial = glowMaterial;
  group.userData.edgeMaterial = edgeMaterial;
  group.userData.headMaterial = headMaterial;
  group.userData.fire = fire;
  const visual = visualFromGroup(group, groundY, row);
  group.userData.visual = visual;
  rewriteStrip(visual);
  poseTongues(visual, false);
  return group;
}

function applyRow(visual: GravefireVisual, row: ActiveNythraxisGravefire): boolean {
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
  if (!windowChanged) return false;
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
  return true;
}

function disposeVisual(visual: GravefireVisual): void {
  visual.mesh.geometry.dispose();
  visual.underlayMaterial.dispose();
  visual.glowMaterial.dispose();
  visual.edgeMaterial.dispose();
  visual.headMaterial.dispose();
  // The tongue geometry (procedural or the prepared model) is shared: the fire
  // helper disposes its instance buffers and material clones, never geometry.
  visual.fire.dispose();
  visual.group.removeFromParent();
}

export class NythraxisGravefireVisuals {
  private readonly visuals = new Map<string, GravefireVisual>();
  private readonly activeIds = new Set<string>();
  private readonly pulse: NythraxisGravefirePulse = { edge: 0, glow: 0, head: 0, tongue: 0 };
  private reducedMotion = false;

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
        upgradeFire(existing, this.reducedMotion);
        // A moved window re-poses the tongues at once so the fire never lags
        // behind the footprint that burns.
        if (applyRow(existing, row)) poseTongues(existing, this.reducedMotion);
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
    this.reducedMotion = reducedMotion;
    for (const visual of this.visuals.values()) {
      if (!reducedMotion) visual.phase = (visual.phase + step * 1.8) % TWO_PI;
      const pulse = nythraxisGravefirePulseInto(this.pulse, visual.phase, reducedMotion);
      visual.edgeMaterial.opacity = pulse.edge;
      visual.glowMaterial.opacity = pulse.glow;
      visual.headMaterial.opacity = pulse.head;
      visual.fire.setOpacity(pulse.tongue);
      // The tongues flicker at 20 Hz, not every frame: continuous to the eye,
      // bounded on the CPU (the patch painter's cadence).
      visual.tongueElapsed += step;
      if (visual.tongueElapsed >= NYTHRAXIS_GRAVEFIRE_TONGUE_UPDATE_SECONDS) {
        visual.tongueElapsed = 0;
        poseTongues(visual, reducedMotion);
      }
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
  glowLayer: GLOW_LAYER,
  leftEdgeLayer: LEFT_EDGE_LAYER,
  headLayer: HEAD_LAYER,
  underlayMaterial: UNDERLAY_MATERIAL,
  glowMaterial: GLOW_MATERIAL,
  edgeMaterial: EDGE_MATERIAL,
  headMaterial: HEAD_MATERIAL,
};

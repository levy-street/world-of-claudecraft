// Presentation for Revolving Inferno. The floor lane stays authoritative while
// the damaging phase adds a high, layered fire wall inside that exact footprint.

import * as THREE from 'three';
import {
  IGNIVAR_ROTATING_RAYS_COUNT,
  IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
  IGNIVAR_ROTATING_RAYS_INNER_RANGE,
  IGNIVAR_ROTATING_RAYS_RANGE,
} from '../sim/ignivar_arena';
import {
  buildIgnivarFireBeam,
  type IgnivarFireBeamPhase,
  syncIgnivarFireBeamPresentation,
} from './ignivar_fire_beams';

export const IGNIVAR_ROTATING_RAYS_VISUAL_NAME = 'ignivarRotatingRaysTelegraph';
export const IGNIVAR_ROTATING_RAY_FILL_NAME = 'ignivarRotatingRayFill';
export const IGNIVAR_ROTATING_RAY_BORDER_NAME = 'ignivarRotatingRayBorder';
export const IGNIVAR_ROTATING_RAY_TICKS_NAME = 'ignivarRotatingRayHeatTicks';
export const IGNIVAR_ROTATING_RAY_BLADE_NAME = 'ignivarRotatingRayBlade';

function telegraphMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  material.forceSinglePass = true;
  material.userData.ignivarTelegraphBaseOpacity = opacity;
  return material;
}

function addFloorQuad(
  positions: number[],
  indices: number[],
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
  y: number,
): void {
  const vertex = positions.length / 3;
  positions.push(xMin, y, zMin, xMax, y, zMin, xMin, y, zMax, xMax, y, zMax);
  indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
}

function floorGeometry(
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
  y: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  addFloorQuad(positions, indices, xMin, xMax, zMin, zMax, y);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function buildLaneFill(): THREE.Mesh {
  const fill = new THREE.Mesh(
    floorGeometry(
      -IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
      IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
      IGNIVAR_ROTATING_RAYS_INNER_RANGE,
      IGNIVAR_ROTATING_RAYS_RANGE,
      0.058,
    ),
    telegraphMaterial(0x5a0802, 0.12),
  );
  fill.name = IGNIVAR_ROTATING_RAY_FILL_NAME;
  fill.renderOrder = 2;
  fill.userData.telegraphLayer = 'fill';
  return fill;
}

function buildLaneBorder(): THREE.Mesh {
  const width = IGNIVAR_ROTATING_RAYS_HALF_WIDTH;
  const edge = Math.min(0.11, width * 0.18);
  const inner = IGNIVAR_ROTATING_RAYS_INNER_RANGE;
  const range = IGNIVAR_ROTATING_RAYS_RANGE;
  const positions: number[] = [];
  const indices: number[] = [];
  addFloorQuad(positions, indices, -width, -width + edge, inner, range, 0.084);
  addFloorQuad(positions, indices, width - edge, width, inner, range, 0.084);
  addFloorQuad(positions, indices, -width, width, inner, inner + edge, 0.084);
  addFloorQuad(positions, indices, -width, width, range - edge, range, 0.084);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const border = new THREE.Mesh(geometry, telegraphMaterial(0xe15a20, 0.68));
  border.name = IGNIVAR_ROTATING_RAY_BORDER_NAME;
  border.renderOrder = 4;
  border.userData.telegraphLayer = 'border';
  return border;
}

function buildHeatTicks(): THREE.Group {
  const ticks = new THREE.Group();
  ticks.name = IGNIVAR_ROTATING_RAY_TICKS_NAME;
  ticks.userData.telegraphLayer = 'heatTicks';
  const count = 10;
  const usableLength = IGNIVAR_ROTATING_RAYS_RANGE - IGNIVAR_ROTATING_RAYS_INNER_RANGE;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  for (let index = 0; index < count; index++) {
    const progress = (index + 0.65) / count;
    const z = IGNIVAR_ROTATING_RAYS_INNER_RANGE + usableLength * progress;
    const halfDepth = 0.07 + (index % 2) * 0.025;
    const halfWidth = IGNIVAR_ROTATING_RAYS_HALF_WIDTH * (index % 2 === 0 ? 0.76 : 0.56);
    addFloorQuad(positions, indices, -halfWidth, halfWidth, z - halfDepth, z + halfDepth, 0.096);
    const color = new THREE.Color(index % 2 === 0 ? 0xff6a0b : 0xffd46c);
    for (let vertex = 0; vertex < 4; vertex++) colors.push(color.r, color.g, color.b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const material = telegraphMaterial(0xffffff, 0.3);
  material.vertexColors = true;
  const batchedTicks = new THREE.Mesh(geometry, material);
  batchedTicks.renderOrder = 3;
  batchedTicks.userData.visibleTickCount = count;
  ticks.userData.visibleTickCount = count;
  ticks.add(batchedTicks);
  return ticks;
}

function buildFlameBlade(): THREE.Group {
  const blade = new THREE.Group();
  blade.name = IGNIVAR_ROTATING_RAY_BLADE_NAME;
  blade.position.set(0, 1.05, IGNIVAR_ROTATING_RAYS_RANGE - 1);
  blade.userData.gameplayGeometry = false;

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.forceSinglePass = true;
  material.userData.ignivarThermalLayer = 'flameTip';
  const geometry = new THREE.ConeGeometry(0.2, 1, 6, 1, true);
  const tongueCount = 7;
  const tongues = new THREE.InstancedMesh(geometry, material, tongueCount);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < 7; index++) {
    const lateral = (index - 3) * 0.24;
    const height = 1.05 + ((index * 5) % 4) * 0.24;
    dummy.position.set(lateral, height * 0.08 - 0.18, ((index * 7) % 3) * 0.14 - 0.14);
    dummy.scale.set(0.72 + (index % 2) * 0.18, height, 0.72 + ((index + 1) % 2) * 0.16);
    dummy.rotation.set(0, 0, lateral * -0.42);
    dummy.updateMatrix();
    tongues.setMatrixAt(index, dummy.matrix);
    tongues.setColorAt(
      index,
      new THREE.Color(index % 4 === 0 ? 0xfff2b0 : index % 2 === 0 ? 0xffb02e : 0xff5a0a),
    );
  }
  tongues.instanceMatrix.needsUpdate = true;
  if (tongues.instanceColor) tongues.instanceColor.needsUpdate = true;
  tongues.renderOrder = 12;
  blade.add(tongues);
  blade.visible = false;
  return blade;
}

function setTelegraphOpacity(object: THREE.Object3D, multiplier: number): void {
  object.traverse((child) => {
    const renderable = child as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
    };
    if (!renderable.material) return;
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material];
    for (const material of materials) {
      const base = Number(material.userData.ignivarTelegraphBaseOpacity ?? material.opacity);
      material.opacity = base * multiplier;
    }
  });
}

export function buildIgnivarRotatingRaysTelegraph(): THREE.Group {
  const root = new THREE.Group();
  root.name = IGNIVAR_ROTATING_RAYS_VISUAL_NAME;
  for (let ray = 0; ray < IGNIVAR_ROTATING_RAYS_COUNT; ray++) {
    const offset = (ray * Math.PI * 2) / IGNIVAR_ROTATING_RAYS_COUNT;
    const fill = buildLaneFill();
    const border = buildLaneBorder();
    const ticks = buildHeatTicks();
    const fireBeam = buildIgnivarFireBeam({
      innerRange: IGNIVAR_ROTATING_RAYS_INNER_RANGE,
      range: IGNIVAR_ROTATING_RAYS_RANGE,
      startHalfWidth: IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
      endHalfWidth: IGNIVAR_ROTATING_RAYS_HALF_WIDTH,
    });
    fireBeam.add(buildFlameBlade());
    for (const visual of [fill, border, ticks, fireBeam]) {
      visual.rotation.y = offset;
      visual.userData.rayIndex = ray;
      root.add(visual);
    }
  }
  root.userData.renderCategory = 'ui3d';
  root.visible = false;
  return root;
}

/**
 * Stages every Revolving Inferno material (lane fills, borders, vertex-colour
 * heat ticks, the animated fire-beam shells, and the instanced flame blades)
 * before the boss is pulled. Its own idle unit: each ray carries a full
 * fire-beam lane, so sharing a unit with the other telegraphs would
 * concatenate the builds into one long task.
 */
export function buildIgnivarRotatingRaysPrewarmVisual(): THREE.Group {
  const root = buildIgnivarRotatingRaysTelegraph();
  root.name = 'ignivar-rotating-rays-prewarm';
  // Exercise the damaging phase the way the live sync reveals it, then show
  // the phase-hidden leftovers too so every program links.
  syncIgnivarRotatingRaysTelegraph(root, 'active', 1, 1);
  root.traverse((child) => {
    child.visible = true;
  });
  return root;
}

export function syncIgnivarRotatingRaysTelegraph(
  root: THREE.Object3D,
  phase: IgnivarFireBeamPhase,
  windupProgress: number,
  inverseEntityScale: number,
): void {
  root.userData.phase = phase;
  root.userData.windupProgress = Math.max(0, Math.min(1, windupProgress));
  root.scale.setScalar(inverseEntityScale);
  root.visible = phase !== 'hidden';
  if (phase === 'hidden') return;

  for (const child of root.children) {
    if (child.userData.vfxLayer === 'fireBeam') {
      syncIgnivarFireBeamPresentation(child, phase, windupProgress);
      const blade = child.getObjectByName(IGNIVAR_ROTATING_RAY_BLADE_NAME);
      if (blade) blade.visible = phase === 'active';
      continue;
    }
    const layer = child.userData.telegraphLayer as string | undefined;
    if (layer === 'fill')
      setTelegraphOpacity(child, phase === 'windup' ? 0.78 + windupProgress * 0.22 : 0.2);
    if (layer === 'border') setTelegraphOpacity(child, phase === 'windup' ? 1 : 0.18);
    if (layer === 'heatTicks') {
      child.visible = true;
      setTelegraphOpacity(child, phase === 'windup' ? 0.55 + windupProgress * 0.45 : 0.12);
    }
  }
}

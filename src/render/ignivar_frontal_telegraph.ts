// Searing Torrent presentation. The cone uses a hard inward border and heat
// bands so its exact authoritative footprint survives dark floors and mobile.

import * as THREE from 'three';
import { IGNIVAR_FRONTAL_HALF_ANGLE, IGNIVAR_FRONTAL_RANGE } from '../sim/ignivar_arena';

export const IGNIVAR_FRONTAL_VISUAL_NAME = 'ignivarFrontalTelegraph';
export const IGNIVAR_FRONTAL_FILL_NAME = 'ignivarFrontalFill';
export const IGNIVAR_FRONTAL_BORDER_NAME = 'ignivarFrontalBorder';
export const IGNIVAR_FRONTAL_HEAT_BANDS_NAME = 'ignivarFrontalHeatBands';
export const IGNIVAR_FRONTAL_FLAME_CURTAINS_NAME = 'ignivarFrontalFlameCurtains';

function material(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function addQuad(
  positions: number[],
  indices: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
): void {
  const vertex = positions.length / 3;
  positions.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray());
  indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
}

function wedgeGeometry(radius: number, segments: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [0, y, 0];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = -IGNIVAR_FRONTAL_HALF_ANGLE + (index / segments) * IGNIVAR_FRONTAL_HALF_ANGLE * 2;
    positions.push(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
  }
  for (let index = 0; index < segments; index++) indices.push(0, index + 1, index + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function borderGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const width = 0.24;
  for (const side of [-1, 1]) {
    const outerAngle = IGNIVAR_FRONTAL_HALF_ANGLE * side;
    const innerAngle = (IGNIVAR_FRONTAL_HALF_ANGLE - 0.014) * side;
    const outerDirection = new THREE.Vector3(Math.sin(outerAngle), 0, Math.cos(outerAngle));
    const innerDirection = new THREE.Vector3(Math.sin(innerAngle), 0, Math.cos(innerAngle));
    addQuad(
      positions,
      indices,
      outerDirection.clone().multiplyScalar(0.3).setY(0.073),
      innerDirection.clone().multiplyScalar(0.3).setY(0.073),
      outerDirection.clone().multiplyScalar(IGNIVAR_FRONTAL_RANGE).setY(0.073),
      innerDirection.clone().multiplyScalar(IGNIVAR_FRONTAL_RANGE).setY(0.073),
    );
  }
  const segments = 36;
  const inner = IGNIVAR_FRONTAL_RANGE - width;
  for (let index = 0; index < segments; index++) {
    const angleA =
      -IGNIVAR_FRONTAL_HALF_ANGLE + (index / segments) * IGNIVAR_FRONTAL_HALF_ANGLE * 2;
    const angleB =
      -IGNIVAR_FRONTAL_HALF_ANGLE + ((index + 1) / segments) * IGNIVAR_FRONTAL_HALF_ANGLE * 2;
    addQuad(
      positions,
      indices,
      new THREE.Vector3(Math.sin(angleA) * inner, 0.073, Math.cos(angleA) * inner),
      new THREE.Vector3(
        Math.sin(angleA) * IGNIVAR_FRONTAL_RANGE,
        0.073,
        Math.cos(angleA) * IGNIVAR_FRONTAL_RANGE,
      ),
      new THREE.Vector3(Math.sin(angleB) * inner, 0.073, Math.cos(angleB) * inner),
      new THREE.Vector3(
        Math.sin(angleB) * IGNIVAR_FRONTAL_RANGE,
        0.073,
        Math.cos(angleB) * IGNIVAR_FRONTAL_RANGE,
      ),
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function heatBandsGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const segments = 18;
  for (const progress of [0.24, 0.42, 0.6, 0.78]) {
    const outer = IGNIVAR_FRONTAL_RANGE * progress;
    const inner = outer - 0.34;
    for (let index = 0; index < segments; index++) {
      const angleA =
        -IGNIVAR_FRONTAL_HALF_ANGLE + (index / segments) * IGNIVAR_FRONTAL_HALF_ANGLE * 2;
      const angleB =
        -IGNIVAR_FRONTAL_HALF_ANGLE + ((index + 1) / segments) * IGNIVAR_FRONTAL_HALF_ANGLE * 2;
      addQuad(
        positions,
        indices,
        new THREE.Vector3(Math.sin(angleA) * inner, 0.085, Math.cos(angleA) * inner),
        new THREE.Vector3(Math.sin(angleA) * outer, 0.085, Math.cos(angleA) * outer),
        new THREE.Vector3(Math.sin(angleB) * inner, 0.085, Math.cos(angleB) * inner),
        new THREE.Vector3(Math.sin(angleB) * outer, 0.085, Math.cos(angleB) * outer),
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function flameCurtainsGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const slices = 12;
  for (const side of [-1, 1]) {
    const angle = side * (IGNIVAR_FRONTAL_HALF_ANGLE - 0.006);
    const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    for (let index = 0; index < slices; index++) {
      const start = 0.35 + (index / slices) * (IGNIVAR_FRONTAL_RANGE - 0.35);
      const end = 0.35 + ((index + 1) / slices) * (IGNIVAR_FRONTAL_RANGE - 0.35);
      const heightA = 0.68 + ((index * 7) % 5) * 0.15;
      const heightB = 0.68 + (((index + 1) * 7) % 5) * 0.15;
      addQuad(
        positions,
        indices,
        direction.clone().multiplyScalar(start).setY(0.08),
        direction.clone().multiplyScalar(end).setY(0.08),
        direction.clone().multiplyScalar(start).setY(heightA),
        direction.clone().multiplyScalar(end).setY(heightB),
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export function buildIgnivarFrontalTelegraph(): THREE.Group {
  const root = new THREE.Group();
  root.name = IGNIVAR_FRONTAL_VISUAL_NAME;
  root.userData.renderCategory = 'ui3d';

  const fill = new THREE.Mesh(
    wedgeGeometry(IGNIVAR_FRONTAL_RANGE, 36, 0.047),
    material(0xd91808, 0.2),
  );
  fill.name = IGNIVAR_FRONTAL_FILL_NAME;
  fill.renderOrder = 2;
  const border = new THREE.Mesh(borderGeometry(), material(0xff9b2f, 0.88));
  border.name = IGNIVAR_FRONTAL_BORDER_NAME;
  border.renderOrder = 4;
  const heatBands = new THREE.Mesh(heatBandsGeometry(), material(0xff4a12, 0.42));
  heatBands.name = IGNIVAR_FRONTAL_HEAT_BANDS_NAME;
  heatBands.renderOrder = 3;
  const flameCurtains = new THREE.Mesh(flameCurtainsGeometry(), material(0xff6514, 0.58));
  flameCurtains.name = IGNIVAR_FRONTAL_FLAME_CURTAINS_NAME;
  flameCurtains.renderOrder = 6;

  root.add(fill, heatBands, border, flameCurtains);
  root.visible = false;
  return root;
}

export function syncIgnivarFrontalTelegraph(
  root: THREE.Object3D,
  visible: boolean,
  progress: number,
  inverseEntityScale: number,
  dt: number,
): void {
  root.visible = visible;
  root.scale.setScalar(inverseEntityScale);
  root.userData.progress = Math.max(0, Math.min(1, progress));
  if (!visible) return;
  root.userData.elapsed = Number(root.userData.elapsed ?? 0) + Math.max(0, dt);
  const clamped = root.userData.progress as number;
  const pulse = 0.5 + Math.sin(Number(root.userData.elapsed) * (5 + clamped * 5)) * 0.5;
  const fill = root.getObjectByName(IGNIVAR_FRONTAL_FILL_NAME) as THREE.Mesh | undefined;
  const border = root.getObjectByName(IGNIVAR_FRONTAL_BORDER_NAME) as THREE.Mesh | undefined;
  const heatBands = root.getObjectByName(IGNIVAR_FRONTAL_HEAT_BANDS_NAME) as THREE.Mesh | undefined;
  const flameCurtains = root.getObjectByName(IGNIVAR_FRONTAL_FLAME_CURTAINS_NAME) as
    | THREE.Mesh
    | undefined;
  if (fill) (fill.material as THREE.Material).opacity = 0.2 + clamped * 0.16;
  if (border) (border.material as THREE.Material).opacity = 0.88 + clamped * 0.1;
  if (heatBands) {
    (heatBands.material as THREE.Material).opacity = 0.34 + clamped * 0.22 + pulse * 0.08;
    heatBands.scale.setScalar(0.995 + pulse * 0.005);
  }
  if (flameCurtains) {
    (flameCurtains.material as THREE.Material).opacity = 0.3 + clamped * 0.34 + pulse * 0.08;
    flameCurtains.scale.y = 0.18 + clamped * 0.82;
  }
}

// Forgefather's Sweep presentation. The exact 140 degree footprint is always
// rendered; heat bands and a rising flame wall add force without hiding it.

import * as THREE from 'three';
import { VARKHUL_FRONTAL_HALF_ANGLE, VARKHUL_FRONTAL_RANGE } from '../sim/varkhul_frontal';

export const VARKHUL_FRONTAL_VISUAL_NAME = 'varkhulForgefatherSweepTelegraph';

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

function sector(inner: number, outer: number, y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const segments = 48;
  shape.moveTo(
    Math.sin(-VARKHUL_FRONTAL_HALF_ANGLE) * inner,
    Math.cos(-VARKHUL_FRONTAL_HALF_ANGLE) * inner,
  );
  for (let index = 0; index <= segments; index++) {
    const angle = -VARKHUL_FRONTAL_HALF_ANGLE + (index / segments) * VARKHUL_FRONTAL_HALF_ANGLE * 2;
    shape.lineTo(Math.sin(angle) * outer, Math.cos(angle) * outer);
  }
  for (let index = segments; index >= 0; index--) {
    const angle = -VARKHUL_FRONTAL_HALF_ANGLE + (index / segments) * VARKHUL_FRONTAL_HALF_ANGLE * 2;
    shape.lineTo(Math.sin(angle) * inner, Math.cos(angle) * inner);
  }
  const geometry = new THREE.ShapeGeometry(shape, 48);
  // ShapeGeometry's positive Y is the authored forward axis. Rotate it onto
  // positive world Z, which is the sim's facing-zero direction.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function edge(angle: number): THREE.Mesh {
  const length = VARKHUL_FRONTAL_RANGE;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, length), material(0xffd06a, 0.96));
  mesh.name = angle < 0 ? 'varkhulFrontalEdgeLeft' : 'varkhulFrontalEdgeRight';
  mesh.userData.angle = angle;
  mesh.rotation.y = angle;
  mesh.position.set(Math.sin(angle) * length * 0.5, 0.085, Math.cos(angle) * length * 0.5);
  return mesh;
}

export function buildVarkhulFrontalVisual(): THREE.Group {
  const root = new THREE.Group();
  root.name = VARKHUL_FRONTAL_VISUAL_NAME;
  root.userData.renderCategory = 'ui3d';
  root.userData.actionable = true;
  root.userData.radius = VARKHUL_FRONTAL_RANGE;
  root.userData.halfAngle = VARKHUL_FRONTAL_HALF_ANGLE;

  const fill = new THREE.Mesh(sector(0, VARKHUL_FRONTAL_RANGE, 0.05), material(0xc91405, 0.25));
  fill.name = 'varkhulFrontalFill';
  const rim = new THREE.Mesh(
    sector(VARKHUL_FRONTAL_RANGE - 0.55, VARKHUL_FRONTAL_RANGE, 0.075),
    material(0xff9d24, 0.93),
  );
  rim.name = 'varkhulFrontalRim';
  root.add(fill, rim, edge(-VARKHUL_FRONTAL_HALF_ANGLE), edge(VARKHUL_FRONTAL_HALF_ANGLE));

  const bands = new THREE.Group();
  bands.name = 'varkhulFrontalHeatBands';
  for (const fraction of [0.25, 0.45, 0.65, 0.84]) {
    const outer = VARKHUL_FRONTAL_RANGE * fraction;
    bands.add(new THREE.Mesh(sector(outer - 0.38, outer, 0.068), material(0xff5b12, 0.48)));
  }
  root.add(bands);

  const wall = new THREE.Group();
  wall.name = 'varkhulFrontalFlameWall';
  for (let index = 0; index < 15; index++) {
    const angle = -VARKHUL_FRONTAL_HALF_ANGLE + (index / 14) * VARKHUL_FRONTAL_HALF_ANGLE * 2;
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 2.8 + (index % 3) * 0.45, 7, 1, true),
      material(index % 2 === 0 ? 0xff3a08 : 0xffa11b, 0.56),
    );
    flame.position.set(
      Math.sin(angle) * (VARKHUL_FRONTAL_RANGE - 0.75),
      1.1,
      Math.cos(angle) * (VARKHUL_FRONTAL_RANGE - 0.75),
    );
    wall.add(flame);
  }
  root.add(wall);
  root.visible = false;
  return root;
}

export function syncVarkhulFrontalVisual(
  root: THREE.Object3D,
  visible: boolean,
  progress: number,
  inverseScale: number,
  dt: number,
  reducedMotion: boolean,
): void {
  root.visible = visible;
  root.scale.setScalar(inverseScale);
  if (!visible) return;
  const clamped = THREE.MathUtils.clamp(progress, 0, 1);
  root.userData.elapsed = Number(root.userData.elapsed ?? 0) + Math.max(0, dt);
  const pulse = reducedMotion ? 0.5 : 0.5 + Math.sin(Number(root.userData.elapsed) * 8) * 0.5;
  const fill = root.getObjectByName('varkhulFrontalFill') as THREE.Mesh;
  const bands = root.getObjectByName('varkhulFrontalHeatBands') as THREE.Group;
  const wall = root.getObjectByName('varkhulFrontalFlameWall') as THREE.Group;
  (fill.material as THREE.Material).opacity = 0.2 + clamped * 0.22;
  bands.position.y = reducedMotion ? 0 : Math.sin(Number(root.userData.elapsed) * 4) * 0.025;
  wall.scale.y = 0.15 + clamped * 0.85;
  wall.children.forEach((child, index) => {
    const mesh = child as THREE.Mesh;
    (mesh.material as THREE.Material).opacity = 0.34 + clamped * 0.28 + pulse * 0.08;
    mesh.scale.y = reducedMotion
      ? 1
      : 0.88 + Math.sin(Number(root.userData.elapsed) * 7 + index) * 0.12;
  });
}

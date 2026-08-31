import * as THREE from 'three';
import {
  IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE,
  IGNIVAR_FORGE_WAVE_RANGE,
} from '../sim/ignivar_forge_wave';

export const IGNIVAR_FORGE_WAVE_VISUAL_NAME = 'ignivarForgeWave';
export const IGNIVAR_FORGE_WAVE_PREVIEW_NAME = 'ignivarForgeWavePreview';
export const IGNIVAR_FORGE_WAVE_SAFE_LANES_NAME = 'ignivarForgeWaveSafeLanes';
export const IGNIVAR_FORGE_WAVE_WALL_NAME = 'ignivarForgeWaveWall';

const FORGE_WAVE_SEGMENTS = 96;
const TAU = Math.PI * 2;

function angleDistance(a: number, b: number): number {
  const wrapped = (((a - b + Math.PI) % TAU) + TAU) % TAU;
  return Math.abs(wrapped - Math.PI);
}

function dangerAngle(angle: number): boolean {
  return (
    angleDistance(angle, 0) > IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE &&
    angleDistance(angle, Math.PI) > IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE
  );
}

function additiveMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function safeLaneMaterial(): THREE.MeshBasicMaterial {
  const opacity = 0.32;
  const material = new THREE.MeshBasicMaterial({
    color: 0x66ffb3,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  material.userData.baseOpacity = opacity;
  return material;
}

function dangerArcGeometry(inner: number, outer: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let segment = 0; segment < FORGE_WAVE_SEGMENTS; segment++) {
    const a0 = (segment / FORGE_WAVE_SEGMENTS) * TAU;
    const a1 = ((segment + 1) / FORGE_WAVE_SEGMENTS) * TAU;
    const mid = (a0 + a1) * 0.5;
    if (!dangerAngle(mid)) continue;
    positions.push(
      Math.sin(a0) * inner,
      y,
      Math.cos(a0) * inner,
      Math.sin(a0) * outer,
      y,
      Math.cos(a0) * outer,
      Math.sin(a1) * outer,
      y,
      Math.cos(a1) * outer,
      Math.sin(a0) * inner,
      y,
      Math.cos(a0) * inner,
      Math.sin(a1) * outer,
      y,
      Math.cos(a1) * outer,
      Math.sin(a1) * inner,
      y,
      Math.cos(a1) * inner,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function flameWallGeometry(radius: number, height: number, phase: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let segment = 0; segment < FORGE_WAVE_SEGMENTS; segment++) {
    const a0 = (segment / FORGE_WAVE_SEGMENTS) * TAU;
    const a1 = ((segment + 1) / FORGE_WAVE_SEGMENTS) * TAU;
    const mid = (a0 + a1) * 0.5;
    if (!dangerAngle(mid)) continue;
    const h0 = height * (0.82 + 0.18 * Math.sin(segment * 2.17 + phase));
    const h1 = height * (0.82 + 0.18 * Math.sin((segment + 1) * 2.17 + phase));
    positions.push(
      Math.sin(a0) * radius,
      0.06,
      Math.cos(a0) * radius,
      Math.sin(a1) * radius,
      0.06,
      Math.cos(a1) * radius,
      Math.sin(a1) * radius,
      h1,
      Math.cos(a1) * radius,
      Math.sin(a0) * radius,
      0.06,
      Math.cos(a0) * radius,
      Math.sin(a1) * radius,
      h1,
      Math.cos(a1) * radius,
      Math.sin(a0) * radius,
      h0,
      Math.cos(a0) * radius,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function emberGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const candidates = 192;
  for (let index = 0; index < candidates; index++) {
    const angle = ((index + 0.5) / candidates) * TAU;
    if (!dangerAngle(angle)) continue;
    const radius = 0.96 + 0.05 * Math.sin(index * 4.37);
    const height = 0.5 + ((index * 37) % 29) / 8;
    positions.push(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function buildSafeLane(rotation: number): THREE.Group {
  const lane = new THREE.Group();
  lane.rotation.y = rotation;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0,
        0.08,
        0,
        -Math.sin(IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE) * IGNIVAR_FORGE_WAVE_RANGE,
        0.08,
        Math.cos(IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE) * IGNIVAR_FORGE_WAVE_RANGE,
        Math.sin(IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE) * IGNIVAR_FORGE_WAVE_RANGE,
        0.08,
        Math.cos(IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE) * IGNIVAR_FORGE_WAVE_RANGE,
      ],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2]);
  lane.add(new THREE.Mesh(geometry, safeLaneMaterial()));

  const edge = Math.sin(IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE) * IGNIVAR_FORGE_WAVE_RANGE;
  const forward = Math.cos(IGNIVAR_FORGE_WAVE_GAP_HALF_ANGLE) * IGNIVAR_FORGE_WAVE_RANGE;
  lane.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.1, 0),
        new THREE.Vector3(-edge, 0.1, forward),
        new THREE.Vector3(0, 0.1, 0),
        new THREE.Vector3(edge, 0.1, forward),
      ]),
      new THREE.LineBasicMaterial({ color: 0xc8ffe3, transparent: true, opacity: 1 }),
    ),
  );
  return lane;
}

export function buildIgnivarForgeWaveVisual(): THREE.Group {
  const root = new THREE.Group();
  root.name = IGNIVAR_FORGE_WAVE_VISUAL_NAME;
  root.userData.renderCategory = 'ui3d';
  root.userData.safeGapCount = 2;

  const preview = new THREE.Group();
  preview.name = IGNIVAR_FORGE_WAVE_PREVIEW_NAME;
  preview.add(
    new THREE.Mesh(dangerArcGeometry(2.1, 2.65, 0.07), additiveMaterial(0xff5418, 0.48)),
    new THREE.Mesh(dangerArcGeometry(2.3, 2.45, 0.09), additiveMaterial(0xffd36a, 0.9)),
  );

  const safeLanes = new THREE.Group();
  safeLanes.name = IGNIVAR_FORGE_WAVE_SAFE_LANES_NAME;
  safeLanes.add(buildSafeLane(0), buildSafeLane(Math.PI));

  const wall = new THREE.Group();
  wall.name = IGNIVAR_FORGE_WAVE_WALL_NAME;
  wall.userData.segmentCount = 80;
  wall.add(
    new THREE.Mesh(flameWallGeometry(1.03, 3.8, 0.4), additiveMaterial(0xff2500, 0.2)),
    new THREE.Mesh(flameWallGeometry(1, 3.1, 1.1), additiveMaterial(0xff6414, 0.58)),
    new THREE.Mesh(flameWallGeometry(0.985, 1.65, 2.3), additiveMaterial(0xffe27a, 0.62)),
    new THREE.Points(
      emberGeometry(),
      new THREE.PointsMaterial({
        color: 0xffd06a,
        size: 0.16,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    ),
  );

  root.add(preview, safeLanes, wall);
  root.visible = false;
  preview.visible = false;
  safeLanes.visible = false;
  wall.visible = false;
  return root;
}

export type IgnivarForgeWaveVisualPhase = 'hidden' | 'windup' | 'active';

export function syncIgnivarForgeWaveVisual(
  root: THREE.Object3D,
  phase: IgnivarForgeWaveVisualPhase,
  progress: number,
  radius: number,
  inverseEntityScale: number,
): void {
  const preview = root.getObjectByName(IGNIVAR_FORGE_WAVE_PREVIEW_NAME);
  const safeLanes = root.getObjectByName(IGNIVAR_FORGE_WAVE_SAFE_LANES_NAME);
  const wall = root.getObjectByName(IGNIVAR_FORGE_WAVE_WALL_NAME);
  root.scale.setScalar(inverseEntityScale);
  root.visible = phase !== 'hidden';
  if (preview) preview.visible = phase === 'windup';
  if (safeLanes) safeLanes.visible = phase !== 'hidden';
  if (wall) {
    wall.visible = phase === 'active';
    wall.scale.set(Math.max(0, radius), 1, Math.max(0, radius));
    wall.userData.radius = radius;
    const pulse = 0.86 + 0.14 * Math.sin(progress * Math.PI * 8);
    for (const child of wall.children) {
      const material = (child as THREE.Mesh | THREE.Points).material;
      if (!material || Array.isArray(material)) continue;
      const baseOpacity = material.userData.baseOpacity as number | undefined;
      if (baseOpacity !== undefined && 'opacity' in material)
        material.opacity = baseOpacity * pulse;
    }
  }
  root.userData.phase = phase;
  root.userData.progress = progress;
  root.userData.radius = radius;
}

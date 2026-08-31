// Shared Pyre presentation. It combines WoW's persistent soak flame and
// meteor swirl with inward arrows and explicit difficulty-sized occupancy runes.

import * as THREE from 'three';
import {
  VARKHUL_SHARED_PYRE_RADIUS,
  VARKHUL_SHARED_PYRE_REQUIRED_NORMAL,
} from '../sim/varkhul_shared_pyre';

export const IGNIVAR_SOAK_VISUAL_NAME = 'ignivarSoakCircle';
export const IGNIVAR_SOAK_FILL_NAME = 'ignivarSoakFill';
export const IGNIVAR_SOAK_RIM_NAME = 'ignivarSoakRim';
export const IGNIVAR_SOAK_SWIRL_NAME = 'ignivarSoakSwirl';
export const IGNIVAR_SOAK_ARROWS_NAME = 'ignivarSoakInwardArrows';
export const IGNIVAR_SOAK_OCCUPANCY_NAME = 'ignivarSoakOccupancy';
export const IGNIVAR_SOAK_TIMER_NAME = 'ignivarSoakTimer';
export const IGNIVAR_SOAK_FLAME_NAME = 'ignivarSoakCallInFlame';
export const IGNIVAR_SOAK_READY_NAME = 'ignivarSoakReadyRune';
export const IGNIVAR_SOAK_BEACON_NAME = 'ignivarSoakCallInBeacon';
export const IGNIVAR_SOAK_BEACON_CROWN_NAME = 'ignivarSoakCallInBeaconCrown';

const OCCUPIED_COLOR = new THREE.Color(0xffd36a);
const EMPTY_COLOR = new THREE.Color(0x58210c);

function material(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function discGeometry(radius: number, segments: number, y: number): THREE.BufferGeometry {
  const positions: number[] = [0, y, 0];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    positions.push(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
  }
  for (let index = 0; index < segments; index++) indices.push(0, index + 1, index + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function radialBandGeometry(
  innerRadius: number,
  outerRadius: number,
  segments: number,
  y: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    positions.push(
      sin * innerRadius,
      y,
      cos * innerRadius,
      sin * outerRadius,
      y,
      cos * outerRadius,
    );
  }
  for (let index = 0; index < segments; index++) {
    const vertex = index * 2;
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function arrowsGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const arrows = 8;
  for (let index = 0; index < arrows; index++) {
    const angle = (index / arrows) * Math.PI * 2;
    const forwardX = Math.sin(angle);
    const forwardZ = Math.cos(angle);
    const tangentX = Math.cos(angle);
    const tangentZ = -Math.sin(angle);
    const tipRadius = VARKHUL_SHARED_PYRE_RADIUS * 0.53;
    const baseRadius = VARKHUL_SHARED_PYRE_RADIUS * 0.78;
    const vertex = positions.length / 3;
    positions.push(
      forwardX * tipRadius,
      0.09,
      forwardZ * tipRadius,
      forwardX * baseRadius + tangentX * 0.36,
      0.09,
      forwardZ * baseRadius + tangentZ * 0.36,
      forwardX * baseRadius - tangentX * 0.36,
      0.09,
      forwardZ * baseRadius - tangentZ * 0.36,
    );
    indices.push(vertex, vertex + 1, vertex + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function swirlGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const arms = 3;
  const segments = 24;
  for (let arm = 0; arm < arms; arm++) {
    for (let index = 0; index < segments; index++) {
      const progressA = index / segments;
      const progressB = (index + 1) / segments;
      const radiusA = 0.9 + progressA * (VARKHUL_SHARED_PYRE_RADIUS * 0.72 - 0.9);
      const radiusB = 0.9 + progressB * (VARKHUL_SHARED_PYRE_RADIUS * 0.72 - 0.9);
      const angleA = (arm / arms) * Math.PI * 2 + progressA * Math.PI * 1.55;
      const angleB = (arm / arms) * Math.PI * 2 + progressB * Math.PI * 1.55;
      const halfWidth = 0.1;
      const vertex = positions.length / 3;
      positions.push(
        Math.sin(angleA) * (radiusA - halfWidth),
        0.072,
        Math.cos(angleA) * (radiusA - halfWidth),
        Math.sin(angleA) * (radiusA + halfWidth),
        0.072,
        Math.cos(angleA) * (radiusA + halfWidth),
        Math.sin(angleB) * (radiusB - halfWidth),
        0.072,
        Math.cos(angleB) * (radiusB - halfWidth),
        Math.sin(angleB) * (radiusB + halfWidth),
        0.072,
        Math.cos(angleB) * (radiusB + halfWidth),
      );
      indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function occupancyGeometry(requiredPlayers: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const centerRadius = 1.62;
  const half = 0.28;
  for (let slot = 0; slot < requiredPlayers; slot++) {
    const angle = (slot / requiredPlayers) * Math.PI * 2 + Math.PI / 4;
    const centerX = Math.sin(angle) * centerRadius;
    const centerZ = Math.cos(angle) * centerRadius;
    const vertex = positions.length / 3;
    positions.push(
      centerX - half,
      0.105,
      centerZ,
      centerX,
      0.105,
      centerZ - half,
      centerX + half,
      0.105,
      centerZ,
      centerX,
      0.105,
      centerZ + half,
    );
    for (let index = 0; index < 4; index++)
      colors.push(EMPTY_COLOR.r, EMPTY_COLOR.g, EMPTY_COLOR.b);
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

function callInFlame(): THREE.InstancedMesh {
  const count = 5;
  const flame = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.34, 1, 5, 1, true),
    material(0xff9b21, 0.82),
    count,
  );
  flame.name = IGNIVAR_SOAK_FLAME_NAME;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2;
    dummy.position.set(Math.sin(angle) * 0.34, 2.1 + (index % 2) * 0.2, Math.cos(angle) * 0.34);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.set(0.9, 1.4 - (index % 2) * 0.2, 0.9);
    dummy.updateMatrix();
    flame.setMatrixAt(index, dummy.matrix);
  }
  flame.instanceMatrix.needsUpdate = true;
  flame.renderOrder = 8;
  return flame;
}

function callInBeacon(): THREE.Group {
  const beacon = new THREE.Group();
  beacon.name = IGNIVAR_SOAK_BEACON_NAME;
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.72, 7.2, 10, 1, true),
    material(0xff750d, 0.42),
  );
  outer.position.y = 3.65;
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 6.2, 10, 1, true),
    material(0xfff0a3, 0.86),
  );
  core.position.y = 3.35;
  const crown = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.11, 8, 32), material(0xffe9a1, 0.9));
  crown.name = IGNIVAR_SOAK_BEACON_CROWN_NAME;
  crown.position.y = 6.55;
  crown.rotation.x = Math.PI / 2;
  crown.renderOrder = 10;
  const emberCount = 22;
  const emberPositions = new Float32Array(emberCount * 3);
  for (let index = 0; index < emberCount; index++) {
    const angle = index * 2.39996;
    const radius = 0.2 + (index % 4) * 0.1;
    emberPositions[index * 3] = Math.sin(angle) * radius;
    emberPositions[index * 3 + 1] = 0.65 + (index % 9) * 0.38;
    emberPositions[index * 3 + 2] = Math.cos(angle) * radius;
  }
  const emberGeometry = new THREE.BufferGeometry();
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const embers = new THREE.Points(
    emberGeometry,
    new THREE.PointsMaterial({
      color: 0xffdf89,
      size: 0.15,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    }),
  );
  beacon.add(outer, core, crown, embers);
  beacon.userData.outer = outer;
  beacon.userData.core = core;
  beacon.userData.embers = embers;
  beacon.userData.crown = crown;
  beacon.renderOrder = 9;
  return beacon;
}

export function buildIgnivarSoakTelegraph(
  requiredPlayers = VARKHUL_SHARED_PYRE_REQUIRED_NORMAL,
): THREE.Group {
  const occupancySlots = Math.max(1, Math.floor(requiredPlayers));
  const root = new THREE.Group();
  root.name = IGNIVAR_SOAK_VISUAL_NAME;
  root.userData.renderCategory = 'ui3d';
  root.userData.requiredPlayers = occupancySlots;
  root.userData.occupancySlots = occupancySlots;

  const fill = new THREE.Mesh(
    discGeometry(VARKHUL_SHARED_PYRE_RADIUS, 64, 0.04),
    material(0xb85a08, 0.16),
  );
  fill.name = IGNIVAR_SOAK_FILL_NAME;
  fill.renderOrder = 2;
  const rim = new THREE.Mesh(
    radialBandGeometry(VARKHUL_SHARED_PYRE_RADIUS - 0.22, VARKHUL_SHARED_PYRE_RADIUS, 64, 0.064),
    material(0xffcf58, 0.94),
  );
  rim.name = IGNIVAR_SOAK_RIM_NAME;
  rim.renderOrder = 5;
  const swirl = new THREE.Mesh(swirlGeometry(), material(0xff8f1f, 0.44));
  swirl.name = IGNIVAR_SOAK_SWIRL_NAME;
  swirl.renderOrder = 3;
  const arrows = new THREE.Mesh(arrowsGeometry(), material(0xffe29a, 0.86));
  arrows.name = IGNIVAR_SOAK_ARROWS_NAME;
  arrows.renderOrder = 4;
  const occupancyMaterial = material(0xffffff, 0.96);
  occupancyMaterial.vertexColors = true;
  const occupancy = new THREE.Mesh(occupancyGeometry(occupancySlots), occupancyMaterial);
  occupancy.name = IGNIVAR_SOAK_OCCUPANCY_NAME;
  occupancy.renderOrder = 6;
  const timer = new THREE.Mesh(
    radialBandGeometry(
      VARKHUL_SHARED_PYRE_RADIUS - 0.48,
      VARKHUL_SHARED_PYRE_RADIUS - 0.32,
      64,
      0.082,
    ),
    material(0xfff0ae, 0.74),
  );
  timer.name = IGNIVAR_SOAK_TIMER_NAME;
  timer.renderOrder = 6;
  timer.userData.fullIndexCount = timer.geometry.index?.count ?? 0;
  const ready = new THREE.Mesh(radialBandGeometry(0.4, 0.82, 32, 0.112), material(0xfff4bd, 0.98));
  ready.name = IGNIVAR_SOAK_READY_NAME;
  ready.renderOrder = 7;
  ready.visible = false;

  root.add(fill, swirl, arrows, rim, timer, occupancy, callInFlame(), callInBeacon(), ready);
  root.visible = false;
  return root;
}

export function syncIgnivarSoakTelegraph(
  root: THREE.Object3D,
  visible: boolean,
  playersInside: number,
  requiredPlayers: number,
  progress: number,
  inverseEntityScale: number,
  dt: number,
  reducedMotion = false,
): void {
  root.visible = visible;
  root.scale.setScalar(inverseEntityScale);
  root.userData.playersInside = Math.max(0, Math.floor(playersInside));
  root.userData.requiredPlayers = Math.max(1, Math.floor(requiredPlayers));
  root.userData.progress = Math.max(0, Math.min(1, progress));
  root.userData.ready = visible && root.userData.playersInside >= root.userData.requiredPlayers;
  if (!visible) return;

  root.userData.elapsed = Number(root.userData.elapsed ?? 0) + Math.max(0, dt);
  const elapsed = Number(root.userData.elapsed);
  const motionTime = reducedMotion ? 0 : elapsed;
  const readyState = Boolean(root.userData.ready);
  const occupancy = root.getObjectByName(IGNIVAR_SOAK_OCCUPANCY_NAME) as THREE.Mesh | undefined;
  const timer = root.getObjectByName(IGNIVAR_SOAK_TIMER_NAME) as THREE.Mesh | undefined;
  const flame = root.getObjectByName(IGNIVAR_SOAK_FLAME_NAME) as THREE.InstancedMesh | undefined;
  const ready = root.getObjectByName(IGNIVAR_SOAK_READY_NAME) as THREE.Mesh | undefined;
  const beacon = root.getObjectByName(IGNIVAR_SOAK_BEACON_NAME) as THREE.Group | undefined;
  const swirl = root.getObjectByName(IGNIVAR_SOAK_SWIRL_NAME) as THREE.Mesh | undefined;
  const arrows = root.getObjectByName(IGNIVAR_SOAK_ARROWS_NAME) as THREE.Mesh | undefined;
  if (occupancy) {
    const colors = occupancy.geometry.getAttribute('color') as THREE.BufferAttribute;
    const occupancySlots = Math.max(1, Math.floor(Number(root.userData.occupancySlots ?? 4)));
    for (let slot = 0; slot < occupancySlots; slot++) {
      const color = slot < root.userData.playersInside ? OCCUPIED_COLOR : EMPTY_COLOR;
      for (let vertex = 0; vertex < 4; vertex++)
        colors.setXYZ(slot * 4 + vertex, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
  }
  if (timer) {
    const fullIndexCount = Number(timer.userData.fullIndexCount ?? 0);
    const remainingFraction = 1 - Number(root.userData.progress);
    const visibleSegments = Math.max(0, Math.ceil(64 * remainingFraction));
    timer.geometry.setDrawRange(0, Math.min(fullIndexCount, visibleSegments * 6));
    (timer.material as THREE.Material).opacity = readyState ? 0.48 : 0.74;
  }
  if (flame) {
    flame.visible = !readyState;
    flame.scale.y = 0.92 + Math.sin(motionTime * 7.5) * 0.1;
  }
  if (beacon) {
    beacon.visible = !readyState;
    beacon.rotation.y = motionTime * 1.35;
    beacon.scale.y = 0.9 + Math.sin(motionTime * 7.5) * 0.08;
    const outer = beacon.userData.outer as THREE.Mesh | undefined;
    const core = beacon.userData.core as THREE.Mesh | undefined;
    const embers = beacon.userData.embers as THREE.Points | undefined;
    const crown = beacon.userData.crown as THREE.Mesh | undefined;
    if (outer) (outer.material as THREE.Material).opacity = 0.4 + Math.sin(motionTime * 6) * 0.04;
    if (core) (core.material as THREE.Material).opacity = 0.86 + Math.sin(motionTime * 8) * 0.08;
    if (crown) (crown.material as THREE.Material).opacity = 0.88 + Math.sin(motionTime * 5) * 0.06;
    if (embers) embers.rotation.y = motionTime * 1.7;
  }
  if (ready) {
    ready.visible = readyState;
    ready.scale.setScalar(0.96 + Math.sin(motionTime * 5) * 0.04);
  }
  if (swirl) {
    swirl.rotation.y = -motionTime * 0.46;
    (swirl.material as THREE.Material).opacity = readyState ? 0.28 : 0.44;
  }
  if (arrows) {
    const callStrength = readyState ? 0.52 : 0.82 + Math.sin(motionTime * 6) * 0.1;
    (arrows.material as THREE.Material).opacity = callStrength;
    arrows.scale.setScalar(0.98 + Math.sin(motionTime * 6) * 0.015);
  }
}

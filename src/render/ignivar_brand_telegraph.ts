// Brand of the Pyre presentation. A dark exact-radius field, inward teeth, and
// molten marks communicate personal danger without changing the sim footprint.

import * as THREE from 'three';
import { IGNIVAR_BRAND_RADIUS } from '../sim/encounters/ignivar';

export const IGNIVAR_BRAND_VISUAL_NAME = 'ignivarBrandCircle';
export const IGNIVAR_BRAND_FILL_NAME = 'ignivarBrandFill';
export const IGNIVAR_BRAND_RIM_NAME = 'ignivarBrandRim';
export const IGNIVAR_BRAND_CRACKS_NAME = 'ignivarBrandMoltenCracks';
export const IGNIVAR_BRAND_RUNES_NAME = 'ignivarBrandRunes';
export const IGNIVAR_BRAND_SPIKES_NAME = 'ignivarBrandSpreadSpikes';
export const IGNIVAR_BRAND_FLAME_NAME = 'ignivarBrandOverheadFlame';
export const IGNIVAR_BRAND_EMBERS_NAME = 'ignivarBrandOverheadEmbers';
export const IGNIVAR_BRAND_OVERHEAD_RING_NAME = 'ignivarBrandOverheadRing';

function material(
  color: number,
  opacity: number,
  blending: THREE.Blending = THREE.NormalBlending,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending,
    side: THREE.DoubleSide,
  });
}

function addRibbonSegment(
  positions: number[],
  indices: number[],
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  halfWidth: number,
  y: number,
): void {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const inverseLength = 1 / Math.max(0.001, Math.hypot(dx, dz));
  const tangentX = dz * inverseLength * halfWidth;
  const tangentZ = -dx * inverseLength * halfWidth;
  const vertex = positions.length / 3;
  positions.push(
    startX + tangentX,
    y,
    startZ + tangentZ,
    startX - tangentX,
    y,
    startZ - tangentZ,
    endX + tangentX,
    y,
    endZ + tangentZ,
    endX - tangentX,
    y,
    endZ - tangentZ,
  );
  indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
}

function moltenCracksGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const crackCount = 12;
  const segmentCount = 3;
  for (let crack = 0; crack < crackCount; crack++) {
    const baseAngle = (crack / crackCount) * Math.PI * 2;
    let radius = 0.62 + (crack % 3) * 0.11;
    let angle = baseAngle;
    for (let segment = 0; segment < segmentCount; segment++) {
      const nextRadius = 1.78 + segment * 1.06 + (crack % 2) * 0.08;
      const nextAngle = baseAngle + Math.sin((crack + 2) * (segment + 1)) * 0.065;
      addRibbonSegment(
        positions,
        indices,
        Math.sin(angle) * radius,
        Math.cos(angle) * radius,
        Math.sin(nextAngle) * nextRadius,
        Math.cos(nextAngle) * nextRadius,
        0.035 + (crack % 3) * 0.009,
        0.074,
      );
      radius = nextRadius;
      angle = nextAngle;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function runeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const runeCount = 12;
  for (let index = 0; index < runeCount; index++) {
    const angle = (index / runeCount) * Math.PI * 2;
    const tangentX = Math.cos(angle);
    const tangentZ = -Math.sin(angle);
    const forwardX = Math.sin(angle);
    const forwardZ = Math.cos(angle);
    const vertex = positions.length / 3;
    const baseRadius = 3.1;
    const tipRadius = 2.58;
    positions.push(
      forwardX * baseRadius + tangentX * 0.14,
      0.08,
      forwardZ * baseRadius + tangentZ * 0.14,
      forwardX * baseRadius - tangentX * 0.14,
      0.08,
      forwardZ * baseRadius - tangentZ * 0.14,
      forwardX * tipRadius,
      0.08,
      forwardZ * tipRadius,
    );
    indices.push(vertex, vertex + 1, vertex + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
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

function spreadSpikesGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const spikes = 16;
  for (let index = 0; index < spikes; index++) {
    const angle = (index / spikes) * Math.PI * 2;
    const tangentX = Math.cos(angle);
    const tangentZ = -Math.sin(angle);
    const forwardX = Math.sin(angle);
    const forwardZ = Math.cos(angle);
    const vertex = positions.length / 3;
    const baseRadius = IGNIVAR_BRAND_RADIUS - 0.14;
    const tipRadius = IGNIVAR_BRAND_RADIUS - 0.92;
    positions.push(
      forwardX * baseRadius + tangentX * 0.18,
      0.076,
      forwardZ * baseRadius + tangentZ * 0.18,
      forwardX * baseRadius - tangentX * 0.18,
      0.076,
      forwardZ * baseRadius - tangentZ * 0.18,
      forwardX * tipRadius,
      0.076,
      forwardZ * tipRadius,
    );
    indices.push(vertex, vertex + 1, vertex + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function overheadFlame(): THREE.InstancedMesh {
  const count = 3;
  const flames = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.32, 1, 5, 1, true),
    material(0xd92508, 0.68),
    count,
  );
  flames.name = IGNIVAR_BRAND_FLAME_NAME;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < count; index++) {
    dummy.position.set((index - 1) * 0.24, 2.25 + Math.abs(index - 1) * 0.18, 0);
    dummy.rotation.set(0, index * 1.3, 0);
    dummy.scale.set(1 - Math.abs(index - 1) * 0.18, 1.25 - Math.abs(index - 1) * 0.12, 1);
    dummy.updateMatrix();
    flames.setMatrixAt(index, dummy.matrix);
  }
  flames.instanceMatrix.needsUpdate = true;
  flames.renderOrder = 8;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.055, 6, 24),
    material(0xff5624, 0.58),
  );
  ring.name = IGNIVAR_BRAND_OVERHEAD_RING_NAME;
  ring.position.y = 2.18;
  ring.rotation.x = Math.PI / 2;
  ring.renderOrder = 7;
  flames.add(ring);
  return flames;
}

function overheadEmbers(): THREE.Points {
  const count = 18;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    const angle = index * 2.39996;
    const radius = 0.18 + (index % 5) * 0.11;
    positions[index * 3] = Math.sin(angle) * radius;
    positions[index * 3 + 1] = 1.55 + (index % 7) * 0.25;
    positions[index * 3 + 2] = Math.cos(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const embers = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xffd27a,
      size: 0.13,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  embers.name = IGNIVAR_BRAND_EMBERS_NAME;
  embers.renderOrder = 9;
  return embers;
}

export function buildIgnivarBrandTelegraph(): THREE.Group {
  const root = new THREE.Group();
  root.name = IGNIVAR_BRAND_VISUAL_NAME;
  root.userData.renderCategory = 'ui3d';

  const fill = new THREE.Mesh(
    discGeometry(IGNIVAR_BRAND_RADIUS, 64, 0.042),
    material(0x3a0006, 0.4),
  );
  fill.name = IGNIVAR_BRAND_FILL_NAME;
  fill.renderOrder = 2;

  const rim = new THREE.Mesh(
    radialBandGeometry(IGNIVAR_BRAND_RADIUS - 0.2, IGNIVAR_BRAND_RADIUS, 64, 0.066),
    material(0xd52a18, 0.74),
  );
  rim.name = IGNIVAR_BRAND_RIM_NAME;
  rim.renderOrder = 4;

  const cracks = new THREE.Mesh(
    moltenCracksGeometry(),
    material(0xff3a0a, 0.48, THREE.AdditiveBlending),
  );
  cracks.name = IGNIVAR_BRAND_CRACKS_NAME;
  cracks.renderOrder = 3;

  const runes = new THREE.Mesh(runeGeometry(), material(0xb71a0f, 0.46));
  runes.name = IGNIVAR_BRAND_RUNES_NAME;
  runes.renderOrder = 4;
  fill.add(cracks, runes);

  const spikes = new THREE.Mesh(spreadSpikesGeometry(), material(0xe13b19, 0.56));
  spikes.name = IGNIVAR_BRAND_SPIKES_NAME;
  spikes.renderOrder = 5;

  root.add(fill, rim, spikes, overheadFlame(), overheadEmbers());
  root.visible = false;
  return root;
}

export function syncIgnivarBrandTelegraph(
  root: THREE.Object3D,
  visible: boolean,
  stacks: number,
  nearbyPlayers: number,
  inverseEntityScale: number,
  dt: number,
  reducedMotion = false,
): void {
  root.visible = visible;
  root.scale.setScalar(inverseEntityScale);
  root.userData.brandStacks = Math.max(1, Math.min(3, Math.floor(stacks)));
  root.userData.nearbyPlayers = Math.max(0, Math.floor(nearbyPlayers));
  root.userData.overlapDanger = visible && root.userData.nearbyPlayers > 0;
  if (!visible) return;

  const elapsed = Number(root.userData.elapsed ?? 0) + Math.max(0, dt);
  root.userData.elapsed = elapsed;
  const stackStrength = (root.userData.brandStacks - 1) / 2;
  const danger = root.userData.overlapDanger ? 1 : 0;
  const motionTime = reducedMotion ? 0 : elapsed;
  const pulse = danger ? 0.5 + Math.sin(motionTime * 11) * 0.5 : 0;
  const fill = root.getObjectByName(IGNIVAR_BRAND_FILL_NAME) as THREE.Mesh | undefined;
  const rim = root.getObjectByName(IGNIVAR_BRAND_RIM_NAME) as THREE.Mesh | undefined;
  const spikes = root.getObjectByName(IGNIVAR_BRAND_SPIKES_NAME) as THREE.Mesh | undefined;
  const cracks = root.getObjectByName(IGNIVAR_BRAND_CRACKS_NAME) as THREE.Mesh | undefined;
  const runes = root.getObjectByName(IGNIVAR_BRAND_RUNES_NAME) as THREE.Mesh | undefined;
  const flame = root.getObjectByName(IGNIVAR_BRAND_FLAME_NAME) as THREE.InstancedMesh | undefined;
  const embers = root.getObjectByName(IGNIVAR_BRAND_EMBERS_NAME) as THREE.Points | undefined;
  const overheadRing = root.getObjectByName(IGNIVAR_BRAND_OVERHEAD_RING_NAME) as
    | THREE.Mesh
    | undefined;
  const timePulse = 0.5 + Math.sin(motionTime * 5.2) * 0.5;
  const inwardPulse = 0.5 + Math.sin(motionTime * 6.5) * 0.5;
  if (fill)
    (fill.material as THREE.Material).opacity =
      0.4 + stackStrength * 0.06 + danger * 0.09 + timePulse * 0.015;
  if (rim)
    (rim.material as THREE.Material).opacity =
      0.74 + stackStrength * 0.06 + danger * 0.08 + pulse * 0.04;
  if (cracks)
    (cracks.material as THREE.Material).opacity =
      0.48 + stackStrength * 0.1 + danger * 0.08 + timePulse * 0.05;
  if (runes) {
    (runes.material as THREE.Material).opacity =
      0.46 + stackStrength * 0.08 + danger * 0.06 + timePulse * 0.04;
    runes.rotation.y = -motionTime * (0.18 + danger * 0.12);
  }
  if (spikes) {
    (spikes.material as THREE.Material).opacity =
      0.56 + stackStrength * 0.08 + danger * 0.08 + timePulse * 0.03;
    spikes.scale.setScalar(1 - inwardPulse * (0.025 + danger * 0.015));
  }
  if (flame) {
    (flame.material as THREE.Material).opacity =
      0.68 + stackStrength * 0.08 + danger * 0.06 + pulse * 0.025;
    flame.scale.y = 0.9 + stackStrength * 0.22 + danger * 0.18 + timePulse * 0.08;
  }
  if (overheadRing) {
    (overheadRing.material as THREE.Material).opacity =
      0.58 + stackStrength * 0.1 + danger * 0.08 + pulse * 0.04;
    const ringScale = 0.9 + stackStrength * 0.08 + timePulse * 0.04;
    overheadRing.scale.setScalar(ringScale);
    overheadRing.rotation.z = motionTime * (0.8 + danger * 0.45);
  }
  if (embers) {
    embers.rotation.y = motionTime * (danger ? 2.6 : 1.45);
    embers.scale.y = 0.84 + stackStrength * 0.18 + danger * 0.26 + pulse * 0.08;
    (embers.material as THREE.Material).opacity = 0.48 + stackStrength * 0.08 + danger * 0.08;
  }
}

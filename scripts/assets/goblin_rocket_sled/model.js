import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  boxProjectUvInto,
  buildOccluderIndex,
  shadeSurfaceInto,
} from '../terrorspark_groundshaker/surface_shading.mjs';

export const SLED_STAGES = Object.freeze([
  'blockout',
  'structural',
  'form',
  'material',
  'surface',
  'lighting',
  'interaction',
  'optimization',
  'final',
]);

export const SLED_SOCKET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'rider',
    nodeName: 'Socket_Rider',
    position: Object.freeze([0, 0.98, 0.2]),
    purpose: 'mounted player seat',
  }),
  Object.freeze({
    id: 'exhaust-left',
    nodeName: 'Socket_Exhaust_L',
    position: Object.freeze([-1.02, 0.66, -1.34]),
    purpose: 'left runtime exhaust emitter',
  }),
  Object.freeze({
    id: 'exhaust-right',
    nodeName: 'Socket_Exhaust_R',
    position: Object.freeze([1.02, 0.66, -1.34]),
    purpose: 'right runtime exhaust emitter',
  }),
]);

const BLOCKOUT = Object.freeze({
  wood: 0x725136,
  iron: 0x343638,
  red: 0x96392d,
  leather: 0x6f3a2f,
  bone: 0x788044,
  glow: 0xff7a10,
});

export const SLED_MATERIAL_CONTRACT = Object.freeze([
  Object.freeze({
    key: 'red',
    name: 'SledRedPaint',
    surface: 'metal',
    color: BLOCKOUT.red,
    roughness: 0.58,
    metalness: 0.28,
    uvScale: 3.2,
  }),
  Object.freeze({
    key: 'iron',
    name: 'SledDarkIron',
    surface: 'metal',
    color: BLOCKOUT.iron,
    roughness: 0.7,
    metalness: 0.68,
    uvScale: 3.2,
  }),
  Object.freeze({
    key: 'wood',
    name: 'SledAgedWood',
    surface: 'wood',
    color: BLOCKOUT.wood,
    roughness: 0.82,
    metalness: 0,
    uvScale: 2.6,
  }),
  Object.freeze({
    key: 'leather',
    name: 'SledLeather',
    surface: 'leather',
    color: BLOCKOUT.leather,
    roughness: 0.74,
    metalness: 0,
    uvScale: 3.4,
  }),
  Object.freeze({
    key: 'bone',
    name: 'SledBone',
    surface: null,
    color: BLOCKOUT.bone,
    roughness: 0.8,
    metalness: 0,
    uvScale: 0,
  }),
  Object.freeze({
    key: 'glow',
    name: 'SledGlow',
    surface: null,
    color: BLOCKOUT.glow,
    roughness: 0.3,
    metalness: 0,
    uvScale: 0,
  }),
]);

const CONTRACT_BY_NAME = new Map(
  SLED_MATERIAL_CONTRACT.map((contract) => [contract.name, contract]),
);

function stageIndex(stage) {
  const index = SLED_STAGES.indexOf(stage);
  if (index < 0) throw new Error(`unknown sled stage: ${stage}`);
  return index;
}

function atLeast(stage, threshold) {
  return stageIndex(stage) >= stageIndex(threshold);
}

function material(name, color, options = {}) {
  return new THREE.MeshStandardMaterial({
    name,
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
}

function createMaterials() {
  const materials = {};
  for (const contract of SLED_MATERIAL_CONTRACT) {
    materials[contract.key] = material(contract.name, contract.color, {
      roughness: contract.roughness,
      metalness: contract.metalness,
      emissive: contract.key === 'glow' ? BLOCKOUT.glow : 0x000000,
      emissiveIntensity: contract.key === 'glow' ? 2.2 : 0,
    });
  }
  return materials;
}

function semanticTint(object, contract) {
  if (object.name.startsWith('RocketSkullMark') || object.name.startsWith('RocketCrossbone')) {
    return new THREE.Color(0xd9cdb0);
  }
  if (object.name.startsWith('RocketSkullEye')) return new THREE.Color(0x090807);
  if (contract.key === 'red' && object.name.includes('Band')) return new THREE.Color(0x76271f);
  if (contract.key === 'wood' && object.name.includes('Runner')) return new THREE.Color(0x51371f);
  return new THREE.Color(contract.color);
}

function applyAuthoredSurface(root, stage) {
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (object.material.name === 'SledGlow') {
      const geometry = object.geometry.clone();
      geometry.deleteAttribute('uv');
      geometry.deleteAttribute('uv1');
      object.geometry = geometry;
      return;
    }
    const contract = CONTRACT_BY_NAME.get(object.material.name);
    if (!contract) throw new Error(`missing material contract for ${object.material.name}`);
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    object.geometry = geometry;
    geometry.computeBoundingBox();
    const worldBox = geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
    parts.push({ object, geometry, contract, worldBox, tint: semanticTint(object, contract) });
  });
  const occluders = buildOccluderIndex(
    parts.map((part, ownerId) => ({
      ownerId,
      min: part.worldBox.min.toArray(),
      max: part.worldBox.max.toArray(),
    })),
  );

  for (let ownerId = 0; ownerId < parts.length; ownerId++) {
    const part = parts[ownerId];
    const position = part.geometry.getAttribute('position');
    const normal = part.geometry.getAttribute('normal');
    const worldPositions = new Float32Array(position.array.length);
    const worldNormals = new Float32Array(normal.array.length);
    const point = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(part.object.matrixWorld);
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index).applyMatrix4(part.object.matrixWorld);
      direction.fromBufferAttribute(normal, index).applyMatrix3(normalMatrix).normalize();
      const offset = index * 3;
      worldPositions[offset] = point.x;
      worldPositions[offset + 1] = point.y;
      worldPositions[offset + 2] = point.z;
      worldNormals[offset] = direction.x;
      worldNormals[offset + 1] = direction.y;
      worldNormals[offset + 2] = direction.z;
    }
    const colors = new Float32Array(worldPositions.length);
    shadeSurfaceInto(worldPositions, worldNormals, colors, {
      tint: [part.tint.r, part.tint.g, part.tint.b],
      occluders,
      ownerId,
      variation: 0.025,
      seed: ownerId * 131 + 29,
    });
    if (atLeast(stage, 'surface')) {
      for (let index = 0; index < worldPositions.length; index += 3) {
        let red = 1;
        let green = 1;
        let blue = 1;
        const worldY = worldPositions[index + 1];
        const worldZ = worldPositions[index + 2];
        if (
          part.contract.key === 'red' &&
          part.object.name.startsWith('Rocket') &&
          worldZ < -0.45
        ) {
          const soot = THREE.MathUtils.clamp((-0.45 - worldZ) / 0.95, 0, 1) * 0.28;
          red -= soot * 0.7;
          green -= soot;
          blue -= soot;
        }
        if (
          part.contract.key === 'wood' &&
          part.object.name.includes('Runner') &&
          worldY < 0.16
        ) {
          // Ground-contact streak: darker grime with a slight warm polished
          // lift, localized to the runner underside rather than wallpapered.
          red *= 0.82;
          green *= 0.73;
          blue *= 0.66;
        }
        colors[index] *= red;
        colors[index + 1] *= green;
        colors[index + 2] *= blue;
      }
    }
    part.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (part.contract.surface) {
      const uv = new Float32Array((worldPositions.length / 3) * 2);
      boxProjectUvInto(worldPositions, worldNormals, uv, part.contract.uvScale);
      part.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    } else {
      part.geometry.deleteAttribute('uv');
      part.geometry.deleteAttribute('uv1');
    }
  }

  for (const contract of SLED_MATERIAL_CONTRACT) {
    if (contract.key === 'glow') continue;
    const materialDef = parts.find((part) => part.contract.key === contract.key)?.object.material;
    if (!materialDef) continue;
    materialDef.color.set(0xffffff);
    materialDef.vertexColors = true;
    materialDef.needsUpdate = true;
  }
}

function mesh(group, name, geometry, materialDef, position, rotation = [0, 0, 0]) {
  const object = new THREE.Mesh(geometry, materialDef);
  object.name = name;
  object.position.fromArray(position);
  object.rotation.fromArray(rotation);
  object.castShadow = true;
  object.receiveShadow = true;
  group.add(object);
  return object;
}

function roundedBox(group, name, size, position, materialDef, radius = 0.04, rotation) {
  return mesh(
    group,
    name,
    new RoundedBoxGeometry(size[0], size[1], size[2], 1, radius),
    materialDef,
    position,
    rotation,
  );
}

function box(group, name, size, position, materialDef, rotation) {
  return mesh(group, name, new THREE.BoxGeometry(...size), materialDef, position, rotation);
}

function rivet(group, name, position, materialDef, scale = [1, 1, 0.55]) {
  const object = mesh(group, name, new THREE.OctahedronGeometry(0.032, 0), materialDef, position);
  object.scale.fromArray(scale);
  return object;
}

function cylinder(
  group,
  name,
  radiusTop,
  radiusBottom,
  length,
  position,
  materialDef,
  rotation = [0, 0, 0],
  radialSegments = 12,
) {
  return mesh(
    group,
    name,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, length, radialSegments, 1),
    materialDef,
    position,
    rotation,
  );
}

function assertClosedOutwardGeometry(vertices, indices, label) {
  const edgeUse = new Map();
  let signedVolume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    const ax = vertices[a * 3];
    const ay = vertices[a * 3 + 1];
    const az = vertices[a * 3 + 2];
    const bx = vertices[b * 3];
    const by = vertices[b * 3 + 1];
    const bz = vertices[b * 3 + 2];
    const cx = vertices[c * 3];
    const cy = vertices[c * 3 + 1];
    const cz = vertices[c * 3 + 2];
    signedVolume +=
      (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) /
      6;
    for (const [start, end] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
    }
  }
  if (signedVolume <= 0) throw new Error(`${label} must have outward triangle winding`);
  for (const [edge, count] of edgeUse) {
    if (count !== 2) throw new Error(`${label} must be watertight; edge ${edge} used ${count} times`);
  }
}

// A low-poly prism made from a side profile. This preserves the runner's
// identity-defining upward nose without spending subdivisions on a smooth curve.
function runnerGeometry(width) {
  const profile = [
    [-1.72, 0.12],
    [-1.48, 0.05],
    [1.52, 0.05],
    [1.84, 0.14],
    [2.08, 0.4],
    [1.98, 0.5],
    [1.7, 0.24],
    [-1.48, 0.23],
  ];
  const half = width / 2;
  const vertices = [];
  for (const x of [-half, half]) {
    for (const [z, y] of profile) vertices.push(x, y, z);
  }
  const indices = [];
  const count = profile.length;
  for (let i = 1; i < count - 1; i++) {
    indices.push(0, i + 1, i);
    indices.push(count, count + i, count + i + 1);
  }
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    indices.push(i, next, count + next, i, count + next, count + i);
  }
  // The profile extrusion above is assembled inside-out by its natural loop
  // order. Reverse every triangle so FrontSide renders the ski exterior rather
  // than exposing its interior as a one-sided open channel.
  for (let index = 0; index < indices.length; index += 3) {
    [indices[index + 1], indices[index + 2]] = [indices[index + 2], indices[index + 1]];
  }
  assertClosedOutwardGeometry(vertices, indices, 'runnerGeometry');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addRunners(root, materials) {
  const group = new THREE.Group();
  group.name = 'RunnerAssembly';
  for (const side of [-1, 1]) {
    const x = side * 0.88;
    mesh(group, side < 0 ? 'Runner_L' : 'Runner_R', runnerGeometry(0.18), materials.wood, [x, 0, 0]);
    roundedBox(
      group,
      side < 0 ? 'RunnerIronStrap_L' : 'RunnerIronStrap_R',
      [0.22, 0.08, 2.75],
      [x, 0.27, -0.05],
      materials.iron,
      0.025,
    );
    for (const z of [-0.95, 0.05, 0.95]) {
      roundedBox(
        group,
        `RunnerBrace_${side < 0 ? 'L' : 'R'}_${String(z).replace('.', '_')}`,
        [0.13, 0.42, 0.13],
        [x, 0.49, z],
        materials.iron,
        0.025,
      );
    }
  }
  root.add(group);
}

function addDeck(root, materials) {
  const group = new THREE.Group();
  group.name = 'ChassisDeck';
  roundedBox(group, 'DeckFrame', [1.64, 0.18, 2.45], [0, 0.48, 0.08], materials.iron, 0.05);
  for (let index = -3; index <= 3; index++) {
    roundedBox(
      group,
      `DeckPlank_${index + 4}`,
      [0.2, 0.13, 2.3],
      [index * 0.225, 0.6, 0.1],
      materials.wood,
      0.018,
    );
  }
  for (const z of [-0.86, 0.86]) {
    roundedBox(group, `DeckCrossBrace_${z}`, [2.1, 0.12, 0.16], [0, 0.42, z], materials.iron, 0.025);
  }
  root.add(group);
}

function addRocket(root, materials, side) {
  const suffix = side < 0 ? 'L' : 'R';
  const group = new THREE.Group();
  group.name = `Rocket_${suffix}`;
  group.position.x = side * 1.02;
  const alongZ = [Math.PI / 2, 0, 0];
  cylinder(group, `RocketBody_${suffix}`, 0.33, 0.33, 1.78, [0, 0.7, -0.08], materials.red, alongZ, 14);
  cylinder(group, `RocketNose_${suffix}`, 0.02, 0.33, 0.38, [0, 0.7, 1], materials.red, alongZ, 14);
  for (const z of [-0.7, -0.18, 0.35, 0.74]) {
    cylinder(group, `RocketBand_${suffix}_${z}`, 0.365, 0.365, 0.1, [0, 0.7, z], materials.iron, alongZ, 14);
  }
  cylinder(group, `NozzleCollar_${suffix}`, 0.41, 0.33, 0.24, [0, 0.7, -1.09], materials.iron, alongZ, 14);
  cylinder(group, `NozzleThroat_${suffix}`, 0.29, 0.2, 0.24, [0, 0.7, -1.3], materials.iron, alongZ, 14);
  cylinder(group, `NozzleGlow_${suffix}`, 0.17, 0.13, 0.03, [0, 0.7, -1.43], materials.glow, alongZ, 12);
  roundedBox(group, `RocketMount_${suffix}`, [0.26, 0.38, 0.62], [-side * 0.18, 0.5, 0.04], materials.iron, 0.035);
  root.add(group);
}

function addSeatAndTank(root, materials) {
  const tank = new THREE.Group();
  tank.name = 'FuelTank';
  cylinder(tank, 'FuelTankBody', 0.39, 0.39, 1.15, [0, 1.16, -0.72], materials.red, [0, 0, Math.PI / 2], 14);
  for (const x of [-0.46, 0, 0.46]) {
    cylinder(tank, `FuelTankBand_${x}`, 0.425, 0.425, 0.1, [x, 1.16, -0.72], materials.iron, [0, 0, Math.PI / 2], 14);
  }
  for (const x of [-0.28, 0.28]) {
    cylinder(
      tank,
      `TankValveBase_${x < 0 ? 'L' : 'R'}`,
      0.12,
      0.14,
      0.15,
      [x, 1.58, -0.72],
      materials.iron,
      [0, 0, 0],
      10,
    );
  }
  root.add(tank);

  const seat = new THREE.Group();
  seat.name = 'RiderSeat';
  roundedBox(seat, 'SeatFrame', [1.02, 0.18, 0.86], [0, 0.72, 0.22], materials.iron, 0.045);
  roundedBox(seat, 'SeatCushion', [0.9, 0.2, 0.72], [0, 0.86, 0.24], materials.leather, 0.08);
  roundedBox(seat, 'SeatBackFrame', [1.02, 0.82, 0.18], [0, 1.15, -0.1], materials.iron, 0.05, [-0.13, 0, 0]);
  roundedBox(seat, 'SeatBackCushion', [0.88, 0.68, 0.17], [0, 1.16, -0.02], materials.leather, 0.075, [-0.13, 0, 0]);
  root.add(seat);
}

function addProw(root, materials) {
  const group = new THREE.Group();
  group.name = 'GoblinProw';
  const face = mesh(group, 'GoblinFace', new THREE.IcosahedronGeometry(0.3, 1), materials.bone, [0, 0.63, 1.42]);
  face.scale.set(1, 0.78, 0.38);
  for (const side of [-1, 1]) {
    const eye = mesh(group, `GoblinEye_${side < 0 ? 'L' : 'R'}`, new THREE.SphereGeometry(0.065, 8, 5), materials.glow, [side * 0.1, 0.68, 1.535]);
    eye.scale.z = 0.45;
    const ear = mesh(group, `GoblinEar_${side < 0 ? 'L' : 'R'}`, new THREE.ConeGeometry(0.11, 0.34, 5), materials.bone, [side * 0.34, 0.68, 1.42], [0, 0, side * -Math.PI / 2]);
    ear.scale.z = 0.55;
  }
  mesh(group, 'GoblinNose', new THREE.ConeGeometry(0.075, 0.2, 5), materials.bone, [0, 0.6, 1.59], [Math.PI / 2, 0, 0]);
  roundedBox(group, 'ProwMount', [0.54, 0.18, 0.3], [0, 0.54, 1.31], materials.iron, 0.035);
  root.add(group);
}

function finGeometry(thickness = 0.08) {
  const half = thickness / 2;
  const vertices = [
    -half, 0, -0.3,
    -half, 0, 0.28,
    -half, 0.28, -0.2,
    half, 0, -0.3,
    half, 0.28, -0.2,
    half, 0, 0.28,
  ];
  const indices = [
    0, 1, 2,
    3, 4, 5,
    0, 3, 5, 0, 5, 1,
    1, 5, 4, 1, 4, 2,
    2, 4, 3, 2, 3, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const ROCKET_BARREL_RADIUS = 0.33;
const ROCKET_BARREL_CENTER_Y = 0.7;
const ROCKET_BARREL_SEGMENTS = 14;

function rocketBarrelSurfaceRadius(side, angle) {
  const step = (Math.PI * 2) / ROCKET_BARREL_SEGMENTS;
  const worldAngle = side < 0 ? Math.PI - angle : angle;
  const nearestFaceNormal = Math.round(worldAngle / step) * step;
  const delta = worldAngle - nearestFaceNormal;
  return (ROCKET_BARREL_RADIUS * Math.cos(step / 2)) / Math.cos(delta);
}

/** Project a small authored (z,y) patch onto the cylindrical rocket barrel.
 *  The provided y coordinate is treated as arc length around the barrel, so
 *  the side-view drawing retains its proportions while front/rear views hug
 *  the paint instead of exposing a tangent-flat plaque. */
function rocketSurfaceGeometry(side, points, indices, radialLift, subdivisionLevel = 0) {
  const positions = [];
  const normals = [];
  const emitPoint = ([z, y]) => {
    const angle = (y - ROCKET_BARREL_CENTER_Y) / ROCKET_BARREL_RADIUS;
    const radius = rocketBarrelSurfaceRadius(side, angle) + radialLift;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    positions.push(side * radius * cos, ROCKET_BARREL_CENTER_Y + radius * sin, z);
    normals.push(side * cos, sin, 0);
  };
  const midpoint = (a, b) => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
  const emitTriangle = (a, b, c, level) => {
    if (level > 0) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      emitTriangle(a, ab, ca, level - 1);
      emitTriangle(ab, b, bc, level - 1);
      emitTriangle(ca, bc, c, level - 1);
      emitTriangle(ab, bc, ca, level - 1);
      return;
    }
    if (side > 0) [b, c] = [c, b];
    emitPoint(a);
    emitPoint(b);
    emitPoint(c);
  };
  for (let index = 0; index < indices.length; index += 3) {
    emitTriangle(
      points[indices[index]],
      points[indices[index + 1]],
      points[indices[index + 2]],
      subdivisionLevel,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function rocketSurfaceDiscGeometry(
  side,
  centerZ,
  centerY,
  radiusZ,
  radiusY,
  segments,
  radialLift,
  subdivisionLevel = 0,
) {
  const points = [[centerZ, centerY]];
  for (let index = 0; index < segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    points.push([centerZ + Math.cos(angle) * radiusZ, centerY + Math.sin(angle) * radiusY]);
  }
  const indices = [];
  for (let index = 0; index < segments; index++) {
    indices.push(0, index + 1, ((index + 1) % segments) + 1);
  }
  return rocketSurfaceGeometry(side, points, indices, radialLift, subdivisionLevel);
}

function rocketSurfaceRibbonGeometry(side, centerZ, centerY, length, width, angle, radialLift) {
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const alongZ = Math.cos(angle);
  const alongY = -Math.sin(angle);
  const acrossZ = -alongY;
  const acrossY = alongZ;
  const points = [
    [centerZ - alongZ * halfLength - acrossZ * halfWidth, centerY - alongY * halfLength - acrossY * halfWidth],
    [centerZ + alongZ * halfLength - acrossZ * halfWidth, centerY + alongY * halfLength - acrossY * halfWidth],
    [centerZ + alongZ * halfLength + acrossZ * halfWidth, centerY + alongY * halfLength + acrossY * halfWidth],
    [centerZ - alongZ * halfLength + acrossZ * halfWidth, centerY - alongY * halfLength + acrossY * halfWidth],
  ];
  return rocketSurfaceGeometry(side, points, [0, 1, 2, 0, 2, 3], radialLift, 3);
}

function addStructuralDetails(root, materials) {
  const structure = new THREE.Group();
  structure.name = 'StructuralDetails';

  // Brackets overlap both the cross braces and deck frame, making the chassis
  // attachment legible rather than leaving the deck apparently floating.
  for (const side of [-1, 1]) {
    for (const z of [-0.86, 0.86]) {
      box(
        structure,
        `DeckCornerBracket_${side < 0 ? 'L' : 'R'}_${z < 0 ? 'Rear' : 'Front'}`,
        [0.28, 0.28, 0.18],
        [side * 0.77, 0.5, z],
        materials.iron,
      );
      for (const y of [0.45, 0.57]) {
        rivet(
          structure,
          `DeckBracketRivet_${side}_${z}_${y}`,
          [side * 0.918, y, z],
          materials.iron,
          [0.55, 1, 1],
        );
      }
    }
  }

  // Low arm rails frame the cushion but stop below the real rider's elbows;
  // their posts bury into the seat frame and their rails overlap each post.
  for (const side of [-1, 1]) {
    box(structure, `SeatPostFront_${side}`, [0.09, 0.38, 0.09], [side * 0.49, 1.02, 0.5], materials.iron);
    box(structure, `SeatPostRear_${side}`, [0.09, 0.42, 0.09], [side * 0.49, 1.04, -0.04], materials.iron);
    box(structure, `SeatArmRail_${side}`, [0.1, 0.1, 0.64], [side * 0.49, 1.22, 0.23], materials.iron);
  }

  for (const side of [-1, 1]) {
    const rocket = root.getObjectByName(side < 0 ? 'Rocket_L' : 'Rocket_R');
    const suffix = side < 0 ? 'L' : 'R';
    const outerX = side * 0.355;
    // Rivets sit on the outward barrel face where they survive the gameplay
    // camera. Each row is rooted directly into a band, not scattered on paint.
    for (const z of [-0.7, -0.18, 0.35, 0.74]) {
      for (const yOffset of [-0.13, 0.13]) {
        rivet(
          rocket,
          `RocketBandRivet_${suffix}_${z}_${yOffset}`,
          [outerX, 0.7 + yOffset, z],
          materials.iron,
          [0.55, 1, 1],
        );
      }
    }
    // Tail fins penetrate the final rear band and are mirrored on the top and
    // outer side, matching the reference's compact jagged tail silhouette.
    mesh(rocket, `RocketTopFin_${suffix}`, finGeometry(), materials.red, [0, 1.01, -0.75]);
    const outerFin = mesh(
      rocket,
      `RocketOuterFin_${suffix}`,
      finGeometry(),
      materials.red,
      [outerX, 0.7, -0.75],
      [0, 0, side < 0 ? Math.PI / 2 : -Math.PI / 2],
    );
    outerFin.scale.set(0.55, 0.55, 0.55);

    // Short fuel lines use four-sided tubes. Endpoints are buried in the tank
    // cap and rocket band so every connector has visible support at both ends.
    const pipePath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.48, 1.35, -0.7),
      new THREE.Vector3(side * 0.68, 1.35, -0.7),
      new THREE.Vector3(side * 0.73, 1.08, -0.58),
      new THREE.Vector3(side * 0.74, 0.92, -0.45),
    ]);
    mesh(
      structure,
      `FuelPipe_${suffix}`,
      new THREE.TubeGeometry(pipePath, 6, 0.045, 4, false),
      materials.iron,
      [0, 0, 0],
    );
  }

  // Paired valves and a bridge clamp give the central tank a supported,
  // serviceable assembly instead of a bare cylinder behind the seat.
  for (const x of [-0.28, 0.28]) {
    cylinder(structure, `TankValveStem_${x}`, 0.045, 0.045, 0.14, [x, 1.64, -0.72], materials.iron, [0, 0, 0], 6);
    cylinder(structure, `TankValveWheel_${x}`, 0.11, 0.11, 0.04, [x, 1.73, -0.72], materials.iron, [Math.PI / 2, 0, 0], 8);
  }
  box(structure, 'TankCradleBridge', [1.42, 0.12, 0.18], [0, 0.78, -0.72], materials.iron);

  // Runner fasteners follow the long outside straps. Sparse rhythm at this
  // pass keeps them readable without spending triangles on invisible rows.
  for (const side of [-1, 1]) {
    for (const z of [-1.35, -0.8, -0.25, 0.3, 0.85, 1.4]) {
      rivet(
        structure,
        `RunnerRivet_${side < 0 ? 'L' : 'R'}_${z}`,
        [side * 0.995, 0.28, z],
        materials.iron,
        [0.55, 1, 1],
      );
    }
  }
  root.add(structure);
}

function addFormDetails(root, materials) {
  const form = new THREE.Group();
  form.name = 'IdentityFormDetails';

  // The concept's prow is a goblin skull bolted to a dark backing plate. The
  // blockout already supplies the cranium, eyes, ears, and nose; these attached
  // planes turn that green blob into a readable brow/jaw/teeth silhouette.
  roundedBox(form, 'ProwBackingPlate', [0.72, 0.5, 0.12], [0, 0.62, 1.35], materials.iron, 0.035);
  roundedBox(form, 'GoblinJaw', [0.4, 0.15, 0.13], [0, 0.47, 1.51], materials.bone, 0.04);
  roundedBox(form, 'GoblinMouthCavity', [0.28, 0.07, 0.04], [0, 0.5, 1.59], materials.iron, 0.018);
  for (const side of [-1, 1]) {
    box(
      form,
      `GoblinBrow_${side < 0 ? 'L' : 'R'}`,
      [0.17, 0.055, 0.07],
      [side * 0.1, 0.75, 1.57],
      materials.bone,
      [0, 0, side * -0.24],
    );
    const cheek = mesh(
      form,
      `GoblinCheekSpike_${side < 0 ? 'L' : 'R'}`,
      new THREE.ConeGeometry(0.055, 0.23, 5),
      materials.bone,
      [side * 0.27, 0.55, 1.53],
      [0, 0, side * -Math.PI / 2],
    );
    cheek.scale.z = 0.7;
  }
  for (const x of [-0.12, -0.04, 0.04, 0.12]) {
    mesh(
      form,
      `GoblinTooth_${String(x).replace('.', '_')}`,
      new THREE.ConeGeometry(0.026, 0.11, 5),
      materials.bone,
      [x, 0.42, 1.59],
      [0, 0, Math.PI],
    );
  }
  for (const spike of [
    { name: 'Top', position: [0, 0.93, 1.35], rotation: [0, 0, Math.PI] },
    { name: 'Left', position: [-0.47, 0.63, 1.35], rotation: [0, 0, -Math.PI / 2] },
    { name: 'Right', position: [0.47, 0.63, 1.35], rotation: [0, 0, Math.PI / 2] },
  ]) {
    mesh(
      form,
      `ProwPlateSpike_${spike.name}`,
      new THREE.ConeGeometry(0.09, 0.32, 4),
      materials.iron,
      spike.position,
      spike.rotation,
    );
  }

  // Buttons establish the tufted upholstery rhythm without a subdivision-heavy
  // quilt mesh. They sit proud by only a few millimeters and stay inside the
  // cushion footprints, so the later texture pass can supply the soft seams.
  for (const x of [-0.22, 0, 0.22]) {
    for (const z of [0.08, 0.38]) {
      rivet(form, `SeatButton_${x}_${z}`, [x, 0.968, z], materials.iron, [0.75, 0.45, 0.75]);
    }
  }
  for (const x of [-0.22, 0, 0.22]) {
    for (const y of [1.02, 1.3]) {
      rivet(form, `BackButton_${x}_${y}`, [x, y, 0.075], materials.iron, [0.75, 0.75, 0.45]);
    }
  }

  // Off-white skull-and-crossbone markings conform to the outward barrel
  // curvature. Lightweight projected patches preserve the six-material cap
  // without the front/rear-view floating caused by tangent-flat primitives.
  for (const side of [-1, 1]) {
    const rocket = root.getObjectByName(side < 0 ? 'Rocket_L' : 'Rocket_R');
    const suffix = side < 0 ? 'L' : 'R';
    const plaqueZ = 0.085;
    const plaqueLift = 0.015;
    const skullY = 0.76 + plaqueLift;
    mesh(
      rocket,
      `RocketSkullMark_${suffix}`,
      rocketSurfaceDiscGeometry(side, plaqueZ, skullY, 0.09, 0.105, 12, 0.01, 1),
      materials.bone,
      [0, 0, 0],
    );
    // Painted, nearly coplanar eye dots make the side plaques read as skulls
    // at gameplay distance. The hairline offset only prevents z-fighting; it
    // is not intended to read as raised geometry.
    for (const eyeOffset of [-0.04, 0.04]) {
      mesh(
        rocket,
        `RocketSkullEye_${suffix}_${eyeOffset < 0 ? 'Rear' : 'Front'}`,
        rocketSurfaceDiscGeometry(
          side,
          plaqueZ + eyeOffset,
          0.79 + plaqueLift,
          0.022,
          0.022,
          8,
          0.013,
        ),
        materials.iron,
        [0, 0, 0],
      );
    }
    for (const angle of [-0.72, 0.72]) {
      mesh(
        rocket,
        `RocketCrossbone_${suffix}_${angle}`,
        rocketSurfaceRibbonGeometry(
          side,
          plaqueZ,
          0.61 + plaqueLift,
          0.3,
          0.035,
          angle,
          0.007,
        ),
        materials.bone,
        [0, 0, 0],
      );
      // Two flat lobes at each endpoint preserve the painted-plaque treatment
      // while giving each diagonal the unmistakable silhouette of a bone.
      for (const endpoint of [-0.15, 0.15]) {
        for (const lobe of [-0.018, 0.018]) {
          mesh(
            rocket,
            `RocketCrossboneNub_${suffix}_${angle}_${endpoint}_${lobe}`,
            rocketSurfaceDiscGeometry(
              side,
              plaqueZ + endpoint * Math.cos(angle) + lobe * Math.sin(angle),
              0.61 + plaqueLift - endpoint * Math.sin(angle) + lobe * Math.cos(angle),
              0.025,
              0.025,
              6,
              0.008,
            ),
            materials.bone,
            [0, 0, 0],
          );
        }
      }
    }
  }
  root.add(form);
}

function addSocket(root, definition) {
  const socket = new THREE.Object3D();
  socket.name = definition.nodeName;
  socket.position.fromArray(definition.position);
  socket.userData = { socketType: definition.id, purpose: definition.purpose };
  root.add(socket);
}

export function createGoblinRocketSled({ stage = 'blockout', sourceFingerprint = null } = {}) {
  if (!SLED_STAGES.includes(stage)) throw new Error(`unknown sled stage: ${stage}`);
  const root = new THREE.Group();
  root.name = 'GoblinRocketSled';
  root.userData = {
    assetId: 'goblin-rocket-sled',
    assetType: 'rideable-mount',
    authoringStage: stage,
    sourceFingerprint,
    frontAxis: [0, 0, 1],
    clips: [],
    sculptRuntime: {
      locomotion: 'runner-based-rocket-glide',
      motionDriver: 'runtime-procedural',
      exhaustSockets: ['Socket_Exhaust_L', 'Socket_Exhaust_R'],
    },
  };
  const materials = createMaterials();
  addRunners(root, materials);
  addDeck(root, materials);
  addRocket(root, materials, -1);
  addRocket(root, materials, 1);
  addSeatAndTank(root, materials);
  addProw(root, materials);
  if (atLeast(stage, 'structural')) addStructuralDetails(root, materials);
  if (atLeast(stage, 'form')) addFormDetails(root, materials);
  if (atLeast(stage, 'material')) applyAuthoredSurface(root, stage);
  for (const definition of SLED_SOCKET_DEFINITIONS) addSocket(root, definition);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  root.position.y = -bounds.min.y;
  root.updateMatrixWorld(true);
  return root;
}

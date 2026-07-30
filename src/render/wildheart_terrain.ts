// Environmental shell for The Wildheart Basin: displaced jungle ground, two
// readable bank routes, a shallow cenote and stream, ritual terraces, waterfalls,
// and dense low-poly foliage. Gameplay height comes only from sim/wildheart_field.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  wildheartFieldHeight,
  wildheartStreamCenter,
  wildheartWaterMask,
} from '../sim/wildheart_field';
import { GFX } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const GROUND_WIDTH = 184;
const GROUND_DEPTH = 280;
const GROUND_CENTER_Z = 109;
const SOIL = new THREE.Color(0x71834f);
const MOSS = new THREE.Color(0x427948);
const PATH = new THREE.Color(0x9c8556);
const WET = new THREE.Color(0x27665b);
const LIMESTONE = new THREE.Color(0xc7b982);

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(a: number, b: number): number {
  const value = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function vertexMaterial(): THREE.Material {
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.94,
        metalness: 0.01,
        flatShading: true,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    : new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
  markSharedMaterial(material);
  return material;
}

let groundTexture: THREE.CanvasTexture | null = null;

function jungleSoilTexture(): THREE.CanvasTexture {
  if (groundTexture) return groundTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Wildheart soil texture canvas unavailable');
  context.fillStyle = '#91a472';
  context.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2100; i++) {
    const x = hash(i, 1) * 256;
    const y = hash(i, 2) * 256;
    const green = 92 + Math.floor(hash(i, 3) * 68);
    const red = 74 + Math.floor(hash(i, 4) * 58);
    context.fillStyle = `rgba(${red},${green + 20},${green - 12},${0.08 + hash(i, 5) * 0.2})`;
    const size = 0.8 + hash(i, 6) * 3.4;
    context.fillRect(x, y, size, size * (0.45 + hash(i, 7)));
  }
  groundTexture = new THREE.CanvasTexture(canvas);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(24, 38);
  return groundTexture;
}

const groundMaterials = new Map<boolean, THREE.Material>();

function groundMaterial(lowGfx: boolean): THREE.Material {
  const cached = groundMaterials.get(lowGfx);
  if (cached) return cached;
  const options = {
    map: jungleSoilTexture(),
    vertexColors: true,
    flatShading: true,
  } as const;
  const material = lowGfx
    ? new THREE.MeshLambertMaterial(options)
    : new THREE.MeshStandardMaterial({ ...options, roughness: 0.98, metalness: 0 });
  markSharedMaterial(material);
  groundMaterials.set(lowGfx, material);
  return material;
}

function routeX(side: -1 | 1, z: number): number {
  const opening = smoothstep(38, 78, z);
  const converge = 1 - smoothstep(155, 198, z);
  return side * (8 + 31 * opening * converge) + Math.sin(z * 0.055 + side) * 2.2;
}

function routeDistance(x: number, z: number): number {
  return Math.min(Math.abs(x - routeX(-1, z)), Math.abs(x - routeX(1, z)));
}

let groundGeometry: THREE.BufferGeometry | null = null;

function buildGround(lowGfx: boolean): THREE.Mesh {
  if (!groundGeometry) {
    groundGeometry = new THREE.PlaneGeometry(GROUND_WIDTH, GROUND_DEPTH, 112, 188).rotateX(
      -Math.PI / 2,
    );
    const positions = groundGeometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i) + GROUND_CENTER_Z;
      const y = wildheartFieldHeight(x, z);
      positions.setY(i, y);
      const route = 1 - smoothstep(5, 17, routeDistance(x, z));
      const water = wildheartWaterMask(x, z);
      const shoulder = smoothstep(4.5, 10, y);
      const moss = hash(Math.floor(x / 8), Math.floor(z / 8)) * 0.28;
      color
        .copy(SOIL)
        .lerp(PATH, route * 0.52)
        .lerp(WET, water * 0.68)
        .lerp(MOSS, moss + water * 0.18)
        .lerp(LIMESTONE, shoulder * 0.72);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    groundGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundGeometry.computeVertexNormals();
    markSharedGeometry(groundGeometry);
  }
  const ground = new THREE.Mesh(groundGeometry, groundMaterial(lowGfx));
  ground.position.z = GROUND_CENTER_Z;
  ground.receiveShadow = true;
  return ground;
}

const pathGeometries = new Map<number, THREE.BufferGeometry>();
let pathMaterial: THREE.Material | null = null;

function buildPath(side: -1 | 1): THREE.Mesh {
  let geometry = pathGeometries.get(side);
  if (!geometry) {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const segments = 70;
    const color = new THREE.Color();
    for (let i = 0; i <= segments; i++) {
      const z = 38 + (i / segments) * 163;
      const center = routeX(side, z);
      const dx = routeX(side, z + 0.7) - routeX(side, z - 0.7);
      const length = Math.hypot(dx, 1.4);
      const nx = 1.4 / length;
      const nz = -dx / length;
      const halfWidth = 2.7 + hash(i, side) * 0.65;
      for (const edge of [-1, 1]) {
        const x = center + nx * halfWidth * edge;
        const edgeZ = z + nz * halfWidth * edge;
        positions.push(x, wildheartFieldHeight(x, edgeZ) + 0.055, edgeZ);
        color.setHex(i % 8 === 0 ? 0x9d8959 : 0x74683f);
        color.multiplyScalar(0.88 + hash(i, edge + side * 3) * 0.18);
        colors.push(color.r, color.g, color.b);
      }
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    markSharedGeometry(geometry);
    pathGeometries.set(side, geometry);
  }
  pathMaterial ??= vertexMaterial();
  const path = new THREE.Mesh(geometry, pathMaterial);
  path.receiveShadow = true;
  return path;
}

let waterMaterial: THREE.MeshPhysicalMaterial | THREE.MeshLambertMaterial | null = null;

function basinWaterMaterial(lowGfx: boolean): THREE.Material {
  if (waterMaterial) return waterMaterial;
  waterMaterial = lowGfx
    ? new THREE.MeshLambertMaterial({
        color: 0x0a5551,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    : new THREE.MeshPhysicalMaterial({
        color: 0x16776f,
        emissive: 0x073e39,
        emissiveIntensity: 0.12,
        roughness: 0.22,
        metalness: 0,
        transparent: true,
        opacity: 0.78,
        transmission: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
  markSharedMaterial(waterMaterial);
  return waterMaterial;
}

let streamGeometry: THREE.BufferGeometry | null = null;

function buildWater(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  const material = basinWaterMaterial(lowGfx);
  if (!streamGeometry) {
    const positions: number[] = [];
    const indices: number[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const z = 27 + (i / segments) * 150;
      const center = wildheartStreamCenter(z);
      const width = 4.8 + 2.1 * Math.sin((i / segments) * Math.PI) ** 2;
      for (const side of [-1, 1]) {
        const x = center + side * width;
        positions.push(x, wildheartFieldHeight(center, z) + 0.55, z);
      }
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    streamGeometry = new THREE.BufferGeometry();
    streamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    streamGeometry.setIndex(indices);
    streamGeometry.computeVertexNormals();
    markSharedGeometry(streamGeometry);
  }
  const stream = new THREE.Mesh(streamGeometry, material);
  stream.renderOrder = 2;
  group.add(stream);

  const cenoteGeometry = new THREE.CircleGeometry(35, 48).rotateX(-Math.PI / 2);
  cenoteGeometry.scale(1, 1, 1.48);
  markSharedGeometry(cenoteGeometry);
  const cenote = new THREE.Mesh(cenoteGeometry, material);
  cenote.position.set(0, -0.46, 104);
  cenote.renderOrder = 2;
  group.add(cenote);
  return group;
}

let arenaGeometry: THREE.BufferGeometry | null = null;
let arenaMaterial: THREE.Material | null = null;

function buildTempleArena(): THREE.Mesh {
  if (!arenaGeometry) {
    const blocks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2;
      const radius = 19.5;
      const x = Math.sin(angle) * radius;
      const z = 213 + Math.cos(angle) * radius;
      const block = new THREE.BoxGeometry(4.5, 0.2, 2.7);
      block.rotateY(-angle);
      block.translate(x, wildheartFieldHeight(x, z) + 0.1, z);
      blocks.push(block);
    }
    arenaGeometry = mergeGeometries(blocks, false);
    if (!arenaGeometry) throw new Error('Wildheart arena geometry merge failed');
    markSharedGeometry(arenaGeometry);
  }
  arenaMaterial ??= new THREE.MeshLambertMaterial({ color: 0xc0a66d, flatShading: true });
  markSharedMaterial(arenaMaterial);
  const arena = new THREE.Mesh(arenaGeometry, arenaMaterial);
  arena.castShadow = true;
  arena.receiveShadow = true;
  return arena;
}

let foliageTrunkGeometry: THREE.BufferGeometry | null = null;
let foliageCrownGeometry: THREE.BufferGeometry | null = null;
let foliageTrunkMaterial: THREE.Material | null = null;
let foliageDarkMaterial: THREE.Material | null = null;
let foliageMidMaterial: THREE.Material | null = null;
let foliageLightMaterial: THREE.Material | null = null;

function buildFoliage(): THREE.Group {
  const group = new THREE.Group();
  foliageTrunkGeometry ??= new THREE.CylinderGeometry(0.28, 0.52, 5.6, 7);
  foliageCrownGeometry ??= new THREE.DodecahedronGeometry(1, 0);
  foliageTrunkMaterial ??= new THREE.MeshLambertMaterial({ color: 0x493c25, flatShading: true });
  foliageDarkMaterial ??= new THREE.MeshLambertMaterial({ color: 0x245436, flatShading: true });
  foliageMidMaterial ??= new THREE.MeshLambertMaterial({ color: 0x357245, flatShading: true });
  foliageLightMaterial ??= new THREE.MeshLambertMaterial({ color: 0x4b873f, flatShading: true });
  for (const resource of [
    foliageTrunkGeometry,
    foliageCrownGeometry,
    foliageTrunkMaterial,
    foliageDarkMaterial,
    foliageMidMaterial,
    foliageLightMaterial,
  ]) {
    if (resource instanceof THREE.BufferGeometry) markSharedGeometry(resource);
    else markSharedMaterial(resource);
  }

  const spots: Array<{ x: number; z: number; scale: number }> = [];
  for (let i = 0; i < 96; i++) {
    const edge = i % 4 !== 0;
    const x = edge ? (i % 2 ? -1 : 1) * (63 + hash(i, 1) * 13) : -57 + hash(i, 2) * 114;
    const z = 18 + hash(i, 3) * 216;
    if (!edge && (routeDistance(x, z) < 17 || wildheartWaterMask(x, z) > 0.22)) continue;
    spots.push({ x, z, scale: 0.72 + hash(i, 4) * 0.7 });
  }
  const trunks = new THREE.InstancedMesh(foliageTrunkGeometry, foliageTrunkMaterial, spots.length);
  const crowns = [
    new THREE.InstancedMesh(foliageCrownGeometry, foliageDarkMaterial, spots.length),
    new THREE.InstancedMesh(foliageCrownGeometry, foliageMidMaterial, spots.length),
    new THREE.InstancedMesh(foliageCrownGeometry, foliageLightMaterial, spots.length),
  ];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i];
    const y = wildheartFieldHeight(spot.x, spot.z);
    const angle = hash(i, 8) * Math.PI * 2;
    quaternion.setFromEuler(new THREE.Euler(0, angle, 0));
    scale.set(spot.scale, spot.scale, spot.scale);
    position.set(spot.x, y + 2.8 * spot.scale, spot.z);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(i, matrix);
    for (let layer = 0; layer < crowns.length; layer++) {
      const side = layer === 0 ? -1 : layer === 1 ? 1 : 0;
      const radius = spot.scale * (layer === 2 ? 2.35 : 2.05);
      position.set(
        spot.x + Math.cos(angle + layer * 2.1) * side * 1.25 * spot.scale,
        y + (5.4 + layer * 0.72) * spot.scale,
        spot.z + Math.sin(angle + layer * 2.1) * side * 1.05 * spot.scale,
      );
      scale.set(radius, radius * (layer === 2 ? 0.7 : 0.82), radius * 0.92);
      matrix.compose(position, quaternion, scale);
      crowns[layer].setMatrixAt(i, matrix);
    }
  }
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  trunks.instanceMatrix.needsUpdate = true;
  for (const crown of crowns) {
    crown.castShadow = true;
    crown.receiveShadow = true;
    crown.instanceMatrix.needsUpdate = true;
  }
  group.add(trunks, ...crowns);
  return group;
}

let waterfallMaterial: THREE.MeshBasicMaterial | null = null;
let waterfallFoamMaterial: THREE.MeshBasicMaterial | null = null;
const waterfallGeometries = new Map<string, THREE.BufferGeometry>();
let waterfallFoamGeometry: THREE.BufferGeometry | null = null;

let fireflyGeometry: THREE.BufferGeometry | null = null;
const fireflyMaterials = new Map<boolean, THREE.PointsMaterial>();

function buildFireflies(lowGfx: boolean): THREE.Points {
  if (!fireflyGeometry) {
    const positions: number[] = [];
    const colors: number[] = [];
    const jade = new THREE.Color(0x86e896);
    const gold = new THREE.Color(0xffd06a);
    for (let i = 0; i < 128; i++) {
      const side = i % 2 ? -1 : 1;
      const x = side * (22 + hash(i, 21) * 50);
      const z = 34 + hash(i, 22) * 190;
      const y = wildheartFieldHeight(x, z) + 1.4 + hash(i, 23) * 5.5;
      positions.push(x, y, z);
      const color = i % 3 === 0 ? gold : jade;
      colors.push(color.r, color.g, color.b);
    }
    fireflyGeometry = new THREE.BufferGeometry();
    fireflyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    fireflyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    markSharedGeometry(fireflyGeometry);
  }
  let material = fireflyMaterials.get(lowGfx);
  if (!material) {
    material = new THREE.PointsMaterial({
      size: lowGfx ? 0.16 : 0.24,
      vertexColors: true,
      transparent: true,
      opacity: lowGfx ? 0.62 : 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    markSharedMaterial(material);
    fireflyMaterials.set(lowGfx, material);
  }
  return new THREE.Points(fireflyGeometry, material);
}

function buildWaterfalls(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  waterfallMaterial ??= new THREE.MeshBasicMaterial({
    color: 0x4db7a5,
    transparent: true,
    opacity: lowGfx ? 0.5 : 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  markSharedMaterial(waterfallMaterial);
  waterfallFoamMaterial ??= new THREE.MeshBasicMaterial({
    color: 0xb9f0d8,
    transparent: true,
    opacity: lowGfx ? 0.34 : 0.5,
    depthWrite: false,
  });
  markSharedMaterial(waterfallFoamMaterial);
  waterfallFoamGeometry ??= new THREE.CircleGeometry(3.6, 18).rotateX(-Math.PI / 2);
  markSharedGeometry(waterfallFoamGeometry);
  for (const [x, z] of [
    [-72, 92],
    [72, 145],
    [-70, 188],
  ] as const) {
    const key = `${x}:${z}`;
    let geometry = waterfallGeometries.get(key);
    if (!geometry) {
      const positions: number[] = [];
      const indices: number[] = [];
      const segments = 10;
      const bottomX = x * 0.84;
      const topY = wildheartFieldHeight(x, z) + 0.48;
      const bottomY = wildheartFieldHeight(bottomX, z) + 0.42;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const eased = smoothstep(0, 1, t);
        const centerX = x + (bottomX - x) * eased;
        const y = topY + (bottomY - topY) * t - Math.sin(t * Math.PI) * 0.18;
        const centerZ = z + (hash(i, z) - 0.5) * 0.72;
        const halfWidth = 2.05 + t * 0.85 + (hash(i, x) - 0.5) * 0.42;
        positions.push(centerX, y, centerZ - halfWidth, centerX, y, centerZ + halfWidth);
        if (i < segments) {
          const a = i * 2;
          indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      markSharedGeometry(geometry);
      waterfallGeometries.set(key, geometry);
    }
    const fall = new THREE.Mesh(geometry, waterfallMaterial);
    fall.renderOrder = 2;
    group.add(fall);
    const bottomX = x * 0.84;
    const bottomY = wildheartFieldHeight(bottomX, z) + 0.42;
    const foam = new THREE.Mesh(waterfallFoamGeometry, waterfallFoamMaterial);
    foam.position.set(bottomX, bottomY + 0.03, z);
    foam.scale.set(1.4, 1, 0.72);
    foam.renderOrder = 3;
    group.add(foam);
  }
  return group;
}

export function buildWildheartTerrain(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wildheartTerrain';
  group.add(buildGround(lowGfx));
  group.add(buildPath(-1), buildPath(1));
  group.add(buildWater(lowGfx));
  group.add(buildTempleArena());
  group.add(buildFoliage());
  group.add(buildWaterfalls(lowGfx));
  group.add(buildFireflies(lowGfx));
  return group;
}

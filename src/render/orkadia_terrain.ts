// Orkadia's environmental shell: a faceted volcanic basin, processional stone
// route, fel fissures, basalt ribs, boss ring, distant mountain, and storm dome.
// Gameplay height still comes only from sim/orkadia_field.ts.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ORKADIA_FIELD_BOUNDS, orkadiaFieldHeight, orkadiaRouteCenter } from '../sim/orkadia_field';
import { GFX } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';

const GROUND_WIDTH = 176;
const GROUND_DEPTH = 276;
const GROUND_CENTER_Z = 110;

const ASH = new THREE.Color(0x706860);
const TRACK = new THREE.Color(0x474640);
const BASALT = new THREE.Color(0x3b4140);
const SCORCH = new THREE.Color(0x463a32);

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function colorGeometry(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const count = geometry.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const shade = 0.82 + hash(i, color) * 0.22;
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function vertexMaterial(): THREE.Material {
  const mat = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0.02,
        flatShading: true,
      })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  markSharedMaterial(mat);
  return mat;
}

let ashTexture: THREE.CanvasTexture | null = null;

function orkadiaAshTexture(): THREE.CanvasTexture {
  if (ashTexture) return ashTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Orkadia ash texture canvas unavailable');
  // This map multiplies the authored vertex palette. Keep its base close to
  // white so the ground stays readable under the storm grade; the flecks carry
  // the ash detail instead of turning every color nearly black.
  ctx.fillStyle = '#d3cbc0';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2300; i++) {
    const x = hash(i, 1) * 256;
    const y = hash(i, 2) * 256;
    const shade = 70 + Math.floor(hash(i, 3) * 100);
    const alpha = 0.08 + hash(i, 4) * 0.2;
    ctx.fillStyle = `rgba(${shade},${Math.floor(shade * 0.86)},${Math.floor(shade * 0.73)},${alpha})`;
    const r = 0.8 + hash(i, 5) * 3.2;
    ctx.fillRect(x, y, r, r * (0.4 + hash(i, 6)));
  }
  ctx.strokeStyle = 'rgba(35,27,24,0.2)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 28; i++) {
    const x = hash(i, 10) * 256;
    const y = hash(i, 11) * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (hash(i, 12) - 0.5) * 30, y + 8 + hash(i, 13) * 22);
    ctx.stroke();
  }
  ashTexture = new THREE.CanvasTexture(canvas);
  ashTexture.colorSpace = THREE.SRGBColorSpace;
  ashTexture.wrapS = ashTexture.wrapT = THREE.RepeatWrapping;
  ashTexture.repeat.set(26, 44);
  return ashTexture;
}

const groundMaterials = new Map<boolean, THREE.Material>();

function groundMaterial(lowGfx: boolean): THREE.Material {
  const cached = groundMaterials.get(lowGfx);
  if (cached) return cached;
  const opts = {
    map: orkadiaAshTexture(),
    vertexColors: true,
    flatShading: true,
  } as const;
  const mat = lowGfx
    ? new THREE.MeshLambertMaterial(opts)
    : new THREE.MeshStandardMaterial({ ...opts, roughness: 1, metalness: 0 });
  markSharedMaterial(mat);
  groundMaterials.set(lowGfx, mat);
  return mat;
}

let groundGeometry: THREE.BufferGeometry | null = null;

function buildGround(lowGfx: boolean): THREE.Mesh {
  if (!groundGeometry) {
    groundGeometry = new THREE.PlaneGeometry(GROUND_WIDTH, GROUND_DEPTH, 112, 192).rotateX(
      -Math.PI / 2,
    );
    const positions = groundGeometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i) + GROUND_CENTER_Z;
      const y = orkadiaFieldHeight(x, z);
      positions.setY(i, y);

      const routeDistance = Math.abs(x - orkadiaRouteCenter(z));
      const track = 1 - smoothstep(7, 23, routeDistance);
      const shoulder = smoothstep(3.2, 8.5, y);
      const scorched = hash(Math.floor(x / 9), Math.floor(z / 9)) * 0.16;
      color
        .copy(ASH)
        .lerp(TRACK, track * 0.78)
        .lerp(BASALT, shoulder * 0.88)
        .lerp(SCORCH, scorched);
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

let routeGeometry: THREE.BufferGeometry | null = null;
let routeMaterial: THREE.Material | null = null;

function buildProcessionalRoute(): THREE.Mesh {
  if (!routeGeometry) {
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const segments = 58;
    const color = new THREE.Color();
    for (let i = 0; i <= segments; i++) {
      const z = 24 + (i / segments) * 183;
      const centerX = orkadiaRouteCenter(z);
      const dx = orkadiaRouteCenter(z + 0.8) - orkadiaRouteCenter(z - 0.8);
      const tangentLength = Math.hypot(dx, 1.6);
      const normalX = 1.6 / tangentLength;
      const normalZ = -dx / tangentLength;
      const halfWidth = 3.8 + hash(i, 23) * 1.25;
      for (const side of [-1, 1]) {
        const x = centerX + normalX * halfWidth * side;
        const edgeZ = z + normalZ * halfWidth * side;
        positions.push(x, orkadiaFieldHeight(x, edgeZ) + 0.045, edgeZ);
        color.setHex(i % 7 === 0 ? 0x514b42 : 0x47443e);
        color.multiplyScalar(0.9 + hash(i, side) * 0.16);
        colors.push(color.r, color.g, color.b);
      }
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    routeGeometry = new THREE.BufferGeometry();
    routeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    routeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    routeGeometry.setIndex(indices);
    routeGeometry.computeVertexNormals();
    markSharedGeometry(routeGeometry);
  }
  routeMaterial ??= vertexMaterial();
  const route = new THREE.Mesh(routeGeometry, routeMaterial);
  route.receiveShadow = true;
  return route;
}

let arenaGeometry: THREE.BufferGeometry | null = null;
let arenaMaterial: THREE.Material | null = null;

function buildBossArena(): THREE.Group {
  const group = new THREE.Group();
  if (!arenaGeometry) {
    const pieces: THREE.BufferGeometry[] = [];
    const segments = 24;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const r = 18.5;
      const x = Math.sin(a) * r;
      const z = 220 + Math.cos(a) * r;
      const block = new THREE.BoxGeometry(4.8, 0.18, 3.1);
      block.rotateY(-a);
      block.translate(x, orkadiaFieldHeight(x, z) + 0.09, z);
      pieces.push(colorGeometry(block, i % 3 === 0 ? 0x51463d : 0x383838));
    }
    arenaGeometry = mergeGeometries(pieces, false);
    if (!arenaGeometry) throw new Error('Orkadia arena geometry merge failed');
    markSharedGeometry(arenaGeometry);
  }
  arenaMaterial ??= vertexMaterial();
  const ring = new THREE.Mesh(arenaGeometry, arenaMaterial);
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);
  return group;
}

function fissureRibbon(points: readonly [number, number][], width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.max(0.001, Math.hypot(dx, dz));
    const sx = (dz / len) * width;
    const sz = (-dx / len) * width;
    const y = orkadiaFieldHeight(x, z) + 0.13;
    positions.push(x - sx, y, z - sz, x + sx, y, z + sz);
    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const fissureMats = new Map<string, THREE.MeshBasicMaterial>();

function fissureMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  const key = `${color}:${opacity}`;
  const cached = fissureMats.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: opacity === 1,
    side: THREE.DoubleSide,
  });
  markSharedMaterial(mat);
  fissureMats.set(key, mat);
  return mat;
}

const FISSURES: readonly (readonly [number, number][])[] = [
  [
    [-57, 34],
    [-48, 56],
    [-53, 80],
    [-45, 106],
    [-51, 132],
    [-43, 158],
    [-47, 186],
  ],
  [
    [54, 72],
    [45, 96],
    [50, 121],
    [41, 147],
    [46, 174],
    [35, 202],
  ],
  [
    [-28, 205],
    [-35, 218],
    [-43, 233],
  ],
];

function buildFelFissures(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  for (const path of FISSURES) {
    const borderGeo = fissureRibbon(path, lowGfx ? 1.1 : 1.45);
    const glowGeo = fissureRibbon(path, lowGfx ? 0.35 : 0.5);
    const border = new THREE.Mesh(borderGeo, fissureMaterial(0x151917, 1));
    const glow = new THREE.Mesh(glowGeo, fissureMaterial(0x63ff38, lowGfx ? 0.75 : 0.95));
    glow.position.y = 0.04;
    glow.renderOrder = 2;
    group.add(border, glow);
  }
  return group;
}

let ribsGeometry: THREE.BufferGeometry | null = null;
let ribsMaterial: THREE.Material | null = null;

function buildBasaltRibs(): THREE.Mesh {
  if (!ribsGeometry) {
    const ribs: THREE.BufferGeometry[] = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 19; i++) {
        const z = -10 + i * 13.2;
        const x = side * (73 + hash(i, side) * 4);
        const h = 11 + hash(i, side * 7) * 15;
        const r = 2.6 + hash(i, side * 9) * 3.4;
        const rib = new THREE.CylinderGeometry(r * 0.28, r, h, 5);
        rib.rotateY(hash(i, side * 11) * Math.PI);
        rib.rotateZ((hash(i, side * 13) - 0.5) * 0.14);
        rib.translate(x, orkadiaFieldHeight(x, z) + h * 0.45, z);
        ribs.push(colorGeometry(rib, i % 4 === 0 ? 0x34383b : 0x24282b));
      }
    }
    ribsGeometry = mergeGeometries(ribs, false);
    if (!ribsGeometry) throw new Error('Orkadia basalt geometry merge failed');
    markSharedGeometry(ribsGeometry);
  }
  ribsMaterial ??= vertexMaterial();
  const mesh = new THREE.Mesh(ribsGeometry, ribsMaterial);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

let mountainGeometry: THREE.BufferGeometry | null = null;
let mountainMaterial: THREE.Material | null = null;

function buildDistantMountain(): THREE.Mesh {
  if (!mountainGeometry) {
    const peaks: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const x = -46 + i * 11.5;
      const h = 34 + hash(i, 81) * 36;
      const r = 10 + hash(i, 82) * 8;
      const peak = new THREE.ConeGeometry(r, h, 5);
      peak.rotateY(hash(i, 83) * Math.PI);
      peak.translate(x, 17 + h * 0.45, 272 + hash(i, 84) * 12);
      peaks.push(colorGeometry(peak, i % 2 ? 0x171b1e : 0x202427));
    }
    mountainGeometry = mergeGeometries(peaks, false);
    if (!mountainGeometry) throw new Error('Orkadia mountain geometry merge failed');
    markSharedGeometry(mountainGeometry);
  }
  mountainMaterial ??= vertexMaterial();
  const mountain = new THREE.Mesh(mountainGeometry, mountainMaterial);
  mountain.castShadow = true;
  mountain.receiveShadow = true;
  return mountain;
}

let stormTexture: THREE.CanvasTexture | null = null;
let stormGeometry: THREE.BufferGeometry | null = null;
let stormMaterial: THREE.MeshBasicMaterial | null = null;

function buildStormDome(): THREE.Mesh {
  if (!stormTexture) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Orkadia storm texture canvas unavailable');
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#111923');
    gradient.addColorStop(0.42, '#2c3740');
    gradient.addColorStop(0.72, '#545c58');
    gradient.addColorStop(1, '#2d342d');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 170; i++) {
      const x = hash(i, 91) * 1100 - 40;
      const y = 45 + hash(i, 92) * 310;
      const rx = 35 + hash(i, 93) * 115;
      const ry = 10 + hash(i, 94) * 38;
      const shade = 45 + Math.floor(hash(i, 95) * 45);
      ctx.fillStyle = `rgba(${shade},${shade + 4},${shade + 8},${0.05 + hash(i, 96) * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, hash(i, 97) * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    const horizon = ctx.createRadialGradient(512, 430, 10, 512, 430, 250);
    horizon.addColorStop(0, 'rgba(85,125,62,0.24)');
    horizon.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = horizon;
    ctx.fillRect(250, 250, 524, 262);
    stormTexture = new THREE.CanvasTexture(canvas);
    stormTexture.colorSpace = THREE.SRGBColorSpace;
  }
  if (!stormGeometry) {
    stormGeometry = new THREE.SphereGeometry(340, 36, 18);
    markSharedGeometry(stormGeometry);
  }
  if (!stormMaterial) {
    stormMaterial = new THREE.MeshBasicMaterial({
      map: stormTexture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    markSharedMaterial(stormMaterial);
  }
  const dome = new THREE.Mesh(stormGeometry, stormMaterial);
  dome.position.set(0, 30, 110);
  dome.renderOrder = -10;
  return dome;
}

export function buildOrkadiaTerrain(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'orkadiaTerrain';
  group.add(buildGround(lowGfx));
  group.add(buildProcessionalRoute());
  group.add(buildBossArena());
  group.add(buildFelFissures(lowGfx));
  group.add(buildBasaltRibs());
  group.add(buildDistantMountain());
  group.add(buildStormDome());
  return group;
}

export const orkadiaTerrainInternalsForTest = {
  bounds: ORKADIA_FIELD_BOUNDS,
  fissures: FISSURES,
};

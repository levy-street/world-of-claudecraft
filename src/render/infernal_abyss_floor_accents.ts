// Authored floor accents for the Infernal Abyss. The strips and crust islands
// are presentation only, share the dungeon group's lifetime, and never alter
// simulation collision or hazard geometry.
import * as THREE from 'three';
import type { DungeonLayout } from '../sim/dungeon_layout';
import { hash2 } from '../sim/rng';
import { sharedUniforms } from './gfx';

type Point2 = readonly [x: number, z: number];

interface VeinSpec {
  room: string;
  points: readonly Point2[];
  width: number;
  heat: number;
  essential?: boolean;
}

interface PlateSpec {
  room: string;
  x: number;
  z: number;
  rx: number;
  rz: number;
  yaw: number;
  corners: number;
  essential?: boolean;
}

export interface InfernalAbyssFloorAccentStats {
  drawCalls: number;
  veinPaths: number;
  veinSegments: number;
  crustPlates: number;
  triangles: number;
}

// These paths are composed around specific landmarks rather than scattered
// over room rectangles. Long fractures establish flow, while short branches
// break the silhouette around turns, machines, and the boss ritual floor.
const VEINS: readonly VeinSpec[] = [
  {
    room: 'ashen_descent_entrance',
    points: [
      [-8, -22],
      [-3, -18],
      [-6, -12],
      [-1, -6],
      [0, 3],
    ],
    width: 0.46,
    heat: 0.76,
    essential: true,
  },
  {
    room: 'ashen_descent_entrance',
    points: [
      [10, -21],
      [6, -16],
      [8, -10],
      [3, -4],
    ],
    width: 0.3,
    heat: 0.6,
  },
  {
    room: 'chainscar_descent',
    points: [
      [-1, 7],
      [3, 12],
      [0, 17],
      [4, 23],
      [1, 30],
    ],
    width: 0.38,
    heat: 0.68,
    essential: true,
  },
  {
    room: 'lower_forge_junction',
    points: [
      [-13, 27],
      [-8, 29],
      [-4, 34],
      [-11, 37],
      [-15, 42],
    ],
    width: 0.27,
    heat: 0.52,
  },
  {
    room: 'lava_maze',
    points: [
      [-15, 44],
      [-20, 49],
      [-18, 55],
      [-26, 61],
      [-31, 68],
      [-29, 76],
      [-35, 83],
      [-36, 91],
    ],
    width: 0.56,
    heat: 0.88,
    essential: true,
  },
  {
    room: 'lava_maze',
    points: [
      [-49, 45],
      [-47, 52],
      [-51, 58],
      [-46, 64],
      [-50, 72],
      [-47, 80],
      [-50, 89],
    ],
    width: 0.5,
    heat: 0.82,
    essential: true,
  },
  {
    room: 'lava_maze',
    points: [
      [9, 45],
      [4, 51],
      [7, 57],
      [3, 64],
      [5, 72],
      [2, 80],
      [7, 89],
    ],
    width: 0.44,
    heat: 0.76,
    essential: true,
  },
  {
    room: 'lava_maze',
    points: [
      [-52, 67],
      [-44, 64],
      [-37, 66],
      [-32, 72],
      [-24, 74],
      [-17, 79],
      [-10, 84],
    ],
    width: 0.3,
    heat: 0.68,
  },
  {
    room: 'lava_maze',
    points: [
      [-43, 90],
      [-39, 84],
      [-42, 78],
      [-38, 72],
    ],
    width: 0.25,
    heat: 0.55,
  },
  {
    room: 'lava_maze',
    points: [
      [-29, 44],
      [-34, 51],
      [-31, 56],
      [-38, 60],
    ],
    width: 0.24,
    heat: 0.59,
  },
  {
    room: 'lava_maze',
    points: [
      [-14, 63],
      [-8, 66],
      [-4, 72],
    ],
    width: 0.22,
    heat: 0.48,
  },
  {
    room: 'lava_maze',
    points: [
      [-27, 89],
      [-21, 84],
      [-16, 88],
      [-11, 90],
    ],
    width: 0.24,
    heat: 0.54,
  },
  {
    room: 'infernal_forge',
    points: [
      [0, 94],
      [-2, 100],
      [1, 106],
      [-1, 113],
      [2, 120],
      [-1, 127],
      [0, 135],
    ],
    width: 0.68,
    heat: 1,
    essential: true,
  },
  {
    room: 'infernal_forge',
    points: [
      [-28, 96],
      [-22, 100],
      [-17, 105],
      [-12, 110],
      [-8, 117],
      [-11, 124],
      [-7, 133],
    ],
    width: 0.4,
    heat: 0.76,
    essential: true,
  },
  {
    room: 'infernal_forge',
    points: [
      [28, 96],
      [22, 101],
      [18, 108],
      [13, 112],
      [9, 119],
      [12, 126],
      [8, 134],
    ],
    width: 0.4,
    heat: 0.78,
    essential: true,
  },
  {
    room: 'infernal_forge',
    points: [
      [-24, 133],
      [-18, 128],
      [-21, 122],
      [-16, 116],
    ],
    width: 0.28,
    heat: 0.58,
  },
  {
    room: 'infernal_forge',
    points: [
      [-1, 112],
      [-7, 109],
      [-13, 105],
      [-19, 107],
    ],
    width: 0.26,
    heat: 0.61,
  },
  {
    room: 'infernal_forge',
    points: [
      [1, 120],
      [8, 117],
      [15, 119],
      [21, 115],
      [27, 118],
    ],
    width: 0.3,
    heat: 0.64,
  },
  {
    room: 'infernal_forge',
    points: [
      [-26, 102],
      [-20, 107],
      [-23, 113],
    ],
    width: 0.22,
    heat: 0.52,
  },
  {
    room: 'infernal_forge',
    points: [
      [26, 129],
      [20, 124],
      [17, 131],
    ],
    width: 0.22,
    heat: 0.53,
  },
  {
    room: 'maw_approach',
    points: [
      [-3, 137],
      [1, 140],
      [-2, 144],
      [0, 147],
    ],
    width: 0.33,
    heat: 0.72,
    essential: true,
  },
  {
    room: 'heart_cairn_vestibule',
    points: [
      [-6, 180],
      [-2, 184],
      [3, 187],
      [-2, 191],
      [1, 196],
      [0, 201],
    ],
    width: 0.52,
    heat: 0.88,
    essential: true,
  },
  {
    room: 'heart_cairn_vestibule',
    points: [
      [-10, 181],
      [-7, 186],
      [-11, 190],
      [-14, 194],
    ],
    width: 0.26,
    heat: 0.57,
  },
  {
    room: 'heart_cairn_vestibule',
    points: [
      [10, 181],
      [6, 185],
      [11, 188],
      [14, 193],
    ],
    width: 0.26,
    heat: 0.58,
  },
  {
    room: 'heart_cairn_boss_arena',
    points: [
      [-40, 207],
      [-33, 210],
      [-27, 208],
      [-21, 212],
      [-14, 214],
      [-7, 216],
      [0, 217],
      [7, 215],
      [14, 218],
      [22, 215],
      [30, 219],
      [40, 216],
    ],
    width: 0.72,
    heat: 1,
    essential: true,
  },
  {
    room: 'heart_cairn_boss_arena',
    points: [
      [0, 202],
      [-3, 207],
      [0, 211],
      [-2, 216],
      [1, 222],
      [0, 230],
    ],
    width: 0.52,
    heat: 0.94,
    essential: true,
  },
  {
    room: 'heart_cairn_boss_arena',
    points: [
      [-40, 212],
      [-35, 215],
      [-32, 220],
      [-36, 224],
      [-30, 229],
    ],
    width: 0.4,
    heat: 0.72,
    essential: true,
  },
  {
    room: 'heart_cairn_boss_arena',
    points: [
      [40, 210],
      [35, 213],
      [32, 218],
      [36, 222],
      [30, 228],
    ],
    width: 0.4,
    heat: 0.72,
    essential: true,
  },
  {
    room: 'heart_cairn_crown',
    points: [
      [-25, 229],
      [-19, 225],
      [-13, 229],
      [-8, 224],
      [-3, 230],
    ],
    width: 0.32,
    heat: 0.62,
  },
  {
    room: 'heart_cairn_crown',
    points: [
      [25, 229],
      [19, 225],
      [13, 229],
      [8, 224],
      [3, 230],
    ],
    width: 0.32,
    heat: 0.62,
  },
  {
    room: 'heart_cairn_boss_arena',
    points: [
      [-22, 204],
      [-18, 207],
      [-15, 203],
      [-10, 206],
    ],
    width: 0.24,
    heat: 0.55,
  },
  {
    room: 'heart_cairn_boss_arena',
    points: [
      [22, 204],
      [18, 207],
      [15, 203],
      [10, 206],
    ],
    width: 0.24,
    heat: 0.55,
  },
  {
    room: 'heart_cairn_boss_arena',
    points: [
      [-3, 214],
      [-9, 211],
      [-14, 209],
    ],
    width: 0.27,
    heat: 0.64,
  },
  {
    room: 'heart_cairn_boss_arena',
    points: [
      [3, 219],
      [10, 222],
      [16, 221],
    ],
    width: 0.27,
    heat: 0.64,
  },
] as const;

// Each island has an authored footprint and placement. Only the edge wobble is
// hash-derived, which keeps the silhouettes reproducible without making the
// room read as a uniform noise field.
const PLATES: readonly PlateSpec[] = [
  { room: 'ashen_descent_entrance', x: -11, z: -16, rx: 2.8, rz: 1.9, yaw: 0.2, corners: 7 },
  {
    room: 'ashen_descent_entrance',
    x: 7,
    z: -6,
    rx: 3.1,
    rz: 1.7,
    yaw: -0.45,
    corners: 8,
    essential: true,
  },
  { room: 'chainscar_descent', x: -4, z: 14, rx: 2.2, rz: 1.5, yaw: 0.7, corners: 6 },
  {
    room: 'lower_forge_junction',
    x: 8,
    z: 28,
    rx: 3.5,
    rz: 2.1,
    yaw: 0.15,
    corners: 8,
    essential: true,
  },
  { room: 'lava_maze', x: -47, z: 49, rx: 3.7, rz: 2.3, yaw: 0.35, corners: 7 },
  {
    room: 'lava_maze',
    x: -35,
    z: 48,
    rx: 2.8,
    rz: 1.8,
    yaw: -0.4,
    corners: 6,
    essential: true,
  },
  { room: 'lava_maze', x: -22, z: 51, rx: 3.2, rz: 1.7, yaw: 0.8, corners: 8 },
  { room: 'lava_maze', x: -8, z: 48, rx: 2.5, rz: 1.6, yaw: -0.2, corners: 6 },
  {
    room: 'lava_maze',
    x: -48,
    z: 63,
    rx: 2.7,
    rz: 2.1,
    yaw: 0.6,
    corners: 7,
    essential: true,
  },
  { room: 'lava_maze', x: -34, z: 62, rx: 3.9, rz: 2.2, yaw: -0.1, corners: 9 },
  { room: 'lava_maze', x: -19, z: 66, rx: 2.8, rz: 1.9, yaw: 0.4, corners: 7 },
  { room: 'lava_maze', x: -5, z: 61, rx: 3.2, rz: 1.8, yaw: -0.65, corners: 8 },
  {
    room: 'lava_maze',
    x: -49,
    z: 79,
    rx: 3.4,
    rz: 1.8,
    yaw: -0.3,
    corners: 7,
    essential: true,
  },
  { room: 'lava_maze', x: -37, z: 77, rx: 2.4, rz: 1.6, yaw: 0.9, corners: 6 },
  { room: 'lava_maze', x: -23, z: 82, rx: 3.8, rz: 2.2, yaw: 0.2, corners: 9 },
  {
    room: 'lava_maze',
    x: -8,
    z: 78,
    rx: 3,
    rz: 1.7,
    yaw: -0.55,
    corners: 7,
    essential: true,
  },
  { room: 'lava_maze', x: -43, z: 89, rx: 2.5, rz: 1.4, yaw: 0.35, corners: 6 },
  { room: 'lava_maze', x: -16, z: 89, rx: 2.8, rz: 1.4, yaw: -0.15, corners: 7 },
  {
    room: 'infernal_forge',
    x: -22,
    z: 99,
    rx: 4.1,
    rz: 2.2,
    yaw: 0.35,
    corners: 8,
    essential: true,
  },
  { room: 'infernal_forge', x: -9, z: 101, rx: 2.7, rz: 1.6, yaw: -0.5, corners: 7 },
  { room: 'infernal_forge', x: 10, z: 99, rx: 3.1, rz: 1.8, yaw: 0.25, corners: 8 },
  {
    room: 'infernal_forge',
    x: 23,
    z: 103,
    rx: 3.6,
    rz: 2.1,
    yaw: -0.25,
    corners: 8,
    essential: true,
  },
  { room: 'infernal_forge', x: -18, z: 113, rx: 3.2, rz: 1.7, yaw: 0.75, corners: 7 },
  { room: 'infernal_forge', x: 8, z: 112, rx: 2.5, rz: 1.8, yaw: -0.35, corners: 6 },
  {
    room: 'infernal_forge',
    x: 21,
    z: 117,
    rx: 4.2,
    rz: 2,
    yaw: 0.45,
    corners: 9,
    essential: true,
  },
  { room: 'infernal_forge', x: -24, z: 127, rx: 3.5, rz: 1.8, yaw: -0.2, corners: 8 },
  { room: 'infernal_forge', x: -7, z: 130, rx: 3, rz: 1.7, yaw: 0.4, corners: 7 },
  { room: 'infernal_forge', x: 13, z: 129, rx: 3.7, rz: 1.9, yaw: -0.5, corners: 8 },
  {
    room: 'maw_approach',
    x: 4,
    z: 141,
    rx: 2.8,
    rz: 1.4,
    yaw: 0.4,
    corners: 7,
    essential: true,
  },
  { room: 'heart_cairn_vestibule', x: -7, z: 182, rx: 2.5, rz: 1.5, yaw: 0.2, corners: 6 },
  {
    room: 'heart_cairn_gate',
    x: 6,
    z: 191,
    rx: 3.2,
    rz: 1.7,
    yaw: -0.45,
    corners: 8,
    essential: true,
  },
  { room: 'heart_cairn_lower', x: -16, z: 198, rx: 4.3, rz: 1.8, yaw: 0.15, corners: 9 },
  { room: 'heart_cairn_lower', x: 17, z: 198, rx: 3.8, rz: 1.7, yaw: -0.2, corners: 8 },
  {
    room: 'heart_cairn_boss_arena',
    x: -34,
    z: 205,
    rx: 4.4,
    rz: 2,
    yaw: 0.25,
    corners: 9,
    essential: true,
  },
  { room: 'heart_cairn_boss_arena', x: -19, z: 205, rx: 3, rz: 1.7, yaw: -0.6, corners: 7 },
  { room: 'heart_cairn_boss_arena', x: -6, z: 207, rx: 3.6, rz: 1.8, yaw: 0.35, corners: 8 },
  { room: 'heart_cairn_boss_arena', x: 9, z: 205, rx: 3.1, rz: 1.6, yaw: -0.2, corners: 7 },
  {
    room: 'heart_cairn_boss_arena',
    x: 25,
    z: 207,
    rx: 4.1,
    rz: 2.1,
    yaw: 0.5,
    corners: 9,
    essential: true,
  },
  { room: 'heart_cairn_boss_arena', x: 37, z: 211, rx: 2.7, rz: 1.5, yaw: -0.4, corners: 6 },
  {
    room: 'heart_cairn_boss_arena',
    x: -25,
    z: 216,
    rx: 3.8,
    rz: 1.8,
    yaw: -0.15,
    corners: 8,
    essential: true,
  },
  { room: 'heart_cairn_boss_arena', x: -10, z: 219, rx: 2.8, rz: 1.5, yaw: 0.55, corners: 7 },
  { room: 'heart_cairn_boss_arena', x: 7, z: 218, rx: 3.6, rz: 1.8, yaw: -0.35, corners: 8 },
  {
    room: 'heart_cairn_boss_arena',
    x: 23,
    z: 217,
    rx: 3.2,
    rz: 1.7,
    yaw: 0.25,
    corners: 7,
    essential: true,
  },
  { room: 'heart_cairn_boss_arena', x: 36, z: 220, rx: 3.5, rz: 1.7, yaw: -0.3, corners: 8 },
  { room: 'heart_cairn_crown', x: -26, z: 227, rx: 3.8, rz: 1.8, yaw: 0.4, corners: 8 },
  {
    room: 'heart_cairn_crown',
    x: -12,
    z: 226,
    rx: 3.1,
    rz: 1.6,
    yaw: -0.45,
    corners: 7,
    essential: true,
  },
  { room: 'heart_cairn_crown', x: 13, z: 227, rx: 3.7, rz: 1.8, yaw: 0.25, corners: 8 },
  {
    room: 'heart_cairn_crown',
    x: 27,
    z: 228,
    rx: 3.2,
    rz: 1.6,
    yaw: -0.3,
    corners: 7,
    essential: true,
  },
] as const;

function enabledRooms(layout: DungeonLayout): ReadonlySet<string> {
  return new Set((layout.rooms ?? []).map((room) => room.id));
}

function buildVeinGeometry(specs: readonly VeinSpec[]): {
  geometry: THREE.BufferGeometry;
  segments: number;
  triangles: number;
} {
  const positions: number[] = [];
  const across: number[] = [];
  const flow: number[] = [];
  const heat: number[] = [];
  const phase: number[] = [];
  const indices: number[] = [];
  let segments = 0;
  let totalTriangles = 0;

  for (let pathIndex = 0; pathIndex < specs.length; pathIndex++) {
    const spec = specs[pathIndex];
    const baseVertex = positions.length / 3;
    let distance = 0;
    const pathPhase = hash2(pathIndex, spec.points.length, 0xa8f100);

    for (let pointIndex = 0; pointIndex < spec.points.length; pointIndex++) {
      const point = spec.points[pointIndex];
      const previous = spec.points[Math.max(0, pointIndex - 1)];
      const next = spec.points[Math.min(spec.points.length - 1, pointIndex + 1)];
      const tangentX = next[0] - previous[0];
      const tangentZ = next[1] - previous[1];
      const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
      const normalX = -tangentZ / tangentLength;
      const normalZ = tangentX / tangentLength;
      const wobble = 0.78 + hash2(pathIndex, pointIndex, 0xa8f101) * 0.44;
      const halfWidth = spec.width * wobble;
      const y = 0.066 + hash2(pathIndex, pointIndex, 0xa8f102) * 0.008;
      const pointHeat = Math.min(
        1,
        spec.heat * (0.88 + hash2(pathIndex, pointIndex, 0xa8f103) * 0.18),
      );

      if (pointIndex > 0) {
        const prior = spec.points[pointIndex - 1];
        distance += Math.hypot(point[0] - prior[0], point[1] - prior[1]);
      }
      for (const side of [1, -1]) {
        positions.push(
          point[0] + normalX * halfWidth * side,
          y,
          point[1] + normalZ * halfWidth * side,
        );
        across.push(side);
        flow.push(distance);
        heat.push(pointHeat);
        phase.push(pathPhase);
      }
    }

    for (let pointIndex = 0; pointIndex < spec.points.length - 1; pointIndex++) {
      const left = baseVertex + pointIndex * 2;
      const right = left + 1;
      const nextLeft = left + 2;
      const nextRight = right + 2;
      indices.push(left, nextLeft, right, right, nextLeft, nextRight);
      segments++;
      totalTriangles += 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 1));
  geometry.setAttribute('aHeat', new THREE.Float32BufferAttribute(heat, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, segments, triangles: totalTriangles };
}

function buildPlateGeometry(specs: readonly PlateSpec[]): {
  geometry: THREE.BufferGeometry;
  triangles: number;
} {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const centerColor = new THREE.Color();
  const edgeColor = new THREE.Color();
  const warmBasalt = new THREE.Color(0x5a3025);
  const coldBasalt = new THREE.Color(0x24100e);
  let totalTriangles = 0;

  for (let plateIndex = 0; plateIndex < specs.length; plateIndex++) {
    const spec = specs[plateIndex];
    const baseVertex = positions.length / 3;
    const centerLift = 0.052 + hash2(plateIndex, 0, 0xb45100) * 0.012;
    centerColor.copy(coldBasalt).lerp(warmBasalt, 0.42 + hash2(plateIndex, 1, 0xb45101) * 0.3);
    positions.push(spec.x, centerLift, spec.z);
    colors.push(centerColor.r, centerColor.g, centerColor.b);

    const cosYaw = Math.cos(spec.yaw);
    const sinYaw = Math.sin(spec.yaw);
    for (let corner = 0; corner < spec.corners; corner++) {
      const angle = (corner / spec.corners) * Math.PI * 2;
      const radial = 0.78 + hash2(plateIndex, corner, 0xb45102) * 0.34;
      const localX = Math.cos(angle) * spec.rx * radial;
      const localZ = Math.sin(angle) * spec.rz * radial;
      const x = spec.x + localX * cosYaw - localZ * sinYaw;
      const z = spec.z + localX * sinYaw + localZ * cosYaw;
      const y = 0.045 + hash2(plateIndex, corner, 0xb45103) * 0.016;
      edgeColor
        .copy(coldBasalt)
        .lerp(warmBasalt, 0.16 + hash2(plateIndex, corner, 0xb45104) * 0.24);
      positions.push(x, y, z);
      colors.push(edgeColor.r, edgeColor.g, edgeColor.b);
    }

    for (let corner = 0; corner < spec.corners; corner++) {
      const current = baseVertex + 1 + corner;
      const next = baseVertex + 1 + ((corner + 1) % spec.corners);
      indices.push(baseVertex, next, current);
      totalTriangles++;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, triangles: totalTriangles };
}

function moltenVeinMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: sharedUniforms.uTime,
    },
    vertexShader: /* glsl */ `
      attribute float aAcross;
      attribute float aFlow;
      attribute float aHeat;
      attribute float aPhase;
      varying float vAcross;
      varying float vFlow;
      varying float vHeat;
      varying float vPhase;
      varying vec2 vFloorPosition;
      #include <fog_pars_vertex>
      void main() {
        vAcross = aAcross;
        vFlow = aFlow;
        vHeat = aHeat;
        vPhase = aPhase;
        vFloorPosition = position.xz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vAcross;
      varying float vFlow;
      varying float vHeat;
      varying float vPhase;
      varying vec2 vFloorPosition;
      #include <fog_pars_fragment>
      void main() {
        float edgeDistance = abs(vAcross);
        float moltenCore = 1.0 - smoothstep(0.12, 0.8, edgeDistance);
        float blackLip = smoothstep(0.62, 1.0, edgeDistance);
        float flowBand = sin(vFlow * 1.45 - uTime * 2.15 + vPhase * 17.0);
        float crossBand = sin(
          vFloorPosition.x * 1.7 + vFloorPosition.y * 1.15 + uTime * 0.72
        );
        float pulse = 0.82 + 0.18 * sin(uTime * 1.65 + vPhase * 29.0 + vFlow * 0.38);
        float whiteCore = moltenCore * smoothstep(0.56, 1.0, flowBand * 0.7 + crossBand * 0.3);
        vec3 charred = vec3(0.075, 0.004, 0.002);
        vec3 ember = vec3(0.65, 0.035, 0.004);
        vec3 molten = vec3(2.8, 0.38, 0.012) * pulse * (0.72 + vHeat * 0.38);
        vec3 whiteHot = vec3(3.7, 1.05, 0.12);
        vec3 color = mix(ember, molten, moltenCore);
        color = mix(color, charred, blackLip);
        color = mix(color, whiteHot, whiteCore * 0.32 * vHeat);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    depthWrite: true,
    fog: true,
    side: THREE.FrontSide,
  });
}

function crustMaterial(lowGfx: boolean): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: 0xffffff,
    emissive: 0x160302,
    emissiveIntensity: lowGfx ? 0.18 : 0.32,
    flatShading: true,
    fog: true,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

/**
 * Places authored molten fractures and irregular basalt islands in one group.
 * Repeated details are consolidated into two meshes, so high and low gfx both
 * stay at a fixed maximum of two draw calls.
 */
export function placeInfernalAbyssFloorAccents(
  group: THREE.Group,
  layout: DungeonLayout,
  lowGfx: boolean,
): InfernalAbyssFloorAccentStats {
  const rooms = enabledRooms(layout);
  const veins = VEINS.filter(
    (spec) => rooms.has(spec.room) && (!lowGfx || spec.essential === true),
  );
  const plates = PLATES.filter(
    (spec) => rooms.has(spec.room) && (!lowGfx || spec.essential === true),
  );
  const accents = new THREE.Group();
  accents.name = 'infernal-abyss-floor-accents';
  let drawCalls = 0;
  let veinSegments = 0;
  let triangles = 0;

  if (plates.length > 0) {
    const built = buildPlateGeometry(plates);
    const mesh = new THREE.Mesh(built.geometry, crustMaterial(lowGfx));
    mesh.name = 'infernal-abyss-crust-islands';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    accents.add(mesh);
    triangles += built.triangles;
    drawCalls++;
  }

  if (veins.length > 0) {
    const built = buildVeinGeometry(veins);
    const mesh = new THREE.Mesh(built.geometry, moltenVeinMaterial());
    mesh.name = 'infernal-abyss-molten-floor-veins';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 3;
    accents.add(mesh);
    veinSegments = built.segments;
    triangles += built.triangles;
    drawCalls++;
  }

  if (drawCalls > 0) group.add(accents);
  return {
    drawCalls,
    veinPaths: veins.length,
    veinSegments,
    crustPlates: plates.length,
    triangles,
  };
}

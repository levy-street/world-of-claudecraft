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
import { createGrassTuftMaterial, JUNGLE_GRASS_TINT } from './foliage';
import { GFX } from './gfx';
import { markSharedGeometry, markSharedMaterial } from './shared_resource';
import { ROUGH_GRASS, terrainSplatTexture } from './terrain';
import {
  createWaterSurfaceMaterial,
  hasWaterShaderAssets,
  SHALLOW_COLOR,
  zeroWaveUniforms,
} from './water';
// The water shader recovers shoreline distance as depth / slope, so the basin
// bake samples with the same contract the overworld planes do (against
// wildheartFieldHeight instead of terrainHeight): import those constants rather
// than mirroring them, so a water_core retune cannot silently desync the bake.
import { MIN_SHORE_SLOPE, SHORE_SLOPE_SAMPLE_HALF_WIDTH } from './water_core';

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

// True when the high tier renders the floor with the overworld's real grass
// splat layers instead of the canvas soil. Shared by material + vertex paint:
// the photo albedo multiplies against the paint, so both must agree.
function usesSplatGround(lowGfx: boolean): boolean {
  return !lowGfx && Boolean(terrainSplatTexture('grassC') && terrainSplatTexture('grassN'));
}

function groundMaterial(lowGfx: boolean): THREE.Material {
  const cached = groundMaterials.get(lowGfx);
  if (cached) return cached;
  let material: THREE.Material;
  const grassC = terrainSplatTexture('grassC');
  const grassN = terrainSplatTexture('grassN');
  if (usesSplatGround(lowGfx) && grassC && grassN) {
    // The overworld splat shader samples grass at 0.22 repeats per world yard
    // (terrain.ts `tuv`); the plane's 0..1 UV needs the same density so the
    // basin floor's grain is continuous with the jungle outside. Clones keep
    // the shared textures' own repeat untouched.
    const map = grassC.clone();
    const normalMap = grassN.clone();
    map.repeat.set(GROUND_WIDTH * 0.22, GROUND_DEPTH * 0.22);
    normalMap.repeat.copy(map.repeat);
    material = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      vertexColors: true,
      roughness: ROUGH_GRASS,
      metalness: 0,
    });
  } else {
    const options = {
      map: jungleSoilTexture(),
      vertexColors: true,
      flatShading: true,
    } as const;
    material = lowGfx
      ? new THREE.MeshLambertMaterial(options)
      : new THREE.MeshStandardMaterial({ ...options, roughness: 0.98, metalness: 0 });
  }
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

// Perimeter skirt drop: the outermost vertex ring hangs this far down, so a
// camera ray clearing the rim ribs still lands on painted ground instead of
// the below-horizon slice of the global sky dome (which this open-air
// interior deliberately keeps, renderer.ts wildheartField).
const GROUND_SKIRT_DROP_Y = -40;
const PAINT_WHITE = new THREE.Color(0xffffff);
// How far the vertex paint recenters toward white on the splat tier: the real
// grass albedo carries the hue there, and the full-strength sRGB paint would
// multiply it down to mud (same idea as the overworld splat shader's
// re-centred vColor tint).
const SPLAT_PAINT_RECENTER = 0.58;

function buildGround(lowGfx: boolean): THREE.Mesh {
  if (!groundGeometry) {
    const splat = usesSplatGround(lowGfx);
    groundGeometry = new THREE.PlaneGeometry(GROUND_WIDTH, GROUND_DEPTH, 112, 188).rotateX(
      -Math.PI / 2,
    );
    const positions = groundGeometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const color = new THREE.Color();
    const edgeX = GROUND_WIDTH / 2 - 1e-4;
    const edgeZ = GROUND_DEPTH / 2 - 1e-4;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const localZ = positions.getZ(i);
      const z = localZ + GROUND_CENTER_Z;
      const y = wildheartFieldHeight(x, z);
      const boundary = Math.abs(x) >= edgeX || Math.abs(localZ) >= edgeZ;
      positions.setY(i, boundary ? GROUND_SKIRT_DROP_Y : y);
      if (boundary) {
        color.copy(SOIL).lerp(LIMESTONE, 0.45).multiplyScalar(0.8);
      } else {
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
        if (splat) color.lerp(PAINT_WHITE, SPLAT_PAINT_RECENTER);
      }
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

let waterMaterial: THREE.Material | null = null;
let waterFallbackMaterial: THREE.Material | null = null;

function basinWaterMaterial(): THREE.Material {
  // The basin renders with the overworld's one water surface shader (scrolling
  // normal maps, fresnel sky, sun glints, shore foam, fog) so its pools belong
  // to the same sea palette as the Palmreach outside. Wave uniforms stay
  // zeroed: the interactive height field is owned by the overworld WaterView.
  // Gate exactly like water.ts buildWater. ONLY the shader material is cached
  // permanently: a player who reaches the basin before the water normal maps
  // finish preloading builds this interior on the Lambert fallback, and a
  // one-shot cache pinned that cheap flat sheet for the whole session (the
  // live-playtest "still looks like a path" report), the next interior build
  // must be allowed to upgrade.
  if (waterMaterial) return waterMaterial;
  if (GFX.standardMaterials && hasWaterShaderAssets()) {
    // shoreEdgeFade: the basin's strips and pool sit over their own
    // heightfield with no carved apron, so the waterline must come from the
    // terrain contour, never the mesh rectangle.
    waterMaterial = markSharedMaterial(
      createWaterSurfaceMaterial(zeroWaveUniforms(), { shoreEdgeFade: true }),
    );
    return waterMaterial;
  }
  waterFallbackMaterial ??= markSharedMaterial(
    new THREE.MeshLambertMaterial({
      color: 0x0a5551,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  return waterFallbackMaterial;
}

/**
 * Bakes aShoreDepth/aShoreSlope for a basin water geometry. `offsetX/offsetZ`
 * map geometry-local coordinates into instance-local field coordinates;
 * `surfaceY` is the water surface height in field space (defaults to each
 * vertex's own y, for strips that follow the stream downhill).
 */
function bakeShoreAttributes(
  geometry: THREE.BufferGeometry,
  offsetX: number,
  offsetZ: number,
  surfaceY?: number,
): void {
  const positions = geometry.attributes.position;
  const depth = new Float32Array(positions.count);
  const slope = new Float32Array(positions.count);
  const h = SHORE_SLOPE_SAMPLE_HALF_WIDTH;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + offsetX;
    const z = positions.getZ(i) + offsetZ;
    const level = surfaceY ?? positions.getY(i);
    depth[i] = level - wildheartFieldHeight(x, z);
    const dx = wildheartFieldHeight(x + h, z) - wildheartFieldHeight(x - h, z);
    const dz = wildheartFieldHeight(x, z + h) - wildheartFieldHeight(x, z - h);
    slope[i] = Math.max(Math.hypot(dx, dz) / (2 * h), MIN_SHORE_SLOPE);
  }
  geometry.setAttribute('aShoreDepth', new THREE.BufferAttribute(depth, 1));
  geometry.setAttribute('aShoreSlope', new THREE.BufferAttribute(slope, 1));
}

let streamGeometry: THREE.BufferGeometry | null = null;
let cenoteGeometry: THREE.BufferGeometry | null = null;

// Crosswise vertex columns across the stream strip, so the shader's per-vertex
// foam band, shallow grading, and contour edge-fade vary smoothly over the
// width instead of interpolating straight bank to bank.
const STREAM_COLUMNS = 9;
const CENOTE_SURFACE_Y = -0.46;

function buildWater(): THREE.Group {
  const group = new THREE.Group();
  const material = basinWaterMaterial();
  if (!streamGeometry) {
    const positions: number[] = [];
    const indices: number[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      // From z 34, not 27: the sim's stream carve only ramps in over z 25-42,
      // and a surface floated over UNCARVED flat ground has no waterline for
      // the contour fade to find, it reads as a pale painted sheet with
      // geometry edges (the "footpath" report). Start where the bed exists
      // and let the emergence taper below do the rest.
      const z = 34 + (i / segments) * 143;
      const center = wildheartStreamCenter(z);
      // Wider than the carved bed on purpose: with the shader's contour
      // edge-fade the GEOMETRY is only a canvas, the visible bank is wherever
      // the bed meets the surface, so the strip must overshoot the wet line,
      // never clip it. Tapered at the emergence so the spring starts as a
      // trickle instead of a full-width sheet.
      const emergence = 0.35 + 0.65 * smoothstep(34, 58, z);
      const width = (8 + 2.5 * Math.sin((i / segments) * Math.PI) ** 2) * emergence;
      // +0.35, not +0.55: the closer the surface hugs the bed, the sooner the
      // banks cross the fade threshold and the wet line follows the carve.
      const y = wildheartFieldHeight(center, z) + 0.35;
      for (let column = 0; column < STREAM_COLUMNS; column++) {
        const x = center + ((column / (STREAM_COLUMNS - 1)) * 2 - 1) * width;
        positions.push(x, y, z);
      }
      if (i < segments) {
        const a = i * STREAM_COLUMNS;
        for (let column = 0; column < STREAM_COLUMNS - 1; column++) {
          indices.push(
            a + column,
            a + STREAM_COLUMNS + column,
            a + column + 1,
            a + column + 1,
            a + STREAM_COLUMNS + column,
            a + STREAM_COLUMNS + column + 1,
          );
        }
      }
    }
    streamGeometry = new THREE.BufferGeometry();
    streamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    streamGeometry.setIndex(indices);
    streamGeometry.computeVertexNormals();
    bakeShoreAttributes(streamGeometry, 0, 0);
    // Carve a VISUAL channel into the baked bathymetry: the stream surface
    // floats only 0.55yd over its bed, so every vertex sat inside the shader's
    // 4.5yd foam band and 6yd shallow ramp, the whole strip rendered as pale
    // foam ("a footpath of water", per the live playtest). A parabolic
    // mid-channel boost pushes the center toward the deep color while the true
    // bank depth keeps the foam exactly on the banks. Presentation only: sim
    // water (wildheartWaterMask) and collision are untouched.
    {
      const depthAttr = streamGeometry.getAttribute('aShoreDepth');
      for (let i = 0; i < depthAttr.count; i++) {
        const t = ((i % STREAM_COLUMNS) / (STREAM_COLUMNS - 1)) * 2 - 1;
        // Cubed falloff, not a bare parabola: the strip overshoots the wet
        // line for the contour fade, so the deep channel must die out before
        // the banks or it eats the shoreline foam and shallow grade.
        depthAttr.setX(i, depthAttr.getX(i) + 4.5 * (1 - t * t) ** 3);
      }
      depthAttr.needsUpdate = true;
    }
    markSharedGeometry(streamGeometry);
  }
  const stream = new THREE.Mesh(streamGeometry, material);
  stream.renderOrder = 2;
  group.add(stream);

  if (!cenoteGeometry) {
    // A gridded plane (~2 yd spacing, the zone planes' density) instead of a
    // fan: the foam band and depth grading need per-vertex shore samples. The
    // displaced ground occludes the rectangle outside the pool bowl exactly as
    // overworld terrain occludes its zone planes.
    cenoteGeometry = new THREE.PlaneGeometry(74, 104, 37, 52).rotateX(-Math.PI / 2);
    bakeShoreAttributes(cenoteGeometry, 0, 104, CENOTE_SURFACE_Y);
    markSharedGeometry(cenoteGeometry);
  }
  const cenote = new THREE.Mesh(cenoteGeometry, material);
  cenote.position.set(0, CENOTE_SURFACE_Y, 104);
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
  // The falls carry the shared shallow-water tint so they match the shader
  // surface they feed instead of introducing a third cyan.
  waterfallMaterial ??= new THREE.MeshBasicMaterial({
    color: SHALLOW_COLOR,
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

let basinGrassGeometry: THREE.BufferGeometry | null = null;
let basinGrassMaterial: THREE.Material | null = null;

// Deterministic hash-grid scatter of the overworld grass-tuft look, baked once
// as ONE static InstancedMesh (~6k instances, one draw call). High tier only.
const BASIN_GRASS_STEP = 2.4;
const BASIN_GRASS_DENSITY = 0.8;
// Mirror foliage.ts GRASS_MAX_SLOPE / GRASS_SLOPE_EPS: no blades on cliffs.
const BASIN_GRASS_MAX_SLOPE = 0.62;
const BASIN_GRASS_SLOPE_EPS = 1.2;

function buildBasinGrass(): THREE.InstancedMesh {
  if (!basinGrassGeometry) {
    // The lush crossed-quad tuft card, foliage.ts buildGrassRing's geometry.
    const quad = new THREE.PlaneGeometry(1.45, 0.9);
    quad.translate(0, 0.42, 0);
    const quad2 = quad.clone().rotateY(Math.PI / 2);
    const merged = mergeGeometries([quad, quad2]);
    if (!merged) throw new Error('Wildheart grass geometry merge failed');
    basinGrassGeometry = markSharedGeometry(merged);
  }
  basinGrassMaterial ??= markSharedMaterial(createGrassTuftMaterial());

  const spots: { x: number; z: number; y: number; i: number; j: number }[] = [];
  const columns = Math.floor(GROUND_WIDTH / BASIN_GRASS_STEP);
  const rows = Math.floor(GROUND_DEPTH / BASIN_GRASS_STEP);
  const minZ = GROUND_CENTER_Z - GROUND_DEPTH / 2;
  const eps = BASIN_GRASS_SLOPE_EPS;
  for (let i = 0; i <= columns; i++) {
    for (let j = 0; j <= rows; j++) {
      if (hash(i, j) > BASIN_GRASS_DENSITY) continue;
      const x =
        -GROUND_WIDTH / 2 +
        i * BASIN_GRASS_STEP +
        (hash(i, j + 101) - 0.5) * BASIN_GRASS_STEP * 1.4;
      const z = minZ + j * BASIN_GRASS_STEP + (hash(i + 57, j) - 0.5) * BASIN_GRASS_STEP * 1.4;
      // Stay clear of the dropped skirt ring at the mesh boundary.
      if (Math.abs(x) > GROUND_WIDTH / 2 - 3 || z < minZ + 3 || z > minZ + GROUND_DEPTH - 3) {
        continue;
      }
      if (wildheartWaterMask(x, z) > 0.2) continue;
      if (routeDistance(x, z) < 3.2) continue;
      const slopeX = wildheartFieldHeight(x + eps, z) - wildheartFieldHeight(x - eps, z);
      const slopeZ = wildheartFieldHeight(x, z + eps) - wildheartFieldHeight(x, z - eps);
      if (Math.hypot(slopeX, slopeZ) / (2 * eps) > BASIN_GRASS_MAX_SLOPE) continue;
      spots.push({ x, z, y: wildheartFieldHeight(x, z), i, j });
    }
  }

  const mesh = new THREE.InstancedMesh(basinGrassGeometry, basinGrassMaterial, spots.length);
  mesh.userData.renderCategory = 'grass';
  mesh.receiveShadow = true; // tufts darken inside canopy shade, like the ring
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  for (let n = 0; n < spots.length; n++) {
    const spot = spots[n];
    const size = 0.55 + hash(spot.i + 13, spot.j) * 1.1;
    quaternion.setFromAxisAngle(up, hash(spot.i, spot.j + 7) * 12.4);
    matrix.compose(position.set(spot.x, spot.y, spot.z), quaternion, scale.set(size, size, size));
    mesh.setMatrixAt(n, matrix);
    color.setHex(JUNGLE_GRASS_TINT);
    color.offsetHSL(
      (hash(spot.i + 211, spot.j) - 0.5) * 0.05,
      (hash(spot.i, spot.j + 307) - 0.5) * 0.12,
      (hash(spot.i + 409, spot.j) - 0.5) * 0.1,
    );
    mesh.setColorAt(n, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function colorGeometry(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const count = geometry.attributes.position.count;
  const base = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const shade = 0.82 + hash(i, color) * 0.22;
    colors[i * 3] = base.r * shade;
    colors[i * 3 + 1] = base.g * shade;
    colors[i * 3 + 2] = base.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

let rimMaterial: THREE.Material | null = null;

export function resetWildheartTerrainProfileCaches(): void {
  groundMaterials.clear();
  pathMaterial = null;
  waterMaterial = null;
  waterFallbackMaterial = null;
  arenaMaterial = null;
  foliageTrunkMaterial = null;
  foliageDarkMaterial = null;
  foliageMidMaterial = null;
  foliageLightMaterial = null;
  waterfallMaterial = null;
  waterfallFoamMaterial = null;
  fireflyMaterials.clear();
  basinGrassMaterial = null;
  rimMaterial = null;
}

// Opaque flat-shaded vertex-color material for the edge-closing geometry (the
// module's vertexMaterial() is the translucent path overlay, not reusable).
function rimVertexMaterial(): THREE.Material {
  if (rimMaterial) return rimMaterial;
  rimMaterial = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0.02,
        flatShading: true,
      })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  markSharedMaterial(rimMaterial);
  return rimMaterial;
}

const LIMESTONE_RIB_LIGHT = 0xc7b982;
const LIMESTONE_RIB_DARK = 0xb9aa76;

let ribsGeometry: THREE.BufferGeometry | null = null;

// Continuous jagged limestone screens along every mesh edge (Orkadia's
// buildBasaltRibs pattern): the straight terrain cut must never be an open
// sightline. Merged flat-shaded opaque low-poly stacks, SwiftShader-safe -
// and NOT part of WILDHEART_FIELD_PLACEMENTS, so sim placement/collider
// tables are untouched.
function buildCalderaRimRibs(): THREE.Mesh {
  if (!ribsGeometry) {
    const stacks: THREE.BufferGeometry[] = [];
    const stack = (
      x: number,
      z: number,
      h: number,
      r: number,
      spin: number,
      tone: number,
    ): void => {
      const rib = new THREE.CylinderGeometry(r * 0.28, r, h, 5);
      rib.rotateY(hash(spin, 11) * Math.PI);
      rib.rotateZ((hash(spin, 13) - 0.5) * 0.14);
      rib.translate(x, wildheartFieldHeight(x, z) + h * 0.45, z);
      stacks.push(colorGeometry(rib, tone));
    };
    // Side screens: |x| 86-90, OUTSIDE the ±82 collision walls and INSIDE the
    // ±92 mesh edge, so the stacks are pure scenery and need no colliders.
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 20; i++) {
        const z = -28 + i * 14;
        const x = side * (86 + hash(i, side) * 4);
        const h = 12 + hash(i, side * 7) * 16;
        const r = 3 + hash(i, side * 9) * 3.5;
        stack(x, z, h, r, i * 17 + side, i % 4 === 0 ? LIMESTONE_RIB_LIGHT : LIMESTONE_RIB_DARK);
      }
      // Staggered infill offset half a step: an elevated camera (eye ~23yd at
      // full zoom-out + pitch) sees -8..-10deg below-horizon slivers BETWEEN
      // the primary stacks; a second offset row closes the gaps without
      // thickening the silhouette at ground level.
      for (let i = 0; i < 20; i++) {
        const z = -21 + i * 14;
        const x = side * (87.5 + hash(i, side * 21) * 3.5);
        const h = 10 + hash(i, side * 23) * 14;
        const r = 2.6 + hash(i, side * 27) * 3;
        stack(
          x,
          z,
          h,
          r,
          i * 19 + side + 700,
          i % 3 === 0 ? LIMESTONE_RIB_LIGHT : LIMESTONE_RIB_DARK,
        );
      }
    }
    for (let i = 0; i < 13; i++) {
      // North end row in the wall-to-cut margin (wall z=242, mesh edge z=249).
      // The shoulder heightfield stands tall mid-row, but it keys on |x| only
      // and the temple flat holds the terrace at 10.5, so an elevated camera
      // (zoom 22, pitch 1.35 puts the eye ~23yd up) sees over short corner
      // stacks: ramp the heights up toward the corners, where the raycast
      // probe measured 20-33 deg below-horizon escape bands.
      const nx = -84 + i * 14 + (hash(i, 51) - 0.5) * 4;
      const nh = 9 + hash(i, 53) * 9 + Math.max(0, (Math.abs(nx) - 52) / 32) * 15;
      const nr = 2.6 + hash(i, 55) * 1.6;
      stack(
        nx,
        245.5 + (hash(i, 57) - 0.5) * 2,
        nh,
        nr,
        i + 400,
        i % 3 === 0 ? LIMESTONE_RIB_LIGHT : LIMESTONE_RIB_DARK,
      );
      // South end row (wall z=-24, mesh edge z=-31): the arrival multiplier
      // flattens the heightfield to 0 at the entry, so these taller stacks
      // alone must form the crest behind it.
      const sx = -84 + i * 14 + (hash(i, 61) - 0.5) * 4;
      const sh = 16 + hash(i, 63) * 10;
      const sr = 2.8 + hash(i, 65) * 1.6;
      stack(
        sx,
        -28 + (hash(i, 67) - 0.5) * 1.6,
        sh,
        sr,
        i + 500,
        i % 3 === 0 ? LIMESTONE_RIB_LIGHT : LIMESTONE_RIB_DARK,
      );
    }
    // The four mesh corners (±92, 249) and (±92, -31) sit past both the side
    // screens (end z 238) and the end rows (span |x| 84): without their own
    // tall clusters they are exactly the NE/NW/SE/SW diagonal windows the
    // elevated-camera probe found open.
    for (let side = -1; side <= 1; side += 2) {
      stack(side * 88, 242, 24 + hash(side, 71) * 6, 4.4, side * 3 + 600, LIMESTONE_RIB_LIGHT);
      stack(side * 90, 247.5, 20 + hash(side, 73) * 6, 3.6, side * 5 + 610, LIMESTONE_RIB_DARK);
      stack(side * 88, -26, 22 + hash(side, 75) * 6, 4.2, side * 7 + 620, LIMESTONE_RIB_DARK);
      stack(side * 90, -30, 19 + hash(side, 77) * 5, 3.4, side * 9 + 630, LIMESTONE_RIB_LIGHT);
    }
    const merged = mergeGeometries(stacks, false);
    if (!merged) throw new Error('Wildheart rim rib geometry merge failed');
    ribsGeometry = markSharedGeometry(merged);
  }
  const ribs = new THREE.Mesh(ribsGeometry, rimVertexMaterial());
  ribs.castShadow = true;
  ribs.receiveShadow = true;
  return ribs;
}

const CANOPY_RIDGE_LIGHT = 0x2c4f33;
const CANOPY_RIDGE_DARK = 0x24422c;

let ridgeGeometry: THREE.BufferGeometry | null = null;

// Distant jungle-canopy silhouettes past both z edges (Orkadia's
// buildDistantMountain pattern, in jungle greens).
function buildDistantCanopyRidge(): THREE.Mesh {
  if (!ridgeGeometry) {
    const peaks: THREE.BufferGeometry[] = [];
    // North: 23-35 yd past the z=249 mesh edge, closing the horizon behind the
    // ritual pyramid. Seated lower than the Orkadia template (base ~y 4, not
    // ~14): the temple-axis crest here is only ~10.5, so a higher base opens a
    // sky sliver beneath the canopy line.
    // 15 peaks spanning x -84..84, not the template's 9 across -46..46: the
    // mesh corners are at |x|=92, and a ridge that stops at |x|~64 (cone base
    // included) leaves the NE/NW diagonals from the boss terrace as open
    // below-horizon windows at elevated camera pitch.
    for (let i = 0; i < 15; i++) {
      const x = -84 + i * 12;
      const h = 34 + hash(i, 81) * 36;
      const r = 10 + hash(i, 82) * 8;
      const peak = new THREE.ConeGeometry(r, h, 5);
      peak.rotateY(hash(i, 83) * Math.PI);
      peak.translate(x, 6 + h * 0.45, 272 + hash(i, 84) * 12);
      peaks.push(colorGeometry(peak, i % 2 ? CANOPY_RIDGE_DARK : CANOPY_RIDGE_LIGHT));
    }
    // South: a sparser mirrored row behind the entry edge. Unlike Orkadia's
    // war-gate wall, the jaguar gate is an open arch, so the horizon behind
    // the arrival flat needs its own canopy line; bases sink below the flat's
    // y=0 so the perimeter skirt hides them.
    for (let i = 0; i < 9; i++) {
      const x = -84 + i * 21 + (hash(i, 91) - 0.5) * 6;
      const h = 30 + hash(i, 92) * 30;
      const r = 12 + hash(i, 93) * 8;
      const peak = new THREE.ConeGeometry(r, h, 5);
      peak.rotateY(hash(i, 94) * Math.PI);
      peak.translate(x, h * 0.45 - 2, -55 - hash(i, 95) * 10);
      peaks.push(colorGeometry(peak, i % 2 ? CANOPY_RIDGE_DARK : CANOPY_RIDGE_LIGHT));
    }
    const merged = mergeGeometries(peaks, false);
    if (!merged) throw new Error('Wildheart canopy ridge geometry merge failed');
    ridgeGeometry = markSharedGeometry(merged);
  }
  const ridge = new THREE.Mesh(ridgeGeometry, rimVertexMaterial());
  ridge.castShadow = true;
  ridge.receiveShadow = true;
  return ridge;
}

export function buildWildheartTerrain(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wildheartTerrain';
  group.add(buildGround(lowGfx));
  group.add(buildPath(-1), buildPath(1));
  group.add(buildWater());
  group.add(buildTempleArena());
  group.add(buildFoliage());
  if (!lowGfx) group.add(buildBasinGrass());
  group.add(buildWaterfalls(lowGfx));
  group.add(buildFireflies(lowGfx));
  group.add(buildCalderaRimRibs());
  group.add(buildDistantCanopyRidge());
  return group;
}

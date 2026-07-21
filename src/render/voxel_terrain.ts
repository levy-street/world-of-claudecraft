import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z, ZONES } from '../sim/data';
import { voxelDensity } from '../sim/voxel';
import { meshVoxelChunk } from '../sim/voxel_mesh';
import { roadDistance, terrainHeight, waterLevelAt } from '../sim/world';
import { loadTexture } from './assets/loader';
import { registerPreload } from './assets/preload';

// Real PBR albedo (ambientCG 1K, shipped under public/textures/terrain, this
// repo's existing asset set: no new files). Unconditional load (not gated on
// GFX.terrainSplat like terrain.ts's splat tier): this module only builds on
// a real, hardware-accelerated WebGL2 context (the production swap target and
// the screenshot tour both run with a real GPU, never software/swiftshader),
// which comfortably has far more than the handful of texture units this uses.
const VOXEL_TEX: Record<string, THREE.Texture> = {};
function kickVoxelTex(key: string, file: string): void {
  registerPreload(
    loadTexture(`/textures/terrain/${file}`, { srgb: true, repeat: true }).then((tex) => {
      VOXEL_TEX[key] = tex;
      return tex;
    }),
  );
}
kickVoxelTex('grassC', 'Grass001_Color.jpg');
kickVoxelTex('rockC', 'Rock051_Color.jpg');
kickVoxelTex('rockStreakC', 'Rock029_Color.jpg');
kickVoxelTex('roadC', 'PavingStones046_Color.jpg'); // packed walkway/road stone
kickVoxelTex('dirtC', 'Ground048_Color.jpg');
kickVoxelTex('mudC', 'Ground071_Color.jpg');
kickVoxelTex('sandC', 'Ground080_Color.jpg');
kickVoxelTex('snowC', 'Snow010A_Color.jpg');

// Full-world terrain built entirely from the voxel density field/mesher
// (sim/voxel.ts, sim/voxel_mesh.ts), replacing the production chunked
// heightfield mesh (terrain.ts) so the voxel engine's output can be checked
// against the real world in-game, not just via unit tests.
//
// Three things keep this both gap-free and tractable at whole-map scale:
//  - Per-column height culling: most of a naive world-spanning y-chunk grid
//    is either deep underground (uniformly solid) or high in the sky
//    (uniformly air) and would waste a full corner-density sample grid for
//    nothing. Before meshing a chunk we sample terrainHeight over its (x,z)
//    footprint on a 3x3 grid (cheap) and skip any y-chunk whose range falls
//    well outside that local height band, with a generous margin so a
//    steep local rise inside one footprint can't silently drop a needed
//    y-chunk.
//  - A fine, UNIFORM per-chunk voxel resolution. An earlier pass varied this
//    per column by local steepness; that is exactly what produced the first
//    reviewer-visible seam/crack lines: two neighboring chunk columns at
//    different resolutions use different step sizes, so their shared
//    boundary face's edge-crossing points land at different world positions
//    and Surface Nets can't stitch them, showing sky through the gap. Every
//    chunk now shares one step size.
//  - Overlapping chunk bounds (the actual seam-elimination fix). Even with a
//    uniform step, meshing each chunk to EXACTLY its own [x0, x0+size) box
//    is fragile in practice: any sub-voxel floating-point rounding, or a
//    genuinely thin isosurface feature (a terrace riser thinner than one
//    voxel cell) can still leave a hairline crack between two independently
//    triangulated BufferGeometry objects, even though the math says their
//    shared vertices should coincide exactly. The standard fix for chunked
//    isosurface meshers (Transvoxel/Voxel Farm-style stitching, or a
//    heightfield mesh's apron "skirt") is to give neighboring chunks
//    OVERLAPPING geometry instead of exactly-abutting geometry: pad every
//    chunk's meshed volume by one voxel cell on every side (same density
//    function, so the extra band is exactly what the neighbor would also
//    mesh there). Two overlapping surfaces can never leave a gap between
//    them, whatever the fine geometric truth of that boundary is.
//  - A generous world-edge margin so the mesh doesn't stop short of the
//    map boundary and show a gap to the skybox.
const CHUNK_SIZE = 16; // world units per chunk cube
const CHUNK_RESOLUTION = 16; // voxels per axis per chunk, uniform across every chunk (1 world unit/voxel)
const OVERLAP_VOXELS = 1; // extra voxel cells of overlap padded onto every chunk side
// One draw call per 16u voxel chunk (thousands of them across the whole map)
// swamps GPU command-submission overhead badly enough to tank frame time and,
// under sustained load, trip a driver TDR (the browser's GPU process crashes,
// which reads to Puppeteer as a detached frame). Group chunks into much
// coarser SUPER_CHUNK columns (this many base chunks per axis) and merge
// every chunk's geometry inside one column into a single BufferGeometry via
// mergeGeometries: one draw call per column instead of one per chunk, while
// still culling at a coarse-but-real granularity (matches terrain.ts's own
// ~60u production chunk size).
const SUPER_CHUNK = 4;
const HEIGHT_MARGIN = 48; // yd of slack around the sampled local height band
const WORLD_MARGIN = 80; // yd padding so the mesh doesn't stop short of the map edge
// Road/walkway blend width, matching terrain.ts's dirt-road feather so the
// voxel renderer's paths read the same as the production heightfield's.
const ROAD_CORE = 2.0;
const ROAD_FEATHER = 3.4;
// Snow line: matches terrain.ts's plain height threshold/feather (its fbm
// jitter on top is a cosmetic touch this verification pass skips).
const SNOW_HEIGHT = 34;
const SNOW_FEATHER = 14;

// Marsh wetness at a given world z: 1 inside a marsh zone, 0 elsewhere, smoothly
// feathered across each zone boundary. Mirrors terrain.ts's marshWeightAt
// (not exported there), since both need the same zone-blend shape.
function marshWeightAt(z: number): number {
  let w = ZONES[0].biome === 'marsh' ? 1 : 0;
  for (let i = 0; i + 1 < ZONES.length; i++) {
    const b = ZONES[i].zMax;
    const t = Math.max(0, Math.min(1, (z - (b - 30)) / 65));
    const tt = t * t * (3 - 2 * t);
    if (tt <= 0) break;
    w += ((ZONES[i + 1].biome === 'marsh' ? 1 : 0) - w) * tt;
  }
  return w;
}

export interface VoxelTerrainView {
  group: THREE.Group;
  chunkCount: number;
  triangleCount: number;
}

// Cheap local height band for one (x,z) chunk footprint: a 3x3 grid of
// terrainHeight samples (9 calls), not a full density grid. More samples
// than a single corners+center pass so a steep local rise inside the
// footprint (a terraced ridge wall) can't slip between sample points and
// silently exclude the y-chunk that actually needs meshing.
function localHeightBand(seed: number, cx: number, cz: number): { min: number; max: number } {
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i <= 2; i++) {
    for (let j = 0; j <= 2; j++) {
      const h = terrainHeight(x0 + (i / 2) * CHUNK_SIZE, z0 + (j / 2) * CHUNK_SIZE, seed);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { min, max };
}

export function buildVoxelTerrain(seed: number): VoxelTerrainView {
  const group = new THREE.Group();
  group.name = 'voxel-terrain-verification';
  const density = (x: number, y: number, z: number) => voxelDensity(x, y, z, seed);

  // Real PBR albedo (VOXEL_TEX, kicked at module load above), triplanar
  // projected so they never stretch on a steep face and never seam at a
  // chunk boundary (the projection is pure world space, not per-chunk UVs).
  const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassMap = { value: VOXEL_TEX.grassC };
    shader.uniforms.rockMap = { value: VOXEL_TEX.rockC };
    shader.uniforms.rockStreakMap = { value: VOXEL_TEX.rockStreakC };
    shader.uniforms.roadMap = { value: VOXEL_TEX.roadC };
    shader.uniforms.dirtMap = { value: VOXEL_TEX.dirtC };
    shader.uniforms.mudMap = { value: VOXEL_TEX.mudC };
    shader.uniforms.sandMap = { value: VOXEL_TEX.sandC };
    shader.uniforms.snowMap = { value: VOXEL_TEX.snowC };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      attribute float aRoad;
      attribute float aMud;
      attribute float aSnow;
      attribute float aSand;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vRoad;
      varying float vMud;
      varying float vSnow;
      varying float vSand;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vRoad = aRoad;
      vMud = aMud;
      vSnow = aSnow;
      vSand = aSand;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform sampler2D grassMap;
      uniform sampler2D rockMap;
      uniform sampler2D rockStreakMap;
      uniform sampler2D roadMap;
      uniform sampler2D dirtMap;
      uniform sampler2D mudMap;
      uniform sampler2D sandMap;
      uniform sampler2D snowMap;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vRoad;
      varying float vMud;
      varying float vSnow;
      varying float vSand;
      vec3 triplanar(sampler2D tex, vec3 pos, vec3 blend, float scale) {
        vec3 xCol = texture2D(tex, pos.yz * scale).rgb;
        vec3 yCol = texture2D(tex, pos.xz * scale).rgb;
        vec3 zCol = texture2D(tex, pos.xy * scale).rgb;
        return xCol * blend.x + yCol * blend.y + zCol * blend.z;
      }
      // cheap deterministic hash noise (world space), only used to break up
      // the rock albedo into streaks so a single repeated tile doesn't read
      // as flat and obviously tiled on a whole mountain face.
      float streakNoise(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `{
        vec3 n = normalize(vWorldNormal);
        vec3 blend = abs(n);
        blend /= (blend.x + blend.y + blend.z);
        float slopeT = clamp(1.0 - (n.y - 0.5) / 0.5, 0.0, 1.0);
        vec3 grassAlb = triplanar(grassMap, vWorldPos, blend, 0.05);
        float streak = streakNoise(floor(vWorldPos.xz * 0.35));
        vec3 rockAlb = mix(
          triplanar(rockMap, vWorldPos, blend, 0.045),
          triplanar(rockStreakMap, vWorldPos, blend, 0.05),
          step(0.5, streak));
        vec3 dirtAlb = mix(triplanar(dirtMap, vWorldPos, blend, 0.06),
                            triplanar(mudMap, vWorldPos, blend, 0.06), vMud);
        vec3 roadAlb = triplanar(roadMap, vWorldPos, blend, 0.05);
        vec3 sandAlb = triplanar(sandMap, vWorldPos, blend, 0.06);
        vec3 snowAlb = triplanar(snowMap, vWorldPos, blend, 0.06);
        vec3 ground = mix(grassAlb, rockAlb, slopeT);
        ground = mix(ground, sandAlb, vSand);
        ground = mix(ground, mix(dirtAlb, roadAlb, 0.6), vRoad);
        ground = mix(ground, snowAlb, vSnow);
        diffuseColor.rgb *= ground;
      }`,
    );
  };

  const cx0 = Math.floor((WORLD_MIN_X - WORLD_MARGIN) / CHUNK_SIZE);
  const cx1 = Math.ceil((WORLD_MAX_X + WORLD_MARGIN) / CHUNK_SIZE);
  const cz0 = Math.floor((WORLD_MIN_Z - WORLD_MARGIN) / CHUNK_SIZE);
  const cz1 = Math.ceil((WORLD_MAX_Z + WORLD_MARGIN) / CHUNK_SIZE);

  let chunkCount = 0;
  let triangleCount = 0;
  const step = CHUNK_SIZE / CHUNK_RESOLUTION;
  const pad = step * OVERLAP_VOXELS;
  const superGeos = new Map<string, THREE.BufferGeometry[]>();

  for (let cx = cx0; cx < cx1; cx++) {
    for (let cz = cz0; cz < cz1; cz++) {
      const band = localHeightBand(seed, cx, cz);
      const cy0 = Math.floor((band.min - HEIGHT_MARGIN) / CHUNK_SIZE);
      const cy1 = Math.ceil((band.max + HEIGHT_MARGIN) / CHUNK_SIZE);

      // roadDistance() scans every road polyline segment; that is cheap once
      // per chunk but was ruinous called per VERTEX across a whole-world
      // build (millions of calls, most of them chunks nowhere near a road).
      // Cull with one chunk-centre sample first: only pay the per-vertex
      // cost for chunks the road feather could possibly reach (generous
      // half-diagonal margin so no near-road chunk is skipped).
      const chunkCx = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
      const chunkCz = cz * CHUNK_SIZE + CHUNK_SIZE / 2;
      const roadNear = roadDistance(chunkCx, chunkCz) < ROAD_FEATHER + CHUNK_SIZE;

      for (let cy = cy0; cy < cy1; cy++) {
        // Overlap padding: mesh a volume one voxel cell LARGER than the
        // chunk's own box on every side (same density fn, same step), so
        // neighboring chunks' surfaces overlap instead of exactly abutting.
        // See the module comment: this is what actually closes any
        // remaining hairline seam, not just the resolution-mismatch fix.
        const mesh = meshVoxelChunk(density, {
          x0: cx * CHUNK_SIZE - pad,
          y0: cy * CHUNK_SIZE - pad,
          z0: cz * CHUNK_SIZE - pad,
          size: CHUNK_SIZE + 2 * pad,
          resolution: CHUNK_RESOLUTION + 2 * OVERLAP_VOXELS,
        });
        if (mesh.positions.length === 0) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
        geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

        const vertCount = mesh.positions.length / 3;
        const road = new Float32Array(vertCount);
        const mud = new Float32Array(vertCount);
        const snow = new Float32Array(vertCount);
        const sand = new Float32Array(vertCount);
        for (let vi = 0; vi < vertCount; vi++) {
          const vx = mesh.positions[vi * 3];
          const vy = mesh.positions[vi * 3 + 1];
          const vz = mesh.positions[vi * 3 + 2];
          if (roadNear) {
            const rd = roadDistance(vx, vz);
            road[vi] =
              rd < ROAD_CORE
                ? 1
                : rd < ROAD_FEATHER
                  ? 1 - (rd - ROAD_CORE) / (ROAD_FEATHER - ROAD_CORE)
                  : 0;
          }
          mud[vi] = marshWeightAt(vz);
          snow[vi] = Math.max(0, Math.min(1, (vy - SNOW_HEIGHT) / SNOW_FEATHER));
          const wl = waterLevelAt(vx, vz);
          sand[vi] = wl === -Infinity ? 0 : Math.max(0, Math.min(1, 1 - (vy - wl) / 2));
        }
        geo.setAttribute('aRoad', new THREE.BufferAttribute(road, 1));
        geo.setAttribute('aMud', new THREE.BufferAttribute(mud, 1));
        geo.setAttribute('aSnow', new THREE.BufferAttribute(snow, 1));
        geo.setAttribute('aSand', new THREE.BufferAttribute(sand, 1));

        const superKey = `${Math.floor(cx / SUPER_CHUNK)}-${Math.floor(cz / SUPER_CHUNK)}`;
        let bucket = superGeos.get(superKey);
        if (!bucket) {
          bucket = [];
          superGeos.set(superKey, bucket);
        }
        bucket.push(geo);
        chunkCount++;
        triangleCount += mesh.indices.length / 3;
      }
    }
  }

  // One merged mesh per super-chunk column: collapses thousands of
  // per-16u-chunk draw calls down to one per SUPER_CHUNK-sized column, while
  // each merged mesh still gets its own bounding box for frustum culling
  // (computeBoundingSphere/Box run by Three on first use).
  let superChunkCount = 0;
  for (const [key, geos] of superGeos) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    const superMesh = new THREE.Mesh(merged, material);
    superMesh.name = `voxel-terrain-super-${key}`;
    superMesh.matrixAutoUpdate = false;
    superMesh.updateMatrix();
    group.add(superMesh);
    superChunkCount++;
  }

  console.log(
    `[voxel_terrain] build: ${chunkCount} chunks (${superChunkCount} draw calls), ${triangleCount} triangles`,
  );
  return { group, chunkCount, triangleCount };
}

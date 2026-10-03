// The Wildheart Basin's signature: its waterfalls. Every fall of the plan
// (basin_plan_core.ts planBasinFalls: the rim falls, the Weeping Falls into
// its plunge pool, the veil the Waterfall Walk passes behind and the ford's
// wide low spill into the gorge) is a white-cyan curtain of layered streaks
// and wavering ropes, breaking white at the lip and at the foot; a churning
// foam ring where it lands; SPRAY flung up and drifting off on the air; slow
// MIST banks rolling round the feet; and RAINBOWS standing in the spray,
// placed against the afternoon sun so they read from the Idol Maw and the
// Waterfall Walk.
//
// Draws: every curtain merged into one mesh, the foam rings into one, the
// spray of every fall one instanced draw, the mist one instanced draw, the
// rainbows one merged mesh. Motion is shader-side on the shared clock; spray
// and mist counts shed with the effects tier (cosmetic only).

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import {
  BASIN_SUN_DIRECTION,
  type BasinFall,
  basinHash,
  fallPoint,
  fallWidth,
  planBasinFalls,
  planBasinRainbows,
  WALK_SHELF,
} from './basin_plan_core';
import { BASIN_NOISE_GLSL } from './basin_sky';

export interface BasinFallsOptions {
  lowGfx: boolean;
  /** 0..1 cosmetic density (tier shed). */
  density: number;
}

function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

// ---- curtains ----------------------------------------------------------------------

const CURTAIN_VERT = /* glsl */ `
attribute vec4 aFall; // u across, t down, seed, length (yards)
varying vec4 vFall;
varying vec3 vWorld;
varying vec3 vNormalW;
#include <fog_pars_vertex>
void main() {
  vFall = aFall;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const CURTAIN_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
varying vec4 vFall;
varying vec3 vWorld;
varying vec3 vNormalW;
#include <fog_pars_fragment>
${BASIN_NOISE_GLSL}
void main() {
  float u = vFall.x;
  float t = vFall.y;
  float seed = vFall.z;
  float len = vFall.w;
  // Ropes of water side by side, each wavering and fraying as it falls.
  float wav = bnoise(vec2(u * 3.0 + seed, t * 1.6 - uTime * 0.35)) * 0.16;
  float ropes = smoothstep(0.22, 0.62, bnoise(vec2((u + wav) * 8.0 + seed * 3.1, t * 0.4)));
  // Three layers of streaks at three speeds (the near sheet races, the
  // back sheet lags): the falling water's parallax.
  float speed = 0.8 + t * 1.8;
  float y = t * len * 0.3;
  float s1 = bnoise(vec2((u + wav) * 34.0 + seed * 9.0, (y - uTime * speed * 7.0) * 0.09));
  float s2 = bnoise(vec2((u + wav) * 61.0 - seed * 5.0, (y - uTime * speed * 9.5) * 0.16));
  float s3 = bnoise(vec2((u + wav * 1.6) * 17.0 + seed, (y - uTime * speed * 4.6) * 0.05));
  float streak = s1 * 0.45 + s2 * 0.3 + s3 * 0.35;
  float sheet = smoothstep(0.22, 0.78, streak);
  // Ragged sides: narrow at the lip, spreading as it falls.
  float halfW = 0.4 + 0.08 * t + (bnoise(vec2(t * 5.0 + seed, uTime * 0.6)) - 0.5) * 0.1;
  float edge = 1.0 - smoothstep(halfW - 0.1, halfW, abs(u - 0.5));
  // White where it breaks: at the lip, the brightest streaks, the foot.
  float white = smoothstep(0.62, 0.95, streak) + smoothstep(0.08, 0.0, t) * 0.7 + smoothstep(0.78, 1.0, t) * 0.8;
  vec3 deep = vec3(0.46, 0.7, 0.72);
  vec3 foam = vec3(0.92, 0.99, 0.98);
  vec3 col = mix(deep, foam, clamp(white, 0.0, 1.0));
  // The afternoon sun glinting on the sheet's face, and the light through it.
  vec3 view = normalize(cameraPosition - vWorld);
  float facing = abs(dot(view, vNormalW));
  float through = pow(max(0.0, dot(-view, uSunDir)), 4.0);
  col += vec3(1.0, 0.86, 0.6) * (pow(max(0.0, dot(reflect(-uSunDir, vNormalW), view)), 16.0) * 0.35 + through * 0.4);
  float body = mix(0.4, 1.0, ropes) * (0.5 + 0.5 * sheet);
  float mist = smoothstep(0.7, 1.0, t) * 0.45;
  float weight = fract(seed / 3.0) * 3.0 / 0.9;
  float a = edge * (body * mix(0.7, 1.0, facing) + mist) * weight;
  // A thin sheet tears into ropes with clear gaps between.
  a *= mix(1.0, smoothstep(0.35, 0.7, ropes + sheet * 0.4), 1.0 - weight);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildCurtains(falls: readonly BasinFall[], lowGfx: boolean): THREE.Mesh {
  const positions: number[] = [];
  const attrs: number[] = [];
  const indices: number[] = [];
  falls.forEach((f, k) => {
    const width = fallWidth(f);
    const across = Math.max(4, Math.round((lowGfx ? 0.4 : 0.9) * width));
    const down = Math.max(6, Math.round(((lowGfx ? 0.25 : 0.5) * (f.top - f.bottom)) / 1.5));
    const base = positions.length / 3;
    for (let j = 0; j <= down; j++) {
      const t = j / down;
      for (let i = 0; i <= across; i++) {
        const u = i / across;
        const [x, y, z] = fallPoint(f, u, t);
        // A gentle bow and sway so the sheet never reads flat.
        const sway = Math.sin(u * 7 + t * 5 + k) * 0.5 * t;
        positions.push(x + f.nx * sway, y, z + f.nz * sway);
        // The seed's integer part keys the noise; its tenths carry the sheet's
        // weight (the Walk's veil is a thinner sheet the party sees through).
        const weight = f.kind === 'veil' ? 0.5 : f.kind === 'spill' ? 0.85 : 1;
        attrs.push(u, t, k * 3 + weight * 0.9, f.top - f.bottom);
      }
    }
    const row = across + 1;
    for (let j = 0; j < down; j++) {
      for (let i = 0; i < across; i++) {
        const a = base + j * row + i;
        indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFall', new THREE.Float32BufferAttribute(attrs, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    name: 'wildheartBasinFalls',
    vertexShader: CURTAIN_VERT,
    fragmentShader: CURTAIN_FRAG,
    uniforms: {
      ...fogUniforms(),
      uTime: sharedUniforms.uTime,
      uSunDir: { value: new THREE.Vector3(...BASIN_SUN_DIRECTION) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'wildheartBasinFallCurtains';
  mesh.renderOrder = 7;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- foam rings at the feet ---------------------------------------------------------

const FOAM_VERT = /* glsl */ `
attribute vec3 aFoam; // local x, local y (-1..1 across the oval), seed
varying vec3 vFoam;
#include <fog_pars_vertex>
void main() {
  vFoam = aFoam;
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FOAM_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vFoam;
#include <fog_pars_fragment>
${BASIN_NOISE_GLSL}
void main() {
  vec2 q = vFoam.xy;
  float r = length(q);
  float a = atan(q.y, q.x);
  float seed = vFoam.z;
  float churn = bnoise(vec2(a * 4.0 + seed, r * 7.0 - uTime * 2.2)) * 0.6 + bnoise(vec2(a * 11.0, r * 17.0 - uTime * 3.4)) * 0.4;
  float body = (1.0 - smoothstep(0.55, 1.0, r)) * smoothstep(0.28, 0.7, churn);
  // Boiling white at the heart, lacing out to the rim.
  float heart = 1.0 - smoothstep(0.0, 0.5, r);
  vec3 col = mix(vec3(0.7, 0.86, 0.86), vec3(0.97, 1.0, 1.0), churn * 0.6 + heart * 0.4);
  gl_FragColor = vec4(col, clamp(body * 0.85 + heart * 0.35, 0.0, 0.95));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

function buildFoam(falls: readonly BasinFall[]): THREE.Mesh {
  const positions: number[] = [];
  const attrs: number[] = [];
  const indices: number[] = [];
  falls.forEach((f, k) => {
    const width = fallWidth(f);
    const halfAlong = width / 2 + 5;
    const halfOut = f.kind === 'veil' ? 6 : 9;
    // The oval sits on the foot, its long axis along the lip.
    const tx = (f.bx - f.ax) / (width || 1);
    const tz = (f.bz - f.az) / (width || 1);
    const segs = 32;
    const rings = 4;
    const base = positions.length / 3;
    const y = f.bottom + 0.12;
    positions.push(f.footX, y, f.footZ);
    attrs.push(0, 0, k * 1.9);
    for (let r = 1; r <= rings; r++) {
      const rr = r / rings;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const lx = Math.cos(a) * rr;
        const ly = Math.sin(a) * rr;
        positions.push(
          f.footX + tx * lx * halfAlong + f.nx * ly * halfOut,
          y,
          f.footZ + tz * lx * halfAlong + f.nz * ly * halfOut,
        );
        attrs.push(lx, ly, k * 1.9);
      }
    }
    for (let i = 0; i < segs; i++) indices.push(base, base + 1 + i, base + 1 + ((i + 1) % segs));
    for (let r = 1; r < rings; r++) {
      const a0 = base + 1 + (r - 1) * segs;
      const b0 = a0 + segs;
      for (let i = 0; i < segs; i++) {
        const i1 = (i + 1) % segs;
        indices.push(a0 + i, b0 + i, a0 + i1, a0 + i1, b0 + i, b0 + i1);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(attrs, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'wildheartBasinFallFoam',
      vertexShader: FOAM_VERT,
      fragmentShader: FOAM_FRAG,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  mesh.name = 'wildheartBasinFallFoam';
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- spray and mist (one instanced draw each) ----------------------------------------

const PUFF_VERT = /* glsl */ `
attribute vec4 aBase;   // x, y, z at the foot, seed
attribute vec4 aMotion; // outward dir x, z, rise (yards), life (s)
attribute vec2 aSize;   // size at birth, size at death
uniform float uTime;
uniform float uDrift;
varying float vLife;
varying vec2 vUv;
varying float vSeed;
varying float vDepth;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vSeed = aBase.w;
  float life = fract(uTime / aMotion.w + aBase.w);
  vLife = life;
  vec3 c = aBase.xyz;
  // Flung out and up from the plunge, then carried off on the air.
  float burst = 1.0 - pow(max(1.0 - life, 0.0), 2.0);
  c.xz += aMotion.xy * burst * (6.0 + aBase.w * 8.0);
  c.y += aMotion.z * (burst * 1.2 - life * life * 0.25);
  c.x += uDrift * life * 6.0;
  c.z += sin(aBase.w * 40.0 + uTime * 0.3) * life * 3.0;
  float size = mix(aSize.x, aSize.y, burst);
  vec4 mvPosition = viewMatrix * modelMatrix * vec4(c, 1.0);
  mvPosition.xy += position.xy * size;
  vDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const PUFF_FRAG = /* glsl */ `
precision highp float;
uniform float uAlpha;
uniform vec3 uColor;
uniform float uTime;
varying float vLife;
varying vec2 vUv;
varying float vSeed;
varying float vDepth;
#include <fog_pars_fragment>
${BASIN_NOISE_GLSL}
void main() {
  // A puff right on the camera thins out (no screen-filling white).
  float near = smoothstep(2.0, 14.0, vDepth);
  if (near <= 0.001) discard;
  vec2 d = vUv - 0.5;
  float n = bnoise(vUv * 4.0 + vSeed * 31.0 + uTime * 0.05) * 0.6 + bnoise(vUv * 9.0 - vSeed * 7.0) * 0.4;
  float r = length(d) * 2.0 + (n - 0.5) * 0.5;
  float a = (1.0 - smoothstep(0.2, 1.0, r)) * smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.5, 1.0, vLife));
  gl_FragColor = vec4(uColor * (0.88 + 0.2 * n), a * uAlpha * near);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

interface PuffSpec {
  base: [number, number, number];
  dir: [number, number];
  rise: number;
  life: number;
  size: [number, number];
  seed: number;
}

function buildPuffs(
  name: string,
  specs: readonly PuffSpec[],
  color: number,
  alpha: number,
  order: number,
): THREE.Mesh | null {
  if (specs.length === 0) return null;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('uv', quad.getAttribute('uv'));
  const base = new Float32Array(specs.length * 4);
  const motion = new Float32Array(specs.length * 4);
  const size = new Float32Array(specs.length * 2);
  specs.forEach((s, i) => {
    base.set([s.base[0], s.base[1], s.base[2], s.seed], i * 4);
    motion.set([s.dir[0], s.dir[1], s.rise, s.life], i * 4);
    size.set(s.size, i * 2);
  });
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 4));
  geo.setAttribute('aMotion', new THREE.InstancedBufferAttribute(motion, 4));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
  geo.instanceCount = specs.length;
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name,
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      uniforms: {
        ...fogUniforms(),
        uTime: sharedUniforms.uTime,
        uDrift: { value: 0.35 },
        uAlpha: { value: alpha },
        uColor: { value: new THREE.Color(color) },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

function sprayFor(falls: readonly BasinFall[], density: number, lowGfx: boolean): PuffSpec[] {
  const out: PuffSpec[] = [];
  falls.forEach((f, k) => {
    const width = fallWidth(f);
    const height = f.top - f.bottom;
    const per = (lowGfx ? 8 : 30) * Math.max(0.3, density) * Math.max(0.8, width / 14);
    const n = Math.round(per * (f.kind === 'spill' ? 0.8 : 1));
    for (let i = 0; i < n; i++) {
      const h = (a: number) => basinHash(i + k * 211, a);
      const u = h(1);
      const spread = (h(2) - 0.5) * 2.2;
      const dx = f.nx * Math.cos(spread) - f.nz * Math.sin(spread);
      const dz = f.nz * Math.cos(spread) + f.nx * Math.sin(spread);
      out.push({
        base: [
          f.ax + (f.bx - f.ax) * u + f.nx * f.throwOut,
          f.bottom + 0.3,
          f.az + (f.bz - f.az) * u + f.nz * f.throwOut,
        ],
        dir: [dx, dz],
        rise: Math.min(26, 6 + height * 0.12) * (0.5 + h(3)),
        life: 2.6 + h(4) * 3.2,
        size: [2.2 + h(5) * 2, 7 + h(6) * 7],
        seed: h(7),
      });
    }
    // A thin haze of spray off the lip too (the water smoking as it leaves).
    if (f.kind !== 'spill') {
      const lip = Math.round((lowGfx ? 2 : 8) * Math.max(0.3, density));
      for (let i = 0; i < lip; i++) {
        const h = (a: number) => basinHash(i + k * 97, a + 40);
        const u = h(1);
        const t = 0.15 + h(2) * 0.6;
        const [x, y, z] = fallPoint(f, u, t);
        out.push({
          base: [x, y, z],
          dir: [f.nx, f.nz],
          rise: 3,
          life: 3.5 + h(3) * 2,
          size: [3, 8],
          seed: h(4),
        });
      }
    }
  });
  return out;
}

function mistFor(falls: readonly BasinFall[], density: number, lowGfx: boolean): PuffSpec[] {
  const out: PuffSpec[] = [];
  falls.forEach((f, k) => {
    const width = fallWidth(f);
    const n = Math.round((lowGfx ? 3 : 9) * Math.max(0.3, density) * Math.max(0.8, width / 16));
    for (let i = 0; i < n; i++) {
      const h = (a: number) => basinHash(i + k * 53, a + 70);
      const u = h(1) * 1.4 - 0.2;
      out.push({
        base: [
          f.ax + (f.bx - f.ax) * u + f.nx * (f.throwOut + 4 + h(2) * 10),
          f.bottom + 1 + h(3) * 4,
          f.az + (f.bz - f.az) * u + f.nz * (f.throwOut + 4 + h(2) * 10),
        ],
        dir: [f.nx * 0.4, f.nz * 0.4],
        rise: 4 + h(4) * 6,
        life: 14 + h(5) * 12,
        // Smaller banks on the lower tiers (less overdraw, same read).
        size: [(12 + h(6) * 8) * (0.6 + 0.4 * density), (26 + h(7) * 16) * (0.6 + 0.4 * density)],
        seed: h(8),
      });
    }
  });
  return out;
}

// ---- rainbows -----------------------------------------------------------------------

const BOW_VERT = /* glsl */ `
attribute vec3 aBow; // radial (0 inner .. 1 outer), arc angle (0..1), strength
attribute vec3 aNormalW;
varying vec3 vBow;
varying vec3 vWorld;
varying vec3 vN;
#include <fog_pars_vertex>
void main() {
  vBow = aBow;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vN = aNormalW;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BOW_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
varying vec3 vBow;
varying vec3 vWorld;
varying vec3 vN;
#include <fog_pars_fragment>
${BASIN_NOISE_GLSL}
vec3 spectrum(float x) {
  // Violet inside to red outside, soft-edged.
  vec3 c = vec3(0.0);
  c += vec3(0.55, 0.25, 0.9) * smoothstep(0.0, 0.14, x) * (1.0 - smoothstep(0.14, 0.3, x));
  c += vec3(0.2, 0.45, 1.0) * smoothstep(0.12, 0.28, x) * (1.0 - smoothstep(0.28, 0.44, x));
  c += vec3(0.2, 0.95, 0.45) * smoothstep(0.3, 0.46, x) * (1.0 - smoothstep(0.46, 0.6, x));
  c += vec3(1.0, 0.95, 0.25) * smoothstep(0.46, 0.6, x) * (1.0 - smoothstep(0.62, 0.76, x));
  c += vec3(1.0, 0.55, 0.15) * smoothstep(0.6, 0.74, x) * (1.0 - smoothstep(0.76, 0.88, x));
  c += vec3(1.0, 0.2, 0.15) * smoothstep(0.74, 0.88, x) * (1.0 - smoothstep(0.9, 1.0, x));
  return c;
}
void main() {
  float x = vBow.x;
  float ang = vBow.y;
  // Only from the sun's side (the face looks toward the sun).
  vec3 view = normalize(cameraPosition - vWorld);
  float face = smoothstep(0.05, 0.5, dot(view, vN));
  // Strongest in the spray low down, fading toward the top of the arc and
  // breaking up where the spray thins.
  float ends = smoothstep(0.0, 0.18, ang) * smoothstep(1.0, 0.82, ang);
  float lowArc = 0.55 + 0.45 * (1.0 - sin(ang * 3.14159));
  float spray = 0.55 + 0.45 * bnoise(vec2(ang * 9.0 + uTime * 0.08, x * 2.0 + uTime * 0.05));
  float a = vBow.z * face * ends * lowArc * spray;
  gl_FragColor = vec4(spectrum(x) * a, 1.0);
  // Additive: fade toward black with distance (a fog mix toward the fog
  // colour would paint the whole quad gold where it is transparent).
  #ifdef USE_FOG
  gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
}
`;

function buildRainbows(falls: readonly BasinFall[], lowGfx: boolean): THREE.Mesh | null {
  const bows = planBasinRainbows(falls);
  if (bows.length === 0) return null;
  const positions: number[] = [];
  const attrs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const segs = lowGfx ? 24 : 48;
  for (const b of bows) {
    // The arc's plane: its face toward the sun (yaw), its span across it.
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    const sx = fz;
    const sz = -fx;
    const base = positions.length / 3;
    for (let i = 0; i <= segs; i++) {
      const ang = i / segs;
      const a = Math.PI * (0.06 + 0.88 * ang);
      for (const radial of [0, 1]) {
        const r = b.radius - b.band / 2 + radial * b.band;
        const along = Math.cos(a) * r;
        const up = Math.sin(a) * r;
        positions.push(b.x + sx * along, b.y + up, b.z + sz * along);
        attrs.push(radial, ang, b.strength);
        normals.push(fx, 0, fz);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a0 = base + i * 2;
      indices.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aBow', new THREE.Float32BufferAttribute(attrs, 3));
  geo.setAttribute('aNormalW', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'wildheartBasinRainbow',
      vertexShader: BOW_VERT,
      fragmentShader: BOW_FRAG,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
    }),
  );
  mesh.name = 'wildheartBasinRainbows';
  mesh.renderOrder = 9;
  mesh.frustumCulled = false;
  return mesh;
}

// ---- the shelf over the Waterfall Walk ---------------------------------------------

/** The dark wet rock shelf the Walk's veil pours off: a crag of basalt
 *  boulders jutting from the east wall high over the path, heavier toward the
 *  wall, mossed on top and dripping underneath. Render only and far over head
 *  height (no collider needed). One merged, flat-shaded mesh. */
function buildWalkShelf(lowGfx: boolean): THREE.Mesh {
  const s = WALK_SHELF;
  const positions: number[] = [];
  const colors: number[] = [];
  const n = lowGfx ? 9 : 16;
  for (let i = 0; i < n; i++) {
    const h = (k: number) => basinHash(i + 500, k);
    // Spread along the shelf (z), denser and bigger toward the wall (east).
    const t = h(1);
    const toWall = 0.25 + 0.75 * Math.sqrt(h(2));
    const x = s.x0 + (s.x1 - s.x0) * toWall;
    const z = s.z0 + (s.z1 - s.z0) * t;
    const r = 4 + toWall * 6 + h(3) * 3;
    const geo = new THREE.DodecahedronGeometry(r, lowGfx ? 0 : 1).toNonIndexed();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      const vx = pos.getX(v);
      const vy = pos.getY(v);
      const vz = pos.getZ(v);
      const j = 0.75 + basinHash(Math.round(vx * 3 + i), Math.round(vz * 3 - vy)) * 0.5;
      // Flattened into a slab, the underside hanging lower toward the wall.
      const y = vy * (vy < 0 ? 0.55 + toWall * 0.6 : 0.35) * j;
      positions.push(x + vx * j * 1.1, s.y + 2 + y + (h(4) - 0.5) * 2, z + vz * j * 1.2);
      const top = vy > r * 0.35;
      const g = 0.07 + basinHash(v, i) * 0.04;
      if (top) colors.push(0.16 + g, 0.24 + g * 1.4, 0.09 + g * 0.5);
      else colors.push(g * 0.85, g * 1.02, g * 0.98);
    }
    geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.55,
      flatShading: true,
      name: 'wildheartWalkShelf',
    }),
  );
  mesh.name = 'wildheartWalkShelf';
  mesh.castShadow = !lowGfx;
  mesh.receiveShadow = true;
  return mesh;
}

/** Every fall, its foam, spray, mist and rainbow, and the Walk's shelf. */
export function buildBasinFalls(opts: BasinFallsOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'wildheartBasinFalls';
  const falls = planBasinFalls();
  group.add(buildCurtains(falls, opts.lowGfx));
  group.add(buildFoam(falls));
  const spray = buildPuffs(
    'wildheartBasinSpray',
    sprayFor(falls, opts.density, opts.lowGfx),
    0xeaf7f6,
    0.3,
    8,
  );
  if (spray) group.add(spray);
  const mist = buildPuffs(
    'wildheartBasinFallMist',
    mistFor(falls, opts.density, opts.lowGfx),
    0xdfe8dc,
    0.11,
    6,
  );
  if (mist) group.add(mist);
  const bows = buildRainbows(falls, opts.lowGfx);
  if (bows) group.add(bows);
  group.add(buildWalkShelf(opts.lowGfx));
  return group;
}

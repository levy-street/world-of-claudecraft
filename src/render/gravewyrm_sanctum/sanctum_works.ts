// The Thaw Works' floor: the only warm, wet, ugly place on the clean ice.
// Meltwater runs down the channel the cult cut through the upper terrace
// (MELT_CHANNEL: a quick dark turquoise stream with white foam at its banks
// and riffles, flowing shader-side), pools of meltwater glint round the soul
// pyres where their heat sank the ice, and the camp's filth lies over the
// snow: soot round every pyre and tent, grey trodden slush, the sledges'
// runner ruts dragged in from the works road (sanctum_works_core.ts plans
// every mark on one floor, never across an edge).
//
// Two draws: every mark in ONE merged mesh read by one shader per mark kind
// (a per-vertex attribute), and the channel's water as one ribbon. Both are
// floor marks on the floor ladder's `ground` rung, a hair over the field's
// top, so every telegraph paints over them. The steam over the channel is
// sanctum_steam.ts's. Cosmetic scatter sheds on the low tier.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { sharedUniforms } from '../gfx';
import { markSharedMaterial } from '../shared_resource';
import { sanctumGround } from './sanctum_plan_core';
import {
  MELT_CHANNEL_HALF_WIDTH,
  planMeltChannel,
  planWorksMarks,
  type WorksMark,
} from './sanctum_works_core';

/** How far each layer lies over the floor (the field's top, the marks, the
 *  water: a real height apart so none of them tears into another). */
const MARK_LIFT = 0.035;
const WATER_LIFT = 0.06;

const MARK_VERT = /* glsl */ `
attribute float aKind;
attribute float aSeed;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vKind = aKind;
  vSeed = aSeed;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MARK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying vec3 vWorld;
uniform float uTime;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { return noise(p) * 0.55 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3 - 1.3) * 0.15; }
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  vec2 w = vWorld.xz;
  float n = fbm(w * 0.7 + vSeed);
  vec3 col;
  float a;
  if (vKind < 0.5) {
    // Soot: a scorched blot, black in the middle, broken smuts at its edge.
    float r = length(c) + (n - 0.5) * 0.6;
    float smut = smoothstep(0.6, 0.78, fbm(w * 5.5 + vSeed * 3.0));
    float char = smoothstep(1.0, 0.4, r) * (0.55 + 0.45 * smoothstep(0.3, 0.7, fbm(w * 3.1 - vSeed)));
    a = char * 0.75 + smut * smoothstep(1.1, 0.5, r) * 0.45;
    col = mix(vec3(0.006, 0.005, 0.006), vec3(0.03, 0.026, 0.026), n);
  } else if (vKind < 1.5) {
    // Slush: grey trodden snow gone to wet mush, blotchy, a dull sheen.
    float r = length(c) + (n - 0.5) * 0.8;
    a = smoothstep(1.0, 0.45, r) * (0.22 + 0.3 * smoothstep(0.35, 0.7, fbm(w * 1.4 + 9.0)));
    col = mix(vec3(0.1, 0.13, 0.19), vec3(0.24, 0.29, 0.37), fbm(w * 3.0));
  } else if (vKind < 2.5) {
    // A runner's rut: a pressed groove of blue-shadowed snow, a slushy
    // brown line in its bottom, fading out at both ends.
    float across = abs(c.x);
    float ends = smoothstep(1.0, 0.85, abs(c.y));
    float groove = smoothstep(1.0, 0.5, across);
    float line = smoothstep(0.35, 0.0, across) * (0.6 + 0.4 * noise(vec2(w.x + w.y, vSeed) * 2.0));
    a = (groove * 0.45 + line * 0.35) * ends;
    col = mix(vec3(0.2, 0.26, 0.38), vec3(0.09, 0.08, 0.08), line);
  } else {
    // A meltwater puddle: dark wet ice with the dusk glancing off it, a crisp
    // ragged edge and a rim of slush.
    float r = length(c) + (n - 0.5) * 0.45;
    float body = smoothstep(0.92, 0.84, r);
    float rim = smoothstep(1.0, 0.92, r) * (1.0 - body);
    vec3 view = normalize(cameraPosition - vWorld);
    float fres = pow(max(1.0 - max(0.0, view.y), 0.0), 3.0);
    float ripple = noise(w * 3.0 + vec2(uTime * 0.4, -uTime * 0.3));
    vec3 water = vec3(0.004, 0.014, 0.024) + vec3(0.06, 0.1, 0.18) * fres * (0.5 + 0.5 * ripple);
    // A glint of the pyre in it.
    water += vec3(0.08, 0.035, 0.01) * smoothstep(0.6, 0.9, ripple) * 0.4;
    col = mix(vec3(0.12, 0.16, 0.23), water, body);
    a = body * 0.88 + rim * 0.35;
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

const WATER_VERT = /* glsl */ `
attribute float aAlong;
varying vec2 vUv;
varying float vAlong;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vAlong = aAlong;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vAlong;
varying vec3 vWorld;
uniform float uTime;
uniform float uLength;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float across = vUv.x * 2.0 - 1.0;
  float t = uTime;
  // Flow: streaks running down the channel, faster in the middle.
  float speed = 3.2 * (1.0 - across * across * 0.6);
  vec2 q = vec2(across * 2.2, vAlong * 0.7 - t * speed);
  float flow = noise(q) * 0.6 + noise(q * vec2(1.0, 2.6) + 4.1) * 0.4;
  float streak = smoothstep(0.58, 0.8, noise(vec2(across * 7.0, vAlong * 2.4 - t * speed * 2.2)));
  // Foam: white at the banks and in riffles where the noise heaps up.
  float bank = smoothstep(0.62, 0.95, abs(across));
  float riffle = smoothstep(0.7, 0.86, flow) * 0.7;
  float foam = clamp(bank * (0.5 + 0.5 * flow) + riffle, 0.0, 1.0);
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(max(1.0 - max(0.0, view.y), 0.0), 3.0);
  vec3 deep = vec3(0.01, 0.08, 0.1);
  vec3 lit = vec3(0.05, 0.26, 0.3);
  vec3 col = mix(deep, lit, flow * 0.7) + vec3(0.12, 0.2, 0.32) * fres * 0.7;
  col += vec3(0.25, 0.35, 0.4) * streak * 0.4;
  col = mix(col, vec3(0.78, 0.86, 0.9), foam);
  // The head and the foot fade into the ice (it seeps in and pours off).
  float ends = smoothstep(0.0, 1.5, vAlong) * smoothstep(uLength, uLength - 1.5, vAlong);
  float a = (0.88 + 0.12 * foam) * ends * smoothstep(1.0, 0.9, abs(across));
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

let markMat: THREE.ShaderMaterial | null = null;
let waterMat: THREE.ShaderMaterial | null = null;

function markMaterial(): THREE.ShaderMaterial {
  if (!markMat) {
    markMat = new THREE.ShaderMaterial({
      name: 'gravewyrmSanctumWorksMarks',
      vertexShader: MARK_VERT,
      fragmentShader: MARK_FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sharedUniforms.uTime,
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    markSharedMaterial(markMat);
  }
  return markMat;
}

function waterMaterial(length: number): THREE.ShaderMaterial {
  if (!waterMat) {
    waterMat = new THREE.ShaderMaterial({
      name: 'gravewyrmSanctumMeltChannel',
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sharedUniforms.uTime,
        uLength: { value: length },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    markSharedMaterial(waterMat);
  }
  return waterMat;
}

/** Every works mark merged into one mesh (a 3 by 3 grid per mark, each
 *  vertex on the floor so a ramp's slope is followed). */
function buildMarks(marks: readonly WorksMark[]): THREE.Mesh | null {
  if (marks.length === 0) return null;
  const N = 3;
  const pos: number[] = [];
  const uv: number[] = [];
  const kind: number[] = [];
  const seed: number[] = [];
  const index: number[] = [];
  marks.forEach((m, mi) => {
    const c = Math.cos(m.rot);
    const s = Math.sin(m.rot);
    const base = pos.length / 3;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const v = j / N;
        const ax = (u * 2 - 1) * m.hw;
        const al = (v * 2 - 1) * m.hl;
        const x = m.x + ax * c + al * s;
        const z = m.z - ax * s + al * c;
        pos.push(x, sanctumGround(x, z) + MARK_LIFT, z);
        uv.push(u, v);
        kind.push(m.kind);
        seed.push(mi * 1.37);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i;
        index.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, markMaterial());
  mesh.name = 'gravewyrmSanctumWorksMarks';
  mesh.renderOrder = floorVfxRenderOrder('ground', 0);
  return mesh;
}

/** The melt channel's running water: one ribbon along MELT_CHANNEL. */
function buildChannel(): THREE.Mesh | null {
  const pts = planMeltChannel(0.8);
  if (pts.length < 2) return null;
  const pos: number[] = [];
  const uv: number[] = [];
  const along: number[] = [];
  const index: number[] = [];
  const w = MELT_CHANNEL_HALF_WIDTH;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // Across the flow (to the right of it), a gentle meander in the width.
    const nx = dz / l;
    const nz = -dx / l;
    const ww = w * (0.85 + 0.15 * Math.sin(p.s * 0.7));
    for (const side of [-1, 1]) {
      const x = p.x + nx * ww * side;
      const z = p.z + nz * ww * side;
      pos.push(x, sanctumGround(x, z) + WATER_LIFT, z);
      uv.push(side < 0 ? 0 : 1, p.s);
      along.push(p.s);
    }
    if (i > 0) {
      const k = (i - 1) * 2;
      index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, waterMaterial(pts[pts.length - 1].s));
  mesh.name = 'gravewyrmSanctumMeltChannel';
  // The water over the marks, under the fires' stains and every telegraph.
  mesh.renderOrder = floorVfxRenderOrder('ground', 1);
  return mesh;
}

/** The Thaw Works' floor: the marks and the melt channel's water. `density`
 *  (0..1) thins the cosmetic scatter; the low tier drops it. */
export function buildSanctumWorks(lowGfx: boolean, density: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gravewyrmSanctumWorks';
  const all = planWorksMarks();
  const marks = all.filter(
    (m, i) => !m.cosmetic || (!lowGfx && (density >= 0.99 || (i * 0.618) % 1 < density)),
  );
  const markMesh = buildMarks(marks);
  if (markMesh) group.add(markMesh);
  const channel = buildChannel();
  if (channel) group.add(channel);
  return group;
}

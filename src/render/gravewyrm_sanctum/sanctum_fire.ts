// The Gravewyrm Sanctum's fires: the cult's braziers and the Thaw Works' soul
// pyres burning orange pitch fire, and the soul braziers and the vault's thaw
// pyres burning the stolen souls in violet-green soulfire, pale wisps of the
// burned souls spiralling up out of them and thinning away.
//
// A fire is layered, never one shape: a column of tall narrow tongues at
// several sizes in its heart, a ring of shorter tongues round the coals
// leaning out and licking up, quick flicks of flame breaking off above the
// body (they keep the silhouette ragged), a hot pale core low in the coals,
// embers and (soulfire) curling wisps. Each tongue curls and is mirrored on
// its own seed, so no two share a silhouette.
//
// ONE instanced draw for every fire of the Sanctum: each instance is a
// camera-facing quad whose whole life (rise, sway, flipbook frame, fade) runs
// in the vertex shader on the shared clock from its seed, so the CPU never
// touches it after the build. Every tongue samples the one shared flame atlas
// (ignivar_fire_vfx.ts FLAME_ATLAS_GLSL). A roaring fire (the thaw pyres)
// swells on a slow breath. Built with the interior (linked by the interior's
// compile gate); cosmetic (the light the fires cast is sanctum_lights.ts's
// budgeted point lights); fewer tongues and no embers or wisps on the low tier.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { FLAME_ATLAS_GLSL, getFlameTex } from '../ignivar_fire_vfx';
import { markSharedTexture } from '../shared_resource';
import {
  PITCH_RAMP,
  SANCTUM_FIRE,
  type SanctumFireDraw,
  SOUL_RAMP,
  sanctumFireCounts,
  sanctumFireInstanceTotal,
} from './sanctum_fire_core';
import { sanctumHash } from './sanctum_plan_core';

const vec3 = (c: readonly [number, number, number]) =>
  `vec3(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

const RAMP_GLSL = /* glsl */ `
vec3 ramp5(float h, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.25, h));
  c = mix(c, c2, smoothstep(0.25, 0.5, h));
  c = mix(c, c3, smoothstep(0.5, 0.75, h));
  return mix(c, c4, smoothstep(0.75, 1.0, h));
}
vec3 pitchRamp(float h) {
  return ramp5(h, ${PITCH_RAMP.map(vec3).join(', ')});
}
vec3 soulRamp(float h) {
  return ramp5(h, ${SOUL_RAMP.map(vec3).join(', ')});
}
`;

// Instance kinds (aSeed.y): 0 an inner tongue, 1 the hot core, 2 an ember,
// 3 a soul wisp, 4 an outer tongue, 5 a tip lick.
const FIRE_VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aBase;
attribute vec4 aSeed; // seed, kind, ring angle, size
attribute vec2 aStyle; // soul (0 or 1), roar (0 or 1)
varying float vAge;
varying float vKind;
varying float vSeed;
varying float vSoul;
varying float vFrame;
varying float vBlend;
varying vec2 vQuad;
${FLAME_ATLAS_GLSL}
void main() {
  float seed = aSeed.x;
  float kind = aSeed.y;
  float ang = aSeed.z;
  float size = aSeed.w;
  float soul = aStyle.x;
  float r1 = h11(seed * 1.31);
  float r2 = h11(seed * 2.77);
  // A roaring fire swells on a slow breath, and roars higher on it.
  float breath = 0.5 + 0.5 * sin(uTime * 0.9 + seed * 0.013);
  float roar = 1.0 + aStyle.y * (0.25 * breath * breath);
  float rate = kind > 4.5 ? 2.0 + 1.2 * r1
    : kind > 3.5 ? 1.15 + 0.5 * r1
    : kind > 2.5 ? 0.12 + 0.06 * r1
    : kind > 1.5 ? 0.42 + 0.35 * r2
    : kind > 0.5 ? 1.4
    : 0.85 + 0.45 * r1;
  float age = fract(uTime * rate + h11(seed * 7.7));
  vec3 p = aBase;
  float w;
  float h;
  if (kind > 4.5) {
    // A tip lick: a small tongue flicking off above the body and gone.
    float y0 = size * (0.95 + 0.75 * r1) * roar;
    float r = size * 0.28 * r2;
    p += vec3(cos(ang) * r, y0 + age * size * 0.7, sin(ang) * r);
    w = size * (0.16 + 0.14 * r2) * (1.0 - age * 0.5);
    h = w * 2.4;
  } else if (kind > 3.5) {
    // An outer tongue: round the coals, leaning out as it licks up.
    float r = ${SANCTUM_FIRE.ring.toFixed(2)} * size * (1.0 + 0.5 * r2) + age * size * 0.18;
    p += vec3(cos(ang) * r, age * 0.35 * size * roar, sin(ang) * r);
    float grow = smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.65, 1.0, age) * 0.7);
    w = size * (0.4 + 0.26 * r1) * (0.5 + 0.5 * grow);
    h = w * (2.0 + 0.8 * r2) * roar;
  } else if (kind > 2.5) {
    // A soul wisp: a pale ribbon of smoke spiralling up out of the soulfire.
    float rise = age * ${SANCTUM_FIRE.wispRise.toFixed(2)} * size * roar;
    float turn = ang + age * 5.0;
    float r = size * (0.2 + 0.45 * age);
    p += vec3(cos(turn) * r, size * 0.9 + rise, sin(turn) * r);
    w = size * (0.3 + 0.3 * age);
    h = w * 2.2;
  } else if (kind > 1.5) {
    // An ember: rising high, swaying on the heat, drifting on the cold air.
    float rise = age * (${SANCTUM_FIRE.emberRise.toFixed(2)} * size + 1.5 * r2) * roar;
    p += vec3(sin(age * 9.0 + seed * 20.0) * 0.35 * size + age * 0.6, size * 0.3 + rise,
              cos(age * 7.0 + seed * 11.0) * 0.35 * size);
    w = 0.07 * (1.0 - age * 0.6) * (0.7 + 0.3 * size);
    h = w;
  } else if (kind > 0.5) {
    // The hot core: a pale knot of heat down in the coals.
    p += vec3((r1 - 0.5) * 0.4 * size, -0.15 * size + age * 0.12 * size, (r2 - 0.5) * 0.4 * size);
    w = size * (0.75 + 0.3 * r2);
    h = w * 0.75;
  } else {
    // An inner tongue: tall and narrow in the fire's heart, at its own size.
    float r = 0.16 * size * r2;
    p += vec3(cos(ang) * r, age * 0.55 * size * roar, sin(ang) * r);
    float grow = smoothstep(0.0, 0.22, age) * (1.0 - smoothstep(0.7, 1.0, age) * 0.6);
    float scale = 0.55 + 0.75 * r1;
    w = size * 0.5 * scale * (0.6 + 0.4 * grow);
    h = w * (3.0 + 1.0 * r2) * roar;
  }
  vAge = age;
  vKind = kind;
  vSeed = seed;
  vSoul = soul;
  vQuad = position.xy + 0.5;
  float ff = min(age * 35.0, 34.999);
  vFrame = floor(ff);
  vBlend = ff - vFrame;
  // Upright billboard: it faces the camera round the vertical only, so a
  // flame never tips over when the camera looks down on the bowl. The
  // interior group carries the slot's offset: into the world first.
  p = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 toCam = cameraPosition - p;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
  float sway = sin(uTime * 6.0 + seed * 40.0) * 0.14 * vQuad.y * vQuad.y * w;
  vec3 world = p + right * (position.x * w + sway) + vec3(0.0, (position.y + 0.42) * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FIRE_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uTime;
varying float vAge;
varying float vKind;
varying float vSeed;
varying float vSoul;
varying float vFrame;
varying float vBlend;
varying vec2 vQuad;
${FLAME_ATLAS_GLSL}
${RAMP_GLSL}
// The flipbook at a curled, mirrored corner: each tongue bends on its own
// clock and half of them are flipped, so no two share a silhouette.
float flame(vec2 q) {
  float flip = step(0.5, h11(vSeed * 4.13));
  q.x = mix(q.x, 1.0 - q.x, flip);
  q.x += sin(q.y * 4.5 + uTime * 3.3 + vSeed * 7.0) * 0.07 * q.y;
  q = clamp(q, 0.0, 1.0);
  float a = texture2D(uTex, cellUv(q, vFrame)).r;
  float b = texture2D(uTex, cellUv(q, min(vFrame + 1.0, 35.0))).r;
  return mix(a, b, vBlend);
}
void main() {
  vec3 outCol;
  // How much of the background a sprite hides (premultiplied blending): the
  // flame's body covers the bright ice behind it so its colour saturates
  // instead of washing out to white; embers stay pure light.
  float cover = 0.0;
  if (vKind > 2.5 && vKind < 3.5) {
    // A wisp: a soft pale streak, twisting through the flipbook's grain.
    float I = flame(vQuad);
    float side = 1.0 - smoothstep(0.1, 0.5, abs(vQuad.x - 0.5 + sin(vQuad.y * 6.0 + vSeed) * 0.08));
    float body = side * smoothstep(0.0, 0.3, vQuad.y) * (1.0 - smoothstep(0.55, 1.0, vQuad.y));
    float fade = smoothstep(0.0, 0.2, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge));
    float a = body * fade * (0.55 + 0.45 * I) * 0.3;
    outCol = vec3(0.4, 0.9, 0.52) * a;
    cover = a * 0.5;
  } else if (vKind > 1.5 && vKind < 2.5) {
    float r = length(vQuad - 0.5) * 2.0;
    float core = pow(max(1.0 - r, 0.0), 2.0);
    float fade = smoothstep(0.0, 0.08, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
    float flick = 0.7 + 0.3 * sin(uTime * 31.0 + vSeed * 50.0);
    vec3 ember = mix(vec3(1.0, 0.36, 0.05), vec3(0.27, 1.0, 0.42), vSoul);
    outCol = ember * core * fade * flick * 1.8;
  } else if (vKind > 0.5 && vKind < 1.5) {
    // The core: a soft round knot, white-hot in the middle.
    float r = length((vQuad - vec2(0.5, 0.42)) * vec2(1.0, 1.25)) * 2.0;
    float k = pow(max(1.0 - r, 0.0), 1.6) * (0.85 + 0.15 * sin(uTime * 17.0 + vSeed));
    vec3 col = mix(pitchRamp(0.55 + 0.45 * k), soulRamp(0.55 + 0.45 * k), vSoul);
    outCol = col * k * 0.9;
    cover = k * 0.55;
  } else {
    float I = flame(vQuad);
    // A tongue's mask: narrow, broken at its edges by the flipbook itself.
    float halfW = mix(0.44, 0.05, smoothstep(0.05, 0.95, vQuad.y));
    float tongue = (1.0 - smoothstep(halfW * 0.45, halfW, abs(vQuad.x - 0.5))) * smoothstep(0.0, 0.12, vQuad.y);
    float body = I * tongue;
    float er = 0.08 + 0.45 * smoothstep(0.45, 1.0, vAge);
    float m = smoothstep(er, er + 0.4, body);
    float flick = 0.86 + 0.14 * sin(uTime * 23.0 + vSeed * 61.0);
    // Outer tongues and licks burn cooler (their tips the ramp's edge
    // colour); the inner column burns hottest at its foot.
    float tier = vKind > 4.5 ? 1.2 : vKind > 3.5 ? 1.3 : 1.45;
    float heat = mix(0.98, 0.38, smoothstep(0.05, 0.95, vAge)) * mix(1.12, 0.42, vQuad.y) * flick * tier;
    float hh = clamp(body * heat, 0.0, 1.0);
    vec3 col = mix(pitchRamp(hh), soulRamp(hh), vSoul);
    float fade = smoothstep(0.0, 0.06, vAge) * (1.0 - smoothstep(0.65, 1.0, vAge));
    outCol = col * m * fade * 1.45;
    // Only the lit body covers: the cool rim stays light, never a dark blob.
    cover = m * fade * smoothstep(0.08, 0.35, hh) * mix(0.9, 0.55, vQuad.y);
  }
  // Premultiplied: the colour is the flame's light, the alpha how much of
  // the scene behind it the body hides.
  gl_FragColor = vec4(outCol, clamp(cover, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** Every fire of the Sanctum in one instanced draw. `fires` are the bowls'
 *  tops (instance-local frame). */
export function buildSanctumFires(
  fires: readonly SanctumFireDraw[],
  lowGfx: boolean,
): THREE.Mesh | null {
  if (fires.length === 0) return null;
  const n = sanctumFireInstanceTotal(fires, lowGfx);
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const base = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  const style = new Float32Array(n * 2);
  let i = 0;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  fires.forEach((f, b) => {
    const per = sanctumFireCounts(f.size, f.soul, lowGfx);
    const push = (kind: number, k: number, count: number) => {
      base.set([f.x, f.y, f.z], i * 3);
      // Each class spreads evenly round the fire, offset per class and per
      // fire so the classes never line up.
      const angle = ((k + 0.5 * sanctumHash(b, kind)) / Math.max(1, count)) * Math.PI * 2 + kind;
      seed.set([b * 31.7 + k * 3.13 + kind * 101, kind, angle, f.size], i * 4);
      style.set([f.soul ? 1 : 0, f.roar ? 1 : 0], i * 2);
      i++;
    };
    for (let k = 0; k < per.cores; k++) push(1, k, per.cores);
    for (let k = 0; k < per.outer; k++) push(4, k, per.outer);
    for (let k = 0; k < per.inner; k++) push(0, k, per.inner);
    for (let k = 0; k < per.licks; k++) push(5, k, per.licks);
    for (let k = 0; k < per.embers; k++) push(2, k, per.embers);
    for (let k = 0; k < per.wisps; k++) push(3, k, per.wisps);
    // Bounds: the tallest a fire reaches (an ember or a wisp at its top).
    box.expandByPoint(v.set(f.x, f.y - f.size, f.z));
    box.expandByPoint(v.set(f.x, f.y + f.size * 7 + 3, f.z));
    box.expandByPoint(v.set(f.x + f.size * 2, f.y, f.z + f.size * 2));
    box.expandByPoint(v.set(f.x - f.size * 2, f.y, f.z - f.size * 2));
  });
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aStyle', new THREE.InstancedBufferAttribute(style, 2));
  geo.instanceCount = n;
  quad.dispose();
  // The atlas is the game's one module-cached flame texture: marked shared so
  // the interior's sweep never disposes it under the other fires.
  const tex = typeof document !== 'undefined' ? markSharedTexture(getFlameTex()) : null;
  const mat = new THREE.ShaderMaterial({
    name: 'gravewyrmSanctumFire',
    uniforms: { uTime: sharedUniforms.uTime, uTex: { value: tex } },
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    transparent: true,
    depthWrite: false,
    // Premultiplied over: emissive colour plus a cover that darkens what is
    // behind (pure additive washed out to white against the snow and ice).
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'gravewyrmSanctumFire';
  // The quads move in the vertex shader: the instances' own spread is the
  // bound (instance-local; the interior group carries the slot's offset).
  geo.boundingBox = box;
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  mesh.frustumCulled = false;
  return mesh;
}

// The Sunbone braziers' fire: real flame instead of the phase-A cones. Every
// brazier burns a cluster of flipbook flame tongues (the one shared flame atlas
// every sprite fire in the game samples, ignivar_fire_vfx.ts FLAME_ATLAS_GLSL)
// licking up out of its bowl through a warm troll-fire ramp, a hot core low in
// the bowl, and embers streaming up and drifting off on the heat.
//
// ONE instanced draw for every brazier of the basin: each instance is a camera-
// facing quad whose whole life (rise, sway, flipbook frame, fade) runs in the
// vertex shader on the shared clock from its seed, so the CPU never touches it
// after the build. Built with the interior (linked by the interior's compile
// gate); cosmetic (the light the braziers cast is basin_lights.ts's budgeted
// point lights); fewer tongues and no embers on the low tier.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { FLAME_ATLAS_GLSL, getFlameTex } from '../ignivar_fire_vfx';
import { markSharedTexture } from '../shared_resource';
import { BRAZIER_FIRE, fireInstanceCount } from './basin_fire_core';
import { basinHash } from './basin_plan_core';

const FIRE_VERT = /* glsl */ `
uniform float uTime;
attribute vec3 aBase;
attribute vec4 aSeed; // seed, kind (0 tongue, 1 core, 2 ember), ring angle, size
varying float vAge;
varying float vKind;
varying float vSeed;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vBlend;
varying vec2 vQuad;
${FLAME_ATLAS_GLSL}
void main() {
  float seed = aSeed.x;
  float kind = aSeed.y;
  float ang = aSeed.z;
  float size = aSeed.w;
  float rate = kind > 1.5 ? 0.45 + 0.35 * h11(seed * 3.1) : (kind > 0.5 ? 1.6 : 1.05 + 0.4 * h11(seed));
  float age = fract(uTime * rate + h11(seed * 7.7));
  vec3 p = aBase;
  float w;
  float h;
  if (kind > 1.5) {
    // An ember: rising high, swaying on the heat, drifting with the breeze.
    float rise = age * (${BRAZIER_FIRE.emberRise.toFixed(2)} + 1.5 * h11(seed * 5.3));
    p += vec3(sin(age * 9.0 + seed * 20.0) * 0.35 + age * 0.9, rise, cos(age * 7.0 + seed * 11.0) * 0.35);
    w = 0.09 * (1.0 - age * 0.6);
    h = w;
  } else {
    float r = (kind > 0.5 ? 0.0 : ${BRAZIER_FIRE.ring.toFixed(2)}) * (0.6 + 0.4 * h11(seed * 2.3));
    p += vec3(cos(ang) * r, age * (kind > 0.5 ? 0.25 : 0.55) * size, sin(ang) * r);
    // The tongue grows from the coals, licks up and thins as it burns out.
    float grow = smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(0.7, 1.0, age) * 0.6);
    w = size * (kind > 0.5 ? 1.15 : 0.62) * (0.55 + 0.45 * grow);
    h = w * (kind > 0.5 ? 1.1 : 1.85);
  }
  vAge = age;
  vKind = kind;
  vSeed = seed;
  vQuad = position.xy + 0.5;
  float ff = min(age * 35.0, 34.999);
  float fA = floor(ff);
  vBlend = ff - fA;
  vUvA = cellUv(vQuad, fA);
  vUvB = cellUv(vQuad, min(fA + 1.0, 35.0));
  // Upright billboard: it faces the camera round the vertical only, so a
  // flame never tips over when the camera looks down on the bowl.
  // The interior group carries the instance's offset: into the world first.
  p = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 toCam = cameraPosition - p;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
  float sway = sin(uTime * 6.0 + seed * 40.0) * 0.12 * vQuad.y * vQuad.y * w;
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
varying vec2 vUvA;
varying vec2 vUvB;
varying float vBlend;
varying vec2 vQuad;
vec3 fireRamp(float h) {
  vec3 c = mix(vec3(0.0), vec3(0.55, 0.08, 0.01), smoothstep(0.0, 0.25, h));
  c = mix(c, vec3(1.0, 0.36, 0.05), smoothstep(0.25, 0.5, h));
  c = mix(c, vec3(1.0, 0.72, 0.28), smoothstep(0.5, 0.75, h));
  c = mix(c, vec3(1.0, 0.95, 0.78), smoothstep(0.75, 1.0, h));
  return c;
}
void main() {
  if (vKind > 1.5) {
    float r = length(vQuad - 0.5) * 2.0;
    float core = pow(max(1.0 - r, 0.0), 2.0);
    float fade = smoothstep(0.0, 0.08, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
    float flick = 0.7 + 0.3 * sin(uTime * 31.0 + vSeed * 50.0);
    gl_FragColor = vec4(vec3(1.0, 0.62, 0.22) * core * fade * flick * 1.8, 1.0);
    return;
  }
  float I = mix(texture2D(uTex, vUvA).r, texture2D(uTex, vUvB).r, vBlend);
  float halfW = mix(0.46, 0.06, smoothstep(0.05, 0.95, vQuad.y));
  float tongue = (1.0 - smoothstep(halfW * 0.5, halfW, abs(vQuad.x - 0.5))) * smoothstep(0.0, 0.1, vQuad.y);
  float body = I * tongue;
  float er = 0.08 + 0.45 * smoothstep(0.45, 1.0, vAge);
  float m = smoothstep(er, er + 0.45, body);
  float flick = 0.88 + 0.12 * sin(uTime * 23.0 + vSeed * 61.0);
  float heat = mix(0.98, 0.4, smoothstep(0.05, 0.95, vAge)) * mix(1.1, 0.45, vQuad.y) * flick
             * (vKind > 0.5 ? 1.2 : 1.0);
  vec3 col = fireRamp(clamp(body * heat, 0.0, 1.0));
  float fade = smoothstep(0.0, 0.06, vAge) * (1.0 - smoothstep(0.65, 1.0, vAge));
  float a = m * fade;
  gl_FragColor = vec4(col * a * 1.6, 1.0);
}
`;

/** Every brazier's fire in one instanced draw. `spots` are the bowls' tops. */
export function buildBasinFires(
  spots: readonly { x: number; y: number; z: number }[],
  lowGfx: boolean,
): THREE.Mesh | null {
  if (spots.length === 0) return null;
  const per = fireInstanceCount(lowGfx);
  const n = spots.length * per.total;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const base = new Float32Array(n * 3);
  const seed = new Float32Array(n * 4);
  let i = 0;
  spots.forEach((s, b) => {
    const push = (kind: number, k: number, size: number) => {
      base.set([s.x, s.y, s.z], i * 3);
      seed.set(
        [
          b * 31.7 + k * 3.13 + kind * 101,
          kind,
          (k / Math.max(1, per.tongues)) * Math.PI * 2,
          size,
        ],
        i * 4,
      );
      i++;
    };
    for (let k = 0; k < per.tongues; k++)
      push(0, k, BRAZIER_FIRE.tongue * (0.8 + 0.4 * basinHash(b * 7 + k, 3)));
    for (let k = 0; k < per.cores; k++) push(1, k, BRAZIER_FIRE.core);
    for (let k = 0; k < per.embers; k++) push(2, k, 1);
  });
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = n;
  quad.dispose();
  // The atlas is the game's one module-cached flame texture: marked shared so
  // the interior's sweep never disposes it under the other fires.
  const tex = typeof document !== 'undefined' ? markSharedTexture(getFlameTex()) : null;
  const mat = new THREE.ShaderMaterial({
    name: 'wildheartBrazierFire',
    uniforms: { uTime: sharedUniforms.uTime, uTex: { value: tex } },
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wildheartBrazierFire';
  mesh.frustumCulled = false;
  return mesh;
}

// The Hollow Crypt's living air in ONE draw: brazier embers, bone dust in the
// yard, grave dust whirling round Sexton Marrow, frost glitter in the gallery,
// violet notes over the Bone Organ, and the soul spiral feeding Morthen's
// column. Every particle belongs to an emitter (crypt_plan_core.ts) and is
// animated entirely in the vertex shader on the shared clock: a looping life,
// a rise, a swirl, a fade. Counts shed with the effects tier (cosmetic only).
//
// Plus the chasm mist: soft billboard puffs drifting just under every
// terrace's rim, so the crags sink into the grave-mist instead of ending.

import * as THREE from 'three';
import { HOLLOW_CRYPT_FIELD } from '../../sim/content/hollow_crypt_layout';
import { surfaceOutline } from '../../sim/instances/authored_field';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { sharedUniforms } from '../gfx';
import { CRYPT_EMITTER_STYLE, HOLLOW_CRYPT_EMITTERS } from './crypt_plan_core';

const PARTICLE_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec3 aOrigin;
attribute vec4 aSeed;
attribute vec4 aStyle;   // rise, life, size, swirl
attribute vec3 aColor;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float life = fract(uTime / aStyle.y + aSeed.x);
  float ang = aSeed.y * 6.2831 + uTime * aStyle.w * (0.5 + aSeed.z);
  float r = aSeed.w * (1.0 - 0.35 * life);
  vec3 p = aOrigin + vec3(cos(ang) * r, life * aStyle.x, sin(ang) * r);
  p.y += sin(uTime * 1.7 + aSeed.x * 20.0) * 0.15;
  vec4 mv = wocCamRelView(p);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(18.0, aStyle.z * 90.0 / max(1.0, -mv.z));
  float twinkle = 0.65 + 0.35 * sin(uTime * (3.0 + aSeed.z * 5.0) + aSeed.y * 30.0);
  vAlpha = sin(3.14159 * life) * twinkle * smoothstep(2.0, 10.0, -mv.z);
  vColor = aColor;
}
`;

const PARTICLE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = pow(max(0.0, 1.0 - d), 2.2);
  float a = core * vAlpha;
  gl_FragColor = vec4(vColor * a * 1.4, a);
  #include <colorspace_fragment>
}
`;

export function buildCryptParticles(
  ground: (x: number, z: number) => number,
  density: number,
): THREE.Points {
  const origins: number[] = [];
  const seeds: number[] = [];
  const styles: number[] = [];
  const colors: number[] = [];
  let s = 11;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const c = new THREE.Color();
  for (const e of HOLLOW_CRYPT_EMITTERS) {
    const style = CRYPT_EMITTER_STYLE[e.kind];
    c.setHex(style.color);
    const n = Math.max(4, Math.round(e.count * density));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * e.radius;
      const x = e.x + Math.cos(a) * rr * 0.3;
      const z = e.z + Math.sin(a) * rr * 0.3;
      origins.push(x, ground(e.x, e.z) + e.lift, z);
      seeds.push(rnd(), rnd(), rnd(), rr);
      styles.push(
        style.rise * (0.6 + rnd() * 0.8),
        style.life * (0.7 + rnd() * 0.6),
        style.size,
        style.swirl,
      );
      colors.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(new Float32Array(origins.length), 3),
  );
  geo.setAttribute('aOrigin', new THREE.Float32BufferAttribute(origins, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(styles, 4));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    name: 'hollowCryptParticles',
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms: { uTime: sharedUniforms.uTime },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, material);
  points.name = 'hollowCryptParticles';
  points.frustumCulled = false;
  return points;
}

// ---- chasm mist puffs ---------------------------------------------------------------

const PUFF_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec3 aCenter;
attribute vec3 aPuff;   // size, phase, drift
uniform float uTime;
varying vec2 vUv;
varying float vPhase;
#include <fog_pars_vertex>
void main() {
  vUv = position.xy + 0.5;
  vPhase = aPuff.y;
  vec3 c = aCenter + vec3(sin(uTime * 0.05 + aPuff.y * 6.0) * aPuff.z, sin(uTime * 0.11 + aPuff.y * 9.0) * 0.8, cos(uTime * 0.04 + aPuff.y * 4.0) * aPuff.z);
  vec4 mvCenter = wocCamRelView(c);
  vec4 mvPosition = mvCenter + vec4(position.xy * aPuff.x, 0.0, 0.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const PUFF_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying float vPhase;
uniform float uTime;
uniform vec3 uColor;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c) * 2.0;
  float n = noise(vUv * 3.0 + vPhase * 7.0 + uTime * 0.03) * 0.6 + noise(vUv * 7.0 - uTime * 0.05) * 0.4;
  float a = smoothstep(1.0, 0.1, d) * smoothstep(0.25, 0.75, n) * 0.28;
  gl_FragColor = vec4(uColor, a);
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

/** Mist banks under every terrace rim that drops into the chasm. */
export function buildChasmMist(density: number): THREE.Mesh {
  const centers: number[] = [];
  const puffs: number[] = [];
  let s = 29;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (const surface of HOLLOW_CRYPT_FIELD.surfaces) {
    if (surface.kind === 'path' && surface.halfWidth < 5) continue;
    const ring = surfaceOutline(surface);
    const h = surface.kind === 'path' ? surface.points[0][2] : surface.h;
    let perimeter = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      perimeter += Math.hypot(bx - ax, bz - az);
    }
    const n = Math.max(2, Math.round((perimeter / 16) * density));
    for (let k = 0; k < n; k++) {
      const i = Math.floor(rnd() * ring.length);
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const t = rnd();
      centers.push(ax + (bx - ax) * t, h - 6 - rnd() * 9, az + (bz - az) * t);
      puffs.push(18 + rnd() * 22, rnd(), 2 + rnd() * 4);
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs), 3));
  geo.instanceCount = centers.length / 3;
  const material = new THREE.ShaderMaterial({
    name: 'hollowCryptChasmMist',
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: sharedUniforms.uTime,
      uColor: { value: new THREE.Color(0x8890b4) },
    },
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'hollowCryptChasmMist';
  mesh.frustumCulled = false;
  return mesh;
}

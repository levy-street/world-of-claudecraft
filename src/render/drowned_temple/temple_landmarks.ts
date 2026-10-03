// The Drowned Temple's landmarks that are light rather than stone: the Moon
// Altar's silver column rising into the sky (seen from the Moongate Landing,
// 440 yd away, the finale shown from the first step), the Hydra Pool's moon
// water and its steam (the pool drains in a whirl when the Prism Stair rises),
// and the Prism Tower's violet beam falling on the terrace.
//
// Cosmetic only; motion on the shared clock; the pool reads its gate's
// on-screen openness through temple_gates.ts.

import * as THREE from 'three';
import { PRISM_TERRACE } from '../../sim/content/drowned_temple_layout';
import { sharedUniforms } from '../gfx';
import { templeGateOpenness } from './temple_gates';
import { MOON_COLUMN, POOL_WATER, PRISM_TOWER, templeHash } from './temple_plan_core';

function fogUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// ---- the silver column -----------------------------------------------------------------

const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const COLUMN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewV;
uniform float uTime;
uniform float uLayer;
${NOISE}
void main() {
  // Brightest on the axis (the rim of the cylinder fades), bands of moonlight
  // climbing it, fading high into the sky.
  float axis = pow(max(0.0, dot(vNormalV, vViewV)), 1.6);
  float bands = noise(vec2(vUv.x * 10.0 + uLayer * 3.0, vUv.y * 22.0 - uTime * (0.6 + uLayer * 0.3)));
  float fadeUp = smoothstep(1.0, 0.25, vUv.y) * smoothstep(0.0, 0.02, vUv.y);
  float a = axis * (0.45 + 0.55 * bands) * fadeUp * (uLayer < 0.5 ? 1.1 : 0.45);
  vec3 col = mix(vec3(0.72, 0.8, 1.0), vec3(1.0), bands * axis);
  gl_FragColor = vec4(col * a, a);
}
`;

function buildMoonColumn(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'drownedTempleMoonColumn';
  const layers = lowGfx ? [1] : [1, 2.4];
  layers.forEach((scale, i) => {
    const geo = new THREE.CylinderGeometry(
      MOON_COLUMN.radius * scale,
      MOON_COLUMN.radius * scale * 0.8,
      MOON_COLUMN.height,
      24,
      1,
      true,
    ).translate(0, MOON_COLUMN.height / 2, 0);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        name: 'drownedTempleMoonColumn',
        vertexShader: COLUMN_VERT,
        fragmentShader: COLUMN_FRAG,
        uniforms: { uTime: sharedUniforms.uTime, uLayer: { value: i } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(MOON_COLUMN.x, MOON_COLUMN.base, MOON_COLUMN.z);
    mesh.renderOrder = 10;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  // Motes of silver drifting up the column.
  const n = lowGfx ? 24 : 90;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    seeds.set(
      [
        templeHash(i, 3) * Math.PI * 2,
        templeHash(i, 5),
        0.02 + templeHash(i, 7) * 0.05,
        templeHash(i, 11),
      ],
      i * 4,
    );
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = n;
  const motes = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'drownedTempleColumnMotes',
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform float uRadius;
        uniform float uHeight;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vUv = uv;
          float life = fract(uTime * aSeed.z + aSeed.y);
          float a = aSeed.x + uTime * 0.3;
          vec3 c = vec3(sin(a) * uRadius * (0.6 + aSeed.w), life * uHeight, cos(a) * uRadius * (0.6 + aSeed.w));
          vFade = smoothstep(0.0, 0.05, life) * (1.0 - life);
          vec4 mv = modelViewMatrix * vec4(c, 1.0);
          mv.xy += position.xy * (0.5 + aSeed.w * 0.7);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d) * vFade;
          gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * a, a);
        }`,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uRadius: { value: MOON_COLUMN.radius * 1.6 },
        uHeight: { value: 70 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  motes.position.set(MOON_COLUMN.x, MOON_COLUMN.base, MOON_COLUMN.z);
  motes.frustumCulled = false;
  motes.renderOrder = 10;
  group.add(motes);
  return group;
}

// ---- the Hydra Pool's moon water -------------------------------------------------------

const POOL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vWorld;
uniform float uTime;
uniform float uDrain;
#include <fog_pars_fragment>
${NOISE}
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q) * 2.0;
  float a = atan(q.y, q.x);
  // Draining: the water turns into a whirl round the centre.
  float swirl = a + uDrain * (3.0 / (r + 0.2)) + uTime * uDrain * 2.0;
  float n = noise(vec2(swirl * 2.0, r * 6.0 - uTime * 0.4)) * 0.6 + noise(vWorld.xz * 0.8 + uTime * 0.3) * 0.4;
  vec3 deep = vec3(0.03, 0.12, 0.18);
  vec3 glow = vec3(0.35, 0.85, 0.9);
  vec3 col = mix(deep, glow, smoothstep(0.55, 0.95, n) * 0.6 + smoothstep(1.0, 0.0, r) * 0.25);
  // The moon's disc in the pool, bobbing.
  float moon = smoothstep(0.25, 0.2, length(q - vec2(0.05 * sin(uTime * 0.3), -0.1)));
  col += vec3(0.7, 0.78, 1.0) * moon * (0.5 + 0.5 * n) * (1.0 - uDrain);
  float rim = smoothstep(1.0, 0.9, r);
  gl_FragColor = vec4(col, rim * (0.92 - uDrain * 0.5));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

const POOL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

function buildHydraPool(ox: number, oz: number, lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'drownedTempleHydraPool';
  const uDrain = { value: 0 };
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(POOL_WATER.r + 0.3, 48).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      name: 'drownedTemplePoolWater',
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime, uDrain },
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  water.position.set(POOL_WATER.x, POOL_WATER.y, POOL_WATER.z);
  water.renderOrder = 2;
  water.onBeforeRender = () => {
    const drain = templeGateOpenness(ox, oz, 'prism_stair_rise');
    uDrain.value = drain;
    water.position.y = POOL_WATER.y - drain * 0.5;
  };
  group.add(water);
  // Steam rising off the moon pool.
  const n = lowGfx ? 10 : 34;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.getAttribute('position'));
  geo.setAttribute('uv', base.getAttribute('uv'));
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = templeHash(i, 13) * Math.PI * 2;
    const r = Math.sqrt(templeHash(i, 17)) * POOL_WATER.r * 0.9;
    seeds.set(
      [Math.sin(a) * r, Math.cos(a) * r, templeHash(i, 19), 0.05 + templeHash(i, 23) * 0.06],
      i * 4,
    );
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = n;
  const steam = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'drownedTemplePoolSteam',
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        varying vec2 vUv;
        varying float vLife;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          float life = fract(uTime * aSeed.w + aSeed.z);
          vLife = life;
          vec3 c = vec3(aSeed.x + sin(uTime * 0.4 + aSeed.z * 9.0) * life * 2.0, life * 9.0, aSeed.y);
          vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
          mvPosition.xy += position.xy * (2.5 + life * 6.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        varying float vLife;
        #include <fog_pars_fragment>
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.1, d) * smoothstep(0.0, 0.2, vLife) * (1.0 - vLife) * 0.22;
          gl_FragColor = vec4(vec3(0.75, 0.86, 0.95), a);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }`,
      uniforms: { ...fogUniforms(), uTime: sharedUniforms.uTime },
      transparent: true,
      depthWrite: false,
      fog: true,
    }),
  );
  steam.position.set(POOL_WATER.x, POOL_WATER.y, POOL_WATER.z);
  steam.frustumCulled = false;
  steam.renderOrder = 8;
  group.add(steam);
  return group;
}

// ---- the Prism Tower's beam ------------------------------------------------------------

function buildPrismBeam(): THREE.Mesh {
  const from = new THREE.Vector3(PRISM_TOWER.x, 48, PRISM_TOWER.z);
  const to = new THREE.Vector3(PRISM_TERRACE.x, PRISM_TERRACE.h + 0.5, PRISM_TERRACE.z + 2);
  const len = from.distanceTo(to);
  const geo = new THREE.CylinderGeometry(0.35, 2.4, len, 12, 1, true).translate(0, -len / 2, 0);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      name: 'drownedTemplePrismBeam',
      vertexShader: COLUMN_VERT,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        varying vec3 vNormalV;
        varying vec3 vViewV;
        uniform float uTime;
        ${NOISE}
        void main() {
          float axis = pow(max(0.0, dot(vNormalV, vViewV)), 2.0);
          float n = noise(vec2(vUv.x * 8.0, vUv.y * 14.0 + uTime * 1.2));
          float a = axis * (0.25 + 0.35 * n) * (0.7 + 0.3 * sin(uTime * 1.7));
          gl_FragColor = vec4(vec3(0.73, 0.65, 1.0) * a, a);
        }`,
      uniforms: { uTime: sharedUniforms.uTime },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  mesh.position.copy(from);
  // Point the cylinder's -Y (its far end) at the terrace.
  const dir = to.clone().sub(from).normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.name = 'drownedTemplePrismBeam';
  return mesh;
}

/** Every light landmark of one slot, instance-local. */
export function buildTempleLandmarks(ox: number, oz: number, lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'drownedTempleLandmarks';
  group.add(buildMoonColumn(lowGfx));
  group.add(buildHydraPool(ox, oz, lowGfx));
  group.add(buildPrismBeam());
  return group;
}

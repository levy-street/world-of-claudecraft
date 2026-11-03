// The Storm Cornice's open sky (plan: breath_summit_core.ts): the cloud sea
// far under the summit (two decks of slow cloud, lit pale on their tops and
// cool blue-violet in their troughs, never a hard edge: thinning to the sky
// at their rim and with distance) and the far peaks standing out of it (the
// rock kit's needles, instanced once that kit has landed). Built with the
// interior (the compile gate links its program); no light, no texture; the
// sea's motion runs in its shader on the shared clock.

import * as THREE from 'three';
import { sharedUniforms } from '../gfx';
import { BREATH_WIND } from './breath_air_core';
import { BREATH_CLOUD_SEA, planBreathFarPeaks } from './breath_summit_core';
import {
  heartKitLoaded,
  instanceHeartKit,
  SMITH_HEART_ROCK_KIT_URL,
  upgradeWhenHeartKitLands,
} from './heart_kit';

const SEA_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vRect;
void main() {
  vRect = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SEA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSky;
uniform float uScale;
uniform float uDrift;
uniform float uAlpha;
varying vec3 vWorld;
varying vec2 vRect;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * n(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
void main() {
  vec2 p = vWorld.xz * uScale - uWind * uTime * uDrift;
  // Billows: a broad swell under a finer lumpy crown, the troughs between.
  float broad = fbm(p * 0.6 + 3.1);
  float fine = fbm(p * 2.2 - broad * 1.3);
  float c = broad * 0.65 + fine * 0.45;
  float cover = smoothstep(0.38, 0.72, c);
  // Lit tops, cool blue-violet troughs (warm key, cool shadow), never black.
  vec3 col = mix(uShade, uLit, smoothstep(0.42, 0.85, c + fine * 0.2));
  // Into the sky with distance: no horizon line.
  float dist = length(vWorld.xz - cameraPosition.xz);
  float far = smoothstep(140.0, 520.0, dist);
  col = mix(col, uSky, far * 0.85);
  // Thinning to nothing at the deck's rim.
  float rim = smoothstep(0.0, 0.14, vRect.x) * smoothstep(0.0, 0.14, 1.0 - vRect.x)
            * smoothstep(0.0, 0.1, vRect.y) * smoothstep(0.0, 0.18, 1.0 - vRect.y);
  float a = mix(0.35, 1.0, cover) * rim * uAlpha * (1.0 - far * 0.35);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** The Cornice's open sky, instance-local. */
export function buildBreathSummit(lowGfx: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'smithHeartBreathSummit';
  for (const [i, d] of BREATH_CLOUD_SEA.entries()) {
    const geo = new THREE.PlaneGeometry(d.x1 - d.x0, d.z1 - d.z0, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathCloudSea',
      uniforms: {
        uTime: sharedUniforms.uTime,
        uWind: { value: new THREE.Vector2(BREATH_WIND[0], BREATH_WIND[1]) },
        uLit: { value: new THREE.Color(i === 0 ? 0xeef1f4 : 0xd9dfe6) },
        uShade: { value: new THREE.Color(i === 0 ? 0x8c93a8 : 0x767d94) },
        uSky: { value: new THREE.Color(0xb9c2cc) },
        uScale: { value: d.scale },
        uDrift: { value: d.drift / d.scale },
        uAlpha: { value: d.alpha },
      },
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `smithHeartBreathCloudSea${i}`;
    mesh.position.set((d.x0 + d.x1) / 2, d.y, (d.z0 + d.z1) / 2);
    // The lower deck first: the upper one draws over it.
    mesh.renderOrder = 1 - i;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const peaks = (): THREE.Group =>
    instanceHeartKit(
      SMITH_HEART_ROCK_KIT_URL,
      planBreathFarPeaks(),
      lowGfx,
      'smithHeartBreathFarPeaks',
      1000,
      'rock',
    );
  if (heartKitLoaded(SMITH_HEART_ROCK_KIT_URL)) group.add(peaks());
  else {
    const wait = new THREE.Group();
    wait.name = 'smithHeartBreathFarPeaksWaiting';
    group.add(wait);
    upgradeWhenHeartKitLands(SMITH_HEART_ROCK_KIT_URL, wait, peaks);
  }
  return group;
}

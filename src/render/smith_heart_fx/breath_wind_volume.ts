// The Guardian of the Breath's body volume, a part of BreathBody: a fixed pool
// of soft billows of storm air placed along its currents (the trunk and the
// tail, the arms, the shoulders, the head), each a camera-facing cloud set a
// little behind the pieces so the armor always reads in front of it. They are
// what makes it a solid colossus at gameplay distance on the pale Cornice:
// a dark blue-grey body shaded away from the light, a bright cyan-white rim
// on the lit side (both values: the pale floor and sky need the dark as much
// as the bright), torn by rolling noise at the edge. Through the storm the
// same billows turn near-black deep blue, their rims lit by the lightning.
//
// Cosmetic (src/render/CLAUDE.md): the low tier draws fewer (instance count);
// nothing here is information a player acts on. The material is built by the
// owner with its root before the gated attach; fixed buffers written in place
// each frame (only the drawn instances upload), no light.

import * as THREE from 'three';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';

const VOLUME_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec4 aCenter; // xyz, size (yards)
attribute vec2 aLook; // alpha, seed
uniform float uBack;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
void main() {
  vUv = position.xy + 0.5;
  vAlpha = aLook.x;
  vSeed = aLook.y;
  if (aLook.x <= 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // A billow the camera stands in fades out (no screen-filling layers at melee).
  float near = distance(cameraPosition, aCenter.xyz) / max(aCenter.w, 1e-3);
  vAlpha *= smoothstep(0.6, 1.4, near);
  // Faded out: collapse it (never rasterize an invisible screen-filling quad).
  if (vAlpha <= 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 toCam = normalize(cameraPosition - aCenter.xyz);
  vec3 c = aCenter.xyz - toCam * uBack * aCenter.w;
  vec3 w = c + (right * position.x + up * position.y) * aCenter.w;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const VOLUME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uStorm;
uniform float uFlash;
uniform vec3 uWind;
uniform vec3 uEdge;
uniform vec3 uShade;
uniform vec3 uStormBody;
uniform vec3 uStormEdge;
uniform vec3 uStormShade;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.03 + 1.7) * 0.3 + vnoise(p * 4.01 + 3.1) * 0.15;
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float s = vSeed * 37.0;
  float t = uTime * (0.18 + 0.12 * uFlow);
  // A rolling, torn billow: its edge eaten by noise turning round its middle.
  float ang = t * (vSeed > 0.5 ? 1.0 : -1.0);
  vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  float n = fbm(q * 1.7 + vec2(s, s * 0.6));
  float n2 = fbm(q * 3.3 + vec2(-t * 1.6, s));
  float r = length(p) + (n - 0.5) * 0.55;
  // A thick, near-opaque core with a soft torn edge (painted cloud).
  float shape = 1.0 - smoothstep(0.55, 0.98, r);
  if (shape <= 0.0) discard;
  // Lit from above and to the side: a bright cyan-white rim there, the body
  // shaded dark blue-grey away from it.
  float lit = clamp(0.5 + 0.55 * dot(normalize(p + vec2(0.0001)), normalize(vec2(-0.45, 0.9))), 0.0, 1.0);
  float rim = smoothstep(0.45, 0.85, r) * lit;
  vec3 col = mix(uShade, uWind, clamp(lit * 0.65 + n2 * 0.3 - 0.1, 0.0, 1.0));
  col = mix(col, uEdge, clamp(rim * (0.6 + 0.6 * n2), 0.0, 1.0));
  // The storm: near-black deep blue, the rim lit by the lightning.
  vec3 sc = mix(uStormShade, uStormBody, clamp(lit * 0.6 + n2 * 0.3, 0.0, 1.0));
  sc = mix(sc, uStormEdge, clamp(rim * (0.25 + 0.9 * uFlash), 0.0, 1.0));
  col = mix(col, sc, uStorm);
  float a = vAlpha * shape * (0.88 + 0.12 * n);
  // Capped under opaque: the billows draw in one unsorted instanced call, so
  // an overlap out of order still blends instead of painting over.
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
}
`;

export class BreathWindVolume {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly center: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;

  constructor(
    readonly capacity: number,
    uniforms: Record<string, { value: unknown }>,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.center = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(
      THREE.DynamicDrawUsage,
    );
    geo.setAttribute('aCenter', this.center);
    geo.setAttribute('aLook', this.look);
    geo.instanceCount = 0;
    this.geo = geo;
    geometries.push(geo, quad);
    this.material = new THREE.ShaderMaterial({
      name: 'smithHeartBreathVolume',
      uniforms: { ...uniforms, uBack: { value: 0.35 } },
      vertexShader: VOLUME_VERT,
      fragmentShader: VOLUME_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    materials.push(this.material);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'smithHeartBreathVolume';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Write billow `i`: its centre, size (yards), alpha and seed. */
  set(i: number, x: number, y: number, z: number, size: number, alpha: number, seed: number): void {
    this.center.setXYZW(i, x, y, z, size);
    this.look.setXY(i, alpha, seed);
  }

  /** Upload this frame's writes; `used` billows draw. */
  commit(used: number): void {
    const n = Math.max(0, Math.min(this.capacity, used));
    if (n > 0) {
      this.center.clearUpdateRanges();
      this.center.addUpdateRange(0, n * 4);
      this.center.needsUpdate = true;
      this.look.clearUpdateRanges();
      this.look.addUpdateRange(0, n * 2);
      this.look.needsUpdate = true;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
  }
}

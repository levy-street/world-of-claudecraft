// The Falling Rock's soak, made to read from across the Quarry (plan:
// council_fx_core.ts soakCountdown, rockFall; docs/design/raid/smith_heart.md
// 5.18), a part of CouncilFx over its floor-telegraph footprint (the gold disc
// filling at the soak's own radius, every tier):
//   - a thick bright rim at the soak's edge cut into one segment per second of
//     the mark, each going dark as its second runs out (the countdown), a
//     bright head sweeping round to the end;
//   - a beacon of gold light standing over the marked player, burning hotter to
//     the end (the raid finds the soak from anywhere on the floor);
//   - the rock's shadow on the floor growing and darkening as it comes down.
// The rim and its countdown draw on every tier (they are the mechanic's own
// time); the beacon and the shadow too (cheap, one mesh each). Built in the
// constructor under the host's root (one gated attach), fixed pools, no light.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  COUNCIL_FX_COLORS as C,
  COUNCIL_FX_POOLS as POOLS,
  soakCountdown,
} from './council_fx_core';

const RIM_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The countdown rim: \`uSegments\` arcs, the ones still to run bright, the
 *  spent ones dim, a head sweeping toward the end. */
const RIM_FRAG = /* glsl */ `
uniform float uLeft;
uniform float uSegments;
uniform float uAlpha;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vXZ;
void main() {
  float a = atan(vXZ.x, vXZ.y);
  float t = fract(a / 6.2831853 + 0.5);
  float local = fract(t * uSegments);
  float gap = smoothstep(0.03, 0.08, local) * (1.0 - smoothstep(0.92, 0.97, local));
  float live = step(t, uLeft);
  float head = 1.0 - smoothstep(0.0, 0.035, abs(t - uLeft));
  float pulse = 0.85 + 0.15 * sin(uTime * 9.0);
  vec3 col = uColor * mix(0.35, 1.6 * pulse, live) + vec3(1.0) * head * 0.9;
  float alpha = uAlpha * gap * mix(0.35, 1.0, live) + head * uAlpha;
  gl_FragColor = vec4(col, min(1.0, alpha));
  #include <colorspace_fragment>
}
`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BEAM_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float up = pow(1.0 - vUv.y, 1.5);
  float flow = 0.7 + 0.3 * sin(vUv.y * 22.0 - uTime * 6.0 + vUv.x * 18.85);
  gl_FragColor = vec4(uColor, uAlpha * up * flow * 0.5);
  #include <colorspace_fragment>
}
`;

const SHADOW_VERT = RIM_VERT;
const SHADOW_FRAG = /* glsl */ `
uniform float uAlpha;
varying vec2 vXZ;
void main() {
  float r = length(vXZ);
  float a = uAlpha * (1.0 - smoothstep(0.55, 1.0, r));
  gl_FragColor = vec4(0.04, 0.03, 0.03, a);
  #include <colorspace_fragment>
}
`;

interface Soak {
  rim: THREE.Mesh;
  rimMat: THREE.ShaderMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  shadow: THREE.Mesh;
  shadowMat: THREE.ShaderMaterial;
}

const _cd = { left: 0, beacon: 0, shadow: 0, dark: 0 };

export class CouncilSoakFx {
  private readonly soaks: Soak[] = [];

  constructor(
    root: THREE.Group,
    uTime: { value: number },
    geometries: THREE.BufferGeometry[],
    materials: THREE.Material[],
  ) {
    const rimGeo = new THREE.RingGeometry(0.85, 1.0, 96, 1).rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.75, 1.1, 1, 20, 1, true).translate(0, 0.5, 0);
    const discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    geometries.push(rimGeo, beamGeo, discGeo);
    for (let i = 0; i < POOLS.rocks; i++) {
      const rimMat = new THREE.ShaderMaterial({
        name: 'smithHeartSoakRim',
        uniforms: {
          uLeft: { value: 1 },
          uSegments: { value: 5 },
          uAlpha: { value: 0 },
          uTime: uTime,
          uColor: { value: new THREE.Color(C.soak) },
        },
        vertexShader: RIM_VERT,
        fragmentShader: RIM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.name = 'smithHeartSoakRim';
      rim.renderOrder = floorVfxRenderOrder('encounter', 27);
      const beamMat = new THREE.ShaderMaterial({
        name: 'smithHeartSoakBeacon',
        uniforms: {
          uAlpha: { value: 0 },
          uTime: uTime,
          uColor: { value: new THREE.Color(0xffd36a) },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.name = 'smithHeartSoakBeacon';
      const shadowMat = new THREE.ShaderMaterial({
        name: 'smithHeartSoakShadow',
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        transparent: true,
        depthWrite: false,
      });
      const shadow = new THREE.Mesh(discGeo, shadowMat);
      shadow.name = 'smithHeartSoakShadow';
      shadow.renderOrder = floorVfxRenderOrder('encounter', 26);
      for (const m of [rim, beam, shadow]) {
        m.visible = false;
        m.frustumCulled = false;
        root.add(m);
      }
      materials.push(rimMat, beamMat, shadowMat);
      this.soaks.push({ rim, rimMat, beam, beamMat, shadow, shadowMat });
    }
  }

  /** Soak `i` round its player at (x, y, z): its radius, the mark's time
   *  left of its duration. */
  paint(
    i: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    remaining: number,
    duration: number,
  ): void {
    const s = this.soaks[i];
    if (!s) return;
    soakCountdown(remaining, duration, _cd);
    s.rim.position.set(x, y + 0.12, z);
    s.rim.scale.setScalar(radius);
    s.rimMat.uniforms.uLeft.value = _cd.left;
    s.rimMat.uniforms.uSegments.value = Math.max(1, Math.round(duration));
    s.rimMat.uniforms.uAlpha.value = 0.95;
    s.beam.position.set(x, y, z);
    s.beam.scale.set(1, 26, 1);
    s.beamMat.uniforms.uAlpha.value = _cd.beacon;
    s.shadow.position.set(x, y + 0.08, z);
    s.shadow.scale.setScalar(radius * _cd.shadow);
    s.shadowMat.uniforms.uAlpha.value = _cd.dark;
    s.rim.visible = true;
    s.beam.visible = true;
    s.shadow.visible = true;
  }

  hide(i: number): void {
    const s = this.soaks[i];
    if (!s || !s.rim.visible) return;
    s.rim.visible = false;
    s.beam.visible = false;
    s.shadow.visible = false;
  }
}

// The Drowning Hymn's flood over the Beacon Crown (plan: bastion_boss_fx_core.ts
// crownFloodDepth / crownFloodAlpha / crownFloodKeep): murky sea water welling up between the
// Fogbeacon's foot and the parapet, rain-dimpled, fog-tinted like every other
// standing water of the fortress (bastion_water.ts), and spilling off the
// stair top instead of ending in a cliff of water.
//
// The sheet is one ring mesh built once (compile-gated with the rest of the
// boss visuals by BastionFx); each vertex carries the share of the depth it
// keeps (aKeep), so the surface slopes to the flags at the stair mouth while
// the whole roof holds the level. It sits on the standing-water order (0),
// under the floor VFX ladder, so every telegraph on the roof still paints over
// it (docs/design/vfx-floor-layering.md); its rim tucks under the parapet's
// body and stays under the embrasure sills, so the wall hides every edge.

import * as THREE from 'three';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { sharedUniforms } from '../gfx';
import { SUNKEN_BASTION_SUN_DIRECTION } from '../interior_light_rig';
import {
  CROWN_FLOOD_INNER,
  CROWN_FLOOD_OUTER,
  crownFloodAlpha,
  crownFloodDepth,
  crownFloodKeep,
  HYMN_FLOOD_LIFT,
} from './bastion_boss_fx_core';

const THETA_SEGMENTS = 144;
const RINGS = 16;

const FLOOD_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute float aKeep;
uniform float uDepth;
varying vec3 vWorld;
varying vec2 vLocal;
varying float vKeep;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  // The stair mouth's lip shallows to the flags (the share of depth it keeps).
  p.y -= (1.0 - aKeep) * uDepth;
  vKeep = aKeep;
  vLocal = position.xz;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = wocCamRelView(world.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FLOOD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uFill;
uniform float uOuter;
uniform vec3 uSunDir;
varying vec3 vWorld;
varying vec2 vLocal;
varying float vKeep;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Rain rings, as on the fortress's other standing water.
float rings(vec2 p) {
  vec2 cell = floor(p);
  float r = 0.0;
  for (int dx = -1; dx <= 1; dx++) {
    for (int dz = -1; dz <= 1; dz++) {
      vec2 c = cell + vec2(float(dx), float(dz));
      float h = hash(c);
      float beat = uTime * (0.6 + h * 0.5) + h;
      float cyc = floor(beat);
      float t = fract(beat);
      vec2 center = c + vec2(hash(c + 3.1 + cyc), hash(c + 7.7 - cyc));
      float live = step(0.62, hash(c + cyc * 1.37));
      float d = length(p - center);
      float grow = 1.0 - (1.0 - t) * (1.0 - t);
      r += smoothstep(0.035, 0.0, abs(d - grow * 0.8)) * (1.0 - t) * (1.0 - t) * live;
    }
  }
  return r;
}
void main() {
  vec2 p = vWorld.xz * 0.22;
  // Slow swell and churn of the drowning sea welling up.
  float n = noise(p + vec2(uTime * 0.3, -uTime * 0.21)) * 0.55
    + noise(p * 2.3 - vec2(uTime * 0.5, uTime * 0.37)) * 0.3
    + noise(p * 6.0 + uTime * 0.8) * 0.15;
  float rain = rings(vWorld.xz * 1.6);
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(max(1.0 - max(0.0, view.y), 0.0), 3.0);
  vec3 nrm = normalize(vec3((n - 0.5) * 0.35 + rain * 0.2, 1.0, (n - 0.5) * 0.25 + rain * 0.15));
  vec3 h = normalize(normalize(uSunDir) + view);
  float glint = pow(max(0.0, dot(nrm, h)), 90.0) * 0.55;
  // Dark drowning sea, never brighter than the wet flags it covers: the
  // storm sky only skims it at a grazing look.
  vec3 deep = vec3(0.018, 0.045, 0.042);
  vec3 murk = vec3(0.045, 0.1, 0.088);
  vec3 sky = vec3(0.2, 0.25, 0.235);
  vec3 col = mix(deep, murk, n);
  col = mix(col, sky, 0.06 + fres * 0.38);
  col += vec3(1.0, 0.92, 0.78) * glint + rain * 0.07;
  // Foam where the water laps the parapet and where it thins over the lip.
  float r = length(vLocal) / uOuter;
  float lap = smoothstep(0.955, 0.995, r) * (0.55 + 0.45 * noise(vLocal * 1.7 + uTime * 0.6));
  float thin = (1.0 - vKeep) * (0.6 + 0.4 * noise(vLocal * 2.4 - uTime * 1.3));
  col = mix(col, vec3(0.62, 0.72, 0.68), (lap + thin) * 0.45);
  // A wet sheen while it is shallow, murky sea once it has risen; thinner
  // still over the stair's lip.
  float body = mix(0.42, 0.92, uFill) * mix(0.45, 1.0, vKeep);
  gl_FragColor = vec4(col, uAlpha * body * (0.8 + 0.2 * fres));
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

/** The Beacon Crown's flood sheet. */
export class BastionCrownFlood {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.BufferGeometry;

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.RingGeometry(
      CROWN_FLOOD_INNER,
      CROWN_FLOOD_OUTER,
      THETA_SEGMENTS,
      RINGS,
    ).rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    const keep = new Float32Array(pos.count);
    // RingGeometry's (x, y) became (x, -z): crown-local x is +x, z is +z.
    for (let i = 0; i < pos.count; i++) keep[i] = crownFloodKeep(pos.getX(i), pos.getZ(i));
    geo.setAttribute('aKeep', new THREE.BufferAttribute(keep, 1));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      name: 'sunkenBastionCrownFlood',
      vertexShader: FLOOD_VERT,
      fragmentShader: FLOOD_FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: sharedUniforms.uTime,
        uAlpha: { value: 0 },
        uFill: { value: 0 },
        uDepth: { value: 0 },
        uOuter: { value: CROWN_FLOOD_OUTER },
        uSunDir: { value: SUNKEN_BASTION_SUN_DIRECTION.clone() },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'sunkenBastionCrownFlood';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    // The standing-water order: under the whole floor VFX ladder.
    this.mesh.renderOrder = 0;
    parent.add(this.mesh);
  }

  /**
   * Show the flood at `level` (0 dry to 1 full) over the crown centred on
   * (cx, cz) whose flags stand at `floor`, or hide it (level 0 or no crown).
   * Returns the surface height over the roof (-Infinity when dry), for the
   * pieces that float on it (the beam's pool, the reveal's shadow).
   */
  update(level: number, cx: number, cz: number, floor: number): number {
    const alpha = crownFloodAlpha(level);
    if (alpha <= 0.004 || !Number.isFinite(floor)) return this.hide();
    const depth = crownFloodDepth(level);
    const top = floor + HYMN_FLOOD_LIFT + depth;
    this.mesh.visible = true;
    this.mesh.position.set(cx, top, cz);
    this.mat.uniforms.uAlpha.value = alpha;
    this.mat.uniforms.uFill.value = Math.min(1, Math.max(0, level));
    this.mat.uniforms.uDepth.value = depth;
    return top;
  }

  /** The crown is dry (or out of view): hide the sheet. */
  hide(): number {
    this.mesh.visible = false;
    return -Infinity;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

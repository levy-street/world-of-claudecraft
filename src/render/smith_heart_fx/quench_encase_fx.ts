// Encased in Rime, the Guardian of the Quench's freeze drawn on the frozen
// (plan: quench_frost_fx_core.ts encaseLook, encaseVertex; owned by
// QuenchFrostFx, which hands it the frozen and when each froze). A faceted
// crystal of lake ice closed round the body (taller than wide, a crystal
// crown), deep glacier blue in its heart with a frost fog inside, its facets
// catching the light, cracks of white light spreading across it as the
// shatter nears, and the countdown burning in the ice itself: a band of cold
// fire sinking from its crown to its foot over the freeze, the ice above it
// lit and throbbing faster to the end. On every tier (a frozen ally is
// actionable). The rime spikes round its foot and the shatter's chunks are
// QuenchFrostFx's.
//
// Rules (src/render/CLAUDE.md): built in the constructor under the fight's
// gated root, a fixed pool, no per-frame allocation, no light.

import * as THREE from 'three';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { QUENCH_FIGHT_COLORS as C, fightHash } from './quench_fight_fx_core';
import { type EncaseLook, encaseLook, encaseVertex } from './quench_frost_fx_core';

/** Encasements at once (a raid and room to spare). */
const POOL = 10;
/** The crystal's height scale: its unit icosphere (about 2.6 tall once
 *  shaped) over a 2.6 yd player rig with room above the crown. */
const SCALE_Y = 1.3;
/** Its middle above the ice. */
const MID_Y = 1.5;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _look: EncaseLook = { grow: 0, crack: 0, countdown: 0, beat: 0 };
const _p = { x: 0, y: 0, z: 0 };

const ENCASE_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
attribute vec4 aEncase;
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec4 vE;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vL = position;
  vE = aEncase;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const ENCASE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uIce;
uniform vec3 uDeep;
uniform vec3 uLight;
uniform vec3 uHot;
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec4 vE;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
vec2 h2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float n3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
// Voronoi round the crystal (angle, height): the gap to the nearest cell
// edge, and that cell's hash (which cracks have opened).
vec2 web(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = h2(i + g);
      float d = length(g + o - f);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = o.x;
      } else if (d < d2) {
        d2 = d;
      }
    }
  return vec2(d2 - d1, id);
}
void main() {
  float grow = vE.x;
  float crack = vE.y;
  float cd = vE.z;
  float beat = vE.w;
  // 0 at the foot, 1 at the crown: the crystal closes from the ice up.
  float hy = clamp((vL.y + 1.2) / 2.6, 0.0, 1.0);
  if (hy > grow * 1.02) discard;
  vec3 n = normalize(vN);
  float fres = pow(1.0 - abs(dot(n, normalize(vV))), 1.8);
  float facet = h3(floor(n * 5.0 + 0.5));
  // The frost fog inside, thickest in the heart, drifting up.
  float fog = (1.0 - fres) * (0.45 + 0.4 * n3(vL * 2.4 + vec3(0.0, -uTime * 0.3, 0.0)));
  // Cracks spreading: each cell edge opens once the crack passes its hash.
  vec2 w = web(vec2(atan(vL.z, vL.x) * 1.9, vL.y * 2.6));
  float open = step(w.y, crack * 1.1);
  float cracks = (1.0 - smoothstep(0.0, 0.03 + 0.05 * crack, w.x)) * open;
  // The countdown: a band of cold fire sinking from the crown to the foot.
  float level = 1.0 - cd;
  float band = 1.0 - smoothstep(0.0, 0.07, abs(hy - level));
  float spent = smoothstep(level - 0.02, level + 0.02, hy);
  // The time left glows in the ice below the band: deep blue lit from
  // within, throbbing; the spent ice above it has gone pale and frosted. So
  // the crystal drains like an hourglass as the shatter nears.
  vec3 pale = mix(uDeep, uIce, 0.38 + 0.42 * fres + 0.16 * facet);
  pale = mix(pale, uIce * 1.05, fog * 0.65);
  vec3 left = mix(uDeep * 0.42, uDeep * 1.1, fres + 0.2 * facet) + uHot * (0.08 + 0.16 * beat) * (1.0 - fres);
  vec3 col = mix(left, pale, spent);
  col += uLight * cracks * (1.6 + 2.0 * crack);
  col += vec3(1.0) * band * (1.2 + 1.0 * beat);
  // The deep ice holding the time left is near opaque (it reads over the
  // body's own frost); the spent ice above it clears to a frosted glass.
  float alpha = mix(0.84 + 0.12 * fres, 0.6 + 0.3 * fres + 0.25 * fog + 0.06 * facet, spent);
  alpha = max(alpha, max(cracks, band));
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.97));
  #include <colorspace_fragment>
}
`;

export class QuenchEncaseFx {
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly attr: THREE.InstancedBufferAttribute;

  constructor(
    root: THREE.Group,
    uTime: { value: number },
    private readonly groundY: (x: number, z: number) => number,
  ) {
    const geo = new THREE.IcosahedronGeometry(1, 2).toNonIndexed();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      encaseVertex(pos.getX(i), pos.getY(i), pos.getZ(i), _p);
      pos.setXYZ(i, _p.x, _p.y, _p.z);
    }
    geo.computeVertexNormals();
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aEncase', this.attr);
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchEncasement',
      uniforms: {
        uTime,
        uIce: { value: new THREE.Color(...C.frost) },
        uDeep: { value: new THREE.Color(...C.frostDeep) },
        uLight: { value: new THREE.Color(...C.crackLight) },
        uHot: { value: new THREE.Color(0.55, 0.9, 1.0) },
      },
      vertexShader: ENCASE_VERT,
      fragmentShader: ENCASE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, this.material, POOL);
    mesh.name = 'smithHeartQuenchEncasements';
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < POOL; i++) mesh.setMatrixAt(i, _zero);
    mesh.visible = false;
    // Drawn after the body's own frozen frost (a transparent shell of its
    // own), so the crystal's deep ice reads over it.
    mesh.renderOrder = 4;
    root.add(mesh);
    this.mesh = mesh;
  }

  /** One crystal round each frozen body. */
  frame(
    world: IWorld,
    frozenIds: readonly number[],
    frozenSince: ReadonlyMap<number, number>,
    clock: number,
  ): void {
    const arr = this.attr.array as Float32Array;
    let n = 0;
    for (const id of frozenIds) {
      if (n >= POOL) break;
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const at = fxAnchor(e);
      const look = encaseLook(clock - (frozenSince.get(id) ?? clock), clock, _look);
      _v.set(at.x, this.groundY(at.x, at.z) + MID_Y, at.z);
      _e.set(0, e.facing + (fightHash(id, 31) - 0.5) * 0.6, 0);
      _q.setFromEuler(_e);
      _s.set(1.32, SCALE_Y, 1.32);
      this.mesh.setMatrixAt(n, _m.compose(_v, _q, _s));
      arr[n * 4] = look.grow;
      arr[n * 4 + 1] = look.crack;
      arr[n * 4 + 2] = look.countdown;
      arr[n * 4 + 3] = look.beat;
      n++;
    }
    for (let i = n; i < POOL; i++) this.mesh.setMatrixAt(i, _zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
    this.mesh.visible = n > 0;
  }

  clear(): void {
    for (let i = 0; i < POOL; i++) this.mesh.setMatrixAt(i, _zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

// Mountain's Wrath's arena-wide floor (the plan: council_wrath_field_core.ts),
// a part of CouncilFx: through the Wrath's bar a faint lethal tint over the
// whole pit, swept out from the middle with the bar, its rim a crisp lethal
// line, lying UNDER every mark and the shelters' dark rings (so the safe floor
// is what stands out); at the blow a room-sized shockwave. One mesh, one
// draw, built in the host's constructor under its gated root, draped once per
// claim (the pit never moves), no light, no allocation a frame.

import * as THREE from 'three';
import { HAMMER_PIT } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { CouncilFxHost } from './council_pillars_fx';
import {
  WRATH_FIELD as W,
  type WrathFieldLook,
  wrathFieldLook,
  wrathFieldPoint,
} from './council_wrath_field_core';

const VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
attribute vec2 aUv;
varying vec2 vUv;
varying vec2 vXZ;
void main() {
  vUv = aUv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;
const FRAG = /* glsl */ `
uniform float uFront;
uniform float uTint;
uniform float uEdge;
uniform float uDrift;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying vec2 vXZ;
void main() {
  float r = vUv.y;
  float rw = fwidth(r) * 1.5 + 0.004;
  float edge = smoothstep(0.955 - rw, 0.965, r) * (1.0 - smoothstep(1.0 - rw, 1.0, r));
  float behind = 1.0 - smoothstep(uFront - 0.02, uFront, r);
  float front = (1.0 - smoothstep(0.0, 0.025, abs(r - uFront))) * step(uFront, 0.999);
  float hatch = step(0.5, fract((vXZ.x - vXZ.y) * 0.16 + uTime * 0.25 * uDrift));
  float a = uTint * behind * (0.7 + 0.3 * hatch) + uEdge * edge + 0.3 * front;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * (1.0 + 0.4 * edge), min(1.0, a));
  #include <colorspace_fragment>
}
`;

const _look: WrathFieldLook = { front: 0, tint: 0, edge: 0, drift: 0 };
const _pt = { x: 0, z: 0 };

export class CouncilWrathField {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos: THREE.BufferAttribute;
  private placedX = Number.NaN;
  private placedZ = Number.NaN;
  private cx = 0;
  private cz = 0;

  constructor(private readonly h: CouncilFxHost) {
    const n = (W.rings + 1) * (W.around + 1);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let k = 0; k <= W.rings; k++)
      for (let a = 0; a <= W.around; a++) {
        const v = k * (W.around + 1) + a;
        uv[v * 2] = a / W.around;
        uv[v * 2 + 1] = k / W.rings;
        if (k < W.rings && a < W.around) {
          const up = v + W.around + 1;
          idx.push(v, up, v + 1, up, up + 1, v + 1);
        }
      }
    g.setAttribute('position', this.pos);
    g.setAttribute('aUv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      name: 'smithHeartWrathField',
      uniforms: {
        uFront: { value: 0 },
        uTint: { value: 0 },
        uEdge: { value: 0 },
        uDrift: { value: 1 },
        uTime: h.uTime,
        uColor: { value: new THREE.Color(W.color) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'smithHeartWrathField';
    // Under everything the council lays on the floor (the fury's burn at 9,
    // the shelters at 25, the marks above).
    this.mesh.renderOrder = floorVfxRenderOrder('encounter', 7);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    h.root.add(this.mesh);
    h.geometries.push(g);
    h.materials.push(this.mat);
  }

  /** Drape the field over this claim's pit (once per claim). */
  private place(me: { pos: { x: number; z: number } }): void {
    const def = DUNGEONS.smith_heart;
    if (!def) return;
    const o = instanceOrigin(def.index, instanceSlotForZ(me.pos.z));
    if (o.x === this.placedX && o.z === this.placedZ) return;
    this.placedX = o.x;
    this.placedZ = o.z;
    this.cx = o.x + HAMMER_PIT.x;
    this.cz = o.z + HAMMER_PIT.z;
    for (let k = 0; k <= W.rings; k++)
      for (let a = 0; a <= W.around; a++) {
        wrathFieldPoint(this.cx, this.cz, k / W.rings, a / W.around, _pt);
        this.pos.setXYZ(
          k * (W.around + 1) + a,
          _pt.x,
          this.h.groundY(_pt.x, _pt.z) + W.lift,
          _pt.z,
        );
      }
    this.pos.needsUpdate = true;
  }

  /** Through the Wrath's bar: `fill` 0 begun, 1 landing; `me` the local
   *  player (whose claim the pit is). */
  show(me: { pos: { x: number; z: number } }, fill: number): void {
    this.place(me);
    wrathFieldLook(fill, this.h.reducedMotion(), _look);
    const u = this.mat.uniforms;
    u.uFront.value = _look.front;
    u.uTint.value = _look.tint;
    u.uEdge.value = _look.edge;
    u.uDrift.value = _look.drift;
    this.mesh.visible = true;
  }

  hide(): void {
    if (this.mesh.visible) this.mesh.visible = false;
  }

  /** The Wrath landed: a room-sized wave from the middle out to the rim. */
  blow(): void {
    if (Number.isNaN(this.placedX)) return;
    this.h.particles.shockRing(
      this.cx,
      this.cz,
      W.color,
      Math.max(W.rx, W.rz),
      W.blowSeconds,
      W.blowLook,
    );
  }

  /** Showing (the tests read it). */
  shown(): boolean {
    return this.mesh.visible;
  }
}

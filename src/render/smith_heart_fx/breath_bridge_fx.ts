// The Wind Bridge's look (encounters/smith_heart/breath_bridge.ts; pure look:
// breath_bridge_fx_core.ts), a part of BreathIslesFx. Jose's call of
// 2026-11-25: a curved current of wind over the chasm that carries a body
// across, read as a magical jet stream, with real depth from any camera.
//
//  - on EVERY tier (the raid acts on it), along the SAME curve a rider is
//    carried on: a tunnel of fast-flowing wind streaks (its skin brighter at
//    the silhouette, so it reads round from any side), gust pulses racing
//    along it, a bright core of two crossed ribbons, strands of wind wound
//    round it, a swirling mouth at each end (a wheeling disc and a column),
//    and small cyan-white lightning arcs jumping along and around it;
//  - cosmetic (thinned on the low tier): motes streaming along it and
//    crackle sparks at the arcs;
//  - its form rides the bridge object's presence: it forms over
//    BRIDGE_TUNING.form seconds and dissolves over `dissolve` on the pull;
//    once gone nothing is drawn.
// The rider's own wind wrap is the isles' ride look (breath_ride_fx.ts,
// read off the shipped Riding the Gale aura).
//
// Built in the constructor under the host's local group (its one gated
// attach): fixed geometry but the arcs' small line buffer (rewritten a few
// times a second, no allocation), no light, no texture.

import * as THREE from 'three';
import { CORNICE_BRIDGE } from '../../sim/content/smith_heart_layout';
import { BRIDGE_OBJECT } from '../../sim/encounters/smith_heart/breath_bridge_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  BRIDGE_LOOK,
  bridgeArc,
  bridgeShown,
  bridgeStrand,
  bridgeStreamPath,
  stepBridgeForm,
} from './breath_bridge_fx_core';
import { CORNICE_FLOOR_H } from './breath_fight_fx_core';
import type { BreathIslesHost } from './breath_isles_fx';
import { ISLE_COLORS as C, ISLE_RGB as RGB } from './breath_isles_fx_core';
import {
  ISLE_COLUMN_FRAG,
  ISLE_DISC_FRAG,
  ISLE_RIBBON_FRAG,
  ISLE_UV_VERT,
} from './breath_isles_glsl';
import { ribbonGeometry } from './breath_ride_fx';

/** The tunnel: uv.x along, uv.y round; a view-facing rim term for depth. */
const TUBE_VERT = /* glsl */ `
varying vec2 vUv;
varying float vRim;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 v = normalize(cameraPosition - wp.xyz);
  vRim = 1.0 - abs(dot(n, v));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TUBE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uForm;
uniform vec3 uColor;
uniform vec3 uCore;
varying vec2 vUv;
varying float vRim;
float h21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
    mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // Fast streaks racing along, each lane its own pace.
  float lane = floor(vUv.y * 18.0);
  float pace = 2.2 + h21(vec2(lane, 3.0)) * 1.6;
  float streak = smoothstep(0.55, 0.95, vnoise(vec2(vUv.x * 26.0 - uTime * pace * 3.0, vUv.y * 18.0)));
  // Gust pulses: three bright bands racing mouth to mouth.
  float pulse = 0.0;
  for (int k = 0; k < 3; k++) {
    float at = fract(uTime * 0.55 + float(k) / 3.0);
    pulse += exp(-pow((vUv.x - at) * 14.0, 2.0));
  }
  // Born out of the mouths, round at the silhouette, thin face-on.
  float ends = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
  float body = mix(0.02, 0.42, pow(vRim, 2.2));
  float a = (body * (0.2 + streak * 1.2) + streak * 0.12 + pulse * 0.28 * (0.3 + vRim)) * ends * uForm;
  if (a < 0.01) discard;
  vec3 col = mix(uColor * 0.85, uCore, clamp(streak * 0.7 + pulse * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(col, min(0.9, a));
  #include <colorspace_fragment>
}
`;

/** A mouth's column height (yards): it reads from across the chasm. */
const COLUMN_H = 9;

export class BreathBridgeFx {
  private readonly group: THREE.Group;
  private readonly tube: THREE.ShaderMaterial;
  private readonly core: THREE.ShaderMaterial;
  private readonly strands: THREE.ShaderMaterial;
  private readonly discs: THREE.ShaderMaterial[] = [];
  private readonly columns: THREE.ShaderMaterial[] = [];
  private readonly arcGeo: THREE.BufferGeometry;
  private readonly arcPos: Float32Array;
  private readonly arcMat: THREE.LineBasicMaterial;
  private readonly path: { x: number; y: number; z: number }[];
  private seenId = -1;
  private found = -1;
  private form = 0;
  private arcClock = 0;
  private seed = 0x51a7;

  constructor(private readonly h: BreathIslesHost) {
    const L = BRIDGE_LOOK;
    this.path = bridgeStreamPath(CORNICE_FLOOR_H);
    this.group = new THREE.Group();
    this.group.name = 'smithHeartBreathWindBridge';
    this.group.visible = false;
    // The tunnel along the curve.
    const curve = new THREE.CatmullRomCurve3(
      this.path.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    );
    const tubeGeo = new THREE.TubeGeometry(curve, 96, L.radius, 14, false);
    this.tube = new THREE.ShaderMaterial({
      name: 'smithHeartBreathWindBridgeTube',
      uniforms: {
        uTime: h.uTime,
        uForm: { value: 0 },
        uColor: { value: new THREE.Color(C.path) },
        uCore: { value: new THREE.Color(C.pathCore) },
      },
      vertexShader: TUBE_VERT,
      fragmentShader: TUBE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const tubeMesh = new THREE.Mesh(tubeGeo, this.tube);
    tubeMesh.frustumCulled = false;
    this.group.add(tubeMesh);
    const ribbon = (name: string, glow: number, flow: number, dash: number, fade: number) =>
      new THREE.ShaderMaterial({
        name,
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(C.path) },
          uCore: { value: new THREE.Color(C.pathCore) },
          uGlow: { value: glow },
          uFlow: { value: flow },
          uDash: { value: dash },
          uFade: { value: fade },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_RIBBON_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
    // The bright core: two crossed ribbons racing along it.
    this.core = ribbon('smithHeartBreathWindBridgeCore', 0, 2.4, 10, 0.05);
    const geos: THREE.BufferGeometry[] = [tubeGeo];
    for (const upright of [false, true]) {
      const g = ribbonGeometry(this.path, 0.34, upright);
      geos.push(g);
      const m = new THREE.Mesh(g, this.core);
      m.frustumCulled = false;
      this.group.add(m);
    }
    // The strands wound round it.
    this.strands = ribbon('smithHeartBreathWindBridgeStrands', 0, 2.8, 14, 0.06);
    for (let k = 0; k < L.strands; k++) {
      const g = ribbonGeometry(bridgeStrand(this.path, k), 0.12, false);
      geos.push(g);
      const m = new THREE.Mesh(g, this.strands);
      m.frustumCulled = false;
      this.group.add(m);
    }
    // The two swirling mouths.
    const discGeo = new THREE.PlaneGeometry(1, 1);
    discGeo.rotateX(-Math.PI / 2);
    const colGeo = new THREE.CylinderGeometry(0.8, 1.15, 1, 28, 1, true);
    colGeo.translate(0, 0.5, 0);
    geos.push(discGeo, colGeo);
    const B = CORNICE_BRIDGE;
    for (const at of [B.landing, B.cornice]) {
      const disc = new THREE.ShaderMaterial({
        name: 'smithHeartBreathWindBridgeMouth',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(C.path) },
          uCore: { value: new THREE.Color(C.pathCore) },
          uGlow: { value: 0 },
          uOpen: { value: 0 },
          uSpin: { value: 1.4 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_DISC_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const dm = new THREE.Mesh(discGeo, disc);
      dm.scale.set(B.mouthR * 2.6, 1, B.mouthR * 2.6);
      dm.position.set(at.x, CORNICE_FLOOR_H + 0.08, at.z);
      dm.renderOrder = floorVfxRenderOrder('encounter', 18);
      this.group.add(dm);
      this.discs.push(disc);
      const column = new THREE.ShaderMaterial({
        name: 'smithHeartBreathWindBridgeColumn',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(C.path) },
          uGlow: { value: 0 },
          uOpen: { value: 0 },
        },
        vertexShader: ISLE_UV_VERT,
        fragmentShader: ISLE_COLUMN_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const cm = new THREE.Mesh(colGeo, column);
      cm.scale.set(B.mouthR, COLUMN_H, B.mouthR);
      cm.position.set(at.x, CORNICE_FLOOR_H + 0.08, at.z);
      this.group.add(cm);
      this.columns.push(column);
    }
    // The lightning: a few short jagged arcs, rewritten a few times a second.
    const segs = L.arcs * L.arcSegments;
    this.arcPos = new Float32Array(segs * 2 * 3);
    this.arcGeo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.arcPos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.arcGeo.setAttribute('position', attr);
    this.arcMat = new THREE.LineBasicMaterial({
      name: 'smithHeartBreathWindBridgeArcs',
      color: 0xe4fdff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const arcs = new THREE.LineSegments(this.arcGeo, this.arcMat);
    arcs.frustumCulled = false;
    this.group.add(arcs);
    geos.push(this.arcGeo);
    h.geometries.push(...geos);
    h.materials.push(
      this.tube,
      this.core,
      this.strands,
      ...this.discs,
      ...this.columns,
      this.arcMat,
    );
    h.local.add(this.group);
  }

  beginScan(): void {
    this.seenId = -1;
  }

  /** The bridge's object is this part's (true); a ride's carrier is too
   *  (the rider's look is the isles' ride, read off its aura). */
  takeObject(e: Entity): boolean {
    if (e.templateId === BRIDGE_OBJECT) {
      this.seenId = e.id;
      return true;
    }
    return e.templateId.startsWith(`${BRIDGE_OBJECT}_`);
  }

  endScan(_world: IWorld): void {
    this.found = this.seenId;
  }

  update(dt: number): void {
    this.form = stepBridgeForm(this.form, this.found >= 0, dt);
    const f = this.form;
    this.group.visible = bridgeShown(f);
    if (!this.group.visible) return;
    const t = this.h.uTime.value;
    const breathe = 0.85 + 0.15 * Math.sin(t * 1.7);
    this.tube.uniforms.uForm.value = f;
    this.core.uniforms.uGlow.value = 0.6 * f * breathe;
    this.strands.uniforms.uGlow.value = 1.1 * f;
    for (const d of this.discs) {
      d.uniforms.uOpen.value = f;
      d.uniforms.uGlow.value = f * breathe;
    }
    for (const c of this.columns) {
      c.uniforms.uOpen.value = f;
      c.uniforms.uGlow.value = 0.35 * f;
    }
    this.arcClock -= dt;
    if (this.arcClock <= 0) {
      this.arcClock = BRIDGE_LOOK.arcEvery;
      this.jumpArcs();
    }
    // The arcs flicker as they jump.
    this.arcMat.opacity = f * (0.55 + 0.45 * this.rand());
    this.motes(dt, f);
  }

  /** New arcs along and around the stream (a crackle spark at each). */
  private jumpArcs(): void {
    const L = BRIDGE_LOOK;
    const n = this.path.length - 1;
    const o = this.h.local.position;
    let w = 0;
    for (let a = 0; a < L.arcs; a++) {
      const i = Math.floor(this.rand() * n * 0.84 + n * 0.08);
      const pts = bridgeArc(this.path, i, this.rand() * Math.PI * 2, () => this.rand());
      for (let k = 0; k < pts.length - 1; k++) {
        const p = pts[k];
        const q = pts[k + 1];
        this.arcPos[w++] = p.x;
        this.arcPos[w++] = p.y;
        this.arcPos[w++] = p.z;
        this.arcPos[w++] = q.x;
        this.arcPos[w++] = q.y;
        this.arcPos[w++] = q.z;
      }
      if (this.rand() < 0.5 * this.h.density) {
        const m = pts[pts.length >> 1];
        this.h.particles.puff(o.x + m.x, o.y + m.y, o.z + m.z, 1, {
          speed: 1.2,
          life: 0.25,
          size: [0.35, 0.05],
          color: RGB.pathCore,
          alpha: 0.95,
          pool: 'glow',
        });
      }
    }
    (this.arcGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Motes streaming along the stream (cosmetic, by the density). */
  private motes(dt: number, f: number): void {
    if (this.rand() >= dt * 22 * this.h.density * f) return;
    const n = this.path.length - 1;
    const i = Math.min(n - 1, Math.floor(this.rand() * n));
    const a = this.path[i];
    const b = this.path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
    const s = 12 / len;
    const j = () => (this.rand() - 0.5) * BRIDGE_LOOK.radius * 1.4;
    const o = this.h.local.position;
    const dir = this.rand() < 0.5 ? 1 : -1;
    this.h.particles.puff(o.x + a.x + j(), o.y + a.y + j(), o.z + a.z + j(), 1, {
      speed: 0.3,
      life: 0.9,
      size: [0.3, 0.06],
      color: RGB.path,
      alpha: 0.85,
      pool: 'glow',
      dir: [(b.x - a.x) * s * dir, (b.y - a.y) * s * dir, (b.z - a.z) * s * dir],
      spread: 0.12,
      drag: 0.3,
    });
  }

  /** The claim is out of view: nothing stands. */
  leave(): void {
    this.found = -1;
    this.form = 0;
    this.group.visible = false;
  }

  private rand(): number {
    // A small LCG: cosmetic scatter, never the sim's.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}

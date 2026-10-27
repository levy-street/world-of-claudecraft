// The first wellspring and the overflow's rivers (plan: heat_fight_fx_core.ts
// wellLook, riverLook; docs/design/raid/smith_heart.md section 7.4), a part
// of HeatFightFx over its root, particles and floor telegraph kit:
//  - the pool: a molten wellspring at the claim object's spot and the sim's
//    own radius, flowing and boiling (white-gold under drifting plates of dark
//    crust, seams of light), a ring of hexagonal basalt stumps round its lip
//    with fire in their joints, a glow over it; whiter and boiling harder as
//    the fight deepens; heaving over its lip in slow swells while the Hearth
//    overflows;
//  - the rivers: each lane at its exact length and half width (the shared
//    floor telegraph, danger, every tier) filling over its warning, then a
//    river of the first flame racing out of the pool down it and burning,
//    flames licking off it.
// The pool, its lip and every river (lane and fire) draw on every tier; the
// embers, the haze, the bubbles and the flames thin on the low tier.
//
// Built in the constructor under the host's root (one gated attach), fixed
// pools, no per-frame allocation, no light.

import * as THREE from 'three';
import { HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import { floorReach } from '../../sim/encounters/smith_heart/heat_geometry';
import {
  HEAT_AURAS,
  type HeatWellState,
  HEAT_TUNING as T,
} from '../../sim/encounters/smith_heart/heat_ids';
import type { Entity } from '../../sim/types';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphLane,
  type TelegraphPaint,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { heartKitSlotMaterial } from '../smith_heart/heart_kit';
import {
  HEAT_FIGHT_COLORS as C,
  HEAT_WELL,
  HEAT_FIGHT_POOLS as P,
  type RiverLook,
  riverLook,
  riverOfCached,
  type WellLook,
  wellLook,
  wellOfCached,
} from './heat_fight_fx_core';
import { HEAT_FLOOR } from './heat_floor_ladder_core';
import type { HeatFxHost } from './heat_fx_host';
import { HEAT_LAVA_GLSL, HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { moltenDecal } from './heat_molten_decal';
import { basaltColumn } from './heat_shapes';

const LIP_STUMPS = 26;
const RIVER_STYLE = { color: TELEGRAPH_THREAT_COLORS.danger, accent: C.accent };
const PAINT: TelegraphPaint = { fill: 0, clock: 0, range: 0 };
const _well: WellLook = { heat: 0, surge: 0, boil: 0 };
const _river: RiverLook = { fill: 0, lane: false, front: 0, heat: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const EMBER = {
  speed: 0.8,
  up: 3.4,
  life: 1.6,
  size: [0.3, 0.06] as [number, number],
  color: C.ember,
  alpha: 1,
  pool: 'glow' as const,
  radius: 1,
};
const HAZE = {
  speed: 0.3,
  up: 2.2,
  life: 2,
  size: [3, 7] as [number, number],
  color: C.haze,
  alpha: 0.05,
  drag: 0.8,
  radius: 2,
};
const BUBBLE = {
  speed: 3,
  up: 3,
  life: 0.6,
  size: [0.45, 0.1] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  gravity: 9,
  radius: 0.4,
};
const SPILL_DIR: [number, number, number] = [0, 0.4, 0];
const SPILL = {
  speed: 3,
  life: 0.9,
  size: [0.8, 0.25] as [number, number],
  color: C.gold,
  alpha: 1,
  pool: 'glow' as const,
  dir: SPILL_DIR,
  spread: 0.3,
  gravity: 7,
};
const RIVER_FLAME = {
  speed: 0.6,
  up: 3.4,
  life: 0.6,
  size: [1.4, 0.3] as [number, number],
  color: C.gold,
  alpha: 0.9,
  pool: 'glow' as const,
  radius: 1,
};

const UV_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** The wellspring's molten pool: slow swirling flow under plates of crust,
 *  boiling whiter at its heart, a cooled skin at its lip. */
const POOL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform float uBoil;
uniform float uSurge;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  // A slow swirl round the guardian and out toward the lip.
  float a = atan(p.y, p.x);
  vec2 flow = vec2(cos(a + 1.3), sin(a + 1.3)) * 0.6 + p * 0.5;
  float lvl = lavaLevel(vW.xz, flow, uTime, 1.0);
  float heart = 1.0 - smoothstep(0.0, 0.75, r);
  float boil = smoothstep(0.7, 0.95, vn(vW.xz * 0.9 + vec2(uTime * 1.3, -uTime)) ) * uBoil;
  float m = lvl * (0.75 + 0.35 * heart) + boil * 0.5 + heart * 0.25;
  // The cooled skin at its lip, broken when it surges.
  float lip = smoothstep(0.82, 0.98, r) * (1.0 - uSurge * 0.8);
  m = mix(m, m * 0.35, lip);
  vec3 col = molten(clamp(m * uHeat, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
/** A river of the first flame racing down its lane out of the pool. */
const RIVER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFront;
uniform float uHeat;
uniform float uLen;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
${HEAT_MOLTEN_GLSL}
${HEAT_LAVA_GLSL}
void main() {
  float along = vUv.y;
  float across = abs(vUv.x - 0.5) * 2.0;
  float y = along * uLen;
  float rag = vn(vec2(y * 0.5, vUv.x * 4.0)) * 0.22;
  if (across > 1.0 - rag || along > uFront) discard;
  float lvl = lavaLevel(vec2(vUv.x * 6.0, y), vec2(0.0, 5.0), uTime, 1.1);
  float lead = smoothstep(uFront - 0.06, uFront, along) * step(uFront, 0.995);
  float m = clamp((lvl * 0.85 + 0.25 + lead * 0.5) * uHeat, 0.0, 1.0);
  vec3 col = molten(m);
  float alpha = (0.75 + 0.25 * uHeat) * (1.0 - smoothstep(0.7, 1.0, across + rag));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;
/** The glow ring along the pool's lip. */
const RIM_FRAG = /* glsl */ `
uniform float uHeat;
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
${HEAT_NOISE_GLSL}
void main() {
  float band = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float flick = 0.7 + 0.3 * vn(vec2(vUv.x * 40.0, uTime * 2.0));
  vec3 col = vec3(1.0, 0.7, 0.3) * uHeat * flick;
  gl_FragColor = vec4(col * band, band * 0.8);
  #include <colorspace_fragment>
}
`;

interface RiverSlot {
  id: number;
  born: number;
  state: 'warn' | 'flow' | null;
  facing: number;
  /** Its drawn length (to the floor's edge). */
  length: number;
  lane: TelegraphLane;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

export class HeatWellFx {
  private readonly pool: THREE.Mesh;
  private readonly poolMat: THREE.ShaderMaterial;
  private readonly lip: THREE.InstancedMesh;
  private readonly rim: THREE.Mesh;
  private readonly rimMat: THREE.ShaderMaterial;
  private readonly glow: THREE.Sprite;
  private readonly glowMat: THREE.SpriteMaterial;
  private readonly rivers: RiverSlot[] = [];
  private placedFor = -1;
  private state: HeatWellState = 'calm';
  private x = 0;
  private z = 0;
  private y = 0;
  private r: number = HEAT_WELL.r;

  constructor(private readonly host: HeatFxHost) {
    const g = host.geometries;
    const disc = new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2);
    // uv over the disc: (x, z) mapped to 0..1.
    const duv = disc.getAttribute('uv') as THREE.BufferAttribute;
    const dpos = disc.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < duv.count; i++)
      duv.setXY(i, dpos.getX(i) * 0.5 + 0.5, dpos.getZ(i) * 0.5 + 0.5);
    g.push(disc);
    this.poolMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatWellPool',
      uniforms: {
        uTime: host.uTime,
        uHeat: { value: 1 },
        uBoil: { value: 0.4 },
        uSurge: { value: 0 },
      },
      vertexShader: UV_VERT,
      fragmentShader: POOL_FRAG,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    host.materials.push(this.poolMat);
    this.pool = new THREE.Mesh(disc, this.poolMat);
    this.pool.name = 'smithHeartHeatWellPool';
    this.pool.frustumCulled = false;
    this.pool.visible = false;
    this.pool.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.wellPool.step);
    host.root.add(this.pool);

    // The lip: hexagonal basalt stumps, fire in their joints (the glow ring).
    const stump = basaltColumn(0.5, 1);
    g.push(stump);
    this.lip = new THREE.InstancedMesh(stump, heartKitSlotMaterial('stone'), LIP_STUMPS);
    this.lip.name = 'smithHeartHeatWellLip';
    this.lip.frustumCulled = false;
    this.lip.castShadow = true;
    this.lip.receiveShadow = true;
    this.lip.visible = false;
    host.root.add(this.lip);
    const ring = new THREE.RingGeometry(0.94, 1.06, 96, 1).rotateX(-Math.PI / 2);
    const ruv = ring.getAttribute('uv') as THREE.BufferAttribute;
    const rpos = ring.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < ruv.count; i++) {
      const rr = Math.hypot(rpos.getX(i), rpos.getZ(i));
      ruv.setXY(i, Math.atan2(rpos.getX(i), rpos.getZ(i)) / 6.2832 + 0.5, (rr - 0.94) / 0.12);
    }
    g.push(ring);
    this.rimMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatWellRim',
      uniforms: { uTime: host.uTime, uHeat: { value: 1 } },
      vertexShader: UV_VERT,
      fragmentShader: RIM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    host.materials.push(this.rimMat);
    this.rim = new THREE.Mesh(ring, this.rimMat);
    this.rim.name = 'smithHeartHeatWellRim';
    this.rim.frustumCulled = false;
    this.rim.visible = false;
    this.rim.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.wellRim.step);
    host.root.add(this.rim);
    this.glowMat = host.sprite(0xffc860, 'smithHeartHeatWellGlow');
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.name = 'smithHeartHeatWellGlow';
    this.glow.visible = false;
    host.root.add(this.glow);

    // The rivers.
    const ribbon = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    const buv = ribbon.getAttribute('uv') as THREE.BufferAttribute;
    const bpos = ribbon.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < buv.count; i++) buv.setY(i, bpos.getZ(i));
    g.push(ribbon);
    for (let i = 0; i < P.rivers; i++) {
      const lane = host.telegraphs.lane('river');
      lane.group.visible = false;
      // Char and glow passes: rivers meet at the lip and cross the lanes.
      const { mesh, mat } = moltenDecal(
        {
          name: 'smithHeartHeatRiver',
          geometry: ribbon,
          vertexShader: UV_VERT,
          fragmentShader: RIVER_FRAG,
          uniforms: {
            uTime: host.uTime,
            uFront: { value: 0 },
            uHeat: { value: 0 },
            uLen: { value: T.riverLength },
          },
          charStep: HEAT_FLOOR.riverChar.step,
          glowStep: HEAT_FLOOR.riverGlow.step,
        },
        host.materials,
      );
      host.root.add(mesh);
      this.rivers.push({ id: -1, born: 0, state: null, facing: 0, length: 1, lane, mesh, mat });
    }
  }

  /** Lay the pool and its lip at the well object's spot (once per object). */
  private place(e: Entity): void {
    this.placedFor = e.id;
    this.x = e.pos.x;
    this.z = e.pos.z;
    this.y = this.host.groundY(e.pos.x, e.pos.z);
    this.r = HEAT_WELL.r;
    this.pool.position.set(this.x, this.y + 0.08, this.z);
    this.pool.scale.set(this.r + 0.3, 1, this.r + 0.3);
    this.rim.position.set(this.x, this.y + 0.12, this.z);
    this.rim.scale.set(this.r + 0.3, 1, this.r + 0.3);
    for (let i = 0; i < LIP_STUMPS; i++) {
      const a = (i / LIP_STUMPS) * Math.PI * 2;
      const rr = this.r + 0.9 + 0.35 * Math.sin(i * 2.3);
      const h = 0.5 + 0.9 * ((Math.sin(i * 5.7) + 1) / 2);
      _v.set(this.x + Math.sin(a) * rr, this.y - 0.2, this.z + Math.cos(a) * rr);
      _q.setFromAxisAngle(_up, a + i);
      _s.set(2.1, h, 2.1);
      this.lip.setMatrixAt(i, _m.compose(_v, _q, _s));
    }
    this.lip.instanceMatrix.needsUpdate = true;
    this.pool.visible = true;
    this.lip.visible = true;
    this.rim.visible = true;
    this.glow.visible = true;
  }

  /** One frame: the pool (`wellId` its claim object, `guardian` for its
   *  phase) and the rivers (`riverIds`). */
  update(
    wellId: number,
    guardian: Entity | null,
    riverIds: readonly number[],
    clock: number,
    dt: number,
  ): void {
    const world = this.host.world;
    if (!world) return;
    const w = wellId >= 0 ? world.entities.get(wellId) : undefined;
    if (!w) {
      this.hide();
      return;
    }
    if (this.placedFor !== w.id) this.place(w);
    this.state = wellOfCached(w.templateId) ?? 'calm';
    let phase = 0;
    if (guardian && !guardian.dead)
      for (const a of guardian.auras) if (a.id === HEAT_AURAS.state) phase = Math.round(a.value);
    const look = wellLook(this.state, phase, clock, _well);
    const u = this.poolMat.uniforms;
    u.uHeat.value = look.heat;
    u.uBoil.value = look.boil;
    u.uSurge.value = look.surge;
    const sw = this.r + 0.3 + look.surge * 1.2;
    this.pool.scale.set(sw, 1, sw);
    this.pool.position.y = this.y + 0.08 + look.surge * 0.35;
    this.rimMat.uniforms.uHeat.value = 0.6 + 0.6 * look.heat;
    this.glow.position.set(this.x, this.y + 2.5, this.z);
    const gs = this.r * (4.2 + 0.8 * look.surge);
    this.glow.scale.set(gs, gs * 0.55, 1);
    this.glowMat.opacity = Math.min(0.8, 0.28 + 0.25 * look.heat);
    this.cosmetics(look, dt);
    this.paintRivers(riverIds, clock, dt);
  }

  private cosmetics(look: WellLook, dt: number): void {
    const h = this.host;
    const d = h.density;
    if (h.rand() < dt * 22 * d) {
      const a = h.rand() * Math.PI * 2;
      const rr = Math.sqrt(h.rand()) * this.r;
      h.particles.puff(
        this.x + Math.sin(a) * rr,
        this.y + 0.4,
        this.z + Math.cos(a) * rr,
        1,
        EMBER,
      );
    }
    if (h.rand() < dt * 10 * look.boil * d) {
      const a = h.rand() * Math.PI * 2;
      const rr = Math.sqrt(h.rand()) * this.r * 0.9;
      h.particles.puff(
        this.x + Math.sin(a) * rr,
        this.y + 0.3,
        this.z + Math.cos(a) * rr,
        4,
        BUBBLE,
      );
    }
    if (h.detail && h.rand() < dt * 4) h.particles.puff(this.x, this.y + 3, this.z, 1, HAZE);
    if (look.surge > 0 && h.rand() < dt * 30 * d) {
      // It spills over its lip while the Hearth overflows.
      const a = h.rand() * Math.PI * 2;
      SPILL_DIR[0] = Math.sin(a);
      SPILL_DIR[2] = Math.cos(a);
      h.particles.puff(
        this.x + Math.sin(a) * this.r,
        this.y + 0.6,
        this.z + Math.cos(a) * this.r,
        1,
        SPILL,
      );
    }
  }

  private paintRivers(riverIds: readonly number[], clock: number, dt: number): void {
    const world = this.host.world;
    if (!world) return;
    for (const s of this.rivers)
      if (s.id >= 0 && !riverIds.includes(s.id)) {
        s.id = -1;
        s.state = null;
        s.lane.group.visible = false;
        s.mesh.visible = false;
      }
    for (const id of riverIds) {
      const e = world.entities.get(id);
      const of = e ? riverOfCached(e.templateId) : null;
      if (!e || !of) continue;
      let s = this.rivers.find((r) => r.id === id);
      if (!s) {
        s = this.rivers.find((r) => r.id < 0);
        if (!s) continue;
        s.id = id;
        s.facing = e.facing;
        s.state = null;
        const half = e.scale || T.riverHalf;
        // From the pool's lip out across the shore, to the floor's edge.
        const sx = this.x + Math.sin(e.facing) * this.r;
        const sz = this.z + Math.cos(e.facing) * this.r;
        s.length = floorReach(
          HEARTH_WELL.x + Math.sin(e.facing) * this.r,
          HEARTH_WELL.z + Math.cos(e.facing) * this.r,
          e.facing,
          T.riverLength - this.r,
        );
        this.host.kit.drapeLane(
          s.lane,
          this.host.groundY,
          sx,
          this.host.groundY(sx, sz),
          sz,
          e.facing,
          s.length,
          half,
          RIVER_STYLE,
        );
        s.mesh.position.set(sx, this.host.groundY(sx, sz) + 0.07, sz);
        s.mesh.rotation.y = e.facing;
        s.mesh.scale.set(half * 2.1, 1, s.length);
        s.mat.uniforms.uLen.value = s.length;
      }
      if (s.state !== of.state) {
        s.state = of.state;
        s.born = clock;
      }
      const look = riverLook(of.state, clock - s.born, of.seconds, _river);
      PAINT.fill = look.fill;
      PAINT.clock = clock;
      PAINT.range = T.riverLength;
      PAINT.front = of.state === 'flow' ? 0 : undefined;
      PAINT.fade = of.state === 'flow' ? 0.55 + 0.45 * look.heat : undefined;
      this.host.kit.paintLane(s.lane, PAINT);
      s.lane.group.visible = look.lane;
      const flowing = of.state === 'flow' && look.heat > 0.01;
      s.mesh.visible = flowing;
      s.mat.uniforms.uFront.value = look.front;
      s.mat.uniforms.uHeat.value = look.heat;
      if (flowing && this.host.rand() < dt * 26 * this.host.density) {
        const t = this.host.rand() * look.front * s.length;
        const k = (this.host.rand() - 0.5) * (e.scale || T.riverHalf) * 1.4;
        this.host.particles.puff(
          s.mesh.position.x + Math.sin(s.facing) * t + Math.cos(s.facing) * k,
          s.mesh.position.y + 0.3,
          s.mesh.position.z + Math.cos(s.facing) * t - Math.sin(s.facing) * k,
          1,
          RIVER_FLAME,
        );
      }
    }
  }

  hide(): void {
    this.placedFor = -1;
    this.pool.visible = false;
    this.lip.visible = false;
    this.rim.visible = false;
    this.glow.visible = false;
    for (const s of this.rivers) {
      s.id = -1;
      s.state = null;
      s.lane.group.visible = false;
      s.mesh.visible = false;
    }
  }

  dispose(): void {
    this.lip.dispose();
  }
}

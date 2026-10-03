// Morthen the Lich Bishop's own effects (plan: morthen_fx_core.ts), on his
// Blender body (scripts/assets/hollow_crypt_creatures/build_morthen.py), all
// read off mirrored entity state so offline and online look the same:
//  - the soul smoke he trails from where his legs should be, soul wisps
//    spiralling out of it, and ghost fire licking out of his open ribs;
//  - his stance: the bell staff until his Last Rites, then the scythe it
//    unfolds into (the rig's clip set swaps through the playGesture seam); the
//    unfolding throws a burst of ghost fire, a shockwave and a spiral of souls;
//  - the Shadow Pulse tolls the bell: rings of grave light roll out from it;
//  - every scythe swing leaves a crescent of soul fire along its arc, every
//    staff blow a ring where the bell lands;
//  - death: the fire gutters, the vestments fold, and he dissolves into a
//    column of smoke while the souls he hoarded stream away into the sky.
//
// Rules (src/render/CLAUDE.md): one root, attached through the compile gate
// with every material present at construction; pooled particles on the crypt
// GPU particle kit, pooled rings and trails, no per-frame allocation. All of it
// is cosmetic (nothing here is a telegraph) and sheds density on the low tier.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { isEntombed, MORTHEN_ID } from '../../sim/encounters/hollow_crypt/ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  DUST_FRAG,
  FIRE_FRAG,
  FIRE_VERT,
  GHOST_RAMP,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from './crypt_fx_particles';
import {
  dissolveLevels,
  MORTHEN_MITRE_EYE,
  MORTHEN_RIBS,
  MORTHEN_SCYTHE_REACH,
  MORTHEN_SCYTHE_UNFOLD,
  MORTHEN_SMOKE_BASE,
  MORTHEN_SOUL_COUNT,
  MORTHEN_STANCE_REFRESH_SEC,
  MORTHEN_TOLL,
  type MorthenStance,
  morthenAnchor,
  morthenStance,
  morthenStanceGesture,
  STAFF_STRIKE_SEC,
  scytheTrail,
  soulOrbitInto,
  TRANSFORM_SLAM_SEC,
  TRANSFORM_UNFOLD_SEC,
} from './morthen_fx_core';

const SCAN_SEC = 0.1;
const TRAIL_SEGMENTS = 40;
const RING_SLOTS = 8;
const TRAIL_SLOTS = 3;
const CUE_SLOTS = 8;
/** The bell held high for the toll (BellToll's raised pose). */
const BELL_RAISED = { x: -0.85, y: 6.1, z: 0.62 } as const;

const MESH_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** A ring of grave light: a hot leading edge with a soft wake. */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vLocal;
void main() {
  float r = length(vLocal.xz);
  float lead = smoothstep(0.8, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float wake = smoothstep(0.45, 0.95, r) * 0.28 * step(r, 1.0);
  gl_FragColor = vec4(uColor * (1.1 + lead), (lead + wake) * uAlpha);
}
`;

/** The scythe's crescent: soul fire along the arc between tail and head,
 *  hottest at the leading edge and along the blade's outer rim. */
const TRAIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHead;
uniform float uTail;
uniform float uAlpha;
varying vec2 vUv;
${GHOST_RAMP}
void main() {
  float u = vUv.x;
  if (u > uHead || u < uTail) discard;
  float along = (u - uTail) / max(uHead - uTail, 1e-3);
  float rim = smoothstep(0.0, 1.0, vUv.y);
  float edge = pow(max(rim, 0.0), 3.0);
  float flick = 0.85 + 0.15 * sin(uTime * 31.0 + u * 40.0);
  float heat = clamp(along * (0.35 + 0.65 * edge) * flick, 0.0, 0.98);
  vec3 col = ghostRamp(0.35 + 0.63 * heat) * (1.2 + 1.3 * edge);
  float a = along * along * (0.25 + 0.75 * rim) * uAlpha;
  gl_FragColor = vec4(col, a);
}
`;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  span: number;
  reach: number;
  alive: boolean;
}

interface Trail {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  alive: boolean;
}

type CueKind = 'unfold' | 'slam' | 'strike';

interface Cue {
  kind: CueKind;
  at: number;
  live: boolean;
}

function trailGeometry(): THREE.BufferGeometry {
  // A half-disc band from his right, round his front, to his left; u runs the
  // arc, v the radius (0 inner, 1 the blade's reach). Local +Z is his front.
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= TRAIL_SEGMENTS; i++) {
    const u = i / TRAIL_SEGMENTS;
    const a = Math.PI * u;
    const dx = -Math.cos(a);
    const dz = Math.sin(a);
    for (const [r, v] of [
      [0.45, 0],
      [1, 1],
    ] as const) {
      pos.push(dx * r, 0, dz * r);
      uv.push(u, v);
    }
    if (i > 0) {
      const b = (i - 1) * 2;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class MorthenFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly smoke: ParticlePool;
  private readonly glow: ParticlePool;
  private readonly fire: ParticlePool;
  private readonly rings: Ring[] = [];
  private readonly trails: Trail[] = [];
  private readonly cues: Cue[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private morthenId = -1;
  private stance: MorthenStance | null = null;
  private refresh = 0;
  private wasAlive = false;
  private dissolveAt = -1e6;
  private swingCount = 0;
  private clock = 0;
  private scan = 0;
  private seed = 0x6d0e;
  private disposed = false;
  private readonly soulOff = { x: 0, y: 0, z: 0 };
  private readonly soulAt = { x: 0, y: 0, z: 0 };
  /** One reused particle spec for the soul flames (no per-frame allocation). */
  private readonly spec: ParticleSpec = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    size0: 0,
    size1: 0,
    r: 0,
    g: 0,
    b: 0,
    a: 0,
  };

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'crypt-morthen-fx';
    setRenderCategory(this.root, 'ui3d');
    const low =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.density = low ? 0.45 : 1;
    const flameTex = typeof document !== 'undefined' ? getFlameTex() : null;
    const particleMat = (frag: string, vert: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime, uTex: { value: flameTex } },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.smoke = new ParticlePool(
      Math.round(900 * this.density),
      particleMat(DUST_FRAG, PARTICLE_VERT, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 25),
    );
    this.fire = new ParticlePool(
      Math.round(700 * this.density),
      particleMat(FIRE_FRAG, FIRE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 26),
    );
    this.glow = new ParticlePool(
      // (the soul lights take a fixed share, the same on every tier)
      Math.round(900 * this.density) + 240,
      particleMat(GLOW_FRAG, PARTICLE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 27),
    );
    for (const p of [this.smoke, this.fire, this.glow]) {
      this.geometries.push(p.mesh.geometry);
      this.root.add(p.mesh);
    }
    const ringGeo = new THREE.CircleGeometry(1, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    for (let i = 0; i < RING_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
        vertexShader: MESH_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 24);
      this.root.add(mesh);
      this.rings.push({ mesh, mat, born: 0, span: 1, reach: 1, alive: false });
    }
    const trailGeo = trailGeometry();
    this.geometries.push(trailGeo);
    for (let i = 0; i < TRAIL_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: this.uTime,
          uHead: { value: 0 },
          uTail: { value: 0 },
          uAlpha: { value: 0 },
        },
        vertexShader: MESH_VERT,
        fragmentShader: TRAIL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(trailGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 28);
      this.root.add(mesh);
      this.trails.push({ mesh, mat, born: 0, alive: false });
    }
    for (let i = 0; i < CUE_SLOTS; i++) this.cues.push({ kind: 'strike', at: 0, live: false });
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private morthen(): Entity | undefined {
    return this.morthenId >= 0 ? this.world?.entities.get(this.morthenId) : undefined;
  }

  // ----------------------------------------------------------------- events

  handleEvent(ev: SimEvent): void {
    if (this.disposed || !this.world) return;
    const m = this.morthen();
    if (!m || m.dead) return;
    if (ev.type === 'spellfx' && ev.sourceId === m.id && ev.fx === 'nova' && !ev.ability) {
      // The Shadow Pulse: he tolls the bell (or raises the scythe) and it rings out.
      this.playGesture?.(m.id, MORTHEN_TOLL);
      this.toll(m);
    } else if (ev.type === 'damage' && ev.sourceId === m.id && ev.school === 'physical') {
      if (this.stance === 'scythe') this.swing(m);
      else this.queue('strike', this.clock + STAFF_STRIKE_SEC);
    }
  }

  private queue(kind: CueKind, at: number): void {
    const slot = this.cues.find((c) => !c.live) ?? this.cues[0];
    slot.kind = kind;
    slot.at = at;
    slot.live = true;
  }

  private toll(m: Entity): void {
    const s = m.scale || 1;
    const b = morthenAnchor(m.pos, m.facing, s, BELL_RAISED);
    for (let i = 0; i < 3; i++)
      this.ring(b.x, b.y, b.z, 7 + i * 3.5, 0.7 + i * 0.12, 0xb8ff8a, i * 0.1);
    this.ring(m.pos.x, this.groundY(m.pos.x, m.pos.z) + 0.12, m.pos.z, 12, 0.8, 0x9a6bff, 0);
    const n = Math.round(60 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.3) * 1.2;
      const sp = 5 + this.rand() * 5;
      this.glow.emit(this.clock, {
        x: b.x,
        y: b.y,
        z: b.z,
        vx: Math.sin(a) * sp,
        vy: e * sp,
        vz: Math.cos(a) * sp,
        life: 0.8 + this.rand() * 0.5,
        drag: 2.2,
        size0: 0.4,
        size1: 0.08,
        r: 0.7,
        g: 1,
        b: 0.55,
        a: 0.9,
      });
    }
    this.shakeAt(m.pos.x, m.pos.z, 0.25);
  }

  private swing(m: Entity): void {
    const t = this.trails.find((q) => !q.alive) ?? this.trails[0];
    const s = m.scale || 1;
    t.alive = true;
    t.born = this.clock;
    const flip = this.swingCount++ % 2 === 1;
    t.mesh.position.set(m.pos.x, m.pos.y + 3.3 * s, m.pos.z);
    t.mesh.scale.setScalar(MORTHEN_SCYTHE_REACH * s);
    // The flat sweep, then the rising diagonal reap brought down across him.
    t.mesh.rotation.set(0, m.facing, flip ? -0.5 : 0.12, 'YXZ');
    t.mesh.visible = false;
  }

  private ring(
    x: number,
    y: number,
    z: number,
    reach: number,
    seconds: number,
    color: number,
    delay: number,
  ): void {
    const r = this.rings.find((q) => !q.alive) ?? this.rings[0];
    r.alive = true;
    r.born = this.clock + delay;
    r.span = seconds;
    r.reach = reach;
    (r.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    r.mesh.position.set(x, y, z);
    r.mesh.scale.setScalar(0.01);
    r.mesh.visible = false;
  }

  private shakeAt(x: number, z: number, amount: number): void {
    if (!this.shake || this.reducedMotion() || !this.world) return;
    const me = this.world.player;
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < 45) this.shake(amount * (1 - d / 45));
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.morthenId = -1;
      for (const e of world.entities.values()) {
        if (e.kind === 'mob' && e.templateId === MORTHEN_ID) {
          this.morthenId = e.id;
          if (!e.dead) break;
        }
      }
    }
    const m = this.morthen();
    if (m && !isEntombed(m)) this.stepBoss(m, dt);
    else {
      this.stance = null;
      this.wasAlive = false;
    }
    this.stepCues(m);
    this.stepRings();
    this.stepTrails(m);
    this.smoke.update(this.clock);
    this.fire.update(this.clock);
    this.glow.update(this.clock);
  }

  private stepBoss(m: Entity, dt: number): void {
    const s = m.scale || 1;
    if (m.dead) {
      if (this.wasAlive) this.dissolveAt = this.clock;
      this.wasAlive = false;
      this.stance = null;
      this.stepDissolve(m, dt, s);
      return;
    }
    this.wasAlive = true;
    // The stance: the staff, or after the Last Rites the scythe.
    const next = morthenStance(this.stance, m.maxHp > 0 ? m.hp / m.maxHp : 1);
    if (next !== this.stance) {
      const gesture = morthenStanceGesture(this.stance, next);
      this.playGesture?.(m.id, gesture);
      if (gesture === MORTHEN_SCYTHE_UNFOLD) {
        this.queue('unfold', this.clock + TRANSFORM_UNFOLD_SEC);
        this.queue('slam', this.clock + TRANSFORM_SLAM_SEC);
      }
      this.stance = next;
      this.refresh = MORTHEN_STANCE_REFRESH_SEC;
    } else {
      this.refresh -= dt;
      if (this.refresh <= 0) {
        this.refresh = MORTHEN_STANCE_REFRESH_SEC;
        this.playGesture?.(m.id, morthenStanceGesture(null, next));
      }
    }
    const rites = this.stance === 'scythe' ? 1.7 : 1;
    const d = this.density;
    this.stepSouls(m, dt, s);
    // The soul smoke trailing from where his legs should be.
    const base = morthenAnchor(m.pos, m.facing, s, MORTHEN_SMOKE_BASE);
    const gy = this.groundY(m.pos.x, m.pos.z);
    for (let n = 0; n < Math.floor(26 * d * dt + this.rand()); n++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * 0.7 * s;
      this.smoke.emit(this.clock, {
        x: base.x + Math.sin(a) * r,
        y: base.y + (this.rand() - 0.3) * 0.8 * s,
        z: base.z + Math.cos(a) * r,
        // outward and turning round him, so the smoke under the robes churns
        vx: Math.sin(a) * 0.5 + Math.cos(a) * 0.7,
        vy: -0.25 + this.rand() * 0.4,
        vz: Math.cos(a) * 0.5 - Math.sin(a) * 0.7,
        life: 1.6 + this.rand() * 0.9,
        drag: 1.2,
        floor: gy + 0.2,
        size0: 1.1 * s,
        size1: (2.8 + this.rand() * 1.4) * s,
        spin: (this.rand() - 0.5) * 0.8,
        // Dark green-grey, the v2 body's own soul smoke (no longer plum).
        r: 0.12,
        g: 0.16,
        b: 0.14,
        a: 0.42,
      });
    }
    // Soul wisps spiralling up out of the smoke.
    for (let n = 0; n < Math.floor(10 * rites * d * dt + this.rand()); n++) {
      const a = this.rand() * Math.PI * 2;
      const r = (0.5 + this.rand() * 0.6) * s;
      const tang = a + Math.PI / 2;
      this.glow.emit(this.clock, {
        x: base.x + Math.sin(a) * r,
        y: base.y,
        z: base.z + Math.cos(a) * r,
        vx: Math.sin(tang) * 2.2,
        vy: 1.6 + this.rand() * 1.8,
        vz: Math.cos(tang) * 2.2,
        life: 1.2 + this.rand() * 0.8,
        drag: 0.9,
        size0: 0.28 * s,
        size1: 0.05,
        r: 0.6,
        g: 1,
        b: 0.5,
        a: 0.85,
      });
    }
    // Ghost fire licking out of the open ribs.
    const ribs = morthenAnchor(m.pos, m.facing, s, MORTHEN_RIBS);
    for (let n = 0; n < Math.floor(7 * rites * d * dt + this.rand()); n++) {
      this.fire.emit(this.clock, {
        x: ribs.x + (this.rand() - 0.5) * 0.4 * s,
        y: ribs.y + (this.rand() - 0.5) * 0.3 * s,
        z: ribs.z + (this.rand() - 0.5) * 0.3 * s,
        vx: 0,
        vy: 0.8 + this.rand() * 0.8,
        vz: 0,
        ay: 1,
        life: 0.55 + this.rand() * 0.3,
        drag: 0.8,
        size0: 0.35 * s,
        size1: (0.7 + this.rand() * 0.4) * s * (rites > 1 ? 1.3 : 1),
        r: 0.95 + this.rand() * 0.2,
        g: 0,
        b: 0,
        a: 0.8,
      });
    }
    // Soul-green sparks rising off the burning eye on his mitre.
    if (this.rand() < 8 * d * dt) {
      const c = morthenAnchor(m.pos, m.facing, s, MORTHEN_MITRE_EYE);
      this.glow.emit(this.clock, {
        x: c.x + (this.rand() - 0.5) * 0.16 * s,
        y: c.y,
        z: c.z + (this.rand() - 0.5) * 0.16 * s,
        vx: (this.rand() - 0.5) * 0.4,
        vy: 0.9 + this.rand() * 0.8,
        vz: (this.rand() - 0.5) * 0.4,
        life: 0.9 + this.rand() * 0.5,
        drag: 0.5,
        size0: 0.12 * s,
        size1: 0.02,
        r: 0.6,
        g: 1,
        b: 0.5,
        a: 0.9,
      });
    }
  }

  /** The souls he hoards: soft soul lights circling him, each trailing a lick of
   *  ghost fire back along its orbit and shedding the odd spark. The orbit widens
   *  and hurries while he casts, and runs faster in the scythe stance. */
  private stepSouls(m: Entity, dt: number, s: number): void {
    const casting = !!m.castingAbility;
    const rites = this.stance === 'scythe';
    const d = this.density;
    const sp = this.spec;
    // a hitch never dumps a burst of souls that evicts the pools' live particles
    const step = Math.min(dt, 0.1);
    const sin = Math.sin(m.facing);
    const cos = Math.cos(m.facing);
    const at = this.soulAt;
    for (let k = 0; k < MORTHEN_SOUL_COUNT; k++) {
      const o = soulOrbitInto(this.soulOff, k, this.clock, casting, rites);
      // morthenAnchor, into a scratch point
      at.x = m.pos.x + (o.x * cos + o.z * sin) * s;
      at.y = m.pos.y + o.y * s;
      at.z = m.pos.z + (-o.x * sin + o.z * cos) * s;
      const flick = 0.85 + 0.3 * this.rand();
      // the core: a soft, bright soul light, laid down at a steady rate as it flies
      // (never shed by tier: the souls stay whole on every preset)
      const cores = Math.floor(28 * step + this.rand());
      if (cores > 0) {
        sp.x = at.x;
        sp.y = at.y;
        sp.z = at.z;
        sp.vx = 0;
        sp.vy = 0.2;
        sp.vz = 0;
        sp.ax = 0;
        sp.ay = 0;
        sp.az = 0;
        sp.drag = 0;
        sp.floor = undefined;
        sp.spin = 0;
        sp.life = 0.2;
        sp.size0 = 0.62 * s * flick;
        sp.size1 = 0.4 * s;
        sp.r = 0.72;
        sp.g = 1;
        sp.b = 0.62;
        sp.a = 0.34;
        this.glow.emit(this.clock, sp);
        sp.size0 = 0.22 * s * flick;
        sp.size1 = 0.14 * s;
        sp.r = 0.9;
        sp.g = 1;
        sp.b = 0.82;
        sp.a = 0.5;
        this.glow.emit(this.clock, sp);
      }
      // the flame trail: tongues left behind as it flies, rising and thinning
      for (let n = 0; n < Math.floor(34 * d * step + this.rand()); n++) {
        sp.x = at.x + (this.rand() - 0.5) * 0.12 * s;
        sp.y = at.y + (this.rand() - 0.5) * 0.12 * s;
        sp.z = at.z + (this.rand() - 0.5) * 0.12 * s;
        sp.vx = (this.rand() - 0.5) * 0.3;
        sp.vy = 0.5 + this.rand() * 0.6;
        sp.vz = (this.rand() - 0.5) * 0.3;
        sp.ay = 0.8;
        sp.drag = 0.6;
        sp.life = 0.4 + this.rand() * 0.25;
        sp.size0 = 0.42 * s;
        sp.size1 = 0.08 * s;
        sp.spin = (this.rand() - 0.5) * 2;
        sp.r = 0.78 + this.rand() * 0.2;
        sp.g = 0;
        sp.b = 0;
        sp.a = 0.75;
        this.fire.emit(this.clock, sp);
      }
      // a spark now and then, drifting off
      if (this.rand() < 5 * d * step) {
        sp.vx = (this.rand() - 0.5) * 0.8;
        sp.vy = 0.6 + this.rand() * 0.8;
        sp.vz = (this.rand() - 0.5) * 0.8;
        sp.ay = 0;
        sp.drag = 0.5;
        sp.life = 0.8 + this.rand() * 0.5;
        sp.size0 = 0.1 * s;
        sp.size1 = 0.02;
        sp.spin = 0;
        sp.r = 0.7;
        sp.g = 1;
        sp.b = 0.55;
        sp.a = 0.9;
        this.glow.emit(this.clock, sp);
      }
    }
  }

  /** The unfolding's burst: ghost fire erupting round him, souls torn loose. */
  private unfoldBurst(m: Entity): void {
    const s = m.scale || 1;
    const gy = this.groundY(m.pos.x, m.pos.z);
    const bell = morthenAnchor(m.pos, m.facing, s, { x: -0.3, y: 5.2, z: 1.0 });
    this.ring(m.pos.x, gy + 0.12, m.pos.z, 16, 0.9, 0xb8ff8a, 0);
    this.ring(m.pos.x, gy + 0.14, m.pos.z, 10, 0.6, 0xffffff, 0.08);
    this.ring(bell.x, bell.y, bell.z, 8, 0.55, 0xd8ffc0, 0);
    const n = Math.round(170 * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = (1.8 + this.rand() * 1.4) * s;
      this.fire.emit(this.clock + this.rand() * 0.25, {
        x: m.pos.x + Math.sin(a) * r,
        y: gy + 0.1,
        z: m.pos.z + Math.cos(a) * r,
        vx: Math.sin(a) * 1.5,
        vy: 5 + this.rand() * 6,
        vz: Math.cos(a) * 1.5,
        ay: 2,
        life: 0.8 + this.rand() * 0.6,
        drag: 0.9,
        size0: 1 * s,
        size1: (2.4 + this.rand() * 1.8) * s,
        r: 1.05,
        g: 0,
        b: 0,
        a: 0.9,
      });
    }
    const w = Math.round(140 * this.density);
    for (let i = 0; i < w; i++) {
      const a = this.rand() * Math.PI * 2;
      const tang = a + Math.PI / 2;
      const sp = 4 + this.rand() * 6;
      this.glow.emit(this.clock + this.rand() * 0.2, {
        x: bell.x,
        y: bell.y,
        z: bell.z,
        vx: Math.sin(a) * sp + Math.sin(tang) * 3,
        vy: (this.rand() - 0.2) * 5,
        vz: Math.cos(a) * sp + Math.cos(tang) * 3,
        life: 1 + this.rand() * 0.8,
        drag: 1.4,
        size0: 0.45 * s,
        size1: 0.06,
        r: 0.7,
        g: 1,
        b: 0.55,
        a: 1,
      });
    }
    this.shakeAt(m.pos.x, m.pos.z, 0.55);
  }

  /** The scythe brought round to guard after the whirl: the floor jumps. */
  private slam(m: Entity): void {
    const gy = this.groundY(m.pos.x, m.pos.z);
    this.ring(m.pos.x, gy + 0.12, m.pos.z, 11, 0.6, 0x9a6bff, 0);
    const n = Math.round(50 * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = 6 + this.rand() * 4;
      this.smoke.emit(this.clock, {
        x: m.pos.x + Math.sin(a),
        y: gy + 0.3,
        z: m.pos.z + Math.cos(a),
        vx: Math.sin(a) * sp,
        vy: 0.5 + this.rand(),
        vz: Math.cos(a) * sp,
        life: 1.2 + this.rand() * 0.5,
        drag: 2,
        floor: gy + 0.2,
        size0: 1.2,
        size1: 3.6,
        r: 0.2,
        g: 0.27,
        b: 0.22,
        a: 0.5,
      });
    }
    this.shakeAt(m.pos.x, m.pos.z, 0.35);
  }

  /** A staff blow lands: a ring where the bell strikes. */
  private strike(m: Entity): void {
    const s = m.scale || 1;
    const p = morthenAnchor(m.pos, m.facing, s, { x: -0.2, y: 0, z: 3.2 });
    const gy = this.groundY(p.x, p.z);
    this.ring(p.x, gy + 0.15, p.z, 4.5, 0.45, 0xb8ff8a, 0);
    const n = Math.round(24 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      this.glow.emit(this.clock, {
        x: p.x,
        y: gy + 0.6 * s,
        z: p.z,
        vx: Math.sin(a) * 4,
        vy: 1 + this.rand() * 3,
        vz: Math.cos(a) * 4,
        life: 0.6 + this.rand() * 0.3,
        drag: 2,
        size0: 0.3,
        size1: 0.05,
        r: 0.7,
        g: 1,
        b: 0.55,
        a: 0.9,
      });
    }
  }

  /** The dissolve: smoke boiling up out of the fallen vestments, the souls let go. */
  private stepDissolve(m: Entity, dt: number, s: number): void {
    const t = this.clock - this.dissolveAt;
    const lv = dissolveLevels(t);
    if (lv.smoke <= 0 && lv.souls <= 0) return;
    const gy = this.groundY(m.pos.x, m.pos.z);
    if (lv.flash > 0 && t < dt * 1.5) {
      this.ring(m.pos.x, gy + 0.12, m.pos.z, 13, 0.9, 0xb8ff8a, 0);
      this.shakeAt(m.pos.x, m.pos.z, 0.4);
    }
    const d = this.density;
    for (let n = 0; n < Math.floor(90 * lv.smoke * d * dt + this.rand()); n++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * 1.8 * s;
      this.smoke.emit(this.clock, {
        x: m.pos.x + Math.sin(a) * r,
        y: gy + (0.3 + this.rand() * 2.5) * s,
        z: m.pos.z + Math.cos(a) * r,
        vx: Math.sin(a) * 0.6,
        vy: 1.4 + this.rand() * 1.8,
        vz: Math.cos(a) * 0.6,
        life: 2 + this.rand() * 1.2,
        drag: 0.6,
        size0: 1.4 * s,
        size1: (4 + this.rand() * 2.5) * s,
        spin: (this.rand() - 0.5) * 0.6,
        r: 0.11,
        g: 0.15,
        b: 0.13,
        a: 0.5,
      });
    }
    for (let n = 0; n < Math.floor(55 * lv.souls * d * dt + this.rand()); n++) {
      const a = this.rand() * Math.PI * 2;
      const tang = a + Math.PI / 2;
      this.glow.emit(this.clock, {
        x: m.pos.x + Math.sin(a) * 1.2 * s,
        y: gy + (1 + this.rand() * 2) * s,
        z: m.pos.z + Math.cos(a) * 1.2 * s,
        vx: Math.sin(tang) * 3,
        vy: 5 + this.rand() * 5,
        vz: Math.cos(tang) * 3,
        life: 1.6 + this.rand(),
        drag: 0.4,
        size0: 0.5 * s,
        size1: 0.08,
        r: 0.65,
        g: 1,
        b: 0.5,
        a: 1,
      });
    }
  }

  private stepCues(m: Entity | undefined): void {
    for (const c of this.cues) {
      if (!c.live || this.clock < c.at) continue;
      c.live = false;
      if (!m || m.dead) continue;
      if (c.kind === 'unfold') this.unfoldBurst(m);
      else if (c.kind === 'slam') this.slam(m);
      else this.strike(m);
    }
  }

  private stepRings(): void {
    for (const r of this.rings) {
      if (!r.alive) continue;
      const k = (this.clock - r.born) / r.span;
      if (k < 0) continue;
      if (k >= 1) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      r.mesh.visible = true;
      const ease = 1 - (1 - k) ** 3;
      r.mesh.scale.setScalar(r.reach * (0.06 + 0.94 * ease));
      r.mat.uniforms.uAlpha.value = (1 - k) ** 1.4;
    }
  }

  private stepTrails(m: Entity | undefined): void {
    for (const t of this.trails) {
      if (!t.alive) continue;
      const plan = scytheTrail(this.clock - t.born);
      if (!plan) {
        if (this.clock - t.born > 1) {
          t.alive = false;
          t.mesh.visible = false;
        }
        continue;
      }
      // The arc rides the body while it cuts.
      if (m && !m.dead) {
        const s = m.scale || 1;
        t.mesh.position.set(m.pos.x, m.pos.y + 3.3 * s, m.pos.z);
      }
      t.mesh.visible = true;
      t.mat.uniforms.uHead.value = plan.head;
      t.mat.uniforms.uTail.value = plan.tail;
      t.mat.uniforms.uAlpha.value = plan.alpha;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

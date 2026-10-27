// The Breath guardian's effects (plan: breath_fx_core.ts), hosted by
// ../rift_death_zone.ts beside the Hammer's. Presentation only, read from
// IWorld (the guardian's cast bar and facing, its events), so offline and
// online look the same:
//  - the telegraphs, on EVERY graphics tier: Bellows Gust's ring at the
//    gust's exact radius and Storm Lance's lane at its exact length and
//    width (aimed where the bar locked it), both through the shared floor
//    telegraph, filling with the bar;
//  - Bellows Gust on its bar: the breath drawn in along the floor toward the
//    guardian, loose stones lifted into a whirl round it that tightens and
//    quickens; when it lands, a wall of wind rides out past the ring to
//    where the shove ends, the stones and a spray of grit flung outward,
//    rings, streaks bursting out, a short shake;
//  - Storm Lance on its bar: lightning crackling round the guardian, sparks
//    running down the lane; when it lands, a bolt from the cloud onto the
//    guardian and a spear of lightning down the lane (never past its
//    width), the stone scorched along it, smouldering a few seconds.
// The footprints are actionable and never thin; the wind, the lightning and
// the debris are cosmetic and thin on the low tier and under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the root before its gated attach (one compile-gated
// attach, the telegraph kit's too); no light; no per-frame allocation (fixed
// pools); the scorch and the telegraphs are floor marks on the floor
// ladder's encounter band.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
  type TelegraphLane,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX, surfaceMat } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  BELLOWS_GUST,
  BREATH_FX_COLORS,
  BREATH_FX_POOLS,
  BREATH_GUARDIAN,
  breathGuardianKit,
  GUST_WAVE_SECONDS,
  gustBlastLook,
  gustChargeLook,
  LANCE_SCORCH_SECONDS,
  lanceBoltPath,
  lanceChargeLook,
  lanceLook,
  STORM_LANCE,
} from './breath_fx_core';
import { fxHash } from './hammer_fx_core';

const SCAN_SEC = 0.1;
const C = BREATH_FX_COLORS;
/** The gust's whirl and funnel never grow past this round the guardian. */
const GUST_WHIRL_MAX = 14;

// ---- the wind wall ----------------------------------------------------------------

const WALL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A wall of wind: streaks racing round it, thinning upward. */
const WALL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uShade;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vec2(vUv.x * 64.0 + uTime * 9.0, vUv.y * 10.0);
  float streak = n(vec2(p.x * 0.35, p.y * 4.0)) * 0.6 + n(vec2(p.x * 0.9, p.y * 9.0)) * 0.4;
  float rise = 1.0 - smoothstep(0.1 + streak * 0.5, 1.0, vUv.y);
  float a = uAlpha * rise * smoothstep(0.35, 0.8, streak);
  gl_FragColor = vec4(mix(uShade, uWind, 0.4 + vUv.y * 0.6), a);
  #include <colorspace_fragment>
}
`;

/** The gust's whirl: a funnel of wind twisting up round the guardian,
 *  its streaks spiralling faster as the bar fills. */
const FUNNEL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform float uSpin;
uniform vec3 uWind;
uniform vec3 uShade;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float sp = vUv.x * 6.0 + vUv.y * 2.5 - uTime * uSpin;
  float bands = n(vec2(sp * 3.0, vUv.y * 3.0)) * 0.65 + n(vec2(sp * 7.0, vUv.y * 8.0)) * 0.35;
  float fade = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float a = uAlpha * fade * smoothstep(0.42, 0.85, bands);
  gl_FragColor = vec4(mix(uShade, uWind, 0.3 + bands * 0.7), a);
  #include <colorspace_fragment>
}
`;

// ---- the lightning -----------------------------------------------------------------

const BOLT_VERT = /* glsl */ `
attribute float aEdge;
varying float vEdge;
void main() {
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BOLT_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uCore;
uniform vec3 uEdge;
varying float vEdge;
void main() {
  float e = abs(vEdge);
  float core = 1.0 - smoothstep(0.0, 0.35, e);
  float glow = 1.0 - smoothstep(0.2, 1.0, e);
  vec3 col = mix(uEdge, uCore, core) * (0.8 + core * 1.6);
  gl_FragColor = vec4(col * uAlpha, glow * uAlpha);
  #include <colorspace_fragment>
}
`;

/** A bolt: two crossed ribbons along a path (it reads from every side). */
function boltGeometry(pts: readonly THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let pass = 0; pass < 2; pass++) {
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      d.copy(pts[Math.min(pts.length - 1, i + 1)])
        .sub(pts[Math.max(0, i - 1)])
        .normalize();
      if (pass === 0) side.crossVectors(d, up).normalize();
      else side.crossVectors(d, up).normalize().cross(d).normalize();
      const w = width * (i === 0 || i === pts.length - 1 ? 0.5 : 1);
      for (const s of [-1, 1]) {
        pos.push(pts[i].x + side.x * w * s, pts[i].y + side.y * w * s, pts[i].z + side.z * w * s);
        edge.push(s);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const SCORCH_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uHeat;
uniform vec3 uDark;
uniform vec3 uGlow;
varying float vEdge;
void main() {
  float e = abs(vEdge);
  float core = 1.0 - smoothstep(0.0, 0.4, e);
  vec3 col = mix(uDark, uGlow * uHeat, core * clamp(uHeat, 0.0, 1.0));
  float a = uAlpha * (1.0 - smoothstep(0.6, 1.0, e)) * (0.55 + 0.45 * core);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

/** A chip of storm granite (an icosahedron pulled about by a fixed hash). */
function chipGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.7 + fxHash(i, 191) * 0.6;
    p.setXYZ(i, p.getX(i) * k * 1.25, p.getY(i) * k * 0.7, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

const STONE_TONES = [0x8e949c, 0x737a84, 0xa9adb2, 0x5d636c].map((c) => new THREE.Color(c));

interface Bolt {
  lane: THREE.Mesh;
  laneMat: THREE.ShaderMaterial;
  sky: THREE.Mesh;
  skyMat: THREE.ShaderMaterial;
  scorch: THREE.Mesh;
  scorchMat: THREE.ShaderMaterial;
  born: number;
  live: boolean;
}

interface Charge {
  id: number;
  kind: 'gust' | 'lance';
  x: number;
  y: number;
  z: number;
  progress: number;
  fan: TelegraphFan | null;
  lane: TelegraphLane | null;
}

export class BreathFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly fans: TelegraphFan[] = [];
  private readonly lanes: TelegraphLane[] = [];
  private readonly stones: THREE.InstancedMesh;
  private readonly wall: THREE.Mesh;
  private readonly wallMat: THREE.ShaderMaterial;
  private readonly funnel: THREE.Mesh;
  private readonly funnelMat: THREE.ShaderMaterial;
  private readonly bolts: Bolt[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly charges = new Map<number, Charge>();
  private readonly sim = breathGuardianKit();
  private wallBorn = -99;
  private seed = 0x6b2d;
  private scanTimer = 0;
  private clock = 0;
  private disposed = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly axis = new THREE.Vector3(0.3, 1, 0.2).normalize();

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-breath-fx';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.4;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
    );
    // The telegraphs: the footprint on every tier (the kit's curtain only
    // where the tier draws detail).
    this.kit = new TelegraphKit(this.root, detail);
    for (let i = 0; i < BREATH_FX_POOLS.telegraphs; i++) {
      this.fans.push(this.kit.fan(10));
      this.lanes.push(this.kit.lane(12));
    }
    // The whirl's stones.
    const chip = chipGeometry();
    this.geometries.push(chip);
    this.stones = new THREE.InstancedMesh(
      chip,
      surfaceMat({ color: 0xffffff, roughness: 0.9, flatShading: true }),
      BREATH_FX_POOLS.stones,
    );
    this.stones.name = 'smithHeartGustStones';
    this.stones.frustumCulled = false;
    this.stones.visible = false;
    this.stones.castShadow = false;
    this.stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < BREATH_FX_POOLS.stones; i++) {
      this.stones.setColorAt(i, STONE_TONES[i % STONE_TONES.length]);
      this.stones.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    this.root.add(this.stones);
    // The wall of wind riding out.
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0);
    this.geometries.push(wallGeo);
    this.wallMat = new THREE.ShaderMaterial({
      name: 'smithHeartGustWall',
      uniforms: {
        uAlpha: { value: 0 },
        uTime: this.uTime,
        uWind: { value: new THREE.Color(...C.wind) },
        uShade: { value: new THREE.Color(...C.windShade) },
      },
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(this.wallMat);
    this.wall = new THREE.Mesh(wallGeo, this.wallMat);
    this.wall.name = 'smithHeartGustWall';
    this.wall.visible = false;
    this.wall.frustumCulled = false;
    this.root.add(this.wall);
    // The whirl's funnel: wide at the floor, narrowing up past its head.
    const funnelGeo = new THREE.CylinderGeometry(0.35, 1, 1, 48, 6, true).translate(0, 0.5, 0);
    this.geometries.push(funnelGeo);
    this.funnelMat = new THREE.ShaderMaterial({
      name: 'smithHeartGustFunnel',
      uniforms: {
        uAlpha: { value: 0 },
        uTime: this.uTime,
        uSpin: { value: 1 },
        uWind: { value: new THREE.Color(...C.wind) },
        uShade: { value: new THREE.Color(...C.windShade) },
      },
      vertexShader: WALL_VERT,
      fragmentShader: FUNNEL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(this.funnelMat);
    this.funnel = new THREE.Mesh(funnelGeo, this.funnelMat);
    this.funnel.name = 'smithHeartGustFunnel';
    this.funnel.visible = false;
    this.funnel.frustumCulled = false;
    this.root.add(this.funnel);
    // The lance's bolts (two slots), each with its sky bolt and its scorch.
    for (let b = 0; b < BREATH_FX_POOLS.bolts; b++) {
      const path = lanceBoltPath(0x51 + b * 17, this.sim.lanceLength, this.sim.lanceHalfWidth);
      const lanePts = path.map(
        (p) => new THREE.Vector3(p.x, 1.3 + Math.sin(p.t * 9 + b) * 0.25, p.z),
      );
      const laneGeo = boltGeometry(lanePts, 0.55);
      const skyPts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        skyPts.push(
          new THREE.Vector3(
            (fxHash(b + 40, i) - 0.5) * 3.2 * (1 - t),
            46 - 44 * t,
            (fxHash(b + 70, i) - 0.5) * 3.2 * (1 - t),
          ),
        );
      }
      const skyGeo = boltGeometry(skyPts, 0.75);
      const scorchGeo = boltGeometry(
        path.map((p) => new THREE.Vector3(p.x * 0.9, 0, p.z)),
        0.7,
      );
      // The scorch lies flat: keep only its horizontal ribbon.
      scorchGeo.setDrawRange(0, (path.length - 1) * 6);
      this.geometries.push(laneGeo, skyGeo, scorchGeo);
      const boltMat = () =>
        new THREE.ShaderMaterial({
          name: 'smithHeartLanceBolt',
          uniforms: {
            uAlpha: { value: 0 },
            uCore: { value: new THREE.Color(...C.boltCore) },
            uEdge: { value: new THREE.Color(...C.boltEdge) },
          },
          vertexShader: BOLT_VERT,
          fragmentShader: BOLT_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
      const laneMat = boltMat();
      const skyMat = boltMat();
      const scorchMat = new THREE.ShaderMaterial({
        name: 'smithHeartLanceScorch',
        uniforms: {
          uAlpha: { value: 0 },
          uHeat: { value: 0 },
          uDark: { value: new THREE.Color(...C.scorch) },
          uGlow: { value: new THREE.Color(...C.boltEdge) },
        },
        vertexShader: BOLT_VERT,
        fragmentShader: SCORCH_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.materials.push(laneMat, skyMat, scorchMat);
      const lane = new THREE.Mesh(laneGeo, laneMat);
      const sky = new THREE.Mesh(skyGeo, skyMat);
      const scorch = new THREE.Mesh(scorchGeo, scorchMat);
      lane.name = 'smithHeartLanceBolt';
      sky.name = 'smithHeartLanceSkyBolt';
      scorch.name = 'smithHeartLanceScorch';
      // The scorch over the telegraph's fill, under its fill front.
      scorch.renderOrder = floorVfxRenderOrder('encounter', 18);
      for (const mesh of [lane, sky, scorch]) {
        mesh.visible = false;
        mesh.frustumCulled = false;
        this.root.add(mesh);
      }
      this.bolts.push({ lane, laneMat, sky, skyMat, scorch, scorchMat, born: -99, live: false });
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 50): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  /** Never claims an event: the renderer's own draws still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed || ev.type !== 'spellfx') return false;
    if (ev.ability === BELLOWS_GUST && ev.fx === 'nova') {
      const e = this.world.entities.get(ev.sourceId);
      if (e) this.blast(e);
    } else if (ev.ability === STORM_LANCE) {
      const e = this.world.entities.get(ev.sourceId);
      if (e) this.lance(e);
    }
    return false;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      for (const e of world.entities.values()) {
        if (e.templateId !== BREATH_GUARDIAN || e.dead || this.charges.has(e.id)) continue;
        if (e.castingAbility === BELLOWS_GUST) this.startCharge(e, 'gust');
        else if (e.castingAbility === STORM_LANCE) this.startCharge(e, 'lance');
      }
    }
    this.updateCharges(world, dt);
    this.updateWall();
    this.updateBolts();
    this.particles.update(this.clock);
  }

  // ---- the bars and their telegraphs -------------------------------------------------

  private startCharge(e: Entity, kind: 'gust' | 'lance'): void {
    const used = new Set([...this.charges.values()].flatMap((c) => [c.fan, c.lane]));
    const fan = kind === 'gust' ? (this.fans.find((f) => !used.has(f)) ?? null) : null;
    const lane = kind === 'lance' ? (this.lanes.find((l) => !used.has(l)) ?? null) : null;
    if (fan) {
      this.kit.layOutFan(fan, 360, {
        color: TELEGRAPH_THREAT_COLORS.danger,
        accent: C.accent,
      });
      fan.group.visible = true;
    }
    if (lane) lane.group.visible = true;
    this.charges.set(e.id, {
      id: e.id,
      kind,
      x: e.pos.x,
      y: this.groundY(e.pos.x, e.pos.z),
      z: e.pos.z,
      progress: 0,
      fan,
      lane,
    });
  }

  private endCharge(c: Charge): void {
    if (c.fan) c.fan.group.visible = false;
    if (c.lane) c.lane.group.visible = false;
    this.charges.delete(c.id);
    if (![...this.charges.values()].some((o) => o.kind === 'gust')) {
      this.stones.visible = false;
      this.funnel.visible = false;
    }
  }

  private updateCharges(world: IWorld, dt: number): void {
    for (const c of this.charges.values()) {
      const e = world.entities.get(c.id);
      const id = c.kind === 'gust' ? BELLOWS_GUST : STORM_LANCE;
      if (!e || e.dead || e.castingAbility !== id) {
        this.endCharge(c);
        continue;
      }
      c.x = e.pos.x;
      c.z = e.pos.z;
      c.y = this.groundY(c.x, c.z);
      const total =
        e.castTotal > 0 ? e.castTotal : c.kind === 'gust' ? this.sim.gustCast : this.sim.lanceCast;
      c.progress = Math.max(c.progress, telegraphFillOf(e.castRemaining, total));
      if (c.kind === 'gust') this.chargeGust(c, dt);
      else this.chargeLance(c, e, dt);
    }
  }

  private chargeGust(c: Charge, dt: number): void {
    const R = this.sim.gustRadius;
    if (c.fan) {
      this.kit.drapeFan(c.fan, this.groundY, c.x, c.y, c.z, 0, R);
      // The exhale's ring is the whole Cornice: its fill drawn softer so the
      // raid and the anchors still read through it (the rim stays full).
      this.kit.paintFan(c.fan, {
        fill: c.progress,
        clock: this.clock,
        range: R,
        fade: R > GUST_WHIRL_MAX * 2 ? 0.55 : 1,
      });
    }
    const look = gustChargeLook(c.progress);
    // The whirl round the guardian keeps its own size: the exhale's footprint
    // is the whole Cornice (the ring above, at the sim's exact radius), and a
    // whirl that wide would read as weather, not as the bellows gathering.
    const W = Math.min(R, GUST_WHIRL_MAX);
    // The breath drawn in along the floor from round the whirl.
    for (let k = 0; k < 2; k++) {
      if (this.rand() > dt * 40 * look.inhale * this.density) continue;
      const a = this.rand() * Math.PI * 2;
      const r = W * (0.8 + this.rand() * 0.9);
      this.particles.puff(
        c.x + Math.sin(a) * r,
        c.y + 0.4 + this.rand() * 2,
        c.z + Math.cos(a) * r,
        2,
        {
          speed: 8 + look.inhale * 10,
          life: 0.9,
          size: [0.9, 0.2],
          color: C.wind,
          alpha: 0.45,
          dir: [-Math.sin(a) + Math.cos(a) * 0.5, 0.08, -Math.cos(a) - Math.sin(a) * 0.5],
          spread: 0.15,
          drag: 0.4,
        },
      );
    }
    // The loose stones lifted into a tightening whirl.
    this.stones.visible = true;
    const n = Math.round(BREATH_FX_POOLS.stones * (this.density > 0.5 ? 1 : 0.5));
    for (let i = 0; i < BREATH_FX_POOLS.stones; i++) {
      if (i >= n) {
        this.stones.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      const a = fxHash(i, 211) * Math.PI * 2 + this.clock * look.spin * (0.7 + fxHash(i, 5) * 0.6);
      const r = (3 + fxHash(i, 213) * (W - 3)) * look.radius;
      const h =
        look.lift * (0.5 + fxHash(i, 217) * 4.5) + Math.sin(this.clock * 3 + i) * 0.2 * look.lift;
      const size = 0.3 + fxHash(i, 219) * 0.7;
      this.v.set(c.x + Math.sin(a) * r, c.y + h + size * 0.3, c.z + Math.cos(a) * r);
      this.q.setFromAxisAngle(this.axis, this.clock * (2 + fxHash(i, 223) * 4));
      this.s.setScalar(size * Math.min(1, look.lift * 3));
      this.stones.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    }
    this.stones.instanceMatrix.needsUpdate = true;
    // The funnel tightening round the guardian.
    this.funnel.visible = true;
    this.funnel.position.set(c.x, c.y, c.z);
    const fr = W * 0.75 * look.radius;
    this.funnel.scale.set(fr, 7 + 5 * look.lift, fr);
    this.funnelMat.uniforms.uSpin.value = look.spin * 1.4;
    this.funnelMat.uniforms.uAlpha.value =
      (0.2 + 0.55 * look.inhale) * (this.density > 0.5 ? 1 : 0.7);
  }

  private chargeLance(c: Charge, e: Entity, dt: number): void {
    const yaw = e.facing;
    const L = this.sim.lanceLength;
    if (c.lane) {
      this.kit.drapeLane(c.lane, this.groundY, c.x, c.y, c.z, yaw, L, this.sim.lanceHalfWidth, {
        color: TELEGRAPH_THREAT_COLORS.danger,
        accent: C.accent,
      });
      this.kit.paintLane(c.lane, { fill: c.progress, clock: this.clock, range: L });
    }
    const look = lanceChargeLook(c.progress);
    // Lightning crackling round the guardian.
    if (this.rand() < dt * 26 * look.crackle * this.density) {
      const a = this.rand() * Math.PI * 2;
      this.particles.puff(
        c.x + Math.sin(a) * 1.6,
        c.y + 2 + this.rand() * 3,
        c.z + Math.cos(a) * 1.6,
        3,
        {
          speed: 4,
          life: 0.25,
          size: [0.5, 0.1],
          color: C.spark,
          alpha: 0.95,
          pool: 'glow',
        },
      );
    }
    // Sparks running down the lane toward its end.
    if (this.rand() < dt * 30 * look.sparks * this.density) {
      const t = this.rand();
      const along = t * L;
      const across = (this.rand() - 0.5) * this.sim.lanceHalfWidth * 1.4;
      const x = c.x + Math.sin(yaw) * along + Math.cos(yaw) * across;
      const z = c.z + Math.cos(yaw) * along - Math.sin(yaw) * across;
      this.particles.puff(x, this.groundY(x, z) + 0.3, z, 2, {
        speed: 6,
        life: 0.35,
        size: [0.35, 0.08],
        color: C.spark,
        alpha: 0.9,
        pool: 'glow',
        dir: [Math.sin(yaw), 0.3, Math.cos(yaw)],
        spread: 0.3,
      });
    }
  }

  // ---- Bellows Gust lands --------------------------------------------------------------

  private blast(e: Entity): void {
    const c = this.charges.get(e.id);
    const x = e.pos.x;
    const z = e.pos.z;
    const y = c?.y ?? this.groundY(x, z);
    const R = this.sim.gustRadius;
    if (c) this.endCharge(c);
    this.stones.visible = false;
    // The whirl's stones and a spray of grit flung outward on the gale.
    const n = Math.round(40 * this.density * (this.reducedMotion() ? 0.4 : 1));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      this.particles.puff(x + Math.sin(a) * 2, y + 0.8 + this.rand() * 3, z + Math.cos(a) * 2, 1, {
        speed: 18 + this.rand() * 10,
        life: 0.9,
        size: [0.35, 0.25],
        color: C.grit,
        alpha: 0.9,
        dir: [Math.sin(a), 0.25, Math.cos(a)],
        spread: 0.15,
        gravity: 9,
        drag: 0.6,
      });
    }
    // Streaks bursting out with the wall.
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + this.rand() * 0.2;
      this.particles.puff(
        x + Math.sin(a) * 2.5,
        y + 0.6 + this.rand() * 2.5,
        z + Math.cos(a) * 2.5,
        2,
        {
          speed: 26,
          life: 0.55,
          size: [1.4, 0.3],
          color: C.wind,
          alpha: 0.6,
          dir: [Math.sin(a), 0.05, Math.cos(a)],
          spread: 0.08,
          drag: 1.2,
        },
      );
    }
    this.wallBorn = this.clock;
    this.wall.position.set(x, y - 0.2, z);
    this.wall.visible = true;
    this.particles.shockRing(x, z, C.ring, R + this.sim.gustShove * 0.8, GUST_WAVE_SECONDS + 0.2);
    this.particles.shockRing(x, z, C.ringStorm, R, 0.8);
    this.particles.puff(x, y + 1.5, z, 20, {
      speed: 10,
      up: 1,
      life: 1.2,
      size: [2.5, 7],
      color: C.wind,
      alpha: 0.38,
      drag: 2,
      radius: 2,
    });
    this.shakeNear(x, z, 0.5, R + 30);
  }

  private updateWall(): void {
    if (!this.wall.visible) return;
    const look = gustBlastLook(this.clock - this.wallBorn, this.sim.gustRadius, this.sim.gustShove);
    if (look.alpha <= 0) {
      this.wall.visible = false;
      return;
    }
    const r = Math.max(0.5, look.front);
    this.wall.scale.set(r, look.height, r);
    this.wallMat.uniforms.uAlpha.value = look.alpha * (this.density > 0.5 ? 0.85 : 0.6);
  }

  // ---- Storm Lance lands ---------------------------------------------------------------

  private lance(e: Entity): void {
    const c = this.charges.get(e.id);
    if (c) this.endCharge(c);
    const x = e.pos.x;
    const z = e.pos.z;
    const y = this.groundY(x, z);
    const yaw = e.facing;
    const b = this.bolts.find((o) => !o.live) ?? this.bolts[0];
    b.born = this.clock;
    b.live = true;
    for (const mesh of [b.lane, b.scorch]) {
      mesh.position.set(x, y + (mesh === b.scorch ? 0.08 : 0), z);
      mesh.rotation.y = yaw;
      mesh.visible = true;
    }
    b.sky.position.set(x, y, z);
    b.sky.visible = true;
    // The flash at the guardian and sparks thrown off the lane.
    this.particles.puff(x, y + 3, z, 14, {
      speed: 5,
      life: 0.4,
      size: [3, 8],
      color: C.spark,
      alpha: 0.7,
      pool: 'glow',
    });
    const L = this.sim.lanceLength;
    for (let k = 0; k < 12; k++) {
      const along = (k / 11) * L;
      const px = x + Math.sin(yaw) * along;
      const pz = z + Math.cos(yaw) * along;
      this.particles.puff(px, this.groundY(px, pz) + 0.5, pz, 4, {
        speed: 7,
        up: 3,
        life: 0.5,
        size: [0.4, 0.08],
        color: C.spark,
        alpha: 1,
        pool: 'glow',
      });
      this.particles.puff(px, this.groundY(px, pz) + 0.3, pz, 2, {
        speed: 1.5,
        up: 1.5,
        life: 1.6,
        size: [1.2, 3],
        color: C.windShade,
        alpha: 0.35,
      });
    }
    this.particles.shockRing(x, z, C.ringStorm, 6, 0.4);
    this.shakeNear(x, z, 0.3, 40);
  }

  private updateBolts(): void {
    for (const b of this.bolts) {
      if (!b.live) continue;
      const look = lanceLook(this.clock - b.born);
      b.laneMat.uniforms.uAlpha.value = look.bolt;
      b.skyMat.uniforms.uAlpha.value = look.bolt * 0.9;
      b.lane.scale.set(look.width, 1, 1);
      b.lane.visible = look.bolt > 0;
      b.sky.visible = look.bolt > 0;
      b.scorchMat.uniforms.uHeat.value = look.scorch;
      b.scorchMat.uniforms.uAlpha.value = Math.min(1, look.scorch * 0.8);
      if (this.clock - b.born > LANCE_SCORCH_SECONDS) {
        b.live = false;
        b.lane.visible = false;
        b.sky.visible = false;
        b.scorch.visible = false;
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.stones.dispose();
  }
}

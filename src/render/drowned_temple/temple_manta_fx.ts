// The Moonmantle Ray's effects (the Temple encounter pass; the mob id is the
// frozen pearlguard_sentinel), composed by temple_fx.ts; the plan is
// temple_manta_core.ts:
//  - Lunar Glide (its charge): cyan light streams off its wing edges and a
//    wake of moonwater droplets trails behind it; it lands in a splash with a
//    small camera kick for a player close by;
//  - Tidal Wingbeat (its wing gust): while the bar runs, water lifts in
//    spirals toward the raised wings; as the wings come down, a ring of
//    turquoise water with a white foam crest races out to the gust's edge
//    and droplets fly, with a medium kick for a player inside it (the floor
//    ring telegraph is temple_fx.ts's, from the cast id);
//  - Nacre Cocoon (its once-per-pull ward): a shell of pearl light round the
//    folded wings, the moon's phases glowing on it, dimming and cracking as
//    the ward is spent; when it breaks, a flash and a burst of nacre shards;
//  - dying, it melts into a pool of moonwater that spreads over the slabs
//    and gives up its light.
// Rules (src/render/CLAUDE.md): everything built once here under the gated
// temple root, collapsed until that gate links it, the layer hidden while no
// ray shows anything; no lights; the idle frame allocates nothing (burst
// particle specs are short-lived literals, as in the other temple layers).
// The low tier sheds particles; reduced motion holds the flashes down and
// skips the camera. State is read off IWorld only.

import * as THREE from 'three';
import { MOBS } from '../../sim/data';
import { TEMPLE_PEARL_CARAPACE, TEMPLE_PEARL_SLAM } from '../../sim/mob/trash_kit/temple_cast_ids';
import { TEMPLE_CARAPACE_AURA } from '../../sim/mob/trash_kit/temple_kit';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import type { TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
} from '../hollow_crypt/crypt_fx_particles';
import {
  MANTA_BODY_UP,
  MANTA_COCOON_R,
  MANTA_DISSOLVE_SECONDS,
  MANTA_ID,
  MANTA_WINGBEAT_SECONDS,
  mantaCocoonFull,
  mantaCocoonLook,
  mantaDissolve,
  mantaGlideStrength,
  mantaWingbeatRadius,
  mantaWingbeatRing,
} from './temple_manta_core';

const COLLAPSED = 1e-4;
const SCAN_SEC = 0.25;
const RAYS = 8;
const RINGS = 4;
const SHELLS = 3;
const POOLS = 4;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The Wingbeat's ring of water on the floor: a turquoise band, a white foam
// crest on its leading edge, ripples behind it.
const RING_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uReach;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float wob = (vnoise(vec2(a * 6.0, uTime * 3.0)) - 0.5) * 0.04;
  float edge = uReach + wob;
  float crest = exp(-pow(max((r - edge) * 26.0, 0.0), 2.0));
  float body = smoothstep(edge - 0.32, edge - 0.02, r) * (1.0 - smoothstep(edge - 0.02, edge + 0.02, r));
  float ripple = 0.5 + 0.5 * sin((r - uTime * 0.6) * 60.0);
  vec3 water = vec3(0.12, 0.62, 0.72) + vec3(0.25, 0.3, 0.25) * ripple * body;
  vec3 col = mix(water, vec3(0.95, 1.0, 1.0), crest);
  float alpha = (body * 0.55 + crest) * uAlpha;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// The Nacre Cocoon: pearl light with a nacre sheen, the moon's eight phases
// round its belt, cracks of light opening as the ward is spent.
const SHELL_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * wocCamRelView(world.xyz);
}
`;

const SHELL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uGlow;
uniform float uCrack;
uniform float uFlash;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
${NOISE}
void main() {
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vView))), 0.0), 2.2);
  vec3 p = normalize(vLocal);
  float lon = atan(p.z, p.x);
  float lat = p.y;
  // Nacre: an interference sheen sliding over the shell.
  float sheen = 0.5 + 0.5 * sin(lon * 3.0 + lat * 9.0 + uTime * 0.8 + vnoise(p.xz * 4.0) * 3.0);
  vec3 nacre = mix(vec3(0.75, 0.88, 1.0), vec3(1.0, 0.86, 0.96), sheen);
  nacre = mix(nacre, vec3(0.55, 1.0, 0.95), 0.25 * (1.0 - sheen));
  // The moon's phases round the belt: eight discs, going dark one by one as
  // the ward is spent.
  float cell = floor((lon + 3.14159) / 6.28318 * 8.0);
  float cx = (cell + 0.5) / 8.0 * 6.28318 - 3.14159;
  vec2 d = vec2((lon - cx) * 2.6, lat * 3.2);
  float disc = 1.0 - smoothstep(0.32, 0.36, length(d));
  float phase = (cell / 7.0) * 2.0 - 1.0;
  float lit = step(phase * 0.34, d.x) * disc;
  float glyph = (disc * 0.25 + lit) * step(cell / 8.0, uGlow);
  // Cracks of light open as the ward is spent.
  float n = vnoise(vec2(lon * 3.0, lat * 5.0) + 7.0);
  float crack = (1.0 - smoothstep(0.0, 0.035, abs(n - 0.5))) * smoothstep(0.05, 0.9, uCrack);
  vec3 col = nacre * (0.35 + 0.65 * uGlow) * (0.4 + 0.8 * fres);
  col += vec3(0.85, 0.95, 1.0) * glyph * 0.9 * uGlow;
  col += vec3(1.0, 0.97, 0.9) * crack * 1.6;
  col = mix(col, vec3(1.0), uFlash);
  float alpha = (0.18 + 0.6 * fres) * (0.45 + 0.55 * uGlow) + glyph * 0.5 + crack * 0.8 + uFlash;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

// A dead ray's moonwater pool: silver-teal, rippling, fading.
const POOL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float rim = 0.86 + 0.1 * vnoise(vec2(a * 3.0, 1.0));
  float inside = 1.0 - smoothstep(rim - 0.08, rim, r);
  float ripple = 0.5 + 0.5 * sin(r * 30.0 - uTime * 3.0);
  float caust = vnoise(p * 9.0 + uTime * 0.4);
  vec3 col = mix(vec3(0.3, 0.75, 0.85), vec3(0.88, 0.95, 1.0), 0.4 * ripple + 0.4 * caust);
  float edge = 1.0 - smoothstep(0.0, 0.06, abs(r - rim + 0.04));
  float alpha = (inside * (0.35 + 0.35 * caust) + edge * 0.6) * uAlpha;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

interface RayTrack {
  id: number;
  x: number;
  z: number;
  sampled: number;
  glide: number;
  shellSlot: number;
  hadWard: boolean;
  dead: boolean;
  liftDebt: number;
  wakeDebt: number;
}

interface FxSlot {
  mesh: THREE.Mesh;
  uniforms: Record<string, { value: number }>;
  age: number;
  life: number;
}

export class TempleMantaFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: ParticlePool;
  private readonly mist: ParticlePool;
  private readonly rings: FxSlot[] = [];
  private readonly shells: FxSlot[] = [];
  private readonly pools: FxSlot[] = [];
  private readonly rays: RayTrack[] = [];
  private readonly density: number;
  private readonly reach = mantaWingbeatRadius();
  private scan = 0;
  private rosterSeen = -1;
  private gated = false;
  private seed = 41;

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    _kit: TelegraphKit,
    private readonly shake?: (amount: number) => void,
    private readonly calm: () => boolean = () => false,
  ) {
    this.root.name = 'drowned-temple-manta-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.35;
    const particleMat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.glow = new ParticlePool(
      Math.round(1500 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      13,
    );
    this.mist = new ParticlePool(
      Math.round(500 * this.density),
      particleMat(DUST_FRAG, THREE.NormalBlending),
      12,
    );
    this.root.add(this.glow.mesh, this.mist.mesh);
    const disc = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const ball = new THREE.SphereGeometry(1, 40, 24);
    this.geometries.push(disc, ball);
    const slot = (
      geo: THREE.BufferGeometry,
      vert: string,
      frag: string,
      uniforms: Record<string, { value: number }>,
      order: number,
      blending: THREE.Blending,
    ): FxSlot => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime, ...uniforms },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      const mesh = new THREE.Mesh(geo, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      mesh.scale.setScalar(COLLAPSED);
      this.root.add(mesh);
      return { mesh, uniforms, age: -1, life: 0 };
    };
    for (let i = 0; i < RINGS; i++)
      this.rings.push(
        slot(
          disc,
          UV_VERT,
          RING_FRAG,
          { uReach: { value: 0 }, uAlpha: { value: 0 } },
          floorVfxRenderOrder('encounter', 4),
          THREE.NormalBlending,
        ),
      );
    for (let i = 0; i < SHELLS; i++)
      this.shells.push(
        slot(
          ball,
          SHELL_VERT,
          SHELL_FRAG,
          { uGlow: { value: 0 }, uCrack: { value: 0 }, uFlash: { value: 0 } },
          11,
          THREE.AdditiveBlending,
        ),
      );
    for (let i = 0; i < POOLS; i++)
      this.pools.push(
        slot(
          disc,
          UV_VERT,
          POOL_FRAG,
          { uAlpha: { value: 0 } },
          floorVfxRenderOrder('encounter', 3),
          THREE.NormalBlending,
        ),
      );
  }

  /** The temple root's gate has linked every program: idle, hide the layer. */
  markGated(): void {
    this.gated = true;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** The Wingbeat landing and the Cocoon closing are the ray's own cues. */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx') return false;
    if (ev.ability !== TEMPLE_PEARL_SLAM && ev.ability !== TEMPLE_PEARL_CARAPACE) return false;
    const ray = this.world?.entities.get(ev.sourceId);
    if (!ray || ray.templateId !== MANTA_ID) return false;
    if (ev.ability === TEMPLE_PEARL_SLAM) this.wingbeat(ray);
    else this.cocoonCloses(ray);
    return true;
  }

  private rescan(): void {
    const world = this.world;
    if (!world || world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (let i = this.rays.length - 1; i >= 0; i--) {
      if (world.entities.has(this.rays[i].id)) continue;
      const t = this.rays[i];
      if (t.shellSlot >= 0) this.shells[t.shellSlot].age = -1;
      this.rays.splice(i, 1);
    }
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== MANTA_ID) continue;
      if (this.rays.length >= RAYS || this.rays.some((r) => r.id === e.id)) continue;
      this.rays.push({
        id: e.id,
        x: e.pos.x,
        z: e.pos.z,
        sampled: -1,
        glide: 0,
        shellSlot: -1,
        hadWard: false,
        dead: e.dead,
        liftDebt: 0,
        wakeDebt: 0,
      });
    }
  }

  private wingbeat(ray: EntityView): void {
    const slot = this.rings.find((r) => r.age < 0) ?? this.rings[0];
    slot.age = 0;
    slot.life = MANTA_WINGBEAT_SECONDS;
    const y = this.groundY(ray.pos.x, ray.pos.z);
    slot.mesh.position.set(ray.pos.x, y + 0.08, ray.pos.z);
    const clock = this.uTime.value;
    const n = Math.round(110 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 6 + this.rand() * 9;
      const foam = this.rand() < 0.35;
      this.glow.emit(clock, {
        x: ray.pos.x + Math.cos(a) * 1.5,
        y: y + 0.4 + this.rand() * 1.2,
        z: ray.pos.z + Math.sin(a) * 1.5,
        vx: Math.cos(a) * s,
        vy: 3 + this.rand() * 6,
        vz: Math.sin(a) * s,
        ay: -16,
        drag: 0.9,
        life: 0.7 + this.rand() * 0.5,
        size0: foam ? 0.75 : 0.45,
        size1: 0.12,
        r: foam ? 0.95 : 0.35,
        g: foam ? 1 : 0.85,
        b: 1,
        a: 1,
      });
    }
    const m = Math.round(28 * this.density);
    for (let i = 0; i < m; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.reach * (0.4 + this.rand() * 0.5);
      this.mist.emit(clock, {
        x: ray.pos.x + Math.cos(a) * r,
        y: y + 0.5,
        z: ray.pos.z + Math.sin(a) * r,
        vx: Math.cos(a) * 3,
        vy: 1 + this.rand(),
        vz: Math.sin(a) * 3,
        drag: 1.2,
        life: 1.2 + this.rand() * 0.6,
        size0: 2,
        size1: 4,
        r: 0.85,
        g: 0.95,
        b: 1,
        a: 0.4,
      });
    }
    if (this.calm() || !this.shake) return;
    const me = this.world?.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - ray.pos.x, me.pos.z - ray.pos.z);
    if (d <= this.reach + 1) this.shake(0.3);
    else if (d <= 22) this.shake(0.1);
  }

  private cocoonCloses(ray: EntityView): void {
    const clock = this.uTime.value;
    const y = this.groundY(ray.pos.x, ray.pos.z) + MANTA_BODY_UP;
    const n = Math.round(60 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = MANTA_COCOON_R * 2.4;
      // Moonlight drawn in to the folding wings.
      this.glow.emit(clock, {
        x: ray.pos.x + Math.cos(a) * r,
        y: y + (this.rand() - 0.3) * 3,
        z: ray.pos.z + Math.sin(a) * r,
        vx: -Math.cos(a) * 7,
        vy: 0,
        vz: -Math.sin(a) * 7,
        drag: 2.2,
        life: 0.6 + this.rand() * 0.3,
        size0: 0.5,
        size1: 0.9,
        r: 0.9,
        g: 0.92,
        b: 1,
        a: 0.9,
      });
    }
  }

  /** The ward broke (or ran out): a flash, nacre shards, wings thrown open. */
  private cocoonBreaks(ray: EntityView, slot: FxSlot): void {
    slot.uniforms.uFlash.value = this.calm() ? 0.5 : 1;
    const clock = this.uTime.value;
    const y = this.groundY(ray.pos.x, ray.pos.z) + MANTA_BODY_UP;
    const n = Math.round(90 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.2) * 1.2;
      const s = 6 + this.rand() * 8;
      const pearl = this.rand();
      this.glow.emit(clock, {
        x: ray.pos.x,
        y,
        z: ray.pos.z,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.sin(e) * s + 2,
        vz: Math.sin(a) * Math.cos(e) * s,
        ay: -12,
        drag: 0.8,
        life: 0.8 + this.rand() * 0.5,
        size0: 0.55,
        size1: 0.15,
        spin: 8,
        r: 0.9 + 0.1 * pearl,
        g: 0.85 + 0.15 * pearl,
        b: 1,
        a: 1,
      });
    }
  }

  private dissolve(ray: EntityView): void {
    const slot = this.pools.find((p) => p.age < 0) ?? this.pools[0];
    slot.age = 0;
    slot.life = MANTA_DISSOLVE_SECONDS;
    slot.mesh.position.set(ray.pos.x, this.groundY(ray.pos.x, ray.pos.z) + 0.06, ray.pos.z);
  }

  update(dt: number, clock: number): void {
    this.uTime.value = clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.rescan();
    }
    const world = this.world;
    let busy = this.glow.lastDeath > clock || this.mist.lastDeath > clock;
    if (world) for (const t of this.rays) if (this.stepRay(world, t, dt, clock)) busy = true;
    for (const r of this.rings) if (this.stepRing(r, dt)) busy = true;
    for (const p of this.pools) if (this.stepPool(p, dt)) busy = true;
    for (const s of this.shells) {
      s.uniforms.uFlash.value = Math.max(0, s.uniforms.uFlash.value - dt * 3);
      if (s.age >= 0 || s.uniforms.uFlash.value > 0.01) busy = true;
      if (s.age < 0 && s.uniforms.uFlash.value <= 0.01) s.mesh.scale.setScalar(COLLAPSED);
    }
    this.glow.update(clock);
    this.mist.update(clock);
    this.root.visible = !this.gated || busy;
  }

  /** One ray's frame: its glide wake, the water lifting to the Wingbeat, the
   *  cocoon, its death. Returns true while it shows anything. */
  private stepRay(world: IWorld, t: RayTrack, dt: number, clock: number): boolean {
    const e = world.entities.get(t.id);
    if (!e) return false;
    if (e.dead && !t.dead) this.dissolve(e);
    t.dead = e.dead;
    if (e.dead) {
      if (t.shellSlot >= 0) this.shells[t.shellSlot].age = -1;
      t.shellSlot = -1;
      t.hadWard = false;
      return false;
    }
    // Its speed, sampled over the frame (the charge dashes at 3x its walk).
    if (t.sampled >= 0 && clock > t.sampled) {
      const v = Math.hypot(e.pos.x - t.x, e.pos.z - t.z) / (clock - t.sampled);
      const walk = MOBS[MANTA_ID]?.moveSpeed ?? 6.5;
      // A jump far past its dash (a snap correction, a teleport) is no glide.
      const want = v > walk * 4.5 ? 0 : mantaGlideStrength(v, walk);
      const was = t.glide;
      t.glide += (want - t.glide) * Math.min(1, dt * 10);
      if (was > 0.55 && t.glide <= 0.55) this.glideLands(e);
    }
    t.x = e.pos.x;
    t.z = e.pos.z;
    t.sampled = clock;
    let shows = false;
    if (t.glide > 0.05) {
      this.wake(e, t, dt, clock);
      shows = true;
    }
    if (e.castingAbility === TEMPLE_PEARL_SLAM && e.castTotal > 0) {
      this.lift(e, t, dt, clock, 1 - e.castRemaining / e.castTotal);
      shows = true;
    }
    const ward = e.auras.find((a) => a.id === TEMPLE_CARAPACE_AURA);
    if (ward) {
      if (t.shellSlot < 0) {
        t.shellSlot = this.shells.findIndex((s) => s.age < 0);
        if (t.shellSlot >= 0) this.shells[t.shellSlot].age = 0;
      }
      const slot = t.shellSlot >= 0 ? this.shells[t.shellSlot] : null;
      if (slot) {
        slot.age += dt;
        const look = mantaCocoonLook(ward.value, mantaCocoonFull(e.maxHp));
        const breathe = 1 + 0.03 * Math.sin(clock * 2.4);
        const grow = Math.min(1, slot.age / 0.45) * MANTA_COCOON_R * breathe;
        slot.mesh.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + MANTA_BODY_UP, e.pos.z);
        slot.mesh.scale.set(1.25 * grow, 0.85 * grow, 1.25 * grow);
        slot.uniforms.uGlow.value = look.glow;
        slot.uniforms.uCrack.value = look.crack;
      }
      t.hadWard = true;
      shows = true;
    } else if (t.hadWard) {
      t.hadWard = false;
      const slot = t.shellSlot >= 0 ? this.shells[t.shellSlot] : null;
      if (slot) {
        this.cocoonBreaks(e, slot);
        slot.age = -1;
      }
      t.shellSlot = -1;
    }
    return shows;
  }

  /** Cyan light off the wing edges and a wake of moonwater behind the glide. */
  private wake(e: EntityView, t: RayTrack, dt: number, clock: number): void {
    t.wakeDebt += 90 * t.glide * this.density * dt;
    const y = this.groundY(e.pos.x, e.pos.z) + MANTA_BODY_UP;
    const back = e.facing + Math.PI;
    while (t.wakeDebt >= 1) {
      t.wakeDebt -= 1;
      const side = this.rand() < 0.5 ? -1 : 1;
      const span = 2.6 + this.rand() * 0.8;
      const tip = this.rand() < 0.6;
      this.glow.emit(clock, {
        x: e.pos.x + (tip ? Math.cos(e.facing) * side * span : Math.sin(back) * 2.5),
        y: y + (tip ? 0.2 : -0.6),
        z: e.pos.z + (tip ? -Math.sin(e.facing) * side * span : Math.cos(back) * 2.5),
        vx: Math.sin(back) * 2,
        vy: tip ? 0.3 : -1,
        vz: Math.cos(back) * 2,
        ay: tip ? 0 : -6,
        drag: 1.2,
        life: tip ? 0.5 + this.rand() * 0.3 : 0.7,
        size0: tip ? 0.55 : 0.4,
        size1: 0.1,
        r: tip ? 0.45 : 0.85,
        g: 0.95,
        b: 1,
        a: 0.95,
      });
    }
  }

  /** The glide lands: a splash of moonwater and a small kick close by. */
  private glideLands(e: EntityView): void {
    const clock = this.uTime.value;
    const y = this.groundY(e.pos.x, e.pos.z);
    const n = Math.round(50 * this.density);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 3 + this.rand() * 5;
      this.glow.emit(clock, {
        x: e.pos.x,
        y: y + 0.6,
        z: e.pos.z,
        vx: Math.cos(a) * s,
        vy: 3 + this.rand() * 4,
        vz: Math.sin(a) * s,
        ay: -14,
        drag: 0.8,
        life: 0.6 + this.rand() * 0.4,
        size0: 0.5,
        size1: 0.1,
        r: 0.5,
        g: 0.92,
        b: 1,
        a: 1,
      });
    }
    if (this.calm() || !this.shake) return;
    const me = this.world?.entities.get(this.world.playerId);
    if (me && Math.hypot(me.pos.x - e.pos.x, me.pos.z - e.pos.z) <= 8) this.shake(0.12);
  }

  /** Water lifting in spirals toward the raised wings as the Wingbeat builds. */
  private lift(e: EntityView, t: RayTrack, dt: number, clock: number, fill: number): void {
    t.liftDebt += (20 + 70 * fill) * this.density * dt;
    const y = this.groundY(e.pos.x, e.pos.z);
    while (t.liftDebt >= 1) {
      t.liftDebt -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = this.reach * (0.5 + 0.5 * this.rand());
      this.glow.emit(clock, {
        x: e.pos.x + Math.cos(a) * r,
        y: y + 0.2,
        z: e.pos.z + Math.sin(a) * r,
        vx: -Math.cos(a) * r * 0.6 - Math.sin(a) * 2.5,
        vy: 3 + 4 * fill,
        vz: -Math.sin(a) * r * 0.6 + Math.cos(a) * 2.5,
        drag: 1,
        life: 0.9,
        size0: 0.35,
        size1: 0.6,
        r: 0.35,
        g: 0.85,
        b: 0.95,
        a: 0.85,
      });
    }
  }

  private stepRing(r: FxSlot, dt: number): boolean {
    if (r.age < 0) return false;
    r.age += dt;
    if (r.age >= r.life) {
      r.age = -1;
      r.mesh.scale.setScalar(COLLAPSED);
      return false;
    }
    const look = mantaWingbeatRing(r.age);
    // The disc spans the gust's whole reach; the shader draws the band.
    r.mesh.scale.setScalar(this.reach);
    r.uniforms.uReach.value = look.reach;
    r.uniforms.uAlpha.value = look.alpha;
    return true;
  }

  private stepPool(p: FxSlot, dt: number): boolean {
    if (p.age < 0) return false;
    p.age += dt;
    if (p.age >= p.life) {
      p.age = -1;
      p.mesh.scale.setScalar(COLLAPSED);
      return false;
    }
    const look = mantaDissolve(p.age);
    p.mesh.scale.setScalar(look.spread);
    p.uniforms.uAlpha.value = look.alpha;
    // Moonlight rising off the melting body.
    if (this.rand() < 0.5 * this.density) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * look.spread * 0.8;
      this.glow.emit(this.uTime.value, {
        x: p.mesh.position.x + Math.cos(a) * r,
        y: p.mesh.position.y + 0.1,
        z: p.mesh.position.z + Math.sin(a) * r,
        vx: 0,
        vy: 1 + this.rand() * 1.5,
        vz: 0,
        life: 1 + this.rand() * 0.6,
        size0: 0.4,
        size1: 0.1,
        r: 0.8,
        g: 0.95,
        b: 1,
        a: look.alpha,
      });
    }
    return true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.glow.dispose();
    this.mist.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

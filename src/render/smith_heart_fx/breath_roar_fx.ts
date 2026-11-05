// The Summit Roar and the indrawn breath before it (the Guardian of the
// Breath; looks: breath_roar_fx_core.ts; the sim: encounters/smith_heart/
// breath_roar.ts), a part of BreathFightFx:
//
//  - the indrawn breath (its bar): debris and grit torn off the floor and
//    sucked in toward the maw, dust dragged along the ground in long runs,
//    and for a body on the Cornice the wind closing in at the screen's edges
//    toward the maw (the streams of air are breath_inhale_streams.ts');
//  - the Roar (BREATH_CUES.gust): a shockwave racing out of the maw at the
//    sim's own pace: a bright ring on the floor with two rippling rings
//    trailing it (the air bent behind the front), a wall of wind riding it,
//    tall as it leaves and low by the rim, dust boiling along its front, a
//    spray of stone flung out of the maw, a jolt for whoever stands near;
//  - each body the wave reaches (BREATH_CUES.roarHit): a white burst and a
//    ring where it strikes, a hard shake if it is you, and a trail of wind
//    and grit streaming behind the body as it is flung;
//  - while it draws breath, where the Roar will fling YOU (roarLanding): a
//    ring pulsing on the spot and a run of motes out to it, pale over the
//    floor, red when the throw carries you over the void (every tier: it is
//    what you act on).
// The ring, the wall and the impacts on EVERY tier; the debris, the dust,
// the trails' grit and the screen's wind thin on the low tier, the screen's
// wind and the shakes go under reduced motion. Built in the constructor under
// the host's root (its one gated attach); fixed pools; no per-frame
// allocation.

import * as THREE from 'three';
import { BREATH_CASTS, BREATH_CUES } from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  inhaleScreenWind,
  ROAR_SPEED,
  ROAR_TRAIL_SECONDS,
  roarLanding,
  roarReach,
  roarWaveLook,
} from './breath_roar_fx_core';

/** What BreathFightFx lends this part (a type-only seam). */
export interface BreathRoarHost {
  readonly root: THREE.Group;
  readonly particles: EngineParticles;
  readonly uTime: { value: number };
  readonly density: number;
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  groundY(x: number, z: number): number;
  shakeNear(x: number, z: number, amount: number, reach?: number): void;
  reducedMotion(): boolean;
}

/** The landing marker's beat (seconds) and its colours: pale over the
 *  floor, the danger red over the void. */
const LANDING_EVERY = 0.35;
const LANDING_SAFE = 0xe6f4ff;
const LANDING_VOID = 0xff4436;

const RING_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uAlpha;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // vUv.y across the band: 1 at its outer edge (the front), 0 inside.
  float y = vUv.y;
  float edge = smoothstep(0.82, 0.97, y) * (1.0 - smoothstep(0.985, 1.0, y));
  // The air bent behind the front: bands rippling inward, broken by noise.
  float ripple = 0.5 + 0.5 * sin(y * 26.0 - uTime * 18.0);
  float n = h(floor(vec2(vUv.x * 180.0, y * 6.0 + uTime * 3.0)));
  float wake = smoothstep(0.0, 0.9, y) * ripple * (0.55 + 0.45 * n);
  float k = (edge * 1.6 + wake * 0.45) * uAlpha;
  vec3 col = mix(uColor, uCore, edge);
  gl_FragColor = vec4(col * (1.0 + 0.6 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uAlpha;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  // Streaks of wind and grit torn up and out (vUv.x round, vUv.y up).
  float streak = smoothstep(0.45, 0.95, n(vec2(vUv.x * 160.0, vUv.y * 2.0 - uTime * 3.0)));
  float foot = 1.0 - smoothstep(0.0, 1.0, vUv.y);
  float k = (0.25 + streak * 0.9) * foot * uAlpha;
  gl_FragColor = vec4(mix(uColor, uCore, streak * foot) * (1.0 + 0.4 * k), clamp(k, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** The screen's wind: a quad over the whole screen (clip space), the maw's
 *  place on the screen projected per vertex; streaks at the screen's edges
 *  rushing in toward it. */
const SCREEN_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
uniform vec3 uMaw;
varying vec2 vPos;
varying vec2 vMaw;
void main() {
  vPos = position.xy;
  vec4 c = projectionMatrix * wocCamRelView(uMaw);
  vMaw = c.w > 0.0 ? clamp(c.xy / c.w, vec2(-1.5), vec2(1.5)) : vec2(0.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const SCREEN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform vec3 uColor;
varying vec2 vPos;
varying vec2 vMaw;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 d = vPos - vMaw;
  float r = length(d);
  float a = atan(d.y, d.x);
  // Streaks round the maw, rushing in (each its own speed and length).
  float lane = floor(a * 28.0);
  float sp = 1.6 + h(vec2(lane, 3.1)) * 1.6;
  float run = fract(r * 1.4 + uTime * sp + h(vec2(lane, 7.7)));
  float streak = smoothstep(0.0, 0.25, run) * (1.0 - smoothstep(0.35, 0.6, run));
  float thin = 1.0 - smoothstep(0.25, 0.5, abs(fract(a * 28.0) - 0.5) * 2.0);
  // Only the screen's edges (the middle stays clear to read the fight).
  float edge = smoothstep(0.55, 1.05, max(abs(vPos.x), abs(vPos.y)));
  float k = streak * thin * step(0.5, h(vec2(lane, 11.0))) * edge * uStrength;
  float haze = edge * 0.12 * uStrength;
  gl_FragColor = vec4(uColor, clamp(k * 0.55 + haze, 0.0, 0.7));
}
`;

interface Wave {
  live: boolean;
  born: number;
  x: number;
  y: number;
  z: number;
  dust: number;
}

interface Trail {
  id: number;
  until: number;
  last: THREE.Vector3;
  emit: number;
}

const TRAILS = 12;

export class BreathRoarFx {
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly trails: THREE.Mesh[] = [];
  private readonly trailMats: THREE.ShaderMaterial[] = [];
  private readonly wall: THREE.Mesh;
  private readonly wallMat: THREE.ShaderMaterial;
  private readonly screen: THREE.Mesh;
  private readonly screenMat: THREE.ShaderMaterial;
  private readonly wave: Wave = { live: false, born: 0, x: 0, y: 0, z: 0, dust: 0 };
  private readonly flung: Trail[] = [];
  private readonly reach = roarReach();
  private clock = 0;
  private landingNext = 0;
  private suck = 0;
  private seed = 0x2b7d;

  constructor(private readonly h: BreathRoarHost) {
    const ringGeo = new THREE.RingGeometry(0.86, 1, 160, 1);
    const pos = ringGeo.getAttribute('position');
    const uv = ringGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k);
      const y = pos.getY(k);
      uv.setXY(k, (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, (Math.hypot(x, y) - 0.86) / 0.14);
    }
    ringGeo.rotateX(-Math.PI / 2);
    h.geometries.push(ringGeo);
    const ringMat = (alpha: number) =>
      new THREE.ShaderMaterial({
        name: 'smithHeartBreathRoarRing',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(0x9fe6ff) },
          uCore: { value: new THREE.Color(0xffffff) },
          uAlpha: { value: alpha },
        },
        vertexShader: UV_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
    this.ringMat = ringMat(0);
    h.materials.push(this.ringMat);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = floorVfxRenderOrder('encounter', 19);
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    h.root.add(this.ring);
    for (let k = 0; k < 2; k++) {
      const m = ringMat(0);
      h.materials.push(m);
      this.trailMats.push(m);
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.renderOrder = floorVfxRenderOrder('encounter', 19);
      mesh.frustumCulled = false;
      mesh.visible = false;
      h.root.add(mesh);
      this.trails.push(mesh);
    }
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true);
    wallGeo.translate(0, 0.5, 0);
    h.geometries.push(wallGeo);
    this.wallMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathRoarWall',
      uniforms: {
        uTime: h.uTime,
        uColor: { value: new THREE.Color(0xc8ecff) },
        uCore: { value: new THREE.Color(0xffffff) },
        uAlpha: { value: 0 },
      },
      vertexShader: UV_VERT,
      fragmentShader: WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    h.materials.push(this.wallMat);
    this.wall = new THREE.Mesh(wallGeo, this.wallMat);
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    h.root.add(this.wall);
    // The screen's wind (clip space: never culled, drawn over the scene).
    const quad = new THREE.PlaneGeometry(2, 2);
    h.geometries.push(quad);
    this.screenMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathInhaleScreen',
      uniforms: {
        uTime: h.uTime,
        uStrength: { value: 0 },
        uColor: { value: new THREE.Color(0xeaf8ff) },
        uMaw: { value: new THREE.Vector3() },
      },
      vertexShader: SCREEN_VERT,
      fragmentShader: SCREEN_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    h.materials.push(this.screenMat);
    this.screen = new THREE.Mesh(quad, this.screenMat);
    this.screen.frustumCulled = false;
    this.screen.renderOrder = 9990;
    this.screen.visible = false;
    h.root.add(this.screen);
    for (let k = 0; k < TRAILS; k++)
      this.flung.push({ id: -1, until: 0, last: new THREE.Vector3(), emit: 0 });
  }

  /** The Roar's cues: the wave leaves (never claimed: the guardian's own
   *  blast plays under it), a body struck (claimed). */
  handleEvent(ev: SimEvent, world: IWorld): boolean {
    if (ev.type !== 'spellfx') return false;
    if (ev.ability === BREATH_CUES.gust) {
      const g = world.entities.get(ev.sourceId);
      if (g) this.launch(g);
      return false;
    }
    if (ev.ability !== BREATH_CUES.roarHit) return false;
    const p = world.entities.get(ev.targetId);
    if (p) this.strike(p, world, ev.sourceId);
    return true;
  }

  private launch(g: Entity): void {
    const a = fxAnchor(g);
    const w = this.wave;
    w.live = true;
    w.born = this.clock;
    w.x = a.x;
    w.z = a.z;
    w.y = this.h.groundY(a.x, a.z);
    w.dust = 0;
    for (const m of [this.ring, this.wall, ...this.trails]) {
      m.position.set(w.x, w.y + (m === this.wall ? -0.2 : 0.12), w.z);
      m.visible = true;
    }
    // Stone flung out of the maw, and the air bursting with it.
    const n = Math.round(46 * this.h.density);
    for (let i = 0; i < n; i++) {
      const ang = this.rand() * Math.PI * 2;
      this.h.particles.puff(
        a.x + Math.sin(ang) * 2.5,
        w.y + 1 + this.rand() * 4,
        a.z + Math.cos(ang) * 2.5,
        1,
        {
          speed: 22 + this.rand() * 16,
          life: 1.4,
          size: [0.55, 0.4],
          color: [0.42, 0.44, 0.47],
          alpha: 1,
          dir: [Math.sin(ang), 0.35 + this.rand() * 0.3, Math.cos(ang)],
          spread: 0.12,
          gravity: 14,
          drag: 0.4,
        },
      );
    }
    this.h.particles.puff(a.x, w.y + 3, a.z, 14, {
      speed: 3,
      life: 0.35,
      size: [6, 14],
      color: [1, 1, 1],
      alpha: 0.8,
      pool: 'glow',
    });
    this.h.shakeNear(a.x, a.z, 0.35, 70);
  }

  private strike(p: Entity, world: IWorld, sourceId: number): void {
    const a = fxAnchor(p);
    const y = p.pos.y;
    this.h.particles.puff(a.x, y + 1.2, a.z, 6, {
      speed: 4,
      life: 0.3,
      size: [2.4, 0.6],
      color: [1, 1, 1],
      alpha: 1,
      pool: 'glow',
    });
    this.h.particles.shockRing(a.x, a.z, 0xdff6ff, 4.5, 0.4);
    const g = world.entities.get(sourceId);
    const dx = g ? a.x - g.pos.x : 0;
    const dz = g ? a.z - g.pos.z : 1;
    const l = Math.hypot(dx, dz) || 1;
    this.h.particles.puff(a.x, y + 0.4, a.z, Math.round(16 * this.h.density), {
      speed: 10,
      up: 2,
      life: 0.8,
      size: [0.8, 2.2],
      color: [0.82, 0.86, 0.9],
      alpha: 0.55,
      dir: [dx / l, 0.2, dz / l],
      spread: 0.5,
      drag: 1.4,
    });
    // You were struck: a hard jolt (the shake is yours alone).
    if (p.id === world.playerId) this.h.shakeNear(a.x, a.z, 0.8, 4);
    const t = this.flung.find((f) => f.id < 0 || f.until < this.clock) ?? this.flung[0];
    t.id = p.id;
    t.until = this.clock + ROAR_TRAIL_SECONDS;
    t.last.set(a.x, y, a.z);
    t.emit = 0;
  }

  /** One frame: `g` the guardian (or none in view), `onCornice` whether the
   *  local body stands in the fight's claim. */
  update(
    world: IWorld,
    g: Entity | undefined,
    onCornice: boolean,
    dt: number,
    origin: { x: number; z: number } | null = null,
  ): void {
    this.clock += dt;
    this.updateWave(dt);
    this.updateTrails(world, dt);
    this.updateInhale(g, onCornice, dt);
    this.updateLanding(world, g, onCornice, origin);
  }

  /** While the guardian draws breath: where the Roar throws the local body. */
  private updateLanding(
    world: IWorld,
    g: Entity | undefined,
    onCornice: boolean,
    origin: { x: number; z: number } | null,
  ): void {
    const drawing = !!g && !g.dead && g.castingAbility === BREATH_CASTS.inhale;
    const me = world.entities.get(world.playerId);
    if (!drawing || !g || !onCornice || !origin || !me || me.dead) return;
    if (this.clock < this.landingNext) return;
    this.landingNext = this.clock + LANDING_EVERY;
    const at = roarLanding(
      me.pos.x - origin.x,
      me.pos.z - origin.z,
      g.pos.x - origin.x,
      g.pos.z - origin.z,
    );
    const x = at.x + origin.x;
    const z = at.z + origin.z;
    const color = at.overVoid ? LANDING_VOID : LANDING_SAFE;
    this.h.particles.shockRing(x, z, color, 3.2, LANDING_EVERY + 0.15);
    this.h.particles.shockRing(x, z, color, 1.4, LANDING_EVERY + 0.15);
    for (let k = 1; k <= 5; k++) {
      const f = k / 6;
      const px = me.pos.x + (x - me.pos.x) * f;
      const pz = me.pos.z + (z - me.pos.z) * f;
      this.h.particles.puff(px, this.h.groundY(px, pz) + 0.3, pz, 1, {
        speed: 0.2,
        life: LANDING_EVERY + 0.1,
        size: [0.55, 0.3],
        color: at.overVoid ? [1, 0.32, 0.28] : [0.9, 0.96, 1],
        alpha: 0.9,
        pool: 'glow',
      });
    }
  }

  private updateWave(dt: number): void {
    const w = this.wave;
    if (!w.live) return;
    const look = roarWaveLook(this.clock - w.born, this.reach);
    if (look.alpha <= 0) {
      w.live = false;
      for (const m of [this.ring, this.wall, ...this.trails]) m.visible = false;
      return;
    }
    const r = Math.max(0.5, look.front);
    this.ring.scale.setScalar(r);
    this.ringMat.uniforms.uAlpha.value = look.alpha;
    this.trails[0].scale.setScalar(Math.max(0.5, look.trail1));
    this.trails[1].scale.setScalar(Math.max(0.5, look.trail2));
    this.trailMats[0].uniforms.uAlpha.value = look.alpha * 0.55 * (look.trail1 > 0.5 ? 1 : 0);
    this.trailMats[1].uniforms.uAlpha.value = look.alpha * 0.3 * (look.trail2 > 0.5 ? 1 : 0);
    this.wall.scale.set(r, look.height, r);
    this.wallMat.uniforms.uAlpha.value = look.alpha * 0.8;
    // Dust boiling along the front as it runs (cosmetic).
    if (look.front < this.reach) {
      w.dust += dt * 70 * this.h.density;
      while (w.dust >= 1) {
        w.dust -= 1;
        const ang = this.rand() * Math.PI * 2;
        const x = w.x + Math.sin(ang) * r;
        const z = w.z + Math.cos(ang) * r;
        this.h.particles.puff(x, this.h.groundY(x, z) + 0.6, z, 1, {
          speed: ROAR_SPEED * 0.55,
          up: 1.5,
          life: 0.7,
          size: [1.2, 3.4],
          color: [0.86, 0.9, 0.94],
          alpha: 0.42,
          dir: [Math.sin(ang), 0.15, Math.cos(ang)],
          spread: 0.2,
          drag: 1.6,
        });
      }
    }
  }

  private updateTrails(world: IWorld, dt: number): void {
    for (const t of this.flung) {
      if (t.id < 0) continue;
      if (t.until < this.clock) {
        t.id = -1;
        continue;
      }
      const e = world.entities.get(t.id);
      if (!e) {
        t.id = -1;
        continue;
      }
      const a = fxAnchor(e);
      const dx = a.x - t.last.x;
      const dz = a.z - t.last.z;
      const moved = Math.hypot(dx, dz);
      // A streak of wind for every stretch it flies, grit off its feet.
      t.emit += moved * 3.2;
      while (t.emit >= 1) {
        t.emit -= 1;
        const k = this.rand();
        this.h.particles.puff(
          t.last.x + dx * k,
          e.pos.y + 0.6 + this.rand() * 1.4,
          t.last.z + dz * k,
          1,
          {
            speed: 0.6,
            life: 0.9,
            size: [2, 0.35],
            color: [0.92, 0.97, 1],
            alpha: 0.85,
            pool: 'glow',
            drag: 2,
          },
        );
        if (this.rand() < this.h.density * 0.5)
          this.h.particles.puff(t.last.x + dx * k, e.pos.y + 0.2, t.last.z + dz * k, 1, {
            speed: 2,
            up: 1.5,
            life: 0.7,
            size: [0.6, 1.6],
            color: [0.78, 0.8, 0.84],
            alpha: 0.45,
            drag: 1.5,
          });
      }
      t.last.set(a.x, e.pos.y, a.z);
    }
  }

  private updateInhale(g: Entity | undefined, onCornice: boolean, dt: number): void {
    const drawing = !!g && !g.dead && g.castingAbility === BREATH_CASTS.inhale;
    const fill =
      drawing && g && g.castTotal > 0
        ? Math.max(0, Math.min(1, 1 - g.castRemaining / g.castTotal))
        : 0;
    const target = inhaleScreenWind(fill, drawing && onCornice && !this.h.reducedMotion());
    this.suck += (target - this.suck) * Math.min(1, dt * (target > this.suck ? 5 : 3));
    this.screen.visible = this.suck > 0.02;
    this.screenMat.uniforms.uStrength.value = this.suck;
    if (!drawing || !g) return;
    const a = fxAnchor(g);
    const s = Math.max(1, g.scale ?? 1);
    const mx = a.x + Math.sin(g.facing) * 1.2 * s;
    const mz = a.z + Math.cos(g.facing) * 1.2 * s;
    const my = g.pos.y + 2.2 * s;
    (this.screenMat.uniforms.uMaw.value as THREE.Vector3).set(mx, my, mz);
    // Grit and stones torn up and sucked into the maw, dust dragged along
    // the ground in long runs (cosmetic; the pull itself reads on the
    // streams and the players' own drift).
    const rate = (0.4 + 0.6 * fill) * this.h.density;
    if (this.rand() < dt * 40 * rate) {
      const ang = this.rand() * Math.PI * 2;
      const r = 14 + this.rand() * 22;
      const x = mx + Math.sin(ang) * r;
      const z = mz + Math.cos(ang) * r;
      const y = this.h.groundY(x, z);
      const speed = 12 + fill * 16;
      this.h.particles.puff(x, y + 0.5 + this.rand() * 2.5, z, 1, {
        speed,
        life: Math.min(1.6, r / speed),
        size: [0.35, 0.3],
        color: [0.4, 0.42, 0.45],
        alpha: 1,
        dir: [(mx - x) / r, (my - y) / r + 0.12, (mz - z) / r],
        spread: 0.05,
      });
    }
    if (this.rand() < dt * 50 * rate) {
      const ang = this.rand() * Math.PI * 2;
      const r = 8 + this.rand() * 26;
      const x = mx + Math.sin(ang) * r;
      const z = mz + Math.cos(ang) * r;
      this.h.particles.puff(x, this.h.groundY(x, z) + 0.25, z, 1, {
        speed: 8 + fill * 10,
        life: 1.1,
        size: [1.4, 0.5],
        color: [0.84, 0.86, 0.88],
        alpha: 0.5,
        dir: [(mx - x) / r, 0.02, (mz - z) / r],
        spread: 0.08,
      });
    }
  }

  leave(): void {
    this.wave.live = false;
    for (const m of [this.ring, this.wall, ...this.trails]) m.visible = false;
    this.screen.visible = false;
    this.suck = 0;
    for (const t of this.flung) t.id = -1;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}

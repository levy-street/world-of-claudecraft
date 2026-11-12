// The Seam Singer's death (plan: council_death_core.ts), a part of
// CouncilDeathFx (council_death_fx.ts, which owns the root, the particles,
// the light cards, the clock and the body's points and paints it each frame):
//  - the last note: rings of resonance pulsing off her chest (the entrance's
//    ring program), steady, then quicker as her crystal gives; her body's
//    crystals glowing brighter (a card on each of her bones' sockets);
//  - the fracture: shafts of amber-white light leaking out of her through
//    the seams (the host's shafts), opening one after another until she
//    blazes;
//  - the shatter: a burst of light, and her crystal flies apart into shards
//    (the entrance's amber crystal program) that the air catches and holds a
//    beat, turning and glinting in a glitter of motes, then rain down, glint
//    once on the floor and melt into light.
// The shafts and the rings draw on every tier (they are the beat); the low
// tier thins the shards, the glitter and the sparks.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (one gated attach); fixed pools, no
// light, no per-frame allocation.

import * as THREE from 'three';
import {
  COUNCIL_DEATH_CHEST,
  COUNCIL_DEATH_HEIGHT,
  COUNCIL_DEATH_RATES,
  COUNCIL_DEATH_SHAKES,
  councilDeathCrossed,
  councilDeathKept,
  councilDeathLight,
  councilLeakLevel,
  newShardFlight,
  SINGER_DEATH,
  SINGER_LEAKS,
  SINGER_POINTS,
  SINGER_RING,
  SINGER_RINGS,
  SINGER_SHARDS,
  type SingerDeathLook,
  singerShardAt,
} from './council_death_core';
import type { CouncilDeathBody, CouncilDeathPartHost } from './council_death_stone';
import { crystalGeometry, ringGeometry } from './council_entrance_crystal';
import { CRYSTAL_FRAG, CRYSTAL_VERT, RING_FRAG, RING_VERT } from './council_entrance_glsl';

const D = SINGER_DEATH;
const H = COUNCIL_DEATH_HEIGHT.singer;
const CHEST = COUNCIL_DEATH_CHEST.singer;
/** Resonance rings alive at once (their pool). */
const RING_SLOTS = 6;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _sf = newShardFlight();

const AMBER: readonly [number, number, number] = [1, 0.62, 0.22];
const WHITE: readonly [number, number, number] = [1, 0.95, 0.82];

export class CouncilDeathCrystal {
  readonly stage = new THREE.Group();
  private readonly rings: THREE.InstancedMesh;
  private readonly shards: THREE.InstancedMesh;
  private readonly shardMat: THREE.ShaderMaterial;
  private readonly shardPicks: number[];
  /** Each shard's birth (stage-local) and its heading's yaw, held from the
   *  shatter. */
  private readonly births: Float32Array;
  private readonly yaws: Float32Array;
  /** Each kept shard's place last frame (the glitter's motes ride them). */
  private readonly at: Float32Array;
  private readonly landed: Uint8Array;
  private born = false;
  private glitterDebt = 0;

  constructor(
    parent: THREE.Object3D,
    private readonly h: CouncilDeathPartHost,
  ) {
    this.stage.name = 'smithHeartCouncilDeathCrystal';
    this.stage.visible = false;
    parent.add(this.stage);
    // ---- the note's rings (the entrance's ring program) ----
    const ringGeo = ringGeometry(0.9, 96);
    h.geometries.push(ringGeo);
    const ringMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilDeathRingMat',
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    h.materials.push(ringMat);
    this.rings = new THREE.InstancedMesh(ringGeo, ringMat, RING_SLOTS);
    this.rings.name = 'smithHeartCouncilDeathRings';
    this.rings.frustumCulled = false;
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < RING_SLOTS; i++) {
      this.rings.setMatrixAt(i, _zero);
      this.rings.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.stage.add(this.rings);
    // ---- the shards (the entrance's amber crystal program) ----
    const shardGeo = crystalGeometry();
    h.geometries.push(shardGeo);
    this.shardMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilDeathShardMat',
      uniforms: { uGlow: { value: 1.0 }, uTime: h.uTime, uClear: { value: 0 } },
      vertexShader: CRYSTAL_VERT,
      fragmentShader: CRYSTAL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    h.materials.push(this.shardMat);
    this.shardPicks = [];
    for (let i = 0; i < SINGER_SHARDS.length; i++)
      if (councilDeathKept(i, h.density)) this.shardPicks.push(i);
    this.shards = new THREE.InstancedMesh(shardGeo, this.shardMat, this.shardPicks.length);
    this.shards.name = 'smithHeartCouncilDeathShards';
    this.shards.frustumCulled = false;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.shardPicks.length; i++) {
      this.shards.setMatrixAt(i, _zero);
      this.shards.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    this.stage.add(this.shards);
    this.births = new Float32Array(SINGER_SHARDS.length * 3);
    this.yaws = new Float32Array(SINGER_SHARDS.length);
    this.at = new Float32Array(this.shardPicks.length * 3);
    this.landed = new Uint8Array(SINGER_SHARDS.length);
  }

  hide(): void {
    this.stage.visible = false;
    this.born = false;
  }

  reset(): void {
    this.born = false;
    this.landed.fill(0);
  }

  /** Paint her at scene time `t` (`prev` last frame's). */
  paint(look: SingerDeathLook, body: CouncilDeathBody, t: number, prev: number, dt: number): void {
    const h = this.h;
    const reduced = h.reducedMotion();
    const crossed = (at: number) => councilDeathCrossed(prev, t, at);
    this.stage.position.set(body.x, body.y, body.z);
    this.stage.visible = t >= 0 && t < D.end;
    if (!this.stage.visible) return;
    const cx = body.pts[CHEST * 3];
    const cy = body.pts[CHEST * 3 + 1];
    const cz = body.pts[CHEST * 3 + 2];
    // ---- her light: each crystal of her glowing, the chest brightest ----
    const glow = councilDeathLight(look.glow, reduced);
    if (glow > 0.01) {
      const tt = h.uTime.value;
      for (let i = 0; i < SINGER_POINTS.length; i++) {
        const p = SINGER_POINTS[i];
        const flick = reduced ? 1 : 0.8 + 0.2 * Math.sin(tt * 17 + i * 1.9);
        const k = glow * flick * (0.4 + 0.6 * look.leak + (i === CHEST ? 0.5 : 0));
        h.card(
          body.pts[i * 3],
          body.pts[i * 3 + 1],
          body.pts[i * 3 + 2],
          p.size * H * 2.6,
          k,
          0.62 * k,
          0.24 * k,
        );
      }
      h.card(cx, cy, cz, H * (0.5 + 0.35 * look.note), 0.8 * glow, 0.48 * glow, 0.16 * glow);
    }
    this.paintRings(t, cx, cy, cz, look.note);
    this.paintLeaks(t, body, look.glow, reduced);
    // ---- the shatter ----
    if (crossed(D.shatterAt)) this.shatter(body);
    if (look.sinceShatter < 0) {
      this.shards.visible = false;
      return;
    }
    if (!this.born) this.bear(body);
    this.paintShards(look.sinceShatter, dt);
  }

  private paintRings(t: number, cx: number, cy: number, cz: number, note: number): void {
    let slot = 0;
    for (let i = 0; i < SINGER_RINGS.length && slot < RING_SLOTS; i++) {
      const age = t - SINGER_RINGS[i];
      if (age < 0 || age >= SINGER_RING.life) continue;
      const k = age / SINGER_RING.life;
      const r = H * (SINGER_RING.from + (SINGER_RING.to - SINGER_RING.from) * (1 - (1 - k) ** 2));
      const a = (1 - k) ** 0.8 * Math.max(0.3, note) * (0.7 + 0.04 * i);
      // A slight tilt each, so the rings read as sound round her, never a
      // floor mark.
      _axis.set(Math.sin(i * 2.1), 0, Math.cos(i * 2.1));
      _q.setFromAxisAngle(_axis, 0.18 + 0.08 * Math.sin(i * 1.3));
      _m.compose(
        _p.set(cx - this.stage.position.x, cy - this.stage.position.y, cz - this.stage.position.z),
        _q,
        _s.set(r, 1, r),
      );
      this.rings.setMatrixAt(slot, _m);
      this.rings.setColorAt(slot, _c.setRGB(a, 0, 0));
      slot++;
    }
    for (let i = slot; i < RING_SLOTS; i++) this.rings.setMatrixAt(i, _zero);
    this.rings.visible = slot > 0;
    if (slot > 0) {
      this.rings.instanceMatrix.needsUpdate = true;
      if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    }
  }

  private paintLeaks(t: number, body: CouncilDeathBody, glow: number, reduced: boolean): void {
    for (let i = 0; i < SINGER_LEAKS.length; i++) {
      const l = SINGER_LEAKS[i];
      const lv = councilDeathLight(councilLeakLevel(l, t, glow, D.shatterAt), reduced);
      if (lv <= 0.002) continue;
      const open = Math.min(1, (t - l.at) / 0.22);
      this.h.shaft(
        body.pts[l.point * 3],
        body.pts[l.point * 3 + 1],
        body.pts[l.point * 3 + 2],
        body.facing + l.yaw,
        l.pitch,
        l.len * H * (0.35 + 0.65 * open),
        l.width * H,
        lv,
        i / SINGER_LEAKS.length,
      );
    }
  }

  /** The shatter: the shards' births, the burst of light, white motes, the
   *  thud. */
  private shatter(body: CouncilDeathBody): void {
    const h = this.h;
    this.bear(body);
    const cx = body.pts[CHEST * 3];
    const cy = body.pts[CHEST * 3 + 1];
    const cz = body.pts[CHEST * 3 + 2];
    h.flash(cx, cy, cz, H * 1.7, 1, 0.8, 0.5);
    h.particles.puff(cx, cy, cz, 90, BURST);
    h.particles.shockRing(body.x, body.z, 0xffc078, 22, 0.8, {
      wake: 0.2,
      crest: 0.08,
      strength: 0.7,
    });
    h.thud(COUNCIL_DEATH_SHAKES.shatter.amount, COUNCIL_DEATH_SHAKES.shatter.reach, cx, cz);
  }

  private bear(body: CouncilDeathBody): void {
    for (let i = 0; i < SINGER_SHARDS.length; i++) {
      const s = SINGER_SHARDS[i];
      this.births[i * 3] = body.pts[s.point * 3] - body.x;
      this.births[i * 3 + 1] = body.pts[s.point * 3 + 1] - body.y;
      this.births[i * 3 + 2] = body.pts[s.point * 3 + 2] - body.z;
      this.yaws[i] = body.facing + s.yaw;
    }
    this.landed.fill(0);
    this.born = true;
  }

  private paintShards(since: number, dt: number): void {
    const h = this.h;
    let any = false;
    let hanging = 0;
    for (let j = 0; j < this.shardPicks.length; j++) {
      const i = this.shardPicks[j];
      const s = SINGER_SHARDS[i];
      const bx = this.births[i * 3];
      const by = this.births[i * 3 + 1];
      const bz = this.births[i * 3 + 2];
      const floor =
        h.groundY(this.stage.position.x + bx, this.stage.position.z + bz) - this.stage.position.y;
      const f = singerShardAt(s, since, by - floor - 0.1, _sf);
      if (f.scale <= 0.005) {
        this.shards.setMatrixAt(j, _zero);
        continue;
      }
      any = true;
      if (f.hanging) hanging++;
      const yaw = this.yaws[i];
      const x = bx + Math.sin(yaw) * f.out;
      const z = bz + Math.cos(yaw) * f.out;
      const y = by + f.y;
      _axis.set(Math.sin(i * 1.3), 0.7, Math.cos(i * 2.7)).normalize();
      _q.setFromAxisAngle(_axis, f.turn + i);
      const w = f.scale;
      _m.compose(_p.set(x, y, z), _q, _s.set(w * 0.42, w * 1.5, w * 0.42));
      this.shards.setMatrixAt(j, _m);
      this.shards.setColorAt(j, _c.setRGB(0.5 + 1.1 * f.glint, 1, 1));
      this.at[j * 3] = this.stage.position.x + x;
      this.at[j * 3 + 1] = this.stage.position.y + y;
      this.at[j * 3 + 2] = this.stage.position.z + z;
      if (f.landed && !this.landed[i]) {
        this.landed[i] = 1;
        if (f.sinceLand < 0.25)
          h.particles.puff(
            this.at[j * 3],
            this.at[j * 3 + 1] + 0.15,
            this.at[j * 3 + 2],
            3,
            TINKLE,
          );
      }
    }
    this.shards.visible = any;
    if (any) {
      this.shards.instanceMatrix.needsUpdate = true;
      if (this.shards.instanceColor) this.shards.instanceColor.needsUpdate = true;
    }
    // The glitter round the hanging shards.
    if (hanging > 0) {
      this.glitterDebt += dt * COUNCIL_DEATH_RATES.glitter * h.density;
      if (this.glitterDebt > 10) this.glitterDebt = 10;
      while (this.glitterDebt >= 1) {
        this.glitterDebt -= 1;
        const j = Math.floor(h.rand() * this.shardPicks.length);
        GLITTER.color = h.rand() < 0.5 ? WHITE : AMBER;
        h.particles.puff(this.at[j * 3], this.at[j * 3 + 1], this.at[j * 3 + 2], 1, GLITTER);
      }
    }
  }
}

// ---- particles' options (written in place) ------------------------------------------------------

const BURST = {
  speed: 18,
  up: 2,
  life: 1.1,
  size: [0.6, 0.08] as [number, number],
  color: WHITE,
  alpha: 1,
  pool: 'glow' as const,
  drag: 1.4,
  radius: 1.5,
};
const GLITTER = {
  speed: 0.6,
  up: -0.4,
  life: 0.7,
  size: [0.32, 0.04] as [number, number],
  color: WHITE,
  alpha: 1,
  pool: 'glow' as const,
  drag: 0.8,
  radius: 0.5,
  floor: -1e6,
};
const TINKLE = {
  speed: 2,
  up: 2,
  life: 0.5,
  size: [0.3, 0.05] as [number, number],
  color: WHITE,
  alpha: 1,
  pool: 'glow' as const,
  drag: 1,
  radius: 0.3,
};

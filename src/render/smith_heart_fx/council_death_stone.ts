// The Guardian of the Hammer's death (plan: council_death_core.ts), a part of
// CouncilDeathFx (council_death_fx.ts, which owns the root, the particles,
// the light cards, the clock and the body's points and paints it each frame):
//  - the blaze: gold light bursting out of every rock of it (a card on each
//    of its bones' sockets), racing up it from its feet to its crown, sparks
//    spitting off the cracks, white-hot at the front;
//  - the kneel: dust and a ring where its knees strike;
//  - the split: heavy slabs of the quarry's sandstone break off its body
//    where its rocks hang (the entrance's own stone program, its seams
//    molten), slumping out and down, tumbling, landing with a puff of dust
//    and a thud each, skidding to rest, their seams cooling to embers and
//    dark; a hail of smaller rubble;
//  - the core: the amber light in its chest burning through the blaze,
//    surging at the split, then guttering (each flare weaker) and going out
//    in a wisp of smoke.
// The slabs draw on every tier (they are its body coming apart); the low
// tier thins the rubble, the sparks and the dust.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (one gated attach); fixed pools, no
// light, no per-frame allocation.

import * as THREE from 'three';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  COUNCIL_DEATH_CHEST,
  COUNCIL_DEATH_HEIGHT,
  COUNCIL_DEATH_RATES,
  COUNCIL_DEATH_SHAKES,
  councilDeathCrossed,
  councilDeathKept,
  councilDeathLight,
  councilLeakLevel,
  GUARDIAN_CHUNKS,
  GUARDIAN_DEATH,
  GUARDIAN_LEAKS,
  GUARDIAN_POINTS,
  GUARDIAN_SLABS,
  type GuardianDeathLook,
  guardianChunkAt,
  guardianSlabAt,
  newSlabFlight,
} from './council_death_core';
import { STONE_FRAG, STONE_VERT } from './council_entrance_glsl';
import { rockGeometry } from './council_entrance_stone';

const D = GUARDIAN_DEATH;
const H = COUNCIL_DEATH_HEIGHT.guardian;
const CHEST = COUNCIL_DEATH_CHEST.guardian;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _fl = newSlabFlight();

const GOLD: readonly [number, number, number] = [1, 0.66, 0.22];
const WHITE: readonly [number, number, number] = [1, 0.93, 0.74];
const DUST: readonly [number, number, number] = [0.5, 0.42, 0.33];
const SMOKE: readonly [number, number, number] = [0.16, 0.13, 0.12];
const SPARK_SIZE: readonly [number, number] = [0.45, 0.06];

/** A body's frame this frame (world yards): its feet, its facing and its
 *  points (the role's points, xyz each, from the model's sockets or the
 *  plan's fallback). */
export interface CouncilDeathBody {
  x: number;
  y: number;
  z: number;
  facing: number;
  readonly pts: Float32Array;
}

/** What the part reads off its host. */
export interface CouncilDeathPartHost {
  readonly particles: EngineParticles;
  readonly density: number;
  readonly uTime: { value: number };
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  rand(): number;
  reducedMotion(): boolean;
  groundY(x: number, z: number): number;
  /** A soft round light card at a world point (this frame only). */
  card(x: number, y: number, z: number, size: number, r: number, g: number, b: number): void;
  /** A flash over the world (never under the floor), this frame only. */
  flash(x: number, y: number, z: number, size: number, r: number, g: number, b: number): void;
  /** A shaft of light out of a body (this frame only): its root, its heading
   *  (yaw, pitch), length and width (yards), strength and flicker seed. */
  shaft(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    len: number,
    width: number,
    level: number,
    seed: number,
  ): void;
  /** A thud felt by this viewer. */
  thud(amount: number, reach: number, x: number, z: number): void;
}

export class CouncilDeathStone {
  /** Laid on the Guardian's feet as it splits (the stone's noise and its
   *  seams read their place off it, never a world point a hundred thousand
   *  yards out). */
  readonly stage = new THREE.Group();
  private readonly slabs: THREE.InstancedMesh;
  private readonly chunks: THREE.InstancedMesh;
  private readonly stoneMat: THREE.ShaderMaterial;
  private readonly chunkPicks: number[];
  /** Where each slab broke off (stage-local) and its heading out, held from
   *  the split (or the first sight of a corpse past it). */
  private readonly births: Float32Array;
  private readonly heads: Float32Array;
  private born = false;
  private readonly landed: Uint8Array;
  private sparkDebt = 0;
  private dustDebt = 0;

  constructor(
    parent: THREE.Object3D,
    private readonly h: CouncilDeathPartHost,
  ) {
    this.stage.name = 'smithHeartCouncilDeathStone';
    this.stage.visible = false;
    parent.add(this.stage);
    const slabGeo = rockGeometry(17, 0.3);
    const chunkGeo = rockGeometry(41, 0.5);
    h.geometries.push(slabGeo, chunkGeo);
    // The entrance's stone (council_entrance_glsl.ts: one program with the
    // spur's), every seam shown, molten by `uHeat`, an ember by `uEmber`.
    this.stoneMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilDeathStoneMat',
      uniforms: {
        uCrack: { value: 1 },
        uHeat: { value: 0 },
        uHeight: { value: H },
        uEmber: { value: 0 },
        uTime: h.uTime,
        uTint: { value: 0.75 },
      },
      vertexShader: STONE_VERT,
      fragmentShader: STONE_FRAG,
    });
    h.materials.push(this.stoneMat);
    this.slabs = new THREE.InstancedMesh(slabGeo, this.stoneMat, GUARDIAN_SLABS.length);
    this.slabs.name = 'smithHeartCouncilDeathSlabs';
    this.slabs.frustumCulled = false;
    this.slabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < GUARDIAN_SLABS.length; i++) this.slabs.setMatrixAt(i, _zero);
    this.stage.add(this.slabs);
    this.chunkPicks = [];
    for (let i = 0; i < GUARDIAN_CHUNKS.length; i++)
      if (councilDeathKept(i, h.density)) this.chunkPicks.push(i);
    this.chunks = new THREE.InstancedMesh(chunkGeo, this.stoneMat, this.chunkPicks.length);
    this.chunks.name = 'smithHeartCouncilDeathRubble';
    this.chunks.frustumCulled = false;
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.chunkPicks.length; i++) this.chunks.setMatrixAt(i, _zero);
    this.stage.add(this.chunks);
    this.births = new Float32Array(GUARDIAN_SLABS.length * 3);
    this.heads = new Float32Array(GUARDIAN_SLABS.length);
    this.landed = new Uint8Array(GUARDIAN_SLABS.length);
  }

  /** Nothing to draw (no body, or the scene and its rubble are over). */
  hide(): void {
    this.stage.visible = false;
    this.born = false;
  }

  /** The scene starts again (a replay, a death after a wipe). */
  reset(): void {
    this.born = false;
    this.landed.fill(0);
  }

  /** Paint the Guardian at scene time `t` (`prev` last frame's), rubble
   *  shown while `rubble` holds (a corpse keeps it; a replay sinks it). */
  paint(
    look: GuardianDeathLook,
    body: CouncilDeathBody,
    t: number,
    prev: number,
    dt: number,
    sink: number,
  ): void {
    const h = this.h;
    const reduced = h.reducedMotion();
    const crossed = (at: number) => councilDeathCrossed(prev, t, at);
    // ---- the blaze: light out of every rock, feet to crown ----
    if (look.blaze > 0.01 && look.sinceSplit < 0.5) {
      const tt = h.uTime.value;
      let shown = 0;
      for (let i = 0; i < GUARDIAN_POINTS.length; i++) {
        const p = GUARDIAN_POINTS[i];
        if (look.seams < p.h) continue;
        shown++;
        const front = Math.exp(-(((look.seams - p.h) * 7) ** 2));
        const flick = reduced ? 1 : 0.8 + 0.2 * Math.sin(tt * 13 + i * 2.3);
        const k = look.blaze * flick * (0.85 + 0.8 * front);
        const x = body.pts[i * 3];
        const y = body.pts[i * 3 + 1];
        const z = body.pts[i * 3 + 2];
        const size = p.size * H * (1.7 + 1.1 * front);
        h.card(x, y, z, size * 1.7, 1.3 * k, 0.62 * k, 0.14 * k);
        h.card(x, y, z, size * 0.7, 1.5 * k, 1.2 * k, 0.7 * k);
      }
      // Sparks spat off the cracks.
      this.sparkDebt +=
        dt *
        COUNCIL_DEATH_RATES.seamSparks *
        look.blaze *
        h.density *
        (shown / GUARDIAN_POINTS.length);
      if (this.sparkDebt > 12) this.sparkDebt = 12;
      while (this.sparkDebt >= 1) {
        this.sparkDebt -= 1;
        const i = Math.floor(h.rand() * GUARDIAN_POINTS.length);
        if (look.seams < GUARDIAN_POINTS[i].h) continue;
        SPARK.speed = 5 + h.rand() * 7;
        SPARK.color = h.rand() < 0.3 ? WHITE : GOLD;
        SPARK.floor = body.y;
        h.particles.puff(body.pts[i * 3], body.pts[i * 3 + 1], body.pts[i * 3 + 2], 1, SPARK);
      }
    }
    // ---- the shafts of gold breaking out between its rocks ----
    if (look.sinceSplit < 0) {
      for (let i = 0; i < GUARDIAN_LEAKS.length; i++) {
        const l = GUARDIAN_LEAKS[i];
        const lv = councilDeathLight(councilLeakLevel(l, t, look.blaze, D.splitAt), reduced);
        if (lv <= 0.002) continue;
        const open = Math.min(1, (t - l.at) / 0.22);
        h.shaft(
          body.pts[l.point * 3],
          body.pts[l.point * 3 + 1],
          body.pts[l.point * 3 + 2],
          body.facing + l.yaw,
          l.pitch,
          l.len * H * (0.35 + 0.65 * open),
          l.width * H * 1.7,
          lv * 1.6,
          i / GUARDIAN_LEAKS.length,
        );
      }
    }
    // ---- the core in its chest ----
    if (look.core > 0.01) {
      const tt = h.uTime.value;
      const flick = reduced ? 1 : 0.85 + 0.15 * Math.sin(tt * 21) * Math.sin(tt * 7.3);
      const k = Math.min(2, look.core) * flick;
      const cx = body.pts[CHEST * 3];
      // Lifted off the chest rock (once it lies in the rubble, its light
      // glows up out of it).
      const cy = body.pts[CHEST * 3 + 1] + H * 0.06;
      const cz = body.pts[CHEST * 3 + 2];
      h.card(cx, cy, cz, H * (0.32 + 0.12 * k), 0.95 * k, 0.5 * k, 0.12 * k);
      h.card(cx, cy, cz, H * 0.12, k, 0.86 * k, 0.55 * k);
    }
    // ---- the moments ----
    if (crossed(D.kneelAt)) {
      h.particles.puff(body.x, body.y + 0.5, body.z, 34, KNEEL_DUST);
      h.particles.shockRing(body.x, body.z, 0xffc070, 18, 0.7, {
        wake: 0.3,
        crest: 0.08,
        strength: 0.6,
      });
      h.thud(COUNCIL_DEATH_SHAKES.kneel.amount, COUNCIL_DEATH_SHAKES.kneel.reach, body.x, body.z);
    }
    if (crossed(D.splitAt)) this.split(body);
    for (let g = 0; g < D.gutters.length; g++) {
      if (!crossed(D.gutters[g])) continue;
      EMBER_PUFF.speed = 2.5 - g * 0.5;
      h.particles.puff(
        body.pts[CHEST * 3],
        body.pts[CHEST * 3 + 1],
        body.pts[CHEST * 3 + 2],
        Math.round(18 - g * 4),
        EMBER_PUFF,
      );
    }
    if (crossed(D.coreOut)) {
      // The last wisp of smoke out of the cold chest.
      h.particles.puff(
        body.pts[CHEST * 3],
        body.pts[CHEST * 3 + 1] + 0.5,
        body.pts[CHEST * 3 + 2],
        14,
        WISP,
      );
    }
    // ---- the slabs and the rubble ----
    if (look.sinceSplit < 0 || sink <= 0) {
      this.stage.visible = false;
      if (look.sinceSplit < 0) this.born = false;
      return;
    }
    if (!this.born) this.bear(body);
    this.stage.visible = true;
    const u = this.stoneMat.uniforms;
    u.uHeat.value = look.slabHeat;
    u.uEmber.value = look.slabEmber;
    this.paintSlabs(look.sinceSplit, sink);
    this.paintChunks(body, look.sinceSplit, sink);
    // Dust off the slumping stone.
    if (look.sinceSplit < 1.4) {
      this.dustDebt += dt * COUNCIL_DEATH_RATES.slabDust * h.density;
      if (this.dustDebt > 8) this.dustDebt = 8;
      while (this.dustDebt >= 1) {
        this.dustDebt -= 1;
        const i = Math.floor(h.rand() * GUARDIAN_SLABS.length);
        h.particles.puff(
          this.stage.position.x + this.births[i * 3],
          this.stage.position.y + this.births[i * 3 + 1],
          this.stage.position.z + this.births[i * 3 + 2],
          1,
          SLUMP_DUST,
        );
      }
    }
  }

  /** The split: the slabs' births (where each rock hangs now), the burst of
   *  gold light and dust, the thud. */
  private split(body: CouncilDeathBody): void {
    const h = this.h;
    this.bear(body);
    const cx = body.pts[CHEST * 3];
    const cy = body.pts[CHEST * 3 + 1];
    const cz = body.pts[CHEST * 3 + 2];
    h.flash(cx, cy, cz, H * 1.5, 1, 0.7, 0.34);
    h.particles.puff(cx, cy, cz, 70, SPLIT_SPARKS);
    h.particles.puff(body.x, body.y + 1, body.z, 46, SPLIT_DUST);
    h.particles.shockRing(body.x, body.z, 0xffb050, 26, 0.9, {
      wake: 0.25,
      crest: 0.07,
      strength: 0.75,
    });
    h.thud(COUNCIL_DEATH_SHAKES.split.amount, COUNCIL_DEATH_SHAKES.split.reach, body.x, body.z);
  }

  /** Hold each slab's birth off the body's points now (stage-local), and
   *  lay the stage on its feet. */
  private bear(body: CouncilDeathBody): void {
    this.stage.position.set(body.x, body.y, body.z);
    this.stage.updateMatrixWorld();
    const fx = Math.sin(body.facing);
    const fz = Math.cos(body.facing);
    for (let i = 0; i < GUARDIAN_SLABS.length; i++) {
      const s = GUARDIAN_SLABS[i];
      const lx = body.pts[s.point * 3] - body.x;
      const ly = body.pts[s.point * 3 + 1] - body.y;
      const lz = body.pts[s.point * 3 + 2] - body.z;
      this.births[i * 3] = lx;
      this.births[i * 3 + 1] = ly;
      this.births[i * 3 + 2] = lz;
      // Out from the body's axis (a rock on its axis falls forward or back).
      const r = Math.hypot(lx, lz);
      const base = r > 0.6 ? Math.atan2(lx, lz) : Math.atan2(fx, fz) + (i % 2 ? Math.PI : 0);
      this.heads[i] = base + s.veer;
    }
    this.landed.fill(0);
    this.born = true;
  }

  private paintSlabs(since: number, sink: number): void {
    const h = this.h;
    for (let i = 0; i < GUARDIAN_SLABS.length; i++) {
      const s = GUARDIAN_SLABS[i];
      const bx = this.births[i * 3];
      const by = this.births[i * 3 + 1];
      const bz = this.births[i * 3 + 2];
      const wx = this.stage.position.x + bx;
      const wz = this.stage.position.z + bz;
      const floor = h.groundY(wx, wz) - this.stage.position.y;
      const drop = by - floor - s.sy * 0.45;
      const f = guardianSlabAt(s, since, drop, _fl);
      const a = this.heads[i];
      const x = bx + Math.sin(a) * f.out;
      const z = bz + Math.cos(a) * f.out;
      const y = by + f.y - (1 - sink) * s.sy;
      // Tumbling in the air, settling onto its broad face at rest.
      _axis.set(Math.cos(a), 0, -Math.sin(a));
      _q.setFromAxisAngle(_axis, f.turn * (1 - f.settle) + s.rest * f.settle);
      _q2.setFromAxisAngle(_up, a + i * 0.7);
      _q.multiply(_q2);
      const k = f.scale * sink;
      _m.compose(_p.set(x, y, z), _q, _s.set(s.sx * k, s.sy * k, s.sz * k));
      this.slabs.setMatrixAt(i, _m);
      if (f.landed && !this.landed[i]) {
        this.landed[i] = 1;
        // Only a landing seen happening throws dust (a corpse first seen
        // lies still).
        if (f.sinceLand < 0.3) {
          const lx = this.stage.position.x + x;
          const lz = this.stage.position.z + z;
          LAND_DUST.radius = s.sx * 0.6;
          h.particles.puff(lx, h.groundY(lx, lz) + 0.3, lz, Math.round(6 + s.sx * 4), LAND_DUST);
          if (s.sx > H * 0.12)
            h.thud(COUNCIL_DEATH_SHAKES.land.amount, COUNCIL_DEATH_SHAKES.land.reach, lx, lz);
        }
      }
    }
    this.slabs.instanceMatrix.needsUpdate = true;
  }

  private paintChunks(body: CouncilDeathBody, since: number, sink: number): void {
    const h = this.h;
    for (let j = 0; j < this.chunkPicks.length; j++) {
      const c = GUARDIAN_CHUNKS[this.chunkPicks[j]];
      const bx = body.pts[c.point * 3] - this.stage.position.x;
      const by = body.pts[c.point * 3 + 1] - this.stage.position.y;
      const bz = body.pts[c.point * 3 + 2] - this.stage.position.z;
      const floor =
        h.groundY(body.pts[c.point * 3], body.pts[c.point * 3 + 2]) - this.stage.position.y;
      const f = guardianChunkAt(c, since, by - floor - 0.2, _fl);
      if (f.scale <= 0.01 || sink <= 0) {
        this.chunks.setMatrixAt(j, _zero);
        continue;
      }
      const x = bx + Math.sin(c.angle) * f.out;
      const z = bz + Math.cos(c.angle) * f.out;
      _axis.set(Math.sin(j * 1.7), 0.5, Math.cos(j * 2.9)).normalize();
      _q.setFromAxisAngle(_axis, f.turn);
      const k = f.scale * sink;
      _m.compose(_p.set(x, by + f.y, z), _q, _s.set(k, k * 0.8, k * 1.1));
      this.chunks.setMatrixAt(j, _m);
    }
    this.chunks.instanceMatrix.needsUpdate = true;
  }
}

// ---- particles' options (written in place) ------------------------------------------------------

const SPARK = {
  speed: 6,
  up: 2,
  life: 0.7,
  size: SPARK_SIZE,
  color: GOLD,
  alpha: 1,
  pool: 'glow' as const,
  gravity: 9,
  drag: 0.6,
  radius: 0.6,
  floor: 0,
};
const KNEEL_DUST = {
  speed: 9,
  up: 1.4,
  life: 1.8,
  size: [2.2, 6.5] as [number, number],
  color: DUST,
  alpha: 0.42,
  drag: 1.4,
  radius: 4,
};
const SPLIT_SPARKS = {
  speed: 16,
  up: 3,
  life: 1,
  size: [0.7, 0.1] as [number, number],
  color: GOLD,
  alpha: 1,
  pool: 'glow' as const,
  drag: 0.9,
  radius: 2.5,
};
const SPLIT_DUST = {
  speed: 10,
  up: 2,
  life: 2.4,
  size: [3, 8.5] as [number, number],
  color: DUST,
  alpha: 0.4,
  drag: 1.3,
  radius: 5,
};
const SLUMP_DUST = {
  speed: 1.5,
  up: -1,
  life: 1.6,
  size: [1, 3] as [number, number],
  color: DUST,
  alpha: 0.3,
  drag: 1,
  radius: 1.2,
};
const LAND_DUST = {
  speed: 5,
  up: 0.8,
  life: 1.5,
  size: [1.2, 3.6] as [number, number],
  color: DUST,
  alpha: 0.45,
  drag: 1.6,
  radius: 1,
};
const EMBER_PUFF = {
  speed: 2,
  up: 2.2,
  life: 1.3,
  size: [0.4, 0.06] as [number, number],
  color: [1, 0.48, 0.14] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  drag: 0.7,
  radius: 0.8,
};
const WISP = {
  speed: 0.6,
  up: 3.2,
  life: 3,
  size: [1.2, 4.5] as [number, number],
  color: SMOKE,
  alpha: 0.5,
  drag: 0.4,
  radius: 0.8,
};

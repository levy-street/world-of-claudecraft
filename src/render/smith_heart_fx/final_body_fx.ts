// The Masterless Strength's own model in the fight (plan: final_body_core.ts),
// hosted by final_fx.ts (the arrival's clock, the heart, the death, the
// shared particles and flashes are its). Presentation only, read from IWorld
// through the host (the boss's drawn position, facing, scale, its state
// aura's zone):
//  - which of the rig's four element bodies shows (mesh toggles on the rig,
//    sent through the renderer's gesture seam and re-sent so a rebuilt view
//    shows the right body);
//  - the arrival's body (final_arrival_core.ts): dormant on its knee, its
//    cracks held black, then the push to its feet (its Rise clip) and the
//    roar that opens its first element;
//  - the transformation when the quarter changes: the shell cracks with the
//    light bleeding through its seams (the rig's glow pulse), the strength
//    drawn in to the heart, then on the roar's opening the burst of the new
//    element (its flash, a shockwave ring over the floor, its debris: rock
//    and dust, storm arcs and gusts, flame, frost shards and cold mist), the
//    crown re-forming in its light and the new aura settling;
//  - each element's aura round the body: floating rocks and grit for the
//    Hammer, gusts and crawling arcs for the Breath, flames and embers for
//    the Heat, falling rime and a cold mist at its feet for the Quench
//    (never an arc: the storm and the cold must never be confused);
//  - the false death's kneel (a stance swap on the rig).
// Cosmetic layers thin on the low tier (`density`) and under reduced motion
// (the shake); the body's colour (the rig's own materials) carries the
// element on every tier.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the host's root, before the host's gated attach; fixed pools, no
// per-frame allocation; no light.

import * as THREE from 'three';
import type { HeartQuarterZone } from '../../sim/content/smith_heart_quarters';
import type { Entity } from '../../sim/types';
import { fxAnchor } from '../attached_fx_anchor';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import type { ArrivalStance } from './final_arrival_core';
import {
  boltJoint,
  FINAL_AURA_RATES,
  FINAL_BODY_ELEMENTS,
  FINAL_BODY_GESTURES,
  FINAL_BODY_HEIGHT,
  FINAL_BODY_POOLS,
  FINAL_BURST_COUNTS,
  FINAL_ELEMENT_LOOK,
  FINAL_SHIFT,
  type FinalBodyAnchor,
  type FinalBodyElement,
  finalBodyElement,
  finalBodyPoint,
  finalRockOrbit,
  finalShiftAura,
  finalShiftStage,
  finalShiftStarts,
} from './final_body_core';
import { colossusChunk, colossusRockMaterial } from './final_kit_shapes';

/** What the host lends: its particles, flashes, camera thud and dice. */
export interface FinalBodyHost {
  readonly particles: EngineParticles;
  readonly density: number;
  flash(x: number, y: number, z: number, size: number, span: number, color: number): void;
  shakeNear(x: number, z: number, amount: number, reach?: number): void;
  rand(): number;
  groundY(x: number, z: number): number;
}

/** The frame the host hands over each update. */
export interface FinalBodyFrame {
  boss: Entity;
  zone: HeartQuarterZone;
  /** The arrival is over (or was never seen): the model stands whole. */
  whole: boolean;
  /** The arrival is under way (final_arrival_core.ts arrivalForming): no
   *  element aura until it roars awake. */
  forming: boolean;
  /** The stance the rig holds (final_arrival_core.ts arrivalStance). */
  stance: ArrivalStance;
  /** The stone's cracks held black (the dormant statue). */
  dark: boolean;
  dead: boolean;
  clock: number;
  dt: number;
}

/** Seconds between re-sends of the held state (a view rebuilt mid-fight). */
const RESEND_SEC = 0.75;
/** Seconds between re-sends of the dark pulse (it rises at once and holds
 *  1 s, so the stone stays dark while it is re-sent, even on a slow frame,
 *  and fills back once it stops). */
const DARK_EVERY = 0.35;
const BOLT_N = FINAL_BODY_POOLS.boltArcs * FINAL_BODY_POOLS.boltSegments;
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _c = new THREE.Color();
const _p = { x: 0, y: 0, z: 0 };
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };
const _j0 = { x: 0, y: 0, z: 0 };
const _j1 = { x: 0, y: 0, z: 0 };

interface Arc {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  born: number;
  span: number;
  seed: number;
  width: number;
  color: number;
}

export class FinalBodyFx {
  private readonly bolts: THREE.InstancedMesh;
  private readonly rocks: THREE.InstancedMesh;
  private disposed = false;
  private readonly arcs: Arc[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /** The element the rig shows now (null: never sent). */
  private shown: FinalBodyElement | null = null;
  private bodyShown: boolean | null = null;
  private stanceSent: ArrivalStance | null = null;
  private darkIn = 0;
  private wasForming = false;
  private resendIn = 0;
  private bossId = -1;
  private shiftAt = -99;
  private shiftFrom: FinalBodyElement = 'hammer';
  private shiftTo: FinalBodyElement = 'hammer';
  private shiftBurstDone = true;
  private auraDebt = 0;
  private arcDebt = 0;
  private rockScale = 0;
  private height = FINAL_BODY_HEIGHT;
  private bx = 0;
  private by = 0;
  private bz = 0;
  private facing = 0;
  private nowClock = 0;

  constructor(
    root: THREE.Group,
    private readonly host: FinalBodyHost,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    for (let i = 0; i < FINAL_BODY_POOLS.boltArcs; i++)
      this.arcs.push({
        ax: 0,
        ay: 0,
        az: 0,
        bx: 0,
        by: 0,
        bz: 0,
        born: -99,
        span: 0,
        seed: 0,
        width: 0,
        color: 0,
      });
    // The storm's arcs: one instanced draw of thin glowing segments.
    const boltGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
    this.geometries.push(boltGeo);
    const boltMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      name: 'smithHeartFinalBodyBolts',
    });
    this.materials.push(boltMat);
    this.bolts = new THREE.InstancedMesh(boltGeo, boltMat, BOLT_N);
    this.bolts.name = 'smithHeartFinalBodyBolts';
    this.bolts.frustumCulled = false;
    this.bolts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < BOLT_N; i++) {
      this.bolts.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.bolts.setColorAt(i, _c.setHex(0xffffff));
    }
    this.bolts.visible = false;
    root.add(this.bolts);
    // The Hammer's floating rocks: one instanced draw, lit like the body.
    // Sculpted pieces of the colossus (final_kit_shapes.ts colossusChunk:
    // knocked out of round, split flat, toned with a gold vein), never a bare
    // polyhedron, which read as a placeholder cube in front of the hammer.
    const rockGeo = colossusChunk();
    this.geometries.push(rockGeo);
    const rockMat = colossusRockMaterial('smithHeartFinalBodyRocks');
    this.materials.push(rockMat);
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, FINAL_BODY_POOLS.rocks);
    this.rocks.name = 'smithHeartFinalBodyRocks';
    this.rocks.frustumCulled = false;
    this.rocks.castShadow = false;
    this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FINAL_BODY_POOLS.rocks; i++)
      this.rocks.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.rocks.visible = false;
    root.add(this.rocks);
  }

  /** The body is gone from view (no boss in range): forget the sent state so
   *  the next sight re-sends it whole. */
  lost(): void {
    this.bossId = -1;
    this.shown = null;
    this.bodyShown = null;
    this.stanceSent = null;
    this.darkIn = 0;
    this.bolts.visible = false;
    this.rocks.visible = false;
    this.rockScale = 0;
  }

  update(f: FinalBodyFrame): void {
    const boss = f.boss;
    this.nowClock = f.clock;
    if (boss.id !== this.bossId) {
      this.lost();
      this.bossId = boss.id;
    }
    // The body's frame this update.
    const at = fxAnchor(boss);
    this.bx = at.x;
    this.bz = at.z;
    this.by = this.host.groundY(at.x, at.z);
    this.facing = boss.facing;
    this.height = FINAL_BODY_HEIGHT * (boss.scale > 0 ? boss.scale : 1);
    this.resendIn -= f.dt;
    const resend = this.resendIn <= 0;
    if (resend) this.resendIn = RESEND_SEC;
    // A corpse keeps the body it died in (its state aura is gone with it).
    const next = f.dead && this.shown ? this.shown : finalBodyElement(f.zone);
    // The model always shows: dormant before and through the arrival.
    const showBody = true;
    // Formed: it roars awake (its Shift clip, the first element bursting).
    const awoke = this.wasForming && !f.forming && !f.dead;
    this.wasForming = f.forming;
    // The transformation starts on a quarter change of a body seen whole.
    if (
      !f.dead &&
      finalShiftStarts(
        this.shiftBurstDone ? this.shown : this.shiftTo,
        next,
        showBody && this.bodyShown === true,
      )
    ) {
      this.shiftFrom = this.shiftBurstDone ? (this.shown ?? next) : this.shiftTo;
      this.shiftTo = next;
      this.shiftAt = f.clock;
      this.shiftBurstDone = false;
      this.send(FINAL_BODY_GESTURES.shift);
      this.send(FINAL_BODY_GESTURES.charge);
    }
    const age = f.clock - this.shiftAt;
    if (!this.shiftBurstDone && (age >= FINAL_SHIFT.burst || f.dead)) {
      this.shiftBurstDone = true;
      if (!f.dead) this.burst(this.shiftTo);
    }
    // The element the rig should wear: the old one until the burst.
    const wear = this.shiftBurstDone ? next : this.shiftFrom;
    if (wear !== this.shown || resend) this.sendElement(wear);
    if (showBody !== this.bodyShown || resend) {
      this.send(showBody ? FINAL_BODY_GESTURES.show : FINAL_BODY_GESTURES.hide);
      this.bodyShown = showBody;
    }
    // The stance: dormant on its knee, the push to its feet (once, on the
    // change: a re-send mid-push only names the standing stance), standing,
    // the false death's kneel.
    if (f.stance !== this.stanceSent || resend) {
      const fresh = f.stance !== this.stanceSent;
      this.send(
        f.stance === 'dormant'
          ? FINAL_BODY_GESTURES.dormant
          : f.stance === 'kneel'
            ? FINAL_BODY_GESTURES.kneel
            : f.stance === 'rise' && fresh && this.stanceSent === 'dormant'
              ? FINAL_BODY_GESTURES.rise
              : FINAL_BODY_GESTURES.stand,
      );
      this.stanceSent = f.stance;
    }
    // The dormant stone: its cracks black while the pulse is re-sent; lit,
    // they fill back over the pulse's fall and flare.
    if (f.dark) {
      this.darkIn -= f.dt;
      if (this.darkIn <= 0) {
        this.darkIn = DARK_EVERY;
        this.send(FINAL_BODY_GESTURES.dark);
      }
    } else if (this.darkIn !== 0) {
      this.darkIn = 0;
      this.send(FINAL_BODY_GESTURES.charge);
    }
    if (awoke) {
      this.send(FINAL_BODY_GESTURES.shift);
      this.send(FINAL_BODY_GESTURES.charge);
    }
    if (!showBody || f.dead || f.forming) {
      this.rockScale = Math.max(0, this.rockScale - f.dt * 2);
      this.paintRocks(f.clock, 0);
      this.paintBolts(f.clock);
      return;
    }
    if (!this.shiftBurstDone) this.charge(age, f.dt);
    else if (age < FINAL_SHIFT.crownEnd) this.crown(age, f.dt);
    // The auras: the old one dying through the charge, the new one hot after.
    const [oldK, newK] = finalShiftAura(age);
    if (!this.shiftBurstDone) this.aura(this.shiftFrom, oldK, f.dt);
    else this.aura(next, newK, f.dt);
    const rocksOn = FINAL_ELEMENT_LOOK[wear].rocks ? (this.shiftBurstDone ? 1 : oldK) : 0;
    this.rockScale += (rocksOn - this.rockScale) * Math.min(1, f.dt * 3);
    this.paintRocks(f.clock, this.rockScale);
    this.paintBolts(f.clock);
  }

  private send(gesture: string): void {
    if (this.bossId >= 0) this.playGesture?.(this.bossId, gesture);
  }

  private sendElement(el: FinalBodyElement): void {
    for (const e of FINAL_BODY_ELEMENTS) if (e !== el) this.send(FINAL_BODY_GESTURES.off[e]);
    this.send(FINAL_BODY_GESTURES.on[el]);
    this.shown = el;
  }

  private point(a: FinalBodyAnchor, out: { x: number; y: number; z: number }) {
    return finalBodyPoint(a, this.bx, this.by, this.bz, this.facing, this.height, out);
  }

  // ---- the transformation --------------------------------------------------------------

  /** The shell cracking: light bleeding out of the seams and drawn into the
   *  heart in the new element's colour, grit shaken off, the floor humming. */
  private charge(age: number, dt: number): void {
    const H = this.height;
    const k = Math.min(1, age / FINAL_SHIFT.burst);
    const look = FINAL_ELEMENT_LOOK[this.shiftTo];
    const p = this.host.particles;
    const heart = this.point('heart', _p);
    const n = Math.round(dt * (40 + 120 * k) * this.host.density + this.host.rand());
    for (let i = 0; i < n; i++) {
      // Born on the body's surface, streaming into the heart.
      const a = this.host.rand() * Math.PI * 2;
      const r = H * (0.18 + 0.14 * this.host.rand());
      const y = this.by + H * (0.15 + 0.75 * this.host.rand());
      const sx = this.bx + Math.cos(a) * r;
      const sz = this.bz + Math.sin(a) * r;
      _v.set(heart.x - sx, heart.y - y, heart.z - sz);
      const len = _v.length() || 1;
      p.puff(sx, y, sz, 1, {
        speed: len * 2.2,
        life: 0.45,
        size: [0.35 + 0.5 * k, 0.1],
        color: look.spark,
        alpha: 1,
        pool: 'glow',
        dir: [_v.x / len, _v.y / len, _v.z / len],
        spread: 0.05,
        drag: 0.2,
      });
    }
    // Light bleeding out of the cracks: hot sparks spat off the shell.
    if (this.host.rand() < dt * 24 * this.host.density) {
      const anchor: FinalBodyAnchor = this.host.rand() < 0.5 ? 'shoulderL' : 'shoulderR';
      const s = this.point(this.host.rand() < 0.4 ? 'hip' : anchor, _a);
      p.puff(s.x, s.y, s.z, 3, {
        speed: 6,
        up: 2,
        life: 0.5,
        size: [0.5, 0.1],
        color: [1, 0.95, 0.85],
        alpha: 1,
        pool: 'glow',
        radius: H * 0.1,
      });
    }
    // Grit shaken off the old shell, dust at its feet.
    if (this.host.rand() < dt * 10 * this.host.density) {
      const s = this.point('hip', _a);
      p.puff(s.x, s.y + H * 0.2, s.z, 2, {
        speed: 1,
        life: 1.2,
        size: [0.35, 0.3],
        color: [0.24, 0.21, 0.2],
        alpha: 1,
        gravity: 16,
        radius: H * 0.18,
      });
      p.puff(this.bx, this.by + 0.4, this.bz, 1, {
        speed: 3,
        up: 0.6,
        life: 1.4,
        size: [2, 5],
        color: [0.42, 0.38, 0.36],
        alpha: 0.3,
        radius: H * 0.2,
      });
    }
    // The heart swells: a growing glow at the chest, a low thrum in the camera.
    if (this.host.rand() < dt * 4) {
      this.host.flash(heart.x, heart.y, heart.z, H * (0.12 + 0.18 * k), 0.2, look.light);
    }
    if (k > 0.55 && this.host.rand() < dt * 6)
      this.host.shakeNear(this.bx, this.bz, 0.08 + 0.12 * k);
  }

  /** The burst: the new element floods out of the body. */
  private burst(el: FinalBodyElement): void {
    const H = this.height;
    const look = FINAL_ELEMENT_LOOK[el];
    const p = this.host.particles;
    const d = this.host.density;
    const heart = this.point('heart', _p);
    const hx = heart.x;
    const hy = heart.y;
    const hz = heart.z;
    // The flash: the element's colour round a white-hot core, seen from across the Anvil.
    // A short, capped peak: the body stays readable through it.
    this.host.flash(hx, hy, hz, H * 1.2, 0.3, look.light);
    this.host.flash(hx, hy, hz, H * 0.45, 0.15, look.core);
    // The shockwave over the floor: the element's ring and a slower wake.
    p.shockRing(this.bx, this.bz, look.light, H * 2.6, 0.9);
    p.shockRing(this.bx, this.bz, look.core, H * 1.5, 0.55);
    p.shockRing(this.bx, this.bz, look.light, H * 4.2, 1.6);
    // Sparks of the element flung out of the heart in every direction.
    for (let i = 0; i < Math.round(FINAL_BURST_COUNTS.sparks * d) + 8; i++) {
      const a = this.host.rand() * Math.PI * 2;
      p.puff(hx, hy, hz, 1, {
        speed: H * (1.1 + this.host.rand() * 0.8),
        life: 0.9,
        size: [0.7, 0.12],
        color: look.spark,
        alpha: 1,
        pool: 'glow',
        dir: [Math.cos(a), -0.2 + this.host.rand() * 0.8, Math.sin(a)],
        spread: 0.15,
        drag: 0.8,
      });
    }
    if (el === 'hammer') {
      // Stone torn off the shell: chunks thrown and falling, a wall of dust.
      p.puff(hx, hy, hz, FINAL_BURST_COUNTS.debris, {
        speed: H * 0.75,
        up: H * 0.45,
        life: 1.6,
        size: [0.9, 0.7],
        color: [0.24, 0.2, 0.19],
        alpha: 1,
        gravity: 26,
        drag: 0.3,
        radius: H * 0.1,
      });
      p.puff(this.bx, this.by + 1, this.bz, FINAL_BURST_COUNTS.mist, {
        speed: H * 0.6,
        up: 1.5,
        life: 2.2,
        size: [3, 9],
        color: look.mist,
        alpha: 0.42,
        drag: 1.3,
        radius: H * 0.2,
      });
      p.puff(this.bx, this.by + 0.6, this.bz, 30, {
        speed: H * 0.5,
        up: H * 0.25,
        life: 1.2,
        size: [0.45, 0.2],
        color: [0.3, 0.26, 0.24],
        alpha: 1,
        gravity: 22,
        radius: H * 0.3,
      });
    } else if (el === 'breath') {
      // The storm: arcs leap from the heart to the floor round it, a gale of white gusts.
      for (let i = 0; i < FINAL_BURST_COUNTS.bolts; i++) {
        const a = (i / FINAL_BURST_COUNTS.bolts) * Math.PI * 2 + this.host.rand() * 0.6;
        const r = H * (0.9 + this.host.rand() * 0.9);
        const x = this.bx + Math.cos(a) * r;
        const z = this.bz + Math.sin(a) * r;
        this.addArc(hx, hy, hz, x, this.host.groundY(x, z) + 0.2, z, 0.45, H * 0.035, 0xbfe0ff);
      }
      for (let i = 0; i < Math.round(FINAL_BURST_COUNTS.mist * 1.6 * d) + 6; i++) {
        const a = this.host.rand() * Math.PI * 2;
        const r = H * (0.3 + this.host.rand() * 0.3);
        // Tangential: the gale spins round the body.
        p.puff(
          this.bx + Math.cos(a) * r,
          this.by + H * this.host.rand() * 0.9,
          this.bz + Math.sin(a) * r,
          1,
          {
            speed: H * 0.9,
            life: 1.1,
            size: [2.4, 6],
            color: look.mist,
            alpha: 0.32,
            dir: [-Math.sin(a), 0.15, Math.cos(a)],
            spread: 0.2,
            drag: 1.1,
          },
        );
      }
    } else if (el === 'heat') {
      // The forge bursts: a column of flame, a ring of fire, embers raining.
      p.puff(this.bx, this.by + H * 0.3, this.bz, FINAL_BURST_COUNTS.flames, {
        speed: H * 0.25,
        up: H * 0.9,
        life: 1.0,
        size: [H * 0.32, H * 0.08],
        color: [1, 0.5, 0.1],
        alpha: 1,
        pool: 'pyre',
        radius: H * 0.22,
        drag: 1.4,
      });
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        p.puff(this.bx + Math.cos(a) * H * 0.3, this.by + 0.5, this.bz + Math.sin(a) * H * 0.3, 1, {
          speed: H * 0.9,
          up: H * 0.12,
          life: 0.8,
          size: [H * 0.14, H * 0.04],
          color: [1, 0.45, 0.1],
          alpha: 1,
          pool: 'pyre',
          dir: [Math.cos(a), 0.05, Math.sin(a)],
          spread: 0.1,
          drag: 1.2,
        });
      }
      p.puff(hx, hy, hz, FINAL_BURST_COUNTS.sparks, {
        speed: H * 0.7,
        up: H * 0.5,
        life: 1.8,
        size: [0.45, 0.1],
        color: [1, 0.55, 0.15],
        alpha: 1,
        pool: 'glow',
        gravity: 9,
        drag: 0.5,
      });
    } else {
      // The cold: frost shards flung and falling, a rolling wall of rime mist.
      p.puff(hx, hy, hz, FINAL_BURST_COUNTS.debris, {
        speed: H * 0.85,
        up: H * 0.35,
        life: 1.4,
        size: [0.75, 0.35],
        color: [0.82, 0.96, 1.0],
        alpha: 1,
        pool: 'glow',
        gravity: 24,
        drag: 0.25,
        radius: H * 0.1,
      });
      p.puff(this.bx, this.by + 0.8, this.bz, FINAL_BURST_COUNTS.mist + 10, {
        speed: H * 0.55,
        up: 0.6,
        life: 2.6,
        size: [3.5, 10],
        color: look.mist,
        alpha: 0.4,
        drag: 1.2,
        radius: H * 0.25,
      });
      p.puff(hx, hy + H * 0.1, hz, 40, {
        speed: H * 0.35,
        up: -1,
        life: 2.4,
        size: [0.3, 0.15],
        color: [0.9, 0.98, 1.0],
        alpha: 1,
        pool: 'glow',
        drag: 1.6,
        radius: H * 0.3,
      });
    }
    this.host.shakeNear(this.bx, this.bz, 0.75, 140);
  }

  /** The crown re-forming: its light pulsing at the brow, motes rising off it
   *  into the new colour, the shell's last cracks flickering. */
  private crown(age: number, dt: number): void {
    const look = FINAL_ELEMENT_LOOK[this.shiftTo];
    const H = this.height;
    const st = finalShiftStage(age);
    const k = st.stage === 'crown' ? st.k : 1;
    const c = this.point('crown', _p);
    if (this.host.rand() < dt * 14)
      this.host.flash(c.x, c.y, c.z, H * (0.18 - 0.08 * k), 0.2, look.light);
    if (this.host.rand() < dt * 50 * this.host.density) {
      this.host.particles.puff(c.x, c.y - H * 0.04, c.z, 2, {
        speed: H * 0.08,
        up: H * 0.22,
        life: 0.8,
        size: [0.55, 0.08],
        color: look.spark,
        alpha: 1,
        pool: 'glow',
        radius: H * 0.06,
        drag: 0.8,
      });
    }
    if (look.bolts && this.host.rand() < dt * 10) {
      const a = this.point('head', _a);
      this.addArc(
        c.x,
        c.y,
        c.z,
        a.x + (this.host.rand() - 0.5) * H * 0.25,
        a.y,
        a.z,
        0.2,
        H * 0.015,
        0xd8ecff,
      );
    }
  }

  // ---- the aura ------------------------------------------------------------------------------

  private aura(el: FinalBodyElement, strength: number, dt: number): void {
    if (strength <= 0.01) return;
    const H = this.height;
    const p = this.host.particles;
    const look = FINAL_ELEMENT_LOOK[el];
    this.auraDebt += dt * FINAL_AURA_RATES[el] * strength * this.host.density;
    while (this.auraDebt >= 1) {
      this.auraDebt -= 1;
      const r = this.host.rand();
      if (el === 'hammer') {
        if (r < 0.55) {
          // Grit shed off the shell, falling.
          const s = this.point(this.host.rand() < 0.5 ? 'fistL' : 'fistR', _a);
          p.puff(s.x, s.y, s.z, 1, {
            speed: 0.6,
            life: 1.3,
            size: [0.3, 0.25],
            color: [0.26, 0.22, 0.2],
            alpha: 1,
            gravity: 14,
            radius: H * 0.08,
          });
        } else {
          // Golden dust motes rising off the cracks.
          const s = this.point('hip', _a);
          p.puff(s.x, s.y, s.z, 1, {
            speed: 0.4,
            up: H * 0.05,
            life: 2.2,
            size: [0.4, 0.1],
            color: look.spark,
            alpha: 0.9,
            pool: 'glow',
            radius: H * 0.3,
          });
        }
      } else if (el === 'breath') {
        // Gusts wheeling round the body, white and fast.
        const a = this.host.rand() * Math.PI * 2;
        const rr = H * (0.3 + this.host.rand() * 0.25);
        p.puff(
          this.bx + Math.cos(a) * rr,
          this.by + H * (0.1 + this.host.rand() * 0.8),
          this.bz + Math.sin(a) * rr,
          1,
          {
            speed: H * 0.55,
            life: 0.9,
            size: [1.6, 4.5],
            color: look.mist,
            alpha: 0.22,
            dir: [-Math.sin(a), 0.2, Math.cos(a)],
            spread: 0.1,
            drag: 0.6,
          },
        );
        if (r < 0.3) {
          const s = this.point(this.host.rand() < 0.5 ? 'shoulderL' : 'shoulderR', _a);
          p.puff(s.x, s.y, s.z, 2, {
            speed: 4,
            life: 0.35,
            size: [0.35, 0.05],
            color: look.spark,
            alpha: 1,
            pool: 'glow',
            radius: H * 0.08,
          });
        }
      } else if (el === 'heat') {
        // Flames licking off the shoulders, back and fists, embers rising.
        const anchors: FinalBodyAnchor[] = [
          'shoulderL',
          'shoulderR',
          'fistL',
          'fistR',
          'head',
          'hip',
        ];
        const s = this.point(anchors[Math.floor(this.host.rand() * anchors.length)], _a);
        if (r < 0.7) {
          p.puff(s.x, s.y, s.z, 1, {
            speed: 0.5,
            up: H * 0.12,
            life: 0.7,
            size: [H * 0.07, H * 0.015],
            color: [0.9, 0.4, 0.1],
            alpha: 1,
            pool: 'pyre',
            radius: H * 0.06,
          });
        } else {
          p.puff(s.x, s.y, s.z, 1, {
            speed: 1.2,
            up: H * 0.1,
            life: 2.2,
            size: [0.3, 0.06],
            color: look.spark,
            alpha: 1,
            pool: 'glow',
            radius: H * 0.12,
            drag: 0.4,
          });
        }
      } else {
        // Rime falling round it, a cold mist rolling off its feet, vapour off the shell.
        if (r < 0.45) {
          const a = this.host.rand() * Math.PI * 2;
          const rr = H * this.host.rand() * 0.4;
          p.puff(
            this.bx + Math.cos(a) * rr,
            this.by + H * (0.5 + this.host.rand() * 0.45),
            this.bz + Math.sin(a) * rr,
            1,
            {
              speed: 0.3,
              up: -H * 0.05,
              life: 2.6,
              size: [0.28, 0.2],
              color: [0.88, 0.97, 1.0],
              alpha: 0.95,
              pool: 'glow',
              drag: 0.5,
            },
          );
        } else if (r < 0.8) {
          const s = this.point(this.host.rand() < 0.5 ? 'footL' : 'footR', _a);
          p.puff(s.x, s.y + 0.4, s.z, 1, {
            speed: H * 0.08,
            up: 0.1,
            life: 2.8,
            size: [2.5, 7],
            color: look.mist,
            alpha: 0.28,
            radius: H * 0.12,
            drag: 0.9,
          });
        } else {
          const s = this.point(this.host.rand() < 0.5 ? 'fistL' : 'fistR', _a);
          p.puff(s.x, s.y, s.z, 1, {
            speed: 0.4,
            up: -0.8,
            life: 1.6,
            size: [1.2, 3],
            color: look.mist,
            alpha: 0.22,
            radius: H * 0.05,
          });
        }
      }
    }
    // The Breath's arcs crawling over the body.
    if (look.bolts) {
      this.arcDebt += dt * 2.6 * strength;
      while (this.arcDebt >= 1) {
        this.arcDebt -= 1;
        const pick: FinalBodyAnchor[] = [
          'shoulderL',
          'shoulderR',
          'fistL',
          'fistR',
          'head',
          'hip',
          'heart',
        ];
        const a = this.point(pick[Math.floor(this.host.rand() * pick.length)], _a);
        const b = this.point(pick[Math.floor(this.host.rand() * pick.length)], _b);
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 0.5) b.y -= H * 0.25;
        this.addArc(a.x, a.y, a.z, b.x, b.y, b.z, 0.22, H * 0.012, 0x9cc8ff);
      }
    }
  }

  // ---- the pools ----------------------------------------------------------------------------

  private addArc(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    span: number,
    width: number,
    color: number,
  ): void {
    let slot = this.arcs[0];
    let oldest = Infinity;
    for (const a of this.arcs) {
      const end = a.born + a.span;
      if (end < oldest) {
        oldest = end;
        slot = a;
      }
    }
    slot.ax = ax;
    slot.ay = ay;
    slot.az = az;
    slot.bx = bx;
    slot.by = by;
    slot.bz = bz;
    slot.born = this.nowClock;
    slot.span = span;
    slot.seed = this.host.rand() * 1000;
    slot.width = width;
    slot.color = color;
  }

  private paintBolts(clock: number): void {
    this.nowClock = clock;
    const segs = FINAL_BODY_POOLS.boltSegments;
    let any = false;
    for (let i = 0; i < this.arcs.length; i++) {
      const a = this.arcs[i];
      const age = clock - a.born;
      const live = age >= 0 && age < a.span;
      // Re-roll the jag a few times a life: the arc crackles.
      const seed = a.seed + Math.floor(age * 30);
      const fade = live ? (1 - age / a.span) * (0.6 + 0.4 * Math.sin(age * 90 + a.seed)) : 0;
      for (let k = 0; k < segs; k++) {
        const idx = i * segs + k;
        if (!live) {
          this.bolts.setMatrixAt(idx, _m.makeScale(0, 0, 0));
          continue;
        }
        any = true;
        const jag = Math.hypot(a.bx - a.ax, a.by - a.ay, a.bz - a.az) * 0.12;
        boltJoint(a.ax, a.ay, a.az, a.bx, a.by, a.bz, k, segs, seed, jag, _j0);
        boltJoint(a.ax, a.ay, a.az, a.bx, a.by, a.bz, k + 1, segs, seed, jag, _j1);
        _v.set(_j1.x - _j0.x, _j1.y - _j0.y, _j1.z - _j0.z);
        const len = _v.length() || 0.001;
        _v.multiplyScalar(1 / len);
        _q.setFromUnitVectors(UP, _v);
        _m.compose(_pos.set(_j0.x, _j0.y, _j0.z), _q, _s.set(a.width, len, a.width));
        this.bolts.setMatrixAt(idx, _m);
        this.bolts.setColorAt(idx, _c.setHex(a.color).multiplyScalar(1.6 * fade));
      }
    }
    if (any || this.bolts.visible) {
      this.bolts.instanceMatrix.needsUpdate = true;
      if (this.bolts.instanceColor) this.bolts.instanceColor.needsUpdate = true;
    }
    this.bolts.visible = any;
  }

  private paintRocks(clock: number, k: number): void {
    if (k <= 0.01) {
      this.rocks.visible = false;
      return;
    }
    this.rocks.visible = true;
    for (let i = 0; i < FINAL_BODY_POOLS.rocks; i++) {
      const o = finalRockOrbit(i, clock, this.height);
      _q.setFromAxisAngle(UP, clock * (0.4 + 0.1 * i) + i);
      _m.compose(
        _v.set(
          this.bx + Math.cos(o.angle) * o.radius,
          this.by + o.up,
          this.bz + Math.sin(o.angle) * o.radius,
        ),
        _q,
        _s.set(o.size * k, o.size * k * 0.8, o.size * k * 1.1),
      );
      this.rocks.setMatrixAt(i, _m);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rocks.dispose();
    this.bolts.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

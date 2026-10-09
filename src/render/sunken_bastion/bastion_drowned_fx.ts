// The drowned garrison's own effects (plan: bastion_drowned_fx_core.ts): the
// sea still running off them.
//  - Drips: while a drowned body stands within reach of the player, single
//    drops of sea water fall from its helm's brim, its buckler and its blade.
//  - Struck: brine sprays off it away from the blow (a fountain on a crit),
//    with a puff of sea mist.
//  - Rushing (the Onrush dash): its boots kick spray and mist up behind it.
//  - Death: the sea it drowned in pours out of it, a gush of brine thrown up
//    and out with a cloud of mist, and its sea light lifts away as motes.
//
// It owns NO GPU resource: every particle is written into the creature
// effects' two pooled particle draws (glow and mist), which already ride the
// Bastion telegraph root behind its compile gate. Nothing allocates per frame
// (one reused particle record, one reused point, a per-body record created
// once per body and dropped when the body leaves the world). Cosmetic only:
// the hit, the death and the rush are already the sim's; the budgets shed on
// the low effects tier.

import { MOBS } from '../../sim/data';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { VISUALS, visualKeyFor } from '../characters/manifest';
import { modelPointWorld, modelScale } from './bastion_creature_fx_core';
import {
  DRIP_INTERVAL,
  DRIP_RANGE,
  type DrownedFxSpec,
  deathBurstCounts,
  drownedFxSpec,
  hitSprayCount,
  isRushing,
  nextDripIndex,
  RUSH_SPRAY_INTERVAL,
  sprayDirection,
} from './bastion_drowned_fx_core';

/** The particle record the creature effects' pools take. */
export interface DrownedParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  gravity?: number;
  stretch?: number;
  size0: number;
  size1: number;
  streak?: boolean;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface DrownedParticleSink {
  emit(now: number, p: DrownedParticle): void;
}

type Body = IWorld['entities'] extends Map<number, infer E> ? E : never;

interface BodyState {
  nextDrip: number;
  dripIndex: number;
  lastX: number;
  lastZ: number;
  lastT: number;
  nextSpray: number;
  seen: number;
}

const SCAN_SEC = 0.25;
/** Behind its heels, where a rush kicks the spray up. */
const HEELS = { side: 0, up: 0.15, fwd: -0.3 } as const;

export class BastionDrownedFx {
  private readonly bodies = new Map<number, BodyState>();
  private readonly p: DrownedParticle = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly dir = { x: 0, z: 0 };
  private nextScan = 0;
  private seed = 0x5ea;

  constructor(
    private readonly glow: DrownedParticleSink,
    private readonly mist: DrownedParticleSink,
    private readonly world: IWorld | undefined,
    private readonly density: number,
    private readonly reducedMotion: () => boolean,
  ) {}

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private specOf(e: Body | undefined): DrownedFxSpec | null {
    if (!e || e.kind !== 'mob') return null;
    return drownedFxSpec(e.templateId);
  }

  /** Model units to yards for this body. */
  private scaleOf(e: Body, spec: DrownedFxSpec): number {
    const def = VISUALS[visualKeyFor(e)];
    const scale = e.scale || MOBS[e.templateId ?? '']?.scale || 1;
    return modelScale(def?.height ?? spec.rawHeight, scale, spec.rawHeight);
  }

  /** Watches the stream for a drowned body struck or killed; never claims an
   *  event (the hit numbers, the sounds and the death itself still play). */
  observe(ev: SimEvent, now: number): void {
    if (!this.world) return;
    if (ev.type === 'damage') {
      if (ev.amount <= 0) return;
      const e = this.world.entities.get(ev.targetId);
      const spec = this.specOf(e);
      if (!e || !spec || e.dead) return;
      const src = this.world.entities.get(ev.sourceId);
      this.struck(e, spec, src?.pos.x ?? e.pos.x, src?.pos.z ?? e.pos.z, ev.crit, now);
    } else if (ev.type === 'death') {
      const e = this.world.entities.get(ev.entityId);
      const spec = this.specOf(e);
      if (!e || !spec) return;
      this.gush(e, spec, now);
      this.bodies.delete(e.id);
    }
  }

  update(now: number): void {
    const world = this.world;
    if (!world) return;
    const me = world.player;
    const calm = this.reducedMotion();
    for (const e of world.entities.values()) {
      const spec = this.specOf(e);
      if (!spec || e.dead) continue;
      let st = this.bodies.get(e.id);
      if (!st) {
        st = {
          nextDrip: now + this.rand() * DRIP_INTERVAL,
          dripIndex: Math.floor(this.rand() * spec.drips.length),
          lastX: e.pos.x,
          lastZ: e.pos.z,
          lastT: now,
          nextSpray: 0,
          seen: now,
        };
        this.bodies.set(e.id, st);
      }
      st.seen = now;
      const k = this.scaleOf(e, spec);
      // The rush: its displayed speed well past its own run.
      const dt = now - st.lastT;
      if (dt > 0.03) {
        const tpl = MOBS[e.templateId ?? ''];
        if (
          !calm &&
          tpl &&
          isRushing(e.pos.x - st.lastX, e.pos.z - st.lastZ, dt, tpl.moveSpeed) &&
          now >= st.nextSpray
        ) {
          st.nextSpray = now + RUSH_SPRAY_INTERVAL / Math.max(0.4, this.density);
          this.kick(e, k, now);
        }
        st.lastX = e.pos.x;
        st.lastZ = e.pos.z;
        st.lastT = now;
      }
      // The drips, near the player only.
      if (calm || !me || now < st.nextDrip) continue;
      const dx = e.pos.x - me.pos.x;
      const dz = e.pos.z - me.pos.z;
      if (dx * dx + dz * dz > DRIP_RANGE * DRIP_RANGE) {
        st.nextDrip = now + 0.5;
        continue;
      }
      st.nextDrip = now + (DRIP_INTERVAL * (0.7 + this.rand() * 0.6)) / Math.max(0.4, this.density);
      st.dripIndex = nextDripIndex(st.dripIndex, spec);
      this.drip(e, k, spec, st.dripIndex, now);
    }
    if (now >= this.nextScan) {
      this.nextScan = now + SCAN_SEC;
      for (const [id, st] of this.bodies) {
        if (now - st.seen > 1 || !world.entities.has(id)) this.bodies.delete(id);
      }
    }
  }

  private drip(e: Body, k: number, spec: DrownedFxSpec, index: number, now: number): void {
    const a = spec.drips[index];
    if (!a) return;
    const at = modelPointWorld(e.pos.x, e.pos.y, e.pos.z, e.facing, k, a, this.at);
    const p = this.p;
    p.x = at.x + (this.rand() - 0.5) * 0.12 * k;
    p.y = at.y;
    p.z = at.z + (this.rand() - 0.5) * 0.12 * k;
    p.vx = 0;
    p.vy = -0.4;
    p.vz = 0;
    p.life = 0.55 + this.rand() * 0.25;
    p.gravity = 16;
    p.stretch = 1.2;
    p.size0 = 0.09;
    p.size1 = 0.06;
    p.streak = true;
    p.r = 0.55;
    p.g = 0.82;
    p.b = 0.8;
    p.a = 0.75;
    this.glow.emit(now, p);
  }

  private struck(
    e: Body,
    spec: DrownedFxSpec,
    fromX: number,
    fromZ: number,
    crit: boolean,
    now: number,
  ): void {
    const k = this.scaleOf(e, spec);
    const at = modelPointWorld(e.pos.x, e.pos.y, e.pos.z, e.facing, k, spec.chest, this.at);
    const d = sprayDirection(e.pos.x, e.pos.z, fromX, fromZ, e.facing, this.dir);
    const n = hitSprayCount(crit, this.density);
    const p = this.p;
    for (let i = 0; i < n; i++) {
      const sp = (crit ? 5 : 3.5) + this.rand() * 4;
      p.x = at.x + (this.rand() - 0.5) * 0.5;
      p.y = at.y + (this.rand() - 0.5) * 0.8;
      p.z = at.z + (this.rand() - 0.5) * 0.5;
      p.vx = (d.x * 0.8 + (this.rand() - 0.5) * 1.1) * sp;
      p.vy = (0.35 + this.rand() * 0.7) * sp;
      p.vz = (d.z * 0.8 + (this.rand() - 0.5) * 1.1) * sp;
      p.life = 0.45 + this.rand() * 0.3;
      p.gravity = 15;
      p.stretch = 0.9;
      p.size0 = 0.22;
      p.size1 = 0.08;
      p.streak = true;
      p.r = 0.6;
      p.g = 0.86;
      p.b = 0.84;
      p.a = 0.85;
      this.glow.emit(now, p);
    }
    p.x = at.x + d.x * 0.4;
    p.y = at.y;
    p.z = at.z + d.z * 0.4;
    p.vx = d.x * 1.2;
    p.vy = 0.5;
    p.vz = d.z * 1.2;
    p.life = 0.7;
    p.gravity = 0;
    p.stretch = 0;
    p.size0 = 0.9;
    p.size1 = crit ? 2.4 : 1.7;
    p.streak = false;
    p.r = 0.62;
    p.g = 0.72;
    p.b = 0.7;
    p.a = crit ? 0.32 : 0.22;
    this.mist.emit(now, p);
  }

  private kick(e: Body, k: number, now: number): void {
    const at = modelPointWorld(e.pos.x, e.pos.y, e.pos.z, e.facing, k, HEELS, this.at);
    const bx = -Math.sin(e.facing);
    const bz = -Math.cos(e.facing);
    const p = this.p;
    for (let i = 0; i < 4; i++) {
      const sp = 2.5 + this.rand() * 3;
      p.x = at.x + (this.rand() - 0.5) * 0.9;
      p.y = at.y;
      p.z = at.z + (this.rand() - 0.5) * 0.9;
      p.vx = (bx * 0.6 + (this.rand() - 0.5) * 0.9) * sp;
      p.vy = (0.6 + this.rand() * 0.6) * sp;
      p.vz = (bz * 0.6 + (this.rand() - 0.5) * 0.9) * sp;
      p.life = 0.4 + this.rand() * 0.2;
      p.gravity = 16;
      p.stretch = 0.8;
      p.size0 = 0.12;
      p.size1 = 0.05;
      p.streak = true;
      p.r = 0.62;
      p.g = 0.85;
      p.b = 0.84;
      p.a = 0.8;
      this.glow.emit(now, p);
    }
    p.x = at.x;
    p.y = at.y + 0.2;
    p.z = at.z;
    p.vx = bx;
    p.vy = 0.4;
    p.vz = bz;
    p.life = 0.8;
    p.gravity = 0;
    p.stretch = 0;
    p.size0 = 0.8;
    p.size1 = 2.0;
    p.streak = false;
    p.r = 0.64;
    p.g = 0.72;
    p.b = 0.7;
    p.a = 0.2;
    this.mist.emit(now, p);
  }

  /** The body falls: a gush of brine thrown up and out of it, a mist cloud
   *  rolling off it and its sea light lifting away in motes. */
  private gush(e: Body, spec: DrownedFxSpec, now: number): void {
    const k = this.scaleOf(e, spec);
    const c = deathBurstCounts(this.density);
    const chest = modelPointWorld(e.pos.x, e.pos.y, e.pos.z, e.facing, k, spec.chest, this.at);
    const cx = chest.x;
    const cy = chest.y;
    const cz = chest.z;
    const p = this.p;
    for (let i = 0; i < c.brine; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = 3 + this.rand() * 6;
      p.x = cx + (this.rand() - 0.5) * 0.8;
      p.y = cy + (this.rand() - 0.7) * 1.4;
      p.z = cz + (this.rand() - 0.5) * 0.8;
      p.vx = Math.cos(a) * sp * 0.7;
      p.vy = (0.6 + this.rand()) * sp * 0.6;
      p.vz = Math.sin(a) * sp * 0.7;
      p.life = 0.6 + this.rand() * 0.5;
      p.gravity = 14;
      p.stretch = 0.9;
      p.size0 = 0.16;
      p.size1 = 0.07;
      p.streak = true;
      p.r = 0.58;
      p.g = 0.86;
      p.b = 0.82;
      p.a = 0.9;
      this.glow.emit(now, p);
    }
    for (let i = 0; i < c.mist; i++) {
      const a = this.rand() * Math.PI * 2;
      p.x = e.pos.x + Math.cos(a) * 0.6;
      p.y = e.pos.y + 0.4 + this.rand() * 1.6 * k;
      p.z = e.pos.z + Math.sin(a) * 0.6;
      p.vx = Math.cos(a) * 1.6;
      p.vy = 0.3 + this.rand() * 0.5;
      p.vz = Math.sin(a) * 1.6;
      p.life = 1.4 + this.rand() * 0.6;
      p.gravity = 0;
      p.stretch = 0;
      p.size0 = 1.1;
      p.size1 = 3.0;
      p.streak = false;
      p.r = 0.5;
      p.g = 0.64;
      p.b = 0.62;
      p.a = 0.22;
      this.mist.emit(now, p);
    }
    const eyes = modelPointWorld(e.pos.x, e.pos.y, e.pos.z, e.facing, k, spec.eyes, this.at);
    for (let i = 0; i < c.motes; i++) {
      p.x = eyes.x + (this.rand() - 0.5) * 0.6;
      p.y = eyes.y + (this.rand() - 0.5) * 0.6;
      p.z = eyes.z + (this.rand() - 0.5) * 0.6;
      p.vx = (this.rand() - 0.5) * 0.8;
      p.vy = 1.2 + this.rand() * 1.4;
      p.vz = (this.rand() - 0.5) * 0.8;
      p.life = 1.2 + this.rand() * 0.8;
      p.gravity = -0.6;
      p.stretch = 0;
      p.size0 = 0.32;
      p.size1 = 0.1;
      p.streak = false;
      p.r = 0.42;
      p.g = 1;
      p.b = 0.78;
      p.a = 0.9;
      this.glow.emit(now, p);
    }
  }
}

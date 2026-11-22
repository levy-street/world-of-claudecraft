import * as THREE from 'three';
import {
  KIT_FLARE_GLSL,
  KIT_GOLD,
  KIT_IVORY,
  KIT_WARM,
  type PaladinKitContext,
} from './paladin_kit_context';
import { hash01, PaladinQuadPool, ramp } from './paladin_quad_pool';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
} from './paladin_vfx_detail_core';

// Detail: core = the beacon column and its falling head, the halo, a copied
// heal's thread; secondary = the light running out across the ground and the
// gathering wave closing into the halo; accents = the landing flash, the halo's
// flare on a copied heal and the flare where a thread meets it (motes scale
// with count, fade tails with linger).

export const BEACON_MARKS = 8;
export const BEACON_KINDLES = 4;
export const BEACON_THREADS = 8;
/** The beacon comes down from the sky in this long, then fades. */
export const BEACON_FALL = 0.2;
export const BEACON_KINDLE_DURATION = 1.2;
/** A copied heal's thread reaches the halo after this long. */
export const BEACON_THREAD_REACH = 0.3;
export const BEACON_THREAD_DURATION = 0.75;
/** When the halo starts to gather out of the beacon's light, and how long it takes. */
export const HALO_GATHER = 0.22;
export const HALO_FORM = 0.5;
/** How far over the top of the head the halo floats, and its half-size. */
const HALO_LIFT = 0.3;
const HALO_SIZE = 0.5;
/** How high the beacon comes down from. */
const BEACON_HEIGHT = 14;
const SEGMENTS = 8;
const MOTES = 10;
const SHAPE = { halo: 0, beacon: 1, wave: 2, flare: 3, ground: 4, thread: 5, mote: 6 } as const;
const QUADS = BEACON_MARKS * 2 + BEACON_KINDLES * (5 + MOTES) + BEACON_THREADS * (SEGMENTS + 1);

interface Mark {
  active: boolean;
  target: number;
  presence: number;
  seen: boolean;
  /** Seconds since the beacon last passed on healing: the halo flares. */
  flare: number;
  age: number;
  /** How much of the halo draws, read when it first appeared. */
  detail: PaladinVfxDetail;
}
interface Kindle {
  active: boolean;
  target: number;
  age: number;
  detail: PaladinVfxDetail;
}
interface Thread {
  active: boolean;
  from: number;
  to: number;
  age: number;
  detail: PaladinVfxDetail;
}

/**
 * Beacon of Light. The cast brings a great beacon of light down from the sky
 * onto the ally: a column whose white-hot head falls to them, landing in a
 * flash with a ring of light across the ground and motes rising, and as the
 * column fades a halo gathers out of its light, closing down to rest over
 * their head. The halo stays for as long as the beacon lasts: a golden ring
 * level above them, glints running round it. Each time the beacon takes on a
 * share of the Paladin's healing, a thread of light runs to the halo from the
 * ally that was healed, and it flares.
 */
export class BeaconOfLight {
  private readonly pool: PaladinQuadPool<'beacon_of_light'>;
  private readonly marks: Mark[] = Array.from({ length: BEACON_MARKS }, () => ({
    active: false,
    target: -1,
    presence: 0,
    seen: false,
    flare: 99,
    age: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly kindles: Kindle[] = Array.from({ length: BEACON_KINDLES }, () => ({
    active: false,
    target: -1,
    age: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly threads: Thread[] = Array.from({ length: BEACON_THREADS }, () => ({
    active: false,
    from: -1,
    to: -1,
    age: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'beacon_of_light', QUADS, {
      helpers: KIT_FLARE_GLSL,
      // The beacon pours over the ally rather than hiding behind them.
      pull: 'aShape>0.5&&aShape<1.5?0.9:(aShape>2.5&&aShape<3.5?0.6:(aShape<0.5?0.25:0.35))',
      body: `
        if(vShape>5.5){
          // A mote of light rising from where the beacon came down.
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.6);
        } else if(vShape>4.5){
          // A thread of light running to the halo.
          float core=exp(-vUv.y*vUv.y*30.0);
          mask=exp(-vUv.y*vUv.y*4.0)*0.4+core;
          color=mix(vColor,HOT,core*0.8);
        } else if(vShape>3.5){
          // The light on the ground where the beacon lands: a hot pool and
          // a ring running out.
          float grow=1.0-sq(max(1.0-clamp(t/0.45,0.0,1.0),0.0));
          float ring=band(r,0.12+0.85*grow,0.015+0.03*grow)*(1.0-grow*0.7)*1.3;
          float pool=exp(-r*r*12.0)*exp(-t*2.5);
          mask=(ring+pool)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,pool+ring*0.4);
        } else if(vShape>2.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>1.5){
          // The halo gathering: a ring of light closing down to the head.
          mask=(band(r,0.8,0.05)*1.2+band(r,0.8,0.16)*0.3)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>0.5){
          // The beacon coming down: a column of light with a white-hot head
          // falling from the sky, light streaming down it; it narrows and
          // fades once it has landed. uv.x runs up the column.
          float down=1.0-vUv.x;
          float front=clamp(t/${BEACON_FALL.toFixed(2)},0.0,1.0);
          float shown=smoothstep(front+0.01,front-0.04,down);
          float narrow=mix(1.0,0.35,smoothstep(${BEACON_FALL.toFixed(2)},1.0,t));
          float v=vUv.y/narrow;
          float soft=exp(-v*v*2.6)*(1.0-smoothstep(0.75,0.98,abs(vUv.y)));
          float core=exp(-v*v*30.0);
          float stream=0.75+0.25*sin(down*40.0+t*40.0+v*2.0);
          float head=exp(-sq((down-front)/0.03))*exp(-v*v*4.0)*step(t,${BEACON_FALL.toFixed(2)})*2.0;
          float foot=0.8+0.6*down*down;
          mask=((soft*0.55*stream+core*1.1)*foot*shown+head)*smoothstep(0.0,0.06,down);
          color=mix(vColor,HOT,clamp(core+head,0.0,1.0));
        } else {
          // The halo: a golden ring lying level over the head, a soft glow
          // about it and glints running round it. vTime is its clock.
          float ring=band(r,0.78,0.05)*1.15+band(r,0.78,0.022)*0.7;
          float glow=exp(-sq((r-0.78)/0.17))*0.32;
          float glints=pow(max(cos(a*5.0-t*1.4),0.0),36.0)*band(r,0.78,0.06)*1.2;
          mask=(ring+glow+glints)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,band(r,0.78,0.022)*0.7+glints*0.6);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** The beacon is placed on an ally: it comes down on them. */
  kindle(target: number): boolean {
    if (!this.pool.ready()) return false;
    let slot = this.kindles.find((k) => !k.active);
    if (!slot) {
      slot = this.kindles[0];
      for (const k of this.kindles) if (k.age > slot.age) slot = k;
    }
    slot.active = true;
    slot.target = target;
    slot.age = 0;
    slot.detail = paladinVfxDetailNow();
    return true;
  }

  /** Once a frame while `target` carries a beacon: its halo. */
  hold(target: number): void {
    if (!this.pool.ready()) return;
    let slot = this.marks.find((m) => m.active && m.target === target);
    if (!slot) {
      slot = this.marks.find((m) => !m.active);
      if (!slot) return;
      slot.active = true;
      slot.target = target;
      slot.presence = 0;
      slot.flare = 99;
      slot.detail = paladinVfxDetailNow();
      // Did the beacon just come down on them? Then the halo gathers out of it.
      slot.age = this.kindles.some((k) => k.active && k.target === target) ? 0 : HALO_FORM + 1;
    }
    slot.seen = true;
  }

  /** The beacon on `to` takes on healing given to `from`. */
  transfer(from: number, to: number): void {
    if (!this.pool.ready()) return;
    const mark = this.marks.find((m) => m.active && m.target === to);
    if (mark) mark.flare = 0;
    if (from === to) return;
    let slot = this.threads.find((t) => !t.active);
    if (!slot) {
      slot = this.threads[0];
      for (const t of this.threads) if (t.age > slot.age) slot = t;
    }
    slot.active = true;
    slot.from = from;
    slot.to = to;
    slot.age = 0;
    slot.detail = paladinVfxDetailNow();
  }

  /** Where the halo floats over `id`. */
  private haloAt(id: number, out: THREE.Vector3): boolean {
    if (!this.ctx.anchor(id, 0, this.feet) || !this.ctx.anchor(id, 1, this.head)) return false;
    this.ctx.anchor(id, 0.55, this.chest);
    out.set(this.head.x, this.head.y + HALO_LIFT, this.head.z);
    return true;
  }

  /** A point `u` of the way along a thread's arc from `this.from` to `this.b`. */
  private threadPoint(u: number, lift: number, out: THREE.Vector3): void {
    const q = 1 - u;
    const mx = (this.from.x + this.b.x) / 2,
      my = Math.max(this.from.y, this.b.y) + lift,
      mz = (this.from.z + this.b.z) / 2;
    out.set(
      q * q * this.from.x + 2 * q * u * mx + u * u * this.b.x,
      q * q * this.from.y + 2 * q * u * my + u * u * this.b.y,
      q * q * this.from.z + 2 * q * u * mz + u * u * this.b.z,
    );
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    const pool = this.pool;
    pool.begin(this.ctx.camera);
    for (const m of this.marks) {
      if (!m.active) continue;
      m.presence = m.seen ? Math.min(1, m.presence + dt * 3) : Math.max(0, m.presence - dt * 3);
      m.seen = false;
      m.age += dt;
      m.flare += dt;
      if (m.presence <= 0 || !this.haloAt(m.target, this.a)) {
        m.active = false;
        continue;
      }
      const bob = reduced ? 0 : Math.sin(this.clock * 1.8 + m.target) * 0.03;
      const pulse = Math.exp(-m.flare * 4);
      // Gathering out of the beacon's light: wide and faint, closing down.
      const form = reduced ? 1 : ramp(m.age, HALO_GATHER, HALO_GATHER + HALO_FORM);
      const shown = reduced ? 1 : ramp(m.age, HALO_GATHER - 0.05, HALO_GATHER + 0.15);
      const size = HALO_SIZE * (1 + 1.6 * (1 - form) * (1 - form)) * (1 + 0.12 * pulse);
      pool.time = this.clock;
      pool.ground(
        this.a.x,
        this.a.y + bob,
        this.a.z,
        size,
        KIT_GOLD,
        m.presence * shown * (1 + 0.8 * pulse),
        SHAPE.halo,
      );
      if (pulse > 0.01 && paladinDetailScale(m.detail).accents)
        pool.billboard(
          this.a.x,
          this.a.y + bob,
          this.a.z,
          0.7,
          KIT_IVORY,
          pulse * 1.1,
          SHAPE.flare,
        );
    }
    for (const kd of this.kindles) {
      if (!kd.active) continue;
      kd.age += dt;
      const scale = paladinDetailScale(kd.detail);
      // The fade tail after the landing shortens on the lighter tiers.
      const end =
        kd.detail === 'full'
          ? BEACON_KINDLE_DURATION
          : BEACON_FALL +
            0.15 +
            paladinDetailLinger(BEACON_KINDLE_DURATION - BEACON_FALL - 0.15, kd.detail);
      if (kd.age >= end || !this.haloAt(kd.target, this.a)) {
        kd.active = false;
        continue;
      }
      const t = kd.age;
      const floor = this.ctx.groundY(this.feet.x, this.feet.z);
      const ground = Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y;
      const fade = 1 - ramp(t, BEACON_FALL + 0.15, end);
      // The beacon: a column from high in the sky down to the ally.
      pool.time = t;
      pool.upright(
        this.feet.x,
        ground + BEACON_HEIGHT / 2,
        this.feet.z,
        0.75,
        BEACON_HEIGHT / 2,
        KIT_WARM,
        fade * 1.15,
        SHAPE.beacon,
      );
      if (t < BEACON_FALL) {
        // Its white-hot head, falling.
        const y = ground + BEACON_HEIGHT * (1 - (t / BEACON_FALL) ** 1.6);
        pool.time = 0;
        pool.billboard(this.feet.x, y, this.feet.z, 0.9, KIT_IVORY, 1.3, SHAPE.flare);
        continue;
      }
      const since = t - BEACON_FALL;
      // It lands: a flash, light running out across the ground, motes rising.
      pool.time = since;
      if (scale.accents)
        pool.billboard(
          this.chest.x,
          this.chest.y,
          this.chest.z,
          1.6,
          KIT_IVORY,
          Math.exp(-since * 7) * 1.4,
          SHAPE.flare,
        );
      if (scale.secondary)
        pool.ground(
          this.feet.x,
          ground + 0.05,
          this.feet.z,
          2.4,
          KIT_WARM,
          1 - ramp(since, 0.4, 0.4 + paladinDetailLinger(0.4, kd.detail)),
          SHAPE.ground,
        );
      // The light it leaves gathering into the halo.
      if (since < HALO_FORM && !reduced && scale.secondary) {
        const close = ramp(since, 0, HALO_FORM);
        const y = this.feet.y + (this.a.y - this.feet.y) * (0.3 + 0.7 * close);
        pool.ground(
          this.a.x,
          y,
          this.a.z,
          HALO_SIZE * (1 + 3 * (1 - close)),
          KIT_WARM,
          (1 - close) * 0.9,
          SHAPE.wave,
        );
      }
      const motion = reduced ? 0.3 : 1;
      const motes = paladinDetailCount(MOTES, kd.detail);
      for (let i = 0; i < motes; i++) {
        const life = paladinDetailLinger(0.55 + 0.35 * hash01(i, 4), kd.detail);
        if (since >= life) continue;
        const ang = hash01(i, 1) * Math.PI * 2 + since * 2;
        const rad = 0.25 + 0.55 * hash01(i, 2);
        pool.time = 0;
        pool.billboard(
          this.feet.x + Math.cos(ang) * rad,
          ground + 0.1 + since * (1.6 + hash01(i, 3)) * motion,
          this.feet.z + Math.sin(ang) * rad,
          0.05,
          KIT_IVORY,
          (1 - since / life) * 1.2,
          SHAPE.mote,
        );
      }
    }
    for (const th of this.threads) {
      if (!th.active) continue;
      th.age += dt;
      if (
        th.age >= BEACON_THREAD_DURATION ||
        !this.ctx.anchor(th.from, 0.6, this.from) ||
        !this.haloAt(th.to, this.b)
      ) {
        th.active = false;
        continue;
      }
      const t = th.age;
      const head = reduced ? 1 : ramp(t / BEACON_THREAD_REACH, 0, 1);
      const tail = reduced ? 0 : ramp((t - 0.18) / BEACON_THREAD_REACH, 0, 1);
      const fade = 1 - ramp(t, BEACON_THREAD_REACH + 0.18, BEACON_THREAD_DURATION);
      if (head <= tail + 0.01) continue;
      for (let i = 0; i < SEGMENTS; i++) {
        this.threadPoint(tail + ((head - tail) * i) / SEGMENTS, 0.8, this.c);
        this.threadPoint(tail + ((head - tail) * (i + 1)) / SEGMENTS, 0.8, this.a);
        pool.time = 0;
        pool.beam(
          this.c.x,
          this.c.y,
          this.c.z,
          this.a.x,
          this.a.y,
          this.a.z,
          0.05 + 0.05 * ((i + 1) / SEGMENTS),
          KIT_WARM,
          fade,
          SHAPE.thread,
        );
      }
      if (paladinDetailScale(th.detail).accents)
        pool.billboard(this.a.x, this.a.y, this.a.z, 0.25, KIT_IVORY, fade * 1.1, SHAPE.flare);
    }
    pool.end();
  }

  clear(): void {
    for (const m of this.marks) m.active = false;
    for (const k of this.kindles) k.active = false;
    for (const t of this.threads) t.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

import * as THREE from 'three';
import { KIT_FLARE_GLSL, KIT_IVORY, type PaladinKitContext } from './paladin_kit_context';
import { hash01, PaladinQuadPool, ramp } from './paladin_quad_pool';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
  paladinLingerEnd,
} from './paladin_vfx_detail_core';

export const VEIL_MARCHERS = 4;
export const VEIL_MARKS = 12;
export const VEIL_BURSTS = 4;
export const VEIL_BURST_DURATION = 1.0;
/** The final wave's reach (paladin_veilbound_march.ts): its ring runs out this far. */
export const VEIL_BURST_REACH = 10;
/** The veil drapes over the Paladin over this long as the march begins. */
const DRAPE = 0.45;
/** Streamers of veil flowing back from the shoulders, and the trail points each follows. */
const STREAMERS = 2;
const TRAIL = 12;
/** Seconds between trail samples. */
const SAMPLE = 0.05;
/** Footprints of light, one every this far, each fading over this long. */
const FOOTPRINTS = 14;
const STRIDE = 0.6;
const PRINT_LIFE = 1.6;
const MOTES = 8;
/** The final wave's strike on a mark plays this long from its hit; the veil
 * snaps shut on them over the first SNAP of it. */
const STRIKE = 0.6;
const SNAP = 0.12;
/** The burst's ring fades from this long after it breaks. */
const BURST_FADE = 0.45;
/** The veil's pale, silvered light. */
const VEIL = new THREE.Color(0xe9e4ff).multiplyScalar(1.15);
const VEIL_GOLD = new THREE.Color(0xf6dca0).multiplyScalar(1.2);
const SHAPE = {
  cloak: 0,
  mark: 1,
  flare: 2,
  wave: 3,
  mote: 4,
  print: 5,
  drape: 6,
  close: 7,
  shroud: 8,
  ripple: 9,
  tether: 10,
} as const;
/** Ascension's burst hauls each mark it strikes toward the Paladin along a
 * tether of veil, drawn this long from the moment the burst reaches it. */
export const VEIL_TETHER = 0.5;
const QUADS =
  VEIL_MARCHERS * (STREAMERS * (TRAIL - 1) + FOOTPRINTS + MOTES + 4) +
  VEIL_MARKS * 6 +
  VEIL_BURSTS * (3 + MOTES);

interface Marcher {
  active: boolean;
  id: number;
  presence: number;
  seen: boolean;
  age: number;
  /** Trail of recent chest positions, newest first (x, y, z per point). */
  trail: Float32Array;
  filled: number;
  sinceSample: number;
  /** Footprints: x, y, z, facing and age per print; age < 0 is unused. */
  prints: Float32Array;
  nextPrint: number;
  lastX: number;
  lastZ: number;
  walked: number;
  foot: number;
  /** Ascension empowers this march: its burst hauls the marked in. */
  ascended: boolean;
  /** The Paladin detail read when the march began. */
  detail: PaladinVfxDetail;
}
interface Mark {
  active: boolean;
  target: number;
  /** The Paladin who set it (-1 unknown): only their burst strikes it. */
  source: number;
  presence: number;
  seen: boolean;
  age: number;
  /** Seconds since the march's final wave struck this mark (its hit), or -1. */
  strike: number;
  /** Where an Ascension burst hauls it toward (the Paladin's chest), if it does. */
  haul: boolean;
  hx: number;
  hy: number;
  hz: number;
  /** The Paladin detail read when the mark was first seen, and when the
   * final wave struck it. */
  detail: PaladinVfxDetail;
  strikeDetail: PaladinVfxDetail;
}
interface Burst {
  active: boolean;
  x: number;
  y: number;
  z: number;
  age: number;
  /** The Paladin detail read when the veil burst. */
  detail: PaladinVfxDetail;
  /** When it ends (the ring's fade tail shortened on lighter tiers). */
  end: number;
}

/**
 * Veilbound March. The Paladin draws a veil of light over themselves and
 * becomes ethereal: it drapes down over them from the head in a ring of light,
 * and while they march it clings about them as a pale shroud, motes drifting
 * off it, two streamers of veil flowing back from their shoulders and
 * footprints of light left glowing behind them, fading as they go. Each enemy
 * they pass through flashes as the veil runs through it and carries the Veil
 * Mark: a veiled eye of light over its head that stings each second. When the
 * march ends the veil bursts in a flare, a ring across the ground and motes,
 * and snaps shut on every marked enemy it strikes in a ring of light. Both
 * start from the final wave itself (its burst cue and each hit, painter.ts),
 * so they land with its damage numbers, never on a timer of their own.
 *
 * Detail: core = the shroud and the veil draping over them, the veiled eye
 * over each mark, the veil snapping shut on a mark as the final wave strikes
 * (and Ascension's tether hauling it in), and the burst's ring out to the
 * wave's reach; secondary = the streamers, the footprints of light and the
 * ripples; accents = the flares. Light drops the flares and halves the motes;
 * minimal keeps the core with a third of them, and both fade sooner.
 */
export class VeilboundMarch {
  private readonly pool: PaladinQuadPool<'veilbound_march'>;
  private readonly marchers: Marcher[] = Array.from({ length: VEIL_MARCHERS }, () => ({
    active: false,
    id: -1,
    presence: 0,
    seen: false,
    age: 0,
    trail: new Float32Array(TRAIL * 3),
    filled: 0,
    sinceSample: 0,
    prints: new Float32Array(FOOTPRINTS * 5).fill(-1),
    nextPrint: 0,
    lastX: 0,
    lastZ: 0,
    walked: 0,
    foot: 0,
    ascended: false,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly marks: Mark[] = Array.from({ length: VEIL_MARKS }, () => ({
    active: false,
    target: -1,
    source: -1,
    presence: 0,
    seen: false,
    age: 0,
    strike: -1,
    haul: false,
    hx: 0,
    hy: 0,
    hz: 0,
    detail: 'full' as PaladinVfxDetail,
    strikeDetail: 'full' as PaladinVfxDetail,
  }));
  private readonly bursts: Burst[] = Array.from({ length: VEIL_BURSTS }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    age: 0,
    detail: 'full' as PaladinVfxDetail,
    end: VEIL_BURST_DURATION,
  }));
  private readonly at = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly acrossA = new THREE.Vector3();
  private readonly acrossB = new THREE.Vector3();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'veilbound_march', QUADS, {
      helpers: `uniform float uClockV;
${KIT_FLARE_GLSL}`,
      pull: '(aShape>0.5&&aShape<2.5)||aShape>6.5?0.5:(aShape>3.5&&aShape<4.5?0.4:0.0)',
      body: `
        if(vShape>9.5){
          // Ascension's haul: a tether of veil from the marked enemy (uv.x 0)
          // to the Paladin, snapping taut and light streaming in along it.
          float taut=clamp(t/0.08,0.0,1.0);
          float shown=1.0-smoothstep(taut-0.05,taut,1.0-vUv.x);
          float core=exp(-vUv.y*vUv.y*30.0);
          float flow=pow(max(0.5+0.5*sin((vUv.x*5.0-t*7.0)*6.2831853),0.0),3.0);
          float ends=smoothstep(0.0,0.06,vUv.x)*smoothstep(1.0,0.9,vUv.x);
          mask=(exp(-vUv.y*vUv.y*4.0)*(0.25+0.45*flow)+core*0.9)*shown*ends;
          color=mix(vColor,HOT,core*0.5);
        } else if(vShape>8.5){
          // A ripple of veil running out through a marked enemy.
          float grow=1.0-sq(max(1.0-clamp(t/0.4,0.0,1.0),0.0));
          mask=band(r,0.2+0.75*grow,0.03+0.05*grow)*(1.0-grow)*1.3*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.4);
        } else if(vShape>7.5){
          // The ethereal shroud about the marching Paladin: a tall soft glow
          // with a shimmer running up it.
          vec2 q=vec2(p.x/0.5,p.y);
          float body=exp(-dot(q,q)*1.8);
          float shimmer=0.7+0.3*sin(p.y*14.0-t*6.0+p.x*5.0);
          mask=body*0.4*shimmer*(1.0-smoothstep(0.85,1.0,max(abs(p.x),abs(p.y))));
          color=mix(vColor,HOT,body*0.2);
        } else if(vShape>6.5){
          // The final burst closing on a marked enemy: a ring of veil shrinking
          // onto them (t: 0 to 1 of its fall).
          float at=1.0-0.85*t;
          mask=(band(r,at,0.04)*1.4+band(r,at,0.14)*0.3)*(0.5+0.5*t)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>5.5){
          // The veil draping down over the Paladin: a level ring of light.
          mask=(band(r,0.8,0.05)*1.2+band(r,0.8,0.18)*0.3+band(r,0.62,0.015)*0.5)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.4);
        } else if(vShape>4.5){
          // A footprint of light (x forward along the step): a sole and a heel.
          float sole=length((p-vec2(0.28,0.0))/vec2(0.52,0.36));
          float heel=length((p-vec2(-0.52,0.0))/vec2(0.3,0.28));
          float d=min(sole,heel);
          mask=((1.0-smoothstep(0.92,1.0,d))*0.45+exp(-sq((d-0.96)/0.07))*0.9)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,exp(-sq((d-0.96)/0.05))*0.5);
        } else if(vShape>3.5){
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.4);
        } else if(vShape>2.5){
          float grow=1.0-sq(max(1.0-clamp(t/0.6,0.0,1.0),0.0));
          mask=(band(r,0.1+0.88*grow,0.015+0.03*grow)*1.2+band(r,0.1+0.8*grow,0.08)*0.25)
            *(1.0-grow*0.7)*(1.0-smoothstep(0.97,1.0,r));
          color=mix(vColor,HOT,0.3);
        } else if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0));
        } else if(vShape>0.5){
          // The Veil Mark: a veiled eye of light under an arch, its tears of
          // light, stinging each second (t is the mark's age).
          float sting=exp(-fract(t)*6.0);
          float pulse=0.8+0.2*sin(t*4.0)+sting*0.6;
          vec2 q=vec2(p.x,p.y+0.08);
          float lid=abs(q.y)-0.3*(1.0-q.x*q.x/0.5);
          float eye=exp(-sq(lid/0.04))*step(abs(q.x),0.7);
          float pupil=exp(-dot(q,q)*60.0)*0.9;
          float arch=exp(-sq((length(vec2(p.x,p.y+0.35))-0.75)/0.04))*step(-0.1,p.y);
          float veil=exp(-sq((length(vec2(p.x,p.y+0.35))-0.86)/0.02))*step(-0.05,p.y)*0.5;
          float tears=exp(-sq(p.x/0.05))*exp(-sq((p.y+0.55)/0.12))*0.6;
          float ring=band(r,0.3+0.6*(1.0-sting),0.03)*sting;
          mask=(eye*1.1+pupil+arch*0.8+veil+tears+ring)*pulse*(1.0-smoothstep(0.95,1.0,r));
          color=mix(vColor,HOT,eye*0.4+pupil*0.5+sting*0.3);
        } else {
          // A streamer of veil: a translucent sheet, brighter at its edges,
          // with fibres of light running back along it. t is its segment.
          float along=(t+vUv.x)/${(TRAIL - 1).toFixed(1)};
          float y=abs(vUv.y);
          float edge=exp(-sq((y-0.82)/0.12));
          float fibre=0.6+0.4*sin(vUv.y*9.0+along*20.0-uClockV*3.0);
          float sheet=(1.0-smoothstep(0.8,1.0,y))*0.3*fibre;
          mask=sheet+edge*0.6;
          color=mix(vColor,HOT,edge*0.3);
        }
      `,
      uniforms: { uClockV: { value: 0 } },
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** Once a frame while `id` marches veiled (`ascended`: Ascension empowers it). */
  march(id: number, ascended = false): void {
    if (!this.pool.ready()) return;
    let slot = this.marchers.find((m) => m.active && m.id === id);
    if (!slot) {
      slot = this.marchers.find((m) => !m.active);
      if (!slot) return;
      slot.active = true;
      slot.id = id;
      slot.presence = 0;
      slot.age = 0;
      slot.filled = 0;
      slot.sinceSample = SAMPLE;
      slot.prints.fill(-1);
      slot.nextPrint = 0;
      slot.walked = 0;
      slot.foot = 0;
      slot.ascended = false;
      slot.detail = paladinVfxDetailNow();
      if (this.ctx.anchor(id, 0, this.feet)) {
        slot.lastX = this.feet.x;
        slot.lastZ = this.feet.z;
      }
    }
    slot.seen = true;
    if (ascended) slot.ascended = true;
  }

  /** Once a frame while `target` carries the Veil Mark set by `source`. */
  mark(target: number, source = -1): void {
    if (!this.pool.ready()) return;
    let slot = this.marks.find((m) => m.active && m.target === target);
    if (!slot) {
      slot = this.marks.find((m) => !m.active);
      if (!slot) return;
      slot.active = true;
      slot.target = target;
      slot.presence = 0;
      slot.age = 0;
      slot.strike = -1;
      slot.detail = paladinVfxDetailNow();
    }
    slot.source = source;
    slot.seen = true;
  }

  /** `id`'s march ends in its final wave, bursting at (x, z) (or where they
   * stand): the flare, the ring across the ground and the motes. */
  burst(id: number, x?: number, z?: number): boolean {
    if (!this.pool.ready()) return false;
    const at = this.ctx.anchor(id, 0, this.at);
    if (x === undefined || z === undefined) {
      if (!at) return false;
      x = this.at.x;
      z = this.at.z;
    }
    let y = at ? this.at.y : this.ctx.groundY(x, z);
    if (!Number.isFinite(y)) y = 0;
    let slot = this.bursts.find((b) => !b.active);
    if (!slot) {
      slot = this.bursts[0];
      for (const b of this.bursts) if (b.age > slot.age) slot = b;
    }
    slot.active = true;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.age = 0;
    slot.detail = paladinVfxDetailNow();
    slot.end = paladinLingerEnd(
      BURST_FADE,
      VEIL_BURST_DURATION,
      paladinDetailScale(slot.detail).linger,
    );
    return true;
  }

  /** The final wave of `source`'s march hits `target` (its damage event): the
   * veil snaps shut on them and strikes, an Ascension wave hauling them in. */
  strike(source: number, target: number): boolean {
    if (!this.pool.ready()) return false;
    let mk = this.marks.find((m) => m.active && m.target === target);
    if (!mk) {
      // The mark was never seen here (joined mid-march): the strike still shows.
      mk = this.marks.find((m) => !m.active);
      if (!mk) return false;
      mk.active = true;
      mk.target = target;
      mk.presence = 0;
      mk.seen = false;
      mk.age = 1;
      mk.detail = paladinVfxDetailNow();
    }
    mk.source = source;
    mk.strike = 0;
    mk.strikeDetail = paladinVfxDetailNow();
    const chest = this.ctx.anchor(source, 0.6, this.chest);
    mk.haul =
      chest !== null && this.marchers.some((m) => m.active && m.id === source && m.ascended);
    if (chest) {
      mk.hx = chest.x;
      mk.hy = chest.y;
      mk.hz = chest.z;
    }
    return true;
  }

  private floorAt(x: number, y: number, z: number): number {
    const floor = this.ctx.groundY(x, z);
    return (Number.isFinite(floor) ? Math.max(floor, y - 0.3) : y) + 0.04;
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    const pool = this.pool;
    pool.mesh.material.uniforms.uClockV.value = reduced ? 0 : this.clock;
    pool.begin(this.ctx.camera);
    for (const m of this.marchers) {
      if (!m.active) continue;
      const scale = paladinDetailScale(m.detail);
      m.presence = m.seen
        ? Math.min(1, m.presence + dt * 4)
        : Math.max(0, m.presence - (dt * 3) / scale.linger);
      m.seen = false;
      m.age += dt;
      if (
        m.presence <= 0 ||
        !this.ctx.anchor(m.id, 0.62, this.chest) ||
        !this.ctx.anchor(m.id, 0, this.feet) ||
        !this.ctx.anchor(m.id, 1, this.head)
      ) {
        m.active = false;
        continue;
      }
      const height = Math.max(0.8, this.head.y - this.feet.y);
      const facing = this.ctx.facing(m.id) ?? 0;
      const fx = Math.sin(facing),
        fz = Math.cos(facing);
      const sx = Math.cos(facing),
        sz = -Math.sin(facing);
      const k = m.presence;
      // The veil draping down over them as the march begins.
      if (m.age < DRAPE) {
        const fall = reduced ? 1 : ramp(m.age, 0, DRAPE);
        pool.time = 0;
        pool.ground(
          this.feet.x,
          this.head.y + 0.15 - (height + 0.1) * fall,
          this.feet.z,
          0.75 - 0.15 * fall,
          VEIL,
          1.3 * (1 - ramp(m.age, DRAPE * 0.7, DRAPE)),
          SHAPE.drape,
        );
        pool.time = m.age;
        if (scale.accents)
          pool.billboard(
            this.chest.x,
            this.chest.y,
            this.chest.z,
            1.4,
            KIT_IVORY,
            Math.exp(-m.age * 8) * 1.2,
            SHAPE.flare,
          );
      }
      // The ethereal shroud.
      pool.time = this.clock;
      pool.billboard(
        this.chest.x,
        this.feet.y + height * 0.5,
        this.chest.z,
        height * 0.62,
        VEIL,
        k * ramp(m.age, 0, 0.3),
        SHAPE.shroud,
      );
      // Footprints of light left behind.
      const step = Math.hypot(this.feet.x - m.lastX, this.feet.z - m.lastZ);
      m.lastX = this.feet.x;
      m.lastZ = this.feet.z;
      if (step < 1.5 && scale.secondary) m.walked += step;
      if (m.walked >= STRIDE && scale.secondary) {
        m.walked = 0;
        m.foot = 1 - m.foot;
        const side = m.foot ? 0.13 : -0.13;
        const p = m.nextPrint * 5;
        m.prints[p] = this.feet.x + sx * side;
        m.prints[p + 1] = this.floorAt(this.feet.x, this.feet.y, this.feet.z);
        m.prints[p + 2] = this.feet.z + sz * side;
        m.prints[p + 3] = facing;
        m.prints[p + 4] = 0;
        m.nextPrint = (m.nextPrint + 1) % FOOTPRINTS;
      }
      const printLife = paladinDetailLinger(PRINT_LIFE, m.detail);
      for (let i = 0; i < FOOTPRINTS; i++) {
        const p = i * 5;
        if (m.prints[p + 4] < 0) continue;
        m.prints[p + 4] += dt;
        const age = m.prints[p + 4];
        if (age >= printLife) {
          m.prints[p + 4] = -1;
          continue;
        }
        pool.time = 0;
        pool.ground(
          m.prints[p],
          m.prints[p + 1],
          m.prints[p + 2],
          0.17,
          i % 2 ? VEIL : VEIL_GOLD,
          (1 - age / printLife) * Math.min(1, age / 0.08) * 1.1,
          SHAPE.print,
          Math.PI / 2 - m.prints[p + 3],
        );
      }
      // Motes drifting off the shroud.
      const motes = paladinDetailCount(MOTES, m.detail);
      if (!reduced)
        for (let i = 0; i < motes; i++) {
          const cycle = (this.clock * 0.7 + hash01(i, 4)) % 1;
          const ang = hash01(i, 2) * Math.PI * 2;
          const rad = 0.25 + 0.25 * hash01(i, 3) + cycle * 0.3;
          pool.time = 0;
          pool.billboard(
            this.feet.x + Math.cos(ang) * rad - fx * cycle * 0.5,
            this.feet.y + 0.2 + cycle * height,
            this.feet.z + Math.sin(ang) * rad - fz * cycle * 0.5,
            0.05,
            i % 3 ? VEIL : VEIL_GOLD,
            k * Math.sin(cycle * Math.PI) * 1.1,
            SHAPE.mote,
          );
        }
      // Sample the trail, then the streamers flowing back from the shoulders.
      m.sinceSample += dt;
      if (m.sinceSample >= SAMPLE || m.filled === 0) {
        m.sinceSample = 0;
        m.trail.copyWithin(3, 0, (TRAIL - 1) * 3);
        m.trail[0] = this.chest.x;
        m.trail[1] = this.chest.y;
        m.trail[2] = this.chest.z;
        m.filled = Math.min(TRAIL, m.filled + 1);
      }
      for (let s = 0; scale.secondary && s < STREAMERS; s++) {
        const side = s ? 0.2 : -0.2;
        for (let i = 0; i < TRAIL; i++) {
          const point = i % 2 ? this.b : this.a,
            across = i % 2 ? this.acrossB : this.acrossA;
          this.trailPoint(m, i, side, fx, fz, sx, sz, s, reduced, point);
          // Hanging down as a sheet, narrowing toward its end.
          across.set(0, 0.28 * (1 - (i / TRAIL) * 0.55), 0);
          if (i === 0) continue;
          const prev = i % 2 ? this.a : this.b,
            prevAcross = i % 2 ? this.acrossA : this.acrossB;
          const fadeA = (1 - (i - 1) / (TRAIL - 1)) * k,
            fadeB = (1 - i / (TRAIL - 1)) * k;
          pool.time = i - 1;
          pool.strip(
            prev,
            prevAcross,
            point,
            across,
            s ? VEIL_GOLD : VEIL,
            fadeA * 0.9,
            fadeB * 0.9,
            SHAPE.cloak,
          );
        }
      }
    }
    for (const mk of this.marks) {
      if (!mk.active) continue;
      const scale = paladinDetailScale(mk.detail);
      const struck = paladinDetailScale(mk.strikeDetail);
      mk.presence = mk.seen
        ? Math.min(1, mk.presence + dt * 5)
        : Math.max(0, mk.presence - (dt * 3) / scale.linger);
      mk.seen = false;
      mk.age += dt;
      if (mk.strike >= 0) mk.strike += dt;
      if (
        (mk.presence <= 0 && (mk.strike < 0 || mk.strike > STRIKE)) ||
        !this.ctx.anchor(mk.target, 1, this.head) ||
        !this.ctx.anchor(mk.target, 0.55, this.chest)
      ) {
        mk.active = false;
        continue;
      }
      // Marked: a flash and a ripple as the veil runs through them.
      if (mk.age < 0.45) {
        pool.time = mk.age;
        if (scale.accents)
          pool.billboard(
            this.chest.x,
            this.chest.y,
            this.chest.z,
            1.0,
            KIT_IVORY,
            Math.exp(-mk.age * 9) * 1.2,
            SHAPE.flare,
          );
        if (scale.secondary)
          pool.billboard(this.chest.x, this.chest.y, this.chest.z, 0.9, VEIL, 1, SHAPE.ripple);
      }
      pool.time = reduced ? 0.5 : mk.age;
      pool.billboard(
        this.head.x,
        this.head.y + 0.5,
        this.head.z,
        0.42,
        VEIL,
        mk.presence * 1.2,
        SHAPE.mark,
      );
      // Ascension's haul: a tether of veil drawing them in to the Paladin.
      if (mk.strike >= 0 && mk.haul && mk.strike < VEIL_TETHER) {
        pool.time = mk.strike;
        pool.beam(
          this.chest.x,
          this.chest.y,
          this.chest.z,
          mk.hx,
          mk.hy,
          mk.hz,
          0.16,
          VEIL_GOLD,
          (1 - ramp(mk.strike, VEIL_TETHER * 0.5, VEIL_TETHER)) * 1.2,
          SHAPE.tether,
        );
      }
      // The final wave's strike, from its hit: the veil snapping shut on
      // them as the flare and the ripple break.
      if (mk.strike >= 0 && mk.strike < STRIKE) {
        if (mk.strike < SNAP) {
          pool.time = reduced ? 1 : mk.strike / SNAP;
          pool.billboard(this.chest.x, this.chest.y, this.chest.z, 1.3, VEIL, 1.2, SHAPE.close);
        }
        pool.time = mk.strike;
        if (struck.accents)
          pool.billboard(
            this.chest.x,
            this.chest.y,
            this.chest.z,
            1.3,
            KIT_IVORY,
            Math.exp(-mk.strike * 8) * 1.4,
            SHAPE.flare,
          );
        if (struck.secondary)
          pool.billboard(this.chest.x, this.chest.y, this.chest.z, 1.2, VEIL_GOLD, 1, SHAPE.ripple);
      }
    }
    for (const b of this.bursts) {
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.end) {
        b.active = false;
        continue;
      }
      const t = b.age;
      const y = this.floorAt(b.x, b.y, b.z) + 0.01;
      const scale = paladinDetailScale(b.detail);
      pool.time = t;
      if (scale.accents)
        pool.billboard(b.x, b.y + 1, b.z, 1.8, KIT_IVORY, Math.exp(-t * 7) * 1.3, SHAPE.flare);
      if (scale.secondary) pool.billboard(b.x, b.y + 1, b.z, 1.6, VEIL, 1, SHAPE.ripple);
      pool.ground(
        b.x,
        y,
        b.z,
        VEIL_BURST_REACH,
        VEIL,
        0.55 * (1 - ramp(t, BURST_FADE, b.end)),
        SHAPE.wave,
      );
      const motes = paladinDetailCount(MOTES, b.detail);
      for (let i = 0; i < motes; i++) {
        const life = paladinDetailLinger(0.6 + 0.3 * hash01(i, 4), b.detail);
        if (t >= life) continue;
        const ang = hash01(i, 1) * Math.PI * 2;
        const rad = (0.6 + 1.6 * hash01(i, 2)) * (reduced ? 0.5 : 1) * ramp(t, 0, 0.3);
        pool.time = 0;
        pool.billboard(
          b.x + Math.cos(ang) * rad,
          b.y + 0.4 + t * 1.6,
          b.z + Math.sin(ang) * rad,
          0.06,
          i % 2 ? VEIL : VEIL_GOLD,
          (1 - t / life) * 1.1,
          SHAPE.mote,
        );
      }
    }
    pool.end();
  }

  /** A point of a streamer: trail point `i`, swept to one side, rippling. */
  private trailPoint(
    m: Marcher,
    i: number,
    side: number,
    fx: number,
    fz: number,
    sx: number,
    sz: number,
    s: number,
    reduced: boolean,
    out: THREE.Vector3,
  ): void {
    const k = Math.min(i, m.filled - 1);
    let x = m.trail[k * 3],
      y = m.trail[k * 3 + 1],
      z = m.trail[k * 3 + 2];
    // Stood still, the trail has bunched: let the veil hang out behind.
    const drift = i * 0.14;
    const moved = Math.hypot(x - m.trail[0], z - m.trail[2]);
    if (moved < drift) {
      x -= fx * (drift - moved);
      z -= fz * (drift - moved);
    }
    const spread = side * (1 + (i / TRAIL) * 0.8);
    const ripple = reduced ? 0 : Math.sin(this.clock * 5 - i * 0.7 + s * 2) * 0.1 * (i / TRAIL);
    out.set(
      x + sx * (spread + ripple) - fx * 0.15,
      y + 0.18 - i * 0.03 + (reduced ? 0 : Math.sin(this.clock * 4 - i * 0.6 + s) * 0.04),
      z + sz * (spread + ripple) - fz * 0.15,
    );
  }

  clear(): void {
    for (const m of this.marchers) m.active = false;
    for (const mk of this.marks) mk.active = false;
    for (const b of this.bursts) b.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

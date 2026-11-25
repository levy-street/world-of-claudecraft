import * as THREE from 'three';
import { KIT_FLARE_GLSL, KIT_GOLD, KIT_IVORY, type PaladinKitContext } from './paladin_kit_context';
import { hash01, PaladinQuadPool, ramp } from './paladin_quad_pool';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
} from './paladin_vfx_detail_core';

// Detail: core = the lance (forming and hurled) and the ring at the wound;
// secondary = the streak of its flight, the light bursting out behind, the
// critical strike's second ring and the shard spray; accents = the spark at the
// forming tip and the strike's flare (the motes drawn in scale with count, the
// embedded lance's fade with linger).

export const MERCY_CHANNELS = 6;
export const MERCY_STRIKES = 8;
/** Seconds the lance takes to cross to the target. */
export const MERCY_FLIGHT = 0.12;
/** Seconds the lance stays driven through the target before it dissolves. */
export const MERCY_EMBED = 0.45;
export const MERCY_STRIKE_DURATION = MERCY_FLIGHT + MERCY_EMBED + 0.25;
export const MERCY_SHARDS = 10;
const MOTES = 8;
/** The lance's length (metres) and its half width. */
const LENGTH = 3.1;
const HALF_WIDTH = 0.38;
/** Clearance above the head anchor, including the lower blade edge and bob. */
const CROWN_CLEARANCE = 0.85;
const SHAPE = { lance: 0, streak: 1, flare: 2, ring: 3, shard: 4, mote: 5 } as const;
const QUADS = MERCY_CHANNELS * (2 + MOTES) + MERCY_STRIKES * (7 + MERCY_SHARDS);

interface Channel {
  active: boolean;
  caster: number;
  target: number | null;
  progress: number;
  presence: number;
  seen: boolean;
  age: number;
  /** How much of the lance draws, read when the cast began. */
  detail: PaladinVfxDetail;
}
interface Strike {
  active: boolean;
  source: number;
  target: number;
  age: number;
  hit: boolean;
  absorbed: boolean;
  /** A critical strike (always, under Ascension): it drives through harder. */
  critical: boolean;
  /** Where the lance left from (its tip), and its heading. */
  sx: number;
  sy: number;
  sz: number;
  dx: number;
  dy: number;
  dz: number;
  detail: PaladinVfxDetail;
}

// The lance: an ivory spine, swept flame barbs and a faceted leaf blade.
// uv.x runs from the butt (0) to the tip (1); `build` reveals it
// from the tip back, `heat` warms it.
const LANCE_GLSL = `
  float lanceShape(float u,float v,out float edge){
    float shaft=step(0.04,u)*step(u,0.63)*(1.0-smoothstep(0.055,0.095,abs(v)));
    float s=clamp((u-0.57)/0.43,0.0,1.0);
    // A long pointed blade, with a short heel and a decisive taper to its tip.
    float w=0.68*min(s/0.22,(1.0-s)/0.78);
    float blade=(1.0-smoothstep(max(0.0,w-0.045),max(0.001,w),abs(v)))
      *step(0.57,u)*step(u,0.998);
    // Two swept prongs peel back from the blade's root like sacred fire.
    float g=clamp((u-0.38)/0.23,0.0,1.0);
    float sweep=0.09+0.77*pow(max(1.0-g,0.0),0.7);
    float guard=exp(-sq((abs(v)-sweep)/(0.018+0.065*g)))
      *smoothstep(0.38,0.42,u)*(1.0-smoothstep(0.59,0.62,u));
    vec2 q=vec2((u-0.03)*19.0,v*2.0);
    float pommel=1.0-smoothstep(0.7,0.9,abs(q.x)+abs(q.y));
    float body=max(max(shaft,blade),max(guard,pommel));
    edge=exp(-sq((abs(v)-w)/0.028))*step(0.57,u)*step(0.02,w)
      +exp(-sq((abs(v)-0.075)/0.025))*step(0.04,u)*step(u,0.57)+guard*0.6;
    return body;
  }
`;

/**
 * Mercy Lance. Through the cast a lance of light forms above the Paladin,
 * point toward the enemy, drawn out of the air from its tip back while motes
 * stream into it. On the hit it is hurled: it crosses in a streak and drives
 * through the target in a flare, a ring of light and a spray of shards, holds
 * there a moment, and burns away.
 */
export class MercyLance {
  private readonly pool: PaladinQuadPool<'mercy_lance'>;
  private readonly channels: Channel[] = Array.from({ length: MERCY_CHANNELS }, () => ({
    active: false,
    caster: -1,
    target: null,
    progress: 0,
    presence: 0,
    seen: false,
    age: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly strikes: Strike[] = Array.from({ length: MERCY_STRIKES }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    hit: true,
    absorbed: false,
    critical: false,
    sx: 0,
    sy: 0,
    sz: 0,
    dx: 0,
    dy: 0,
    dz: 1,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'mercy_lance', QUADS, {
      helpers: KIT_FLARE_GLSL + LANCE_GLSL,
      // The strike plays at the body: pulled toward the camera so it shows.
      pull: 'aShape>1.5&&aShape<4.5?0.6:0.0',
      body: `
        if(vShape>4.5){
          // A mote of light drawn into the forming lance.
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.6);
        } else if(vShape>3.5){
          mask=kitDiamond(p);
          color=mix(vColor,HOT,exp(-abs(abs(p.x)+abs(p.y)-0.9)*16.0));
        } else if(vShape>2.5){
          // The ring of the strike, opening out from the wound.
          float grow=1.0-sq(max(1.0-clamp(t/0.35,0.0,1.0),0.0));
          mask=(band(r,0.18+0.75*grow,0.035+0.05*grow)*1.2+band(r,0.18+0.62*grow,0.02)*0.5)
            *(1.0-grow*0.85)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.55);
        } else if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>0.5){
          // Streak: the lance's flight, hot at the head, fading behind.
          float across=exp(-vUv.y*vUv.y*5.0);
          float core=exp(-vUv.y*vUv.y*40.0);
          float along=smoothstep(0.0,0.6,vUv.x)*smoothstep(1.0,0.96,vUv.x);
          mask=(across*0.4+core*1.1)*along;
          color=mix(vColor,HOT,core*0.85);
        } else {
          // The lance. vTime packs its build (integer part, 0..1 x 1000) and heat.
          float build=floor(t)/1000.0;
          float heat=fract(t);
          float u=vUv.x, v=vUv.y;
          float edge;
          float body=lanceShape(u,v,edge);
          float shown=smoothstep(1.0-build-0.04,1.0-build,u);
          float front=exp(-sq((u-(1.0-build))/0.025))*step(build,0.995);
          float core=exp(-v*v*220.0)*step(0.04,u)*(1.0-smoothstep(0.96,1.0,u));
          float glow=exp(-max(abs(v)-0.1,0.0)*9.0)*0.12*smoothstep(0.0,0.1,u)*(1.0-smoothstep(0.9,1.0,u));
          // Layered golden flame filaments hold the shaft in suspension.
          float strand=0.13+0.22*sq(sin(clamp((u-0.07)/0.53,0.0,1.0)*PI));
          float filigree=exp(-sq((abs(v)-strand)/0.022))
            *smoothstep(0.07,0.16,u)*(1.0-smoothstep(0.5,0.6,u));
          float facets=body*(0.13+0.24*smoothstep(-0.7,0.3,v));
          // A sun set in the crossguard.
          vec2 sq2=vec2((u-0.60)*11.0,v*1.3);
          float sun=exp(-dot(sq2,sq2)*30.0)*1.4;
          mask=(facets*(0.7+0.3*heat)+edge*0.9+core*(0.55+0.55*heat)+glow+sun+filigree*0.8)*shown
            +front*(body+filigree*0.4)*1.4;
          color=mix(vColor,HOT,clamp(edge*0.6+core+front+sun+heat*0.3,0.0,1.0));
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** Once a frame while the Paladin casts Mercy Lance; `progress` runs 0..1. */
  channel(caster: number, target: number | null, progress: number): void {
    if (!this.pool.ready()) return;
    let slot = this.channels.find((c) => c.active && c.caster === caster);
    if (!slot) {
      slot = this.channels.find((c) => !c.active);
      if (!slot) return;
      slot.active = true;
      slot.caster = caster;
      slot.presence = 0;
      slot.age = 0;
      slot.detail = paladinVfxDetailNow();
    }
    slot.seen = true;
    slot.target = target;
    slot.progress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  }

  /** The cast lands: the lance is hurled through the target (`critical`:
   * a critical strike, which Ascension makes certain, drives through harder). */
  strike(
    source: number,
    target: number,
    outcome: 'damage' | 'absorb' | 'none',
    critical = false,
  ): boolean {
    if (!this.pool.ready() || source === target) return false;
    if (!this.holdPose(source, target)) return false;
    let slot = this.strikes.find((s) => !s.active);
    if (!slot) {
      slot = this.strikes[0];
      for (const s of this.strikes) if (s.age > slot.age) slot = s;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.age = 0;
    slot.hit = outcome !== 'none';
    slot.absorbed = outcome === 'absorb';
    slot.critical = critical && outcome === 'damage';
    slot.sx = this.tip.x;
    slot.sy = this.tip.y;
    slot.sz = this.tip.z;
    slot.dx = this.dir.x;
    slot.dy = this.dir.y;
    slot.dz = this.dir.z;
    slot.detail = paladinVfxDetailNow();
    // The held lance has been thrown.
    const held = this.channels.find((c) => c.active && c.caster === source);
    if (held) held.active = false;
    return true;
  }

  /** Where the lance is held through the cast: its tip and heading. */
  private holdPose(caster: number, target: number | null): boolean {
    if (!this.ctx.anchor(caster, 1, this.from)) return false;
    let dx: number, dz: number;
    if (target !== null && this.ctx.anchor(target, 0.6, this.to)) {
      dx = this.to.x - this.from.x;
      dz = this.to.z - this.from.z;
    } else {
      const facing = this.ctx.facing(caster) ?? 0;
      dx = Math.sin(facing);
      dz = Math.cos(facing);
    }
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    // Suspended over the crown, with room for the full blade and its motes.
    const side = 0.12;
    const cx = this.from.x - dz * side + dx * 0.15,
      cz = this.from.z + dx * side + dz * 0.15,
      cy = this.from.y + CROWN_CLEARANCE;
    const tilt = 0.055;
    this.dir.set(dx, tilt, dz).normalize();
    this.tip.set(
      cx + this.dir.x * LENGTH * 0.6,
      cy + this.dir.y * LENGTH * 0.6,
      cz + this.dir.z * LENGTH * 0.6,
    );
    return true;
  }

  private drawLance(
    tx: number,
    ty: number,
    tz: number,
    dx: number,
    dy: number,
    dz: number,
    build: number,
    heat: number,
    alpha: number,
  ): void {
    const pool = this.pool;
    pool.time =
      Math.round(Math.min(1, Math.max(0, build)) * 1000) + Math.min(0.999, Math.max(0, heat));
    pool.beam(
      tx - dx * LENGTH,
      ty - dy * LENGTH,
      tz - dz * LENGTH,
      tx,
      ty,
      tz,
      HALF_WIDTH,
      KIT_GOLD,
      alpha,
      SHAPE.lance,
    );
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    const pool = this.pool;
    pool.begin(this.ctx.camera);
    for (const c of this.channels) {
      if (!c.active) continue;
      c.presence = c.seen ? Math.min(1, c.presence + dt * 8) : Math.max(0, c.presence - dt * 5);
      c.seen = false;
      c.age += dt;
      if (c.presence <= 0 || !this.holdPose(c.caster, c.target)) {
        c.active = false;
        continue;
      }
      const build = ramp(c.progress, 0.05, 0.8);
      const bob = reduced ? 0 : Math.sin(this.clock * 3.1) * 0.03;
      this.drawLance(
        this.tip.x,
        this.tip.y + bob,
        this.tip.z,
        this.dir.x,
        this.dir.y,
        this.dir.z,
        build,
        0.2 + 0.6 * c.progress,
        c.presence,
      );
      // Motes of light drawn in along the lance as it forms.
      if (!reduced) {
        const motes = paladinDetailCount(MOTES, c.detail);
        for (let i = 0; i < motes; i++) {
          const cycle = (this.clock * 1.4 + hash01(i, c.caster)) % 1;
          const along = 1 - (0.15 + 0.8 * hash01(i, 7)) * build;
          const lx = this.tip.x - this.dir.x * LENGTH * along,
            ly = this.tip.y + bob - this.dir.y * LENGTH * along,
            lz = this.tip.z - this.dir.z * LENGTH * along;
          const out = (1 - cycle) * 0.7;
          const ang = hash01(i, 3) * Math.PI * 2;
          pool.time = 0;
          pool.billboard(
            lx + Math.cos(ang) * out,
            ly + Math.sin(ang) * out * 0.7,
            lz + Math.sin(ang * 1.7) * out * 0.5,
            0.05,
            KIT_IVORY,
            c.presence * Math.sin(cycle * Math.PI) * c.progress * 1.4,
            SHAPE.mote,
          );
        }
      }
      // A spark at the forming tip.
      if (!paladinDetailScale(c.detail).accents) continue;
      pool.time = 0;
      pool.billboard(
        this.tip.x,
        this.tip.y + bob,
        this.tip.z,
        0.2 + 0.12 * c.progress,
        KIT_IVORY,
        c.presence * (0.4 + 0.6 * c.progress),
        SHAPE.flare,
      );
    }
    for (const s of this.strikes) {
      if (!s.active) continue;
      s.age += dt;
      const scale = paladinDetailScale(s.detail);
      // The embedded lance burns away sooner on the lighter tiers.
      const burnEnd =
        s.detail === 'full'
          ? MERCY_EMBED + 0.15
          : MERCY_EMBED * 0.6 + paladinDetailLinger(MERCY_EMBED * 0.4 + 0.15, s.detail);
      const end = s.detail === 'full' ? MERCY_STRIKE_DURATION : MERCY_FLIGHT + burnEnd + 0.1;
      if (s.age >= end || !this.ctx.anchor(s.target, 0.6, this.to)) {
        s.active = false;
        continue;
      }
      const t = s.age;
      // The heading from the throw to the body, driving through it.
      let hx = this.to.x - s.sx,
        hy = this.to.y - s.sy,
        hz = this.to.z - s.sz;
      const hl = Math.hypot(hx, hy, hz) || 1;
      hx /= hl;
      hy /= hl;
      hz /= hl;
      const pierce = s.hit ? 0.55 : -0.1;
      const ex = this.to.x + hx * pierce,
        ey = this.to.y + hy * pierce,
        ez = this.to.z + hz * pierce;
      const f = Math.min(1, t / MERCY_FLIGHT);
      const flying = f * f;
      const tx = s.sx + (ex - s.sx) * flying,
        ty = s.sy + (ey - s.sy) * flying,
        tz = s.sz + (ez - s.sz) * flying;
      const after = Math.max(0, t - MERCY_FLIGHT);
      const fade = 1 - ramp(after, MERCY_EMBED * 0.6, burnEnd);
      const weak = s.absorbed ? 0.6 : 1;
      // The lance itself, white-hot in flight, cooling where it is driven in.
      this.drawLance(tx, ty, tz, hx, hy, hz, 1, Math.max(0.2, 1 - after * 2), fade);
      // The streak of its flight.
      if (t < MERCY_FLIGHT + 0.2 && scale.secondary) {
        const trail = 1 - ramp(t, MERCY_FLIGHT, MERCY_FLIGHT + 0.2);
        pool.time = 0;
        pool.beam(s.sx, s.sy, s.sz, tx, ty, tz, 0.2, KIT_GOLD, trail * 0.9, SHAPE.streak);
      }
      if (!s.hit || t < MERCY_FLIGHT) continue;
      // The strike: a flare and a ring at the wound, the light bursting out
      // behind, and a spray of shards.
      const crit = s.critical ? 1.3 : 1;
      pool.time = after;
      if (scale.accents)
        pool.billboard(
          this.to.x,
          this.to.y,
          this.to.z,
          1.3 * crit,
          KIT_IVORY,
          Math.exp(-after * 9) * 1.4 * weak,
          SHAPE.flare,
        );
      pool.billboard(this.to.x, this.to.y, this.to.z, 1.2 * crit, KIT_GOLD, weak, SHAPE.ring);
      // A critical strike: a second, wider ring of gold breaks out behind it.
      if (!scale.secondary) continue;
      if (s.critical && after > 0.06) {
        pool.time = after - 0.06;
        pool.billboard(this.to.x, this.to.y, this.to.z, 2.1, KIT_GOLD, 1.1, SHAPE.ring);
      }
      if (after < 0.3) {
        const burst = 1 - after / 0.3;
        pool.time = 0;
        pool.beam(
          this.to.x,
          this.to.y,
          this.to.z,
          this.to.x + hx * 1.6,
          this.to.y + hy * 1.6,
          this.to.z + hz * 1.6,
          0.28 * burst + 0.05,
          KIT_IVORY,
          burst * weak,
          SHAPE.streak,
        );
      }
      const motion = reduced ? 0.3 : 1;
      const c = pool.cam;
      const shards = paladinDetailCount(MERCY_SHARDS, s.detail);
      for (let i = 0; i < shards; i++) {
        const life = 0.3 + 0.2 * hash01(i, 3);
        if (after >= life) continue;
        const ang = i * 2.399963 + hash01(i, 1);
        const speed = (2 + 2.6 * hash01(i, 2)) * motion * (s.critical ? 1.35 : 1);
        const ux = Math.cos(ang),
          uy = Math.sin(ang);
        // Out in the view plane, carried on along the lance's heading.
        const ox = (c[0] * ux + c[3] * uy) * speed * after + hx * after * 2.5 * motion,
          oy = (c[1] * ux + c[4] * uy) * speed * after - 3 * after * after * motion,
          oz = (c[2] * ux + c[5] * uy) * speed * after + hz * after * 2.5 * motion;
        pool.time = 0;
        pool.billboard(
          this.to.x + ox,
          this.to.y + oy,
          this.to.z + oz,
          0.06 + 0.05 * hash01(i, 4),
          i % 3 ? KIT_GOLD : KIT_IVORY,
          (1 - after / life) * 1.2 * weak,
          SHAPE.shard,
          after * (6 + 5 * hash01(i, 5)),
        );
      }
    }
    pool.end();
  }

  clear(): void {
    for (const c of this.channels) c.active = false;
    for (const s of this.strikes) s.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

import * as THREE from 'three';
import { HEAL_PLUS_GLSL, HEAL_PLUS_QUAD } from './heal_plus';
import {
  KIT_AMBER,
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
  paladinDetailScale,
  paladinLingerEnd,
} from './paladin_vfx_detail_core';

export const EMBRACE_CHANNELS = 6;
export const EMBRACES = 8;
/** The strands draw in about the Paladin through the end of the cast and
 * burst this long after it completes. */
export const EMBRACE_WRAP = 0.04;
/** The share of the cast from which the strands draw in. */
const DRAW_IN = 0.8;
/** The stream of dawn light reaches the ally this long after the burst. */
export const EMBRACE_TRAVEL = 0.24;
/** The healing on the ally, from the stream landing until it fades. */
export const EMBRACE_BLOOM = 1.25;
export const EMBRACE_DURATION = EMBRACE_WRAP + EMBRACE_TRAVEL + EMBRACE_BLOOM;
/** Strands of dawn light spiralling about the Paladin. */
const STRANDS = 2;
const SEGMENTS = 32;
/** Turns each strand makes from the feet to the head. */
const TURNS = 1.25;
const MOTES = 10;
const PLUSES = 8;
/** Each plus of healing rises over this long. */
const PLUS_LIFE = 0.8;
const STREAM_SEGMENTS = 12;
const STREAM_PLUSES = 3;
/** How high over the top of the Paladin's head the sun kindles. */
const SUN_LIFT = 0.75;
const SHAPE = {
  dawn: 0,
  strand: 1,
  column: 2,
  flare: 3,
  wave: 4,
  mote: 5,
  plus: 6,
  sun: 7,
  stream: 8,
} as const;
const QUADS =
  EMBRACE_CHANNELS * (3 + STRANDS * SEGMENTS + MOTES) +
  EMBRACES * (STRANDS * SEGMENTS + 6 + STREAM_SEGMENTS + STREAM_PLUSES + PLUSES);

interface Channel {
  active: boolean;
  caster: number;
  target: number;
  progress: number;
  presence: number;
  seen: boolean;
  spin: number;
  /** The Paladin detail read when the cast was first seen. */
  detail: PaladinVfxDetail;
}
interface Embrace {
  active: boolean;
  source: number;
  target: number;
  age: number;
  spin: number;
  /** Ascension empowered it: the dawn breaks in full, gilded. */
  gilded: boolean;
  /** The Paladin detail read when the cast completed. */
  detail: PaladinVfxDetail;
  /** The healing's bloom on the ally, from the stream landing until it ends. */
  bloom: number;
}

/**
 * Dawn's Embrace. Through the cast the dawn gathers about the Paladin: a
 * sunrise spreads its rays across the ground beneath them, and two strands of
 * dawn light, amber at the feet to ivory at the head, spiral up about them as
 * the cast builds, drawing in tight about them as it ends, while a sun kindles
 * over their head and grows. On release the strands burst open, the sun flares
 * and a stream of dawn light arcs out of it to the ally as Mending Light's
 * does, pluses riding it, as the sun fades. Where it lands the healing takes:
 * a flare, a wave across the ground and pluses of healing spiralling up about
 * them. Cast on themselves, the healing takes on the Paladin as the strands
 * burst.
 *
 * Detail: core = the sun over the Paladin, the strands of dawn light, the
 * stream to the ally and the pluses of healing spiralling up about them;
 * secondary = the sunrise on the ground, the column within the strands and the
 * waves across the ground where the healing takes (the gilded second wave
 * with them); accents = the flares and the pluses riding the stream. Light
 * drops the accents and halves the motes and pluses; minimal keeps the core
 * with a third of them, and both shorten the fades.
 */
export class DawnsEmbrace {
  private readonly pool: PaladinQuadPool<'dawns_embrace'>;
  private readonly channels: Channel[] = Array.from({ length: EMBRACE_CHANNELS }, () => ({
    active: false,
    caster: -1,
    target: -1,
    progress: 0,
    presence: 0,
    seen: false,
    spin: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly embraces: Embrace[] = Array.from({ length: EMBRACES }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    spin: 0,
    gilded: false,
    detail: 'full' as PaladinVfxDetail,
    bloom: EMBRACE_BLOOM,
  }));
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly acrossA = new THREE.Vector3();
  private readonly acrossB = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  /** The sun over the Paladin's head, where the stream leaves them. */
  private readonly crown = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'dawns_embrace', QUADS, {
      helpers: KIT_FLARE_GLSL + HEAL_PLUS_GLSL,
      pull: '(aShape<0.5||(aShape>3.5&&aShape<4.5))?0.4:((aShape>2.5&&aShape<7.5)?0.5:(aShape>0.5&&aShape<1.5?0.12:0.0))',
      body: `
        if(vShape>7.5){
          // A segment of the stream: a band of dawn light with a bright core and
          // light flowing along it.
          float across=exp(-vUv.y*vUv.y*4.0);
          float core=exp(-vUv.y*vUv.y*30.0);
          float flow=0.75+0.25*sin((vUv.x-t)*10.0);
          mask=(across*0.4+core*1.1)*flow;
          color=mix(vColor,HOT,core*0.7);
        } else if(vShape>6.5){
          // The sun over the Paladin: a white disc in a corona, long and short
          // rays turning (t is their turn), a soft glow about it.
          float rays=(pow(max(cos(a*8.0+t),0.0),18.0)*(1.0-smoothstep(0.5,0.95,r))
            +pow(max(cos(a*8.0+3.14159+t),0.0),28.0)*(1.0-smoothstep(0.36,0.58,r))*0.6)
            *smoothstep(0.24,0.29,r);
          float disc=1.0-smoothstep(0.17,0.2,r);
          float corona=band(r,0.22,0.018)+exp(-r*r*7.0)*0.35;
          mask=(disc*1.3+corona+rays*0.9)*(1.0-smoothstep(0.92,1.0,r));
          color=mix(vColor,HOT,clamp(disc+band(r,0.22,0.018)*0.5,0.0,1.0));
        } else if(vShape>5.5){
          mask=healPlusQuad(p);
          color=mix(vColor,HOT,exp(-dot(p,p)*13.5)*0.8);
        } else if(vShape>4.5){
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.6);
        } else if(vShape>3.5){
          // The burst's wave out across the ground.
          float grow=1.0-sq(max(1.0-clamp(t/0.6,0.0,1.0),0.0));
          mask=(band(r,0.15+0.8*grow,0.012+0.03*grow)*1.3+band(r,0.12+0.76*grow,0.07)*0.3)
            *(1.0-grow*0.8)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.45);
        } else if(vShape>2.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>1.5){
          // A soft column of dawn light within the strands.
          float across=exp(-vUv.y*vUv.y*3.0);
          float core=exp(-vUv.y*vUv.y*20.0);
          float along=smoothstep(0.0,0.15,vUv.x)*(1.0-smoothstep(0.7,1.0,vUv.x));
          mask=(across*0.25+core*0.3)*along;
          color=mix(vColor,HOT,core*0.5);
        } else if(vShape>0.5){
          // A segment of a strand: a thin ribbon of light, as Life Covenant's
          // swirling wisps (guardian_covenant.ts); its brightness, bright head
          // to fading tail, rides in the alpha.
          mask=exp(-vUv.y*vUv.y*4.0);
          color=vColor*1.25;
        } else {
          // The sunrise on the ground: a ring with rays reaching out from it,
          // lengthening as the dawn grows (t is the cast's progress).
          const float SECTOR=6.2831853/24.0;
          float cell=floor(a/SECTOR+0.5);
          float off=abs(a-cell*SECTOR)*r;
          float reach=0.55+(mod(cell,2.0)<0.5?0.4:0.24)*t;
          float ray=(1.0-smoothstep(0.008,0.018,off*(1.0+(r-0.55)*2.5)))
            *smoothstep(0.55,0.57,r)*(1.0-smoothstep(reach-0.04,reach,r));
          float ring=band(r,0.52,0.01)*0.55+band(r,0.44,0.005)*0.25;
          float glow=exp(-r*r*9.0)*(0.08+0.14*t);
          mask=(ring+ray*(0.45+0.45*t)+glow)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,band(r,0.52,0.006)*0.5+glow*0.5);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** Once a frame while the Paladin casts Dawn's Embrace on `target`. */
  channel(caster: number, target: number | null, progress: number): void {
    if (!this.pool.ready()) return;
    const on = target ?? caster;
    let slot = this.channels.find((c) => c.active && c.caster === caster);
    if (!slot) {
      slot = this.channels.find((c) => !c.active);
      if (!slot) return;
      slot.active = true;
      slot.caster = caster;
      slot.presence = 0;
      slot.spin = 0;
      slot.detail = paladinVfxDetailNow();
    }
    slot.seen = true;
    slot.target = on;
    slot.progress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  }

  /** The cast completes: the strands burst and the dawn streams to the ally. */
  embrace(caster: number, target: number | null): boolean {
    if (!this.pool.ready()) return false;
    const on = target ?? caster;
    let slot = this.embraces.find(
      (e) => e.active && e.source === caster && e.target === on && e.age < 0.1,
    );
    if (slot) return true;
    slot = this.embraces.find((e) => !e.active);
    if (!slot) {
      slot = this.embraces[0];
      for (const e of this.embraces) if (e.age > slot.age) slot = e;
    }
    slot.active = true;
    slot.source = caster;
    slot.target = on;
    slot.age = 0;
    slot.gilded = false;
    slot.detail = paladinVfxDetailNow();
    // A shorter bloom on lighter tiers, never cutting the last plus short.
    const linger = paladinDetailScale(slot.detail).linger;
    slot.bloom =
      linger === 1
        ? EMBRACE_BLOOM
        : Math.max(
            EMBRACE_BLOOM * linger,
            0.05 * (paladinDetailCount(PLUSES, slot.detail) - 1) + PLUS_LIFE,
          );
    // The strands carry on from where the cast left them.
    const held = this.channels.find((c) => c.active && c.caster === caster);
    slot.spin = held ? held.spin : 0;
    if (held) held.active = false;
    return true;
  }

  /** Ascension empowered `caster`'s embrace just released: it breaks gilded. */
  gild(caster: number): boolean {
    let slot: Embrace | null = null;
    for (const e of this.embraces)
      if (e.active && e.source === caster && e.age < 0.3 && (!slot || e.age < slot.age)) slot = e;
    if (!slot) return false;
    slot.gilded = true;
    return true;
  }

  /** Where `id` stands: its feet, chest and the top of its head. */
  private body(id: number): number {
    if (!this.ctx.anchor(id, 0, this.feet) || !this.ctx.anchor(id, 1, this.head)) return 0;
    this.ctx.anchor(id, 0.55, this.chest);
    return Math.max(0.8, this.head.y - this.feet.y);
  }

  private floorAt(lift: number): number {
    const floor = this.ctx.groundY(this.feet.x, this.feet.z);
    return (Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y) + lift;
  }

  /** A point `u` of the way up a strand spiralling about the Paladin. */
  private strandPoint(
    u: number,
    phase: number,
    radius: number,
    height: number,
    lift: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const ang = phase + u * TURNS * Math.PI * 2;
    const rad = radius * (1 - 0.3 * u);
    return out.set(
      this.feet.x + Math.cos(ang) * rad,
      this.feet.y + 0.05 + lift + u * height * 1.05,
      this.feet.z + Math.sin(ang) * rad,
    );
  }

  /**
   * Both strands up to `reach` of the way, drawn as Life Covenant's swirling
   * wisps are (guardian_covenant.ts): thin ribbons of light turned to the
   * camera, bright at the head and fading to the tail, a shimmer running along
   * them, gold toward ivory at the head. `flow` is the strands' clock, still
   * for reduced motion.
   */
  private strands(
    spin: number,
    reach: number,
    radius: number,
    height: number,
    lift: number,
    alpha: number,
    flow: number,
  ): void {
    if (reach <= 0.01 || alpha <= 0.003) return;
    const pool = this.pool;
    const c = pool.cam;
    const half = height * 0.022;
    for (let k = 0; k < STRANDS; k++) {
      const phase = spin + (k / STRANDS) * Math.PI * 2;
      for (let i = 0; i <= SEGMENTS; i++) {
        const along = i / SEGMENTS,
          u = reach * along;
        const point = i % 2 ? this.b : this.a,
          across = i % 2 ? this.acrossB : this.acrossA;
        this.strandPoint(u, phase, radius, height, lift, point);
        // Across the ribbon: perpendicular to both it and the view.
        this.strandPoint(u + 0.01, phase, radius, height, lift, this.ahead).sub(point);
        across.set(
          this.ahead.y * c[8] - this.ahead.z * c[7],
          this.ahead.z * c[6] - this.ahead.x * c[8],
          this.ahead.x * c[7] - this.ahead.y * c[6],
        );
        const length = across.length();
        if (length < 1e-6) across.set(c[0], c[1], c[2]).multiplyScalar(half);
        else across.multiplyScalar(half / length);
        if (i === 0) continue;
        const prev = i % 2 ? this.a : this.b,
          prevAcross = i % 2 ? this.acrossA : this.acrossB;
        const glow = (x: number) => x ** 1.4 * (0.75 + 0.25 * Math.sin(x * 18 - flow * 5));
        const mid = along - 0.5 / SEGMENTS;
        this.tint.lerpColors(KIT_GOLD, KIT_IVORY, mid * mid * 0.6);
        pool.time = 0;
        pool.strip(
          prev,
          prevAcross,
          point,
          across,
          this.tint,
          alpha * glow(along - 1 / SEGMENTS),
          alpha * glow(along),
          SHAPE.strand,
        );
      }
    }
  }

  /** A point `u` of the way along the stream's arc from the sun to the ally's chest. */
  private streamPoint(u: number, out: THREE.Vector3): THREE.Vector3 {
    const sx = this.crown.x,
      sy = this.crown.y,
      sz = this.crown.z,
      tx = this.chest.x,
      ty = this.chest.y,
      tz = this.chest.z;
    const mx = (sx + tx) / 2,
      my = Math.max(sy, ty) + 0.6,
      mz = (sz + tz) / 2;
    const q = 1 - u;
    return out.set(
      q * q * sx + 2 * q * u * mx + u * u * tx,
      q * q * sy + 2 * q * u * my + u * u * ty,
      q * q * sz + 2 * q * u * mz + u * u * tz,
    );
  }

  /** The stream of dawn light from the Paladin to the ally, its head at
   * `head` and tail at `tail` of the way there, pluses riding it (`pluses`:
   * the tier draws its accents). */
  private stream(head: number, tail: number, pluses: boolean): void {
    head = Math.min(1, head);
    tail = Math.max(0, tail);
    if (head <= tail) return;
    const pool = this.pool;
    const n = STREAM_SEGMENTS;
    for (let i = 0; i < n; i++) {
      const u0 = tail + ((head - tail) * i) / n,
        u1 = tail + ((head - tail) * (i + 1)) / n;
      this.streamPoint(u0, this.a);
      this.streamPoint(u1, this.b);
      // Amber leaving the Paladin, ivory arriving.
      this.tint.lerpColors(KIT_AMBER, KIT_IVORY, (u0 + u1) / 2);
      pool.time = this.clock + i / n;
      pool.beam(
        this.a.x,
        this.a.y,
        this.a.z,
        this.b.x,
        this.b.y,
        this.b.z,
        0.2 * Math.sin(((i + 0.5) / n) * Math.PI) + 0.06,
        this.tint,
        1.2,
        SHAPE.stream,
      );
    }
    for (let i = 0; pluses && i < STREAM_PLUSES; i++) {
      const u = head - 0.05 - i * 0.2;
      if (u <= tail) break;
      this.streamPoint(u, this.a);
      pool.time = 0;
      pool.billboard(
        this.a.x,
        this.a.y,
        this.a.z,
        0.17 * HEAL_PLUS_QUAD,
        i % 2 ? KIT_IVORY : KIT_WARM,
        1.1,
        SHAPE.plus,
      );
    }
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    const pool = this.pool;
    const flow = reduced ? 0 : this.clock * 1.2;
    pool.begin(this.ctx.camera);
    for (const c of this.channels) {
      if (!c.active) continue;
      c.presence = c.seen ? Math.min(1, c.presence + dt * 6) : Math.max(0, c.presence - dt * 5);
      c.seen = false;
      const height = this.body(c.caster);
      if (c.presence <= 0 || !height) {
        c.active = false;
        continue;
      }
      const k = c.presence;
      const grow = c.progress;
      const scale = paladinDetailScale(c.detail);
      // Drawing in tight about the Paladin, spinning faster, as the cast ends.
      const drawIn = reduced ? 0 : ramp(grow, DRAW_IN, 1);
      if (!reduced) c.spin += dt * (0.8 + 1.6 * grow + 7 * drawIn);
      // The sunrise spreading across the ground.
      pool.time = grow;
      if (scale.secondary)
        pool.ground(
          this.feet.x,
          this.floorAt(0.05),
          this.feet.z,
          2.3,
          KIT_WARM,
          k * (0.45 + 0.4 * grow),
          SHAPE.dawn,
        );
      // The sun kindling over their head, growing as the cast builds.
      pool.time = c.spin;
      pool.billboard(
        this.head.x,
        this.head.y + SUN_LIFT,
        this.head.z,
        (0.4 + 0.5 * grow) * (1 + 0.15 * drawIn),
        KIT_WARM,
        k * ramp(grow, 0, 0.3) * (0.8 + 0.5 * grow),
        SHAPE.sun,
      );
      // The strands climbing about the Paladin as the cast builds.
      const reach = reduced ? 1 : 0.08 + 0.92 * ramp(grow, 0, 0.92);
      this.strands(c.spin, reach, 0.85 - 0.4 * drawIn, height, 0, k * (0.8 + 0.5 * grow), flow);
      pool.time = 0;
      if (scale.secondary)
        pool.upright(
          this.feet.x,
          this.feet.y + (height * reach) / 2 + 0.1,
          this.feet.z,
          0.5,
          (height * reach) / 2 + 0.25,
          KIT_GOLD,
          k * grow * 0.35,
          SHAPE.column,
        );
      if (!reduced) {
        const motes = paladinDetailCount(MOTES, c.detail);
        for (let i = 0; i < motes; i++) {
          const cycle = (this.clock * 0.6 + hash01(i, 4)) % 1;
          const ang = hash01(i, 1) * Math.PI * 2 + cycle * 1.5;
          const rad = 0.25 + 0.4 * hash01(i, 2);
          pool.billboard(
            this.feet.x + Math.cos(ang) * rad,
            this.feet.y + cycle * height * 1.1,
            this.feet.z + Math.sin(ang) * rad,
            0.045,
            KIT_IVORY,
            k * Math.sin(cycle * Math.PI) * (0.3 + grow),
            SHAPE.mote,
          );
        }
      }
    }
    for (const e of this.embraces) {
      if (!e.active) continue;
      e.age += dt;
      const self = e.source === e.target;
      const travel = self ? 0 : EMBRACE_TRAVEL;
      const casterHeight = this.body(e.source);
      if (e.age >= EMBRACE_WRAP + travel + e.bloom || !casterHeight) {
        e.active = false;
        continue;
      }
      const t = e.age;
      const scale = paladinDetailScale(e.detail);
      // About the Paladin: drawn in tight from the cast, burst open and fade.
      const open = reduced ? 0 : ramp(t, EMBRACE_WRAP, EMBRACE_WRAP + 0.5);
      const opened = 1 - (1 - open) * (1 - open);
      if (!reduced) e.spin += dt * (2 + 8 * (1 - open));
      const radius = 0.45 + 1.5 * opened;
      const strandFade =
        (1 -
          ramp(
            t,
            EMBRACE_WRAP + 0.05,
            paladinLingerEnd(EMBRACE_WRAP + 0.05, EMBRACE_WRAP + 0.55, scale.linger),
          )) *
        1.2;
      this.strands(e.spin, 1, radius, casterHeight, 0.4 * opened, strandFade, flow);
      // The sunrise on the ground fades as the dawn is gathered.
      pool.time = 1;
      if (scale.secondary)
        pool.ground(
          this.feet.x,
          this.floorAt(0.05),
          this.feet.z,
          2.3,
          KIT_WARM,
          1.2 * (1 - ramp(t, 0.1, paladinLingerEnd(0.1, 0.6, scale.linger))),
          SHAPE.dawn,
        );
      // The sun flares as the dawn is released out of it, then fades.
      this.crown.set(this.head.x, this.head.y + SUN_LIFT, this.head.z);
      const burst = t - EMBRACE_WRAP;
      const flash = burst < 0 ? 0 : Math.exp(-burst * 6);
      pool.time = e.spin;
      pool.billboard(
        this.crown.x,
        this.crown.y,
        this.crown.z,
        1.03 * (1 + 0.35 * flash),
        KIT_WARM,
        1.3 * (1 - ramp(burst, 0.2, paladinLingerEnd(0.2, 0.75, scale.linger))),
        SHAPE.sun,
      );
      if (burst < 0) continue;
      const gild = e.gilded ? 1.3 : 1;
      pool.time = burst;
      if (scale.accents)
        pool.billboard(
          this.crown.x,
          this.crown.y,
          this.crown.z,
          1.4 * gild,
          KIT_IVORY,
          flash * 1.2,
          SHAPE.flare,
        );
      const height = this.body(e.target);
      if (!height) {
        e.active = false;
        continue;
      }
      if (!self && burst < travel + 0.15)
        this.stream(burst / travel, (burst - 0.12) / travel, scale.accents);
      const since = burst - travel;
      if (since < 0) continue;
      // The healing takes on the ally.
      pool.time = since;
      if (scale.accents)
        pool.billboard(
          this.chest.x,
          this.chest.y,
          this.chest.z,
          1.6 * gild,
          KIT_IVORY,
          Math.exp(-since * 7) * 1.4,
          SHAPE.flare,
        );
      if (scale.secondary)
        pool.ground(this.feet.x, this.floorAt(0.06), this.feet.z, 2.6, KIT_WARM, 0.9, SHAPE.wave);
      // Gilded by Ascension: a second, wider wave of gold follows the first.
      if (e.gilded && scale.secondary && since > 0.1) {
        pool.time = since - 0.1;
        pool.ground(this.feet.x, this.floorAt(0.065), this.feet.z, 3.8, KIT_GOLD, 1, SHAPE.wave);
      }
      // Pluses of healing spiralling up about them.
      const pluses = paladinDetailCount(PLUSES, e.detail);
      for (let i = 0; i < pluses; i++) {
        const s = since - 0.05 * i;
        const life = PLUS_LIFE;
        if (s <= 0 || s >= life) continue;
        const ang = (i / pluses) * Math.PI * 2 + s * 2.4 + e.spin * 0.2;
        const rad = 0.6 + 0.3 * s;
        pool.time = 0;
        pool.billboard(
          this.feet.x + Math.cos(ang) * rad,
          this.chest.y - 0.35 + s * height * 0.9,
          this.feet.z + Math.sin(ang) * rad,
          (0.18 + 0.05 * hash01(i, 6)) * HEAL_PLUS_QUAD,
          i % 3 ? KIT_WARM : KIT_IVORY,
          Math.min(1, s / 0.08) * (1 - s / life) * 1.2 * (e.gilded ? 1.2 : 1),
          SHAPE.plus,
        );
      }
    }
    pool.end();
  }

  clear(): void {
    for (const c of this.channels) c.active = false;
    for (const e of this.embraces) e.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

import * as THREE from 'three';
import { HEAL_PLUS_GLSL, HEAL_PLUS_QUAD } from './heal_plus';
import {
  KIT_FLARE_GLSL,
  KIT_GOLD,
  KIT_IVORY,
  KIT_WARM,
  type PaladinKitContext,
} from './paladin_kit_context';
import { hash01, PaladinQuadPool, ramp } from './paladin_quad_pool';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailScale,
  paladinLingerEnd,
} from './paladin_vfx_detail_core';

export const CHORUS_CHANNELS = 4;
export const CHORUS_RELEASES = 4;
/** One ribbon to every ally healed, up to a raid's worth. */
export const CHORUS_RIBBONS = 25;
/** The heal's reach (paladin_core_abilities.ts) until the sim reports it. */
export const CHORUS_RADIUS = 30;
/** Small suns of the choir, rising into the great sun through the cast. */
export const CHORUS_VOICES = 8;
/** Pluses of healing the sun bursts into. */
export const CHORUS_PLUSES = 18;
/** A ribbon's head reaches the ally after this long; its tail follows. */
export const CHORUS_REACH = 0.38;
export const CHORUS_TAIL = 0.22;
export const CHORUS_RIBBON_DURATION = CHORUS_REACH + CHORUS_TAIL + 0.5;
export const CHORUS_RELEASE_DURATION = 1.3;
/** How high over the top of the head the sun charges. */
export const CHORUS_SUN_LIFT = 0.9;
/** Seconds between the beats of the hymn through the cast. */
const BEAT = 0.5;
const SEGMENTS = 12;
const MOTES = 10;
const SHAPE = {
  ground: 0,
  voice: 1,
  ribbon: 2,
  flare: 3,
  bloom: 4,
  mote: 5,
  wave: 6,
  sun: 7,
  burst: 8,
  plus: 9,
  gather: 10,
} as const;
const QUADS =
  CHORUS_CHANNELS * (3 + CHORUS_VOICES + MOTES) +
  CHORUS_RELEASES * (4 + CHORUS_PLUSES) +
  CHORUS_RIBBONS * (SEGMENTS + 2);

interface Channel {
  active: boolean;
  caster: number;
  progress: number;
  presence: number;
  seen: boolean;
  age: number;
  /** The sun's rays, turning faster as it charges. */
  spin: number;
  /** The Paladin detail read when the cast was first seen. */
  detail: PaladinVfxDetail;
}
interface Release {
  active: boolean;
  caster: number;
  age: number;
  /** How far the sun had charged when it burst. */
  charge: number;
  /** The heal's reach: the wave runs out to it. */
  radius: number;
  /** The Paladin detail read when the sun burst. */
  detail: PaladinVfxDetail;
}
interface Ribbon {
  active: boolean;
  source: number;
  target: number;
  age: number;
  seed: number;
  /** The Paladin detail read when the ribbon set out. */
  detail: PaladinVfxDetail;
  /** When it ends (its fade tail shortened on lighter tiers). */
  end: number;
}

/**
 * Radiant Chorus. Through the cast the Paladin raises a hymn: a sun charges
 * over their head, swelling and brightening as the cast builds, while the
 * choir's small suns spiral up into it and rings of light close in on it on
 * every beat; a rune circle glows underfoot, rings pulse out across the ground
 * and motes spiral up. On release the sun bursts: a flare, a ring thrown out
 * from it and a spray of pluses of healing drifting down over the group, a
 * wide wave across the ground, and a ribbon of light arcs out of the sun to
 * each ally it heals, landing in a bloom.
 *
 * Detail: core = the charging sun and the choir's small suns rising into it,
 * the burst ring, the pluses of healing, the wave out to the heal's edge and
 * a ribbon landing in a bloom on each ally healed; secondary = the rune circle
 * underfoot, the rings closing on the sun with the beat and the second wave
 * inside the first; accents = the flares (the burst's and each ribbon head's).
 * Light drops the flares and halves the voices, motes and pluses; minimal
 * keeps the core with a third of them, and both shorten the fades.
 */
/** A point on a ribbon's quadratic arc from `from` over `bend` onto `to`. */
function ribbonAt(
  out: THREE.Vector3,
  u: number,
  from: THREE.Vector3,
  bend: THREE.Vector3,
  to: THREE.Vector3,
): THREE.Vector3 {
  const q = 1 - u;
  return out.set(
    q * q * from.x + 2 * q * u * bend.x + u * u * to.x,
    q * q * from.y + 2 * q * u * bend.y + u * u * to.y,
    q * q * from.z + 2 * q * u * bend.z + u * u * to.z,
  );
}

export class RadiantChorus {
  private readonly pool: PaladinQuadPool<'radiant_chorus'>;
  private readonly channels: Channel[] = Array.from({ length: CHORUS_CHANNELS }, () => ({
    active: false,
    caster: -1,
    progress: 0,
    presence: 0,
    seen: false,
    age: 0,
    spin: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly releases: Release[] = Array.from({ length: CHORUS_RELEASES }, () => ({
    active: false,
    caster: -1,
    age: 0,
    charge: 1,
    radius: CHORUS_RADIUS,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly ribbons: Ribbon[] = Array.from({ length: CHORUS_RIBBONS }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    seed: 0,
    detail: 'full' as PaladinVfxDetail,
    end: CHORUS_RIBBON_DURATION,
  }));
  private readonly feet = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly sun = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  /** Per-frame scratch: a ribbon's arc control point. */
  private readonly bend = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private clock = 0;
  private seed = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'radiant_chorus', QUADS, {
      helpers: KIT_FLARE_GLSL + PALADIN_RUNE_GLSL + HEAL_PLUS_GLSL,
      pull: '(aShape<0.5||(aShape>5.5&&aShape<6.5))?0.4:((aShape>2.5&&aShape<4.5)||aShape>6.5?0.5:0.0)',
      body: `
        if(vShape>9.5){
          // Light gathering on the sun with the beat: a ring closing in.
          mask=(band(r,0.86,0.03)*1.1+band(r,0.86,0.1)*0.25)*(1.0-smoothstep(0.95,1.0,r));
          color=mix(vColor,HOT,0.4);
        } else if(vShape>8.5){
          // A plus of healing from the burst sun.
          mask=healPlusQuad(p);
          color=mix(vColor,HOT,0.3);
        } else if(vShape>7.5){
          // The sun bursting: a ring of light thrown out from it, rays with it.
          float grow=1.0-sq(max(1.0-clamp(t/0.4,0.0,1.0),0.0));
          float rays=pow(max(cos(a*8.0),0.0),30.0)*smoothstep(0.1,0.3,r)*(1.0-smoothstep(0.5+0.4*grow,0.6+0.4*grow,r));
          mask=(band(r,0.15+0.78*grow,0.02+0.05*grow)*1.4+rays*0.8)*(1.0-grow*0.6)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>6.5){
          // The great sun: a white disc in a corona, long and short rays turning.
          float rays=pow(max(cos(a*8.0+t*1.2),0.0),16.0)*smoothstep(0.26,0.32,r)*(1.0-smoothstep(0.55,0.95,r))
            +pow(max(cos(a*8.0+3.14159+t*1.2),0.0),26.0)*smoothstep(0.26,0.3,r)*(1.0-smoothstep(0.42,0.6,r))*0.6;
          float disc=1.0-smoothstep(0.15,0.18,r);
          float corona=exp(-r*r*9.0)*0.55+band(r,0.22,0.02)*1.0;
          mask=(disc*1.4+corona+rays*0.9)*(1.0-smoothstep(0.92,1.0,r));
          color=mix(vColor,HOT,disc+band(r,0.22,0.02)*0.6);
        } else if(vShape>5.5){
          // The release's wave across the ground.
          float grow=1.0-sq(max(1.0-clamp(t/0.7,0.0,1.0),0.0));
          mask=(band(r,0.1+0.88*grow,0.012+0.03*grow)*1.3+band(r,0.1+0.84*grow,0.06)*0.3)
            *(1.0-grow*0.75)*(1.0-smoothstep(0.97,1.0,r));
          color=mix(vColor,HOT,0.45);
        } else if(vShape>4.5){
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.6);
        } else if(vShape>3.5){
          // The bloom where a ribbon lands.
          float grow=1.0-sq(max(1.0-clamp(t/0.35,0.0,1.0),0.0));
          mask=(band(r,0.2+0.65*grow,0.05)*(1.0-grow*0.7)+exp(-r*r*9.0)*exp(-t*5.0)*1.1)
            *(1.0-smoothstep(0.95,1.0,r));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>2.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>1.5){
          // A segment of a ribbon: a golden band with light flowing along it.
          float across=exp(-vUv.y*vUv.y*4.0);
          float core=exp(-vUv.y*vUv.y*32.0);
          float flow=0.7+0.3*sin((vUv.x+t)*12.0);
          mask=(across*0.45+core*1.1)*flow;
          color=mix(vColor,HOT,core*0.8);
        } else if(vShape>0.5){
          // A voice of the choir: a small sun with a soft halo, its rays turning.
          float rays=pow(max(cos(a*6.0+t*2.0),0.0),12.0)*smoothstep(0.25,0.32,r)*(1.0-smoothstep(0.5,0.85,r));
          mask=((1.0-smoothstep(0.16,0.2,r))*1.2+band(r,0.24,0.02)*0.8+rays*0.7+exp(-r*r*5.0)*0.3)
            *(1.0-smoothstep(0.9,1.0,r));
          color=mix(vColor,HOT,1.0-smoothstep(0.16,0.24,r));
        } else {
          // The rune circle underfoot, rings pulsing out from it on the beat.
          float c=cos(t*0.3),s=sin(t*0.3);
          vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
          float runes=paladinRuneRing(q,0.34,0.44);
          float beat=fract(t/${BEAT.toFixed(2)});
          float pulse=band(r,0.44+0.5*beat,0.012+0.02*beat)*(1.0-beat)*1.2;
          float inner=band(r,0.24,0.01)*0.8+exp(-r*r*14.0)*0.25;
          mask=(runes*0.85+inner+pulse)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,pulse*0.6+inner*0.4);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** Once a frame while the Paladin casts Radiant Chorus. */
  channel(caster: number, progress: number): void {
    if (!this.pool.ready()) return;
    let slot = this.channels.find((c) => c.active && c.caster === caster);
    if (!slot) {
      slot = this.channels.find((c) => !c.active);
      if (!slot) return;
      slot.active = true;
      slot.caster = caster;
      slot.presence = 0;
      slot.age = 0;
      slot.spin = 0;
      slot.detail = paladinVfxDetailNow();
    }
    slot.seen = true;
    slot.progress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  }

  /** The hymn is released: the sun over the Paladin bursts. */
  release(caster: number): boolean {
    if (!this.pool.ready()) return false;
    let slot = this.releases.find((r) => !r.active);
    if (!slot) {
      slot = this.releases[0];
      for (const r of this.releases) if (r.age > slot.age) slot = r;
    }
    slot.active = true;
    slot.caster = caster;
    slot.age = 0;
    const held = this.channels.find((c) => c.active && c.caster === caster);
    slot.charge = held ? Math.max(0.5, held.progress) : 1;
    slot.radius = CHORUS_RADIUS;
    slot.detail = paladinVfxDetailNow();
    // The sun bursts rather than fading out with the channel.
    if (held) held.active = false;
    return true;
  }

  /** The heal's reach, from the sim: the newest burst's wave runs out to it. */
  span(caster: number, radius: number): void {
    let newest: Release | undefined;
    for (const r of this.releases)
      if (r.active && r.caster === caster && (!newest || r.age < newest.age)) newest = r;
    if (newest) newest.radius = radius;
  }

  /** A ribbon of light carries the hymn's healing to one ally. */
  reach(source: number, target: number): boolean {
    if (!this.pool.ready() || source === target) return false;
    let slot = this.ribbons.find((r) => !r.active);
    if (!slot) {
      slot = this.ribbons[0];
      for (const r of this.ribbons) if (r.age > slot.age) slot = r;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.age = 0;
    slot.seed = this.seed++;
    slot.detail = paladinVfxDetailNow();
    slot.end = paladinLingerEnd(
      CHORUS_REACH + CHORUS_TAIL,
      CHORUS_RIBBON_DURATION,
      paladinDetailScale(slot.detail).linger,
    );
    return true;
  }

  /** Where the sun charges over `id`. */
  private sunAt(id: number, out: THREE.Vector3): boolean {
    if (!this.ctx.anchor(id, 1, out)) return false;
    out.y += CHORUS_SUN_LIFT;
    return true;
  }

  private floorAt(lift: number): number {
    const floor = this.ctx.groundY(this.feet.x, this.feet.z);
    return (Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y) + lift;
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    const pool = this.pool;
    pool.begin(this.ctx.camera);
    for (const ch of this.channels) {
      if (!ch.active) continue;
      ch.presence = ch.seen ? Math.min(1, ch.presence + dt * 6) : Math.max(0, ch.presence - dt * 5);
      ch.seen = false;
      ch.age += dt;
      if (
        ch.presence <= 0 ||
        !this.ctx.anchor(ch.caster, 0, this.feet) ||
        !this.ctx.anchor(ch.caster, 0.62, this.chest) ||
        !this.sunAt(ch.caster, this.sun)
      ) {
        ch.active = false;
        continue;
      }
      const k = ch.presence;
      const charge = ch.progress;
      const scale = paladinDetailScale(ch.detail);
      if (!reduced) ch.spin += dt * (1 + 2.5 * charge);
      pool.time = ch.age;
      if (scale.secondary)
        pool.ground(
          this.feet.x,
          this.floorAt(0.05),
          this.feet.z,
          3.4,
          KIT_GOLD,
          k * (0.5 + 0.6 * charge),
          SHAPE.ground,
        );
      // The sun charging: swelling and brightening, its rays turning faster.
      const throb = reduced ? 0 : Math.sin(this.clock * (6 + 10 * charge)) * 0.04 * charge;
      pool.time = ch.spin;
      pool.billboard(
        this.sun.x,
        this.sun.y,
        this.sun.z,
        (0.7 + 0.8 * charge) * (1 + throb),
        KIT_WARM,
        k * (0.7 + 0.8 * charge),
        SHAPE.sun,
      );
      // Light closing in on the sun with each beat.
      if (!reduced && scale.secondary) {
        const beat = (ch.age / BEAT) % 1;
        pool.time = 0;
        pool.billboard(
          this.sun.x,
          this.sun.y,
          this.sun.z,
          1.9 - 1.1 * beat * beat,
          KIT_WARM,
          k * Math.sin(beat * Math.PI) * (0.2 + 0.35 * charge),
          SHAPE.gather,
        );
      }
      // The choir: small suns spiralling up from about the Paladin into the sun.
      const voices = paladinDetailCount(CHORUS_VOICES, ch.detail);
      for (let i = 0; i < voices; i++) {
        const cycle = reduced ? 0.35 : (this.clock * 0.8 + i / voices) % 1;
        const rise = cycle * cycle;
        const ang = (i / voices) * Math.PI * 2 + cycle * 2.2 + (reduced ? 0 : this.clock * 0.4);
        const rad = 1.0 * (1 - rise);
        pool.time = this.clock;
        pool.billboard(
          this.sun.x + Math.cos(ang) * rad,
          this.chest.y + (this.sun.y - this.chest.y) * rise,
          this.sun.z + Math.sin(ang) * rad,
          0.32 * (1 - 0.5 * rise),
          KIT_WARM,
          k * Math.min(1, cycle * 6) * (1 - ramp(cycle, 0.85, 1)) * (0.6 + 0.6 * charge),
          SHAPE.voice,
        );
      }
      if (!reduced) {
        const motes = paladinDetailCount(MOTES, ch.detail);
        for (let i = 0; i < motes; i++) {
          const cycle = (this.clock * 0.55 + hash01(i, 5)) % 1;
          const ang = hash01(i, 2) * Math.PI * 2 + cycle * 2.5;
          const rad = 0.45 + 0.55 * hash01(i, 3);
          pool.time = 0;
          pool.billboard(
            this.feet.x + Math.cos(ang) * rad,
            this.feet.y + cycle * 2.4,
            this.feet.z + Math.sin(ang) * rad,
            0.045,
            KIT_IVORY,
            k * Math.sin(cycle * Math.PI) * (0.3 + charge),
            SHAPE.mote,
          );
        }
      }
    }
    for (const r of this.releases) {
      if (!r.active) continue;
      r.age += dt;
      if (
        r.age >= CHORUS_RELEASE_DURATION ||
        !this.ctx.anchor(r.caster, 0, this.feet) ||
        !this.sunAt(r.caster, this.sun)
      ) {
        r.active = false;
        continue;
      }
      const t = r.age;
      const scale = paladinDetailScale(r.detail);
      const size = 0.75 + 0.25 * r.charge;
      pool.time = t;
      if (scale.accents)
        pool.billboard(
          this.sun.x,
          this.sun.y,
          this.sun.z,
          2.4 * size,
          KIT_IVORY,
          Math.exp(-t * 6) * 1.15,
          SHAPE.flare,
        );
      pool.billboard(
        this.sun.x,
        this.sun.y,
        this.sun.z,
        2.6 * size,
        KIT_WARM,
        1 - ramp(t, 0.25, 0.5),
        SHAPE.burst,
      );
      // Pluses of healing sprayed out of the sun, slowing, then drifting down
      // over the group as they fade.
      const motion = reduced ? 0.5 : 1;
      const pluses = paladinDetailCount(CHORUS_PLUSES, r.detail);
      const plusesGone = paladinLingerEnd(0.7, CHORUS_RELEASE_DURATION, scale.linger);
      for (let i = 0; i < pluses; i++) {
        const ang = (i / pluses) * Math.PI * 2 + hash01(i, 7) * 0.6;
        const tilt = -0.35 + 0.95 * hash01(i, 8);
        const speed = (4 + 2.4 * hash01(i, 9)) * motion;
        // Out fast, slowing: distance travelled under a strong drag.
        const out = (speed / 2.2) * (1 - Math.exp(-t * 2.2));
        const fall = reduced ? 0 : 0.9 * t * t;
        const horizontal = Math.cos(tilt) * out;
        const fade = Math.min(1, t / 0.06) * (1 - ramp(t, 0.7, plusesGone));
        pool.time = 0;
        pool.billboard(
          this.sun.x + Math.cos(ang) * horizontal,
          this.sun.y + Math.sin(tilt) * out - fall,
          this.sun.z + Math.sin(ang) * horizontal,
          (0.2 + 0.06 * hash01(i, 10)) * HEAL_PLUS_QUAD,
          i % 3 ? KIT_WARM : KIT_IVORY,
          1.2 * fade,
          SHAPE.plus,
        );
      }
      pool.time = t;
      // The wave runs out to the heal's edge; a second follows inside it.
      // Its glow widens with the 30-40 m reach, so both are kept soft enough
      // not to wash over the fight they cross.
      pool.ground(
        this.feet.x,
        this.floorAt(0.06),
        this.feet.z,
        r.radius,
        KIT_WARM,
        0.6,
        SHAPE.wave,
      );
      if (!scale.secondary) continue;
      pool.time = t + 0.12;
      pool.ground(
        this.feet.x,
        this.floorAt(0.06),
        this.feet.z,
        r.radius * 0.66,
        KIT_GOLD,
        0.45,
        SHAPE.wave,
      );
    }
    for (const rb of this.ribbons) {
      if (!rb.active) continue;
      rb.age += dt;
      if (
        rb.age >= rb.end ||
        !this.sunAt(rb.source, this.from) ||
        !this.ctx.anchor(rb.target, 0.55, this.to)
      ) {
        rb.active = false;
        continue;
      }
      const t = rb.age;
      const head = reduced ? 1 : ramp(t / CHORUS_REACH, 0, 1);
      const tail = reduced ? 0 : ramp((t - CHORUS_TAIL) / CHORUS_REACH, 0, 1);
      // An arc out of the sun and down onto the ally, leaning to one side or
      // the other so several ribbons fan out.
      const lean = (hash01(rb.seed, 1) - 0.5) * 1.6;
      const dx = this.to.x - this.from.x,
        dz = this.to.z - this.from.z;
      const dist = Math.hypot(dx, dz) || 1;
      const mx = (this.from.x + this.to.x) / 2 - (dz / dist) * lean,
        my = Math.max(this.from.y, this.to.y) + 0.4 + dist * 0.08,
        mz = (this.from.z + this.to.z) / 2 + (dx / dist) * lean;
      this.bend.set(mx, my, mz);
      const fade = 1 - ramp(t, CHORUS_REACH + CHORUS_TAIL, rb.end);
      if (head > tail + 0.01) {
        for (let i = 0; i < SEGMENTS; i++) {
          const u0 = tail + ((head - tail) * i) / SEGMENTS,
            u1 = tail + ((head - tail) * (i + 1)) / SEGMENTS;
          ribbonAt(this.a, u0, this.from, this.bend, this.to);
          ribbonAt(this.b, u1, this.from, this.bend, this.to);
          pool.time = this.clock * 0.6 + i / SEGMENTS;
          // Thinner toward the tail.
          const w = 0.07 + 0.08 * ((i + 1) / SEGMENTS);
          pool.beam(
            this.a.x,
            this.a.y,
            this.a.z,
            this.b.x,
            this.b.y,
            this.b.z,
            w,
            KIT_WARM,
            fade,
            SHAPE.ribbon,
          );
        }
        if (paladinDetailScale(rb.detail).accents) {
          ribbonAt(this.a, head, this.from, this.bend, this.to);
          pool.time = 0;
          pool.billboard(
            this.a.x,
            this.a.y,
            this.a.z,
            0.35,
            KIT_IVORY,
            fade * (head < 1 ? 1 : 0.4),
            SHAPE.flare,
          );
        }
      }
      if (t >= CHORUS_REACH) {
        pool.time = t - CHORUS_REACH;
        pool.billboard(this.to.x, this.to.y, this.to.z, 0.85, KIT_WARM, 1, SHAPE.bloom);
      }
    }
    pool.end();
  }

  clear(): void {
    for (const ch of this.channels) ch.active = false;
    for (const r of this.releases) r.active = false;
    for (const rb of this.ribbons) rb.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

import * as THREE from 'three';
import { TAUNT_FORCE_SECONDS } from '../../sim/threat';
import { KIT_FLARE_GLSL, KIT_GOLD, KIT_IVORY, type PaladinKitContext } from './paladin_kit_context';
import { hash01, PaladinQuadPool, ramp } from './paladin_quad_pool';
import { PALADIN_SPEC_EMBLEM_GLSL } from './paladin_spec_emblems';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './paladin_spec_icons';

export const GOADS = 8;
/** The lance crosses to the enemy in this long. */
export const GOAD_FLIGHT = 0.18;
/** The brand and circle hold for as long as the taunt forces the enemy on
 * the Paladin (TAUNT_FORCE_SECONDS), then fade. */
export const GOAD_DURATION = GOAD_FLIGHT + TAUNT_FORCE_SECONDS;
/** A goad the enemy cannot be taunted by cracks and sputters out over this
 * long from the strike. */
export const GOAD_FIZZLE = 0.9;
/** Paladins whose Ascension guard (Sacred Goad's damage reduction) can shimmer at once. */
export const GOAD_GUARDS = 4;
const GUARD_GLINTS = 6;
/** Rings of the challenge called out ahead of the Paladin. */
const CALLS = 3;
const TRAIL = 6;
const SPARKS = 8;
const EMBER = new THREE.Color(0xff5a2e).multiplyScalar(1.35);
const BLAZE = new THREE.Color(0xff9a3c).multiplyScalar(1.35);
/** A fizzling goad's dying ember, and the Ascension guard's gold. */
const ASH = new THREE.Color(0xc8744a).multiplyScalar(1.1);
const GUARD_GOLD = new THREE.Color(0xffd27a).multiplyScalar(1.25);
const SHAPE = {
  lance: 0,
  brand: 1,
  flare: 2,
  burst: 3,
  tether: 4,
  call: 5,
  circle: 6,
  mote: 7,
  cracked: 8,
  shimmer: 9,
} as const;
const QUADS = GOADS * (CALLS + TRAIL + SPARKS + 8) + GOAD_GUARDS * (GUARD_GLINTS + 1);

interface Goad {
  active: boolean;
  source: number;
  target: number;
  age: number;
  sx: number;
  sy: number;
  sz: number;
  /** The enemy cannot be taunted: the goad cracks and fizzles on it. */
  immune: boolean;
}
interface Guard {
  active: boolean;
  id: number;
  seen: boolean;
  presence: number;
  /** Share of the guard left. */
  left: number;
  age: number;
}

// A heater shield, p in [-1, 1] with y up. Signed distance, negative inside.
const SHIELD_GLSL = `
  float heaterShield(vec2 p){
    const float W=0.78;
    float side;
    if(p.y>0.0) side=abs(p.x)-W;
    else {
      float R=(W*W+0.81)/(2.0*W);
      side=length(vec2(abs(p.x),p.y)-vec2(W-R,0.0))-R;
    }
    float top=p.y-(0.78+0.07*(1.0-sq(clamp(p.x/W,-1.0,1.0))));
    return max(side,max(top,-0.9-p.y));
  }
`;

/**
 * Sacred Goad, the Faithwarden's challenge. The Paladin calls it out: the
 * Faithwarden's sign flares before them and rings of red-gold light roll out
 * toward the enemy, as a lance of light is hurled after them, motes streaming
 * from its tail. It strikes with a flare and a shield-shaped burst and a spray
 * of sparks; the Faithwarden's sign slams down over the enemy's head and burns
 * there, a challenge circle flares at their feet, and a taut thread of
 * chevrons runs from them back to the Paladin, all pointing the way their
 * attention is dragged. Then it lets go. On an enemy that cannot be taunted
 * the goad still flies and strikes, but the sign cracks apart over their head
 * and sputters out, with no circle and no thread. While Ascension's guard (a
 * 15% damage reduction) holds, a small gold shimmer plays about the Paladin.
 */
export class SacredGoad {
  private readonly pool: PaladinQuadPool<'sacred_goad'>;
  private readonly goads: Goad[] = Array.from({ length: GOADS }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    immune: false,
  }));
  private readonly guards: Guard[] = Array.from({ length: GOAD_GUARDS }, () => ({
    active: false,
    id: -1,
    seen: false,
    presence: 0,
    left: 1,
    age: 0,
  }));
  private readonly from = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'sacred_goad', QUADS, {
      uniforms: paladinSpecIconUniforms(),
      helpers: KIT_FLARE_GLSL + SHIELD_GLSL + PALADIN_SPEC_ICON_GLSL + PALADIN_SPEC_EMBLEM_GLSL,
      pull: 'aShape>0.5&&aShape<3.5?0.6:(aShape>6.5?0.5:(aShape>5.5?0.3:0.0))',
      body: `
        if(vShape>8.5){
          // Ascension's guard: a soft gold sheen about the Paladin with a
          // shimmer running up it (t: the clock).
          vec2 q=vec2(p.x/0.55,p.y);
          float body=exp(-dot(q,q)*2.2);
          float sheen=0.6+0.4*sin(p.y*11.0-t*5.0+p.x*4.0);
          float edge=band(length(q),0.62,0.1);
          mask=(body*0.18*sheen+edge*0.22*sheen)*(1.0-smoothstep(0.85,1.0,max(abs(p.x),abs(p.y))));
          color=mix(vColor,HOT,edge*0.3);
        } else if(vShape>7.5){
          // A goad the enemy shrugs off: the brand's ring cracks into pieces
          // drifting apart, a jagged split runs through it, and it sputters
          // out, greying (t: 0 to 1 of the fizzle).
          float qr=r/(1.0+0.12*t);
          float ring=exp(-sq((qr-0.8)/0.035));
          float seg=fract(a/6.2831853*5.0+0.13);
          float gap=smoothstep(0.0,0.03+0.16*t,seg)*(1.0-smoothstep(0.97-0.16*t,1.0,seg));
          float jag=abs(p.y-0.22*sin(p.x*8.0+1.3)-0.12*p.x);
          float split=exp(-sq(jag/(0.018+0.03*t)))*(1.0-smoothstep(0.55,0.75,r));
          float sputter=0.45+0.55*step(0.3,fract(sin(floor(t*24.0)*12.9898)*43758.5453));
          float glow=exp(-r*r*3.0)*0.12;
          mask=(ring*gap*1.1+split*(1.2-t)+glow)*(1.0-t)*sputter*(1.0-smoothstep(0.95,1.0,r));
          color=mix(mix(vColor,HOT,split*0.5),vec3(0.55,0.5,0.48),t*0.6);
        } else if(vShape>6.5){
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>5.5){
          // The challenge circle at the enemy's feet: a double ring with
          // eight spikes turned inward, flaring out as it lands.
          float grow=1.0-sq(max(1.0-clamp(t/0.25,0.0,1.0),0.0));
          float rr=r/(0.6+0.4*grow);
          float ring=band(rr,0.86,0.02)*1.2+band(rr,0.76,0.008)*0.6;
          float spike=pow(max(cos(a*8.0+t*0.6),0.0),40.0)*smoothstep(0.5,0.6,rr)*(1.0-smoothstep(0.72,0.76,rr));
          float glow=exp(-rr*rr*4.0)*0.12;
          mask=(ring+spike*0.9+glow)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,band(rr,0.86,0.01)*0.6);
        } else if(vShape>4.5){
          // A ring of the challenge rolling out toward the enemy, notched
          // with inward spikes (t: 0 to 1 of its life).
          float at=0.35+0.55*t;
          float ring=band(r,at,0.025+0.04*t);
          float notch=pow(max(cos(a*10.0),0.0),30.0)*band(r,at-0.08,0.05);
          mask=(ring*1.4+notch*0.8+band(r,at,0.12)*0.25)*(1.0-t)*(1.0-smoothstep(0.95,1.0,r));
          color=mix(vColor,HOT,ring*0.5);
        } else if(vShape>3.5){
          // The thread back to the Paladin (uv.x 0 at the enemy, 1 at the
          // Paladin): chevrons racing home along a hot core.
          float core=exp(-vUv.y*vUv.y*40.0);
          float c=fract(vUv.x*12.0-abs(vUv.y)*0.45-t*2.6);
          float chevron=exp(-sq((c-0.5)/0.09))*(1.0-smoothstep(0.55,0.9,abs(vUv.y)));
          float ends=smoothstep(0.0,0.06,vUv.x)*smoothstep(1.0,0.92,vUv.x);
          mask=(core*0.7+chevron*1.1+exp(-vUv.y*vUv.y*4.0)*0.15)*ends;
          color=mix(vColor,HOT,core*0.5+chevron*0.3);
        } else if(vShape>2.5){
          // The strike: a shield outline bursting out from the blow.
          float grow=1.0-sq(max(1.0-clamp(t/0.35,0.0,1.0),0.0));
          float size=0.25+0.7*grow;
          float d=heaterShield(p/size)*size;
          mask=exp(-sq(d/(0.02+0.03*grow)))*1.3*(1.0-grow*0.85)
            *(1.0-smoothstep(0.9,1.0,max(abs(p.x),abs(p.y))));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>0.5){
          // The brand: the Faithwarden's sign inside a spiked ring, slamming
          // down from large and burning red-gold.
          float slam=1.0+0.9*exp(-t*11.0);
          vec2 q=p*slam;
          float qr=length(q);
          float ring=exp(-sq((qr-0.82)/0.035));
          float spikes=pow(max(cos(atan(q.y,q.x)*4.0+0.785),0.0),30.0)
            *smoothstep(0.84,0.88,qr)*(1.0-smoothstep(0.93,0.99,qr));
          float mark=0.0;
          vec2 e=q/0.62;
          if(uSpecIconsReady>0.5){
            vec3 icon=paladinSpecIcon(e,1.0);
            mark=max(1.0-smoothstep(0.0,0.04,icon.y-0.006),(1.0-smoothstep(-0.01,0.02,icon.x))*0.35);
          } else {
            float sd=paladinSpecDist(e,1.0);
            mark=max(1.0-smoothstep(0.012,0.03,abs(sd)),(1.0-smoothstep(-0.01,0.01,sd))*0.3);
          }
          float glow=exp(-qr*qr*3.0)*0.18;
          mask=(ring*1.1+spikes*0.9+mark*1.2+glow)*(1.0-smoothstep(0.95,1.0,r));
          color=mix(vColor,HOT,mark*0.45+ring*0.2);
        } else {
          // The lance: a long spear of light, a white-hot point at its head.
          float head=exp(-(sq(vUv.x-0.9)*80.0+vUv.y*vUv.y*5.0));
          float core=exp(-vUv.y*vUv.y*30.0)*smoothstep(0.0,0.8,vUv.x)*(1.0-smoothstep(0.93,1.0,vUv.x));
          mask=core*0.9+head*1.8+exp(-vUv.y*vUv.y*4.0)*0.3*smoothstep(0.2,0.9,vUv.x);
          color=mix(vColor,HOT,head+core*0.5);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** The Paladin goads `target` (`immune`: it cannot be taunted, and the
   * goad cracks and fizzles on it). */
  goad(source: number, target: number, immune = false): boolean {
    if (!this.pool.ready() || source === target) return false;
    if (!this.ctx.hand(source, 0, this.from) && !this.ctx.anchor(source, 0.7, this.from))
      return false;
    let slot = this.goads.find((g) => !g.active);
    if (!slot) {
      slot = this.goads[0];
      for (const g of this.goads) if (g.age > slot.age) slot = g;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.age = 0;
    slot.sx = this.from.x;
    slot.sy = this.from.y;
    slot.sz = this.from.z;
    slot.immune = immune;
    return true;
  }

  /** Once a frame while `id` holds Sacred Goad's Ascension guard; `left` is
   * the share of it still to run. */
  guard(id: number, left = 1): void {
    if (!this.pool.ready()) return;
    let slot = this.guards.find((g) => g.active && g.id === id);
    if (!slot) {
      slot = this.guards.find((g) => !g.active);
      if (!slot) return;
      slot.active = true;
      slot.id = id;
      slot.presence = 0;
      slot.age = 0;
    }
    slot.seen = true;
    slot.left = Number.isFinite(left) ? Math.min(1, Math.max(0, left)) : 1;
  }

  /** A square standing upright at (x, y, z), facing along (fx, fz). */
  private facing(
    x: number,
    y: number,
    z: number,
    fx: number,
    fz: number,
    size: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    this.pool.quad(x, y, z, fz * size, 0, -fx * size, 0, size, 0, color, alpha, shape);
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const pool = this.pool;
    bindPaladinSpecIcons(pool.mesh.material);
    pool.begin(this.ctx.camera);
    const c = pool.cam;
    for (const g of this.goads) {
      if (!g.active) continue;
      g.age += dt;
      if (
        g.age >= (g.immune ? GOAD_FLIGHT + GOAD_FIZZLE : GOAD_DURATION) ||
        !this.ctx.anchor(g.target, 0.6, this.at) ||
        !this.ctx.anchor(g.target, 1, this.head) ||
        !this.ctx.anchor(g.target, 0, this.feet)
      ) {
        g.active = false;
        continue;
      }
      const t = g.age;
      const haveSource = this.ctx.anchor(g.source, 0.62, this.chest);
      if (!haveSource) this.chest.set(g.sx, g.sy, g.sz);
      let fx = this.at.x - this.chest.x,
        fz = this.at.z - this.chest.z;
      const flat = Math.hypot(fx, fz) || 1;
      fx /= flat;
      fz /= flat;
      // The call: the sign flaring before the Paladin, rings rolling out.
      if (t < 0.5) {
        pool.time = t;
        pool.billboard(
          this.chest.x + fx * 0.6,
          this.chest.y + 0.15,
          this.chest.z + fz * 0.6,
          0.45,
          BLAZE,
          (1 - ramp(t, 0.15, 0.5)) * 1.3,
          SHAPE.brand,
        );
        for (let i = 0; i < CALLS; i++) {
          const life = (t - i * 0.07) / 0.4;
          if (life <= 0 || life >= 1) continue;
          const out = 0.7 + (reduced ? 0.3 : 1) * life * Math.min(7, flat * 0.65);
          pool.time = life;
          this.facing(
            this.chest.x + fx * out,
            this.chest.y + 0.05,
            this.chest.z + fz * out,
            fx,
            fz,
            0.45 + 0.5 * life,
            i % 2 ? EMBER : BLAZE,
            1.2 - 0.25 * i,
            SHAPE.call,
          );
        }
      }
      // The lance in flight, motes streaming from its tail.
      if (t < GOAD_FLIGHT) {
        const f = reduced ? 1 : t / GOAD_FLIGHT;
        const dx = this.at.x - g.sx,
          dy = this.at.y - g.sy,
          dz = this.at.z - g.sz;
        const len = Math.hypot(dx, dy, dz) || 1;
        const tx = g.sx + dx * f,
          ty = g.sy + dy * f,
          tz = g.sz + dz * f;
        const back = Math.min(1, f * 3) * 1.8;
        pool.time = t;
        pool.beam(
          tx - (dx / len) * back,
          ty - (dy / len) * back,
          tz - (dz / len) * back,
          tx,
          ty,
          tz,
          0.18,
          KIT_GOLD,
          1.3,
          SHAPE.lance,
        );
        if (!reduced)
          for (let i = 0; i < TRAIL; i++) {
            const k = (i + 1) / (TRAIL + 1);
            const along = back * (0.3 + 1.2 * k);
            const ang = hash01(i, 2) * Math.PI * 2 + t * 30;
            const spread = 0.12 * k;
            pool.time = 0;
            pool.billboard(
              tx - (dx / len) * along + (c[0] * Math.cos(ang) + c[3] * Math.sin(ang)) * spread,
              ty - (dy / len) * along + (c[1] * Math.cos(ang) + c[4] * Math.sin(ang)) * spread,
              tz - (dz / len) * along + (c[2] * Math.cos(ang) + c[5] * Math.sin(ang)) * spread,
              0.06,
              i % 2 ? EMBER : KIT_IVORY,
              (1 - k) * 1.2,
              SHAPE.mote,
            );
          }
        continue;
      }
      const since = t - GOAD_FLIGHT;
      if (g.immune) {
        this.fizzle(since, reduced);
        continue;
      }
      const fade = 1 - ramp(since, TAUNT_FORCE_SECONDS - 0.4, TAUNT_FORCE_SECONDS);
      // The strike.
      pool.time = since;
      pool.billboard(
        this.at.x,
        this.at.y,
        this.at.z,
        1.1,
        KIT_IVORY,
        Math.exp(-since * 9) * 1.3,
        SHAPE.flare,
      );
      this.facing(this.at.x, this.at.y, this.at.z, fx, fz, 1.0, BLAZE, 1.1, SHAPE.burst);
      const motion = reduced ? 0.3 : 1;
      for (let i = 0; i < SPARKS; i++) {
        const life = 0.25 + 0.2 * hash01(i, 3);
        if (since >= life) continue;
        const ang = (i / SPARKS) * Math.PI * 2 + hash01(i, 9);
        const speed = (2.5 + 2.5 * hash01(i, 4)) * motion;
        const vx = (c[0] * Math.cos(ang) + c[3] * Math.sin(ang)) * speed,
          vy = (c[1] * Math.cos(ang) + c[4] * Math.sin(ang)) * speed,
          vz = (c[2] * Math.cos(ang) + c[5] * Math.sin(ang)) * speed;
        const sx = this.at.x + vx * since,
          sy = this.at.y + vy * since - 5 * since * since * motion,
          sz = this.at.z + vz * since;
        pool.time = 0;
        pool.beam(
          sx - vx * 0.035,
          sy - vy * 0.035,
          sz - vz * 0.035,
          sx,
          sy,
          sz,
          0.03,
          i % 2 ? EMBER : KIT_GOLD,
          (1 - since / life) * 1.2,
          SHAPE.mote,
        );
      }
      // The brand over the head, pulsing as it burns.
      pool.time = since;
      pool.billboard(
        this.head.x,
        this.head.y + 0.7,
        this.head.z,
        0.75,
        EMBER,
        // Bright as it lands, then a steady burn for the rest of the taunt.
        fade *
          (0.85 + 0.35 * (1 - ramp(since, 0.5, 1.0)) + (reduced ? 0 : 0.12 * Math.sin(since * 9))),
        SHAPE.brand,
      );
      // The challenge circle at their feet.
      const floor = this.ctx.groundY(this.feet.x, this.feet.z);
      const y = (Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y) + 0.05;
      pool.time = reduced ? 1 : since;
      pool.ground(
        this.feet.x,
        y,
        this.feet.z,
        1.0,
        EMBER,
        fade * (0.8 + 0.3 * (1 - ramp(since, 0.5, 1.0))),
        SHAPE.circle,
      );
      // The thread dragging their attention home.
      if (haveSource && since < 1.0) {
        pool.time = reduced ? 0 : since;
        pool.beam(
          this.at.x,
          this.at.y,
          this.at.z,
          this.chest.x,
          this.chest.y,
          this.chest.z,
          0.1,
          EMBER,
          (1 - ramp(since, 0.6, 1.0)) * Math.min(1, since / 0.06) * 1.1,
          SHAPE.tether,
        );
      }
    }
    this.shimmer(dt, reduced);
    pool.end();
  }

  /** A goad shrugged off (this.at, this.head: the enemy): a weak flare, the
   * sign cracking apart over their head and dying embers dropping away. */
  private fizzle(since: number, reduced: boolean): void {
    const pool = this.pool;
    const c = pool.cam;
    const k = Math.min(1, since / GOAD_FIZZLE);
    pool.time = since;
    pool.billboard(
      this.at.x,
      this.at.y,
      this.at.z,
      0.7,
      KIT_IVORY,
      Math.exp(-since * 12) * 0.8,
      SHAPE.flare,
    );
    pool.time = k;
    pool.billboard(
      this.head.x,
      this.head.y + 0.7 - (reduced ? 0 : 0.15 * k * k),
      this.head.z,
      0.7,
      ASH,
      1.1,
      SHAPE.cracked,
    );
    if (reduced) return;
    // Embers sputtering off the cracked sign and dropping away.
    for (let i = 0; i < SPARKS; i++) {
      const life = 0.4 + 0.4 * hash01(i, 5);
      if (since >= life) continue;
      const ang = (i / SPARKS) * Math.PI * 2 + hash01(i, 7);
      const speed = 0.6 + 0.8 * hash01(i, 6);
      const vx = (c[0] * Math.cos(ang) + c[3] * Math.sin(ang)) * speed,
        vz = (c[2] * Math.cos(ang) + c[5] * Math.sin(ang)) * speed;
      pool.time = 0;
      pool.billboard(
        this.head.x + vx * since,
        this.head.y + 0.7 + 0.3 * Math.sin(ang) - 2.5 * since * since,
        this.head.z + vz * since,
        0.045,
        i % 2 ? ASH : EMBER,
        (1 - since / life) * (0.5 + 0.5 * Math.sin(since * 40 + i)) * 1.1,
        SHAPE.mote,
      );
    }
  }

  /** Ascension's guard: a gold sheen about each guarded Paladin, glints rising round them. */
  private shimmer(dt: number, reduced: boolean): void {
    const pool = this.pool;
    for (const g of this.guards) {
      if (!g.active) continue;
      g.presence = g.seen ? Math.min(1, g.presence + dt * 5) : Math.max(0, g.presence - dt * 3);
      g.seen = false;
      g.age += dt;
      if (
        g.presence <= 0 ||
        !this.ctx.anchor(g.id, 0, this.feet) ||
        !this.ctx.anchor(g.id, 1, this.head)
      ) {
        g.active = false;
        continue;
      }
      const height = Math.max(0.8, this.head.y - this.feet.y);
      // Fading through the guard's last eighth.
      const k = g.presence * Math.min(1, g.left * 8);
      pool.time = reduced ? 0 : g.age;
      pool.billboard(
        this.feet.x,
        this.feet.y + height * 0.52,
        this.feet.z,
        height * 0.6,
        GUARD_GOLD,
        k,
        SHAPE.shimmer,
      );
      if (reduced) continue;
      for (let i = 0; i < GUARD_GLINTS; i++) {
        const cycle = (g.age * 0.6 + i / GUARD_GLINTS) % 1;
        const ang = hash01(i, 11) * Math.PI * 2 + g.age * 1.2;
        const rad = 0.42 + 0.08 * hash01(i, 12);
        pool.time = 0;
        pool.billboard(
          this.feet.x + Math.cos(ang) * rad,
          this.feet.y + 0.15 + cycle * height,
          this.feet.z + Math.sin(ang) * rad,
          0.045,
          i % 2 ? GUARD_GOLD : KIT_IVORY,
          k * Math.sin(cycle * Math.PI) * 1.1,
          SHAPE.mote,
        );
      }
    }
  }

  clear(): void {
    for (const g of this.goads) g.active = false;
    for (const g of this.guards) g.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

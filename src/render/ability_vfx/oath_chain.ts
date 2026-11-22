import * as THREE from 'three';
import {
  KIT_FLARE_GLSL,
  KIT_GOLD,
  KIT_IVORY,
  KIT_WARM,
  type PaladinKitContext,
} from './paladin_kit_context';
import { hash01, PaladinQuadPool, ramp } from './paladin_quad_pool';
import { PALADIN_RUNE_GLSL } from './paladin_runes';

export const OATH_TETHERS = 6;
export const OATH_BINDS = 8;
/** The chain's head reaches the enemy in this long. */
export const OATH_THROW = 0.2;
/** A chain that caught nothing (an enemy that cannot be pulled) lets go this
 * long after it lands. */
export const OATH_UNCAUGHT_HOLD = 0.45;
/** The chain shatters over this long once the pull ends. */
export const OATH_BREAK = 0.45;
/** A chain refused (an enemy that cannot be moved, or a resisted cast) strains
 * taut for this long after it lands, then snaps. */
export const OATH_STRAIN = 0.25;
/** One link every this far along the chain, each this long. */
const LINK_SPACING = 0.2;
const LINK_LENGTH = 0.27;
/** Enough links for the ability's 30 m reach. */
const MAX_LINKS = 152;
const DUST = 4;
const SHAPE = {
  link: 0,
  bar: 1,
  flare: 2,
  shackle: 3,
  runes: 4,
  mote: 5,
  skid: 6,
} as const;
const QUADS = OATH_TETHERS * (MAX_LINKS + MAX_LINKS / 2 + 2) + OATH_BINDS * (3 + DUST);

interface Tether {
  active: boolean;
  source: number;
  target: number;
  age: number;
  /** The pull has held the enemy on this chain. */
  held: boolean;
  seen: boolean;
  /** Seconds into the shatter, or -1 while whole. */
  breaking: number;
  /** The enemy will not move: the chain strains taut and snaps in the middle. */
  refused: boolean;
}
interface Bind {
  active: boolean;
  target: number;
  presence: number;
  seen: boolean;
  /** Pulled toward the Paladin (true) or slowed in place (false). */
  pulled: boolean;
  /** Share of the slow still to run. */
  left: number;
  age: number;
}

/**
 * Oath Chain. The Paladin hurls a chain of light from the hand: it whips out
 * link by link, its head blazing, and catches the enemy in a flare as a
 * shackle of light snaps closed about their waist and a ripple runs back down
 * the chain. While the pull holds, the chain stands taut, light reeling along
 * it toward the Paladin, and the enemy's feet drag glowing furrows through the
 * ground, kicking up motes. When they arrive the chain shatters into motes from
 * the enemy's end back to the Paladin, and the shackle stays on through the
 * slow, binding runes holding them to the ground as it runs out. An enemy the
 * sim will not move (a boss, a dummy) or a resisted cast refuses the chain: it
 * bites without a shackle, hauls taut, strains, and snaps in the middle.
 *
 * The chain is drawn from camera-facing quads: links alternate face-on (an
 * open loop of light) and edge-on (a bright bar), so it reads as interlocking
 * links from any angle.
 */
export class OathChain {
  private readonly pool: PaladinQuadPool<'oath_chain'>;
  private readonly tethers: Tether[] = Array.from({ length: OATH_TETHERS }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    held: false,
    seen: false,
    breaking: -1,
    refused: false,
  }));
  private readonly binds: Bind[] = Array.from({ length: OATH_BINDS }, () => ({
    active: false,
    target: -1,
    presence: 0,
    seen: false,
    pulled: true,
    left: 1,
    age: 0,
  }));
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'oath_chain', QUADS, {
      helpers: KIT_FLARE_GLSL + PALADIN_RUNE_GLSL,
      pull: 'aShape<1.5?0.3:(aShape<2.5?0.6:(aShape<3.5?0.35:(aShape<4.5||aShape>5.5?0.3:0.5)))',
      body: `
        if(vShape>5.5){
          // Furrows dragged through the ground behind the pulled enemy's feet
          // (uv.x 0 at the far end, 1 at the feet): two glowing grooves with
          // scuffed light between them.
          float y=abs(vUv.y);
          float groove=exp(-sq((y-0.45)/0.12));
          float scuff=(0.55+0.45*sin(vUv.x*40.0+vUv.y*13.0))*(1.0-smoothstep(0.3,0.6,y))*0.25;
          float along=smoothstep(0.0,0.7,vUv.x)*smoothstep(1.0,0.92,vUv.x);
          mask=(groove+scuff)*along*(1.0-smoothstep(0.85,1.0,y));
          color=mix(vColor,HOT,groove*along*0.6);
        } else if(vShape>4.5){
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.6);
        } else if(vShape>3.5){
          // Binding runes about the slowed enemy's feet.
          float c=cos(-t*0.4),s=sin(-t*0.4);
          vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
          mask=(paladinRuneRing(q,0.62,0.86)*0.9+band(r,0.92,0.012)*0.7)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.2);
        } else if(vShape>2.5){
          // The shackle about the waist: a band of light with link marks,
          // snapping shut as it closes.
          float cinch=1.0+0.7*exp(-t*10.0);
          float rr=r*cinch;
          float links=pow(max(cos(a*10.0+t*1.5),0.0),6.0);
          mask=(band(rr,0.78,0.05)*(1.0+links*0.7)+band(rr,0.78,0.14)*0.25)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,band(rr,0.78,0.03)*0.6);
        } else if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>0.5){
          // A link seen edge-on: a bright bar, rounded at its ends.
          vec2 q=vec2(vUv.x*2.0-1.0,vUv.y);
          float d=length(max(abs(q)-vec2(0.82,0.0),0.0));
          mask=exp(-sq(d/0.35))*1.2;
          color=mix(vColor,HOT,exp(-sq(d/0.15)));
        } else {
          // A link seen face-on: an open loop of light, a hot edge round a
          // dark middle (uv.x along the chain, uv.y across).
          vec2 q=vec2((vUv.x*2.0-1.0)*1.6,vUv.y);
          vec2 e=abs(q)-vec2(0.75,0.0);
          float d=length(max(e,0.0))+min(max(e.x,e.y),0.0)-0.62;
          float ring=exp(-sq(d/0.16));
          mask=(ring*1.25+exp(-sq(d/0.4))*0.2)*(1.0-smoothstep(0.85,1.0,abs(vUv.y)));
          color=mix(vColor,HOT,ring*0.6);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  private tetherFor(target: number, source?: number): Tether | undefined {
    let best: Tether | undefined;
    for (const t of this.tethers)
      if (t.active && t.target === target && (source === undefined || t.source === source))
        if (!best || t.age < best.age) best = t;
    return best;
  }

  private newTether(source: number, target: number): Tether {
    let slot = this.tethers.find((t) => !t.active);
    if (!slot) {
      slot = this.tethers[0];
      for (const t of this.tethers) if (t.age > slot.age) slot = t;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.age = 0;
    slot.held = false;
    slot.seen = false;
    slot.breaking = -1;
    slot.refused = false;
    return slot;
  }

  /** The Paladin hurls Oath Chain at `target`. */
  lash(source: number, target: number): boolean {
    if (!this.pool.ready() || source === target) return false;
    this.newTether(source, target);
    return true;
  }

  /** The chain `source` just threw at `target` will catch nothing (the sim
   * does not move that enemy, or the cast was resisted): instead of the caught
   * flare and shackle it pulls taut, strains and snaps. */
  refuse(source: number, target: number): boolean {
    const t = this.tetherFor(target, source);
    if (!t || t.held || t.breaking >= 0) return false;
    t.refused = true;
    return true;
  }

  /** Once a frame while `target` is pulled (or, after, slowed with `left` to
   * run) by the Paladin `source`, when known. */
  hold(target: number, pulled: boolean, left: number, source?: number): void {
    if (!this.pool.ready()) return;
    let slot = this.binds.find((b) => b.active && b.target === target);
    if (!slot) {
      slot = this.binds.find((b) => !b.active);
      if (slot) {
        slot.active = true;
        slot.target = target;
        slot.presence = 0;
        slot.age = 0;
      }
    }
    if (slot) {
      slot.seen = true;
      slot.pulled = pulled;
      slot.left = Number.isFinite(left) ? Math.min(1, Math.max(0, left)) : 1;
    }
    const tether = this.tetherFor(target, source);
    if (pulled) {
      // A pull seen without its cast (a late view): the chain is already fast.
      const t =
        tether ??
        (source !== undefined && source !== target ? this.newTether(source, target) : null);
      if (!t) return;
      if (!tether) t.age = OATH_THROW;
      if (t.breaking < 0) {
        // The pull is the truth: a chain it holds was not refused after all.
        t.held = true;
        t.seen = true;
        t.refused = false;
      }
    } else if (tether && tether.breaking < 0) {
      tether.breaking = 0;
    }
  }

  /** A point `u` of the way along the chain, at seconds `age` into it. */
  private chainPoint(t: Tether, u: number, head: number, out: THREE.Vector3): THREE.Vector3 {
    const dx = this.to.x - this.from.x,
      dy = this.to.y - this.from.y,
      dz = this.to.z - this.from.z;
    const flat = Math.hypot(dx, dz) || 1;
    const sx = -dz / flat,
      sz = dx / flat;
    const loose = 1 - head;
    let at = u;
    // Thrown: an arc and a whip's curl that straighten as the head lands.
    let lift = Math.sin(Math.PI * u) * Math.min(1.2, flat * 0.1) * loose;
    let side = Math.sin(u * Math.PI * 3 - t.age * 25) * 0.3 * loose * Math.sin(Math.PI * u);
    // Caught: taut, with a ripple running back down it from the enemy.
    const since = t.age - OATH_THROW;
    if (since >= 0 && t.refused) {
      // Refused: hauled dead straight, trembling with the strain; once it
      // snaps, each half whips back toward its own end.
      const strain = Math.min(1, since / OATH_STRAIN);
      lift *= 1 - strain;
      side += Math.sin(Math.PI * u) * 0.05 * strain * Math.sin(t.age * 90 + u * 40);
      if (t.breaking >= 0) {
        const recoil = Math.min(1, t.breaking / 0.2) * 0.18;
        at += u < 0.5 ? -recoil * u * 2 : recoil * (1 - u) * 2;
        lift -= Math.sin(Math.PI * Math.min(1, t.breaking / 0.3)) * 0.25 * Math.sin(Math.PI * at);
      }
    } else if (since >= 0) {
      const front = 1 - since * 3;
      side +=
        Math.sin((u - front) * 30) *
        0.12 *
        Math.exp(-((u - front) ** 2) * 60) *
        Math.exp(-since * 3);
      lift -= Math.sin(Math.PI * u) * 0.04 * Math.min(1, flat / 8);
    }
    return out.set(
      this.from.x + dx * at + sx * side,
      this.from.y + dy * at + lift,
      this.from.z + dz * at + sz * side,
    );
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
    for (const t of this.tethers) {
      if (!t.active) continue;
      t.age += dt;
      if (t.breaking >= 0) t.breaking += dt;
      else if (t.held && !t.seen) t.breaking = 0;
      else if (t.refused && t.age > OATH_THROW + OATH_STRAIN) t.breaking = 0;
      else if (!t.held && t.age > OATH_THROW + OATH_UNCAUGHT_HOLD) t.breaking = 0;
      t.seen = false;
      if (
        t.breaking > OATH_BREAK ||
        !this.ctx.anchor(t.target, 0.55, this.to) ||
        (!this.ctx.hand(t.source, 0, this.from) && !this.ctx.anchor(t.source, 0.6, this.from))
      ) {
        t.active = false;
        continue;
      }
      const head = reduced ? 1 : 1 - (1 - Math.min(1, t.age / OATH_THROW)) ** 2;
      const length = this.from.distanceTo(this.to);
      const shown = length * head;
      const count = Math.min(MAX_LINKS, Math.ceil(shown / LINK_SPACING));
      const since = t.age - OATH_THROW;
      // Light reeling along the chain toward the Paladin while it pulls.
      const reel = 1 - ((t.age * 1.6) % 1);
      for (let i = 0; i < count; i++) {
        const s0 = i * LINK_SPACING;
        const s1 = Math.min(shown, s0 + LINK_LENGTH);
        if (s1 - s0 < 0.05) continue;
        const u0 = s0 / length,
          u1 = s1 / length,
          along = (u0 + u1) / 2;
        let alpha = 1;
        if (t.breaking >= 0) {
          // Shattering from the enemy's end back to the Paladin; a refused
          // chain parts in the middle and the break runs out to both ends.
          const dieAt = t.refused ? Math.abs(along - 0.5) * 0.5 : (1 - along) * 0.28;
          alpha = 1 - ramp(t.breaking, dieAt, dieAt + 0.1);
          const flung = t.breaking - dieAt;
          if (i % 2 === 0 && flung > 0 && flung < 0.3 && !reduced) {
            this.chainPoint(t, along, head, this.a);
            const ang = hash01(i, 3) * Math.PI * 2;
            pool.time = 0;
            pool.billboard(
              this.a.x + Math.cos(ang) * flung * 1.6,
              this.a.y + flung * (0.6 + hash01(i, 5)),
              this.a.z + Math.sin(ang) * flung * 1.6,
              0.07,
              KIT_IVORY,
              (1 - flung / 0.3) * 1.2,
              SHAPE.mote,
            );
          }
          if (alpha <= 0.003) continue;
        }
        const glow = t.refused
          ? // Straining: the links heat toward the middle, where it will part.
            1 +
            (since >= 0 && t.breaking < 0
              ? Math.min(1, since / OATH_STRAIN) *
                (0.5 + 1.2 * Math.exp(-(((along - 0.5) * 5) ** 2))) *
                (reduced ? 1 : 0.8 + 0.2 * Math.sin(t.age * 60 + i))
              : 0)
          : (t.held && t.breaking < 0 && !reduced
              ? 0.75 + 0.85 * Math.exp(-(((along - reel) * 7) ** 2))
              : 1) +
            (since >= 0
              ? 1.2 * Math.exp(-(((along - (1 - since * 3)) * 6) ** 2)) * Math.exp(-since * 3)
              : 0);
        this.chainPoint(t, u0, head, this.a);
        this.chainPoint(t, u1, head, this.b);
        pool.time = 0;
        const edgeOn = i % 2 === 1;
        pool.beam(
          this.a.x,
          this.a.y,
          this.a.z,
          this.b.x,
          this.b.y,
          this.b.z,
          edgeOn ? 0.035 : 0.095,
          i % 3 === 0 ? KIT_WARM : KIT_GOLD,
          alpha * glow,
          edgeOn ? SHAPE.bar : SHAPE.link,
        );
      }
      if (since < 0) {
        // The blazing head of the thrown chain.
        this.chainPoint(t, head, head, this.a);
        pool.time = t.age;
        pool.billboard(this.a.x, this.a.y, this.a.z, 0.4, KIT_IVORY, 1.2, SHAPE.flare);
      } else if (t.refused) {
        // The head bites but cannot hold: a small glint on the enemy, then a
        // flare where the chain parts.
        if (since < 0.15) {
          pool.time = since;
          pool.billboard(
            this.to.x,
            this.to.y,
            this.to.z,
            0.45,
            KIT_IVORY,
            Math.exp(-since * 16) * 0.8,
            SHAPE.flare,
          );
        }
        if (t.breaking >= 0 && t.breaking < 0.3) {
          this.chainPoint(t, 0.5, head, this.a);
          pool.time = t.breaking;
          pool.billboard(
            this.a.x,
            this.a.y,
            this.a.z,
            0.8,
            KIT_IVORY,
            Math.exp(-t.breaking * 10) * 1.3,
            SHAPE.flare,
          );
        }
      } else if (since < 0.5) {
        // Caught: a flare as the shackle snaps shut.
        pool.time = since;
        pool.billboard(
          this.to.x,
          this.to.y,
          this.to.z,
          1.1,
          KIT_IVORY,
          Math.exp(-since * 9) * 1.3,
          SHAPE.flare,
        );
      }
    }
    for (const b of this.binds) {
      if (!b.active) continue;
      b.presence = b.seen ? Math.min(1, b.presence + dt * 8) : Math.max(0, b.presence - dt * 3);
      b.seen = false;
      b.age += dt;
      if (
        b.presence <= 0 ||
        !this.ctx.anchor(b.target, 0, this.feet) ||
        !this.ctx.anchor(b.target, 0.55, this.to)
      ) {
        b.active = false;
        continue;
      }
      const k = b.presence * (b.pulled ? 1 : Math.min(1, b.left / 0.2 + 0.2));
      pool.time = b.age;
      // The shackle lies level about the waist.
      pool.quad(
        this.to.x,
        this.to.y,
        this.to.z,
        0.55,
        0,
        0,
        0,
        0,
        0.55,
        KIT_WARM,
        k * 1.2,
        SHAPE.shackle,
      );
      const y = this.floorAt(0.05);
      if (!b.pulled) {
        pool.time = reduced ? 0 : this.clock;
        pool.ground(this.feet.x, y, this.feet.z, 0.95, KIT_GOLD, k, SHAPE.runes);
        continue;
      }
      // Dragged: furrows behind the feet, away from the Paladin pulling.
      const tether = this.tetherFor(b.target);
      if (!tether || !this.ctx.anchor(tether.source, 0, this.a)) continue;
      let dx = this.feet.x - this.a.x,
        dz = this.feet.z - this.a.z;
      const flat = Math.hypot(dx, dz);
      if (flat < 0.3) continue;
      dx /= flat;
      dz /= flat;
      const back = 0.9;
      pool.time = 0;
      pool.quad(
        this.feet.x + dx * back,
        y,
        this.feet.z + dz * back,
        -dx * back,
        0,
        -dz * back,
        -dz * 0.32,
        0,
        dx * 0.32,
        KIT_GOLD,
        k * 1.1,
        SHAPE.skid,
      );
      if (reduced) continue;
      for (let i = 0; i < DUST; i++) {
        const cycle = (this.clock * 2.4 + i / DUST) % 1;
        const side = (hash01(i, 7) - 0.5) * 0.6;
        pool.billboard(
          this.feet.x + dx * cycle * 0.5 - dz * side,
          y + cycle * 0.5,
          this.feet.z + dz * cycle * 0.5 + dx * side,
          0.05,
          KIT_IVORY,
          k * Math.sin(cycle * Math.PI),
          SHAPE.mote,
        );
      }
    }
    pool.end();
  }

  clear(): void {
    for (const t of this.tethers) t.active = false;
    for (const b of this.binds) b.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

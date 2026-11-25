import * as THREE from 'three';
import { PROJECTILE_SPEED } from '../../sim/projectile_travel';
import { noteShieldFlash } from '../paladin_shield_buffs';
import {
  KIT_FLARE_GLSL,
  KIT_GOLD,
  KIT_IVORY,
  KIT_WARM,
  type PaladinKitContext,
} from './paladin_kit_context';
import { hash01, PaladinQuadPool, ramp } from './paladin_quad_pool';
import { PALADIN_SPEC_EMBLEM_GLSL } from './paladin_spec_emblems';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './paladin_spec_icons';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailScale,
} from './paladin_vfx_detail_core';

export const DISC_FLIGHTS = 12;
export const DISC_IMPACTS = 12;
export const DISC_FLIGHT_LIMIT = 3;
export const DISC_IMPACT_DURATION = 0.55;
/** After the last bounce the shield flies home to the Paladin; a chain that
 * stops early (no enemy left to bounce to) sends it home after this long. */
export const DISC_RETURN_WAIT = 0.35;
/** A blow the enemy resisted (or that missed, or met immunity) glances off:
 * a brief spark over this long instead of the full impact. */
export const DISC_GLANCE_DURATION = 0.2;
/** The outcome rides the damage event in the impact cue's own batch; a verdict
 * later than this belongs to some other strike. */
const GLANCE_WINDOW = 0.1;
const GLANCE_SPARKS = 4;
/** The held shield's flash on the throw and the catch, over this long. */
const SHIELD_FLASH = 0.35;
const MOTES = 6;
const SPARKS = 10;
const SHAPE = { disc: 0, trail: 1, flare: 2, burst: 3, spark: 4, mote: 5 } as const;
const QUADS = DISC_FLIGHTS * (2 + MOTES) + DISC_IMPACTS * (2 + SPARKS) + DISC_FLIGHTS;

interface Flight {
  active: boolean;
  source: number;
  target: number;
  /** The Paladin who threw it. */
  owner: number;
  /** Flying home to be caught. */
  home: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  /** Seconds since the disc arrived (it holds for its impact cue). */
  arrived: number;
  spin: number;
  /** The Paladin detail read when this leg was thrown (a leg home keeps its strike's). */
  detail: PaladinVfxDetail;
}
interface Impact {
  active: boolean;
  target: number;
  owner: number;
  age: number;
  /** Which bounce: the first throw is 0. */
  level: number;
  /** The blow did nothing (resisted, missed, immune): it glances off. */
  glance: boolean;
  /** Whether the shield still has to come home from here, and when. */
  sendHome: boolean;
  homeIn: number;
  /** Where the blow fell, for the flight home when the enemy has no view. */
  x: number;
  y: number;
  z: number;
  /** The Paladin detail read when the blow fell. */
  detail: PaladinVfxDetail;
}
interface Flash {
  id: number;
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
 * Sunward Disc, a shield of sunlight hurled like a discus. The Paladin's held
 * shield flares as they throw, and a shield of light flies spinning from
 * their hand, the Faithwarden's sign on its face inside a sun's corona whose
 * rays wheel round it, light and motes streaming behind. Each enemy it
 * reaches takes a flare, a shield-shaped burst and a spray of sparks before it
 * ricochets on to the next, every bounce a little hotter. After the last it
 * flies home to the Paladin's hand, and their shield flashes as they catch it.
 *
 * Detail: core = the spinning shield, the shield-shaped burst on each enemy
 * and a resisted blow's glint; secondary = the trail of light behind the
 * shield and the motes streaming along it; accents = the flares of the strike
 * and the catch. Light drops the flares and halves the motes and sparks;
 * minimal flies the bare shield and bursts with a third of the sparks.
 */
/** Seconds a struck enemy remembers whose shield struck it, for its bounces. */
const SUNWARD_OWNER_TTL = 5;

export class SunwardDisc {
  private readonly pool: PaladinQuadPool<'sunward_disc'>;
  private readonly flights: Flight[] = Array.from({ length: DISC_FLIGHTS }, () => ({
    active: false,
    source: -1,
    target: -1,
    owner: -1,
    home: false,
    age: 0,
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dy: 0,
    dz: 1,
    arrived: -1,
    spin: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly impacts: Impact[] = Array.from({ length: DISC_IMPACTS }, () => ({
    active: false,
    target: -1,
    owner: -1,
    age: 0,
    level: 0,
    glance: false,
    sendHome: false,
    homeIn: DISC_RETURN_WAIT,
    x: 0,
    y: 0,
    z: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  /** The held shield's flashes, on the throw and the catch. */
  private readonly flashes: Flash[] = [];
  /** Who threw the shield that last struck each enemy, for its bounces. */
  private readonly owners = new Map<number, number>();
  /** When each owner was noted: a strike's bounces follow it within a
   *  second, so a note older than SUNWARD_OWNER_TTL is dropped. */
  private readonly ownerAt = new Map<number, number>();
  private ownerSweep = 0;
  private readonly from = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'sunward_disc', QUADS, {
      uniforms: paladinSpecIconUniforms(),
      helpers: KIT_FLARE_GLSL + SHIELD_GLSL + PALADIN_SPEC_ICON_GLSL + PALADIN_SPEC_EMBLEM_GLSL,
      pull: 'aShape>1.5?0.6:0.3',
      body: `
        if(vShape>4.5){
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>3.5){
          float head=exp(-(sq(vUv.x-0.8)*30.0+vUv.y*vUv.y*6.0));
          mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.7+head;
          color=mix(vColor,HOT,head);
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
          // The light streaming behind it.
          float across=exp(-vUv.y*vUv.y*4.5);
          float core=exp(-vUv.y*vUv.y*34.0);
          float along=smoothstep(0.0,0.75,vUv.x)*smoothstep(1.0,0.9,vUv.x);
          mask=(across*0.4+core*0.9)*along;
          color=mix(vColor,HOT,core*0.8);
        } else {
          // The thrown shield: a shield of light, its rim bright, the
          // Faithwarden's sign on its face, inside a sun's corona with rays
          // wheeling round it (t is its spin).
          float c=cos(t),s=sin(t);
          vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
          vec2 sq2=q/0.62;
          float d=heaterShield(sq2)*0.62;
          float fill=1.0-smoothstep(-0.01,0.01,d);
          float rim=exp(-abs(d)*45.0)+exp(-abs(d+0.06)*90.0)*0.5;
          float mark=0.0;
          vec2 e=sq2/0.6;
          if(uSpecIconsReady>0.5){
            vec3 icon=paladinSpecIcon(e,1.0);
            mark=max(1.0-smoothstep(0.0,0.04,icon.y-0.006),(1.0-smoothstep(-0.01,0.02,icon.x))*0.3);
          } else {
            float sd=paladinSpecDist(e,1.0);
            mark=max(1.0-smoothstep(0.012,0.03,abs(sd)),(1.0-smoothstep(-0.01,0.01,sd))*0.3);
          }
          mark*=fill;
          float qa=atan(q.y,q.x);
          float corona=exp(-sq((r-0.72)/0.06))*0.5+exp(-r*r*2.5)*0.25;
          float rays=pow(max(cos(qa*12.0),0.0),12.0)*smoothstep(0.66,0.72,r)*(1.0-smoothstep(0.8,0.97,r));
          mask=(fill*0.3+rim*1.2+mark*1.1+corona+rays*0.8)*(1.0-smoothstep(0.95,1.0,r));
          color=mix(vColor,HOT,clamp(rim*0.5+mark*0.5+fill*0.15,0.0,1.0));
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  private newFlight(
    source: number,
    target: number,
    owner: number,
    home: boolean,
    x: number,
    y: number,
    z: number,
    detail: PaladinVfxDetail,
  ): void {
    let slot = this.flights.find((f) => !f.active);
    if (!slot) {
      slot = this.flights[0];
      for (const f of this.flights) if (f.age > slot.age) slot = f;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.owner = owner;
    slot.home = home;
    slot.age = 0;
    slot.arrived = -1;
    slot.spin = 0;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.detail = detail;
  }

  private flash(id: number): void {
    const f = this.flashes.find((x) => x.id === id);
    if (f) f.age = 0;
    else this.flashes.push({ id, age: 0 });
  }

  /** A leg of the disc's flight: from `source` (the Paladin, or the last enemy struck) to `target`. */
  hurl(source: number, target: number): boolean {
    if (!this.pool.ready() || source === target) return false;
    const bounced = this.owners.get(source);
    // Thrown by a Paladin: from their shield hand. Bounced: from the enemy.
    const owner = bounced ?? source;
    // A bounce on its way: the shield does not come home from here.
    const struck = this.struckAt(source);
    if (struck) struck.sendHome = false;
    if (bounced === undefined) {
      if (!this.ctx.hand(source, 1, this.from) && !this.ctx.anchor(source, 0.6, this.from))
        return false;
      this.flash(source);
    } else if (!this.ctx.anchor(source, 0.6, this.from)) {
      // An enemy out of view: from where the shield struck it.
      if (!struck) return false;
      this.from.set(struck.x, struck.y, struck.z);
    }
    this.newFlight(
      source,
      target,
      owner,
      false,
      this.from.x,
      this.from.y,
      this.from.z,
      paladinVfxDetailNow(),
    );
    return true;
  }

  /** The newest live strike on `target`. */
  private struckAt(target: number): Impact | undefined {
    let best: Impact | undefined;
    for (const im of this.impacts)
      if (im.active && im.target === target && (!best || im.age < best.age)) best = im;
    return best;
  }

  /** The disc reaches `target` on bounce `level` of `count` hits. */
  strike(source: number, target: number, level: number, count = 0): void {
    if (!this.pool.ready()) return;
    const flight = this.flights.find(
      (f) => f.active && !f.home && f.source === source && f.target === target,
    );
    const owner = flight?.owner ?? this.owners.get(source) ?? source;
    // Where the blow fell: the enemy, else where the shield was, else whence it came.
    let placed = !!this.ctx.anchor(target, 0.6, this.at);
    if (!placed && flight) {
      this.at.set(flight.x, flight.y, flight.z);
      placed = true;
    }
    if (!placed) placed = !!this.ctx.anchor(source, 0.6, this.at);
    const before = placed ? undefined : this.struckAt(source);
    if (before) {
      this.at.set(before.x, before.y, before.z);
      placed = true;
    }
    if (flight) flight.active = false;
    this.owners.set(target, owner);
    this.ownerAt.set(target, this.clock);
    let slot = this.impacts.find((i) => !i.active);
    if (!slot) {
      slot = this.impacts[0];
      for (const i of this.impacts) if (i.age > slot.age) slot = i;
    }
    slot.active = true;
    slot.target = target;
    slot.owner = owner;
    slot.age = 0;
    slot.level = Number.isFinite(level) ? level : 0;
    slot.glance = false;
    slot.sendHome = owner !== target && placed;
    slot.x = this.at.x;
    slot.y = this.at.y;
    slot.z = this.at.z;
    slot.detail = paladinVfxDetailNow();
    // The last hit: home at once; otherwise after a wait, unless it bounces.
    slot.homeIn = count > 0 && slot.level >= count - 1 ? 0.1 : DISC_RETURN_WAIT;
  }

  /** The disc's blow on `target` did nothing (resisted, missed, immune): the
   * strike just landed there glances off in a short spark instead of the full
   * burst, and with no bounce to follow the shield heads home at once. */
  glance(target: number): boolean {
    const im = this.struckAt(target);
    if (!im || im.age > GLANCE_WINDOW) return false;
    im.glance = true;
    im.homeIn = Math.min(im.homeIn, DISC_GLANCE_DURATION * 0.5);
    return true;
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    if (this.owners.size > 0 && this.clock >= this.ownerSweep) {
      this.ownerSweep = this.clock + 1;
      for (const [id, at] of this.ownerAt)
        if (this.clock - at > SUNWARD_OWNER_TTL) {
          this.ownerAt.delete(id);
          this.owners.delete(id);
        }
    }
    const pool = this.pool;
    bindPaladinSpecIcons(pool.mesh.material);
    pool.begin(this.ctx.camera);
    const c = pool.cam;
    // The held shield's flashes.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      if (f.age >= SHIELD_FLASH) {
        noteShieldFlash(f.id, 0);
        this.flashes.splice(i, 1);
        continue;
      }
      noteShieldFlash(f.id, 1 - f.age / SHIELD_FLASH);
    }
    for (const f of this.flights) {
      if (!f.active) continue;
      f.age += dt;
      if (!reduced) f.spin += dt * 16;
      const aimed = f.home
        ? this.ctx.hand(f.target, 1, this.at) || this.ctx.anchor(f.target, 0.6, this.at)
        : this.ctx.anchor(f.target, 0.6, this.at);
      if (f.age > DISC_FLIGHT_LIMIT || !aimed) {
        f.active = false;
        continue;
      }
      const dx = this.at.x - f.x,
        dy = this.at.y - f.y,
        dz = this.at.z - f.z;
      const distance = Math.hypot(dx, dy, dz);
      const step = Math.min(distance, PROJECTILE_SPEED * dt);
      if (distance > 0.01) {
        f.dx = dx / distance;
        f.dy = dy / distance;
        f.dz = dz / distance;
        f.x += f.dx * step;
        f.y += f.dy * step;
        f.z += f.dz * step;
      }
      if (distance - step <= 0.4) {
        if (f.home) {
          // Caught: the Paladin's shield flashes.
          f.active = false;
          this.flash(f.target);
          pool.time = 0;
          if (paladinDetailScale(f.detail).accents)
            pool.billboard(this.at.x, this.at.y, this.at.z, 0.8, KIT_IVORY, 1.2, SHAPE.flare);
          continue;
        }
        // Arrived: hold out of sight a moment for the impact cue.
        if (f.arrived < 0) f.arrived = 0;
        f.arrived += dt;
        if (f.arrived > 0.4) f.active = false;
        continue;
      }
      pool.time = reduced ? 0.4 : f.spin;
      pool.billboard(f.x, f.y, f.z, 0.72, KIT_WARM, 1.25, SHAPE.disc);
      if (!paladinDetailScale(f.detail).secondary) continue;
      const trail = Math.min(f.age * PROJECTILE_SPEED, 2.6);
      pool.time = 0;
      pool.beam(
        f.x - f.dx * trail,
        f.y - f.dy * trail,
        f.z - f.dz * trail,
        f.x,
        f.y,
        f.z,
        0.24,
        KIT_GOLD,
        0.9,
        SHAPE.trail,
      );
      const motes = paladinDetailCount(MOTES, f.detail);
      if (!reduced)
        for (let i = 0; i < motes; i++) {
          const back = trail * (0.15 + 0.85 * ((i + ((this.clock * 3) % 1)) / motes));
          const ang = hash01(i, 5) * Math.PI * 2 + this.clock * 4;
          const off = 0.12 * (back / Math.max(trail, 0.01));
          pool.billboard(
            f.x - f.dx * back + (c[0] * Math.cos(ang) + c[3] * Math.sin(ang)) * off,
            f.y - f.dy * back + (c[1] * Math.cos(ang) + c[4] * Math.sin(ang)) * off,
            f.z - f.dz * back + (c[2] * Math.cos(ang) + c[5] * Math.sin(ang)) * off,
            0.05,
            i % 2 ? KIT_IVORY : KIT_GOLD,
            (1 - back / Math.max(trail, 0.01)) * 1.1,
            SHAPE.mote,
          );
        }
    }
    for (const im of this.impacts) {
      if (!im.active) continue;
      im.age += dt;
      // No bounce came: the shield flies home to be caught.
      const seen = this.ctx.anchor(im.target, 0.6, this.at);
      if (seen) {
        im.x = this.at.x;
        im.y = this.at.y;
        im.z = this.at.z;
      }
      if (im.sendHome && im.age >= im.homeIn) {
        im.sendHome = false;
        this.newFlight(im.target, im.owner, im.owner, true, im.x, im.y, im.z, im.detail);
      }
      const shown = im.age;
      if (shown >= DISC_IMPACT_DURATION && !im.sendHome) {
        im.active = false;
        continue;
      }
      // An enemy out of view shows nothing, but the shield still comes home.
      if (!seen || shown >= DISC_IMPACT_DURATION) continue;
      const scale = paladinDetailScale(im.detail);
      if (im.glance) {
        // Glanced off: a small hard glint where it skipped and a few sparks
        // kicked away, no burst.
        if (shown >= DISC_GLANCE_DURATION) continue;
        pool.time = shown;
        pool.billboard(
          this.at.x,
          this.at.y,
          this.at.z,
          0.5,
          KIT_IVORY,
          Math.exp(-shown * 18) * 0.9,
          SHAPE.flare,
        );
        const motion = reduced ? 0.3 : 1;
        const glanceSparks = paladinDetailCount(GLANCE_SPARKS, im.detail);
        for (let i = 0; i < glanceSparks; i++) {
          const life = 0.12 + 0.06 * hash01(i, 7);
          if (shown >= life) continue;
          const ang = i * 2.399963 + hash01(i, 9);
          const speed = (3 + 2 * hash01(i, 8)) * motion;
          const vx = (c[0] * Math.cos(ang) + c[3] * Math.sin(ang)) * speed,
            vy = (c[1] * Math.cos(ang) + c[4] * Math.sin(ang)) * speed,
            vz = (c[2] * Math.cos(ang) + c[5] * Math.sin(ang)) * speed;
          const sx = this.at.x + vx * shown,
            sy = this.at.y + vy * shown,
            sz = this.at.z + vz * shown;
          pool.time = 0;
          pool.beam(
            sx - vx * 0.03,
            sy - vy * 0.03,
            sz - vz * 0.03,
            sx,
            sy,
            sz,
            0.025,
            i % 2 ? KIT_GOLD : KIT_IVORY,
            (1 - shown / life) * 0.9,
            SHAPE.spark,
          );
        }
        continue;
      }
      // Every bounce strikes for the same, less than the first impact.
      const heat = im.level > 0 ? 0.85 : 1;
      pool.time = shown;
      if (scale.accents)
        pool.billboard(
          this.at.x,
          this.at.y,
          this.at.z,
          1.3 * heat,
          KIT_IVORY,
          Math.exp(-shown * 10) * 1.3,
          SHAPE.flare,
        );
      pool.billboard(
        this.at.x,
        this.at.y,
        this.at.z,
        1.4 * heat,
        KIT_GOLD,
        1 - ramp(shown, 0.3, DISC_IMPACT_DURATION),
        SHAPE.burst,
      );
      const motion = reduced ? 0.3 : 1;
      const sparks = paladinDetailCount(SPARKS, im.detail);
      for (let i = 0; i < sparks; i++) {
        const life = 0.25 + 0.15 * hash01(i, 3);
        if (shown >= life) continue;
        const ang = i * 2.399963 + hash01(i, im.level + 1);
        const speed = (2.5 + 2.5 * hash01(i, 2)) * motion;
        const vx = (c[0] * Math.cos(ang) + c[3] * Math.sin(ang)) * speed,
          vy = (c[1] * Math.cos(ang) + c[4] * Math.sin(ang)) * speed,
          vz = (c[2] * Math.cos(ang) + c[5] * Math.sin(ang)) * speed;
        const sx = this.at.x + vx * shown,
          sy = this.at.y + vy * shown - 4 * shown * shown * motion,
          sz = this.at.z + vz * shown;
        pool.time = 0;
        pool.beam(
          sx - vx * 0.04,
          sy - vy * 0.04,
          sz - vz * 0.04,
          sx,
          sy,
          sz,
          0.03,
          i % 2 ? KIT_GOLD : KIT_IVORY,
          (1 - shown / life) * 1.1,
          SHAPE.spark,
        );
      }
    }
    pool.end();
  }

  clear(): void {
    for (const f of this.flights) f.active = false;
    for (const i of this.impacts) i.active = false;
    for (const f of this.flashes) noteShieldFlash(f.id, 0);
    this.flashes.length = 0;
    this.owners.clear();
    this.ownerAt.clear();
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

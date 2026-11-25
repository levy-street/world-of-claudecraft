import * as THREE from 'three';
import { noteVowkeeperWeapon } from '../paladin_shield_buffs';
import { KIT_FLARE_GLSL, KIT_GOLD, KIT_IVORY, type PaladinKitContext } from './paladin_kit_context';
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

export const VOW_STRIKES = 8;
/** The impact lands when the swing peaks, at the latest this long after the hit. */
export const VOW_SWING_MAX = 0.7;
/** The impact's light plays out over this long. */
export const VOW_IMPACT = 1.3;
/** Points kept along the weapon's path, and how long each lingers. */
const TRAIL = 18;
const TRAIL_LIFE = 0.25;
const SPARKS = 14;
/** The anger it draws: red-gold. */
const EMBER = new THREE.Color(0xff6a3a).multiplyScalar(1.3);
const SHAPE = {
  star: 0,
  brand: 1,
  flare: 2,
  trail: 3,
  spark: 4,
  shock: 5,
  smite: 6,
  ward: 7,
} as const;
/** Ascension's vow-ward: Paladins it is held on at once. */
export const VOW_WARDS = 8;
/** Seconds the ward takes to rise, and to shatter (broken) or fade (run out). */
export const VOW_WARD_RISE = 0.2;
export const VOW_WARD_END = 0.3;
const QUADS = VOW_STRIKES * (TRAIL + SPARKS + 7) + VOW_WARDS;

interface Ward {
  /** Seconds held, then seconds since it ended (ended >= 0). */
  age: number;
  ended: number;
  held: boolean;
  /** The absorb's share left, and its seconds left, as last seen. */
  share: number;
  left: number;
  broke: boolean;
}

interface Strike {
  active: boolean;
  source: number;
  target: number;
  absorbed: boolean;
  /** Seconds since the hit. */
  age: number;
  /** Seconds since the impact landed, or -1 while the swing is still coming. */
  impact: number;
  /** The weapon hand's path: x, y, z and age per point, newest first. */
  path: Float32Array;
  points: number;
  speed: number;
  peak: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  tracked: boolean;
  /** The Paladin detail read when the hit came. */
  detail: PaladinVfxDetail;
}

/**
 * Vowkeeper Strike, the Faithwarden's oath-bound blow. The Paladin's own weapon
 * blazes with holy light through the swing (the character's glowing layer on
 * the held weapon, told of it through paladin_shield_buffs.ts), a ribbon of
 * gold trailing it, and the blow lands as the swing peaks in a radiant smite:
 * the weapon flares, a starburst of light breaks over the enemy, a short shaft
 * of light hammers down onto them and a shock ring runs out at their feet,
 * sparks flying.
 *
 * Detail: core = the starburst over the enemy (and Ascension's vow-ward, one
 * shell on every tier); secondary = the ribbon trailing the weapon, the shaft
 * of light and the shock ring at their feet; accents = the flare. The weapon's
 * own glow (paladin_shield_buffs.ts) plays on every tier. Light drops the
 * flare and halves the sparks; minimal keeps the starburst with a third of
 * them.
 */
export class VowkeeperStrike {
  private readonly pool: PaladinQuadPool<'vowkeeper_strike'>;
  private readonly strikes: Strike[] = Array.from({ length: VOW_STRIKES }, () => ({
    active: false,
    source: -1,
    target: -1,
    absorbed: false,
    age: 0,
    impact: -1,
    path: new Float32Array(TRAIL * 4),
    points: 0,
    speed: 0,
    peak: 0,
    lastX: 0,
    lastY: 0,
    lastZ: 0,
    tracked: false,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly at = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly wards = new Map<number, Ward>();

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'vowkeeper_strike', QUADS, {
      uniforms: paladinSpecIconUniforms(),
      helpers: KIT_FLARE_GLSL + PALADIN_SPEC_ICON_GLSL + PALADIN_SPEC_EMBLEM_GLSL,
      pull: 'aShape>2.5&&aShape<3.5?0.2:(aShape>4.5&&aShape<5.5?0.3:0.7)',
      body: `
        if(vShape>6.5){
          // Ascension's vow-ward: a shell of light round the Paladin, its rim
          // as bright as the shield is whole. t < 0 while held; from 0 it ends,
          // shattering outward when broken (vColor.b high) or fading.
          float end=max(t,0.0)/${VOW_WARD_END.toFixed(2)};
          bool shatter=t>=0.0&&vColor.b>vColor.r*0.4;
          float at=0.86+(shatter?0.25*end:0.0);
          float rim=band(r,at,0.035+(shatter?0.05*end:0.0))+band(r,at,0.13)*0.25;
          float sheen=pow(max(cos(a-0.9),0.0),6.0)*band(r,0.8,0.08)*0.5;
          float fill=exp(-r*r*2.2)*0.07;
          mask=(rim+sheen+fill)*(1.0-smoothstep(0.97,1.0,r));
          color=mix(vColor,HOT,band(r,at,0.02)*0.5);
        } else if(vShape>5.5){
          // A short shaft of light hammering down onto the enemy (uv.x up).
          float fall=clamp(t/0.08,0.0,1.0);
          float across=exp(-vUv.y*vUv.y*5.0);
          float core=exp(-vUv.y*vUv.y*40.0);
          float shown=smoothstep(1.0-fall-0.05,1.0-fall,vUv.x);
          float ends=smoothstep(0.0,0.08,vUv.x)*smoothstep(1.0,0.75,vUv.x);
          mask=(across*0.5+core*1.3)*shown*ends;
          color=mix(vColor,HOT,core*0.8);
        } else if(vShape>4.5){
          // The shock running out at their feet.
          float grow=1.0-sq(max(1.0-clamp(t/0.35,0.0,1.0),0.0));
          mask=(band(r,0.15+0.8*grow,0.02+0.04*grow)*1.3+band(r,0.1+0.75*grow,0.1)*0.25)
            *(1.0-grow)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.4);
        } else if(vShape>3.5){
          float head=exp(-(sq(vUv.x-0.8)*30.0+vUv.y*vUv.y*6.0));
          mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.7+head;
          color=mix(vColor,HOT,head);
        } else if(vShape>2.5){
          // A segment of the weapon's trail: a soft ribbon, a hot core.
          float core=exp(-vUv.y*vUv.y*30.0);
          mask=exp(-vUv.y*vUv.y*3.5)*0.45+core;
          color=mix(vColor,HOT,core*0.7);
        } else if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>0.5){
          // The brand: the Faithwarden's sign in a fine ring, stamped down
          // from large and burning (t its age).
          float slam=1.0+0.7*exp(-t*12.0);
          vec2 q=p*slam;
          float qr=length(q);
          float ring=exp(-sq((qr-0.84)/0.03))+exp(-sq((qr-0.74)/0.012))*0.5;
          float mark=0.0;
          vec2 e=q/0.6;
          if(uSpecIconsReady>0.5){
            vec3 icon=paladinSpecIcon(e,1.0);
            mark=max(1.0-smoothstep(0.0,0.04,icon.y-0.006),(1.0-smoothstep(-0.01,0.02,icon.x))*0.4);
          } else {
            float sd=paladinSpecDist(e,1.0);
            mark=max(1.0-smoothstep(0.012,0.03,abs(sd)),(1.0-smoothstep(-0.01,0.01,sd))*0.4);
          }
          float flicker=0.85+0.15*sin(t*13.0+q.y*6.0);
          mask=(ring*0.9+mark*1.2*flicker+exp(-qr*qr*3.0)*0.15)*(1.0-smoothstep(0.92,1.0,r));
          color=mix(vColor,HOT,mark*0.4+ring*0.2);
        } else {
          // The starburst: long and short rays of light breaking out from the
          // blow, a hot core, opening and fading.
          float open=1.0-sq(max(1.0-clamp(t/0.18,0.0,1.0),0.0));
          float a8=a*8.0+0.3;
          float longRay=pow(max(cos(a8),0.0),40.0)*(1.0-smoothstep(0.3,0.95*open,r));
          float shortRay=pow(max(cos(a8+3.14159),0.0),60.0)*(1.0-smoothstep(0.2,0.55*open,r))*0.7;
          float core=exp(-r*r*16.0);
          mask=((longRay+shortRay)*smoothstep(0.05,0.15,r)+core*1.2)*(1.0-smoothstep(0.92,1.0,r));
          color=mix(vColor,HOT,core+longRay*0.4);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** Each frame Ascension's absorb holds on Paladin `id`: `share` of it left,
   * `left` seconds. */
  ward(id: number, share: number, left: number): void {
    let ward = this.wards.get(id);
    if (!ward || ward.ended >= 0) {
      ward = { age: 0, ended: -1, held: false, share: 1, left, broke: false };
      this.wards.set(id, ward);
    }
    ward.held = true;
    ward.share = Math.min(1, Math.max(0, share));
    ward.left = left;
  }

  /** The strike's hit on `target`: the impact follows as the swing lands. */
  strike(source: number, target: number, outcome: 'damage' | 'absorb' | 'none'): boolean {
    if (!this.pool.ready() || source === target || outcome === 'none') return false;
    let slot = this.strikes.find((s) => !s.active);
    if (!slot) {
      slot = this.strikes[0];
      for (const s of this.strikes) if (s.age > slot.age) slot = s;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.absorbed = outcome === 'absorb';
    slot.age = 0;
    slot.impact = -1;
    slot.points = 0;
    slot.speed = 0;
    slot.peak = 0;
    slot.tracked = false;
    slot.detail = paladinVfxDetailNow();
    return true;
  }

  /** Follows the weapon hand: extends its trail and lands the impact as the swing peaks. */
  private follow(s: Strike, dt: number): void {
    const p = s.path;
    for (let i = 0; i < s.points; i++) p[i * 4 + 3] += dt;
    if (!this.ctx.hand(s.source, 0, this.hand)) {
      if (s.impact < 0) s.impact = 0;
      return;
    }
    if (s.tracked && dt > 0) {
      s.speed =
        Math.hypot(this.hand.x - s.lastX, this.hand.y - s.lastY, this.hand.z - s.lastZ) / dt;
      s.peak = Math.max(s.peak, s.speed);
    }
    s.lastX = this.hand.x;
    s.lastY = this.hand.y;
    s.lastZ = this.hand.z;
    s.tracked = true;
    if (s.impact < 0 || s.impact < TRAIL_LIFE) {
      p.copyWithin(4, 0, (TRAIL - 1) * 4);
      p[0] = this.hand.x;
      p[1] = this.hand.y;
      p[2] = this.hand.z;
      p[3] = 0;
      s.points = Math.min(TRAIL, s.points + 1);
    }
    // The swing has peaked and is slowing: the blow lands.
    if (s.impact < 0 && s.peak > 2 && s.speed < s.peak * 0.55) s.impact = 0;
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const pool = this.pool;
    bindPaladinSpecIcons(pool.mesh.material);
    pool.begin(this.ctx.camera);
    const c = pool.cam;
    for (const s of this.strikes) {
      if (!s.active) continue;
      s.age += dt;
      if (s.impact >= 0) s.impact += dt;
      if (
        s.impact > VOW_IMPACT ||
        !this.ctx.anchor(s.target, 0.55, this.at) ||
        !this.ctx.anchor(s.target, 0, this.feet) ||
        !this.ctx.anchor(s.target, 1, this.head)
      ) {
        s.active = false;
        noteVowkeeperWeapon(s.source, 0, 0);
        continue;
      }
      this.follow(s, dt);
      if (s.impact < 0 && (reduced || s.age >= VOW_SWING_MAX)) s.impact = 0;
      const weak = s.absorbed ? 0.6 : 1;
      const scale = paladinDetailScale(s.detail);
      // The weapon blazing through the swing, flaring as the blow lands.
      const t = s.impact;
      noteVowkeeperWeapon(
        s.source,
        ramp(s.age, 0, 0.12) * (t < 0 ? 0.85 : 0.85 * (1 - ramp(t, 0.1, 0.55))),
        t < 0 ? 0 : Math.exp(-t * 14),
      );
      // The weapon's trail.
      const p = s.path;
      for (let i = 0; scale.secondary && i < s.points - 1; i++) {
        const a0 = p[i * 4 + 3],
          a1 = p[i * 4 + 7];
        if (a1 >= TRAIL_LIFE) break;
        const k = Math.min(1 - a0 / TRAIL_LIFE, 1 - a1 / TRAIL_LIFE);
        pool.time = 0;
        pool.beam(
          p[i * 4 + 4],
          p[i * 4 + 5],
          p[i * 4 + 6],
          p[i * 4],
          p[i * 4 + 1],
          p[i * 4 + 2],
          0.06 + 0.14 * k,
          KIT_GOLD,
          k * 1.4 * weak,
          SHAPE.trail,
        );
      }
      if (t < 0) continue;
      // The smite: a flare and a starburst over the enemy.
      pool.time = t;
      if (scale.accents)
        pool.billboard(
          this.at.x,
          this.at.y,
          this.at.z,
          1.1,
          KIT_IVORY,
          Math.exp(-t * 11) * 1.4 * weak,
          SHAPE.flare,
        );
      pool.billboard(
        this.at.x,
        this.at.y,
        this.at.z,
        1.3,
        KIT_GOLD,
        (1 - ramp(t, 0.12, 0.4)) * 1.3 * weak,
        SHAPE.star,
        0.4,
      );
      // A shaft of light hammering down onto them.
      if (t < 0.4 && scale.secondary) {
        const h = this.head.y - this.feet.y;
        pool.upright(
          this.feet.x,
          this.feet.y + h * 0.95,
          this.feet.z,
          0.32,
          h * 0.95,
          KIT_IVORY,
          (1 - ramp(t, 0.1, 0.4)) * 1.2 * weak,
          SHAPE.smite,
        );
      }
      // The shock at their feet.
      const floor = this.ctx.groundY(this.feet.x, this.feet.z);
      const y = (Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y) + 0.05;
      if (scale.secondary)
        pool.ground(this.feet.x, y, this.feet.z, 1.4, KIT_GOLD, weak, SHAPE.shock);
      // Sparks thrown off the blow.
      const motion = reduced ? 0.3 : 1;
      const sparks = paladinDetailCount(SPARKS, s.detail);
      for (let i = 0; i < sparks; i++) {
        const life = 0.25 + 0.25 * hash01(i, 3);
        if (t >= life) continue;
        const ang = (i / sparks) * Math.PI * 2 + hash01(i, 1) * 0.5;
        const speed = (2.5 + 3 * hash01(i, 2)) * motion;
        const vx = (c[0] * Math.cos(ang) + c[3] * Math.sin(ang)) * speed,
          vy = (c[1] * Math.cos(ang) + c[4] * Math.sin(ang)) * speed,
          vz = (c[2] * Math.cos(ang) + c[5] * Math.sin(ang)) * speed;
        const sx = this.at.x + vx * t,
          sy = this.at.y + vy * t - 5 * t * t * motion,
          sz = this.at.z + vz * t;
        pool.time = 0;
        pool.beam(
          sx - vx * 0.04,
          sy - vy * 0.04,
          sz - vz * 0.04,
          sx,
          sy,
          sz,
          0.03,
          i % 3 ? KIT_GOLD : EMBER,
          (1 - t / life) * weak,
          SHAPE.spark,
        );
      }
    }
    this.drawWards(dt, reduced);
    pool.end();
  }

  /** The vow-wards: held, then shattered when broken or faded when run out. */
  private drawWards(dt: number, reduced: boolean): void {
    const pool = this.pool;
    for (const [id, w] of this.wards) {
      if (w.ended < 0 && !w.held) {
        // Gone with time still on it: the blows broke it.
        w.ended = 0;
        w.broke = w.left > 0.25;
      } else if (w.ended >= 0) w.ended += dt;
      else w.age += dt;
      w.held = false;
      if (
        w.ended >= VOW_WARD_END ||
        !this.ctx.anchor(id, 0.5, this.at) ||
        !this.ctx.anchor(id, 0, this.feet) ||
        !this.ctx.anchor(id, 1, this.head)
      ) {
        this.wards.delete(id);
        continue;
      }
      const height = Math.max(0.8, this.head.y - this.feet.y);
      const rise = reduced ? 1 : ramp(w.age, 0, VOW_WARD_RISE);
      const end = w.ended < 0 ? 0 : w.ended / VOW_WARD_END;
      const alpha =
        w.ended < 0
          ? rise * (0.45 + 0.55 * w.share)
          : w.broke
            ? (1 - end) * 1.3
            : (1 - end) * (0.45 + 0.55 * w.share);
      // Broken: an ivory flash (its blue marks the shatter in the shader).
      pool.time = w.ended < 0 ? -1 : w.ended;
      pool.billboard(
        this.at.x,
        this.at.y,
        this.at.z,
        height * 0.62 * (0.85 + 0.15 * rise),
        w.ended >= 0 && w.broke ? KIT_IVORY : KIT_GOLD,
        alpha,
        SHAPE.ward,
      );
    }
  }

  clear(): void {
    this.wards.clear();
    for (const s of this.strikes) {
      if (s.active) noteVowkeeperWeapon(s.source, 0, 0);
      s.active = false;
    }
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

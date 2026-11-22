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
  paladinDetailScale,
  paladinLingerEnd,
} from './paladin_vfx_detail_core';

export const SWEEPS = 6;
export const SWEEP_HITS = 12;
/** The shield meets its target (Woc_Shield_Bash's contact, 0.292 s; the
 * hits land at 0.32 s). */
export const BASH_IMPACT = 0.292;
export const SWEEP_DURATION = 1.0;
export const SWEEP_HIT_DURATION = 0.55;
/** Rings of force the bash drives out ahead, one after another. */
const BOOMS = 3;
const BOOM_GAP = 0.06;
const BOOM_LIFE = 0.42;
/** Motes of light drawn into the shield through the windup. */
const MOTES = 8;
const SPARKS = 8;
const STREAKS = 3;
const SHAPE = { wave: 1, flare: 2, ring: 3, spark: 4, boom: 5, mote: 6 } as const;
const QUADS = SWEEPS * (2 + BOOMS + MOTES) + SWEEP_HITS * (2 + SPARKS + STREAKS);

interface Sweep {
  active: boolean;
  source: number;
  age: number;
  range: number;
  facing: number;
  x: number;
  y: number;
  z: number;
  /** Chest height above the feet. */
  chest: number;
  /** Where the shield was at the impact: the shield outlines start there. */
  hitX: number;
  hitY: number;
  hitZ: number;
  struck: boolean;
  /** The Paladin detail read when the bash began. */
  detail: PaladinVfxDetail;
  /** When it ends (the shockwave's fade tail shortened on lighter tiers). */
  end: number;
}
interface Hit {
  active: boolean;
  target: number;
  age: number;
  /** Away from the Paladin who struck, along the ground. */
  dx: number;
  dz: number;
  /** The Paladin detail read when the blow struck. */
  detail: PaladinVfxDetail;
}

// A heater shield in its quad, p in [-1, 1] with y up: a gently arched top,
// straight sides, then curving in to a point. Signed distance, negative inside.
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
 * Bastion Sweep, a shield bash. Motes of light are drawn in to the Paladin's
 * own shield through the windup, as the shield itself lights up with the
 * Faithwarden's sign (the character's PaladinShieldGlowFx, a glowing layer
 * over the shield they hold). At the impact the shield flares,
 * and the blow drives outlines of the shield out ahead of it, one after another,
 * each wider and fainter; a shockwave rolls across the frontal arc, raising
 * dust. Each enemy struck takes a flare and a shield outline, streaks of the blow and
 * sparks flung away from the Paladin.
 *
 * Detail: core = the first shield outline driven out, the shockwave across
 * the arc and each struck enemy's shield outline; secondary = the outlines
 * following the first and the streaks of the blow; accents = the flares on the
 * shield and on each enemy. Light drops the flares and halves the motes and
 * sparks; minimal drives one outline with a third of them, and both let the
 * shockwave go sooner.
 */
export class BastionSweep {
  private readonly pool: PaladinQuadPool<'bastion_sweep'>;
  private readonly sweeps: Sweep[] = Array.from({ length: SWEEPS }, () => ({
    active: false,
    source: -1,
    age: 0,
    range: 6,
    facing: 0,
    x: 0,
    y: 0,
    z: 0,
    chest: 1,
    hitX: 0,
    hitY: 0,
    hitZ: 0,
    struck: false,
    detail: 'full' as PaladinVfxDetail,
    end: SWEEP_DURATION,
  }));
  private readonly hits: Hit[] = Array.from({ length: SWEEP_HITS }, () => ({
    active: false,
    target: -1,
    age: 0,
    dx: 0,
    dz: 1,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly feet = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private readonly shieldAt = new THREE.Vector3();

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'bastion_sweep', QUADS, {
      helpers: KIT_FLARE_GLSL + SHIELD_GLSL,
      pull: 'aShape>5.5?0.9:(aShape>1.5?0.6:0.35)',
      body: `
        if(vShape>5.5){
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.6);
        } else if(vShape>4.5){
          // An outline of the shield driven out ahead, facing the way of the
          // blow: a hot edge with a soft halo, growing as it goes, and streaks
          // of air thrown off it (t: 0 to 1 of its life).
          float grow=t;
          float size=0.38+0.5*grow;
          float d=heaterShield(p/size)*size;
          float edge=exp(-sq(d/(0.012+0.02*grow)));
          float halo=exp(-sq(d/0.08))*0.3;
          float streak=pow(max(cos(a*14.0),0.0),24.0)*exp(-sq((d-0.05)/0.04))*0.7;
          mask=(edge*1.5+halo+streak)*(1.0-grow)*(1.0-smoothstep(0.9,1.0,max(abs(p.x),abs(p.y))));
          color=mix(vColor,HOT,edge*0.7);
        } else if(vShape>3.5){
          float head=exp(-(sq(vUv.x-0.8)*30.0+vUv.y*vUv.y*6.0));
          mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.7+head;
          color=mix(vColor,HOT,head);
        } else if(vShape>2.5){
          // The struck enemy's mark: a shield outline opening out from them.
          float grow=1.0-sq(max(1.0-clamp(t/0.3,0.0,1.0),0.0));
          float size=0.25+0.7*grow;
          float d=heaterShield(p/size)*size;
          mask=exp(-sq(d/(0.02+0.03*grow)))*1.2*(1.0-grow*0.85)
            *(1.0-smoothstep(0.9,1.0,max(abs(p.x),abs(p.y))));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else {
          // The shockwave across the frontal arc, in the bash's own frame
          // (forward along +x), t seconds after the impact: a double front
          // with dust rolling behind it.
          float th=atan(p.y,p.x);
          // Fully lit out to the sim's edge at 90 degrees either side, gone just past it.
          float arc=1.0-smoothstep(1.5,1.66,abs(th));
          float grow=1.0-sq(max(1.0-clamp(t/0.45,0.0,1.0),0.0));
          float front=0.08+0.9*grow;
          float wave=band(r,front,0.016+0.03*grow)+band(r,front-0.07,0.01+0.015*grow)*0.5;
          float dust=step(r,front)*exp(-(front-r)*7.0)*smoothstep(0.06,0.14,r)
            *(0.55+0.45*sin(th*23.0+r*31.0))*0.3;
          mask=(wave*1.5+dust)*(1.0-grow*0.6)*arc*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,wave*0.7);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** The Paladin bashes out `range` metres across the arc before `facing`
   * (`angle` is the arc in degrees: the sim always sends 180, and the art is
   * drawn lit to 90 degrees either side to match). */
  sweep(source: number, range: number, _angle: number, facing?: number): boolean {
    if (!this.pool.ready() || !this.ctx.anchor(source, 0, this.feet)) return false;
    let slot = this.sweeps.find((s) => !s.active);
    if (!slot) {
      slot = this.sweeps[0];
      for (const s of this.sweeps) if (s.age > slot.age) slot = s;
    }
    slot.active = true;
    slot.source = source;
    slot.age = 0;
    slot.range = Number.isFinite(range) && range > 0 ? range : 6;
    slot.facing = facing ?? this.ctx.facing(source) ?? 0;
    slot.x = this.feet.x;
    slot.y = this.feet.y;
    slot.z = this.feet.z;
    slot.chest = this.ctx.anchor(source, 0.55, this.at) ? this.at.y - this.feet.y : 1;
    slot.struck = false;
    slot.detail = paladinVfxDetailNow();
    slot.end = paladinLingerEnd(
      BASH_IMPACT + 0.3,
      SWEEP_DURATION,
      paladinDetailScale(slot.detail).linger,
    );
    return true;
  }

  /** The bash strikes `target`. */
  strike(target: number): void {
    if (!this.pool.ready()) return;
    let slot = this.hits.find((h) => !h.active);
    if (!slot) {
      slot = this.hits[0];
      for (const h of this.hits) if (h.age > slot.age) slot = h;
    }
    slot.active = true;
    slot.target = target;
    slot.age = 0;
    slot.detail = paladinVfxDetailNow();
    // Knocked away from the Paladin whose bash this is: the newest one.
    let from: Sweep | undefined;
    for (const s of this.sweeps) if (s.active && (!from || s.age < from.age)) from = s;
    slot.dx = from ? Math.sin(from.facing) : 0;
    slot.dz = from ? Math.cos(from.facing) : 1;
    if (from && this.ctx.anchor(target, 0, this.at)) {
      const dx = this.at.x - from.x,
        dz = this.at.z - from.z;
      const length = Math.hypot(dx, dz);
      if (length > 0.2) {
        slot.dx = dx / length;
        slot.dz = dz / length;
      }
    }
  }

  /** Where the Paladin's shield is: the off-hand, or before the chest. */
  private shield(s: Sweep, out: THREE.Vector3): THREE.Vector3 {
    if (this.ctx.hand(s.source, 1, out)) return out;
    const drive = ramp(s.age, 0.2, BASH_IMPACT);
    return out.set(
      s.x + Math.sin(s.facing) * (0.4 + 0.5 * drive),
      s.y + s.chest,
      s.z + Math.cos(s.facing) * (0.4 + 0.5 * drive),
    );
  }

  /** A square standing upright at (x, y, z), facing along the blow. */
  private facingQuad(
    s: Sweep,
    x: number,
    y: number,
    z: number,
    size: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    const fx = Math.sin(s.facing),
      fz = Math.cos(s.facing);
    this.pool.quad(x, y, z, fz * size, 0, -fx * size, 0, size, 0, color, alpha, shape);
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const pool = this.pool;
    pool.begin(this.ctx.camera);
    for (const s of this.sweeps) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.end) {
        s.active = false;
        continue;
      }
      if (this.ctx.anchor(s.source, 0, this.feet)) {
        s.x = this.feet.x;
        s.y = this.feet.y;
        s.z = this.feet.z;
      }
      const t = s.age;
      const since = t - BASH_IMPACT;
      const fx = Math.sin(s.facing),
        fz = Math.cos(s.facing);
      const at = this.shield(s, this.shieldAt);
      if (since >= 0 && !s.struck) {
        s.struck = true;
        s.hitX = at.x + fx * 0.25;
        s.hitY = at.y;
        s.hitZ = at.z + fz * 0.25;
      }
      const scale = paladinDetailScale(s.detail);
      const charge = reduced ? 1 : ramp(t, 0, BASH_IMPACT);
      const motes = paladinDetailCount(MOTES, s.detail);
      if (!reduced && since < 0)
        for (let i = 0; i < motes; i++) {
          // Each mote falls in from wide around the shield.
          const cycle = (t * 3 + hash01(i, 4)) % 1;
          const ang = hash01(i, 1) * Math.PI * 2;
          const rad = 0.9 * (1 - cycle);
          const c = pool.cam;
          const ox = Math.cos(ang) * rad,
            oy = Math.sin(ang) * rad;
          pool.billboard(
            at.x + c[0] * ox + c[3] * oy,
            at.y + c[1] * ox + c[4] * oy,
            at.z + c[2] * ox + c[5] * oy,
            0.05,
            KIT_IVORY,
            charge * Math.sin(cycle * Math.PI) * 1.1,
            SHAPE.mote,
          );
        }
      if (since < 0) continue;
      // The slam: a flare on the shield.
      pool.time = since;
      if (scale.accents)
        pool.billboard(
          s.hitX,
          s.hitY,
          s.hitZ,
          1.0,
          KIT_IVORY,
          Math.exp(-since * 12) * 1.1,
          SHAPE.flare,
        );
      // Outlines of the shield driven out ahead, one after another, wider and fainter.
      const booms = scale.secondary ? BOOMS : 1;
      for (let i = 0; i < booms; i++) {
        const b = since - i * BOOM_GAP;
        if (b <= 0 || b >= BOOM_LIFE) continue;
        const life = b / BOOM_LIFE;
        const out = (1 - (1 - life) ** 2) * (reduced ? 0.3 : 1);
        const ahead = out * s.range * (0.35 + 0.12 * i);
        pool.time = life;
        this.facingQuad(
          s,
          s.hitX + fx * ahead,
          s.hitY - 0.1 * out,
          s.hitZ + fz * ahead,
          0.7 + 1.1 * out + 0.25 * i,
          i ? KIT_GOLD : KIT_WARM,
          1.25 - 0.3 * i,
          SHAPE.boom,
        );
      }
      // The shockwave across the arc, turned so the quad's +x looks forward.
      const floor = this.ctx.groundY(s.x, s.z);
      const y = (Number.isFinite(floor) ? Math.max(floor, s.y - 0.3) : s.y) + 0.05;
      pool.time = since;
      pool.ground(
        s.x,
        y,
        s.z,
        s.range,
        KIT_GOLD,
        1.2 * (1 - ramp(t, BASH_IMPACT + 0.3, s.end)),
        SHAPE.wave,
        Math.PI / 2 - s.facing,
      );
    }
    for (const h of this.hits) {
      if (!h.active) continue;
      h.age += dt;
      if (h.age >= SWEEP_HIT_DURATION || !this.ctx.anchor(h.target, 0.5, this.at)) {
        h.active = false;
        continue;
      }
      const t = h.age;
      const scale = paladinDetailScale(h.detail);
      pool.time = t;
      if (scale.accents)
        pool.billboard(
          this.at.x,
          this.at.y,
          this.at.z,
          1.0,
          KIT_IVORY,
          Math.exp(-t * 10) * 1.3,
          SHAPE.flare,
        );
      pool.billboard(this.at.x, this.at.y, this.at.z, 1.0, KIT_GOLD, 1, SHAPE.ring);
      const motion = reduced ? 0.3 : 1;
      // Streaks of the blow, trailing back toward the Paladin.
      for (let i = 0; scale.secondary && i < STREAKS; i++) {
        const life = 0.18;
        if (t >= life) continue;
        const side = (i - 1) * 0.28,
          rise = (hash01(i, 5) - 0.5) * 0.4;
        const sx = this.at.x + h.dz * side,
          sy = this.at.y + rise,
          sz = this.at.z - h.dx * side;
        const back = 0.9 * (1 - t / life);
        pool.time = 0;
        pool.beam(
          sx - h.dx * back,
          sy,
          sz - h.dz * back,
          sx + h.dx * 0.1,
          sy,
          sz + h.dz * 0.1,
          0.035,
          KIT_WARM,
          (1 - t / life) * 1.1,
          SHAPE.spark,
        );
      }
      // Sparks flung away from the Paladin, falling as they go.
      const sparks = paladinDetailCount(SPARKS, h.detail);
      for (let i = 0; i < sparks; i++) {
        const life = 0.25 + 0.2 * hash01(i, 3);
        if (t >= life) continue;
        const spread = (hash01(i, 9) - 0.5) * 1.6;
        const speed = (3 + 3 * hash01(i, 2)) * motion;
        const ox = h.dx * Math.cos(spread) - h.dz * Math.sin(spread),
          oz = h.dz * Math.cos(spread) + h.dx * Math.sin(spread);
        const vx = ox * speed,
          vy = (0.6 + 2.2 * hash01(i, 7)) * motion,
          vz = oz * speed;
        const sx = this.at.x + vx * t,
          sy = this.at.y + vy * t - 6 * t * t * motion,
          sz = this.at.z + vz * t;
        pool.time = 0;
        pool.beam(
          sx - vx * 0.04,
          sy - (vy - 12 * t * motion) * 0.04,
          sz - vz * 0.04,
          sx,
          sy,
          sz,
          0.03,
          KIT_GOLD,
          (1 - t / life) * 1.2,
          SHAPE.spark,
        );
      }
    }
    pool.end();
  }

  clear(): void {
    for (const s of this.sweeps) s.active = false;
    for (const h of this.hits) h.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

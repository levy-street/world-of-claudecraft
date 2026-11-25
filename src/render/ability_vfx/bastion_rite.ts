import * as THREE from 'three';
import { forgetBastionRiteShield, noteBastionRiteShield } from '../paladin_shield_buffs';
import {
  KIT_FLARE_GLSL,
  KIT_GOLD,
  KIT_IVORY,
  KIT_WARM,
  type PaladinKitContext,
} from './paladin_kit_context';
import { PaladinQuadPool, ramp } from './paladin_quad_pool';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './paladin_spec_icons';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import { type PaladinVfxDetail, paladinDetailScale } from './paladin_vfx_detail_core';

export const BASTIONS = 8;
export const BASTION_SHIELDS = 6;
/** Seconds the shields take to come down into place. */
export const BASTION_LAND = 0.32;
const ORBIT = 1.3;
const SHAPE = { shield: 0, ground: 1, flare: 2, dust: 3 } as const;
const QUADS = BASTIONS * (BASTION_SHIELDS * 2 + 2);

interface Bastion {
  active: boolean;
  id: number;
  presence: number;
  seen: boolean;
  /** Share of the rite still to run. */
  left: number;
  age: number;
  spin: number;
  /** The Paladin detail read when the rite was first seen. */
  detail: PaladinVfxDetail;
}

// A tower shield: flat top with bevelled corners, straight sides drawing in
// to a point, a bright rim, an inner border and the Faithwarden's sign.
// uv.x runs up the shield, uv.y across.
const SHIELD_GLSL = `
  float shieldD(vec2 q){
    float side=abs(q.x)-0.78+max(0.0,0.45-q.y)*0.55;
    float top=q.y-0.95;
    float corner=(abs(q.x)+q.y)-1.6;
    float point=abs(q.x)*0.9-q.y*1.4+0.02;
    return max(max(max(side,top),corner),point);
  }
`;

/**
 * Bastion Rite. Six great tower shields of light, each bearing the
 * Faithwarden's sign, come down out of the air about the Paladin and plant
 * themselves upright in the ground, each with a flash and a ring of dust; for
 * as long as the rite holds they turn slowly about the Paladin on the rune
 * circle at their feet, fading as it runs out. The shield the Paladin holds is blessed with them: it flares as
 * the rite lands and glows with the Faithwarden's sign while it holds (the
 * character's PaladinShieldGlowFx, told of the rite through
 * paladin_shield_buffs.ts).
 *
 * Detail: core = the six tower shields; secondary = the rune circle at their
 * feet and the dust each throws up as it lands; accents = the landing flares.
 * Light drops the flares; minimal draws the shields alone and lets them go
 * sooner when the rite ends.
 */
export class BastionRite {
  private readonly pool: PaladinQuadPool<'bastion_rite'>;
  private readonly bastions: Bastion[] = Array.from({ length: BASTIONS }, () => ({
    active: false,
    id: -1,
    presence: 0,
    seen: false,
    left: 1,
    age: 0,
    spin: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly feet = new THREE.Vector3();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'bastion_rite', QUADS, {
      uniforms: paladinSpecIconUniforms(),
      helpers: KIT_FLARE_GLSL + SHIELD_GLSL + PALADIN_SPEC_ICON_GLSL + PALADIN_RUNE_GLSL,
      pull: 'aShape>1.5?0.5:(aShape>0.5?0.3:0.2)',
      body: `
        if(vShape>2.5){
          // The dust thrown up as a shield lands.
          float grow=1.0-sq(max(1.0-clamp(t/0.4,0.0,1.0),0.0));
          mask=band(r,0.2+0.75*grow,0.06+0.08*grow)*(1.0-grow)*0.9*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.25);
        } else if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>0.5){
          // The rune ring at the feet.
          float c=cos(t*0.25),s=sin(t*0.25);
          vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
          mask=(paladinRuneRing(q,0.7,0.9)*0.85+band(r,0.95,0.01)*0.7)*(1.0-smoothstep(0.97,1.0,r));
          color=mix(vColor,HOT,0.2);
        } else {
          vec2 q=vec2(vUv.y,vUv.x);
          float d=shieldD(q);
          float inside=1.0-smoothstep(-0.01,0.01,d);
          float rim=exp(-abs(d)*42.0);
          float border=exp(-abs(d+0.12)*55.0)*inside;
          float icon=0.0;
          if(uSpecIconsReady>0.5){
            vec3 i3=paladinSpecIcon((q-vec2(0.0,0.52))/vec2(0.55,0.36),1.0);
            icon=1.0-smoothstep(0.0,0.04,i3.y-0.008);
          }
          float sheen=sq(sq(max(0.0,sin(q.y*5.0+q.x*2.0-t*2.0))))*0.4;
          mask=inside*(0.16+sheen)+rim*0.95+border*0.5+icon*inside*0.85;
          color=mix(vColor,HOT,clamp(rim*0.5+icon*0.5+sheen,0.0,1.0));
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** Once a frame while `id` holds Bastion Rite; `left` is the share still to run. */
  hold(id: number, left: number): void {
    if (!this.pool.ready()) return;
    let slot = this.bastions.find((b) => b.active && b.id === id);
    if (!slot) {
      slot = this.bastions.find((b) => !b.active);
      if (!slot) return;
      slot.active = true;
      slot.id = id;
      slot.presence = 0;
      slot.age = 0;
      slot.spin = this.ctx.facing(id) ?? 0;
      slot.detail = paladinVfxDetailNow();
    }
    slot.seen = true;
    slot.left = Number.isFinite(left) ? Math.min(1, Math.max(0, left)) : 1;
    noteBastionRiteShield(id, slot.left);
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    const pool = this.pool;
    bindPaladinSpecIcons(pool.mesh.material);
    pool.begin(this.ctx.camera);
    for (const b of this.bastions) {
      if (!b.active) continue;
      const scale = paladinDetailScale(b.detail);
      b.presence = b.seen
        ? Math.min(1, b.presence + dt * 8)
        : Math.max(0, b.presence - (dt * 3) / scale.linger);
      b.seen = false;
      b.age += dt;
      if (!reduced) b.spin += dt * 0.5;
      if (b.presence <= 0 || !this.ctx.anchor(b.id, 0, this.feet)) {
        b.active = false;
        forgetBastionRiteShield(b.id);
        continue;
      }
      const floor = this.ctx.groundY(this.feet.x, this.feet.z);
      const y = Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y;
      const k = b.presence * Math.min(1, b.left / 0.2 + 0.15);
      pool.time = this.clock;
      if (scale.secondary)
        pool.ground(this.feet.x, y + 0.05, this.feet.z, 1.3, KIT_GOLD, k * 0.9, SHAPE.ground);
      for (let i = 0; i < BASTION_SHIELDS; i++) {
        // Two flank the front, so none stands squarely before the Paladin.
        const ang = b.spin + (i / BASTION_SHIELDS) * Math.PI * 2 + Math.PI / BASTION_SHIELDS;
        const nx = Math.sin(ang),
          nz = Math.cos(ang);
        const tx = Math.cos(ang),
          tz = -Math.sin(ang);
        // Down out of the air, planting in the ground in turn.
        const start = i * 0.05;
        const land = reduced ? 1 : ramp(b.age, start, start + BASTION_LAND);
        const drop = (1 - land * land) * 2.4;
        const h = 0.95,
          half = 0.52;
        const cx = this.feet.x + nx * ORBIT,
          cy = y + h / 2 + drop,
          cz = this.feet.z + nz * ORBIT;
        pool.time = this.clock + i;
        pool.quad(
          cx,
          cy,
          cz,
          0,
          h / 2,
          0,
          tx * half,
          0,
          tz * half,
          KIT_WARM,
          k * land,
          SHAPE.shield,
        );
        const since = b.age - start - BASTION_LAND;
        if (since >= 0 && since < 0.5) {
          pool.time = since;
          if (scale.accents)
            pool.billboard(cx, cy, cz, 0.7, KIT_IVORY, Math.exp(-since * 9) * 1.2, SHAPE.flare);
          if (scale.secondary) pool.ground(cx, y + 0.04, cz, 0.7, KIT_GOLD, 0.8, SHAPE.dust);
        }
      }
    }
    pool.end();
  }

  clear(): void {
    for (const b of this.bastions) {
      if (b.active) forgetBastionRiteShield(b.id);
      b.active = false;
    }
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

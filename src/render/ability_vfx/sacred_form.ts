import * as THREE from 'three';
import {
  KIT_FLARE_GLSL,
  KIT_GOLD,
  KIT_IVORY,
  KIT_WARM,
  type PaladinKitContext,
} from './paladin_kit_context';
import { hash01, PaladinQuadPool, ramp } from './paladin_quad_pool';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './paladin_spec_icons';

export const SACRED_FORMS = 8;
export const SACRED_ENTRANCES = 4;
export const SACRED_ENTRANCE_DURATION = 1.2;
const MOTES = 6;
/** How far over the top of the head the halo floats, and its half-size. */
const HALO_LIFT = 0.28;
const HALO_SIZE = 0.55;
const SHAPE = { glyph: 0, rise: 1, flare: 2, mote: 3, ring: 4, halo: 5 } as const;
const QUADS = SACRED_FORMS * (2 + MOTES) + SACRED_ENTRANCES * 4;

interface Form {
  active: boolean;
  id: number;
  presence: number;
  seen: boolean;
  age: number;
}
interface Entrance {
  active: boolean;
  id: number;
  age: number;
}

/**
 * Sacred Form, the Sunmender's stance. Taking it, light rises up through the
 * Paladin in a column as the Sunmender's sign flares on the ground and a ring
 * opens out. While it is held the sign lies drawn in light at their feet,
 * turning slowly inside a fine ring, with a few motes drifting up: kept faint,
 * since the form is worn the whole time. A sun halo floats level over their
 * head, closing in from wide as the form is taken: a golden ring with short
 * rays round it, unlike Beacon of Light's plain ring.
 */
export class SacredForm {
  private readonly pool: PaladinQuadPool<'sacred_form'>;
  private readonly forms: Form[] = Array.from({ length: SACRED_FORMS }, () => ({
    active: false,
    id: -1,
    presence: 0,
    seen: false,
    age: 0,
  }));
  private readonly entrances: Entrance[] = Array.from({ length: SACRED_ENTRANCES }, () => ({
    active: false,
    id: -1,
    age: 0,
  }));
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private clock = 0;

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'sacred_form', QUADS, {
      uniforms: paladinSpecIconUniforms(),
      helpers: KIT_FLARE_GLSL + PALADIN_SPEC_ICON_GLSL,
      pull: 'aShape>4.5?0.25:(aShape<0.5||aShape>3.5?0.4:0.3)',
      body: `
        if(vShape>4.5){
          // The halo: a golden ring lying level over the head, short rays of
          // light round it, long and short in turn, and a glint running round.
          float c=cos(t*0.35),s=sin(t*0.35);
          vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
          float qa=atan(q.y,q.x);
          const float SECTOR=6.2831853/16.0;
          float cell=floor(qa/SECTOR+0.5);
          float off=abs(qa-cell*SECTOR)*r;
          float reach=mod(cell,2.0)<0.5?0.9:0.8;
          float ray=(1.0-smoothstep(0.012,0.024,off*(1.0+(r-0.7)*3.0)))*smoothstep(0.7,0.72,r)*(1.0-smoothstep(reach-0.04,reach,r));
          float ring=band(r,0.6,0.035)*1.2+band(r,0.6,0.11)*0.3;
          float inner=band(r,0.5,0.008)*0.45;
          float glint=exp(-sq(mod(qa-t*1.4+3.14159,6.2831853)-3.14159)*6.0)*band(r,0.6,0.05);
          mask=(ring+inner+ray*0.75+glint*0.8+exp(-r*r*4.0)*0.06)*(1.0-smoothstep(0.95,1.0,r));
          color=mix(vColor,HOT,band(r,0.6,0.015)*0.6+glint*0.5);
        } else if(vShape>3.5){
          float grow=1.0-sq(max(1.0-clamp(t/0.6,0.0,1.0),0.0));
          mask=band(r,0.15+0.82*grow,0.015+0.03*grow)*(1.0-grow*0.8)*1.3*(1.0-smoothstep(0.97,1.0,r));
          color=mix(vColor,HOT,0.4);
        } else if(vShape>2.5){
          mask=exp(-r*r*7.0)*(1.0-smoothstep(0.7,1.0,r));
          color=mix(vColor,HOT,0.6);
        } else if(vShape>1.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>0.5){
          // The light rising up through the Paladin: a column with a bright
          // band climbing it.
          float climb=clamp(t/0.6,0.0,1.0);
          float across=exp(-vUv.y*vUv.y*4.0);
          float core=exp(-vUv.y*vUv.y*26.0);
          float front=exp(-sq((vUv.x-climb)/0.08))*1.4;
          float below=smoothstep(climb+0.02,climb-0.1,vUv.x);
          mask=((across*0.3+core*0.6)*below+front*across)*smoothstep(0.0,0.08,vUv.x)*smoothstep(1.0,0.82,vUv.x);
          color=mix(vColor,HOT,core*0.6+front*0.4);
        } else {
          // The Sunmender's sign drawn in light at the feet inside a fine ring,
          // turning slowly. Falls back to rings until the icons load.
          float c=cos(t*0.15),s=sin(t*0.15);
          vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
          float ring=band(r,0.9,0.012)*0.9+band(r,0.84,0.006)*0.5;
          float dots=pow(max(cos(atan(q.y,q.x)*12.0),0.0),60.0)*band(r,0.87,0.012)*0.8;
          float line=0.0;
          if(uSpecIconsReady>0.5){
            vec3 icon=paladinSpecIcon(q/0.62,0.0);
            line=1.0-smoothstep(0.0,0.03,icon.y-0.008);
          } else {
            line=band(r,0.45,0.015);
          }
          mask=(ring+dots+line*0.85)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,line*0.35);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** The Paladin takes Sacred Form. */
  enter(id: number): boolean {
    if (!this.pool.ready()) return false;
    let slot = this.entrances.find((e) => !e.active);
    if (!slot) {
      slot = this.entrances[0];
      for (const e of this.entrances) if (e.age > slot.age) slot = e;
    }
    slot.active = true;
    slot.id = id;
    slot.age = 0;
    return true;
  }

  /** Once a frame while `id` holds Sacred Form. */
  hold(id: number): void {
    if (!this.pool.ready()) return;
    let slot = this.forms.find((f) => f.active && f.id === id);
    if (!slot) {
      slot = this.forms.find((f) => !f.active);
      if (!slot) return;
      slot.active = true;
      slot.id = id;
      slot.presence = 0;
      slot.age = 0;
    }
    slot.seen = true;
  }

  private floorAt(): number {
    const floor = this.ctx.groundY(this.feet.x, this.feet.z);
    return (Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y) + 0.04;
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
    const pool = this.pool;
    bindPaladinSpecIcons(pool.mesh.material);
    pool.begin(this.ctx.camera);
    for (const f of this.forms) {
      if (!f.active) continue;
      f.presence = f.seen ? Math.min(1, f.presence + dt * 2) : Math.max(0, f.presence - dt * 3);
      f.seen = false;
      f.age += dt;
      if (
        f.presence <= 0 ||
        !this.ctx.anchor(f.id, 0, this.feet) ||
        !this.ctx.anchor(f.id, 1, this.head)
      ) {
        f.active = false;
        continue;
      }
      const k = f.presence * (0.55 + 0.1 * Math.sin(this.clock * 1.6));
      pool.time = reduced ? 0 : this.clock;
      pool.ground(this.feet.x, this.floorAt(), this.feet.z, 1.4, KIT_GOLD, k, SHAPE.glyph);
      // The halo closes in from wide as the form is taken, then rests,
      // bobbing gently over the head.
      const form = reduced ? 1 : f.presence;
      const bob = reduced ? 0 : Math.sin(this.clock * 1.8) * 0.03;
      pool.ground(
        this.head.x,
        this.head.y + HALO_LIFT + bob,
        this.head.z,
        HALO_SIZE * (1 + 1.4 * (1 - form) * (1 - form)),
        KIT_WARM,
        f.presence * (0.9 + 0.1 * Math.sin(this.clock * 2.3)),
        SHAPE.halo,
      );
      if (reduced) continue;
      for (let i = 0; i < MOTES; i++) {
        const cycle = (this.clock * 0.35 + hash01(i, f.id)) % 1;
        const ang = hash01(i, 2) * Math.PI * 2 + cycle;
        const rad = 0.3 + 0.45 * hash01(i, 3);
        pool.time = 0;
        pool.billboard(
          this.feet.x + Math.cos(ang) * rad,
          this.feet.y + 0.1 + cycle * Math.max(0.8, this.head.y - this.feet.y),
          this.feet.z + Math.sin(ang) * rad,
          0.035,
          KIT_IVORY,
          f.presence * Math.sin(cycle * Math.PI) * 0.6,
          SHAPE.mote,
        );
      }
    }
    for (const e of this.entrances) {
      if (!e.active) continue;
      e.age += dt;
      if (
        e.age >= SACRED_ENTRANCE_DURATION ||
        !this.ctx.anchor(e.id, 0, this.feet) ||
        !this.ctx.anchor(e.id, 1, this.head)
      ) {
        e.active = false;
        continue;
      }
      const t = e.age;
      const height = Math.max(0.8, this.head.y - this.feet.y);
      const fade = 1 - ramp(t, 0.5, SACRED_ENTRANCE_DURATION);
      pool.time = t;
      pool.upright(
        this.feet.x,
        this.feet.y + height * 0.65,
        this.feet.z,
        0.5,
        height * 0.65 + 0.3,
        KIT_WARM,
        fade,
        SHAPE.rise,
      );
      pool.ground(this.feet.x, this.floorAt() + 0.01, this.feet.z, 1.6, KIT_WARM, 1, SHAPE.ring);
      pool.time = reduced ? 0 : this.clock;
      pool.ground(
        this.feet.x,
        this.floorAt() + 0.005,
        this.feet.z,
        1.4 * (1 + 0.3 * Math.exp(-t * 5)),
        KIT_IVORY,
        fade * 1.2,
        SHAPE.glyph,
      );
      pool.time = t;
      pool.billboard(
        this.head.x,
        this.head.y + 0.2,
        this.head.z,
        1.1,
        KIT_IVORY,
        Math.exp(-Math.max(0, t - 0.45) * 7) * ramp(t, 0.35, 0.5) * 1.3,
        SHAPE.flare,
      );
    }
    pool.end();
  }

  clear(): void {
    for (const f of this.forms) f.active = false;
    for (const e of this.entrances) e.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

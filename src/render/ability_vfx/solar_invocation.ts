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

export const INVOCATIONS = 10;
/** The sun kindles over the target, then its light comes down. */
export const INVOKE_KINDLE = 0.14;
/** Seconds after the light comes down that the column narrows away. */
export const INVOKE_HOLD = 0.45;
export const INVOKE_DURATION = 1.15;
/** How high over the target's head the sun kindles. */
const SUN_LIFT = 2.2;
/** The shaft's half-width at the ground: a column over the enemy, narrower
 * than their target ring so it reads as a beam rather than a wall. */
const SHAFT_HALF_WIDTH = 0.85;
const RINGS = 3;
const SPARKS = 12;
/** On an ally: the sun swells, then bursts into this many pluses of healing. */
export const INVOKE_BURST = 0.32;
const PLUSES = 14;
/** Seconds the pluses fly out before they turn home onto the ally. */
const PLUS_OUT = 0.22;
/** Ascension's splash heal: the sun's light runs out across the ground to the
 * heal's true reach this fast after the burst, then holds there. */
export const SPLASH_GROW = 0.3;
/** Allies the splash heals: a glint and rising pluses as the light reaches
 * them. Enemies the offensive splash strikes: a searing glint, no pluses. */
export const SPLASH_GLINTS = 12;
export const SPLASH_GLINT_LIFE = 0.6;
const GLINT_PLUSES = 3;
/** The offensive light: a deep gold, short of orange. */
const SEARING = new THREE.Color(0xffae4a).multiplyScalar(1.15);
const SHAPE = {
  ray: 0,
  sun: 1,
  beam: 2,
  haze: 3,
  ground: 4,
  flare: 5,
  spark: 6,
  ring: 7,
  splash: 8,
  plus: 9,
  burst: 10,
  shock: 11,
  scorch: 12,
  focus: 13,
  reach: 14,
} as const;
const QUADS = INVOCATIONS * (12 + RINGS + SPARKS) + SPLASH_GLINTS * (1 + GLINT_PLUSES);

interface Invocation {
  active: boolean;
  source: number;
  target: number;
  healing: boolean;
  age: number;
  /** Ascension's splash around the target, in yards (0: none): healing
   * allies around an ally, or striking enemies around an enemy. */
  splash: number;
}

interface Glint {
  active: boolean;
  source: number;
  target: number;
  age: number;
  /** When the splash's light reaches them, in seconds after it began. */
  at: number;
  /** An ally healed (pluses) or an enemy struck (a searing glint). */
  healing: boolean;
}

// Smooth value noise, for the light streaming down the column.
const NOISE_GLSL = `
  float siHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float siNoise(vec2 p){
    vec2 i=floor(p),f=fract(p);
    f=f*f*(3.0-2.0*f);
    return mix(mix(siHash(i),siHash(i+vec2(1.0,0.0)),f.x),
      mix(siHash(i+vec2(0.0,1.0)),siHash(i+vec2(1.0,1.0)),f.x),f.y);
  }
  // The column's width at a share of the way down (0 at the sun, 1 at the
  // ground), narrowing away to a thread as it ends.
  float siWidth(float down,float t,float top){
    float collapse=1.0-smoothstep(${INVOKE_HOLD.toFixed(2)},${(INVOKE_HOLD + 0.3).toFixed(2)},t);
    return mix(top,1.0,pow(max(down,0.0),0.7))*mix(0.1,1.0,collapse);
  }
`;

/**
 * Solar Invocation, on either side of the fight. A quick ray of light runs
 * from the Paladin's hand to the target. On an enemy a sun kindles high above
 * them in a flash and a streak of light, then pours a searing golden shaft of
 * sunlight down over them: a column that widens toward the ground, light streaming down it over
 * a white-hot core inside a soft haze, rings of light sliding down it, a splash
 * of light thrown up where it lands over a sunburst on the ground. Then it
 * narrows to a thread and is gone, the strike throwing embers. On an ally
 * the sun instead swells and bursts into pluses of healing that fly out and
 * turn home onto them (burstIntoPluses).
 */
export class SolarInvocation {
  private readonly pool: PaladinQuadPool<'solar_invocation'>;
  private readonly slots: Invocation[] = Array.from({ length: INVOCATIONS }, () => ({
    active: false,
    source: -1,
    target: -1,
    healing: true,
    age: 0,
    splash: 0,
  }));
  private readonly glints: Glint[] = Array.from({ length: SPLASH_GLINTS }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    at: 0,
    healing: true,
  }));
  private readonly from = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();

  constructor(private readonly ctx: PaladinKitContext) {
    this.pool = new PaladinQuadPool(ctx.scene, 'solar_invocation', QUADS, {
      helpers: KIT_FLARE_GLSL + NOISE_GLSL + HEAL_PLUS_GLSL,
      // The column and its splash are drawn over the target they pour onto.
      pull: 'aShape>1.5&&aShape<3.5?0.9:(aShape>7.5?0.7:(aShape>4.5&&aShape<6.5?0.6:0.25))',
      body: `
        if(vShape>13.5){
          // Ascension's splash heal: sunlight running out over the ground to
          // the heal's true reach, its edge held there as a ring.
          float grow=1.0-sq(max(1.0-clamp(t/${SPLASH_GROW.toFixed(2)},0.0,1.0),0.0));
          float edge=0.96*grow;
          float ring=band(r,edge,0.011)*1.3+band(r,edge,0.035)*0.3;
          float wash=exp(-r*r*3.0)*0.18*exp(-t*3.0)*(1.0-smoothstep(edge,edge+0.02,r));
          mask=(ring+wash)*(1.0-smoothstep(0.98,1.0,r));
          color=mix(vColor,HOT,band(r,edge,0.008)*0.6);
        } else if(vShape>12.5){
          // Sunlight focusing on the sun: a ring closing in, rays drawn in with it.
          float close=clamp(t/${(INVOKE_KINDLE + 0.04).toFixed(2)},0.0,1.0);
          float rr=mix(0.95,0.18,close*close);
          float rays=pow(max(cos(a*10.0),0.0),24.0)*smoothstep(rr,rr+0.05,r)*(1.0-smoothstep(rr+0.15,rr+0.35,r));
          mask=(band(r,rr,0.025)*1.3+rays*0.8)*(0.4+0.6*close)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>11.5){
          // Molten cracks racing out from the strike, cooling from white to amber.
          float jag=sin(r*13.0+a*3.0)*0.07+sin(r*31.0-a*5.0)*0.035;
          float cell=(a+jag)*9.0/(2.0*PI);
          float id=floor(cell+0.5);
          float across=abs(fract(cell+0.5)-0.5)*2.0*PI*max(r,0.02)/9.0;
          float len=0.45+0.45*fract(sin(id*12.9898)*43758.5453);
          float width=0.008+0.016*(1.0-r);
          float reach=clamp(t/0.15,0.0,1.0);
          float cracks=(exp(-sq(across/width))+exp(-across/(width*5.0))*0.25)
            *smoothstep(0.05,0.1,r)*(1.0-smoothstep(len*reach-0.06,len*reach,r));
          float heat=exp(-t*2.6);
          mask=cracks*(0.35+1.1*heat)*(1.0-smoothstep(0.55,1.1,t))+exp(-r*r*30.0)*heat*0.8;
          mask*=1.0-smoothstep(0.96,1.0,r);
          color=mix(vec3(1.0,0.62,0.22),HOT,clamp(heat*0.8+exp(-r*r*30.0),0.0,1.0));
        } else if(vShape>10.5){
          // The shockwave as the shaft lands, running out across the ground.
          float grow=1.0-sq(max(1.0-clamp(t/0.32,0.0,1.0),0.0));
          mask=(band(r,0.08+0.9*grow,0.012+0.025*grow)*1.4+band(r,0.08+0.84*grow,0.07)*0.3)
            *(1.0-grow)*(1.0-smoothstep(0.97,1.0,r));
          color=mix(vColor,HOT,0.5);
        } else if(vShape>9.5){
          // The sun bursting: a ring of light thrown out from it.
          float grow=1.0-sq(max(1.0-clamp(t/0.35,0.0,1.0),0.0));
          mask=(band(r,0.15+0.8*grow,0.03+0.06*grow)*1.3+exp(-r*r*8.0)*exp(-t*9.0)*1.2)
            *(1.0-grow*0.8)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,0.55);
        } else if(vShape>8.5){
          // A plus of healing, thrown from the sun.
          mask=healPlusQuad(p);
          color=mix(vColor,HOT,exp(-dot(p,p)*13.5)*0.8);
        } else if(vShape>7.5){
          // The splash where the shaft lands: streaks of light thrown up and
          // falling away, over a bright foot.
          float grow=clamp(t/0.18,0.0,1.0);
          float up=vUv.x;
          float across=vUv.y;
          float streaks=pow(max(0.5+0.5*cos(across*11.0+siNoise(vec2(across*4.0,0.0))*2.0),0.0),6.0);
          float reach=0.25+0.75*grow;
          float rise=smoothstep(reach,reach-0.45,up);
          float foot=exp(-up*up*30.0)*1.2;
          float fade=1.0-smoothstep(0.15,0.55,t);
          mask=(streaks*rise*0.8+foot)*(1.0-smoothstep(0.7,1.0,abs(across)))*fade;
          color=mix(vColor,HOT,foot*0.6+streaks*0.3);
        } else if(vShape>6.5){
          // A ring of light sliding down the column, level with the ground.
          mask=(band(r,0.86,0.04)*1.5+band(r,0.86,0.14)*0.4)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,band(r,0.86,0.02)*0.6);
        } else if(vShape>5.5){
          // A mote or ember: a hot streak along its flight.
          float head=exp(-(sq(vUv.x-0.8)*30.0+vUv.y*vUv.y*6.0));
          mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.7+head;
          color=mix(vColor,HOT,head);
        } else if(vShape>4.5){
          mask=kitFlare(p);
          color=mix(vColor,HOT,exp(-r*r*18.0)+0.2);
        } else if(vShape>3.5){
          // The sunburst on the ground: long and short rays opening out, a
          // ring running out and a hot pool at the heart.
          float grow=1.0-sq(max(1.0-clamp(t/0.4,0.0,1.0),0.0));
          float rays=pow(max(cos(a*12.0),0.0),14.0)*smoothstep(0.2,0.3,r)*(1.0-smoothstep(0.5+0.4*grow,0.6+0.4*grow,r))
            +pow(max(cos(a*12.0+3.14159),0.0),24.0)*smoothstep(0.2,0.28,r)*(1.0-smoothstep(0.38+0.25*grow,0.46+0.25*grow,r))*0.6;
          float ring=band(r,0.2+0.7*grow,0.02+0.03*grow)*(1.0-grow*0.6);
          float pool=exp(-r*r*14.0);
          mask=(rays*0.8+ring*1.2+pool*1.0)*(1.0-smoothstep(0.96,1.0,r));
          color=mix(vColor,HOT,pool+ring*0.4);
        } else if(vShape>1.5){
          // The shaft of sunlight. uv.x runs up the quad: 'down' is the share
          // of the way from the sun to the ground. The haze (shape 3) is the
          // same column, wider and softer.
          bool haze=vShape>2.5;
          float down=1.0-vUv.x;
          float speed=vColor.b<vColor.r*0.35?9.0:6.0;
          float w=siWidth(down,t,haze?0.4:0.22);
          float v=vUv.y/max(w,0.001);
          // The light comes down from the sun.
          float front=clamp(t/0.1,0.0,1.0);
          float shown=smoothstep(front+0.02,front-0.05,down);
          float ends=smoothstep(0.0,0.08,down)*(1.0-smoothstep(0.7,0.98,abs(vUv.y)));
          if(haze){
            mask=exp(-v*v*1.6)*0.3*shown*ends*(0.7+0.5*down);
            color=vColor;
          } else {
            float n=siNoise(vec2(v*2.6,down*3.5-t*speed));
            float n2=siNoise(vec2(v*5.0+7.0,down*6.0-t*speed*1.6));
            float streaks=smoothstep(0.35,0.95,n*0.65+n2*0.35);
            float body=exp(-v*v*2.4)*(0.3+0.7*streaks);
            float rim=exp(-sq((abs(v)-0.8)/0.14))*0.45;
            float core=exp(-v*v*45.0)*(0.85+0.15*sin(down*30.0-t*40.0))*0.7;
            float foot=0.8+0.7*down*down*down;
            float lead=exp(-sq((down-front)/0.05))*step(front,0.999)*exp(-v*v*3.0)*1.5;
            mask=((body*1.0+rim+core*1.3)*foot*shown+lead)*ends;
            color=mix(vColor,HOT,clamp(core+body*0.35+lead,0.0,1.0));
          }
        } else if(vShape>0.5){
          // The sun: a white disc in a corona, long and short rays turning,
          // and a streak of light across it as it kindles.
          float rays=pow(max(cos(a*8.0+t*1.2),0.0),16.0)*smoothstep(0.26,0.32,r)*(1.0-smoothstep(0.55,0.95,r))
            +pow(max(cos(a*8.0+3.14159+t*1.2),0.0),26.0)*smoothstep(0.26,0.3,r)*(1.0-smoothstep(0.42,0.6,r))*0.6;
          float disc=1.0-smoothstep(0.15,0.18,r);
          float corona=exp(-r*r*9.0)*0.55+band(r,0.22,0.02)*1.0;
          float streak=exp(-p.y*p.y*700.0)*exp(-abs(p.x)*2.0)*(0.5+1.4*exp(-t*6.0));
          mask=(disc*1.4+corona+rays*0.9+streak)*(1.0-smoothstep(0.92,1.0,r));
          color=mix(vColor,HOT,disc+band(r,0.22,0.02)*0.6+streak*0.5);
        } else {
          // The quick ray from the Paladin's hand.
          float core=exp(-vUv.y*vUv.y*40.0);
          float along=smoothstep(0.0,0.08,vUv.x)*smoothstep(1.0,0.9,vUv.x);
          mask=(exp(-vUv.y*vUv.y*4.0)*0.35+core)*along;
          color=mix(vColor,HOT,core*0.8);
        }
      `,
    });
  }

  get preparation() {
    return this.pool.preparation;
  }

  /** The invocation lands on `target`, healing an ally or striking an enemy. */
  invoke(source: number, target: number, healing: boolean): boolean {
    if (!this.pool.ready()) return false;
    let slot = this.slots.find((s) => !s.active);
    if (!slot) {
      slot = this.slots[0];
      for (const s of this.slots) if (s.age > slot.age) slot = s;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.healing = healing;
    slot.age = 0;
    slot.splash = 0;
    return true;
  }

  /** Ascension's splash around `center` (an ally healed or an enemy struck)
   * reaches `radius` yards. */
  splash(source: number, center: number, radius: number): boolean {
    let slot: Invocation | null = null;
    for (const s of this.slots)
      if (s.active && s.source === source && s.target === center)
        if (!slot || s.age < slot.age) slot = s;
    if (!slot || !(radius > 0)) return false;
    slot.splash = radius;
    return true;
  }

  /** Whether `source`'s offensive splash is under way: its hits are drawn
   * by the splash (the target's own shaft, glints on the rest). */
  striking(source: number): boolean {
    return this.slots.some((s) => s.active && !s.healing && s.splash > 0 && s.source === source);
  }

  /** One the splash reached (an ally healed or an enemy struck): it glints as
   * the light reaches it. */
  reach(source: number, target: number): boolean {
    if (!this.pool.ready()) return false;
    let slot: Invocation | null = null;
    for (const s of this.slots)
      if (s.active && s.splash > 0 && s.source === source && (!slot || s.age < slot.age)) slot = s;
    if (!slot || slot.target === target) return false;
    if (!this.ctx.anchor(slot.target, 0, this.feet) || !this.ctx.anchor(target, 0, this.head))
      return false;
    const distance = Math.hypot(this.head.x - this.feet.x, this.head.z - this.feet.z);
    let glint = this.glints.find((g) => !g.active);
    if (!glint) {
      glint = this.glints[0];
      for (const g of this.glints) if (g.age > glint.age) glint = g;
    }
    glint.active = true;
    glint.source = source;
    glint.target = target;
    glint.age = slot.age;
    glint.healing = slot.healing;
    const reached = Math.min(1, distance / slot.splash);
    // The heal's light runs out from the sun's burst; the strike's from where
    // the shaft lands.
    const start = slot.healing ? INVOKE_BURST : INVOKE_KINDLE;
    glint.at = start + SPLASH_GROW * (1 - Math.sqrt(1 - reached));
    return true;
  }

  update(dt: number, reduced = false): void {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const pool = this.pool;
    pool.begin(this.ctx.camera);
    const c = pool.cam;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += dt;
      if (
        s.age >= INVOKE_DURATION ||
        !this.ctx.anchor(s.target, 0, this.feet) ||
        !this.ctx.anchor(s.target, 1, this.head) ||
        !this.ctx.anchor(s.target, 0.55, this.chest)
      ) {
        s.active = false;
        continue;
      }
      const t = s.age;
      const tint = s.healing ? KIT_WARM : SEARING;
      const height = Math.max(0.8, this.head.y - this.feet.y);
      const floor = this.ctx.groundY(this.feet.x, this.feet.z);
      const ground = Number.isFinite(floor) ? Math.max(floor, this.feet.y - 0.3) : this.feet.y;
      // The ray from the Paladin's hand.
      if (s.source !== s.target && t < 0.25) {
        if (this.ctx.hand(s.source, 0, this.from) || this.ctx.anchor(s.source, 0.65, this.from)) {
          pool.time = t;
          pool.beam(
            this.from.x,
            this.from.y,
            this.from.z,
            this.chest.x,
            this.chest.y,
            this.chest.z,
            0.09,
            KIT_IVORY,
            (1 - t / 0.25) * 1.1,
            SHAPE.ray,
          );
        }
      }
      if (s.healing) {
        this.burstIntoPluses(t, reduced, ground);
        if (s.splash > 0 && t >= INVOKE_BURST) {
          const since = t - INVOKE_BURST;
          pool.time = reduced ? SPLASH_GROW : since;
          pool.ground(
            this.feet.x,
            ground + 0.05,
            this.feet.z,
            s.splash / 0.96,
            KIT_WARM,
            1 - ramp(since, 0.5, INVOKE_DURATION - INVOKE_BURST),
            SHAPE.reach,
          );
        }
        continue;
      }
      // The sun kindles high above the target.
      const sunY = this.head.y + SUN_LIFT;
      const kindle = reduced ? 1 : ramp(t, 0, INVOKE_KINDLE);
      const fade = 1 - ramp(t, INVOKE_HOLD + 0.2, INVOKE_DURATION);
      pool.time = t;
      pool.billboard(
        this.feet.x,
        sunY,
        this.feet.z,
        1.2 * (0.4 + 0.6 * kindle),
        tint,
        kindle * fade * 1.25,
        SHAPE.sun,
      );
      // Sunlight gathering: a ring closing in on the sun as it kindles.
      if (t < INVOKE_KINDLE + 0.06) {
        pool.time = t;
        pool.billboard(this.feet.x, sunY, this.feet.z, 2.1, tint, 1.2, SHAPE.focus);
      }
      const since = t - INVOKE_KINDLE;
      if (since < 0) continue;
      // Ascension's splash: the searing light runs out over the ground from
      // where the shaft lands to the strike's true reach.
      if (s.splash > 0) {
        pool.time = reduced ? SPLASH_GROW : since;
        pool.ground(
          this.feet.x,
          ground + 0.05,
          this.feet.z,
          s.splash / 0.96,
          tint,
          (1 - ramp(since, 0.5, INVOKE_DURATION - INVOKE_KINDLE)) * 0.85,
          SHAPE.reach,
        );
      }
      // The shaft of sunlight pours down over them.
      const reach = sunY - ground;
      const midY = ground + reach / 2;
      const wide = SHAFT_HALF_WIDTH;
      pool.time = since;
      pool.upright(
        this.feet.x,
        midY,
        this.feet.z,
        wide * 1.5,
        reach / 2,
        tint,
        fade * 0.7,
        SHAPE.haze,
      );
      pool.upright(this.feet.x, midY, this.feet.z, wide, reach / 2, tint, fade * 0.95, SHAPE.beam);
      // Rings of light sliding down the column.
      if (since < INVOKE_HOLD + 0.15) {
        for (let k = 0; k < RINGS; k++) {
          const slide = ((since * (s.healing ? 1.8 : 2.6) + k / RINGS) % 1) ** 1.4;
          const down = Math.max(0.12, slide);
          const radius = wide * (0.22 + 0.78 * down ** 0.7);
          const life =
            Math.sin(slide * Math.PI) * (1 - ramp(since, INVOKE_HOLD - 0.05, INVOKE_HOLD + 0.15));
          pool.time = since;
          pool.ground(
            this.feet.x,
            sunY - reach * down,
            this.feet.z,
            radius * 1.1,
            tint,
            life * 0.9,
            SHAPE.ring,
          );
        }
      }
      // Where it lands: a shockwave across the ground, molten cracks, the
      // sunburst, the splash thrown up and a flare.
      pool.time = since;
      pool.ground(this.feet.x, ground + 0.06, this.feet.z, 3.2, tint, 1, SHAPE.shock);
      pool.ground(this.feet.x, ground + 0.055, this.feet.z, 2, tint, 1, SHAPE.scorch);
      pool.ground(
        this.feet.x,
        ground + 0.05,
        this.feet.z,
        wide * 1.5,
        tint,
        1 - ramp(since, 0.4, 0.9),
        SHAPE.ground,
      );
      pool.upright(
        this.feet.x,
        ground + height * 0.4,
        this.feet.z,
        wide * 1.2,
        height * 0.4,
        KIT_IVORY,
        1.1,
        SHAPE.splash,
      );
      pool.billboard(
        this.chest.x,
        this.chest.y,
        this.chest.z,
        s.healing ? 1.2 : 1.4,
        KIT_IVORY,
        Math.exp(-since * 8) * 1.3,
        SHAPE.flare,
      );
      // Embers: half ride the heat up the column, half are flung from the strike.
      const motion = reduced ? 0.3 : 1;
      for (let i = 0; i < SPARKS; i++) {
        const updraft = i % 2 === 0;
        const life = updraft ? 0.5 + 0.35 * hash01(i, 4) : 0.3 + 0.25 * hash01(i, 4);
        const start = updraft ? hash01(i, 8) * 0.3 : 0;
        const age = since - start;
        if (age < 0 || age >= life) continue;
        const ang = i * 2.399963 + hash01(i, 1);
        let x: number, y: number, z: number, vx: number, vy: number, vz: number;
        if (updraft) {
          // Spiralling up the inside of the column.
          const rad = wide * (0.2 + 0.45 * hash01(i, 2));
          const turn = ang + age * 4;
          vx = -Math.sin(turn) * rad * 4;
          vz = Math.cos(turn) * rad * 4;
          vy = 2.4 + 1.2 * hash01(i, 3);
          x = this.feet.x + Math.cos(turn) * rad;
          z = this.feet.z + Math.sin(turn) * rad;
          y = ground + 0.1 + vy * age * motion;
        } else {
          const speed = 2.5 + 2.5 * hash01(i, 2);
          vx = (c[0] * Math.cos(ang) + c[3] * Math.sin(ang)) * speed;
          vy = (c[1] * Math.cos(ang) + c[4] * Math.sin(ang)) * speed;
          vz = (c[2] * Math.cos(ang) + c[5] * Math.sin(ang)) * speed;
          x = this.chest.x + vx * age * motion;
          y = this.chest.y + (vy * age - 4 * age * age) * motion;
          z = this.chest.z + vz * age * motion;
        }
        const k = 0.035 + 0.025 * hash01(i, 6);
        pool.time = 0;
        pool.beam(
          x - vx * k,
          y - vy * k,
          z - vz * k,
          x,
          y,
          z,
          0.035,
          i % 3 ? KIT_GOLD : SEARING,
          (1 - age / life) * 1.2,
          SHAPE.spark,
        );
      }
    }
    for (const g of this.glints) if (g.active) this.glint(g, dt);
    pool.end();
  }

  /** One the splash reached: an ally glints with pluses rising off them, an
   * enemy is seared by a glint of gold. */
  private glint(g: Glint, dt: number): void {
    g.age += dt;
    const since = g.age - g.at;
    if (since >= SPLASH_GLINT_LIFE || !this.ctx.anchor(g.target, 0.55, this.chest)) {
      g.active = false;
      return;
    }
    if (since < 0) return;
    const pool = this.pool;
    pool.time = since;
    pool.billboard(
      this.chest.x,
      this.chest.y,
      this.chest.z,
      g.healing ? 0.8 : 0.95,
      g.healing ? KIT_WARM : SEARING,
      Math.exp(-since * 7) * 1.1,
      SHAPE.flare,
    );
    if (!g.healing) return;
    const fade = 1 - ramp(since, 0.25, SPLASH_GLINT_LIFE);
    for (let i = 0; i < GLINT_PLUSES; i++) {
      const ang = i * 2.1 + g.target;
      const rise = since * (0.9 + 0.3 * hash01(i, 5));
      pool.time = 0;
      pool.billboard(
        this.chest.x + Math.cos(ang) * 0.3,
        this.chest.y + 0.1 + rise,
        this.chest.z + Math.sin(ang) * 0.3,
        0.13 * HEAL_PLUS_QUAD,
        i % 2 ? KIT_WARM : KIT_IVORY,
        1.1 * fade * Math.min(1, since / 0.06),
        SHAPE.plus,
      );
    }
  }

  /**
   * On an ally the sun does not pour down: it kindles over them, swells, and
   * bursts into pluses of healing that fly out and then turn home onto them,
   * each landing in a glint, the last in a glow about them and a sunburst at
   * their feet.
   */
  private burstIntoPluses(t: number, reduced: boolean, ground: number): void {
    const pool = this.pool;
    const c = pool.cam;
    const sunX = this.feet.x,
      sunY = this.head.y + 1.15,
      sunZ = this.feet.z;
    if (t < INVOKE_BURST) {
      // Kindling, then swelling bright as it gathers to burst.
      const kindle = reduced ? 1 : ramp(t, 0, INVOKE_KINDLE);
      const swell = ramp(t, INVOKE_KINDLE, INVOKE_BURST);
      pool.time = t * (1 + swell * 3);
      pool.billboard(
        sunX,
        sunY,
        sunZ,
        0.6 * (0.4 + 0.6 * kindle) * (1 + 0.35 * swell),
        KIT_WARM,
        kindle * (1.2 + 0.6 * swell),
        SHAPE.sun,
      );
      return;
    }
    const since = t - INVOKE_BURST;
    pool.time = since;
    pool.billboard(sunX, sunY, sunZ, 1.5, KIT_IVORY, Math.exp(-since * 8) * 1.4, SHAPE.flare);
    pool.billboard(sunX, sunY, sunZ, 1.2, KIT_WARM, 1 - ramp(since, 0.2, 0.45), SHAPE.burst);
    let landed = -1;
    const motion = reduced ? 0.4 : 1;
    for (let i = 0; i < PLUSES; i++) {
      const ang = (i / PLUSES) * Math.PI * 2 + (hash01(i, 1) - 0.5) * 0.35;
      const reach = (0.75 + 0.45 * hash01(i, 2)) * motion;
      const home = 0.3 + 0.25 * hash01(i, 3);
      const ux = Math.cos(ang),
        uy = Math.sin(ang);
      // Out from the sun in the view plane, easing to a stop.
      const out = Math.min(1, since / PLUS_OUT);
      const ease = 1 - (1 - out) * (1 - out);
      const ox = sunX + (c[0] * ux + c[3] * uy) * reach * ease,
        oy = sunY + (c[1] * ux + c[4] * uy) * reach * ease,
        oz = sunZ + (c[2] * ux + c[5] * uy) * reach * ease;
      const back = Math.min(1, Math.max(0, (since - PLUS_OUT) / home));
      if (back >= 1) {
        landed = Math.max(landed, since - PLUS_OUT - home);
        continue;
      }
      // Then home onto the ally, falling in faster as it nears.
      const pull = back * back;
      const tx = this.chest.x + (c[0] * ux + c[3] * uy) * 0.18,
        ty = this.chest.y + (c[1] * ux + c[4] * uy) * 0.18,
        tz = this.chest.z + (c[2] * ux + c[5] * uy) * 0.18;
      const lift = Math.sin(back * Math.PI) * 0.25;
      const x = ox + (tx - ox) * pull,
        y = oy + (ty - oy) * pull + lift,
        z = oz + (tz - oz) * pull;
      const size =
        (0.15 + 0.03 * hash01(i, 4)) * (1 - 0.55 * pull) * (0.6 + 0.4 * Math.min(1, since / 0.08));
      pool.time = 0;
      pool.billboard(
        x,
        y,
        z,
        size * HEAL_PLUS_QUAD,
        i % 3 ? KIT_WARM : KIT_IVORY,
        1.25 * (1 - 0.3 * pull),
        SHAPE.plus,
      );
    }
    // Each plus lands in a glint; the light gathers about the ally.
    if (landed >= 0) {
      pool.time = landed;
      pool.billboard(
        this.chest.x,
        this.chest.y,
        this.chest.z,
        1.1,
        KIT_WARM,
        Math.exp(-landed * 5) * 1.1,
        SHAPE.flare,
      );
      pool.ground(
        this.feet.x,
        ground + 0.05,
        this.feet.z,
        1.3,
        KIT_WARM,
        1 - ramp(landed, 0.25, 0.6),
        SHAPE.ground,
      );
    }
  }

  clear(): void {
    for (const s of this.slots) s.active = false;
    for (const g of this.glints) g.active = false;
    this.pool.clear();
  }

  dispose(): void {
    this.pool.dispose();
  }
}

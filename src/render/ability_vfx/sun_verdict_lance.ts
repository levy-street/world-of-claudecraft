import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  SUN_VERDICT_LANCE_CAPACITY,
  SUN_VERDICT_LANCE_DURATION,
  SUN_VERDICT_LANCE_EMBED,
  SUN_VERDICT_LANCE_HOLD,
  SUN_VERDICT_LANCE_LANDING,
  SUN_VERDICT_LANCE_LENGTH,
  SUN_VERDICT_LANCE_RADIUS,
  SUN_VERDICT_LANCE_SHARDS,
  SUN_VERDICT_LANCE_SPARKS,
  SUN_VERDICT_LANCE_VERTICES,
  type SunVerdictShard,
  type SunVerdictSpark,
  sampleSunVerdictShard,
  sampleSunVerdictSpark,
  sunVerdictLanceAlpha,
  sunVerdictLanceTip,
} from '../paladin_sun_verdict_core';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { PALADIN_RUNE_GLSL } from './paladin_runes';

const VERTICES = SUN_VERDICT_LANCE_CAPACITY * SUN_VERDICT_LANCE_VERTICES;
const GOLD = new THREE.Color(0xe8bb76).multiplyScalar(1.3);
const IVORY = new THREE.Color(0xfff1cc).multiplyScalar(1.5);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime'] as const;
const SHAPE = {
  lance: 0,
  streak: 1,
  flare: 2,
  seal: 3,
  spark: 4,
  reticle: 5,
  pillar: 6,
  shard: 7,
} as const;
/** The sword quad spans brand space y 0.95 (point) to -0.95 and x ±1.1, room
 * round the wings for their glow to fade out. */
const BRAND_SPAN = 1.9;
const BRAND_HALF_WIDTH = 0.85;
/** The hilt (wings, gem, grip, pommel) is drawn this much smaller than the
 * blade's scale, anchored at the pommel end: a long blade under a hilt of the
 * same size in the world. */
const HILT_SCALE = 0.75;
/** The planted lance charges, then shatters at this age. */
const SHATTER = SUN_VERDICT_LANCE_LANDING + SUN_VERDICT_LANCE_HOLD;
/** Until the sentence's damage is confirmed the sword holds its point at least
 * this high above the floor (and clear of the target's head). */
export const SUN_VERDICT_LANCE_HOVER = 2.6;
/** A sword whose damage has not arrived by this age (the target died first, so
 * the sim dealt nothing) dissolves in the air. The damage normally rides the
 * cue's own event batch. */
export const SUN_VERDICT_LANCE_WAIT = SUN_VERDICT_LANCE_LANDING;
/** The withheld sword comes apart over this long. */
export const SUN_VERDICT_LANCE_DISSOLVE = 0.35;
const PENDING = 0,
  STRIKE = 1,
  WITHDRAWN = 2;
interface Slot {
  active: boolean;
  age: number;
  landed: boolean;
  x: number;
  y: number;
  z: number;
  radius: number;
  target: number;
  /** PENDING until the damage is confirmed (STRIKE) or refused (WITHDRAWN). */
  verdict: number;
  /** The point's lowest height above the floor while pending. */
  hover: number;
  /** Seconds into dissolving in the air, or -1. */
  dissolve: number;
  /** Where the point hung as it began to dissolve, above the floor. */
  tip: number;
}

/** Seconds into the fall at which the point is down to `height` above the floor. */
function ageAtTip(height: number): number {
  let lo = 0,
    hi = SUN_VERDICT_LANCE_LANDING;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (sunVerdictLanceTip(mid, false) > height) lo = mid;
    else hi = mid;
  }
  return hi;
}

// The Solar Sword drawn as crisp light: a holy greatsword in brand space (y
// runs toward the point). A broad blade with a rune-scribed fuller, a crossguard
// of swept, feathered wings with a gem at their heart and a sun halo behind, a
// wrapped grip and a pointed pommel.
const LANCE_GLSL = `
  const vec2 BLADE[5]=vec2[5](vec2(0.0,0.95),vec2(0.075,0.72),vec2(0.081,-0.43),
    vec2(-0.081,-0.43),vec2(-0.075,0.72));
  float lanceSeg(vec2 p,vec2 a,vec2 b){vec2 e=b-a,w=p-a;return length(w-e*clamp(dot(w,e)/dot(e,e),0.0,1.0));}
  float swordBox(vec2 p,vec2 b,float r){vec2 d=abs(p)-b+r;return length(max(d,0.0))+min(max(d.x,d.y),0.0)-r;}
  // A tapering stroke from a (half-width ra) to b (half-width rb).
  float taper(vec2 p,vec2 a,vec2 b,float ra,float rb){
    vec2 e=b-a,w=p-a;float h=clamp(dot(w,e)/dot(e,e),0.0,1.0);
    return length(w-e*h)-mix(ra,rb,h);
  }
  float bladeDistance(vec2 p){
    float d=1e3; bool inside=false;
    for(int i=0,j=4;i<5;j=i,i++){
      vec2 a=BLADE[i],b=BLADE[j];
      if((a.y>p.y)!=(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
      d=min(d,lanceSeg(p,a,b));
    }
    return inside?-d:d;
  }
  // The winged crossguard: four feathers a side sweeping up and out from the
  // guard, longest at the top, and the bar between them.
  float wingDistance(vec2 p){
    vec2 w=vec2(abs(p.x),p.y);
    float d=swordBox(p-vec2(0.0,-0.28),vec2(0.2,0.04),0.02);
    d=min(d,taper(w,vec2(0.12,-0.3),vec2(0.8,-0.6),0.05,0.012));
    d=min(d,taper(w,vec2(0.13,-0.28),vec2(0.7,-0.44),0.045,0.01));
    d=min(d,taper(w,vec2(0.13,-0.26),vec2(0.58,-0.3),0.04,0.01));
    d=min(d,taper(w,vec2(0.12,-0.24),vec2(0.44,-0.18),0.035,0.01));
    return d;
  }
  // Gem, grip and pommel.
  float hiltDistance(vec2 p){
    float gem=length(p-vec2(0.0,-0.28))-0.07;
    float grip=swordBox(p-vec2(0.0,-0.5),vec2(0.036,0.18),0.015);
    vec2 q=abs(p-vec2(0.0,-0.75));
    float pommel=(q.x/0.08+q.y/0.1-1.0)*0.062;
    return min(gem,min(grip,pommel));
  }
  // Runes scribed down the fuller: a glyph per cell, a stem and a stroke or two.
  float fullerRunes(vec2 p){
    float cell=floor(p.y*16.0);
    vec2 c=vec2(p.x/0.027,fract(p.y*16.0)*2.0-1.0);
    float h=fract(sin(cell*91.7)*4375.85);
    float stem=abs(c.x+0.3*sign(h-0.5));
    float cross=abs(c.y-c.x*(h>0.33?0.8:-0.8));
    float bar=abs(c.y+0.1*(h-0.5)*4.0);
    float g=min(stem,min(cross*0.9,h>0.66?bar:1e3));
    return (1.0-smoothstep(0.1,0.22,g))*step(abs(c.x),1.0)*step(abs(c.y),0.75);
  }
`;

/** One fixed pool/draw, prepared before cast, anchored at the actual sentence
 * target. The Solar Sword: a long holy greatsword of light with feathered
 * wings for a crossguard, turned point down, a reticle closing on the target
 * as it falls on a blazing streak; its point drives deep into the ground with
 * a pillar of light, a great flash, a cracked rune seal and the earth breaking
 * (onImpact), its runes and edges blazing as it charges, then it shatters into
 * shards. */
export class SunVerdictLance {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'sun_verdict_lance'>;
  private readonly slots: Slot[] = Array.from({ length: SUN_VERDICT_LANCE_CAPACITY }, () => ({
    active: false,
    age: 0,
    landed: false,
    x: 0,
    y: 0,
    z: 0,
    radius: SUN_VERDICT_LANCE_RADIUS,
    target: -1,
    verdict: PENDING,
    hover: SUN_VERDICT_LANCE_HOVER,
    dissolve: -1,
    tip: 0,
  }));
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly spark: SunVerdictSpark = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alpha: 0 };
  private readonly shard: SunVerdictShard = { x: 0, y: 0, z: 0, spin: 0, size: 0, alpha: 0 };
  private vertex = 0;
  private time = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly camera?: THREE.Camera,
    /** The sword driving into the ground: crack, shockwaves, dust, stones, shake. */
    private readonly onImpact?: (x: number, y: number, z: number, radius: number) => void,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, data, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aUv', this.uvs, 2],
      ['aShape', this.shapes, 1],
      ['aTime', this.times, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha, aShape, aTime; attribute vec2 aUv;
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        ${GROUND_DEPTH_PULL_GLSL}
        void main() {vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vUv=aUv;
          // Seal and reticle lie on the ground; flare, sparks and shards start
          // inside the sentenced body. Both are pulled forward in depth only.
          bool ground=(aShape>2.5&&aShape<3.5)||(aShape>4.5&&aShape<5.5);
          bool burst=(aShape>1.5&&aShape<2.5)||(aShape>3.5&&aShape<4.5)||aShape>6.5;
          float pull=ground?${GROUND_DEPTH_PULL.toFixed(2)}:burst?0.8:0.0;
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.9,0.68);
        const vec3 AMBER=vec3(0.85,0.42,0.12);
        const float PI=3.14159265;
        float band(float r,float at,float w){float d=(r-at)/w;return exp(-d*d);}
        ${PALADIN_RUNE_GLSL}
        ${LANCE_GLSL}
        float sq(float x){return x*x;}
        void main() {
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float mask;
          vec3 color=vColor;
          if(vShape>6.5){
            // Shard: a diamond of light with a white edge.
            float d=abs(p.x)+abs(p.y);
            mask=(1.0-smoothstep(0.85,1.0,d))*0.7+exp(-abs(d-0.9)*18.0)*0.8;
            color=mix(vColor,HOT,exp(-abs(d-0.9)*18.0));
          } else if(vShape>5.5){
            // Light pillar at the strike: a hot core fading as it rises.
            float across=exp(-vUv.y*vUv.y*5.0);
            mask=(across*0.6+exp(-vUv.y*vUv.y*40.0))*pow(max(1.0-vUv.x,0.0),1.4);
            color=mix(vColor,HOT,exp(-vUv.y*vUv.y*40.0));
          } else if(vShape>4.5){
            // Target reticle: a ring and four chevrons closing on the target.
            float fall=clamp(t/${SUN_VERDICT_LANCE_LANDING.toFixed(2)},0.0,1.0);
            float ringR=mix(0.95,0.3,fall*fall);
            float a=atan(p.y,p.x)+t*3.0;
            float sector=fract(a/(PI*0.5)+0.5)-0.5;
            float chevrons=exp(-sq(sector*7.0))*band(r,ringR+0.12,0.05);
            mask=band(r,ringR,0.025)*1.1+band(r,ringR*0.55,0.015)*0.5+chevrons*1.2+exp(-r*r*60.0)*0.6;
            color=mix(vColor,HOT,0.4);
          } else if(vShape>3.5){
            // Spark streak: hot head, tail trailing back along its flight.
            float head=exp(-((vUv.x-0.85)*(vUv.x-0.85)*30.0+vUv.y*vUv.y*6.0));
            mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.8+head;
            color=mix(vColor,HOT,head);
          } else if(vShape>2.5){
            // Sentence seal: shockwave, light cracks racing out behind it,
            // the shared rune band, and a pool of light at the strike.
            float grow=1.0-pow(max(1.0-clamp(t/0.3,0.0,1.0),0.0),3.0);
            float shock=band(r,0.1+0.85*grow,0.05+0.08*grow)*(1.0-grow*0.7);
            float a=atan(p.y,p.x);
            float cracks=pow(abs(sin(a*9.0+sin(a*23.0)*0.6)),80.0)
              *smoothstep(0.08,0.2,r)*(1.0-smoothstep(grow*0.85,grow*0.95,r))*exp(-t*2.5);
            float stamp=1.0+0.3*exp(-t*20.0);
            float runes=paladinRuneRing(p*stamp,0.8,0.95);
            float pool=exp(-r*r*14.0)*0.6*exp(-t*4.0);
            mask=(shock+cracks*1.2+runes*0.85+pool)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,shock*0.6+pool+cracks*0.5);
          } else if(vShape>1.5){
            // Strike flare: white core with a four-point star.
            float core=exp(-r*r*16.0);
            float spokes=exp(-abs(p.y)*30.0)*exp(-abs(p.x)*1.8)+exp(-abs(p.x)*30.0)*exp(-abs(p.y)*2.4);
            mask=(core*1.5+exp(-r*r*4.0)*0.35+spokes*0.8)*(1.0-smoothstep(0.85,1.0,max(abs(p.x),abs(p.y))));
            color=mix(vColor,HOT,core);
          } else if(vShape>0.5){
            // Comet streak behind the falling lance, flickering as it burns.
            float across=exp(-vUv.y*vUv.y*4.0);
            float core=exp(-vUv.y*vUv.y*30.0);
            float flicker=0.75+0.25*sin(vUv.x*30.0-t*70.0);
            mask=(across*0.55+core)*pow(max(1.0-vUv.x,0.0),1.3)*flicker;
            color=mix(AMBER*1.6,HOT,core+(1.0-vUv.x)*0.3);
          } else {
            // The sword, point down: brand space from the point at the bottom.
            vec2 m=vec2(vUv.y*${BRAND_HALF_WIDTH.toFixed(2)},0.95-vUv.x*${BRAND_SPAN.toFixed(2)});
            float ds=bladeDistance(m);
            // The hilt's own space: the same shapes, smaller, from the pommel end.
            vec2 hm=vec2(m.x/${HILT_SCALE.toFixed(2)},-0.95+(m.y+0.95)/${HILT_SCALE.toFixed(2)});
            float dw=wingDistance(hm)*${HILT_SCALE.toFixed(2)};
            float dh=hiltDistance(hm)*${HILT_SCALE.toFixed(2)};
            float d=min(ds,min(dw,dh));
            float inside=1.0-smoothstep(-0.003,0.003,d);
            float rim=exp(-abs(d)*110.0);
            float blade=1.0-smoothstep(-0.003,0.003,ds);
            float wing=(1.0-smoothstep(-0.003,0.003,dw))*(1.0-blade);
            // White-hot while falling, charging bright just before it shatters.
            float heat=1.0-smoothstep(${SUN_VERDICT_LANCE_LANDING.toFixed(2)},${(SUN_VERDICT_LANCE_LANDING + 0.3).toFixed(2)},t);
            float charge=smoothstep(${(SHATTER - 0.3).toFixed(2)},${SHATTER.toFixed(2)},t);
            // The blade: a bevel catching the light on its left face, a fuller
            // scribed with runes that blaze in turn as energy runs to the point,
            // and a living edge of light rippling down both sides.
            float lit=mix(1.0,0.55,smoothstep(-0.006,0.006,m.x));
            float fuller=exp(-m.x*m.x*2800.0)*blade*step(m.y,0.7)*step(-0.4,m.y);
            float runes=fullerRunes(m)*blade*step(m.y,0.68)*step(-0.38,m.y);
            float wave=0.5+0.5*sin(m.y*20.0-t*14.0);
            float edgeLight=exp(-abs(ds)*60.0)*(0.6+0.4*sin(m.y*70.0-t*30.0))*(0.5+0.5*blade+0.5);
            // The wings: feathers bright at their tips, the hilt gilded, the
            // grip wrapped, the gem burning.
            float tips=smoothstep(0.1,0.7,abs(hm.x));
            float wrap=0.75+0.25*step(0.5,fract((hm.y+0.5)*30.0))*step(abs(hm.x),0.04)*step(-0.68,hm.y)*step(hm.y,-0.33);
            float gem=exp(-length(hm-vec2(0.0,-0.28))*30.0);
            float shade=blade*lit+wing*(0.55+0.45*tips)+(1.0-blade-wing)*0.8*wrap;
            // The sun halo behind the hilt.
            float halo=exp(-sq((length(hm-vec2(0.0,-0.28))-0.24)*60.0))*0.8
              +exp(-length(hm-vec2(0.0,-0.28))*6.0)*0.25;
            float glow=exp(-max(d,0.0)*14.0)*0.4;
            mask=inside*(0.5*shade+0.9*gem)+rim*1.0+fuller*0.6+runes*(0.8+0.8*wave)*(1.0+charge)
              +edgeLight*0.9+glow+halo*(1.0-inside)+charge*inside*0.6;
            color=mix(vColor*shade,HOT,clamp(rim*0.7+runes*0.8+fuller*0.4+gem+heat*0.45+charge+edgeLight*0.4,0.0,1.0));
            color=mix(AMBER*1.4,color,clamp(inside+rim+halo,0.0,1.0));
            // Every glow fades out well inside the quad: no hard edges.
            mask*=(1.0-smoothstep(0.8,0.98,abs(vUv.y)))*(1.0-smoothstep(0.9,0.99,vUv.x));
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'sun-verdict-descending-sword';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(
      scene,
      new Map([['sun_verdict_lance', geometry]]),
      material,
    );
  }

  /** Drops the lance on the sentenced target; an area sentence passes its
   * radius. It holds above the target until `contact` confirms the damage. */
  spawn(target: number, radius = SUN_VERDICT_LANCE_RADIUS): boolean {
    if (
      this.disposed ||
      !this.preparation.ready('sun_verdict_lance') ||
      !this.anchor(target, 0, this.feet)
    )
      return false;
    let slot = this.slots[0];
    for (const candidate of this.slots) {
      if (!candidate.active) {
        slot = candidate;
        break;
      }
      if (candidate.age > slot.age) slot = candidate;
    }
    slot.active = true;
    slot.age = 0;
    slot.landed = false;
    slot.x = this.feet.x;
    slot.z = this.feet.z;
    // The target's feet are the visible floor on docks, bridges and tiers.
    slot.y = effectFloor(this.groundY?.(slot.x, slot.z), this.feet.y);
    slot.radius =
      Number.isFinite(radius) && radius > 0 ? Math.min(radius, 30) : SUN_VERDICT_LANCE_RADIUS;
    slot.target = target;
    slot.verdict = PENDING;
    slot.dissolve = -1;
    const top = this.anchor(target, 1, this.head) ? this.head.y - slot.y + 0.8 : 0;
    slot.hover = Math.min(9, Math.max(SUN_VERDICT_LANCE_HOVER, Number.isFinite(top) ? top : 0));
    return true;
  }

  /** The sentence's authoritative outcome on `target`: a hit (or a ward
   * absorbing it) lets the waiting sword fall and strike; no damage (immune,
   * evaded) dissolves it in the air. False when no sword was waiting. */
  contact(target: number, outcome: 'damage' | 'absorb' | 'none'): boolean {
    let slot: Slot | undefined;
    for (const s of this.slots)
      if (s.active && s.verdict === PENDING && s.target === target && (!slot || s.age < slot.age))
        slot = s;
    if (!slot) return false;
    if (outcome === 'none') {
      slot.verdict = WITHDRAWN;
      return true;
    }
    slot.verdict = STRIKE;
    // Confirmed late: the fall resumes from where it waited.
    slot.age = Math.min(slot.age, ageAtTip(slot.hover));
    return true;
  }

  private put(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    const i = this.vertex++;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.colors[i * 3] = color.r;
    this.colors[i * 3 + 1] = color.g;
    this.colors[i * 3 + 2] = color.b;
    this.alphas[i] = Math.max(0, alpha);
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    this.shapes[i] = shape;
    this.times[i] = this.time;
  }

  /** Quad about a centre: u runs along `a` (0 at -a), v along `b` (-1 to 1). */
  private quad(
    x: number,
    y: number,
    z: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    for (let c = 0; c < 6; c++) {
      const u = CORNERS[c * 2],
        side = CORNERS[c * 2 + 1],
        along = u * 2 - 1;
      this.put(
        x + ax * along + bx * side,
        y + ay * along + by * side,
        z + az * along + bz * side,
        u,
        side,
        color,
        alpha,
        shape,
      );
    }
  }

  update(dt: number, reduced = false): void {
    if (this.disposed) return;
    this.vertex = 0;
    const e = this.camera?.matrixWorld.elements;
    // Camera right (flattened for upright pieces), up and view direction.
    const rx = e ? e[0] : 1,
      rz = e ? e[2] : 0;
    const rl = Math.hypot(rx, rz) || 1;
    const hx = rx / rl,
      hz = rz / rl;
    const cam = e
      ? [e[0], e[1], e[2], e[4], e[5], e[6], -e[8], -e[9], -e[10]]
      : [1, 0, 0, 0, 1, 0, 0, 0, -1];
    const length = SUN_VERDICT_LANCE_LENGTH;
    const lanceHalf = (length / BRAND_SPAN) * BRAND_HALF_WIDTH;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.age += Math.max(0, dt);
      if (s.verdict === PENDING && s.age >= SUN_VERDICT_LANCE_WAIT) s.verdict = WITHDRAWN;
      if (s.verdict === WITHDRAWN) {
        if (s.dissolve < 0) {
          s.dissolve = 0;
          s.tip = Math.max(sunVerdictLanceTip(s.age, reduced), s.hover);
        } else s.dissolve += Math.max(0, dt);
        if (s.dissolve >= SUN_VERDICT_LANCE_DISSOLVE) s.active = false;
        else this.dissolveSword(s, reduced, hx, hz, cam, lanceHalf);
        continue;
      }
      if (s.age >= SUN_VERDICT_LANCE_DURATION) {
        s.active = false;
        continue;
      }
      const age = s.age;
      const alpha = sunVerdictLanceAlpha(age) * (reduced ? 0.7 : 1);
      // Waiting on the damage: the sword never reaches the ground.
      const pending = s.verdict === PENDING;
      const since = pending ? -1 : age - SUN_VERDICT_LANCE_LANDING;
      const landed = since >= 0 ? 1 : 0;
      if (landed && !s.landed) {
        s.landed = true;
        this.onImpact?.(s.x, s.y, s.z, s.radius);
      }
      const drop = sunVerdictLanceTip(age, reduced);
      const tip = s.y + (pending ? Math.max(drop, s.hover) : drop);
      this.time = age;

      // The sword, upright and turned about its axis to face the camera; it
      // vanishes the instant it shatters.
      const intact = age < SHATTER ? 1 : Math.max(0, 1 - (age - SHATTER) / 0.05);
      this.quad(
        s.x,
        tip + length / 2,
        s.z,
        0,
        length / 2,
        0,
        hx * lanceHalf,
        0,
        hz * lanceHalf,
        GOLD,
        alpha * intact,
        SHAPE.lance,
      );

      // Blazing streak above it while it falls.
      const falling = reduced ? 0 : Math.max(0, 1 - age / SUN_VERDICT_LANCE_LANDING);
      this.quad(
        s.x,
        tip + length + 3.5,
        s.z,
        0,
        3.5,
        0,
        hx * 0.7,
        0,
        hz * 0.7,
        GOLD,
        alpha * falling * 1.2,
        SHAPE.streak,
      );

      // Reticle closing on the target during the fall.
      const aim = landed ? 0 : Math.min(1, age / 0.05);
      const reticle = SUN_VERDICT_LANCE_RADIUS;
      this.quad(s.x, s.y + 0.04, s.z, reticle, 0, 0, 0, 0, reticle, GOLD, aim * 0.9, SHAPE.reticle);

      this.time = Math.max(0, since);
      // Pillar of light where it strikes.
      const pillar = landed * Math.exp(-Math.max(0, since) * 7) * (reduced ? 0.7 : 1.7);
      const pillarHalf = 1.6 * (1 - 0.5 * Math.min(1, Math.max(0, since) / 0.3));
      this.quad(
        s.x,
        s.y + 0.04 + 7,
        s.z,
        0,
        7,
        0,
        hx * pillarHalf,
        0,
        hz * pillarHalf,
        IVORY,
        pillar,
        SHAPE.pillar,
      );

      // Strike flare on the blade, clear of the ground.
      const flare = landed * Math.exp(-Math.max(0, since) * 6) * 1.8;
      this.quad(
        s.x,
        s.y + 3.3,
        s.z,
        cam[0] * 3.2,
        cam[1] * 3.2,
        cam[2] * 3.2,
        cam[3] * 3.2,
        cam[4] * 3.2,
        cam[5] * 3.2,
        IVORY,
        flare * (reduced ? 0.6 : 1),
        SHAPE.flare,
      );

      // Sentence seal over the footprint.
      const r = s.radius;
      this.quad(s.x, s.y + 0.04, s.z, r, 0, 0, 0, 0, r, GOLD, landed * alpha, SHAPE.seal);

      // Sparks thrown up and out from the strike.
      const k = this.spark;
      for (let i = 0; i < SUN_VERDICT_LANCE_SPARKS; i++) {
        sampleSunVerdictSpark(i, since, reduced, k);
        let ax = k.vx,
          ay = k.vy,
          az = k.vz;
        const speed = Math.hypot(ax, ay, az) || 1;
        ax /= speed;
        ay /= speed;
        az /= speed;
        const streak = Math.min(0.6, Math.max(0.18, speed * 0.08)) * 0.5;
        // Width across the flight, perpendicular to the view.
        let px = ay * cam[8] - az * cam[7],
          py = az * cam[6] - ax * cam[8],
          pz = ax * cam[7] - ay * cam[6];
        const pl = Math.hypot(px, py, pz) || 1;
        px = (px / pl) * 0.06;
        py = (py / pl) * 0.06;
        pz = (pz / pl) * 0.06;
        this.quad(
          s.x + k.x - ax * streak,
          s.y + 0.8 + k.y - ay * streak,
          s.z + k.z - az * streak,
          ax * streak,
          ay * streak,
          az * streak,
          px,
          py,
          pz,
          i % 2 ? IVORY : GOLD,
          k.alpha * 1.2,
          SHAPE.spark,
        );
      }

      // Shards of the lance flung out when it shatters.
      const shard = this.shard;
      this.time = Math.max(0, age - SHATTER);
      for (let i = 0; i < SUN_VERDICT_LANCE_SHARDS; i++) {
        sampleSunVerdictShard(i, age - SHATTER, reduced, length, shard);
        const c = Math.cos(shard.spin),
          sn = Math.sin(shard.spin);
        const wide = shard.size * 0.55,
          tall = shard.size * 1.3;
        this.quad(
          s.x + shard.x,
          s.y + shard.y,
          s.z + shard.z,
          (cam[0] * c + cam[3] * sn) * wide,
          (cam[1] * c + cam[4] * sn) * wide,
          (cam[2] * c + cam[5] * sn) * wide,
          (cam[3] * c - cam[0] * sn) * tall,
          (cam[4] * c - cam[1] * sn) * tall,
          (cam[5] * c - cam[2] * sn) * tall,
          i % 3 ? GOLD : IVORY,
          shard.alpha * 1.3,
          SHAPE.shard,
        );
      }
    }
    this.mesh.geometry.setDrawRange(0, this.vertex);
    this.mesh.visible = this.vertex > 0;
    if (this.vertex)
      for (const name of ATTRIBUTES) {
        const attr = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, this.vertex * attr.itemSize);
        attr.needsUpdate = true;
      }
  }
  /** A sentence that dealt nothing: the sword hangs where it waited, flickers
   * out and breaks into shards of light that drift up and away, never touching
   * the ground. */
  private dissolveSword(
    s: Slot,
    reduced: boolean,
    hx: number,
    hz: number,
    cam: readonly number[],
    lanceHalf: number,
  ): void {
    const length = SUN_VERDICT_LANCE_LENGTH;
    const k = s.dissolve / SUN_VERDICT_LANCE_DISSOLVE;
    const flicker = reduced ? 1 : 0.75 + 0.25 * Math.sin(s.dissolve * 70);
    const fade = (1 - k) ** 1.5 * flicker * (reduced ? 0.7 : 1);
    const tip = s.y + s.tip;
    this.time = Math.min(s.age, SUN_VERDICT_LANCE_LANDING);
    this.quad(
      s.x,
      tip + length / 2,
      s.z,
      0,
      length / 2,
      0,
      hx * lanceHalf,
      0,
      hz * lanceHalf,
      GOLD,
      fade,
      SHAPE.lance,
    );
    // The reticle lets go of the target.
    const reticle = SUN_VERDICT_LANCE_RADIUS * (1 + k * 0.5);
    this.quad(
      s.x,
      s.y + 0.04,
      s.z,
      reticle,
      0,
      0,
      0,
      0,
      reticle,
      GOLD,
      (1 - k) * 0.5,
      SHAPE.reticle,
    );
    // Its light breaks away in shards that rise rather than fall.
    const shard = this.shard;
    this.time = s.dissolve;
    for (let i = 0; i < SUN_VERDICT_LANCE_SHARDS; i++) {
      sampleSunVerdictShard(i, s.dissolve, true, length, shard);
      const c = Math.cos(shard.spin),
        sn = Math.sin(shard.spin);
      const wide = shard.size * 0.45,
        tall = shard.size;
      const rise = reduced ? 0 : s.dissolve * (1.2 + (i % 3) * 0.5);
      this.quad(
        s.x + shard.x,
        tip + SUN_VERDICT_LANCE_EMBED + shard.y + rise,
        s.z + shard.z,
        (cam[0] * c + cam[3] * sn) * wide,
        (cam[1] * c + cam[4] * sn) * wide,
        (cam[2] * c + cam[5] * sn) * wide,
        (cam[3] * c - cam[0] * sn) * tall,
        (cam[4] * c - cam[1] * sn) * tall,
        (cam[5] * c - cam[2] * sn) * tall,
        i % 3 ? GOLD : IVORY,
        shard.alpha,
        SHAPE.shard,
      );
    }
  }

  clear(): void {
    for (const slot of this.slots) slot.active = false;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [];
    for (const release of [
      () => this.preparation.dispose(),
      () => this.mesh.removeFromParent(),
      () => this.mesh.geometry.dispose(),
      () => this.mesh.material.dispose(),
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Solar Sword cleanup failed');
  }
}

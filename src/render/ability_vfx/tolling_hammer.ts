import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { type SunVerdictSpark, sampleSunVerdictSpark } from '../paladin_sun_verdict_core';
import {
  TOLLING_CAPACITY,
  TOLLING_DROP,
  TOLLING_FADE,
  TOLLING_FLIGHT_LIMIT,
  TOLLING_HOLD,
  TOLLING_SPARKS,
  TOLLING_SPEED,
  TOLLING_TOLL_GAP,
  tollingHeight,
} from '../tolling_hammer_core';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { type PaladinLocalProbe, paladinFlash } from './paladin_flash';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
} from './paladin_vfx_detail_core';

// Detail: core = the falling hammer of light and the ground under it (the
// closing reticle, then the three tolls); secondary = the sky streak behind the
// fall, the pillar of light, the strike flare and the gilded second toll;
// accents = the flare it bursts from the sky in. Sparks scale with the mote
// count; the planted hammer's hold, its burn and the toll's fade scale with the
// linger.

interface Hammer {
  phase: number;
  source: number;
  target: number;
  age: number;
  x: number;
  y: number;
  z: number;
  /** The floor the heavenly hammer strikes. */
  floor: number;
  dx: number;
  dz: number;
  landed: boolean;
  absorbed: boolean;
  /** Ascension empowered it: a greater hammer, a wider toll. */
  gilded: boolean;
  /** How much of the strike draws, read when the hit is confirmed. */
  detail: PaladinVfxDetail;
}
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime', 'aAux'] as const;
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const GOLD = new THREE.Color(0xe8bb76).multiplyScalar(1.3);
/** The hammer of light's colour, shared with Hammer of Grace (grace_hammer.ts). */
export const LIGHT_HAMMER_GOLD = GOLD;
const IVORY = new THREE.Color(0xfff1cc).multiplyScalar(1.5);
const SHAPE = { hammer: 0, beam: 2, flare: 3, spark: 4, ground: 5 } as const;
/** Hammer space spans x ±0.6 and y -1.05 (striking face) to 1.05 (pommel). */
export const HAMMER_HALF_WIDTH = 0.6;
export const HAMMER_HALF_LENGTH = 1.05;
/** The thrown hammer and the heavenly one, as half lengths of hammer space. */
export const THROWN_SCALE = 0.6;
const SKY_SCALE = 2.2;
/** Reach of the toll ring and the struck ground. Hammer of Wrath strikes one
 * enemy, so the toll stays close about it rather than reading as an area. */
const TOLL_RADIUS = 2.2;
/** Hammer, trail, release flare in flight; hammer, sky flare, streak,
 * ground, pillar, strike flare and sparks from the sky. */
const QUADS_PER_HAMMER = 7 + TOLLING_SPARKS;

// The light-forged hammer as signed distances: a broad head flaring toward
// its striking face, a collar, a long shaft and a diamond pommel.
const HAMMER_GLSL = `
  float hBox(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.0))+min(max(d.x,d.y),0.0);}
  float hHead(vec2 p){
    vec2 q=p-vec2(0.0,-0.74);
    float hy=0.2+0.08*smoothstep(0.18,0.46,abs(q.x));
    return max(abs(q.x)-0.5,abs(q.y)-hy)-0.025;
  }
  float hRest(vec2 p){
    float collar=hBox(p-vec2(0.0,-0.41),vec2(0.14,0.06))-0.012;
    float shaft=hBox(p-vec2(0.0,0.3),vec2(0.05,0.66));
    vec2 q=p-vec2(0.0,0.99);
    float pommel=abs(q.x)+abs(q.y)-0.075;
    return min(collar,min(shaft,pommel));
  }
  float hHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
`;

/**
 * The hammer of light, drawn on a quad whose uv.x runs from the striking face
 * (0) to the pommel (1) and uv.y across: bevelled head with an inset panel and
 * the sun on its face, a white-hot striking face, a wrapped grip. `heat` warms
 * the face. Hammer of Wrath and Hammer of Grace throw the same hammer.
 */
export const LIGHT_HAMMER_GLSL = `
  ${HAMMER_GLSL}
  void lightHammer(vec2 uv,vec3 base,float heat,out float mask,out vec3 color,
      out vec2 h,out float d,out float inside,out float glow){
    const vec3 LH_HOT=vec3(1.0,0.9,0.68);
    h=vec2(uv.y*${HAMMER_HALF_WIDTH.toFixed(2)},-${HAMMER_HALF_LENGTH.toFixed(2)}+uv.x*${(2 * HAMMER_HALF_LENGTH).toFixed(2)});
    float dh=hHead(h);
    d=min(dh,hRest(h));
    inside=1.0-smoothstep(-0.004,0.004,d);
    float rim=exp(-abs(d)*90.0);
    // Soft glow, faded out before the quad's edges so none is clipped.
    glow=exp(-max(d,0.0)*14.0)*0.45
      *(1.0-smoothstep(0.5,0.6,abs(h.x)))*(1.0-smoothstep(0.95,1.05,abs(h.y)));
    float onHead=step(dh,0.0);
    vec2 q=h-vec2(0.0,-0.74);
    float panel=exp(-abs(hBox(q,vec2(0.3,0.12)))*150.0)*onHead;
    float er=length(q);
    float emblem=((1.0-smoothstep(0.07,0.082,er))+exp(-abs(er-0.12)*130.0)
      +pow(max(cos(atan(q.y,q.x)*8.0),0.0),24.0)*smoothstep(0.12,0.14,er)*(1.0-smoothstep(0.18,0.21,er)))*onHead;
    float wraps=step(abs(h.x),0.052)*step(0.42,h.y)*step(h.y,0.88)*pow(abs(sin(h.y*42.0)),6.0);
    float lit=mix(1.0,0.5,smoothstep(-0.35,0.45,h.x));
    float face=exp(-max(0.5-abs(q.x),0.0)*14.0)*onHead;
    mask=inside*(0.28*lit+wraps*0.4+panel*0.7+emblem*0.9+face*heat)+rim*0.95+glow*0.8;
    color=mix(base*lit,LH_HOT,clamp(rim*0.7+emblem+panel*0.4+face*heat+heat*0.2,0.0,1.0));
  }
`;

/**
 * Hammer of Wrath, the Tolling Hammer: a hammer of light hurled head first
 * with a comet trail; on the confirmed hit a giant twin
 * bursts from the sky above the target and falls head first on a closing
 * reticle. It strikes like a bell: three tolls ring out across the ground
 * behind a pillar of light, cracks and sparks, and the planted hammer charges
 * and then burns away into embers. One prewarmed pool, no textures, nothing
 * allocated per frame.
 */
export class TollingHammer {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'tolling_hammer'>;
  private readonly slots: Hammer[] = Array.from({ length: TOLLING_CAPACITY }, () => ({
    phase: 0,
    source: -1,
    target: -1,
    age: 0,
    x: 0,
    y: 0,
    z: 0,
    floor: 0,
    dx: 0,
    dz: 1,
    landed: false,
    absorbed: false,
    gilded: false,
    detail: 'full',
  }));
  private readonly capacity = QUADS_PER_HAMMER * 6 * TOLLING_CAPACITY;
  private readonly positions = new Float32Array(this.capacity * 3);
  private readonly colors = new Float32Array(this.capacity * 3);
  private readonly alphas = new Float32Array(this.capacity);
  private readonly uvs = new Float32Array(this.capacity * 2);
  private readonly shapes = new Float32Array(this.capacity);
  private readonly times = new Float32Array(this.capacity);
  private readonly auxes = new Float32Array(this.capacity);
  private readonly origin = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly spark: SunVerdictSpark = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alpha: 0 };
  private readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  private vertex = 0;
  private time = 0;
  private aux = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly land: (
      x: number,
      y: number,
      z: number,
      dx: number,
      dz: number,
      absorbed: boolean,
      detail: PaladinVfxDetail,
    ) => void,
    private readonly groundY: (x: number, z: number) => number,
    private readonly hand?: (id: number, out: THREE.Vector3) => boolean,
    private readonly camera?: THREE.Camera,
    private readonly isLocal?: PaladinLocalProbe,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aUv', this.uvs, 2],
      ['aShape', this.shapes, 1],
      ['aTime', this.times, 1],
      ['aAux', this.auxes, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha, aShape, aTime, aAux; attribute vec2 aUv;
        varying vec3 vColor; varying float vAlpha, vShape, vTime, vAux; varying vec2 vUv;
        ${GROUND_DEPTH_PULL_GLSL}
        void main(){vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vAux=aAux;vUv=aUv;
          // The struck ground lies on the floor: pulled forward in depth only.
          float pull=aShape>4.5?${GROUND_DEPTH_PULL.toFixed(2)}:0.0;
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime, vAux; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.9,0.68);
        const vec3 AMBER=vec3(0.85,0.42,0.12);
        const float PI=3.14159265;
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${PALADIN_RUNE_GLSL}
        ${LIGHT_HAMMER_GLSL}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float a=atan(p.y,p.x);
          float mask;
          vec3 color=vColor;
          if(vShape>4.5){
            if(t<0.0){
              // Reticle closing on the target while the hammer falls.
              float f=clamp(1.0+t/${TOLLING_DROP.toFixed(2)},0.0,1.0);
              float ringR=mix(0.55,0.16,f*f);
              float sector=fract(a/(PI*0.5)+f*0.5)-0.5;
              float ticks=exp(-sq(sector*9.0))*band(r,ringR+0.07,0.025);
              mask=(band(r,ringR,0.018)*0.9+ticks*0.9)*f+exp(-r*r*70.0)*f*f*0.8;
              color=mix(vColor,HOT,0.35);
            } else {
              // The toll: three rings of light ring out one after another,
              // cracks race through the ground, the rune band flashes and a
              // pool of light burns at the heart.
              float tolls=0.0;
              for(int k=0;k<3;k++){
                float tk=t-float(k)*${TOLLING_TOLL_GAP.toFixed(2)};
                if(tk<0.0) continue;
                float g=1.0-sq(max(1.0-clamp(tk/0.5,0.0,1.0),0.0));
                tolls+=(band(r,0.1+0.88*g,0.016+0.03*g)+band(r,0.1+0.88*g-0.05,0.05)*0.25)
                  *(1.0-g)*(1.0-0.22*float(k));
              }
              float jag=sin(r*13.0+a*3.0)*0.07+sin(r*31.0-a*5.0)*0.035;
              float cell=(a+jag)*7.0/(2.0*PI);
              float id=floor(cell+0.5);
              float across=abs(fract(cell+0.5)-0.5)*2.0*PI*max(r,0.02)/7.0;
              float len=0.3+0.25*fract(sin(id*12.9898)*43758.5453);
              float width=0.008+0.014*(1.0-r);
              float reach=clamp(t/0.14,0.0,1.0);
              float cracks=(exp(-sq(across/width))+exp(-across/(width*5.0))*0.25)
                *smoothstep(0.03,0.08,r)*(1.0-smoothstep(len*reach-0.06,len*reach,r));
              float heat=exp(-t*4.0);
              cracks*=(0.3+0.7*heat)*(1.0-smoothstep(0.45,0.8,t));
              float runes=paladinRuneRing(p*1.7,0.8,0.95)*exp(-t*4.0)*smoothstep(0.02,0.08,t)*0.9;
              float pool=exp(-r*r*40.0)*exp(-t*3.0)*1.1;
              mask=tolls*1.2+cracks*1.3+runes+pool;
              mask*=1.0-smoothstep(0.96,1.0,r);
              color=mix(vColor,HOT,clamp(tolls*0.5+pool+cracks*heat,0.0,1.0));
              color=mix(color,vec3(1.0,0.45,0.12),cracks*(1.0-heat)*0.6);
            }
          } else if(vShape>3.5){
            // Spark streak: hot head, tail trailing back along its flight.
            float head=exp(-(sq(vUv.x-0.85)*30.0+vUv.y*vUv.y*6.0));
            mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.8+head;
            color=mix(vColor,HOT,head);
          } else if(vShape>2.5){
            // Flare: white core, soft halo and a four-point star.
            float core=exp(-r*r*18.0);
            float spokes=exp(-abs(p.y)*34.0)*exp(-abs(p.x)*1.6)+exp(-abs(p.x)*34.0)*exp(-abs(p.y)*1.9);
            mask=(core*1.5+exp(-r*r*4.0)*0.3*(1.0-smoothstep(0.6,1.0,r))+spokes*0.9*(1.0-smoothstep(0.3,0.95,r)))*(1.0-smoothstep(0.5,1.0,r));
            color=mix(vColor,HOT,core+spokes*0.3);
          } else if(vShape>1.5){
            // Beam: trail, sky streak and pillar. Hot core, energy running along.
            float across=exp(-vUv.y*vUv.y*4.0);
            float core=exp(-vUv.y*vUv.y*40.0);
            float along=smoothstep(0.0,0.04,vUv.x)*pow(max(1.0-vUv.x,0.0),1.2);
            float flow=0.78+0.22*sin(vUv.x*24.0-t*36.0);
            mask=(across*0.45+core)*along*flow;
            color=mix(vColor,HOT,core*0.9);
          } else {
            // The hammer of light. vTime is its heat; vAux burns it away into embers.
            vec2 h;
            float d, inside, glow;
            lightHammer(vUv,vColor,t,mask,color,h,d,inside,glow);
            // Burn away from the edges in: embers glow along the front.
            float n=hHash(floor(h*26.0))*0.8+0.2*(1.0-smoothstep(0.0,0.6,-d));
            float burnt=smoothstep(vAux-0.02,vAux,n);
            float ember=exp(-abs(n-vAux)*40.0)*step(0.001,vAux);
            mask=mask*burnt+ember*(inside+glow)*1.5;
            color=mix(color,vec3(1.0,0.55,0.18),ember);
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    material.name = 'tolling_hammer:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'tolling-hammer';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['tolling_hammer', geometry]]), material);
  }

  launch(source: number, target: number): boolean {
    if (this.disposed || source === target || !this.preparation.ready('tolling_hammer'))
      return false;
    if (!this.anchor(source, 0.65, this.origin) || !this.anchor(target, 0.65, this.aim))
      return false;
    this.hand?.(source, this.origin);
    const s = this.slots.find((slot) => slot.phase === 0);
    if (!s) return false;
    s.phase = 1;
    s.source = source;
    s.target = target;
    s.age = 0;
    s.x = this.origin.x;
    s.y = this.origin.y;
    s.z = this.origin.z;
    const d = Math.hypot(this.aim.x - s.x, this.aim.z - s.z) || 1;
    s.dx = (this.aim.x - s.x) / d;
    s.dz = (this.aim.z - s.z) / d;
    s.landed = false;
    s.absorbed = false;
    s.gilded = false;
    return true;
  }

  /** Ascension empowered `source`'s hammer: it falls gilded. The charge is
   * spent as the hurled hammer strikes, so this finds it in flight or just
   * beginning its fall from the sky. */
  gild(source: number): boolean {
    let slot: Hammer | null = null;
    for (const s of this.slots)
      if (
        s.source === source &&
        (s.phase === 1 || (s.phase === 2 && s.age < 0.2)) &&
        (!slot || s.age < slot.age)
      )
        slot = s;
    if (!slot) return false;
    slot.gilded = true;
    return true;
  }

  /** The target's feet are the visible floor on docks, bridges and tiers. */
  private floorUnder(target: number): boolean {
    if (!this.anchor(target, 0, this.aim)) return false;
    const floor = effectFloor(this.groundY(this.aim.x, this.aim.z), this.aim.y);
    if (!Number.isFinite(floor)) return false;
    this.aim.y = floor;
    return true;
  }

  /** Only the authoritative primary outcome may call this; travel never predicts a hit. */
  contact(source: number, target: number, outcome: 'damage' | 'absorb' | 'none'): boolean {
    if (this.disposed) return false;
    let s = this.slots.find(
      (slot) => slot.phase === 1 && slot.source === source && slot.target === target,
    );
    if (outcome === 'none') {
      if (s) s.phase = 0;
      return false;
    }
    if (!this.preparation.ready('tolling_hammer') || !this.floorUnder(target)) return false;
    if (!s) {
      s = this.slots.find((slot) => slot.phase === 0);
      if (s) s.gilded = false;
    }
    if (!s) return false;
    const x = this.aim.x,
      z = this.aim.z,
      floor = this.aim.y;
    if (this.anchor(source, 0.55, this.origin)) {
      const d = Math.hypot(x - this.origin.x, z - this.origin.z) || 1;
      s.dx = (x - this.origin.x) / d;
      s.dz = (z - this.origin.z) / d;
    }
    s.phase = 2;
    s.source = source;
    s.target = target;
    s.age = 0;
    s.x = x;
    s.z = z;
    s.floor = s.y = floor;
    s.absorbed = outcome === 'absorb';
    s.landed = false;
    s.detail = paladinVfxDetailNow();
    return true;
  }

  cancelEntity(id: number): void {
    for (const s of this.slots)
      if (s.phase === 1 && (s.source === id || s.target === id)) s.phase = 0;
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
    this.auxes[i] = this.aux;
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
    if (!(alpha > 0.002)) return;
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
    this.aux = 0;
  }

  private flare(x: number, y: number, z: number, size: number, alpha: number): void {
    const c = this.cam;
    this.quad(
      x,
      y,
      z,
      c[0] * size,
      c[1] * size,
      c[2] * size,
      c[3] * size,
      c[4] * size,
      c[5] * size,
      IVORY,
      alpha,
      SHAPE.flare,
    );
  }

  update(dt: number, reduced: boolean): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.vertex = 0;
    const e = this.camera?.matrixWorld.elements;
    const c = this.cam;
    if (e) {
      c[0] = e[0];
      c[1] = e[1];
      c[2] = e[2];
      c[3] = e[4];
      c[4] = e[5];
      c[5] = e[6];
      c[6] = -e[8];
      c[7] = -e[9];
      c[8] = -e[10];
    }
    // Camera right flattened, for upright pieces.
    const rl = Math.hypot(c[0], c[2]) || 1;
    const hx = c[0] / rl,
      hz = c[2] / rl;
    for (const s of this.slots) {
      if (!s.phase) continue;
      s.age += dt;
      if (s.phase === 1) {
        if (
          s.age > TOLLING_FLIGHT_LIMIT ||
          !this.anchor(s.source, 0.65, this.origin) ||
          !this.anchor(s.target, 0.65, this.aim)
        ) {
          s.phase = 0;
          continue;
        }
        const dx = this.aim.x - s.x,
          dy = this.aim.y - s.y,
          dz = this.aim.z - s.z;
        const distance = Math.hypot(dx, dz),
          step = Math.min(distance, TOLLING_SPEED * dt);
        if (distance > 0.01) {
          s.dx = dx / distance;
          s.dz = dz / distance;
        }
        const k = distance > 0 ? step / distance : 1;
        s.x += dx * k;
        s.z += dz * k;
        s.y += dy * k;
        // The throw is unseen: nothing flies from the Paladin. Its slot keeps
        // the flight's timing and heading for the heavenly hammer, which only
        // falls once the hit is confirmed (contact).
      } else {
        this.fall(s, reduced, hx, hz);
      }
    }
    for (const name of ATTRIBUTES) {
      const a = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      if (this.vertex) {
        a.addUpdateRange(0, this.vertex * a.itemSize);
        a.needsUpdate = true;
      }
    }
    if (this.preparation.ready('tolling_hammer')) this.mesh.geometry.setDrawRange(0, this.vertex);
    this.mesh.visible = this.vertex > 0;
  }

  /** The heavenly hammer: out of the sky, head first, and the toll. */
  private fall(s: Hammer, reduced: boolean, hx: number, hz: number): void {
    // Follow the recipient during descent, then pin to its contact location.
    if (!s.landed && this.floorUnder(s.target)) {
      s.x = this.aim.x;
      s.z = this.aim.z;
      s.floor = s.y = this.aim.y;
    }
    if (!s.landed && s.age >= TOLLING_DROP) {
      s.landed = true;
      this.land(s.x, s.floor, s.z, s.dx, s.dz, s.absorbed, s.detail);
    }
    const detail = s.detail;
    const scale = paladinDetailScale(detail);
    const fade = paladinDetailLinger(TOLLING_FADE, detail),
      hold = paladinDetailLinger(TOLLING_HOLD, detail);
    if (s.age >= TOLLING_DROP + fade) {
      s.phase = 0;
      return;
    }
    const since = s.age - TOLLING_DROP;
    const weak = s.absorbed ? 0.55 : 1;
    const alpha = Math.min(1, s.age / 0.06) * weak;
    const gild = s.gilded ? 1.2 : 1;
    const len = HAMMER_HALF_LENGTH * SKY_SCALE * gild,
      wide = HAMMER_HALF_WIDTH * SKY_SCALE * gild;
    // The heavenly hammer falls from the sky head first, accelerating, and
    // its head meets the ground at the strike. Upright, turned to the view.
    const bottom = s.floor + 0.015 + tollingHeight(s.age, reduced);
    const fall = 1 - Math.min(1, s.age / TOLLING_DROP);
    // White-hot at the strike, charging, then burnt away from the edges.
    const after = Math.max(0, since);
    const strike = since >= 0 ? Math.exp(-after * 6) : 0;
    const charge = since >= 0 ? Math.max(0, Math.min(1, (after - hold * 0.4) / (hold * 0.6))) : 0;
    this.time = Math.min(1, 0.25 + (1 - fall) * 0.2 + strike * 0.8 + charge * 0.5);
    this.aux = since >= hold ? Math.min(1, (since - hold) / paladinDetailLinger(0.35, detail)) : 0;
    this.quad(
      s.x,
      bottom + len,
      s.z,
      0,
      len,
      0,
      hx * wide,
      0,
      hz * wide,
      GOLD,
      alpha,
      SHAPE.hammer,
    );
    if (!reduced && scale.secondary) {
      // It bursts out of the sky in a flash, trailing a streak as it falls.
      const sky = s.floor + tollingHeight(0, false) + len;
      if (scale.accents) this.flare(s.x, sky, s.z, 3.4, Math.max(0, 1 - s.age / 0.2) * 1.3 * weak);
      this.time = s.age;
      const top = bottom + 2 * len;
      const streak = 6 * (since < 0 ? 1 - fall * 0.4 : 0);
      this.quad(
        s.x,
        top - 0.6 + streak / 2,
        s.z,
        0,
        streak / 2,
        0,
        hx * wide * 0.55,
        0,
        hz * wide * 0.55,
        GOLD,
        (since < 0 ? 0.35 + 0.65 * (1 - fall) : 0) * weak,
        SHAPE.beam,
      );
    }
    // The ground: a reticle while it falls, then the toll.
    const r = TOLL_RADIUS * (s.absorbed ? 0.6 : 1) * (s.gilded ? 1.15 : 1);
    this.time = since;
    const ground =
      since < 0 ? Math.min(1, s.age / 0.05) : 1 - Math.max(0, (after - fade * 0.7) / (fade * 0.3));
    this.quad(s.x, s.floor + 0.03, s.z, r, 0, 0, 0, 0, r, GOLD, ground * weak, SHAPE.ground);
    if (since < 0) return;
    // Gilded by Ascension: a second toll rolls out just behind the first
    // (more damage, the same single target).
    if (s.gilded && since > 0.08 && scale.secondary) {
      this.time = since - 0.08;
      this.quad(
        s.x,
        s.floor + 0.035,
        s.z,
        r * 1.25,
        0,
        0,
        0,
        0,
        r * 1.25,
        GOLD,
        ground * weak * 0.9,
        SHAPE.ground,
      );
    }
    // A pillar of light and a flare at the strike, sparks thrown out. The
    // strike's flash builds and peaks under the shared limit (paladin_flash.ts).
    this.time = s.age;
    if (scale.secondary) {
      const flash = paladinFlash(since, this.isLocal?.(s.source) ?? true);
      const pillar = Math.exp(-after * 7) * (reduced ? 0.5 : 0.9) * weak * flash;
      const pillarHalf = 1.2 * (1 - 0.5 * Math.min(1, after / 0.3));
      this.quad(
        s.x,
        s.floor + 7.03,
        s.z,
        0,
        7,
        0,
        hx * pillarHalf,
        0,
        hz * pillarHalf,
        IVORY,
        pillar,
        SHAPE.beam,
      );
      this.flare(s.x, s.floor + 0.9, s.z, 3.2 * gild, Math.exp(-after * 9) * 1.2 * weak * flash);
    }
    if (reduced) return;
    const k = this.spark,
      c = this.cam;
    const sparks = paladinDetailCount(TOLLING_SPARKS, detail);
    for (let i = 0; i < sparks; i++) {
      sampleSunVerdictSpark(i, since, false, k);
      if (k.alpha <= 0) continue;
      let ax = k.vx,
        ay = k.vy,
        az = k.vz;
      const speed = Math.hypot(ax, ay, az) || 1;
      ax /= speed;
      ay /= speed;
      az /= speed;
      const streak = Math.min(0.6, Math.max(0.18, speed * 0.08)) * 0.5;
      let px = ay * c[8] - az * c[7],
        py = az * c[6] - ax * c[8],
        pz = ax * c[7] - ay * c[6];
      const pl = Math.hypot(px, py, pz) || 1;
      px = (px / pl) * 0.06;
      py = (py / pl) * 0.06;
      pz = (pz / pl) * 0.06;
      this.quad(
        s.x + k.x * 1.3 - ax * streak,
        s.floor + 0.5 + k.y - ay * streak,
        s.z + k.z * 1.3 - az * streak,
        ax * streak,
        ay * streak,
        az * streak,
        px,
        py,
        pz,
        i % 2 ? IVORY : GOLD,
        k.alpha * 1.2 * weak,
        SHAPE.spark,
      );
    }
  }

  clear(): void {
    for (const s of this.slots) s.phase = 0;
    this.mesh.visible = false;
    if (this.preparation.ready('tolling_hammer')) this.mesh.geometry.setDrawRange(0, 0);
  }
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    this.preparation.dispose();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

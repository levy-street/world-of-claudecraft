import * as THREE from 'three';
import { PROJECTILE_SPEED } from '../../sim/projectile_travel';
import { headFirstTurn } from '../tolling_hammer_core';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { HEAL_PLUS_GLSL, HEAL_PLUS_QUAD } from './heal_plus';
import {
  HAMMER_HALF_LENGTH,
  HAMMER_HALF_WIDTH,
  LIGHT_HAMMER_GLSL,
  LIGHT_HAMMER_GOLD,
  THROWN_SCALE,
} from './tolling_hammer';

export const GRACE_CAPACITY = 8;
export const GRACE_SPEED = PROJECTILE_SPEED;
export const GRACE_FLIGHT_LIMIT = 3;
/** The hammer stamps into the enemy, flashes white and shatters this long after the hit. */
export const GRACE_STAMP = 0.16;
/** The shards hang in the burst this long before the first sets off home. */
export const GRACE_SCATTER = 0.3;
/** Each shard leaves this long after the one before it. */
export const GRACE_STAGGER = 0.03;
/** A shard's flight home. */
export const GRACE_RETURN = 0.55;
/** From the first shard home: the grace spirals up round the Paladin and fades. */
export const GRACE_BLOOM = 0.85;
export const GRACE_DURATION = GRACE_SCATTER + GRACE_RETURN + GRACE_BLOOM;
/** Shards of grace the hammer breaks into: gold pluses (healing) and sky sparks
 * (mana), alternating. An absorbed blow breaks into half as many. */
export const GRACE_MOTES = 10;
export const GRACE_BLOOM_PLUSES = 4;
/** Segments per strand of the twin helix trailing the hammer, and of the one
 * rising round the Paladin. */
export const GRACE_TRAIL_SEGMENTS = 8;
export const GRACE_HELIX_SEGMENTS = 14;
/** Sparkles the trail sheds. */
const TRAIL_SPARKS = 4;
/** Ghosts behind each shard on its way home. */
const MOTE_GHOSTS = 3;

/** In flight: hammer, release flare and ring, trail, the helix, sparkles.
 * After the hit: flare, rays, two rings, the hammer, the shards and their
 * ghosts, the arrival flash, and the bloom (ring, helix, rising pluses). */
const FLIGHT_QUADS = 5 + 2 * GRACE_TRAIL_SEGMENTS + TRAIL_SPARKS;
const STRIKE_QUADS =
  5 + GRACE_MOTES * (1 + MOTE_GHOSTS) + 1 + 1 + 2 * GRACE_HELIX_SEGMENTS + GRACE_BLOOM_PLUSES;
const QUADS = Math.max(FLIGHT_QUADS, STRIKE_QUADS);
const VERTICES = GRACE_CAPACITY * QUADS * 6;

const IVORY = new THREE.Color(0xfff4d8).multiplyScalar(1.4);
const GOLD = new THREE.Color(0xecc27c).multiplyScalar(1.3);
const SKY = new THREE.Color(0xa8dcff).multiplyScalar(1.4);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime'] as const;
export const GRACE_SHAPE = {
  hammer: 0,
  mote: 1,
  beam: 2,
  flare: 3,
  plus: 4,
  ring: 5,
  strand: 6,
  rays: 7,
  spark: 8,
} as const;
const SHAPE = GRACE_SHAPE;

interface Grace {
  /** 0 free, 1 in flight, 2 struck (shattered, grace returning). An absorbed
   * blow shatters too, but heals nothing, so no grace returns. */
  phase: number;
  source: number;
  target: number;
  age: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  absorbed: boolean;
}

function ramp(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

/**
 * Hammer of Grace: the hammer of light Hammer of Wrath throws
 * (tolling_hammer.ts), hurled head first with a twin helix of gold and sky
 * trailing it, healing and mana. On the confirmed hit it stamps into the
 * enemy under a starburst and two rings, flashes white and shatters into
 * shards of grace. The shards hang a breath, then braid home one by one, gold
 * pluses for the healing and sky sparks for the mana, and the grace spirals up
 * round the Paladin as it lands. Travel never predicts a hit; only the
 * authoritative outcome plays the strike.
 */
export class GraceHammer {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'grace_hammer'>;
  private readonly slots: Grace[] = Array.from({ length: GRACE_CAPACITY }, () => ({
    phase: 0,
    source: -1,
    target: -1,
    age: 0,
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dz: 1,
    absorbed: false,
  }));
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly origin = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly pointA = new THREE.Vector3();
  private readonly pointB = new THREE.Vector3();
  private readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  private vertex = 0;
  private time = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly camera?: THREE.Camera,
    private readonly hand?: (id: number, out: THREE.Vector3) => boolean,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aUv', this.uvs, 2],
      ['aShape', this.shapes, 1],
      ['aTime', this.times, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
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
        void main(){vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vUv=aUv;
          vec4 view=modelViewMatrix*vec4(position,1.0);
          // What plays at a body is pulled toward the camera (depth only, not
          // screen position) so the silhouette cannot swallow it. The trail and
          // the strands keep their depth: the helix winds behind the Paladin.
          float pull=(aShape>1.5&&aShape<2.5)||(aShape>5.5&&aShape<6.5)?0.0:0.6;
          view.xyz*=max(0.05,1.0-pull/max(length(view.xyz),0.001));
          gl_Position=projectionMatrix*view;}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.95,0.82);
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${HEAL_PLUS_GLSL}
        ${LIGHT_HAMMER_GLSL}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float a=atan(p.y,p.x);
          float mask;
          vec3 color=vColor;
          if(vShape>7.5){
            // A spark of mana: a small four-point twinkle.
            float d=abs(p.x)+abs(p.y);
            float star=exp(-abs(p.x)*14.0)*exp(-abs(p.y)*3.0)+exp(-abs(p.y)*14.0)*exp(-abs(p.x)*3.0);
            mask=(exp(-d*7.0)*1.2+star*0.8)*(1.0-smoothstep(0.7,1.0,r));
            color=mix(vColor,HOT,exp(-d*10.0)*0.8);
          } else if(vShape>6.5){
            // The starburst of the blow: eight long rays, eight short between.
            float spokes=pow(abs(cos(a*4.0)),24.0);
            float thin=pow(abs(sin(a*4.0)),60.0)*0.5*(1.0-smoothstep(0.1,0.6,r));
            mask=(spokes+thin)*(1.0-smoothstep(0.15,1.0,r))*smoothstep(0.0,0.1,r)+exp(-r*r*16.0)*0.8;
            color=mix(vColor,HOT,spokes*0.5);
          } else if(vShape>5.5){
            // A strand of grace: a thin ribbon, light flowing along it.
            float across=exp(-vUv.y*vUv.y*3.5);
            float core=exp(-vUv.y*vUv.y*30.0);
            float flow=0.65+0.35*sin(vUv.x*24.0-t*18.0);
            mask=(across*0.45+core*1.1)*flow;
            color=mix(vColor,HOT,core*0.8);
          } else if(vShape>4.5){
            // Ring: a soft halo opening out.
            float grow=1.0-sq(max(1.0-clamp(t/0.4,0.0,1.0),0.0));
            mask=(band(r,0.25+0.7*grow,0.05+0.05*grow)*(1.0-grow*0.7)+exp(-r*r*10.0)*exp(-t*6.0)*0.6)
              *(1.0-smoothstep(0.95,1.0,r));
            color=mix(vColor,HOT,0.4);
          } else if(vShape>3.5){
            // The healing plus.
            mask=healPlusQuad(p);
            color=mix(vColor,HOT,exp(-dot(p,p)*13.5)*0.8);
          } else if(vShape>2.5){
            // Flare: white core, round halo, a soft four-point star.
            float core=exp(-r*r*18.0);
            float spokes=exp(-abs(p.y)*30.0)*exp(-abs(p.x)*2.0)+exp(-abs(p.x)*30.0)*exp(-abs(p.y)*2.2);
            mask=(core*1.5+exp(-r*r*5.0)*0.35*(1.0-smoothstep(0.6,1.0,r))+spokes*0.7*(1.0-smoothstep(0.3,0.95,r)))*(1.0-smoothstep(0.5,1.0,r));
            color=mix(vColor,HOT,core+spokes*0.3);
          } else if(vShape>1.5){
            // Trail: soft sheet, hot core, fading back along the flight.
            float across=exp(-vUv.y*vUv.y*4.0);
            float core=exp(-vUv.y*vUv.y*36.0);
            float along=smoothstep(0.0,0.04,vUv.x)*pow(max(1.0-vUv.x,0.0),1.2);
            mask=(across*0.45+core)*along;
            color=mix(vColor,HOT,core*0.8);
          } else if(vShape>0.5){
            // A mote: a hot point in a soft glow.
            float core=exp(-r*r*22.0);
            mask=(core*1.3+exp(-r*r*5.0)*0.45)*(1.0-smoothstep(0.7,1.0,r));
            color=mix(vColor,HOT,core*0.7);
          } else {
            // The hammer of light, the same as Hammer of Wrath's. vTime is its heat.
            vec2 h;
            float d, inside, glow;
            lightHammer(vUv,vColor,t,mask,color,h,d,inside,glow);
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'grace-hammer';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['grace_hammer', geometry]]), material);
  }

  throw(source: number, target: number): boolean {
    if (this.disposed || source === target || !this.preparation.ready('grace_hammer')) return false;
    if (!this.anchor(source, 0.65, this.origin) || !this.anchor(target, 0.6, this.aim))
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
    s.absorbed = false;
    return true;
  }

  /** Only the authoritative outcome plays the strike; 'none' retires the throw. */
  contact(source: number, target: number, outcome: 'damage' | 'absorb' | 'none'): boolean {
    if (this.disposed) return false;
    let s = this.slots.find(
      (slot) => slot.phase === 1 && slot.source === source && slot.target === target,
    );
    if (outcome === 'none') {
      if (s) s.phase = 0;
      return false;
    }
    if (!this.preparation.ready('grace_hammer') || !this.anchor(target, 0.6, this.aim))
      return false;
    if (!s) s = this.slots.find((slot) => slot.phase === 0);
    if (!s) return false;
    if (this.anchor(source, 0.6, this.origin)) {
      const d = Math.hypot(this.aim.x - this.origin.x, this.aim.z - this.origin.z) || 1;
      s.dx = (this.aim.x - this.origin.x) / d;
      s.dz = (this.aim.z - this.origin.z) / d;
    }
    s.phase = 2;
    s.source = source;
    s.target = target;
    s.age = 0;
    s.absorbed = outcome === 'absorb';
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
  }

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
    if (!(alpha > 0.002) || this.vertex + 6 > VERTICES) return;
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

  /** Camera-facing square of half-size `size`, turned by `spin`. */
  private billboard(
    x: number,
    y: number,
    z: number,
    size: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
    spin = 0,
  ): void {
    const c = this.cam;
    // A plus's quad leaves room round it for its glow to fade out.
    const half = shape === SHAPE.plus ? size * HEAL_PLUS_QUAD : size;
    const cs = Math.cos(spin) * half,
      sn = Math.sin(spin) * half;
    this.quad(
      x,
      y,
      z,
      c[0] * cs + c[3] * sn,
      c[1] * cs + c[4] * sn,
      c[2] * cs + c[5] * sn,
      c[3] * cs - c[0] * sn,
      c[4] * cs - c[1] * sn,
      c[5] * cs - c[2] * sn,
      color,
      alpha,
      shape,
    );
  }

  /** One length of ribbon from `a` to `b`, turned to the camera, `w0` and
   * `w1` wide at its ends, `u0` to `u1` along it. */
  private ribbon(
    a: THREE.Vector3,
    b: THREE.Vector3,
    w0: number,
    w1: number,
    u0: number,
    u1: number,
    color: THREE.Color,
    alpha0: number,
    alpha1: number,
    shape: number,
  ): void {
    if (!(Math.max(alpha0, alpha1) > 0.002) || this.vertex + 6 > VERTICES) return;
    const c = this.cam;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    let px = dy * c[8] - dz * c[7],
      py = dz * c[6] - dx * c[8],
      pz = dx * c[7] - dy * c[6];
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl;
    py /= pl;
    pz /= pl;
    for (let k = 0; k < 6; k++) {
      const end = CORNERS[k * 2],
        side = CORNERS[k * 2 + 1];
      const p = end ? b : a,
        w = end ? w1 : w0;
      this.put(
        p.x + px * w * side,
        p.y + py * w * side,
        p.z + pz * w * side,
        end ? u1 : u0,
        side,
        color,
        end ? alpha1 : alpha0,
        shape,
      );
    }
  }

  /** The hammer in the view plane, turned by `spin`, at `scale` of hammer space. */
  private hammer(
    x: number,
    y: number,
    z: number,
    spin: number,
    scale: number,
    heat: number,
    alpha: number,
  ): void {
    const c = this.cam;
    const cs = Math.cos(spin),
      sn = Math.sin(spin);
    const len = HAMMER_HALF_LENGTH * scale,
      wide = HAMMER_HALF_WIDTH * scale;
    this.time = heat;
    this.quad(
      x,
      y,
      z,
      (c[3] * cs + c[0] * sn) * len,
      (c[4] * cs + c[1] * sn) * len,
      (c[5] * cs + c[2] * sn) * len,
      (c[0] * cs - c[3] * sn) * wide,
      (c[1] * cs - c[4] * sn) * wide,
      (c[2] * cs - c[5] * sn) * wide,
      LIGHT_HAMMER_GOLD,
      alpha,
      SHAPE.hammer,
    );
  }

  update(dt: number, reduced = false): void {
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
    for (const s of this.slots) {
      if (!s.phase) continue;
      s.age += dt;
      if (s.phase === 1) this.fly(s, dt, reduced);
      else this.strike(s, reduced);
    }
    this.mesh.geometry.setDrawRange(0, this.vertex);
    this.mesh.visible = this.vertex > 0;
    for (const name of ATTRIBUTES) {
      const attr = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      if (this.vertex) {
        attr.addUpdateRange(0, this.vertex * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
  }

  /** A point on the helix trailing the hammer, `back` behind it on strand `strand`. */
  private trailPoint(
    s: Grace,
    back: number,
    length: number,
    strand: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const phase = back * 4.5 - s.age * 16 + strand * Math.PI;
    const r = 0.24 * Math.min(1, back / 0.5 + 0.15) * (1 - 0.5 * (back / length));
    const across = Math.cos(phase) * r;
    return out.set(
      s.x - s.dx * back - s.dz * across,
      s.y + Math.sin(phase) * r,
      s.z - s.dz * back + s.dx * across,
    );
  }

  private fly(s: Grace, dt: number, reduced: boolean): void {
    if (
      s.age > GRACE_FLIGHT_LIMIT ||
      !this.anchor(s.source, 0.65, this.origin) ||
      !this.anchor(s.target, 0.6, this.aim)
    ) {
      s.phase = 0;
      return;
    }
    const dx = this.aim.x - s.x,
      dy = this.aim.y - s.y,
      dz = this.aim.z - s.z;
    const distance = Math.hypot(dx, dz),
      step = Math.min(distance, GRACE_SPEED * dt);
    if (distance > 0.01) {
      s.dx = dx / distance;
      s.dz = dz / distance;
    }
    const k = distance > 0 ? step / distance : 1;
    s.x += dx * k;
    s.z += dz * k;
    s.y += dy * k;
    // Retire the visible hammer on arrival; the slot waits briefly for the outcome.
    if (distance - step <= 0.6) return;
    // Head first along the flight, never spinning.
    this.hammer(s.x, s.y, s.z, headFirstTurn(this.cam, s.dx, s.dz), THROWN_SCALE, 0.35, 1);
    // The release: a flare and a ring of light at the hand.
    const release = Math.max(0, 1 - s.age / 0.15);
    this.billboard(this.origin.x, this.origin.y, this.origin.z, 0.9, SKY, release, SHAPE.flare);
    this.time = s.age;
    this.billboard(
      this.origin.x,
      this.origin.y,
      this.origin.z,
      0.75,
      GOLD,
      1 - ramp(s.age, 0.12, 0.32),
      SHAPE.ring,
    );
    if (reduced) return;
    const c = this.cam;
    const trail = Math.min(s.age * GRACE_SPEED, 3.2);
    const half = trail / 2;
    const px = -s.dz * c[7],
      py = s.dz * c[6] - s.dx * c[8],
      pz = s.dx * c[7];
    const pl = Math.hypot(px, py, pz) || 1;
    this.time = s.age;
    this.quad(
      s.x - s.dx * half,
      s.y,
      s.z - s.dz * half,
      -s.dx * half,
      0,
      -s.dz * half,
      (px / pl) * 0.2,
      (py / pl) * 0.2,
      (pz / pl) * 0.2,
      GOLD,
      0.55,
      SHAPE.beam,
    );
    // Twin strands wind round the flight: gold, the healing; sky, the mana.
    if (trail < 0.05) return;
    const n = GRACE_TRAIL_SEGMENTS;
    for (let strand = 0; strand < 2; strand++) {
      const color = strand ? SKY : GOLD;
      for (let j = 0; j < n; j++) {
        const b0 = (trail * j) / n,
          b1 = (trail * (j + 1)) / n;
        this.ribbon(
          this.trailPoint(s, b0, trail, strand, this.pointA),
          this.trailPoint(s, b1, trail, strand, this.pointB),
          0.065 * (1 - j / n) + 0.015,
          0.065 * (1 - (j + 1) / n) + 0.015,
          b0,
          b1,
          color,
          0.95 * (1 - j / n),
          0.95 * (1 - (j + 1) / n),
          SHAPE.strand,
        );
      }
    }
    // Sparkles shed along the way, drifting off the line.
    for (let i = 0; i < TRAIL_SPARKS; i++) {
      const back = 0.45 + i * 0.7;
      if (back >= trail) break;
      const fall = back / trail;
      const p = this.trailPoint(s, back, trail, i % 2, this.pointA);
      this.billboard(
        p.x,
        p.y + fall * 0.25,
        p.z,
        0.13,
        i % 2 ? SKY : GOLD,
        0.9 * (1 - fall),
        i % 2 ? SHAPE.spark : SHAPE.plus,
        s.age * 4 + i,
      );
    }
  }

  private strike(s: Grace, reduced: boolean): void {
    if (s.age >= GRACE_DURATION || !this.anchor(s.target, 0.6, this.aim)) {
      s.phase = 0;
      return;
    }
    const t = s.age;
    const weak = s.absorbed ? 0.55 : 1;
    const motion = reduced ? 0.3 : 1;
    const c = this.cam;
    const x = this.aim.x,
      y = this.aim.y,
      z = this.aim.z;
    // The blow: a white flare, a starburst and two rings, gold then sky.
    this.time = t;
    this.billboard(x, y, z, 1.2, IVORY, Math.exp(-t * 14) * 1.3 * weak, SHAPE.flare);
    this.billboard(
      x,
      y,
      z,
      2.1,
      GOLD,
      Math.exp(-t * 4) * weak * (1 - ramp(t, 0.22, 0.45)),
      SHAPE.rays,
      t * 0.8 * motion,
    );
    this.billboard(x, y, z, 1.3, GOLD, weak * (1 - ramp(t, 0.16, 0.36)), SHAPE.ring);
    if (t >= 0.08) {
      this.time = t - 0.08;
      this.billboard(x, y, z, 1.8, SKY, weak * 0.8 * (1 - ramp(t, 0.24, 0.46)), SHAPE.ring);
    }
    // The hammer stamps in, flashes white and shatters.
    if (t < GRACE_STAMP) {
      const u = t / GRACE_STAMP;
      this.hammer(
        x - s.dx * 0.3 * (1 - u),
        y,
        z - s.dz * 0.3 * (1 - u),
        headFirstTurn(this.cam, s.dx, s.dz),
        THROWN_SCALE * (1 + 0.3 * ramp(u, 0, 0.7)),
        0.6 + 0.8 * u,
        weak * (1 - ramp(u, 0.55, 1)),
      );
    }
    const home = this.anchor(s.source, 0.6, this.origin);
    const tx = this.origin.x,
      ty = this.origin.y,
      tz = this.origin.z;
    // Across the way home, level: the shards fan out to either side of it.
    let sx = -(tz - z),
      sz = tx - x;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const count = s.absorbed ? GRACE_MOTES / 2 : GRACE_MOTES;
    let landed = -1;
    for (let i = 0; i < count; i++) {
      const gold = i % 2 === 0;
      const color = gold ? GOLD : SKY;
      const shape = gold ? SHAPE.plus : SHAPE.spark;
      const size = gold ? 0.2 : 0.24;
      // Burst out in the view plane, round the blow.
      const ang = (i / count) * Math.PI * 2 + 0.35;
      const reach = (0.6 + 0.3 * ((i * 7) % 3)) * motion;
      const ox = Math.cos(ang) * reach,
        oy = Math.sin(ang) * reach;
      const start = GRACE_SCATTER + i * GRACE_STAGGER;
      const out = 1 - Math.exp(-Math.min(t, start) * 9);
      const qx = x + (c[0] * ox + c[3] * oy) * out,
        qy = y + (c[1] * ox + c[4] * oy) * out,
        qz = z + (c[2] * ox + c[5] * oy) * out;
      // A blow wholly absorbed heals nothing (the sim heals on damage dealt):
      // its shards gutter out where they hang and never go home.
      const gutter = s.absorbed ? 1 - ramp(t, start, start + 0.25) : 1;
      if (t < start || (s.absorbed && gutter > 0)) {
        // Hanging in the burst, twinkling.
        if (t > GRACE_STAMP * 0.5)
          this.billboard(
            qx,
            qy,
            qz,
            size * (1 + 0.2 * Math.sin(t * 30 + i)),
            color,
            weak * gutter * Math.min(1, (t - GRACE_STAMP * 0.5) * 14),
            shape,
            t * 3 + i,
          );
        continue;
      }
      if (!home || s.absorbed) continue;
      const v = (t - start) / GRACE_RETURN;
      if (v >= 1) {
        landed = Math.max(landed, start + GRACE_RETURN);
        continue;
      }
      // Home along a bow, lifted and swung out to its own side: the shards
      // braid in from both sides.
      const side = (gold ? 1 : -1) * (0.7 + 0.35 * ((i >> 1) % 3)) * motion;
      const lift = 1.1 + 0.4 * ((i * 5) % 3) * 0.5;
      const mx = (qx + tx) / 2 + sx * side,
        my = Math.max(qy, ty) + lift,
        mz = (qz + tz) / 2 + sz * side;
      for (let g = MOTE_GHOSTS; g >= 0; g--) {
        const e = ramp(v - g * 0.045, 0, 1);
        if (g > 0 && v - g * 0.045 <= 0) continue;
        const q = 1 - e;
        const px = q * q * qx + 2 * q * e * mx + e * e * tx,
          py = q * q * qy + 2 * q * e * my + e * e * ty,
          pz = q * q * qz + 2 * q * e * mz + e * e * tz;
        this.billboard(
          px,
          py,
          pz,
          g ? size * (1 - 0.22 * g) : size * 1.15,
          color,
          weak * (g ? 0.75 - 0.2 * g : 1),
          g ? SHAPE.mote : shape,
          t * 3 + i,
        );
      }
    }
    if (!home || s.absorbed) return;
    // Each shard lands with a flash.
    if (landed >= 0 && t - landed < 0.3) {
      this.billboard(
        tx,
        ty,
        tz,
        0.45,
        IVORY,
        Math.exp(-(t - landed) * 12) * weak * 0.55,
        SHAPE.flare,
      );
    }
    // Home: a ring opens on the Paladin, the grace spirals up round them, and
    // small pluses rise.
    const since = t - GRACE_SCATTER - GRACE_RETURN;
    if (since < 0) return;
    const fade = 1 - ramp(since, GRACE_BLOOM * 0.55, GRACE_BLOOM);
    this.time = since;
    this.billboard(tx, ty, tz, 0.85, SKY, weak * 0.7 * (1 - ramp(since, 0.15, 0.4)), SHAPE.ring);
    const foot = this.anchor(s.source, 0.04, this.pointA)?.y ?? ty - 1.1;
    const crown = this.anchor(s.source, 1.0, this.pointB)?.y ?? ty + 0.8;
    const head = ramp(since / 0.55, 0, 1),
      tail = ramp((since - 0.3) / 0.55, 0, 1);
    if (head > tail + 0.005) {
      const n = GRACE_HELIX_SEGMENTS;
      const at = (strand: number, u: number, out: THREE.Vector3) => {
        const turn = u * Math.PI * 3 + strand * Math.PI + since * 4 * motion;
        const r = 0.78 - 0.3 * u;
        return out.set(tx + Math.cos(turn) * r, foot + (crown - foot) * u, tz + Math.sin(turn) * r);
      };
      this.time = t;
      for (let strand = 0; strand < 2; strand++) {
        const color = strand ? SKY : GOLD;
        for (let k = 0; k < n; k++) {
          const u0 = tail + ((head - tail) * k) / n,
            u1 = tail + ((head - tail) * (k + 1)) / n;
          const w0 = 0.13 * Math.sin((k / n) * Math.PI) + 0.025,
            w1 = 0.13 * Math.sin(((k + 1) / n) * Math.PI) + 0.025;
          this.ribbon(
            at(strand, u0, this.pointA),
            at(strand, u1, this.pointB),
            w0,
            w1,
            u0 * 3,
            u1 * 3,
            color,
            weak * fade * 1.6,
            weak * fade * 1.6,
            SHAPE.strand,
          );
        }
      }
    }
    for (let i = 0; i < GRACE_BLOOM_PLUSES; i++) {
      const ang = (i / GRACE_BLOOM_PLUSES) * Math.PI * 2 + 0.4;
      const rise = since * 1.6 * motion;
      const ox = Math.cos(ang) * 0.45,
        oy = Math.sin(ang) * 0.2;
      this.billboard(
        tx + c[0] * ox + c[3] * oy,
        ty + c[1] * ox + c[4] * oy + rise,
        tz + c[2] * ox + c[5] * oy,
        0.14,
        i % 2 ? GOLD : IVORY,
        fade * weak * Math.min(1, since * 6),
        SHAPE.plus,
      );
    }
  }

  clear(): void {
    for (const s of this.slots) s.phase = 0;
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
    if (errors.length) throw new AggregateError(errors, 'Hammer of Grace cleanup failed');
  }
}

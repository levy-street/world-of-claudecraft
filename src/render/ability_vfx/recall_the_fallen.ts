import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import { PALADIN_SPEC_EMBLEM_GLSL, paladinSpecEmblemIndex } from './paladin_spec_emblems';

export const RECALL_CASTERS = 4;
export const RECALL_SOULS = 8;
export const RECALL_ARRIVALS = 6;
/** The rite's circle and the rising motes, and the thread from the hands. */
export const RECALL_CIRCLE_RADIUS = 2.2;
export const RECALL_MOTES = 10;
export const RECALL_THREAD_SEGMENTS = 12;
export const RECALL_RELEASE_DURATION = 1.4;
export const RECALL_SOUL_DURATION = 0.7;
export const RECALL_ARRIVAL_DURATION = 1.6;
export const RECALL_FEATHERS = 6;
/** A returning player must reappear this close to the caster to be greeted. */
export const RECALL_ARRIVAL_REACH = 4;
/** The resurrection offer's lifetime: the return may come any time before it. */
export const RECALL_PENDING_SECONDS = 30;
/** The sigil at the caster's side, where the recalled will stand. */
export const RECALL_WAIT_SIGIL = 4;

/** Circle, shaft, hand glow, motes, thread; release pillar, flare, sparks;
 * waiting sigil. */
const CASTER_QUADS = 3 + RECALL_MOTES + RECALL_THREAD_SEGMENTS + 3 + 12 + 1;
/** Soul flare and its trail. */
const SOUL_QUADS = 2;
/** Pillar, ring, halo, flare, motes and feathers. */
const ARRIVAL_QUADS = 4 + RECALL_MOTES + RECALL_FEATHERS;
const VERTICES =
  (RECALL_CASTERS * CASTER_QUADS + RECALL_SOULS * SOUL_QUADS + RECALL_ARRIVALS * ARRIVAL_QUADS) * 6;

const GOLD = new THREE.Color(0xe8bb76).multiplyScalar(1.3);
const IVORY = new THREE.Color(0xfff1cc).multiplyScalar(1.5);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime', 'aAux'] as const;
const SHAPE = { ground: 0, beam: 1, flare: 2, spark: 3, feather: 4, thread: 5 } as const;
/** Ground-quad modes, carried in aAux. */
const MODE = { channel: 0, release: 1, arrival: 2, halo: 3, waiting: 4 } as const;

interface Caster {
  active: boolean;
  id: number;
  target: number;
  progress: number;
  /** Refreshed this frame by the live cast. */
  seen: boolean;
  /** Presence of the channel visuals, easing in and out. */
  presence: number;
  /** Seconds since the rite completed, negative while casting. */
  release: number;
  bodyX: number;
  bodyY: number;
  bodyZ: number;
  hasBody: boolean;
}
interface Soul {
  active: boolean;
  caster: number;
  age: number;
  x: number;
  y: number;
  z: number;
}
interface Pending {
  caster: number;
  age: number;
  /** How many of the fallen may still return to this caster. */
  count: number;
}
interface Arrival {
  active: boolean;
  id: number;
  age: number;
}

function ramp(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}
function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Recall the Fallen. Through the long cast a Paladin rune circle writes itself
 * around the body, clockwise with the cast, the Dawnreaver emblem rising at its
 * heart, light falling on the body and motes of the soul lifting from it, and a
 * thread of light runs from the praying hands to the fallen. When the rite
 * completes the circle blazes, a pillar flashes, and the soul rises and flies
 * to the caster's side, where a sigil waits for them. When they accept and
 * return there, light descends on them: a pillar, a rune ring at their feet, a
 * halo, rising motes and falling feathers.
 */
export class RecallTheFallen {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'recall_the_fallen'>;
  private readonly casters: Caster[] = Array.from({ length: RECALL_CASTERS }, () => ({
    active: false,
    id: -1,
    target: -1,
    progress: 0,
    seen: false,
    presence: 0,
    release: -1,
    bodyX: 0,
    bodyY: 0,
    bodyZ: 0,
    hasBody: false,
  }));
  private readonly souls: Soul[] = Array.from({ length: RECALL_SOULS }, () => ({
    active: false,
    caster: -1,
    age: 0,
    x: 0,
    y: 0,
    z: 0,
  }));
  private readonly arrivals: Arrival[] = Array.from({ length: RECALL_ARRIVALS }, () => ({
    active: false,
    id: -1,
    age: 0,
  }));
  private readonly pending: Pending[] = [];
  private readonly deadSeen = new Map<number, boolean>();
  /** Revived this moment: their view may still stand at the body for a frame
   * or two before it reaches the caster, so they are checked for a short while. */
  private readonly revived: { id: number; age: number }[] = [];
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly auxes = new Float32Array(VERTICES);
  private readonly at = new THREE.Vector3();
  private readonly hand = new THREE.Vector3();
  private readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  private vertex = 0;
  private time = 0;
  private aux = 0;
  /** PALADIN_SPEC_EMBLEMS index for the ground circles being drawn. */
  private emblem = 1;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly camera?: THREE.Camera,
    /** The caster's spec, when known: its emblem is written in the rite. */
    private readonly specOf?: (id: number) => string | null | undefined,
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
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha, aShape, aTime, aAux; attribute vec2 aUv;
        varying vec3 vColor; varying float vAlpha, vShape, vTime, vAux; varying vec2 vUv;
        ${GROUND_DEPTH_PULL_GLSL}
        void main(){vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vAux=aAux;vUv=aUv;
          // Circles on the ground are pulled forward in depth only (not the halo).
          float pull=aShape<0.5&&(aAux<2.5||aAux>3.5)?${GROUND_DEPTH_PULL.toFixed(2)}:0.0;
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime, vAux; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.92,0.72);
        const float PI=3.14159265;
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${PALADIN_RUNE_GLSL}
        ${PALADIN_SPEC_EMBLEM_GLSL}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float mask;
          vec3 color=vColor;
          if(vShape>4.5){
            // Thread of light from the hands to the fallen, the call running along it.
            float across=exp(-vUv.y*vUv.y*5.0);
            float core=exp(-vUv.y*vUv.y*40.0);
            float flow=0.55+0.45*sin(vAux*34.0-t*7.0);
            float ends=smoothstep(0.0,0.06,vAux)*(1.0-smoothstep(0.9,1.0,vAux));
            mask=(across*0.35+core*0.9)*flow*ends;
            color=mix(vColor,HOT,core*0.8);
          } else if(vShape>3.5){
            // Feather: a pointed vane about a hot shaft.
            float along=p.x, acrossF=abs(p.y);
            float w=0.36*pow(max(1.0-along*along,0.0),0.7)*(along<-0.55?0.0:1.0);
            float inside=1.0-smoothstep(w-0.05,w,acrossF);
            float edge=exp(-abs(acrossF-w)*28.0)*step(-0.55,along);
            float shaft=exp(-p.y*p.y*260.0)*(1.0-smoothstep(0.85,0.98,abs(along)));
            mask=inside*0.3+edge*0.55+shaft*0.9;
            color=mix(vColor,HOT,shaft*0.8+edge*0.3);
          } else if(vShape>2.5){
            // Spark streak: hot head, tail trailing back along its flight.
            float head=exp(-(sq(vUv.x-0.85)*30.0+vUv.y*vUv.y*6.0));
            mask=exp(-vUv.y*vUv.y*5.0)*pow(max(vUv.x,0.0),1.6)*0.8+head;
            color=mix(vColor,HOT,head);
          } else if(vShape>1.5){
            // Flare: white core, round halo and a soft four-point star.
            float core=exp(-r*r*18.0);
            float spokes=exp(-abs(p.y)*30.0)*exp(-abs(p.x)*2.0)+exp(-abs(p.x)*30.0)*exp(-abs(p.y)*2.2);
            mask=(core*1.5+exp(-r*r*5.0)*0.35+spokes*0.7)*(1.0-smoothstep(0.7,1.0,r));
            color=mix(vColor,HOT,core+spokes*0.3);
          } else if(vShape>0.5){
            // Beam of light: soft body, hot core, light drifting along it.
            float across=exp(-vUv.y*vUv.y*4.0);
            float core=exp(-vUv.y*vUv.y*36.0);
            float along=smoothstep(0.0,0.05,vUv.x)*pow(max(1.0-vUv.x,0.0),1.2);
            float flow=0.8+0.2*sin(vUv.x*18.0-t*6.0);
            mask=(across*0.5+core*0.8)*along*flow;
            color=mix(vColor,HOT,core*0.7);
          } else {
            float a=atan(p.x,p.y);
            float turn=fract(a/(2.0*PI)+1.0);
            vec2 e=p/0.5;
            // The caster's spec rides the ground shape in tenths.
            float emblem=paladinSpecEmblem(e,floor(vShape*10.0+0.5));
            if(vAux<0.5){
              // The rite writing itself: runes appear clockwise with the cast,
              // a bright pen at the writing front, the emblem rising within.
              float written=1.0-smoothstep(t-0.015,t+0.015,turn);
              float front=exp(-sq((turn-t)*60.0))*band(r,0.875,0.07)*step(0.01,t)*step(t,0.99);
              float runes=paladinRuneRing(p,0.8,0.95)*written;
              float outer=band(r,0.975,0.012)+band(r,0.72,0.008)*0.5*t;
              float glow=exp(-r*r*5.0)*0.25*t;
              mask=(outer*0.7+runes*0.85+emblem*0.75*t*t+glow)*(0.4+0.6*t)+front*1.4;
              color=mix(vColor,HOT,front+glow);
            } else if(vAux<1.5){
              // Completed: the circle blazes, a shock leaves the rim, then all fades.
              float blaze=exp(-t*3.0);
              float shock=band(r,0.3+0.68*clamp(t/0.4,0.0,1.0),0.03)*(1.0-clamp(t/0.4,0.0,1.0));
              float runes=paladinRuneRing(p,0.8,0.95);
              float outer=band(r,0.975,0.012);
              mask=(outer*0.8+runes*0.9+emblem*0.8+exp(-r*r*5.0)*0.3)*(0.4+1.2*blaze)+shock*1.2;
              mask*=1.0-smoothstep(0.5,1.0,t/${RECALL_RELEASE_DURATION.toFixed(2)});
              color=mix(vColor,HOT,blaze*0.6+shock);
            } else if(vAux<2.5){
              // Return: a rune ring flashes at the feet of the recalled.
              float grow=1.0-sq(max(1.0-clamp(t/0.3,0.0,1.0),0.0));
              float runes=paladinRuneRing(p,0.78,0.94)*smoothstep(0.0,0.1,t);
              float shock=band(r,0.2+0.78*grow,0.03+0.04*grow)*(1.0-grow*0.7);
              float pool=exp(-r*r*8.0)*exp(-t*2.5)*0.8;
              mask=(runes*0.9+band(r,0.975,0.012)*0.7+pool)*exp(-t*1.4)+shock;
              color=mix(vColor,HOT,shock*0.7+pool);
            } else if(vAux<3.5){
              // Halo over the returned: a bright ring with a slow shimmer.
              float shimmer=0.75+0.25*sin(a*6.0+t*5.0);
              mask=(band(r,0.78,0.05)*1.2+band(r,0.78,0.16)*0.3)*shimmer;
              color=mix(vColor,HOT,band(r,0.78,0.04));
            } else {
              // Where the recalled will stand: a small ring and the emblem, breathing.
              float breathe=0.7+0.3*sin(t*3.0);
              mask=(band(r,0.95,0.03)+paladinRuneRing(p,0.78,0.92)*0.6+emblem*0.5)*breathe;
            }
            mask*=1.0-smoothstep(0.985,1.0,r);
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    material.name = 'recall_the_fallen:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'recall-the-fallen';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(
      scene,
      new Map([['recall_the_fallen', geometry]]),
      material,
    );
  }

  private floorAt(x: number, z: number, feet: number): number {
    return effectFloor(this.groundY?.(x, z), feet);
  }

  private casterSlot(id: number, claim: boolean): Caster | null {
    const found = this.casters.find((c) => c.active && c.id === id);
    if (found || !claim) return found ?? null;
    let slot = this.casters.find((c) => !c.active);
    if (!slot) {
      slot = this.casters[0];
      for (const c of this.casters) if (c.presence < slot.presence) slot = c;
    }
    slot.active = true;
    slot.id = id;
    slot.target = -1;
    slot.progress = 0;
    slot.presence = 0;
    slot.release = -1;
    slot.hasBody = false;
    return slot;
  }

  /** The live cast, once a frame: who is being recalled and how far along. */
  channel(caster: number, target: number | null, progress: number): void {
    if (this.disposed || !this.preparation.ready('recall_the_fallen')) return;
    if (target === null || target === caster) return;
    const slot = this.casterSlot(caster, true);
    if (!slot) return;
    if (slot.release >= 0 || slot.target !== target) {
      slot.release = -1;
      slot.target = target;
      slot.hasBody = false;
    }
    slot.progress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    slot.seen = true;
  }

  /** The rite completed over this body: blaze, and send the soul to the caster. */
  release(caster: number, target: number): boolean {
    if (this.disposed || !this.preparation.ready('recall_the_fallen')) return false;
    if (!this.anchor(target, 0, this.at)) return false;
    return this.releaseAt(caster, this.at.x, this.at.z, this.at.y);
  }

  /** A body recalled at a point (the group rite answers every fallen member). */
  releaseAt(caster: number, x: number, z: number, feet?: number): boolean {
    if (this.disposed || !this.preparation.ready('recall_the_fallen')) return false;
    const floor = this.floorAt(x, z, feet ?? Number.NaN);
    // The group rite reports each body once; the primary may also name one.
    for (const s of this.souls)
      if (s.active && s.caster === caster && s.age < 0.2 && Math.hypot(s.x - x, s.z - z) < 0.6)
        return true;
    const slot = this.casterSlot(caster, true);
    if (slot) {
      if (!slot.hasBody || slot.release >= 0) {
        slot.bodyX = x;
        slot.bodyY = floor;
        slot.bodyZ = z;
        slot.hasBody = true;
      }
      slot.release = 0;
      slot.presence = 1;
    }
    const soul = this.souls.find((s) => !s.active) ?? this.souls[0];
    soul.active = true;
    soul.caster = caster;
    soul.age = 0;
    soul.x = x;
    soul.y = floor;
    soul.z = z;
    const wait = this.pending.find((w) => w.caster === caster);
    if (wait) {
      wait.age = 0;
      wait.count++;
    } else {
      if (this.pending.length >= RECALL_CASTERS) this.pending.shift();
      this.pending.push({ caster, age: 0, count: 1 });
    }
    return true;
  }

  /** Whether a revival is being watched for (the renderer then reports deaths). */
  listening(): boolean {
    return this.pending.length > 0;
  }

  /** The renderer's per-entity report while listening: dead or not this frame. */
  watch(id: number, dead: boolean): void {
    const was = this.deadSeen.get(id);
    this.deadSeen.set(id, dead);
    if (was === true && !dead && this.revived.length < RECALL_ARRIVALS)
      this.revived.push({ id, age: 0 });
  }

  /** Someone came back to life: greet them if they stand at a waiting caster's side. */
  returned(id: number): boolean {
    if (this.disposed || !this.anchor(id, 0, this.at)) return false;
    const x = this.at.x,
      z = this.at.z;
    for (let i = 0; i < this.pending.length; i++) {
      const w = this.pending[i];
      if (w.caster === id || !this.anchor(w.caster, 0, this.hand)) continue;
      if (Math.hypot(this.hand.x - x, this.hand.z - z) > RECALL_ARRIVAL_REACH) continue;
      if (--w.count <= 0) this.pending.splice(i, 1);
      const arrival = this.arrivals.find((a) => !a.active) ?? this.arrivals[0];
      arrival.active = true;
      arrival.id = id;
      arrival.age = 0;
      return true;
    }
    return false;
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

  private ground(x: number, y: number, z: number, r: number, mode: number, alpha: number): void {
    this.aux = mode;
    this.quad(x, y, z, r, 0, 0, 0, 0, r, GOLD, alpha, SHAPE.ground + this.emblem * 0.1);
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

  /** Upright beam from y0 to y1 (u = 0 at y0), turned to the view. */
  private beam(
    x: number,
    z: number,
    y0: number,
    y1: number,
    half: number,
    hx: number,
    hz: number,
    alpha: number,
  ): void {
    this.quad(
      x,
      (y0 + y1) / 2,
      z,
      0,
      (y1 - y0) / 2,
      0,
      hx * half,
      0,
      hz * half,
      GOLD,
      alpha,
      SHAPE.beam,
    );
  }

  /** A streak at (x, y, z) trailing back along (vx, vy, vz). */
  private streak(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    length: number,
    width: number,
    color: THREE.Color,
    alpha: number,
  ): void {
    const c = this.cam;
    const speed = Math.hypot(vx, vy, vz) || 1;
    const ax = vx / speed,
      ay = vy / speed,
      az = vz / speed;
    let px = ay * c[8] - az * c[7],
      py = az * c[6] - ax * c[8],
      pz = ax * c[7] - ay * c[6];
    const pl = Math.hypot(px, py, pz) || 1;
    px = (px / pl) * width;
    py = (py / pl) * width;
    pz = (pz / pl) * width;
    const h = length / 2;
    this.quad(
      x - ax * h,
      y - ay * h,
      z - az * h,
      ax * h,
      ay * h,
      az * h,
      px,
      py,
      pz,
      color,
      alpha,
      SHAPE.spark,
    );
  }

  update(dt: number, reduced = false): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.clock += dt;
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
    const rl = Math.hypot(c[0], c[2]) || 1;
    const hx = c[0] / rl,
      hz = c[2] / rl;
    const motion = reduced ? 0.3 : 1;
    for (const s of this.casters) if (s.active) this.drawCaster(s, dt, hx, hz, motion, reduced);
    for (const s of this.souls) if (s.active) this.drawSoul(s, dt, reduced);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const w = this.pending[i];
      w.age += dt;
      if (w.age >= RECALL_PENDING_SECONDS) {
        this.pending.splice(i, 1);
        continue;
      }
      // The sigil at the caster's side, while the return is fresh.
      const fade = 1 - ramp(w.age, RECALL_WAIT_SIGIL - 1, RECALL_WAIT_SIGIL);
      if (fade > 0 && this.anchor(w.caster, 0, this.at)) {
        this.time = this.clock;
        this.emblem = paladinSpecEmblemIndex(this.specOf?.(w.caster));
        this.ground(
          this.at.x,
          this.floorAt(this.at.x, this.at.z, this.at.y) + 0.04,
          this.at.z,
          1.1,
          MODE.waiting,
          fade * ramp(w.age, 0.4, 0.9) * 0.8,
        );
      }
    }
    for (let i = this.revived.length - 1; i >= 0; i--) {
      const r = this.revived[i];
      r.age += dt;
      if (this.returned(r.id) || r.age > 0.5) this.revived.splice(i, 1);
    }
    if (!this.pending.length) {
      this.deadSeen.clear();
      this.revived.length = 0;
    }
    for (const a of this.arrivals) if (a.active) this.drawArrival(a, dt, hx, hz, motion, reduced);
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

  private drawCaster(
    s: Caster,
    dt: number,
    hx: number,
    hz: number,
    motion: number,
    reduced: boolean,
  ): void {
    const casting = s.release < 0;
    if (casting) {
      s.presence = s.seen ? Math.min(1, s.presence + dt * 3) : Math.max(0, s.presence - dt * 4);
      s.seen = false;
      if (s.presence <= 0) {
        s.active = false;
        return;
      }
      // The body can move (a corpse settles); follow it while the rite is written.
      if (this.anchor(s.target, 0, this.at)) {
        s.bodyX = this.at.x;
        s.bodyZ = this.at.z;
        s.bodyY = this.floorAt(this.at.x, this.at.z, this.at.y);
        s.hasBody = true;
      }
    } else {
      s.release += dt;
      if (s.release >= RECALL_RELEASE_DURATION) {
        s.active = false;
        return;
      }
    }
    if (!s.hasBody) return;
    this.emblem = paladinSpecEmblemIndex(this.specOf?.(s.id));
    const k = s.presence;
    const prog = casting ? s.progress : 1;
    const x = s.bodyX,
      y = s.bodyY,
      z = s.bodyZ;
    const r = RECALL_CIRCLE_RADIUS;
    if (casting) {
      this.time = prog;
      this.ground(x, y + 0.04, z, r, MODE.channel, k);
    } else {
      this.time = s.release;
      this.ground(x, y + 0.04, z, r, MODE.release, 1);
    }
    // Light falling on the body, widening with the rite; a flash at completion.
    const after = casting ? -1 : s.release;
    this.time = this.clock;
    const shaftHalf = casting ? 0.35 + 0.55 * prog : 1.3 * (1 - 0.6 * Math.min(1, after / 0.4));
    const shaft = casting ? k * (0.15 + 0.4 * prog) : Math.exp(-after * 3.5) * 1.1;
    this.beam(x, z, y + 0.02, y + 14, shaftHalf, hx, hz, shaft);
    if (!casting) {
      this.flare(x, y + 0.8, z, 2.6, Math.exp(-after * 8) * 1.3);
      for (let i = 0; i < 12; i++) {
        const life = 0.5 + 0.3 * hash(i, 1);
        if (after >= life) continue;
        const ang = i * 2.399963;
        const out = (1.2 + 1.2 * hash(i, 2)) * motion;
        const up = (3 + 3 * hash(i, 3)) * motion;
        const vy = up - 7 * after * motion;
        this.streak(
          x + Math.cos(ang) * out * after,
          y + 0.3 + up * after - 3.5 * after * after * motion,
          z + Math.sin(ang) * out * after,
          Math.cos(ang) * out,
          vy,
          Math.sin(ang) * out,
          0.3,
          0.05,
          i % 2 ? IVORY : GOLD,
          (1 - after / life) * 1.1,
        );
      }
      return;
    }
    // Motes of the soul lifting from the body.
    for (let i = 0; i < RECALL_MOTES; i++) {
      const phase = (this.clock * 0.35 * motion + hash(i, 4)) % 1;
      const ang = i * 2.399963 + this.clock * 1.1 * motion;
      const out = 0.25 + 0.5 * (1 - phase) * hash(i, 5);
      const fade = Math.sin(phase * Math.PI) * k * (0.35 + 0.65 * prog);
      this.flare(
        x + Math.cos(ang) * out,
        y + 0.2 + phase * 2.4,
        z + Math.sin(ang) * out,
        0.12 + 0.06 * hash(i, 6),
        fade,
      );
    }
    // The praying hands glow and a thread of light runs to the fallen.
    if (!this.anchor(s.id, 0.62, this.hand)) return;
    this.flare(
      this.hand.x,
      this.hand.y,
      this.hand.z,
      0.55,
      k * (0.5 + 0.2 * Math.sin(this.clock * 5)),
    );
    if (reduced) return;
    const ex = x,
      ey = y + 0.35,
      ez = z;
    const dist = Math.hypot(ex - this.hand.x, ez - this.hand.z);
    const lift = 0.8 + dist * 0.1;
    const n = RECALL_THREAD_SEGMENTS;
    for (let i = 0; i < n; i++) {
      const u0 = i / n,
        u1 = (i + 1) / n;
      this.threadSegment(
        this.hand.x,
        this.hand.y,
        this.hand.z,
        ex,
        ey,
        ez,
        lift,
        u0,
        u1,
        k * (0.35 + 0.65 * prog),
      );
    }
  }

  private threadPoint(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    lift: number,
    u: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const wobble = Math.sin(u * 9 - this.clock * 2) * Math.sin(u * Math.PI) * 0.12;
    return out.set(
      x0 + (x1 - x0) * u,
      y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * lift + wobble,
      z0 + (z1 - z0) * u,
    );
  }

  private readonly threadA = new THREE.Vector3();
  private readonly threadB = new THREE.Vector3();

  private threadSegment(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    lift: number,
    u0: number,
    u1: number,
    alpha: number,
  ): void {
    if (!(alpha > 0.002) || this.vertex + 6 > VERTICES) return;
    const a = this.threadPoint(x0, y0, z0, x1, y1, z1, lift, u0, this.threadA);
    const b = this.threadPoint(x0, y0, z0, x1, y1, z1, lift, u1, this.threadB);
    const c = this.cam;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    let px = dy * c[8] - dz * c[7],
      py = dz * c[6] - dx * c[8],
      pz = dx * c[7] - dy * c[6];
    const pl = Math.hypot(px, py, pz) || 1;
    const w = 0.09;
    px = (px / pl) * w;
    py = (py / pl) * w;
    pz = (pz / pl) * w;
    this.time = this.clock;
    for (let k = 0; k < 6; k++) {
      const end = CORNERS[k * 2],
        side = CORNERS[k * 2 + 1];
      const p = end ? b : a;
      this.aux = end ? u1 : u0;
      this.put(
        p.x + px * side,
        p.y + py * side,
        p.z + pz * side,
        end,
        side,
        GOLD,
        alpha,
        SHAPE.thread,
      );
    }
  }

  private drawSoul(s: Soul, dt: number, reduced: boolean): void {
    s.age += dt;
    const dur = RECALL_SOUL_DURATION;
    if (s.age >= dur + 0.25 || !this.anchor(s.caster, 0, this.hand)) {
      s.active = false;
      return;
    }
    // The soul rises from the body and arcs to the caster's side.
    const tx = this.hand.x,
      ty = this.hand.y + 1.2,
      tz = this.hand.z;
    const u = Math.min(1, s.age / dur);
    const e = u * u * (3 - 2 * u);
    const sx = s.x,
      sy = s.y + 0.6,
      sz = s.z;
    const lift = 2.4 + Math.hypot(tx - sx, tz - sz) * 0.15;
    const mx = (sx + tx) / 2,
      my = Math.max(sy, ty) + lift,
      mz = (sz + tz) / 2;
    const q = 1 - e;
    const x = q * q * sx + 2 * q * e * mx + e * e * tx;
    const y = q * q * sy + 2 * q * e * my + e * e * ty;
    const z = q * q * sz + 2 * q * e * mz + e * e * tz;
    const vx = 2 * q * (mx - sx) + 2 * e * (tx - mx);
    const vy = 2 * q * (my - sy) + 2 * e * (ty - my);
    const vz = 2 * q * (mz - sz) + 2 * e * (tz - mz);
    const arrived = Math.max(0, s.age - dur);
    const alpha = Math.min(1, s.age / 0.1) * (1 - arrived / 0.25);
    this.flare(x, y, z, u < 1 ? 0.7 : 0.7 + arrived * 6, alpha * 1.3);
    if (!reduced && u < 1) this.streak(x, y, z, vx, vy, vz, 1.4, 0.16, GOLD, alpha * 0.9);
  }

  private drawArrival(
    a: Arrival,
    dt: number,
    hx: number,
    hz: number,
    motion: number,
    reduced: boolean,
  ): void {
    a.age += dt;
    if (a.age >= RECALL_ARRIVAL_DURATION || !this.anchor(a.id, 0, this.at)) {
      a.active = false;
      return;
    }
    const t = a.age;
    const x = this.at.x,
      z = this.at.z;
    const y = this.floorAt(x, z, this.at.y);
    const top = this.anchor(a.id, 1, this.hand) ? this.hand.y : y + 1.8;
    // Light descends on them: the pillar drops from the sky, then thins away.
    const drop = Math.min(1, t / 0.18);
    const pillar = (1 - ramp(t, 0.3, 1.1)) * 1.1;
    this.time = this.clock;
    this.beam(
      x,
      z,
      y + 0.02 + (1 - drop) * 12,
      y + 16,
      1.1 * (1 - 0.6 * ramp(t, 0, 0.8)),
      hx,
      hz,
      pillar,
    );
    this.flare(x, y + 1, z, 2.4, Math.exp(-t * 6) * drop * 1.2);
    this.time = t;
    this.ground(x, y + 0.04, z, 1.6, MODE.arrival, 1);
    // A halo settles over the head and fades.
    this.time = t;
    this.aux = MODE.halo;
    const halo = ramp(t, 0.1, 0.35) * (1 - ramp(t, 1, RECALL_ARRIVAL_DURATION));
    const hy = top + 0.35 + 0.4 * (1 - ramp(t, 0.1, 0.5));
    this.quad(x, hy, z, 0.42, 0, 0, 0, 0, 0.42, IVORY, halo, SHAPE.ground);
    if (reduced) return;
    // Motes rising around them and feathers drifting down.
    for (let i = 0; i < RECALL_MOTES; i++) {
      const life = 0.9 + 0.5 * hash(i, 7);
      const tt = t - 0.1 * hash(i, 8);
      if (tt < 0 || tt >= life) continue;
      const ang = i * 2.399963 + tt * 2;
      const out = 0.35 + 0.35 * hash(i, 9);
      this.flare(
        x + Math.cos(ang) * out,
        y + 0.2 + tt * (1.4 + hash(i, 10)) * motion,
        z + Math.sin(ang) * out,
        0.12,
        Math.sin((tt / life) * Math.PI),
      );
    }
    const c = this.cam;
    for (let i = 0; i < RECALL_FEATHERS; i++) {
      const life = 1.2;
      const tt = t - 0.15;
      if (tt < 0 || tt >= life) continue;
      const ang = i * 2.399963 + 0.7;
      const out = (0.4 + 0.6 * hash(i, 11)) * (0.4 + tt) * motion;
      const fx = x + Math.cos(ang) * out,
        fz = z + Math.sin(ang) * out,
        fy = top + 0.8 - tt * 1.3 * motion;
      const spin = i * 1.7 + tt * 3 * motion;
      const cs = Math.cos(spin),
        sn = Math.sin(spin);
      const long = 0.3,
        wide = 0.17;
      this.quad(
        fx,
        fy,
        fz,
        (c[0] * cs + c[3] * sn) * long,
        (c[1] * cs + c[4] * sn) * long,
        (c[2] * cs + c[5] * sn) * long,
        (c[3] * cs - c[0] * sn) * wide,
        (c[4] * cs - c[1] * sn) * wide,
        (c[5] * cs - c[2] * sn) * wide,
        i % 2 ? GOLD : IVORY,
        Math.sin((tt / life) * Math.PI),
        SHAPE.feather,
      );
    }
  }

  clear(): void {
    for (const s of this.casters) s.active = false;
    for (const s of this.souls) s.active = false;
    for (const a of this.arrivals) a.active = false;
    this.pending.length = 0;
    this.deadSeen.clear();
    this.revived.length = 0;
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
    if (errors.length) throw new AggregateError(errors, 'Recall the Fallen cleanup failed');
  }
}

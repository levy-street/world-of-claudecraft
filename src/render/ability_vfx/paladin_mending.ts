import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { PALADIN_BODY_FIT } from '../paladin_body_fit';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { HEAL_PLUS_GLSL, HEAL_PLUS_QUAD } from './heal_plus';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import { PALADIN_SPEC_EMBLEM_GLSL, paladinSpecEmblemIndex } from './paladin_spec_emblems';

export const MENDING_CASTERS = 6;
export const MENDING_CASTS = 8;
export const MENDING_RITES = 4;
/** Mending Light's stream reaches the ally this long after release. */
export const MENDING_TRAVEL = 0.22;
export const MENDING_BLOOM = 1.1;
export const MENDING_DURATION = MENDING_TRAVEL + MENDING_BLOOM;
export const MENDING_GATHER_PLUSES = 20;
/** Each gathering plus flies in once, over at most this share of the cast. */
export const MENDING_GATHER_FLIGHT = 0.32;
/** By this share of the cast every gathering plus has been absorbed. */
export const MENDING_GATHER_DONE = 0.9;
export const MENDING_STREAM_SEGMENTS = 10;
export const MENDING_THREAD_SEGMENTS = 14;
/** Mending Light charges this far above the top of the Paladin's head, clear
 * of the sigil held up on the off-hand. */
export const MENDING_CROWN_LIFT = 1.15;
/** Last Rite gathers in the raised off-hand this long before the beam fires. */
export const LAST_RITE_WINDUP = 0.3;
export const LAST_RITE_DURATION = LAST_RITE_WINDUP + 1.8;
/** Pluses in the halo that settles over the ally. */
export const LAST_RITE_HALO = 8;
export const LAST_RITE_PLUSES = 16;

const CASTER_QUADS = 2 + MENDING_GATHER_PLUSES;
/** Stream, riding pluses, flare, plus sigil, ring and two mending threads. */
const CAST_QUADS = MENDING_STREAM_SEGMENTS + 3 + 3 + MENDING_THREAD_SEGMENTS * 2;
/** Hand flares, beam, pillar, flashes, ground sigil, the halo and rising pluses. */
const RITE_QUADS = 8 + LAST_RITE_HALO + LAST_RITE_PLUSES;
const VERTICES =
  (MENDING_CASTERS * CASTER_QUADS + MENDING_CASTS * CAST_QUADS + MENDING_RITES * RITE_QUADS) * 6;

const GOLD = new THREE.Color(0xecc27c).multiplyScalar(1.35);
const IVORY = new THREE.Color(0xfff4d8).multiplyScalar(1.45);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime'] as const;
const SHAPE = {
  flare: 0,
  plus: 1,
  ring: 2,
  ribbon: 3,
  beam: 4,
  halo: 5,
  sigil: 6,
} as const;

interface Caster {
  active: boolean;
  id: number;
  seen: boolean;
  progress: number;
  /** `progress` carried forward at the cast's pace between sim ticks, so
   * the charge grows steadily instead of in steps. */
  shown: number;
  /** The last progress the sim reported, when, and the pace it is moving at. */
  tickProgress: number;
  tickAt: number;
  rate: number;
  presence: number;
}
interface Cast {
  active: boolean;
  source: number;
  target: number;
  age: number;
  self: boolean;
}
interface Rite {
  active: boolean;
  source: number;
  target: number;
  age: number;
  self: boolean;
  floor: number;
  /** PALADIN_SPEC_EMBLEMS index of the caster's spec. */
  spec: number;
}

function ramp(t: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return x * x * (3 - 2 * x);
}
/** Share of the cast gathering plus `i` takes to fly in. */
function gatherFlight(i: number): number {
  return MENDING_GATHER_FLIGHT * (0.72 + 0.28 * hash(i, 8));
}
/** Share of the cast at which gathering plus `i` sets off: spread through the
 * cast with jitter, landing by MENDING_GATHER_DONE. */
function gatherStart(i: number): number {
  return ((i + hash(i, 7)) / MENDING_GATHER_PLUSES) * (MENDING_GATHER_DONE - gatherFlight(i));
}
function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Mending Light and Last Rite, the Paladin's hands of healing. Every heal also
 * sheds the shared healing pluses on landing; these are each spell's own art.
 *
 * Both are cast with the off-hand (shield) sigil raised.
 *
 * Mending Light: light charges over the Paladin's head through the cast, healing
 * pluses spiralling in; on release a quick golden stream carries pluses from it
 * to the ally, a plus sigil blooms on them and two threads of light spiral up
 * around them, mending.
 *
 * Last Rite: the great heal. Light gathers in the raised off-hand and a thick
 * beam shoots from it to the ally; a pillar falls from the sky, a spinning halo
 * of pluses crowns them and settles down over them onto the rune ring and the
 * Dawnreaver emblem burning at their feet, and a flight of pluses rises.
 */
/** A point on the stream's quadratic bend `b` (start, control, end, packed
 *  x y z) at `u`, into `out`. */
function bendAt(b: readonly number[], u: number, out: THREE.Vector3): THREE.Vector3 {
  const q = 1 - u;
  return out.set(
    q * q * b[0] + 2 * q * u * b[3] + u * u * b[6],
    q * q * b[1] + 2 * q * u * b[4] + u * u * b[7],
    q * q * b[2] + 2 * q * u * b[5] + u * u * b[8],
  );
}

/** A point on one of the mending's two spiral threads at `u`, into `out`. */
function spiralAt(
  out: THREE.Vector3,
  u: number,
  strand: number,
  since: number,
  tx: number,
  feetY: number,
  tz: number,
  height: number,
): THREE.Vector3 {
  const ang = strand * Math.PI + u * Math.PI * 3.2 + since * 2;
  const rad = 0.55 * (1 - u * 0.4);
  return out.set(
    tx + Math.cos(ang) * rad,
    feetY + 0.1 + u * height * 1.15,
    tz + Math.sin(ang) * rad,
  );
}

export class PaladinMending {
  /** Per-frame scratch: the stream's bend (start, control, end). */
  private readonly bend: number[] = new Array(9).fill(0);
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'paladin_mending'>;
  private readonly casters: Caster[] = Array.from({ length: MENDING_CASTERS }, () => ({
    active: false,
    id: -1,
    seen: false,
    progress: 0,
    shown: 0,
    tickProgress: 0,
    tickAt: 0,
    rate: 0,
    presence: 0,
  }));
  private readonly casts: Cast[] = Array.from({ length: MENDING_CASTS }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    self: false,
  }));
  private readonly rites: Rite[] = Array.from({ length: MENDING_RITES }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    self: false,
    floor: 0,
    spec: 1,
  }));
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly pointA = new THREE.Vector3();
  private readonly pointB = new THREE.Vector3();
  private readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  private vertex = 0;
  private time = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly camera?: THREE.Camera,
    /** Samples a hand: 0 the weapon hand, 1 the off-hand. */
    private readonly hand?: (id: number, hand: 0 | 1, out: THREE.Vector3) => boolean,
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
        ${GROUND_DEPTH_PULL_GLSL}
        void main(){vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vUv=aUv;
          // The ground sigil lies on the floor; the rest plays at the body.
          float pull=aShape>5.5?${GROUND_DEPTH_PULL.toFixed(2)}:(aShape<2.5||aShape>4.5?0.5:0.0);
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.95,0.82);
        const float PI=3.14159265;
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${HEAL_PLUS_GLSL}
        ${PALADIN_RUNE_GLSL}
        ${PALADIN_SPEC_EMBLEM_GLSL}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float mask;
          vec3 color=vColor;
          if(vShape>5.5){
            // Last Rite at the feet: the rune ring and the emblem, a shock leaving it.
            float grow=1.0-sq(max(1.0-clamp(t/0.35,0.0,1.0),0.0));
            float runes=paladinRuneRing(p,0.74,0.9)*smoothstep(0.0,0.15,t);
            vec2 e=p/0.55;
            float emblem=paladinSpecEmblem(e,floor(vShape-5.5));
            float shock=band(r,0.2+0.78*grow,0.03+0.05*grow)*(1.0-grow*0.7);
            float pool=exp(-r*r*6.0)*exp(-t*2.0)*0.6;
            mask=(runes+band(r,0.95,0.012)*0.8+emblem*0.8+pool)+shock;
            mask*=1.0-smoothstep(0.97,1.0,r);
            color=mix(vColor,HOT,shock*0.6+pool);
          } else if(vShape>4.5){
            // The halo: a flat ring of light with notches running round it.
            float a=atan(p.y,p.x);
            float ring=band(r,0.86,0.035);
            float notches=sq(sq(max(cos(a*16.0-t*5.0),0.0)))*band(r,0.86,0.09);
            float glow=band(r,0.84,0.16)*0.3;
            mask=(ring*1.2+notches*0.7+glow)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,ring*0.6);
          } else if(vShape>3.5){
            // Beam and pillar of light: soft sheet, hot core, light running along.
            float across=exp(-vUv.y*vUv.y*4.0);
            float core=exp(-vUv.y*vUv.y*36.0);
            float along=smoothstep(0.0,0.05,vUv.x)*pow(max(1.0-vUv.x,0.0),1.1);
            float flow=0.8+0.2*sin(vUv.x*20.0-t*18.0);
            mask=(across*0.5+core)*along*flow;
            color=mix(vColor,HOT,core*0.85);
          } else if(vShape>2.5){
            // Ribbon: the stream and the mending threads, light flowing along.
            float across=exp(-vUv.y*vUv.y*3.5);
            float core=exp(-vUv.y*vUv.y*28.0);
            float flow=0.6+0.4*sin(vUv.x*26.0-t*16.0);
            mask=(across*0.5+core*1.1)*flow;
            color=mix(vColor,HOT,core*0.8);
          } else if(vShape>1.5){
            // A halo opening where the mending lands.
            float grow=1.0-sq(max(1.0-clamp(t/0.4,0.0,1.0),0.0));
            mask=(band(r,0.25+0.7*grow,0.05+0.05*grow)*(1.0-grow*0.7))*(1.0-smoothstep(0.95,1.0,r));
            color=mix(vColor,HOT,0.4);
          } else if(vShape>0.5){
            mask=healPlusQuad(p);
            color=mix(vColor,HOT,exp(-dot(p,p)*13.5)*0.8);
          } else {
            float core=exp(-r*r*16.0);
            float spokes=exp(-abs(p.y)*30.0)*exp(-abs(p.x)*2.2)+exp(-abs(p.x)*30.0)*exp(-abs(p.y)*2.2);
            mask=(core*1.5+exp(-r*r*5.0)*0.35*(1.0-smoothstep(0.6,1.0,r))+spokes*0.6*(1.0-smoothstep(0.3,0.95,r)))
              *(1.0-smoothstep(0.5,1.0,r));
            color=mix(vColor,HOT,core+spokes*0.3);
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    material.name = 'paladin_mending:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'paladin-mending';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['paladin_mending', geometry]]), material);
  }

  private ready(): boolean {
    return !this.disposed && this.preparation.ready('paladin_mending');
  }

  /** Once a frame while Mending Light is cast. */
  channel(caster: number, progress: number): void {
    if (!this.ready()) return;
    let slot = this.casters.find((c) => c.active && c.id === caster);
    if (!slot) {
      slot = this.casters.find((c) => !c.active);
      if (!slot) return;
      slot.active = true;
      slot.id = caster;
      slot.presence = 0;
      slot.shown = -1;
    }
    slot.seen = true;
    slot.progress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
    if (slot.shown < 0 || slot.progress < slot.tickProgress - 0.05) {
      // A fresh cast (or a restart) starts the charge where the cast is.
      slot.shown = slot.tickProgress = slot.progress;
      slot.tickAt = this.clock;
      slot.rate = 0;
    } else if (slot.progress !== slot.tickProgress) {
      // A new sim tick: how fast the cast is moving.
      const gap = this.clock - slot.tickAt;
      if (gap > 1e-4)
        slot.rate = Math.min(4, Math.max(0, (slot.progress - slot.tickProgress) / gap));
      slot.tickProgress = slot.progress;
      slot.tickAt = this.clock;
    }
  }

  /** Mending Light is released on `target`. */
  mend(source: number, target: number): boolean {
    if (!this.ready() || !this.anchor(target, 0.5, this.to)) return false;
    let slot = this.casts.find((c) => !c.active);
    if (!slot) {
      slot = this.casts[0];
      for (const c of this.casts) if (c.age > slot.age) slot = c;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.age = 0;
    slot.self = source === target;
    // The gathered light is spent.
    const caster = this.casters.find((c) => c.active && c.id === source);
    if (caster) caster.active = false;
    return true;
  }

  /** Last Rite on `target`. */
  rite(source: number, target: number, spec?: string | null): boolean {
    if (!this.ready() || !this.anchor(target, 0, this.feet)) return false;
    let slot = this.rites.find((r) => !r.active);
    if (!slot) {
      slot = this.rites[0];
      for (const r of this.rites) if (r.age > slot.age) slot = r;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.age = 0;
    slot.self = source === target;
    slot.spec = paladinSpecEmblemIndex(spec);
    slot.floor = effectFloor(this.groundY?.(this.feet.x, this.feet.z), this.feet.y);
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

  /** A ribbon segment from a to b, u0..u1 along it, `w0`/`w1` half widths. */
  private segment(
    a: THREE.Vector3,
    b: THREE.Vector3,
    u0: number,
    u1: number,
    w0: number,
    w1: number,
    color: THREE.Color,
    alpha: number,
    shape: number,
  ): void {
    if (!(alpha > 0.002) || this.vertex + 6 > VERTICES) return;
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
        alpha,
        shape,
      );
    }
  }

  /** Upright beam from y0 to y1, turned to the view. */
  private pillar(x: number, z: number, y0: number, y1: number, half: number, alpha: number): void {
    const c = this.cam;
    const rl = Math.hypot(c[0], c[2]) || 1;
    const hx = c[0] / rl,
      hz = c[2] / rl;
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
      IVORY,
      alpha,
      SHAPE.beam,
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
    for (const s of this.casters) if (s.active) this.gather(s, dt, reduced);
    for (const s of this.casts) if (s.active) this.mending(s, dt, reduced);
    for (const s of this.rites) if (s.active) this.lastRite(s, dt, reduced);
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

  /** Over the Paladin's head, where Mending Light charges. */
  private crownOf(id: number, out: THREE.Vector3): boolean {
    if (!this.anchor(id, 1, out)) return false;
    out.y += MENDING_CROWN_LIFT;
    return true;
  }

  /** The raised off-hand, where Last Rite's beam comes from. */
  private handOf(id: number, out: THREE.Vector3): boolean {
    if (!this.anchor(id, 0.6, out)) return false;
    this.hand?.(id, 1, out);
    return true;
  }

  /** Light charging over the head through the cast: smaller pluses spiral in
   * one after another and are absorbed into the growing plus, the last of them
   * before the cast completes, so the plus fires off alone. */
  private gather(s: Caster, dt: number, reduced: boolean): void {
    s.presence = s.seen ? Math.min(1, s.presence + dt * 6) : Math.max(0, s.presence - dt * 5);
    s.seen = false;
    if (s.presence <= 0 || !this.crownOf(s.id, this.from)) {
      if (s.presence <= 0) s.active = false;
      return;
    }
    // The charge moves at the cast's pace between sim ticks, easing onto
    // where the cast should now be.
    const ahead = Math.min(1, s.tickProgress + s.rate * Math.min(0.15, this.clock - s.tickAt));
    s.shown += (ahead - s.shown) * (1 - Math.exp(-dt / 0.05));
    const k = s.presence,
      p = s.shown;
    const { x, y, z } = this.from;
    const c = this.cam;
    // Each plus's single flight from its own random place round the charge,
    // and a gentle swell of the big plus as each arrives.
    let swell = 0;
    for (let i = 0; i < MENDING_GATHER_PLUSES; i++) {
      const flight = gatherFlight(i);
      const since = p - gatherStart(i) - flight;
      swell += Math.exp(-(((since - 0.02) / 0.05) ** 2));
      const u = (p - gatherStart(i)) / flight;
      if (u <= 0 || u >= 1 - 1e-6 || reduced) continue;
      // Drifting in round the outside, then diving into the plus at the end.
      const radius = (0.95 + 0.65 * hash(i, 2)) * (1 - u * u);
      const turn = (1.5 + 3 * hash(i, 4)) * (hash(i, 3) < 0.5 ? -1 : 1);
      const ang = hash(i, 1) * Math.PI * 2 + turn * u;
      const ox = Math.cos(ang) * radius,
        oy =
          Math.sin(ang) * radius * (0.6 + 0.4 * hash(i, 6)) + 0.25 * (hash(i, 9) - 0.4) * (1 - u);
      this.time = this.clock;
      this.billboard(
        x + c[0] * ox + c[3] * oy,
        y + c[1] * ox + c[4] * oy,
        z + c[2] * ox + c[5] * oy,
        (0.12 + 0.07 * hash(i, 5)) * (1 - 0.6 * u * u),
        i % 2 ? GOLD : IVORY,
        k * Math.min(1, u * 6) * (0.6 + 0.4 * p),
        SHAPE.plus,
      );
    }
    swell = Math.min(1, swell);
    this.billboard(
      x,
      y,
      z,
      0.3 + 0.4 * p + 0.05 * swell,
      IVORY,
      k * (0.45 + 0.5 * p + 0.25 * swell),
      SHAPE.flare,
    );
    this.time = this.clock;
    this.billboard(
      x,
      y,
      z,
      0.3 + 0.35 * p + 0.025 * swell,
      GOLD,
      k * (0.3 + 0.8 * p + 0.2 * swell),
      SHAPE.plus,
    );
  }

  /** Mending Light released: the stream, the sigil, the mending threads. */
  private mending(s: Cast, dt: number, reduced: boolean): void {
    s.age += dt;
    const travel = s.self ? 0 : MENDING_TRAVEL;
    if (s.age >= travel + MENDING_BLOOM || !this.anchor(s.target, 0, this.feet)) {
      s.active = false;
      return;
    }
    const t = s.age;
    const bodyTop = this.anchor(s.target, 1, this.to) ? this.to.y : this.feet.y + 1.8;
    const height = Math.max(0.8, bodyTop - this.feet.y);
    const tx = this.feet.x,
      ty = this.feet.y + height * PALADIN_BODY_FIT.healChest,
      tz = this.feet.z;
    if (!s.self && t < travel + 0.15 && this.crownOf(s.source, this.from)) {
      // One quick golden stream from the charge over their head, pluses riding it.
      const head = Math.min(1, t / travel);
      const tail = Math.max(0, (t - 0.12) / travel);
      const sx = this.from.x,
        sy = this.from.y,
        sz = this.from.z;
      const mx = (sx + tx) / 2,
        my = Math.max(sy, ty) + 0.5,
        mz = (sz + tz) / 2;
      const b = this.bend;
      b[0] = sx;
      b[1] = sy;
      b[2] = sz;
      b[3] = mx;
      b[4] = my;
      b[5] = mz;
      b[6] = tx;
      b[7] = ty;
      b[8] = tz;
      this.time = t;
      const n = MENDING_STREAM_SEGMENTS;
      if (head > tail)
        for (let i = 0; i < n; i++) {
          const u0 = tail + ((head - tail) * i) / n,
            u1 = tail + ((head - tail) * (i + 1)) / n;
          const w0 = 0.16 * Math.sin((i / n) * Math.PI) + 0.03,
            w1 = 0.16 * Math.sin(((i + 1) / n) * Math.PI) + 0.03;
          this.segment(
            bendAt(b, u0, this.pointA),
            bendAt(b, u1, this.pointB),
            u0,
            u1,
            w0,
            w1,
            GOLD,
            1,
            SHAPE.ribbon,
          );
        }
      for (let i = 0; i < 3; i++) {
        const u = head - 0.05 - i * 0.2;
        if (u <= tail) break;
        const q = bendAt(b, u, this.pointA);
        this.billboard(q.x, q.y, q.z, 0.17, i % 2 ? IVORY : GOLD, 1, SHAPE.plus);
      }
    }
    const since = t - travel;
    if (since < 0) return;
    // The mending lands: a flash, a plus sigil and a halo on the ally.
    const fade = 1 - ramp(since, MENDING_BLOOM * 0.55, MENDING_BLOOM);
    this.billboard(tx, ty, tz, 1.1, IVORY, Math.exp(-since * 8), SHAPE.flare);
    this.time = since;
    this.billboard(tx, ty, tz, 0.9, GOLD, fade * 0.9, SHAPE.ring);
    this.billboard(
      tx,
      ty + 0.1 + since * 0.4,
      tz,
      0.3 + 0.25 * ramp(since, 0, 0.25),
      GOLD,
      fade,
      SHAPE.plus,
    );
    if (reduced) return;
    // Two threads of light spiral up around them, mending.
    this.time = this.clock;
    const n = MENDING_THREAD_SEGMENTS;
    const grow = ramp(since, 0, 0.55);
    for (let strand = 0; strand < 2; strand++) {
      for (let i = 0; i < n; i++) {
        const u0 = (i / n) * grow,
          u1 = ((i + 1) / n) * grow;
        const w0 = 0.085 * (1 - u0 * 0.6),
          w1 = 0.085 * (1 - u1 * 0.6);
        this.segment(
          spiralAt(this.pointA, u0, strand, since, tx, this.feet.y, tz, height),
          spiralAt(this.pointB, u1, strand, since, tx, this.feet.y, tz, height),
          u0,
          u1,
          w0,
          w1,
          strand ? IVORY : GOLD,
          fade * 1.3,
          SHAPE.ribbon,
        );
      }
    }
  }

  /** Last Rite: beam, the great plus, pillar, ground sigil and a flight of pluses. */
  private lastRite(s: Rite, dt: number, reduced: boolean): void {
    s.age += dt;
    if (s.age >= LAST_RITE_DURATION || !this.anchor(s.target, 0, this.feet)) {
      s.active = false;
      return;
    }
    const bodyTop = this.anchor(s.target, 1, this.to) ? this.to.y : this.feet.y + 1.8;
    const height = Math.max(0.8, bodyTop - this.feet.y);
    const x = this.feet.x,
      z = this.feet.z,
      chest = this.feet.y + height * PALADIN_BODY_FIT.healChest;
    // Light gathers in the raised off-hand, then shoots from it.
    const hand = this.handOf(s.source, this.from);
    if (s.age < LAST_RITE_WINDUP) {
      if (hand) {
        const k = ramp(s.age, 0, LAST_RITE_WINDUP);
        this.time = this.clock;
        this.billboard(
          this.from.x,
          this.from.y,
          this.from.z,
          0.4 + 0.6 * k,
          IVORY,
          0.4 + k,
          SHAPE.flare,
        );
        this.billboard(this.from.x, this.from.y, this.from.z, 0.2 + 0.25 * k, GOLD, k, SHAPE.plus);
      }
      return;
    }
    const t = s.age - LAST_RITE_WINDUP;
    const life = LAST_RITE_DURATION - LAST_RITE_WINDUP;
    const fade = 1 - ramp(t, life * 0.6, life);
    // A thick beam of light from the off-hand.
    if (!s.self && t < 0.5 && hand) {
      this.time = t;
      this.to.set(x, chest, z);
      const w = 0.32 * (1 - ramp(t, 0.15, 0.5));
      this.segment(this.from, this.to, 0, 1, w, w, IVORY, 1, SHAPE.beam);
    }
    if (hand && t < 0.5)
      this.billboard(
        this.from.x,
        this.from.y,
        this.from.z,
        1.1,
        IVORY,
        Math.exp(-t * 7) * 1.2,
        SHAPE.flare,
      );
    // The pillar of light from the sky.
    this.time = t;
    const pillar = ramp(t, 0, 0.1) * (1 - ramp(t, 0.5, 1.1));
    this.pillar(x, z, s.floor + 0.02, s.floor + 16, 1.2 * (1 - 0.4 * ramp(t, 0, 0.8)), pillar);
    this.billboard(x, chest, z, 2.2, IVORY, Math.exp(-t * 6) * 1.3, SHAPE.flare);
    // A halo of pluses crowns them, spinning, then settles down over them to the runes.
    const appear = ramp(t, 0.05, 0.3);
    const settle = ramp(t, 0.7, 1.15);
    const haloY = bodyTop + 0.4 + (s.floor + 0.12 - bodyTop - 0.4) * settle;
    const haloR = (0.45 + 0.3 * appear) * (1 + 0.6 * settle);
    const haloAlpha = appear * (1 - ramp(t, 1.15, 1.45));
    this.time = t;
    this.quad(x, haloY, z, haloR, 0, 0, 0, 0, haloR, GOLD, haloAlpha * 1.1, SHAPE.halo);
    const spin = t * 2.4;
    for (let i = 0; i < LAST_RITE_HALO; i++) {
      const ang = spin + (i / LAST_RITE_HALO) * Math.PI * 2;
      this.billboard(
        x + Math.cos(ang) * haloR * 0.86,
        haloY + 0.05 * Math.sin(t * 5 + i),
        z + Math.sin(ang) * haloR * 0.86,
        0.17,
        i % 2 ? GOLD : IVORY,
        haloAlpha,
        SHAPE.plus,
      );
    }
    // It lands with a flash at their feet.
    const landed = ramp(t, 1.05, 1.5);
    if (landed > 0)
      this.billboard(
        x,
        s.floor + 0.35,
        z,
        1.6,
        IVORY,
        Math.sin(landed * Math.PI) * 1.1,
        SHAPE.flare,
      );
    // The rune ring and the emblem at their feet, with a shock leaving the rim.
    const r = Math.max(1.6, height * 0.9);
    // The spec rides the shape: sigil, sigil + 1, sigil + 2.
    this.quad(x, s.floor + 0.04, z, r, 0, 0, 0, 0, r, GOLD, fade, SHAPE.sigil + s.spec);
    if (reduced) return;
    // A flight of pluses rising all around them.
    for (let i = 0; i < LAST_RITE_PLUSES; i++) {
      const start = 0.15 + 0.05 * (i % 6);
      const life = 1.1 + 0.3 * hash(i, 1);
      const tt = t - start;
      if (tt < 0 || tt >= life) continue;
      const ang = i * 2.399963;
      const out = (0.5 + 1.1 * hash(i, 2)) * (0.4 + tt);
      const px = x + Math.cos(ang) * out,
        pz = z + Math.sin(ang) * out,
        py = this.feet.y + 0.3 + tt * (1.6 + hash(i, 3));
      const alpha = Math.min(1, tt * 6) * (1 - ramp(tt, life * 0.5, life));
      this.billboard(
        px,
        py,
        pz,
        0.14 + 0.08 * hash(i, 4),
        i % 3 ? GOLD : IVORY,
        alpha,
        SHAPE.plus,
        Math.sin(tt * 3 + i) * 0.2,
      );
    }
  }

  clear(): void {
    for (const s of this.casters) s.active = false;
    for (const s of this.casts) s.active = false;
    for (const s of this.rites) s.active = false;
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
    if (errors.length) throw new AggregateError(errors, 'Paladin mending cleanup failed');
  }
}

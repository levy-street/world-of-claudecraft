import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { PALADIN_BODY_FIT } from '../paladin_body_fit';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import { PALADIN_SPEC_EMBLEM_GLSL, paladinSpecEmblemIndex } from './paladin_spec_emblems';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './paladin_spec_icons';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
} from './paladin_vfx_detail_core';

// Detail: core = Ward of Faith's lattice dome, and Hallowed Wall's ring of six
// shield plates (every standing plate on every tier: the count reads the absorb
// left); secondary = the ward's ground ring (rune flash, shock, rim); accents =
// the sigil's flash, the plates' lock flash, the break flash and each lost
// plate's flash. The ward's glints and a lost plate's shards are its motes and
// thin with the mote count; the fold/shatter and the shards' flight scale
// with the linger.

export const WARD_CAPACITY = 6;
/** The ward's shield plates; each carries a sixth of the absorb. */
export const WARD_PANELS = 6;
/** The plates fly out from the sigil and lock in over this long. */
export const WARD_INTRO = 0.6;
/** Seconds the ward takes to fold away or shatter once the aura ends. */
export const WARD_END = 0.75;
/** A raise with no aura following it lets go after this long. */
const WARD_ORPHAN = 0.6;
/** An aura ending with less than this left expired; with more, it broke. */
const WARD_EXPIRED = 0.4;
const SPIN = 0.45;
/** The plates' ring, as a share of body height (1.8 is a full-size Paladin). */
export const WARD_RADIUS = 0.85;
/** Hallowed Wall's plates stand this much further out than Ward of Faith's
 * radius, and this much larger, so they close into a wall of shields. */
export const PLATE_REACH = 1.15;
const PLATE_SIZE = 1.15;
/** A pulse of light runs round the ring of plates once in this long. */
const PLATE_PULSE = 1.4;
const SHARDS = 5;
const SHARD_LIFE = 0.65;
const GLINTS = 10;
/** Per ward: each plate (or its shards and flash), dome, ground, two flares, glints. */
const QUADS = WARD_PANELS * (SHARDS + 1) + 4 + GLINTS;
const VERTICES = WARD_CAPACITY * QUADS * 6;

const GOLD = new THREE.Color(0xecc27c).multiplyScalar(1.3);
const IVORY = new THREE.Color(0xfff4d8).multiplyScalar(1.4);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime', 'aParam'] as const;
const SHAPE = { panel: 0, dome: 1, ground: 2, flare: 3, shard: 4, glint: 5 } as const;
/** Added to a plate's spec index (its aParam) when the wall is gilded. */
export const PLATE_GILDED = 8;
const TAU = Math.PI * 2;

/** What an effect draws: Ward of Faith's dome, ground ring and glints, or
 * Hallowed Wall's ring of shield plates (hallowed_wall.ts), which shatter off
 * one by one as its absorb is worn down. */
export type WardParts = 'ward' | 'plates';
type WardKind = 'ward_of_faith' | 'hallowed_wall_plates';

interface Ward {
  active: boolean;
  id: number;
  age: number;
  seen: boolean;
  held: boolean;
  value: number;
  peak: number;
  remaining: number;
  /** Seconds since the ward last absorbed a hit. */
  hitAge: number;
  /** Per plate: the ward age it shattered at, or -1 while it stands. */
  lostAt: number[];
  /** 0 holding, 1 expired (the plates fold away), 2 broken (they shatter). */
  ending: 0 | 1 | 2;
  endAge: number;
  floor: number;
  /** The spec icon the plates bear (PALADIN_SPEC_EMBLEMS index). */
  spec: number;
  /** Hallowed Wall empowered by Ascension: gold-rimmed, brighter-edged plates. */
  gilded: boolean;
  /** How much of the ward draws, read as it is raised (or first seen). */
  detail: PaladinVfxDetail;
  /** The fold or shatter for that detail, seconds. */
  endFor: number;
  /** A lost plate's shards fly this long at that detail, seconds. */
  shardLife: number;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function ramp(t: number, from: number, to: number): number {
  const x = clamp01((t - from) / (to - from));
  return x * x * (3 - 2 * x);
}
function easeOutBack(t: number): number {
  const c = 1.6,
    u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}
function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Ward of Faith and Hallowed Wall, the Paladin's holy shields, drawn by one
 * effect in two parts.
 *
 * Ward of Faith (parts 'ward'): the off-hand sigil is raised with a flash and
 * a faint lattice dome closes over the Paladin, a rune flash and a shock ring
 * on the ground and glints drifting up round it. The dome ripples with every
 * absorbed hit and dims as the ward is worn down; broken, it swells and
 * flashes; run out, it fades.
 *
 * Hallowed Wall (parts 'plates'): six kite-shield plates of light spin out of
 * the raised sigil and lock into a ring round the Paladin, each bearing the
 * caster's spec icon, and circle slowly. Each plate carries a sixth of the
 * absorb: as it is worn down they shatter off one by one, so what is left
 * reads at a glance. Broken, the last plates burst into shards; run out, they
 * rise, fold away and fade.
 */
export class WardOfFaith {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<WardKind>;
  private readonly kind: WardKind;
  private readonly wards: Ward[] = Array.from({ length: WARD_CAPACITY }, () => ({
    active: false,
    id: -1,
    age: 0,
    seen: false,
    held: false,
    value: 0,
    peak: 0,
    remaining: 0,
    hitAge: 99,
    lostAt: new Array<number>(WARD_PANELS).fill(-1),
    ending: 0,
    endAge: 0,
    floor: 0,
    spec: 1,
    gilded: false,
    detail: 'full' as PaladinVfxDetail,
    endFor: WARD_END,
    shardLife: SHARD_LIFE,
  }));
  /** Each Paladin's spec icon, kept from their casts for a ward first seen mid-way. */
  private readonly specs = new Map<number, number>();
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly params = new Float32Array(VERTICES);
  private readonly feet = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  private vertex = 0;
  private time = 0;
  private param = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly camera?: THREE.Camera,
    private readonly parts: WardParts = 'ward',
  ) {
    this.kind = parts === 'plates' ? 'hallowed_wall_plates' : 'ward_of_faith';
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aUv', this.uvs, 2],
      ['aShape', this.shapes, 1],
      ['aTime', this.times, 1],
      ['aParam', this.params, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      uniforms: paladinSpecIconUniforms(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aColor; attribute float aAlpha, aShape, aTime, aParam; attribute vec2 aUv;
        varying vec3 vColor; varying float vAlpha, vShape, vTime, vParam; varying vec2 vUv;
        ${GROUND_DEPTH_PULL_GLSL}
        void main(){vColor=aColor;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vParam=aParam;vUv=aUv;
          // The plates stand in the world round the body; the ground ring lies on
          // the floor; the dome and sparks are pulled clear of the terrain.
          float pull=aShape<0.5?0.0:(aShape>1.5&&aShape<2.5?${GROUND_DEPTH_PULL.toFixed(2)}:0.5);
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime, vParam; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.95,0.82);
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${PALADIN_RUNE_GLSL}
        ${PALADIN_SPEC_EMBLEM_GLSL}
        ${PALADIN_SPEC_ICON_GLSL}
        const vec3 ROSE=vec3(1.3,0.72,0.55);
        // A heater shield, x across and y up: a flat, faintly arched top and
        // sides that sweep in to the point at y = -1.
        float shieldDist(vec2 p){
          float w=0.78*(1.0-pow(clamp(-p.y,0.0,1.0),1.7));
          float side=(abs(p.x)-w)*0.85;
          float top=p.y-(0.84-0.1*p.x*p.x);
          return max(max(side,top),-1.0-p.y);
        }
        // Distance to the nearest edge of a hex lattice cell.
        float hexEdge(vec2 q){
          vec2 r=vec2(1.0,1.7320508);
          vec2 h=r*0.5;
          vec2 a=mod(q,r)-h;
          vec2 b=mod(q-h,r)-h;
          vec2 g=dot(a,a)<dot(b,b)?a:b;
          vec2 ag=abs(g);
          return 0.5-max(dot(ag,vec2(0.5,0.8660254)),ag.x);
        }
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float mask;
          vec3 color=vColor;
          if(vShape>4.5){
            // A glint of light drifting up round the ward.
            float star=exp(-abs(p.x)*18.0)*exp(-abs(p.y)*3.0)+exp(-abs(p.y)*18.0)*exp(-abs(p.x)*3.0);
            mask=(star+exp(-r*r*20.0))*(1.0-smoothstep(0.8,1.0,r));
            color=mix(vColor,HOT,0.6);
          } else if(vShape>3.5){
            // A shard of a broken plate.
            vec2 q=abs(p);
            float d=q.x+q.y*0.35-0.35;
            mask=(1.0-smoothstep(-0.05,0.02,d))*0.9+exp(-max(d,0.0)*10.0)*0.3;
            mask*=1.0-smoothstep(0.85,1.0,max(q.x,q.y));
            color=mix(vColor,HOT,0.5);
          } else if(vShape>2.5){
            float core=exp(-r*r*14.0);
            float spokes=exp(-abs(p.y)*26.0)*exp(-abs(p.x)*2.5)+exp(-abs(p.x)*26.0)*exp(-abs(p.y)*2.5);
            mask=(core*1.4+exp(-r*r*7.0)*0.3+spokes*0.5*(1.0-smoothstep(0.3,0.95,r)))*(1.0-smoothstep(0.5,1.0,r));
            color=mix(vColor,HOT,core);
          } else if(vShape>1.5){
            // The ground: runes flash as the plates lock, a shock leaves the rim,
            // and a thin ring stays under the plates while the ward holds.
            float grow=1.0-sq(max(1.0-clamp(t/0.45,0.0,1.0),0.0));
            float runes=paladinRuneRing(p,0.8,0.94)*exp(-t*1.3)*smoothstep(0.0,0.12,t);
            float shock=band(r,0.25+0.75*grow,0.03+0.05*grow)*(1.0-grow);
            float rim=band(r,0.74,0.018)*(0.35+0.35*vParam);
            float pool=exp(-r*r*5.0)*exp(-t*2.5)*0.5;
            mask=(runes+shock*1.2+rim+pool)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,shock*0.6+pool);
          } else if(vShape>0.5){
            // The dome: a bright rim, a hex lattice showing towards the edge,
            // and a ripple running out through it from each absorbed hit.
            float rim=band(r,0.86,0.04);
            float fres=sq(smoothstep(0.45,0.86,r))*(1.0-smoothstep(0.86,0.99,r));
            float line=1.0-smoothstep(0.0,0.06,hexEdge(p*5.5+vec2(0.0,t*0.08)));
            float ripple=band(r,vParam*2.6,0.12)*exp(-vParam*2.5);
            mask=(rim*0.5+fres*0.1+line*(0.012+fres*0.08+ripple*1.4)+ripple*0.35)*(1.0-smoothstep(0.88,1.0,r));
            color=mix(vColor,HOT,rim*0.4+ripple*0.6);
          } else {
            // A shield plate of Hallowed Wall: a bright outer rim and a fine
            // gilded inner one, light pooled at its edges and rising from its
            // foot, the caster's spec icon (vParam) haloed at its heart, and a
            // band of light sweeping up over it. Gilded by Ascension (vParam
            // carries ${PLATE_GILDED} more): a deep gold rim round the outside
            // and a brighter edge.
            float gilt=step(${(PLATE_GILDED - 0.5).toFixed(1)},vParam);
            float spec=vParam-${PLATE_GILDED.toFixed(1)}*gilt;
            vec2 q=p*1.3;
            float d=shieldDist(q);
            float inside=1.0-smoothstep(-0.02,0.02,d);
            float rim=exp(-abs(d+0.04)*40.0);
            float gild=exp(-abs(d+0.12)*80.0)*inside*0.6;
            float edges=exp(d*7.0)*inside*0.22;
            float rise=(1.0-smoothstep(-1.0,0.5,q.y))*inside*0.2;
            vec2 e=(q-vec2(0.0,-0.02))/0.46;
            // The approved line icon engraved over a faint solid fill, with its
            // rose accents; the built-in emblem until the atlas loads.
            float emblem=paladinSpecEmblem(e,spec)*inside;
            float halo=exp(-dot(e,e)*1.6)*0.18*inside;
            float accent=0.0;
            if(uSpecIconsReady>0.5){
              vec3 icon=paladinSpecIcon((q-vec2(0.0,-0.06))/0.56,spec);
              float line=1.0-smoothstep(0.0,0.016,icon.y-0.006);
              float fill=1.0-smoothstep(-0.01,0.01,icon.x);
              emblem=(line*0.95+fill*0.22)*inside;
              halo=exp(-max(icon.x,0.0)*10.0)*0.22*inside;
              accent=icon.z*fill;
            }
            float sweep=exp(-sq((q.y-(fract(t*0.45)*2.6-1.3))/0.12))*0.35*inside;
            float glow=exp(-max(d,0.0)*9.0)*0.25*(1.0-inside);
            float goldRim=exp(-abs(d-0.05)*38.0)*gilt;
            mask=inside*0.05+edges*(1.0+gilt)+rise+sweep+emblem*1.05+halo+rim*(1.15+0.75*gilt)+gild+glow
              +goldRim*0.9;
            mask*=1.0-smoothstep(0.75,1.0,max(abs(p.x),abs(p.y)));
            color=mix(vColor,HOT,clamp(rim*0.5+gild*0.5+emblem*0.45+sweep,0.0,1.0));
            color=mix(color,ROSE,accent*0.7);
            color=mix(color,vec3(1.45,0.98,0.32),clamp(goldRim,0.0,1.0)*0.85);
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    material.name = 'ward_of_faith:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = parts === 'plates' ? 'hallowed-wall-plates' : 'ward-of-faith';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([[this.kind, geometry]]), material);
  }

  private ready(): boolean {
    return !this.disposed && this.preparation.ready(this.kind);
  }

  private find(id: number): Ward | undefined {
    return this.wards.find((w) => w.active && w.id === id && w.ending === 0);
  }

  private claim(id: number): Ward {
    let w = this.wards.find((s) => s.active && s.id === id) ?? this.wards.find((s) => !s.active);
    if (!w) {
      w = this.wards[0];
      for (const s of this.wards) if (s.age > w.age) w = s;
    }
    w.active = true;
    w.id = id;
    w.age = 0;
    w.seen = false;
    w.held = false;
    w.value = 0;
    w.peak = 0;
    w.remaining = 0;
    w.hitAge = 99;
    w.lostAt.fill(-1);
    w.ending = 0;
    w.endAge = 0;
    w.floor = Number.NaN;
    w.spec = this.specs.get(id) ?? 1;
    w.gilded = false;
    w.detail = paladinVfxDetailNow();
    w.endFor = paladinDetailLinger(WARD_END, w.detail);
    w.shardLife = paladinDetailLinger(SHARD_LIFE, w.detail);
    return w;
  }

  /** Ward of Faith cast by `id`: the plates spin out of the sigil and lock in,
   * bearing the icon of `spec` (the caster's specialization, when known). */
  raise(id: number, spec?: string | null): boolean {
    if (!this.ready() || !this.anchor(id, 0, this.feet)) return false;
    if (spec) this.learnSpec(id, spec);
    this.claim(id);
    return true;
  }

  /** Remembers `id` as a Paladin of `spec`, for the icon their ward bears. */
  learnSpec(id: number, spec: string): void {
    const i = paladinSpecEmblemIndex(spec, -1);
    if (i < 0) return;
    this.specs.set(id, i);
    for (const w of this.wards) if (w.active && w.id === id) w.spec = i;
  }

  /** Once a frame while `id` holds the ward's absorb aura (`gilded`: Hallowed
   * Wall empowered by Ascension). */
  hold(id: number, value: number, remaining: number, gilded = false): void {
    if (!this.ready()) return;
    let w = this.find(id);
    if (!w) {
      // Already up (seen joining mid-ward): no fly-out.
      w = this.claim(id);
      w.age = WARD_INTRO;
    }
    const v = Number.isFinite(value) ? Math.max(0, value) : 0;
    if (w.held && v > w.value * 1.05 + 1e-6) {
      // Recast over a worn ward: fresh plates.
      w.lostAt.fill(-1);
      w.peak = v;
    } else if (w.held && v < w.value - Math.max(1e-6, w.peak * 0.004)) w.hitAge = 0;
    w.peak = Math.max(w.peak, v);
    w.value = v;
    w.remaining = Number.isFinite(remaining) ? remaining : 0;
    w.gilded = gilded;
    w.seen = true;
    w.held = true;
  }

  /** Whether `id`'s plates are gilded by Ascension. */
  gilded(id: number): boolean {
    return this.wards.some((s) => s.active && s.id === id && s.gilded);
  }

  update(dt: number, reduced = false): void {
    if (this.disposed) return;
    bindPaladinSpecIcons(this.mesh.material);
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
    for (const w of this.wards) if (w.active) this.ward(w, dt, reduced);
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

  /** Plates still standing. */
  standing(id: number): number {
    const w = this.wards.find((s) => s.active && s.id === id);
    return w ? w.lostAt.filter((at) => at < 0).length : 0;
  }

  private ward(w: Ward, dt: number, reduced: boolean): void {
    w.age += dt;
    w.hitAge += dt;
    if (w.ending === 0) {
      if (!w.seen && (w.held || w.age > WARD_ORPHAN)) {
        // The aura is gone: run out, or broken with absorb still to spend.
        w.ending = w.held && w.remaining > WARD_EXPIRED ? 2 : 1;
        w.endAge = w.age;
        if (w.ending === 2)
          for (let i = 0; i < WARD_PANELS; i++) if (w.lostAt[i] < 0) w.lostAt[i] = w.age;
      } else if (w.peak > 0) {
        // Each plate is a sixth of the absorb: shatter the ones spent.
        const want = Math.max(
          0,
          Math.min(WARD_PANELS, Math.ceil((w.value / w.peak) * WARD_PANELS - 1e-3)),
        );
        for (
          let i = WARD_PANELS - 1, left = w.lostAt.filter((at) => at < 0).length;
          i >= 0 && left > want;
          i--
        )
          if (w.lostAt[i] < 0) {
            w.lostAt[i] = w.age;
            left--;
          }
      }
    }
    w.seen = false;
    const endK = w.ending ? clamp01((w.age - w.endAge) / w.endFor) : 0;
    if ((w.ending && endK >= 1) || !this.anchor(w.id, 0, this.feet)) {
      w.active = false;
      return;
    }
    if (!Number.isFinite(w.floor))
      w.floor = effectFloor(this.groundY?.(this.feet.x, this.feet.z), this.feet.y);
    const topY = this.anchor(w.id, 1, this.top) ? this.top.y : this.feet.y + 1.8;
    const h = Math.max(0.8, topY - this.feet.y);
    const s = h / 1.8;
    const cx = this.feet.x,
      cz = this.feet.z,
      cy = this.feet.y + h * PALADIN_BODY_FIT.wardCenter;
    const floor = this.feet.y;
    const f = w.peak > 0 ? w.value / w.peak : 1;
    const hit = Math.exp(-w.hitAge * 5);
    const fold = w.ending === 1 ? endK : 0;
    const R = PALADIN_BODY_FIT.wardRadius * s,
      halfW = 0.36 * s * (1.3 / 1.1),
      halfH = 0.5 * s * (1.3 / 1.1);
    const sigilY = topY + 0.15 * h;
    const settled = ramp(w.age, 0.25, 0.6);
    const { accents, secondary } = paladinDetailScale(w.detail);

    // The sigil's flash as the plates leave it, and the ward closing.
    this.time = w.age;
    if (w.age < 0.8 && w.ending === 0 && accents)
      this.billboard(cx, sigilY, cz, 0.9 * s, IVORY, Math.exp(-w.age * 5) * 1.2, SHAPE.flare);
    const plates = this.parts === 'plates';
    const locked = w.age - WARD_INTRO;
    if (plates && locked > 0 && locked < 0.6 && accents)
      this.billboard(cx, cy, cz, 1.6 * s, GOLD, Math.exp(-locked * 6) * 0.6, SHAPE.flare);
    if (w.ending === 2 && endK < 0.5 && accents)
      this.billboard(cx, cy, cz, 1.6 * s, IVORY, (1 - endK * 2) * 0.6, SHAPE.flare);

    if (!plates) {
      // The ground under the ward.
      const groundR = R * 1.35;
      this.param = f;
      if (secondary)
        this.quad(
          cx,
          w.floor + 0.04,
          cz,
          groundR,
          0,
          0,
          0,
          0,
          groundR,
          GOLD,
          1 - endK,
          SHAPE.ground,
        );

      // The dome: swells and flashes as the ward breaks, fades as it runs out.
      const domeR = 1.25 * s * (1 + (w.ending === 2 ? 0.25 * endK : 0));
      const domeA =
        settled * (0.45 + 0.35 * f) * (1 - endK) * (w.ending === 2 ? 1 + (1 - endK) * 0.6 : 1);
      this.param = w.ending === 2 ? w.age - w.endAge : w.hitAge;
      this.billboard(cx, cy + 0.05 * h, cz, domeR, GOLD, domeA, SHAPE.dome);
      this.glints(w, fold, endK, settled, R, cx, cz, floor, h, s, reduced);
      return;
    }

    // The plates, standing further out and larger than the ward's radius, a
    // pulse of light running round the ring from plate to plate.
    const reach = R * PLATE_REACH;
    const pulseAt = reduced ? -1 : (w.age / PLATE_PULSE) % 1;
    const spin = w.age * SPIN;
    for (let i = 0; i < WARD_PANELS; i++) {
      const start = 0.06 + i * 0.04;
      const lock = clamp01((w.age - start) / 0.36);
      const out = easeOutBack(lock);
      if (w.lostAt[i] >= 0) {
        if (!reduced) this.shatter(w, i, cx, cy, cz, reach, s);
        continue;
      }
      const ang = spin + (i * TAU) / WARD_PANELS + (1 - lock) * 2.2 + fold * 1.2;
      const nx = Math.cos(ang),
        nz = Math.sin(ang);
      const r = 0.1 * s + (reach - 0.1 * s) * out;
      const y = sigilY + (cy - sigilY) * out + fold * fold * 0.5 * h;
      const scale = (0.35 + 0.65 * Math.min(1, out)) * (1 - 0.7 * fold) * PLATE_SIZE;
      // The top of each plate leans in over the Paladin.
      const tilt = 0.2,
        ux = -nx * Math.sin(tilt),
        uy = Math.cos(tilt),
        uz = -nz * Math.sin(tilt);
      const flash = lock >= 1 ? Math.exp(-(w.age - start - 0.36) * 7) : 0;
      let gap = Math.abs(i / WARD_PANELS - pulseAt);
      gap = Math.min(gap, 1 - gap);
      const pulse = pulseAt < 0 ? 0 : Math.exp(-((gap * 6) ** 2)) * settled;
      const alpha =
        Math.min(1, lock * 3) *
        (0.55 + 0.45 * f) *
        (1 + hit * 0.8 + flash * 1.2 + pulse * 0.6) *
        (1 - fold);
      this.time = w.age + i * 0.7;
      this.param = w.spec + (w.gilded ? PLATE_GILDED : 0);
      this.quad(
        cx + nx * r,
        y,
        cz + nz * r,
        -nz * halfW * scale,
        0,
        nx * halfW * scale,
        ux * halfH * scale,
        uy * halfH * scale,
        uz * halfH * scale,
        GOLD,
        alpha,
        SHAPE.panel,
      );
    }
  }

  /** Glints drifting up round the ward; a last flight of them as it folds away. */
  private glints(
    w: Ward,
    fold: number,
    endK: number,
    settled: number,
    R: number,
    cx: number,
    cz: number,
    floor: number,
    h: number,
    s: number,
    reduced: boolean,
  ): void {
    if (reduced) return;
    this.time = w.age;
    const glints = paladinDetailCount(GLINTS, w.detail);
    for (let j = 0; j < glints; j++) {
      const phase = (w.age * (0.35 + fold * 0.8) + j / glints) % 1;
      const ang = j * 2.4 + w.age * 0.3;
      const rr = R * (0.85 + 0.3 * hash(j, 1));
      const alpha = Math.sin(phase * Math.PI) * 0.6 * settled * (w.ending === 2 ? 1 - endK : 1);
      this.billboard(
        cx + Math.cos(ang) * rr,
        floor + phase * h * 1.1,
        cz + Math.sin(ang) * rr,
        (0.07 + 0.05 * hash(j, 2)) * s,
        j % 3 ? GOLD : IVORY,
        alpha,
        SHAPE.glint,
      );
    }
  }

  /** A plate that gave way: a flash where it stood and its shards thrown out. */
  private shatter(
    w: Ward,
    i: number,
    cx: number,
    cy: number,
    cz: number,
    R: number,
    s: number,
  ): void {
    const k = (w.age - w.lostAt[i]) / w.shardLife;
    if (k >= 1) return;
    const ang = w.lostAt[i] * SPIN + (i * TAU) / WARD_PANELS;
    const nx = Math.cos(ang),
      nz = Math.sin(ang);
    const px = cx + nx * R,
      pz = cz + nz * R;
    this.time = k;
    this.param = 0;
    if (k < 0.35 && paladinDetailScale(w.detail).accents)
      this.billboard(px, cy, pz, 0.6 * s, IVORY, (1 - k / 0.35) * 1.2, SHAPE.flare);
    const shards = paladinDetailCount(SHARDS, w.detail);
    for (let j = 0; j < shards; j++) {
      const spread = (hash(i * 7 + j, 3) - 0.5) * 1.6;
      const dx = nx * Math.cos(spread) - nz * Math.sin(spread),
        dz = nz * Math.cos(spread) + nx * Math.sin(spread);
      const dist = k * (0.8 + 0.8 * hash(i * 7 + j, 4)) * s;
      const lift =
        (Math.sin(k * Math.PI) * 0.35 - k * k * 0.5 + (hash(i * 7 + j, 5) - 0.5) * 0.5) * s;
      this.billboard(
        px + dx * dist,
        cy + lift,
        pz + dz * dist,
        (0.09 + 0.05 * hash(i * 7 + j, 6)) * s * (1 - k * 0.4),
        j % 2 ? GOLD : IVORY,
        (1 - k) ** 1.5,
        SHAPE.shard,
        j * 1.3 + k * 8,
      );
    }
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
    this.params[i] = this.param;
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
    const cs = Math.cos(spin) * size,
      sn = Math.sin(spin) * size;
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

  clear(): void {
    for (const w of this.wards) w.active = false;
    this.specs.clear();
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
    if (errors.length)
      throw new AggregateError(
        errors,
        `${this.parts === 'plates' ? 'Hallowed Wall' : 'Ward of Faith'} cleanup failed`,
      );
  }
}

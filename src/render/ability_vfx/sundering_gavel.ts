import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROJECTILE_REACH, PROJECTILE_SPEED } from '../../sim/projectile_travel';
import { DT } from '../../sim/types';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm, type CrestPrewarmHost } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailLinger,
  paladinDetailScale,
} from './paladin_vfx_detail_core';

// Detail: core = the four solid gavels landing as one cross-hammer, the
// sounding block of runes (its shock is the block's own shader), the flash on
// the joined head as they land, and the stun's two rune shackles; secondary =
// the blow's flare on the target's head; accents = each gavel's appearing
// flash, the blow's spun gold flare and the glints circling the stunned head.
// The motes the hammer dissolves into scale with the mote count; the strike's
// fade tail (after the hop) and the shackles' release scale with the linger.

export const GAVEL_STRIKES = 6;
export const GAVEL_HOLDS = 8;
/** Gavels in the sentence, one swinging in from each side of the target. */
export const GAVEL_COUNT = 4;
/** Half the width of a gavel's head, in gavel units (square across the handle). */
const BLOCK_HALF = 0.25;
/** Half the length of that head, sledgehammer-long in the line of the swing. */
const BLOCK_HALF_Y = 0.42;
/** Where the heads meet: their centre this far (gavel units) above the top of
 * the target's head, so the striking faces rest on it. */
const HEAD_LIFT = BLOCK_HALF_Y + 0.05;
/** A gavel's size, world units per gavel unit, before the size band. */
const GAVEL_SCALE = 1.05;
/** Seconds of the swing's own clock from the cast until the gavels land on the
 * target's head; the real strike is timed to the stun (gavelContactTime). */
export const GAVEL_CONTACT = 0.2;
/** The gavels hang raised overhead until this point of the swing's clock. */
const GAVEL_RAISED = 0.1;
/** The soonest the gavels land after the cast, so they still read as a chop. */
export const GAVEL_CONTACT_MIN = 0.1;
/** The latest: the stun's own flight at the ability's range, and some chase. */
export const GAVEL_CONTACT_MAX = 0.6;
/** Seconds the strike (gavels, block, flashes) plays for. */
export const GAVEL_LIFE = 1.2;
/** The shackles' break once the stun lifts, seconds. */
export const GAVEL_RELEASE = 0.3;
const GLINTS = 4;
/** Motes each gavel dissolves into. */
const MOTES = 5;
/** Per strike: each gavel's appearing flash and motes, the landing flash, the
 * block, the blow's two flares. Per hold: two bands, glints. */
const STRIKE_QUADS = GAVEL_COUNT * (1 + MOTES) + 4;
const HOLD_QUADS = 2 + GLINTS;
const VERTICES = (GAVEL_STRIKES * STRIKE_QUADS + GAVEL_HOLDS * HOLD_QUADS) * 6;

const GOLD = new THREE.Color(0xecc27c).multiplyScalar(1.3);
const IVORY = new THREE.Color(0xfff4d8).multiplyScalar(1.4);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime', 'aParam'] as const;
const SHAPE = { flare: 0, block: 1, band: 2, glint: 3, mote: 4 } as const;
const DEG = Math.PI / 180;
/** Gavel space: head centred on the origin, handle along +x out to the grip. */
const GRIP = 1.3;
/** A gavel's handle lies level as it lands (and where it settles). */
const CONTACT_LEAN = 90 * DEG;

interface Strike {
  active: boolean;
  source: number;
  target: number;
  age: number;
  /** Seconds after the cast the stun lands, when the gavels strike. */
  contact: number;
  landed: boolean;
  floor: number;
  /** The heading the gavels are set round (the view's, else towards the caster). */
  bearing: number;
  /** How much of the strike draws, read as it is cast. */
  detail: PaladinVfxDetail;
}
interface Hold {
  active: boolean;
  id: number;
  seen: boolean;
  presence: number;
  /** Seconds since the stun lifted, or -1 while it holds. */
  release: number;
  /** How much of the shackles draws, read as the stun takes hold. */
  detail: PaladinVfxDetail;
  /** The shackles' break for that detail, seconds. */
  releaseFor: number;
}

/** The strike's clock from the hop's end on: the dissolve after it. */
const GAVEL_TAIL = 0.5;

/** The swing's clock `t` with its fade tail (everything after GAVEL_TAIL)
 * played over `linger` of its authored length, so a lighter strike keeps the
 * whole chop and hop and dissolves sooner. */
export function gavelTailPhase(t: number, linger: number): number {
  if (t <= GAVEL_TAIL || !(linger > 0) || linger >= 1) return t;
  return GAVEL_TAIL + (t - GAVEL_TAIL) / linger;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
function ramp(t: number, from: number, to: number): number {
  const x = clamp01((t - from) / (to - from));
  return x * x * (3 - 2 * x);
}
function hash(i: number, salt: number): number {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * One gavel, in gavel units: a sledgehammer head, a block longer in the line
 * of the swing than it is wide, with an inset face raised on each striking
 * end, centred on the origin, and a round handle along +x out to the
 * grip with a collar at the head, two bands and a capped end. Four of them
 * turned a quarter apart share one head: the cross-hammer they land as.
 */
function gavelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(BLOCK_HALF * 2, BLOCK_HALF_Y * 2, BLOCK_HALF * 2),
  ];
  for (const y of [1, -1]) {
    const face = new THREE.BoxGeometry(BLOCK_HALF * 1.45, 0.05, BLOCK_HALF * 1.45);
    face.translate(0, y * (BLOCK_HALF_Y + 0.025), 0);
    parts.push(face);
  }
  const along = (r0: number, r1: number, radius: number) => {
    const g = new THREE.CylinderGeometry(radius, radius, r1 - r0, 14);
    g.rotateZ(-Math.PI / 2);
    g.translate((r0 + r1) / 2, 0, 0);
    return g;
  };
  parts.push(along(BLOCK_HALF - 0.02, GRIP, 0.07));
  parts.push(along(BLOCK_HALF, BLOCK_HALF + 0.1, 0.1));
  parts.push(along(0.695, 0.745, 0.09));
  parts.push(along(0.995, 1.045, 0.09));
  parts.push(along(GRIP - 0.1, GRIP + 0.06, 0.11));
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error('Sundering Gavel geometry failed to merge');
  return merged;
}

/**
 * Seconds from the cast until the stun lands on a target `distance` yards
 * away. The sim flies Sundering Gavel as a homing projectile
 * (src/sim/projectile_travel.ts): from the tick after the cast it steps
 * PROJECTILE_SPEED * DT a tick and lands on the tick it comes within reach,
 * so the gavels are timed to that tick (about 0.4 s at the 10 yard range).
 */
export function gavelContactTime(distance: number): number {
  const step = PROJECTILE_SPEED * DT;
  const reach = Math.max(PROJECTILE_REACH, step);
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const ticks = 1 + Math.max(0, Math.ceil((d - reach) / step - 1e-9));
  return Math.min(GAVEL_CONTACT_MAX, Math.max(GAVEL_CONTACT_MIN, ticks * DT));
}

/** The swing's own clock `age` seconds after the cast, for gavels that land at
 * `contact`: a later stun holds them raised overhead longer before the same
 * wind-up and chop; a sooner one plays the whole approach faster. */
export function gavelPhase(age: number, contact: number): number {
  const extra = contact - GAVEL_CONTACT;
  if (age >= contact) return age - extra;
  if (extra < 0) return (age * GAVEL_CONTACT) / contact;
  return age < GAVEL_RAISED ? age : Math.max(GAVEL_RAISED, age - extra);
}

/** A gavel's swing about its grip, radians (0 as it lands). */
export function gavelSwing(age: number): number {
  if (age < GAVEL_RAISED) return -110 * DEG;
  if (age < 0.14) return (-110 - 15 * ramp(age, 0.1, 0.14)) * DEG;
  if (age < GAVEL_CONTACT) {
    const u = clamp01((age - 0.14) / (GAVEL_CONTACT - 0.14));
    return -125 * DEG * (1 - u * u);
  }
  if (age < 0.32) return -14 * DEG * Math.sin(ramp(age, GAVEL_CONTACT, 0.32) * Math.PI * 0.5);
  return -14 * DEG * (1 - ramp(age, 0.32, 0.5));
}

/**
 * Sundering Gavel, the sentence. Over the target a sounding block of Paladin
 * runes lights on the ground and four solid golden gavels appear raised high
 * overhead on its four sides; they wind up and chop down together, their
 * square heads meeting on the same spot just above the target's head so the
 * four land as one hammer, one head with four ornate handles lying level in a
 * cross, with a flash, a shock from the block, the ground cracking and stones
 * kicked loose. The hammer hops, holds, and dissolves upward in motes. Through
 * the stun two rings of runes shackle the target, counter-rotating at chest
 * and knee, with golden glints circling the head; when it lifts they snap
 * outward and fade.
 */
export class SunderingGavel {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Warms the light and the solid gavel programs together. */
  readonly preparation: {
    units(host: CrestPrewarmHost): ReturnType<CrestPrewarm['units']>;
    ready(): boolean;
  };
  /** The solid gavels: GAVEL_COUNT for each strike slot, in slot order. */
  readonly gavels: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  private readonly lightPrep: CrestPrewarm<'sundering_light'>;
  private readonly gavelPrep: CrestPrewarm<'sundering_gavel'>;
  private readonly strikes: Strike[] = Array.from({ length: GAVEL_STRIKES }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
    contact: GAVEL_CONTACT,
    landed: false,
    floor: 0,
    bearing: 0,
    detail: 'full' as PaladinVfxDetail,
  }));
  private readonly holds: Hold[] = Array.from({ length: GAVEL_HOLDS }, () => ({
    active: false,
    id: -1,
    seen: false,
    presence: 0,
    release: -1,
    detail: 'full' as PaladinVfxDetail,
    releaseFor: GAVEL_RELEASE,
  }));
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly params = new Float32Array(VERTICES);
  private readonly feet = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private readonly other = new THREE.Vector3();
  private readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  private vertex = 0;
  private time = 0;
  private param = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly camera?: THREE.Camera,
    /** The blow landing: the ground's crack, dust and stones (x, floor y, z),
     * with the detail the strike was cast at. */
    private readonly onImpact?: (x: number, y: number, z: number, detail: PaladinVfxDetail) => void,
  ) {
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
          // The block lies on the floor; the shackle bands stand round the body;
          // the flares and sparks are pulled a little clear of the target.
          float pull=aShape>0.5&&aShape<1.5?${GROUND_DEPTH_PULL.toFixed(2)}:(aShape>1.5&&aShape<2.5?0.0:0.5);
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime, vParam; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.95,0.82);
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${PALADIN_RUNE_GLSL}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float mask;
          vec3 color=vColor;
          if(vShape>3.5){
            mask=exp(-r*r*9.0)*(1.0-smoothstep(0.6,1.0,r));
            color=mix(vColor,HOT,0.6);
          } else if(vShape>2.5){
            float star=exp(-abs(p.x)*16.0)*exp(-abs(p.y)*3.0)+exp(-abs(p.y)*16.0)*exp(-abs(p.x)*3.0);
            mask=(star+exp(-r*r*18.0))*(1.0-smoothstep(0.6,1.0,r));
            color=mix(vColor,HOT,0.6);
          } else if(vShape>1.5){
            // A shackle: a ring of runes with bright edges, lying round the body.
            float runes=paladinRuneRing(p,0.72,0.9);
            float edges=band(r,0.7,0.02)+band(r,0.92,0.02);
            mask=(runes*0.9+edges*0.8+band(r,0.81,0.12)*0.12)*(1.0-smoothstep(0.93,1.0,r));
            color=mix(vColor,HOT,edges*0.5);
          } else if(vShape>0.5){
            // The sounding block: runes drawing round, a pool of light, and the
            // shock of the blow (vParam: seconds since it landed).
            float runes=paladinRuneRing(p,0.66,0.84)*smoothstep(0.0,0.12,t);
            float disc=exp(-r*r*3.0)*0.35*smoothstep(0.0,0.1,t);
            float since=vParam;
            float grow=since<0.0?0.0:1.0-sq(max(1.0-since/0.35,0.0));
            float shock=since<0.0?0.0:band(r,0.2+0.75*grow,0.03+0.06*grow)*(1.0-grow);
            float flash=since<0.0?0.0:exp(-since*6.0)*exp(-r*r*2.5)*0.8;
            mask=(runes+band(r,0.88,0.015)*0.6+disc+shock*1.3+flash)*(1.0-smoothstep(0.93,1.0,r));
            color=mix(vColor,HOT,shock*0.6+flash*0.5);
          } else {
            float core=exp(-r*r*14.0);
            float spokes=exp(-abs(p.y)*26.0)*exp(-abs(p.x)*2.5)+exp(-abs(p.x)*26.0)*exp(-abs(p.y)*2.5);
            mask=(core*1.4+exp(-r*r*7.0)*0.3+spokes*0.5*(1.0-smoothstep(0.3,0.95,r)))*(1.0-smoothstep(0.5,1.0,r));
            color=mix(vColor,HOT,core);
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    material.name = 'sundering_gavel:light';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'sundering-gavel-light';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.lightPrep = new CrestPrewarm(scene, new Map([['sundering_light', geometry]]), material);

    // The solid gavels: lit gold with a bright rim, the head's edges glowing,
    // ridges running corner to corner on its top face and a spiral engraved
    // round the handle. uAlpha fades them, uFlash lights them as they appear
    // and as they land.
    const gavelGeo = gavelGeometry();
    const gavelMaterial = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 1 }, uFlash: { value: 0 } },
      transparent: true,
      toneMapped: false,
      vertexShader: `
        varying vec3 vNormal, vWorld, vLocal;
        void main(){vLocal=position;
          vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;
          vNormal=normalize(mat3(modelMatrix)*normal);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
      `,
      fragmentShader: `
        uniform float uAlpha, uFlash;
        varying vec3 vNormal, vWorld, vLocal;
        float sq(float x){return x*x;}
        void main(){
          vec3 n=normalize(vNormal);
          vec3 v=normalize(cameraPosition-vWorld);
          float diff=max(dot(n,normalize(vec3(0.3,1.0,0.2))),0.0);
          float fres=sq(1.0-max(dot(n,v),0.0));
          vec3 gold=vec3(1.0,0.55,0.16);
          vec3 hot=vec3(1.0,0.86,0.55);
          vec3 a=abs(vLocal);
          float head=step(max(a.x,a.z),${(BLOCK_HALF + 0.005).toFixed(3)});
          // The head: edges where two of its faces meet, ridges on its top face.
          vec3 e=a/vec3(${BLOCK_HALF.toFixed(2)},${(BLOCK_HALF_Y + 0.05).toFixed(2)},${BLOCK_HALF.toFixed(2)});
          float edges=step(0.9,e.x)*step(0.9,e.y)+step(0.9,e.y)*step(0.9,e.z)+step(0.9,e.x)*step(0.9,e.z);
          float ridge=(1.0-smoothstep(0.0,0.02,min(abs(vLocal.x-vLocal.z),abs(vLocal.x+vLocal.z))*0.7071))
            *step(${BLOCK_HALF_Y.toFixed(2)},a.y);
          // The handle: a spiral engraved along it.
          float engraving=sq(sin(vLocal.x*42.0+atan(vLocal.y,vLocal.z)*2.0))*(1.0-head);
          vec3 color=gold*(0.3+0.55*diff)+hot*(fres*0.6+min(edges,1.0)*0.5*head+ridge*0.6+engraving*0.2);
          color+=hot*uFlash;
          gl_FragColor=vec4(color*1.1,uAlpha);
          #include <colorspace_fragment>
        }
      `,
    });
    gavelMaterial.name = 'sundering_gavel:gavel';
    for (let i = 0; i < GAVEL_STRIKES; i++) {
      const strikeMaterial = i ? gavelMaterial.clone() : gavelMaterial;
      for (let k = 0; k < GAVEL_COUNT; k++) {
        const gavel = new THREE.Mesh(gavelGeo, strikeMaterial);
        gavel.name = 'sundering-gavel';
        gavel.userData.renderCategory = 'vfx';
        gavel.visible = false;
        gavel.frustumCulled = false;
        gavel.renderOrder = 4;
        gavel.matrixAutoUpdate = false;
        scene.add(gavel);
        this.gavels.push(gavel);
      }
    }
    this.gavelPrep = new CrestPrewarm(
      scene,
      new Map([['sundering_gavel', gavelGeo]]),
      gavelMaterial,
    );
    this.preparation = {
      units: (host) => [...this.lightPrep.units(host), ...this.gavelPrep.units(host)],
      ready: () =>
        this.lightPrep.ready('sundering_light') && this.gavelPrep.ready('sundering_gavel'),
    };
  }

  private ready(): boolean {
    return !this.disposed && this.preparation.ready();
  }

  /** Sundering Gavel cast by `source` on `target`: the gavels land as the
   * stun's projectile reaches the target (whether or not it takes). */
  strike(source: number, target: number): boolean {
    if (!this.ready() || !this.anchor(target, 0, this.feet)) return false;
    let s = this.strikes.find((x) => !x.active);
    if (!s) {
      s = this.strikes[0];
      for (const x of this.strikes) if (x.age > s.age) s = x;
    }
    s.active = true;
    s.source = source;
    s.target = target;
    s.age = 0;
    s.contact = gavelContactTime(
      source !== target && this.anchor(source, 0, this.other)
        ? Math.hypot(this.other.x - this.feet.x, this.other.z - this.feet.z)
        : 0,
    );
    s.landed = false;
    s.detail = paladinVfxDetailNow();
    s.floor = effectFloor(this.groundY?.(this.feet.x, this.feet.z), this.feet.y);
    // Set square to the view (the camera's heading), so from above the
    // handles make a plus and on screen none comes end-on.
    const m = this.camera?.matrixWorld.elements;
    s.bearing =
      m && Math.hypot(m[8], m[10]) > 1e-3
        ? Math.atan2(-m[10], -m[8])
        : source !== target && this.anchor(source, 0, this.other)
          ? Math.atan2(this.other.z - this.feet.z, this.other.x - this.feet.x)
          : 0;
    return true;
  }

  /** Once a frame while `target` is stunned by the gavel. */
  hold(target: number): void {
    if (!this.ready()) return;
    let h = this.holds.find((x) => x.active && x.id === target && x.release < 0);
    if (!h) {
      h = this.holds.find((x) => !x.active);
      if (!h) return;
      h.active = true;
      h.id = target;
      h.presence = 0;
      h.release = -1;
      h.detail = paladinVfxDetailNow();
      h.releaseFor = paladinDetailLinger(GAVEL_RELEASE, h.detail);
    }
    h.seen = true;
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
    for (const gavel of this.gavels) gavel.visible = false;
    for (let i = 0; i < this.strikes.length; i++) {
      const s = this.strikes[i];
      if (s.active) this.strike1(s, i, dt, reduced);
    }
    for (const h of this.holds) if (h.active) this.hold1(h, dt, reduced);
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

  private strike1(s: Strike, slot: number, dt: number, reduced: boolean): void {
    s.age += dt;
    const scale = paladinDetailScale(s.detail);
    const t = gavelTailPhase(gavelPhase(s.age, s.contact), scale.linger);
    if (t >= GAVEL_LIFE || !this.anchor(s.target, 0, this.feet)) {
      s.active = false;
      return;
    }
    const topY = this.anchor(s.target, 1, this.top) ? this.top.y : this.feet.y + 1.8;
    const h = Math.max(0.8, topY - this.feet.y);
    const sc = h / 1.8;
    const x = this.feet.x,
      z = this.feet.z;
    // A gavel's size: gavel units to world, kept within a narrow band so they
    // read the same over a small foe or a giant.
    const S = GAVEL_SCALE * Math.min(1.25, Math.max(0.85, sc));
    // The gavels' own scale for their flashes, motes and drift.
    const gs = S / GAVEL_SCALE;
    const since = t - GAVEL_CONTACT;
    if (since >= 0 && !s.landed) {
      s.landed = true;
      this.onImpact?.(x, s.floor, z, s.detail);
    }
    // The sounding block beneath the target.
    const blockR = 1.15 * sc;
    const blockA = ramp(t, 0, 0.1) * (1 - ramp(t, 0.6, GAVEL_LIFE));
    this.time = t;
    this.param = since;
    this.quad(x, s.floor + 0.04, z, blockR, 0, 0, 0, 0, blockR, GOLD, blockA, SHAPE.block);

    // The four solid gavels, each chopping down in its own upright plane from
    // its side of the target: raised overhead and leaning out (further as they
    // wind up), then down over the target to land level, the four heads on
    // one spot so they read as a single head with four handles. After landing
    // the whole hammer hops, holds and fades.
    const appear = ramp(t, 0, 0.08);
    const rise = ramp(t, 0.55, GAVEL_LIFE) * 0.35 * gs;
    const hop = since >= 0 ? 0.12 * S * Math.sin(Math.PI * clamp01(since / 0.3)) : 0;
    const lean = CONTACT_LEAN - gavelSwing(t);
    const size = S * (0.7 + 0.3 * appear);
    const material = this.gavels[slot * GAVEL_COUNT]?.material;
    if (material) {
      material.uniforms.uAlpha.value = appear * (1 - ramp(t, 0.55, 1.0));
      material.uniforms.uFlash.value =
        (1 - appear) * 0.6 + (since >= 0 ? Math.exp(-since * 10) * 0.8 : 0);
    }
    const fade = ramp(t, 0.5, 1.0);
    const motes = paladinDetailCount(MOTES, s.detail);
    for (let k = 0; k < GAVEL_COUNT; k++) {
      const bearing = s.bearing + (k * Math.PI * 2) / GAVEL_COUNT;
      const dx = Math.cos(bearing),
        dz = Math.sin(bearing);
      // Along the handle, head to grip.
      const hx = dx * Math.sin(lean),
        hy = Math.cos(lean),
        hz = dz * Math.sin(lean);
      // The swing's axis, level and square to this gavel's side; and the
      // head's up, square to both.
      const ax = -dz,
        az = dx;
      const ux = -az * hy,
        uy = az * hx - ax * hz,
        uz = ax * hy;
      // The grip, placed so every head lands on the same spot just above the
      // target's head, whatever its size.
      const px = x + dx * GRIP * S,
        py = topY + HEAD_LIFT * S + rise + hop,
        pz = z + dz * GRIP * S;
      const headX = px - hx * GRIP * S,
        headY = py - hy * GRIP * S,
        headZ = pz - hz * GRIP * S;
      const gavel = this.gavels[slot * GAVEL_COUNT + k];
      if (gavel) {
        gavel.matrix.set(
          hx * size,
          ux * size,
          ax * size,
          headX,
          hy * size,
          uy * size,
          0,
          headY,
          hz * size,
          uz * size,
          az * size,
          headZ,
          0,
          0,
          0,
          1,
        );
        gavel.matrixWorldNeedsUpdate = true;
        gavel.visible = true;
      }
      // A flash where each appears.
      this.param = 0;
      this.time = t;
      if (t < 0.12 && scale.accents)
        this.billboard(
          headX,
          headY,
          headZ,
          0.6 * gs,
          IVORY,
          appear * (1 - t / 0.12) * 0.8,
          SHAPE.flare,
        );
      // Dissolving upward in motes.
      if (reduced || fade <= 0) continue;
      for (let i = 0; i < motes; i++) {
        const u = (i + 0.5) / motes;
        const n = k * MOTES + i;
        const across = (hash(n, 1) - 0.5) * 0.5,
          out = u * GRIP;
        const lift = fade * (0.3 + 0.5 * hash(n, 2)) * gs;
        this.billboard(
          headX + (hx * out + ax * across) * S,
          headY + hy * out * S + lift,
          headZ + (hz * out + az * across) * S,
          (0.05 + 0.04 * hash(n, 3)) * gs,
          n % 2 ? GOLD : IVORY,
          Math.sin(fade * Math.PI) * 0.9,
          SHAPE.mote,
        );
      }
    }
    // The landing: a flash on the joined head, and the blow on the target's.
    this.param = 0;
    if (since >= 0 && since < 0.25)
      this.billboard(
        x,
        topY + HEAD_LIFT * S + rise + hop,
        z,
        0.9 * gs,
        IVORY,
        Math.exp(-since * 14) * 0.9,
        SHAPE.flare,
      );
    if (since >= 0 && since < 0.5 && scale.secondary)
      this.billboard(x, topY + 0.05, z, 1.2 * gs, IVORY, Math.exp(-since * 8) * 1.0, SHAPE.flare);
    if (since >= 0 && since < 0.5 && scale.accents) {
      this.billboard(
        x,
        topY + 0.05,
        z,
        0.9 * gs,
        GOLD,
        Math.exp(-since * 4) * 0.6,
        SHAPE.flare,
        0.785,
      );
    }
  }

  private hold1(h: Hold, dt: number, reduced: boolean): void {
    if (h.release < 0 && !h.seen) h.release = 0;
    h.seen = false;
    if (h.release >= 0) h.release += dt;
    else h.presence = Math.min(1, h.presence + dt * 6);
    if (h.release >= h.releaseFor || !this.anchor(h.id, 0, this.feet)) {
      h.active = false;
      return;
    }
    const topY = this.anchor(h.id, 1, this.top) ? this.top.y : this.feet.y + 1.8;
    const height = Math.max(0.8, topY - this.feet.y);
    const sc = height / 1.8;
    const x = this.feet.x,
      z = this.feet.z;
    const out = h.release >= 0 ? ramp(h.release, 0, h.releaseFor) : 0;
    const alpha = h.presence * (1 - out);
    // Two shackles of runes counter-rotating round chest and knee; when the
    // stun lifts they snap outward and fade.
    for (let k = 0; k < 2; k++) {
      const r = (0.5 + 0.08 * k) * sc * (1 + 0.6 * out);
      const ang = this.clock * (k ? -1.1 : 0.9);
      const cs = Math.cos(ang) * r,
        sn = Math.sin(ang) * r;
      this.time = this.clock;
      this.quad(
        x,
        this.feet.y + height * (k ? 0.3 : 0.62),
        z,
        cs,
        0,
        sn,
        -sn,
        0,
        cs,
        GOLD,
        alpha * 0.9,
        SHAPE.band,
      );
    }
    if (reduced || !paladinDetailScale(h.detail).accents) return;
    // Glints circling the head.
    for (let i = 0; i < GLINTS; i++) {
      const ang = this.clock * 3 + (i * Math.PI * 2) / GLINTS;
      const r = 0.3 * sc * (1 + out);
      this.billboard(
        x + Math.cos(ang) * r,
        topY + 0.18 * sc + 0.04 * Math.sin(this.clock * 6 + i),
        z + Math.sin(ang) * r,
        0.09 * sc,
        i % 2 ? GOLD : IVORY,
        alpha * (0.7 + 0.3 * Math.sin(this.clock * 9 + i * 2)),
        SHAPE.glint,
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
    for (const s of this.strikes) s.active = false;
    for (const h of this.holds) h.active = false;
    for (const gavel of this.gavels) gavel.visible = false;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    const errors: unknown[] = [];
    for (const release of [
      () => this.lightPrep.dispose(),
      () => this.gavelPrep.dispose(),
      () => this.mesh.removeFromParent(),
      () => this.mesh.geometry.dispose(),
      () => this.mesh.material.dispose(),
      () => {
        const materials = new Set(this.gavels.map((g) => g.material));
        for (const gavel of this.gavels) gavel.removeFromParent();
        for (const material of materials) material.dispose();
        this.gavels[0]?.geometry.dispose();
      },
    ]) {
      try {
        release();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Sundering Gavel cleanup failed');
  }
}

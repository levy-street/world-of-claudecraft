import * as THREE from 'three';
import {
  DAWNFALL_BEAM_LANDING,
  DAWNFALL_CAST_CAPACITY,
  DAWNFALL_CONTACT_CAPACITY,
  DAWNFALL_DURATION,
  DAWNFALL_MOTES,
  DAWNFALL_VERTICES,
  DAWNFALL_WAVE_CRESTS,
  DAWNFALL_WAVE_SEGMENTS,
  type DawnfallBeam,
  type DawnfallWave,
  dawnfallBeamWidth,
  dawnfallEnvelope,
  dawnfallFlare,
  dawnfallGather,
  dawnfallRadius,
  sampleDawnfallBeam,
  sampleDawnfallWave,
} from '../dawnfall_core';
import { type EdictOutcome, FINAL_EDICT_PALETTE } from '../final_edict_core';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { DAWNREAVER_EMBLEM_GLSL } from './dawnreaver_emblem';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { type PaladinLocalProbe, paladinFlash } from './paladin_flash';
import { PALADIN_RUNE_GLSL } from './paladin_runes';
import { paladinVfxDetailNow } from './paladin_vfx_detail';
import {
  type PaladinVfxDetail,
  paladinDetailCount,
  paladinDetailScale,
} from './paladin_vfx_detail_core';

// Detail: core = the rune circle and the emblem's hot core on the ground, and
// the hot core of the falling pillar (a contact's flare and upright streak);
// secondary = the light pool, the emblem's glow, the pillar's wide glow and the
// three breaking crests; accents = the landing flash and flare (a contact's
// cross streak). The embers scale with count, the ground layers' and embers'
// fade tails with linger.

// Additive light, like the other Paladin effects: hot ivory, gold, a dim
// bronze fill and a dawn-rose rim. Nothing here darkens the ground.
const COLORS = [
  new THREE.Color(FINAL_EDICT_PALETTE.ivory).multiplyScalar(1.3),
  new THREE.Color(FINAL_EDICT_PALETTE.gold).multiplyScalar(1.2),
  new THREE.Color(FINAL_EDICT_PALETTE.bronze),
  new THREE.Color(FINAL_EDICT_PALETTE.ivory),
  new THREE.Color(FINAL_EDICT_PALETTE.peach).multiplyScalar(1.1),
];
const HOT = 0,
  GOLD = 1,
  IVORY = 3,
  ROSE = 4;
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
/** A contact's flare plays out over this long. */
const CONTACT_DURATION = 0.25;
/** Fade ends (seconds after landing) of the ground layers and the embers. */
const POOL_END = 0.74,
  GLOW_END = 0.62,
  CORE_END = 0.74,
  RING_END = 0.7,
  EMBER_END = 0.5;
/** The latest an ember starts to rise, after landing. */
const EMBER_LAUNCH = 0.26;
/** The crests' last light, after landing (the third one's local fade). */
const CREST_END = 0.44 + (DAWNFALL_WAVE_CRESTS - 1) * 0.055;
/** How long a cast lives at `detail`: the full composition keeps its authored
 * span; a lighter one ends once its shortened tails have faded. */
function dawnfallCastEnd(detail: PaladinVfxDetail): number {
  if (detail === 'full') return DAWNFALL_DURATION;
  const scale = paladinDetailScale(detail);
  const tail = Math.max(
    Math.max(POOL_END, CORE_END, RING_END) * scale.linger,
    scale.secondary ? CREST_END : 0,
    EMBER_LAUNCH + EMBER_END * scale.linger,
    // The pillar's descent is the core beat: never cut short.
    0.52 - DAWNFALL_BEAM_LANDING,
  );
  return Math.min(DAWNFALL_DURATION, DAWNFALL_BEAM_LANDING + tail);
}
const CAPACITY = DAWNFALL_CAST_CAPACITY * DAWNFALL_VERTICES + DAWNFALL_CONTACT_CAPACITY * 18;
const ATTRIBUTES = ['position', 'aColor', 'aUv', 'aAlpha', 'aShape', 'aGround', 'aTime'] as const;
// Shader shapes. Floor layers read their uv as the footprint in [-1, 1].
const SHAPE = {
  streak: 0,
  blob: 1,
  beam: 2,
  ring: 3,
  flare: 4,
  emblemGlow: 5,
  emblemCore: 6,
  ember: 7,
  wave: 8,
  pool: 9,
  flash: 10,
  rim: 12,
} as const;
interface Slot {
  /** Entity the effect was spawned on. */
  owner: number;
  terrain: Float32Array;
  ground: number;
  active: boolean;
  age: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  absorb: boolean;
  /** How much of the effect draws, read when it spawned. */
  detail: PaladinVfxDetail;
  /** Seconds the slot lives (DAWNFALL_DURATION at full detail). */
  end: number;
}
function slots(count: number): Slot[] {
  return Array.from({ length: count }, () => ({
    owner: -1,
    terrain: new Float32Array(81),
    ground: 0,
    active: false,
    age: 0,
    x: 0,
    y: 0,
    z: 0,
    radius: 6,
    absorb: false,
    detail: 'full' as PaladinVfxDetail,
    end: DAWNFALL_DURATION,
  }));
}
/** Fixed cast/contact pools share one prepared draw. Geometry is world anchored,
 * and the contact pool cannot evict an area blast in a crowded fight. Every live
 * slot writes a fixed vertex count for its detail; the shader animates from
 * `aTime`. */
export class Dawnfall {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'dawnfall'>;
  private readonly casts = slots(DAWNFALL_CAST_CAPACITY);
  private readonly contacts = slots(DAWNFALL_CONTACT_CAPACITY);
  private readonly positions = new Float32Array(CAPACITY * 3);
  private readonly colors = new Float32Array(CAPACITY * 3);
  private readonly uvs = new Float32Array(CAPACITY * 2);
  private readonly alphas = new Float32Array(CAPACITY);
  private readonly shapes = new Float32Array(CAPACITY);
  private readonly grounds = new Float32Array(CAPACITY);
  private readonly times = new Float32Array(CAPACITY);
  private readonly beamPose: DawnfallBeam = { bottom: 0, top: 0, alpha: 0 };
  private readonly wavePose: DawnfallWave = { radius: 0, height: 0, alpha: 0 };
  private readonly scratch = new THREE.Vector3();
  private vertex = 0;
  /** Seconds since landing for the geometry being written. */
  private time = 0;
  private disposed = false;
  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly camera?: THREE.Camera,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly isLocal?: PaladinLocalProbe,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, data, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aUv', this.uvs, 2],
      ['aAlpha', this.alphas, 1],
      ['aShape', this.shapes, 1],
      ['aGround', this.grounds, 1],
      ['aTime', this.times, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(data, size).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexShader: `
        attribute vec3 aColor; attribute vec2 aUv;
        attribute float aAlpha, aShape, aGround, aTime;
        varying vec3 vColor; varying vec2 vUv;
        varying float vAlpha, vShape, vGround, vTime;
        ${GROUND_DEPTH_PULL_GLSL}
        void main() { vColor=aColor; vUv=aUv; vAlpha=aAlpha; vShape=aShape; vGround=aGround; vTime=aTime;
          // Ring, emblem, crests, pool and flash lie on the ground.
          bool grounded=(aShape>2.5&&aShape<3.5)||(aShape>4.5&&aShape<6.5)||aShape>7.5;
          gl_Position=projectionMatrix*groundPulledView(position,grounded?${GROUND_DEPTH_PULL.toFixed(2)}:0.0); }`,
      fragmentShader: `
        varying vec3 vColor; varying vec2 vUv; varying float vAlpha, vShape, vGround, vTime;
        ${DAWNREAVER_EMBLEM_GLSL}
        ${PALADIN_RUNE_GLSL}
        const vec3 HOT=vec3(1.0,0.88,0.604);
        const vec3 ROSE=vec3(0.694,0.342,0.258);
        const float PI=3.14159265;
        float band(float r, float at, float width) { float d=(r-at)/width; return exp(-d*d); }
        float tongues(float a, float t) { return 0.55+0.45*sin(a*17.0+sin(a*5.0)*2.0+t*9.0); }
        void main() {
          float mask=0.0;
          vec3 color=vColor;
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          if(vShape>11.5) {
            // Hot rim riding each crest.
            float a=vUv.x*2.0*PI;
            mask=exp(-vUv.y*vUv.y*2.5)*(0.5+0.5*tongues(a,t));
            color=mix(vColor,HOT,0.5);
          } else if(vShape>9.5) {
            // Landing flash: a white core and a blast front racing to the rim.
            if(!(t>=0.0)) discard;
            float front=0.12+t*3.2;
            mask=band(r,front,0.06+t*0.3)*(1.0-smoothstep(0.0,0.34,t));
            mask+=exp(-r*r*26.0)*(1.0-smoothstep(0.0,0.2,t))*0.9;
            mask*=1.0-smoothstep(0.94,1.0,r);
            color=mix(vColor,HOT,0.6);
          } else if(vShape>8.5) {
            // Light pool and sunburst. Before landing it gathers under the caster.
            float a=atan(p.y,p.x);
            if(t<0.0) {
              float g=clamp(1.0+t/${DAWNFALL_BEAM_LANDING.toFixed(3)},0.0,1.0);
              mask=exp(-r*r*mix(120.0,34.0,g))*1.2;
              color=mix(vColor,HOT,0.6);
            } else {
              float grow=clamp(t/0.22,0.0,1.0);
              float reach=0.25+0.72*(1.0-pow(max(1.0-grow,0.0),3.0));
              float major=pow(max(0.5+0.5*cos(a*12.0),0.0),28.0);
              float minor=pow(max(0.5+0.5*cos(a*12.0+PI),0.0),48.0)*0.5;
              float rays=(major+minor)*smoothstep(0.08,0.28,r)*(1.0-smoothstep(reach*0.6,reach,r));
              float pool=exp(-r*r*10.0);
              float fill=0.07*(1.0-smoothstep(0.88,0.97,r));
              mask=pool*0.4+rays*0.85+fill;
              color=mix(vColor,HOT,pool*0.7);
              color=mix(color,ROSE,smoothstep(0.35,0.95,r)*0.6);
            }
            mask*=1.0-smoothstep(0.93,1.0,r);
          } else if(vShape>7.5) {
            // Crest sheet: rose at the ground, gold at a ragged, flickering top.
            float a=vUv.x*2.0*PI;
            float wake=(vUv.y+1.0)*0.5;
            float lick=tongues(a,t);
            float grain=0.75+0.25*sin(a*53.0-t*14.0);
            mask=pow(max(wake,0.0),1.7)*(0.45+0.55*lick)*grain;
            mask*=1.0-smoothstep(0.55+0.4*lick,1.0,wake);
            color=mix(vColor,HOT,pow(max(wake,0.0),4.0)*0.5);
          } else if(vShape>6.5) {
            // Ember: bright head with a short tail beneath it.
            float head=exp(-(p.x*p.x*10.0+(p.y-0.55)*(p.y-0.55)*22.0));
            float tail=exp(-p.x*p.x*16.0)*smoothstep(-1.0,0.55,p.y)*(1.0-smoothstep(0.55,1.0,p.y));
            mask=head*1.4+tail*0.5;
            color=mix(vColor,HOT,head*0.8);
          } else if(vShape>5.5) {
            // Emblem stroke ignites from the centre with a travelling flare.
            float d=dawnreaverOutline(p);
            float front=t*5.5;
            float reveal=1.0-smoothstep(front-0.1,front,r);
            mask=((1.0-smoothstep(0.006,0.014,d))*1.3+exp(-d*55.0)*0.35)*reveal;
            mask+=band(r,front,0.08)*exp(-d*25.0)*1.6*(1.0-smoothstep(0.15,0.3,t));
            color=mix(vColor,HOT,0.5);
          } else if(vShape>4.5) {
            float d=dawnreaverOutline(p);
            float front=t*5.5;
            mask=exp(-d*14.0)*0.6*(1.0-smoothstep(front-0.2,front,r));
          } else if(vShape>3.5) {
            // Landing flare with a wide lens streak and a short vertical spike.
            float core=exp(-r*r*14.0);
            float halo=exp(-r*r*3.5)*0.35;
            float streak=exp(-abs(p.y)*26.0)*exp(-abs(p.x)*2.2)*0.9;
            float spike=exp(-abs(p.x)*30.0)*exp(-abs(p.y)*3.0)*0.5;
            mask=(core*1.5+halo+streak+spike)*(1.0-smoothstep(0.85,1.0,max(abs(p.x),abs(p.y))));
            color=mix(vColor,HOT,core);
          } else if(vShape>2.5) {
            // Footprint ring: two circles and a rune band, all there at once,
            // flashing as it appears.
            mask=paladinRuneRing(p,0.875,0.965)*1.1;
            mask+=band(r,0.92,0.05)*1.5*exp(-t*8.0);
            color=mix(vColor,HOT,0.35);
          } else if(vShape>1.5) {
            // Pillar: gaussian across, shimmering along. After landing it
            // lifts off the ground and withdraws into the sky.
            float lift=clamp((t-0.1)/0.38,0.0,1.0);
            float across=exp(-vUv.y*vUv.y*4.5);
            float shimmer=0.8+0.2*sin(vUv.x*46.0-t*38.0+vUv.y*2.0);
            float bottom=lift<=0.0?1.0:smoothstep(lift*1.2-0.2,lift*1.2,vUv.x);
            mask=across*shimmer*bottom*(1.0-smoothstep(0.7,1.0,vUv.x));
            mask+=exp(-vUv.x*18.0)*across*(1.0-lift)*0.8;
            color=mix(vColor,HOT,across*0.4);
          } else if(vShape>0.5) {
            float a=atan(p.y,p.x);
            float wobble=length(p)/(0.88+0.07*sin(a*7.0)+0.05*sin(a*13.0));
            mask=exp(-wobble*wobble*2.7)*(1.0-smoothstep(0.65,1.0,wobble));
          } else {
            mask=pow(max(0.0,sin(vUv.x*PI)),0.45)*exp(-vUv.y*vUv.y*7.0);
            mask*=1.0-smoothstep(0.75,1.0,abs(vUv.y));
          }
          float opacity=vAlpha*mask*smoothstep(0.0,0.12,vGround);
          if(!(opacity>=0.002)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }`,
    });
    material.name = 'dawnfall:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'dawnfall-holy-light';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 0);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['dawnfall', geometry]]), material);
  }
  /** A Dawnfall that pronounces a Verdict gives way to the larger sentence
   * blast at the target: the caster's own cast, spawned in the same event
   * batch, is withdrawn before it is drawn. */
  withdraw(owner: number): void {
    for (const slot of this.casts)
      if (slot.active && slot.owner === owner && slot.age <= 0.1) slot.active = false;
  }
  spawn(id: number, radius: number): boolean {
    return this.start(this.casts, id, radius, false, false);
  }
  contact(id: number, outcome: EdictOutcome): boolean {
    if (outcome === 'none') return false;
    return this.start(this.contacts, id, 1, true, outcome === 'absorb');
  }
  private start(
    pool: Slot[],
    id: number,
    radius: number,
    contact: boolean,
    absorb: boolean,
  ): boolean {
    if (
      this.disposed ||
      !this.preparation.ready('dawnfall') ||
      !this.anchor(id, contact ? 0.6 : 0, this.scratch)
    )
      return false;
    let slot = pool[0];
    for (const candidate of pool) {
      if (!candidate.active) {
        slot = candidate;
        break;
      }
      if (candidate.age > slot.age) slot = candidate;
    }
    slot.active = true;
    slot.age = 0;
    slot.owner = id;
    slot.x = this.scratch.x;
    slot.z = this.scratch.z;
    slot.radius = dawnfallRadius(radius);
    const terrain = this.groundY?.(slot.x, slot.z);
    if (contact) {
      slot.ground = terrain ?? this.scratch.y - 1;
      slot.y = this.scratch.y;
    } else {
      // A cast anchors at the caster's feet. On a dock, bridge or raised tier
      // those feet are the visible floor, and the drape must not sink below it.
      const feet = this.scratch.y;
      slot.ground = effectFloor(terrain, feet);
      slot.y = slot.ground;
      const raised = terrain !== undefined && slot.ground > terrain;
      for (let z = 0; z <= 8; z++)
        for (let x = 0; x <= 8; x++) {
          const below = this.groundY?.(
            slot.x + (x / 4 - 1) * slot.radius,
            slot.z + (z / 4 - 1) * slot.radius,
          );
          slot.terrain[z * 9 + x] =
            below === undefined ? slot.ground : raised ? Math.max(below, feet) : below;
        }
    }
    slot.absorb = absorb;
    slot.detail = paladinVfxDetailNow();
    slot.end = contact
      ? CONTACT_DURATION * paladinDetailScale(slot.detail).linger
      : dawnfallCastEnd(slot.detail);
    return true;
  }
  private terrainAt(slot: Slot, x: number, z: number): number {
    const gx = Math.max(0, Math.min(7.999, (x / slot.radius + 1) * 4));
    const gz = Math.max(0, Math.min(7.999, (z / slot.radius + 1) * 4));
    const ix = Math.floor(gx),
      iz = Math.floor(gz),
      fx = gx - ix,
      fz = gz - iz,
      i = iz * 9 + ix;
    return (
      (slot.terrain[i] * (1 - fx) + slot.terrain[i + 1] * fx) * (1 - fz) +
      (slot.terrain[i + 9] * (1 - fx) + slot.terrain[i + 10] * fx) * fz
    );
  }
  private floor(
    slot: Slot,
    height: number,
    scale: number,
    color: number,
    alpha: number,
    shape: number,
  ): void {
    for (let z = 0; z < 8; z++)
      for (let x = 0; x < 8; x++)
        for (let j = 0; j < 6; j++) {
          const gx = x + CORNERS[j * 2],
            gz = z + (CORNERS[j * 2 + 1] + 1) / 2;
          const px = (gx / 4 - 1) * slot.radius,
            pz = (gz / 4 - 1) * slot.radius;
          const ground = slot.terrain[gz * 9 + gx];
          this.put(
            slot.x + px,
            ground + height,
            slot.z + pz,
            (gx / 8 - 0.5) / scale + 0.5,
            (gz / 4 - 1) / scale,
            color,
            alpha,
            shape,
            ground,
          );
        }
  }
  private put(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    color: number,
    alpha: number,
    shape: number,
    ground: number,
  ): void {
    const i = this.vertex++,
      j = i * 3,
      c = COLORS[color];
    this.positions[j] = x;
    this.positions[j + 1] = y;
    this.positions[j + 2] = z;
    this.colors[j] = c.r;
    this.colors[j + 1] = c.g;
    this.colors[j + 2] = c.b;
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    this.alphas[i] = Math.max(0, alpha);
    this.shapes[i] = shape;
    this.grounds[i] = y - ground;
    this.times[i] = this.time;
  }
  /** Camera-facing quad. Always written, even at zero alpha, so a live slot
   * keeps a fixed vertex count; the shader discards what is dark. */
  private quad(
    slot: Slot,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    color: number,
    alpha: number,
    shape: number = SHAPE.blob,
    groundOverride = slot.ground,
  ): void {
    const view = this.camera?.matrixWorld.elements;
    const ground = groundOverride;
    for (let j = 0; j < 6; j++) {
      const u = CORNERS[j * 2],
        v = CORNERS[j * 2 + 1],
        a = (u - 0.5) * width,
        b = v * height * 0.5;
      this.put(
        slot.x + x + a * (view?.[0] ?? 1) + b * (view?.[4] ?? 0),
        slot.y + y + a * (view?.[1] ?? 0) + b * (view?.[5] ?? 1),
        slot.z + z + a * (view?.[2] ?? 0) + b * (view?.[6] ?? 0),
        u,
        v,
        color,
        alpha,
        shape,
        ground,
      );
    }
  }
  private beam(slot: Slot, width: number, color: number, alpha: number): void {
    const view = this.camera?.matrixWorld.elements;
    const { bottom, top } = this.beamPose;
    // World-up column, camera-facing width. Orbiting cannot tilt the descent.
    const rightX = view?.[0] ?? 1,
      rightZ = view?.[2] ?? 0;
    const length = Math.hypot(rightX, rightZ) || 1;
    for (let j = 0; j < 6; j++) {
      const u = CORNERS[j * 2],
        side = CORNERS[j * 2 + 1];
      this.put(
        slot.x + (rightX / length) * side * width * 0.5,
        slot.ground + bottom + u * (top - bottom),
        slot.z + (rightZ / length) * side * width * 0.5,
        u,
        side,
        color,
        alpha,
        SHAPE.beam,
        slot.ground,
      );
    }
  }
  private wave(slot: Slot, crestIndex: number): void {
    // Sloped sheet plus a hot rim; the uneven crest and flickering tongues keep
    // it from reading as a smooth hoop.
    for (let layer = 0; layer < 2; layer++)
      for (let segment = 0; segment < DAWNFALL_WAVE_SEGMENTS; segment++)
        for (let j = 0; j < 6; j++) {
          const u = (segment + CORNERS[j * 2]) / DAWNFALL_WAVE_SEGMENTS;
          const side = CORNERS[j * 2 + 1];
          const angle = u * Math.PI * 2;
          const phase = angle + crestIndex * 0.37;
          const edge = 1 + Math.sin(phase * 13) * 0.018 + Math.sin(phase * 19) * 0.012;
          const width = slot.radius * (layer === 0 ? 0.13 : 0.03);
          const radius = Math.max(0, this.wavePose.radius * edge - (side < 0 ? width : 0));
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          const ground = this.terrainAt(slot, x, z);
          const crest = this.wavePose.height * (0.8 + 0.2 * Math.sin(phase * 5) ** 2);
          const height = side > 0 ? crest : layer === 0 ? 0 : crest * 0.8;
          this.put(
            slot.x + x,
            ground + 0.14 + height + layer * 0.015,
            slot.z + z,
            u + (crestIndex * 0.37) / (Math.PI * 2),
            side,
            layer === 1 ? HOT : side < 0 ? ROSE : GOLD,
            this.wavePose.alpha * (layer === 0 ? 0.95 : 1.3),
            layer === 0 ? SHAPE.wave : SHAPE.rim,
            ground,
          );
        }
  }
  private embers(slot: Slot, age: number, reduced: boolean): void {
    const r = slot.radius;
    const count = paladinDetailCount(DAWNFALL_MOTES, slot.detail);
    const fade = EMBER_END * paladinDetailScale(slot.detail).linger;
    for (let n = 0; n < count; n++) {
      // Fewer embers keep the full scatter: every k-th one.
      const mote = Math.floor((n * DAWNFALL_MOTES) / count);
      if (reduced && mote % 2) continue;
      // Golden-angle scatter; each ember lifts as the first crest passes it.
      const angle = mote * 2.399963 + 0.4;
      const reach = 0.12 + (((mote * 7) % 11) / 11) * 0.78;
      const life = age - reach * 0.26;
      const since = Math.max(0, life);
      const distance = r * reach * (reduced ? 1 : 1 + since * 0.18);
      const x = Math.cos(angle) * distance,
        z = Math.sin(angle) * distance;
      const ground = this.terrainAt(slot, x, z);
      const rise = reduced
        ? 0.3 + since * 0.4
        : 0.2 + since * (1.6 + (mote % 3) * 0.6) - since * since * 0.9;
      const big = mote % 3 === 0;
      const size = big ? 0.13 : 0.085;
      this.quad(
        slot,
        x,
        ground - slot.y + rise,
        z,
        size,
        size * 5,
        mote % 4 === 0 ? ROSE : mote % 2 ? HOT : GOLD,
        dawnfallEnvelope(life, fade) * (big ? 1.4 : 1.1),
        SHAPE.ember,
        ground,
      );
    }
  }
  update(dt: number, reduced: boolean): void {
    if (this.disposed) return;
    this.vertex = 0;
    for (const slot of this.casts) {
      if (!slot.active) continue;
      slot.age += Math.max(0, dt);
      if (slot.age >= slot.end) {
        slot.active = false;
        continue;
      }
      const age = slot.age - DAWNFALL_BEAM_LANDING;
      const detail = paladinDetailScale(slot.detail);
      const linger = detail.linger;
      // Reduced motion shows the settled sigil: no sweeps, reveals or flash front.
      this.time = reduced ? Math.max(age, 0.3) : age;
      const gather = reduced ? 0 : dawnfallGather(age) * 0.55;
      // The landing's flash and flare build and peak under the shared limit;
      // the descending pillar's hot core does from the cast's first frame.
      const local = this.isLocal?.(slot.owner) ?? true;
      const flash = paladinFlash(age, local);
      if (detail.secondary) {
        this.floor(
          slot,
          0.14,
          0.99,
          GOLD,
          Math.max(dawnfallEnvelope(age, POOL_END * linger) * 0.75, gather),
          SHAPE.pool,
        );
        this.floor(
          slot,
          0.18,
          0.86,
          GOLD,
          dawnfallEnvelope(age, GLOW_END * linger) * 0.9,
          SHAPE.emblemGlow,
        );
      }
      this.floor(
        slot,
        0.2,
        0.86,
        HOT,
        dawnfallEnvelope(age, CORE_END * linger) * 1.1,
        SHAPE.emblemCore,
      );
      this.floor(slot, 0.21, 0.998, GOLD, dawnfallEnvelope(age, RING_END * linger), SHAPE.ring);
      if (detail.accents)
        this.floor(
          slot,
          0.22,
          0.99,
          HOT,
          reduced ? 0 : dawnfallEnvelope(age, 0.36) * 1.2 * flash,
          SHAPE.flash,
        );
      // The hammer reaches its raised pose as the light arrives at the feet.
      sampleDawnfallBeam(slot.age, reduced, this.beamPose);
      this.time = reduced ? 0 : age;
      // Larger blasts (Ascension, Verdict sentences) get a broader pillar and
      // flare; the square root keeps a 20-yard sentence from a wall of light.
      const scale = Math.sqrt(Math.max(1, slot.radius / 6));
      const thin = dawnfallBeamWidth(age) * scale;
      if (detail.secondary) this.beam(slot, 2.2 * thin, GOLD, this.beamPose.alpha * 0.45);
      this.beam(slot, 0.5 * thin, HOT, this.beamPose.alpha * 1.6 * paladinFlash(slot.age, local));
      if (detail.accents)
        this.quad(
          slot,
          0,
          0.9 * scale,
          0,
          3.4 * scale,
          3.4 * scale,
          HOT,
          dawnfallFlare(age) * (reduced ? 0.5 : 1.3) * flash,
          SHAPE.flare,
        );
      this.time = age;
      const crests = detail.secondary ? DAWNFALL_WAVE_CRESTS : 0;
      for (let crest = 0; crest < crests; crest++) {
        sampleDawnfallWave(age, slot.radius, reduced, this.wavePose, crest);
        this.wave(slot, crest);
      }
      this.embers(slot, age, reduced);
    }
    for (const slot of this.contacts) {
      if (!slot.active) continue;
      slot.age += Math.max(0, dt);
      if (slot.age >= slot.end) {
        slot.active = false;
        continue;
      }
      this.time = slot.age;
      const fade = dawnfallEnvelope(slot.age, slot.end) * (slot.absorb ? 0.4 : 0.9),
        size = slot.absorb ? 0.5 : 1;
      this.quad(slot, 0, 0, 0, size * 1.5, size * 1.5, GOLD, fade, SHAPE.flare);
      this.quad(slot, 0, 0, 0, size * 0.15, size * 2, HOT, fade, SHAPE.streak);
      if (paladinDetailScale(slot.detail).accents)
        this.quad(slot, 0, 0, 0, size * 1.3, size * 0.13, IVORY, fade * 0.7, SHAPE.streak);
    }
    this.mesh.visible = this.vertex > 0;
    this.mesh.geometry.setDrawRange(0, this.vertex);
    if (!this.vertex) return;
    for (const name of ATTRIBUTES) {
      const attr = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.vertex * attr.itemSize);
      attr.needsUpdate = true;
    }
  }
  clear(): void {
    for (const slot of this.casts) slot.active = false;
    for (const slot of this.contacts) slot.active = false;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const release of [
      () => this.clear(),
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
    if (errors.length) throw new AggregateError(errors, 'Dawnfall cleanup failed');
  }
}

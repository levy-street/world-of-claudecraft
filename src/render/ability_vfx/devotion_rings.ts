import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { effectFloor, GROUND_DEPTH_PULL, GROUND_DEPTH_PULL_GLSL } from './effect_floor';
import { PALADIN_RUNE_GLSL } from './paladin_runes';

/** The Paladin's party auras, each with its own ring. */
export const DEVOTION_KINDS = [
  'retribution_aura',
  'devotion_ward',
  'radiant_devotion',
  'dawn_devotion',
  'grace_devotion',
] as const;
export type DevotionKind = (typeof DEVOTION_KINDS)[number];
export function isDevotionKind(id: string | null | undefined): id is DevotionKind {
  return !!id && (DEVOTION_KINDS as readonly string[]).includes(id);
}

export const DEVOTION_CAPACITY = 16;
export const DEVOTION_LIFE = 2.2;
export const DEVOTION_MOTES = 6;
/** The rings spread from the Paladin as a wave, this many yards per second. */
export const DEVOTION_WAVE_SPEED = 22;

/** Each kind: ring colour, accent (motes and the variant's own figure). */
const PALETTES: Record<DevotionKind, [number, number]> = {
  // Judgement fire: gold runes, the warning teeth and embers in crimson.
  retribution_aura: [0xffc458, 0xff1e14],
  devotion_ward: [0xe8bb76, 0xfff1cc],
  radiant_devotion: [0xfff0c8, 0xcfe8ff],
  dawn_devotion: [0xffb45a, 0xffe2a0],
  grace_devotion: [0xecc680, 0x9fd8ff],
};

const QUADS = 1 + DEVOTION_MOTES;
const VERTICES = DEVOTION_CAPACITY * QUADS * 6;
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAccent', 'aAlpha', 'aUv', 'aShape', 'aTime'] as const;
/** aShape: 0-4 the ring of each kind (DEVOTION_KINDS order), 5 a mote. */
const MOTE = 5;

interface Ring {
  active: boolean;
  kind: number;
  target: number;
  age: number;
  delay: number;
  radius: number;
  color: THREE.Color;
  accent: THREE.Color;
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
 * Requital Aura and the Devotions. The cast lights the off-hand sigil (see the
 * painter); every party member the aura reaches then gets a temporary Paladin
 * rune ring at their feet, spreading out from the Paladin as a wave. The ring
 * draws itself in, turns, and fades. Each aura has its own figure:
 * - Requital: ember red-gold, the rim cut into outward teeth, embers rising;
 * - Bastion: steady gold, the ward's hexagon standing inside the runes;
 * - Radiant: white-gold, star rays reaching out between the rings, twinkles;
 * - Dawn: warm orange, a sunburst rising behind the runes, sparks;
 * - Grace: gold and sky blue, mana ripples running outward, droplets rising.
 */
export class DevotionRings {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'devotion_rings'>;
  private readonly rings: Ring[] = Array.from({ length: DEVOTION_CAPACITY }, () => ({
    active: false,
    kind: 0,
    target: -1,
    age: 0,
    delay: 0,
    radius: 1,
    color: new THREE.Color(),
    accent: new THREE.Color(),
  }));
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly accents = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly feet = new THREE.Vector3();
  private readonly top = new THREE.Vector3();
  private readonly cam = [1, 0, 0, 0, 1, 0];
  private vertex = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly groundY?: (x: number, z: number) => number,
    private readonly camera?: THREE.Camera,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 3],
      ['aAccent', this.accents, 3],
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
        attribute vec3 aColor, aAccent; attribute float aAlpha, aShape, aTime; attribute vec2 aUv;
        varying vec3 vColor, vAccent; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        ${GROUND_DEPTH_PULL_GLSL}
        void main(){vColor=aColor;vAccent=aAccent;vAlpha=aAlpha;vShape=aShape;vTime=aTime;vUv=aUv;
          float pull=aShape<4.5?${GROUND_DEPTH_PULL.toFixed(2)}:0.4;
          gl_Position=projectionMatrix*groundPulledView(position,pull);}
      `,
      fragmentShader: `
        varying vec3 vColor, vAccent; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.94,0.8);
        const float PI=3.14159265;
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${PALADIN_RUNE_GLSL}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float mask;
          vec3 color=vColor;
          if(vShape>4.5){
            // A mote rising from the ring: a soft glowing point with a small star.
            float core=exp(-r*r*14.0);
            float star=exp(-abs(p.x)*18.0)*exp(-abs(p.y)*3.0)+exp(-abs(p.y)*18.0)*exp(-abs(p.x)*3.0);
            mask=(core*1.2+star*0.5)*(1.0-smoothstep(0.8,1.0,r));
            color=mix(vAccent,HOT,core*0.6);
          } else {
            // The shared Paladin rune ring, drawing itself in and turning.
            float spin=t*0.35*(vShape>0.5&&vShape<1.5?0.5:1.0);
            float c=cos(spin),s=sin(spin);
            vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
            float a=atan(q.y,q.x);
            float turn=fract(a/(2.0*PI)+0.25);
            float drawn=1.0-smoothstep(t*3.5-0.03,t*3.5,turn);
            float runes=paladinRuneRing(q,0.72,0.9)*drawn;
            float rims=band(r,0.955,0.012)*smoothstep(0.0,0.2,t)+band(r,0.66,0.01)*0.6*smoothstep(0.1,0.35,t);
            float heart=exp(-r*r*6.0)*0.12;
            float figure=0.0;
            vec3 figureColor=vAccent;
            if(vShape<0.5){
              // Requital: the rim cut into outward teeth, pulsing like a warning.
              float tooth=abs(fract(a/(PI/12.0))-0.5)*2.0;
              float edge=0.93+0.065*(1.0-tooth);
              float teeth=(1.0-smoothstep(edge-0.012,edge,r))*smoothstep(0.9,0.93,r);
              float pulse=0.75+0.25*sin(t*9.0);
              figure=(teeth*2.4+band(r,0.66,0.02)*0.8)*pulse;
              // A crimson glow smouldering between the rings and round the rim.
              figure+=(band(r,0.81,0.1)*0.35+band(r,0.95,0.04)*0.6)*pulse;
            } else if(vShape<1.5){
              // Bastion: the ward's hexagon standing inside the runes.
              float ha=abs(fract(atan(p.y,p.x)/(PI/3.0))-0.5)*(PI/3.0);
              float hexR=0.5/cos(ha);
              figure=band(r,hexR,0.012)*1.1+band(r,hexR*0.8,0.008)*0.5;
            } else if(vShape<2.5){
              // Radiant: star rays reaching out between the rings, twinkling.
              float rays=pow(max(cos(a*8.0),0.0),40.0)*smoothstep(0.2,0.3,r)*(1.0-smoothstep(0.62,0.68,r));
              figure=rays*(0.7+0.3*sin(t*12.0+a*3.0));
            } else if(vShape<3.5){
              // Dawn: a sunburst rising behind the runes.
              float rise=smoothstep(0.0,0.5,t);
              float rays=pow(max(cos(a*12.0+t*1.5),0.0),6.0)*smoothstep(0.08,0.2,r)*(1.0-smoothstep(0.55*rise,0.66*rise+0.01,r));
              figure=rays*0.8+exp(-r*r*14.0)*0.5*rise;
            } else {
              // Grace: mana ripples running outward.
              float wave=fract(r*2.2-t*0.9);
              figure=exp(-sq((wave-0.5)*7.0))*(1.0-smoothstep(0.5,0.66,r))*0.9;
            }
            mask=(rims+runes*0.9+heart)+figure;
            mask*=1.0-smoothstep(0.985,1.0,r);
            color=mix(vColor,figureColor,clamp(figure,0.0,1.0)*(vShape<0.5?1.0:0.6));
            color=mix(color,HOT,rims*0.3);
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'devotion-rings';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = floorVfxRenderOrder('player', 1);
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['devotion_rings', geometry]]), material);
  }

  /** The aura reached `target`; the ring waits for the wave from `source`. */
  spawn(kind: DevotionKind, target: number, source?: number): boolean {
    if (this.disposed || !this.preparation.ready('devotion_rings')) return false;
    if (!this.anchor(target, 0, this.feet)) return false;
    const fx = this.feet.x,
      fz = this.feet.z;
    const height = this.anchor(target, 1, this.top) ? this.top.y - this.feet.y : 2;
    let delay = 0;
    if (source !== undefined && source !== target && this.anchor(source, 0, this.top))
      delay = Math.min(0.6, Math.hypot(this.top.x - fx, this.top.z - fz) / DEVOTION_WAVE_SPEED);
    let slot = this.rings.find((r) => r.active && r.target === target);
    if (!slot) slot = this.rings.find((r) => !r.active);
    if (!slot) {
      slot = this.rings[0];
      for (const r of this.rings) if (r.age > slot.age) slot = r;
    }
    const k = DEVOTION_KINDS.indexOf(kind);
    slot.active = true;
    slot.kind = k;
    slot.target = target;
    slot.age = 0;
    slot.delay = delay;
    slot.radius = Math.max(0.9, Math.min(2.2, height * 0.55));
    const [color, accent] = PALETTES[kind];
    slot.color.setHex(color).multiplyScalar(1.4);
    slot.accent.setHex(accent).multiplyScalar(1.5);
    return true;
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
    ring: Ring,
    alpha: number,
    shape: number,
    time: number,
  ): void {
    if (!(alpha > 0.002) || this.vertex + 6 > VERTICES) return;
    for (let c = 0; c < 6; c++) {
      const u = CORNERS[c * 2],
        side = CORNERS[c * 2 + 1],
        along = u * 2 - 1;
      const i = this.vertex++;
      this.positions[i * 3] = x + ax * along + bx * side;
      this.positions[i * 3 + 1] = y + ay * along + by * side;
      this.positions[i * 3 + 2] = z + az * along + bz * side;
      this.colors[i * 3] = ring.color.r;
      this.colors[i * 3 + 1] = ring.color.g;
      this.colors[i * 3 + 2] = ring.color.b;
      this.accents[i * 3] = ring.accent.r;
      this.accents[i * 3 + 1] = ring.accent.g;
      this.accents[i * 3 + 2] = ring.accent.b;
      this.alphas[i] = Math.max(0, alpha);
      this.uvs[i * 2] = u;
      this.uvs[i * 2 + 1] = side;
      this.shapes[i] = shape;
      this.times[i] = time;
    }
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
    }
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += dt;
      const t = ring.age - ring.delay;
      if (t >= DEVOTION_LIFE || !this.anchor(ring.target, 0, this.feet)) {
        ring.active = false;
        continue;
      }
      if (t < 0) continue;
      // The ring follows the feet of whoever it blesses.
      const x = this.feet.x,
        z = this.feet.z;
      const y = effectFloor(this.groundY?.(x, z), this.feet.y) + 0.04;
      const r = ring.radius * (0.85 + 0.15 * ramp(t, 0, 0.35));
      const alpha = ramp(t, 0, 0.15) * (1 - ramp(t, DEVOTION_LIFE * 0.6, DEVOTION_LIFE));
      this.quad(x, y, z, r, 0, 0, 0, 0, r, ring, alpha, ring.kind, t);
      if (reduced) continue;
      // Motes rising from the ring, in the aura's accent.
      for (let i = 0; i < DEVOTION_MOTES; i++) {
        const life = 1.1;
        const tt = t - 0.15 - i * 0.12;
        if (tt < 0 || tt >= life) continue;
        const ang = i * 2.399963 + ring.kind + hash(i, ring.kind) * 0.8;
        const out = r * (0.6 + 0.3 * hash(i, 2));
        const size = ring.kind === 0 ? 0.07 : 0.09;
        const mx = x + Math.cos(ang) * out,
          mz = z + Math.sin(ang) * out,
          my = y + 0.1 + tt * (1.1 + 0.6 * hash(i, 3));
        this.quad(
          mx,
          my,
          mz,
          c[0] * size,
          c[1] * size,
          c[2] * size,
          c[3] * size,
          c[4] * size,
          c[5] * size,
          ring,
          Math.sin((tt / life) * Math.PI) * alpha * 1.4,
          MOTE,
          tt,
        );
      }
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

  clear(): void {
    for (const r of this.rings) r.active = false;
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
    if (errors.length) throw new AggregateError(errors, 'Devotion rings cleanup failed');
  }
}

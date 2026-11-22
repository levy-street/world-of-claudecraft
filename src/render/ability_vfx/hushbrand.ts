import * as THREE from 'three';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { PALADIN_RUNE_GLSL } from './paladin_runes';

export const HUSH_STRIKES = 6;
export const HUSH_BRANDS = 8;
export const HUSH_STRIKE_DURATION = 0.55;
export const HUSH_SHARDS = 14;
export const HUSH_SHATTER_DURATION = 0.55;

/** Strike: brand, shock ring, fist flare. Brand: shattered spell (flare and
 * shards), collar, sigil. */
const STRIKE_QUADS = 3;
const BRAND_QUADS = 3 + HUSH_SHARDS;
const VERTICES = (HUSH_STRIKES * STRIKE_QUADS + HUSH_BRANDS * BRAND_QUADS) * 6;
const GOLD = new THREE.Color(0xe8bb76).multiplyScalar(1.3);
const IVORY = new THREE.Color(0xfff1cc).multiplyScalar(1.5);
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aColor', 'aAlpha', 'aUv', 'aShape', 'aTime'] as const;
const SHAPE = { brand: 0, ring: 1, flare: 2, shard: 3, collar: 4, sigil: 5 } as const;

interface Strike {
  active: boolean;
  source: number;
  target: number;
  age: number;
}
interface Brand {
  active: boolean;
  target: number;
  seen: boolean;
  /** Share of the lockout still to run, from the aura. */
  left: number;
  presence: number;
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

// The hush: a sun sealed by a bar across its face.
const HUSH_GLSL = `
  float hushGlyph(vec2 p){
    float r=length(p);
    float a=atan(p.y,p.x);
    float ring=exp(-sq((r-0.48)/0.045));
    float rays=pow(max(cos(a*8.0),0.0),18.0)*smoothstep(0.58,0.64,r)*(1.0-smoothstep(0.78,0.84,r));
    float bar=(1.0-smoothstep(0.6,0.64,abs(p.x)))*(1.0-smoothstep(0.075,0.1,abs(p.y)));
    return max(max(ring,rays),bar);
  }
`;

/**
 * Hushbrand. The gauntlet stamps a hush sigil (a sun sealed by a bar) onto the
 * enemy, with a shock of light. When it silences a cast the spell shatters into
 * shards, and for the whole lockout a collar of light rings the throat and the
 * sigil stays branded on the chest inside a turning Paladin rune band (clear of
 * the standard lockout icon over the head), fading as the lockout runs out.
 */
export class Hushbrand {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'hushbrand'>;
  private readonly strikes: Strike[] = Array.from({ length: HUSH_STRIKES }, () => ({
    active: false,
    source: -1,
    target: -1,
    age: 0,
  }));
  private readonly brands: Brand[] = Array.from({ length: HUSH_BRANDS }, () => ({
    active: false,
    target: -1,
    seen: false,
    left: 1,
    presence: 0,
    age: 0,
  }));
  private readonly positions = new Float32Array(VERTICES * 3);
  private readonly colors = new Float32Array(VERTICES * 3);
  private readonly alphas = new Float32Array(VERTICES);
  private readonly uvs = new Float32Array(VERTICES * 2);
  private readonly shapes = new Float32Array(VERTICES);
  private readonly times = new Float32Array(VERTICES);
  private readonly at = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly cam = [1, 0, 0, 0, 1, 0, 0, 0, -1];
  private vertex = 0;
  private time = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly camera?: THREE.Camera,
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
          // The strike and the shattered spell sit on the body: pulled a little
          // toward the camera so the silhouette does not swallow them.
          float pull=aShape<3.5||aShape>4.5?0.5+0.3*step(4.5,aShape):0.0;
          view.xyz*=max(0.05,1.0-pull/max(length(view.xyz),0.001));
          gl_Position=projectionMatrix*view;}
      `,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha, vShape, vTime; varying vec2 vUv;
        const vec3 HOT=vec3(1.0,0.93,0.74);
        const float PI=3.14159265;
        float sq(float x){return x*x;}
        float band(float r,float at,float w){return exp(-sq((r-at)/w));}
        ${PALADIN_RUNE_GLSL}
        ${HUSH_GLSL}
        void main(){
          float t=vTime;
          vec2 p=vec2(vUv.x*2.0-1.0,vUv.y);
          float r=length(p);
          float a=atan(p.y,p.x);
          float mask;
          vec3 color=vColor;
          if(vShape>4.5){
            // The hush branded on the chest: the sigil inside a slowly turning rune band.
            float c=cos(t*0.6),s=sin(t*0.6);
            vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
            float runes=paladinRuneRing(q,0.74,0.95);
            float glyph=hushGlyph(p/0.62);
            float pulse=0.8+0.2*sin(t*4.0);
            mask=(runes*0.7+glyph*1.1*pulse+exp(-r*r*6.0)*0.15)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,glyph*0.6);
          } else if(vShape>3.5){
            // Collar of silence about the throat: a bright band with turning ticks.
            float ticks=pow(max(cos(a*12.0+t*2.0),0.0),12.0)*band(r,0.86,0.06);
            mask=(band(r,0.8,0.05)*1.3+band(r,0.8,0.16)*0.35+ticks*1.0)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,band(r,0.8,0.03));
          } else if(vShape>2.5){
            // A shard of the broken spell: a diamond of light with a white edge.
            float d=abs(p.x)+abs(p.y);
            mask=(1.0-smoothstep(0.8,1.0,d))*0.6+exp(-abs(d-0.9)*16.0)*0.9;
            color=mix(vColor,HOT,exp(-abs(d-0.9)*16.0));
          } else if(vShape>1.5){
            // Flare: white core, round halo, a soft four-point star.
            float core=exp(-r*r*18.0);
            float spokes=exp(-abs(p.y)*30.0)*exp(-abs(p.x)*2.0)+exp(-abs(p.x)*30.0)*exp(-abs(p.y)*2.2);
            mask=(core*1.5+exp(-r*r*5.0)*0.35+spokes*0.7)*(1.0-smoothstep(0.7,1.0,r));
            color=mix(vColor,HOT,core+spokes*0.3);
          } else if(vShape>0.5){
            // Shock of the strike: a ring leaving the brand.
            float grow=1.0-sq(max(1.0-clamp(t/0.3,0.0,1.0),0.0));
            mask=band(r,0.2+0.75*grow,0.04+0.05*grow)*(1.0-grow*0.8)*(1.0-smoothstep(0.96,1.0,r));
            color=mix(vColor,HOT,0.5);
          } else {
            // The brand stamped on the body: white-hot, cooling to gold.
            float glyph=hushGlyph(p/0.78);
            float heat=exp(-t*6.0);
            mask=glyph*(0.9+0.8*heat)+exp(-r*r*8.0)*heat*0.9;
            color=mix(vColor,HOT,clamp(heat+glyph*0.3,0.0,1.0));
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    material.name = 'hushbrand:surface';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'hushbrand';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['hushbrand', geometry]]), material);
  }

  /** The gauntlet lands: stamp the hush on the enemy. */
  strike(source: number, target: number): boolean {
    if (this.disposed || source === target || !this.preparation.ready('hushbrand')) return false;
    if (!this.anchor(target, 0.55, this.at)) return false;
    let slot = this.strikes.find((s) => !s.active);
    if (!slot) {
      slot = this.strikes[0];
      for (const s of this.strikes) if (s.age > slot.age) slot = s;
    }
    slot.active = true;
    slot.source = source;
    slot.target = target;
    slot.age = 0;
    return true;
  }

  /** Once a frame while the lockout aura holds; `left` is the share still to run. */
  hold(target: number, left: number): void {
    if (this.disposed || !this.preparation.ready('hushbrand')) return;
    let slot = this.brands.find((b) => b.active && b.target === target);
    if (!slot) {
      slot = this.brands.find((b) => !b.active);
      if (!slot) return;
      slot.active = true;
      slot.target = target;
      slot.presence = 0;
      slot.age = 0;
    }
    slot.seen = true;
    slot.left = Number.isFinite(left) ? Math.min(1, Math.max(0, left)) : 1;
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
    for (const s of this.strikes) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= HUSH_STRIKE_DURATION || !this.anchor(s.target, 0.55, this.at)) {
        s.active = false;
        continue;
      }
      // The brand sits on the side of the body facing the Paladin.
      if (this.anchor(s.source, 0.55, this.from)) {
        const dx = this.from.x - this.at.x,
          dz = this.from.z - this.at.z;
        const d = Math.hypot(dx, dz) || 1;
        const body = this.anchor(s.target, 0, this.feet) ? (this.at.y - this.feet.y) / 0.55 : 2;
        const surface = Math.max(0.2, Math.min(0.7, body * 0.18));
        this.at.x += (dx / d) * surface;
        this.at.z += (dz / d) * surface;
      }
      const t = s.age;
      const fade = 1 - ramp(t, HUSH_STRIKE_DURATION * 0.5, HUSH_STRIKE_DURATION);
      const size = 0.5 * (1 + 0.5 * Math.exp(-t * 14));
      this.time = t;
      this.billboard(this.at.x, this.at.y, this.at.z, size, GOLD, fade * 1.1, SHAPE.brand);
      this.billboard(this.at.x, this.at.y, this.at.z, 1.1, GOLD, 1, SHAPE.ring);
      this.billboard(
        this.at.x,
        this.at.y,
        this.at.z,
        0.9,
        IVORY,
        Math.exp(-t * 10) * 1.2,
        SHAPE.flare,
      );
    }
    for (const b of this.brands) {
      if (!b.active) continue;
      b.presence = b.seen ? Math.min(1, b.presence + dt * 6) : Math.max(0, b.presence - dt * 4);
      b.seen = false;
      b.age += dt;
      if (b.presence <= 0 || !this.anchor(b.target, 0, this.feet)) {
        b.active = false;
        continue;
      }
      const head = this.anchor(b.target, 1, this.at) ? this.at.y : this.feet.y + 2;
      const height = Math.max(0.8, head - this.feet.y);
      const x = this.feet.x,
        z = this.feet.z;
      // Fades out over the last of the lockout.
      const k = b.presence * Math.min(1, b.left / 0.15 + 0.25);
      // The broken spell: a flash and shards thrown out of the hands.
      if (b.age < HUSH_SHATTER_DURATION) {
        const t = b.age;
        const cy = this.feet.y + height * 0.6;
        this.billboard(x, cy, z, 1.3, IVORY, Math.exp(-t * 9) * 1.3, SHAPE.flare);
        this.time = t;
        const motion = reduced ? 0.3 : 1;
        for (let i = 0; i < HUSH_SHARDS; i++) {
          const ang = i * 2.399963 + hash(i, 1);
          const speed = (2.2 + 2.4 * hash(i, 2)) * motion;
          const life = 0.35 + 0.2 * hash(i, 3);
          if (t >= life) continue;
          // Out in the view plane and a little toward the camera, falling back.
          const ux = Math.cos(ang),
            uy = Math.sin(ang);
          const ox = (c[0] * ux + c[3] * uy) * speed * t,
            oy = (c[1] * ux + c[4] * uy) * speed * t - 3 * t * t * motion,
            oz = (c[2] * ux + c[5] * uy) * speed * t;
          const size = 0.07 + 0.06 * hash(i, 4);
          this.billboard(
            x + ox,
            cy + oy,
            z + oz,
            size,
            i % 3 ? GOLD : IVORY,
            (1 - t / life) * 1.2,
            SHAPE.shard,
            t * (6 + 5 * hash(i, 5)),
          );
        }
      }
      // A collar of silence about the throat.
      const neck = this.feet.y + height * 0.78;
      const collar = Math.max(0.35, Math.min(1.2, height * 0.24));
      this.time = this.clock;
      const cinch = 1 + 0.6 * Math.exp(-b.age * 8);
      this.quad(
        x,
        neck,
        z,
        collar * cinch,
        0,
        0,
        0,
        0,
        collar * cinch,
        GOLD,
        k * 1.3,
        SHAPE.collar,
      );
      // The hush stays branded on the chest, inside a turning rune band.
      const chest = this.feet.y + height * 0.55;
      const brand = Math.max(0.3, Math.min(0.7, height * 0.2));
      this.billboard(
        x,
        chest,
        z,
        brand * (1 + 0.5 * Math.exp(-b.age * 10)),
        GOLD,
        k * 1.3,
        SHAPE.sigil,
      );
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
    for (const s of this.strikes) s.active = false;
    for (const b of this.brands) b.active = false;
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
    if (errors.length) throw new AggregateError(errors, 'Hushbrand cleanup failed');
  }
}

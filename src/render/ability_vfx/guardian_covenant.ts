import * as THREE from 'three';
import {
  AEGIS_BOW,
  AEGIS_CAPACITY,
  AEGIS_FADE,
  AEGIS_RINGS,
  AEGIS_SEGMENTS,
  AEGIS_VERTEX_BUDGET,
  AEGIS_VISUAL_SCALE,
  AEGIS_WISP_SEGMENTS,
  AEGIS_WISPS,
  aegisPoint,
  aegisWispPoint,
} from '../guardian_covenant_core';
import { PALADIN_BODY_FIT } from '../paladin_body_fit';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import { DAWNREAVER_SOLID_GLSL } from './dawnreaver_emblem';
import { PALADIN_SPEC_EMBLEM_GLSL } from './paladin_spec_emblems';
import {
  bindPaladinSpecIcons,
  PALADIN_SPEC_ICON_GLSL,
  paladinSpecIconUniforms,
} from './paladin_spec_icons';

const CAPACITY = AEGIS_CAPACITY * AEGIS_VERTEX_BUDGET;
const QUAD = [0, 1, 2, 0, 2, 3];
const STRIP = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const ATTRIBUTES = ['position', 'aUv', 'aAlpha', 'aKind'] as const;
/** The spec emblem at the shield's heart: Guardian Covenant's Dawnreaver blade,
 * or the Sunmender's sign for Life Covenant. */
export type CovenantEmblem = 'dawnreaver' | 'sunmender';
type WardKind = 'guardian_covenant' | 'life_covenant_ward';

// Each emblem filled ('emblem') with a fine glow about its edge ('emblemGlow'),
// from the shield point q and its physical width w.
const EMBLEM_GLSL: Record<CovenantEmblem, { helpers: string; body: string }> = {
  dawnreaver: {
    helpers: DAWNREAVER_SOLID_GLSL,
    body: `
          vec2 emblemPoint=vec2(w/0.28,-(q.y-0.04)/0.72);
          float emblemDistance=dawnreaverOutline(emblemPoint);
          float emblem=dawnreaverSolid(emblemPoint);
          float emblemGlow=exp(-emblemDistance*emblemDistance*900.0);`,
  },
  sunmender: {
    helpers: PALADIN_SPEC_ICON_GLSL + PALADIN_SPEC_EMBLEM_GLSL,
    body: `
          // The Sunmender's icon from the atlas, its drawn emblem until then.
          vec2 emblemPoint=vec2(w/0.27,(q.y-0.02)/0.7);
          float emblemDistance=uSpecIconsReady>0.5
            ?paladinSpecIcon(emblemPoint,0.0).x:sunmenderDist(emblemPoint);
          float emblem=1.0-smoothstep(-0.01,0.015,emblemDistance);
          float emblemGlow=exp(-sq(max(emblemDistance,0.0))*900.0);`,
  },
};
interface Aegis {
  id: number;
  seen: boolean;
  age: number;
  fade: number;
  strength: number;
  facing: number;
  x: number;
  y: number;
  z: number;
  height: number;
  answerFacing: number | null;
}

/** One prepared mesh and fixed recipients; snapshot refreshes own the true lifetime. */
export class GuardianCovenant {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<WardKind>;
  private readonly kind: WardKind;
  private readonly slots: Aegis[] = Array.from({ length: AEGIS_CAPACITY }, () => ({
    id: -1,
    seen: false,
    age: 0,
    fade: 0,
    strength: 1,
    facing: 0,
    x: 0,
    y: 0,
    z: 0,
    height: 2,
    answerFacing: null,
  }));
  private readonly positions = new Float32Array(CAPACITY * 3);
  private readonly uvs = new Float32Array(CAPACITY * 3);
  private readonly alphas = new Float32Array(CAPACITY);
  /** 0 for the shield surface, 1 for the swirling wisps. */
  private readonly kinds = new Float32Array(CAPACITY);
  private readonly wispA = { x: 0, y: 0, z: 0 };
  private readonly wispB = { x: 0, y: 0, z: 0 };
  private readonly feet = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly point = { x: 0, y: 0, z: 0 };
  private vertex = 0;
  private time = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly camera?: THREE.Camera,
    emblem: CovenantEmblem = 'dawnreaver',
  ) {
    this.kind = emblem === 'sunmender' ? 'life_covenant_ward' : 'guardian_covenant';
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['aUv', this.uvs, 3],
      ['aAlpha', this.alphas, 1],
      ['aKind', this.kinds, 1],
    ] as const)
      geometry.setAttribute(
        name,
        new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage),
      );
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGold: { value: new THREE.Color(0xe8bb76) },
        uIvory: { value: new THREE.Color(0xfff1cc) },
        ...(emblem === 'sunmender' ? paladinSpecIconUniforms() : {}),
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `attribute vec3 aUv; attribute float aAlpha, aKind;
        varying vec3 vUv; varying float vAlpha, vKind;
        void main(){vUv=aUv;vAlpha=aAlpha;vKind=aKind;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform float uTime; uniform vec3 uGold; uniform vec3 uIvory;
        varying vec3 vUv; varying float vAlpha, vKind;
        ${EMBLEM_GLSL[emblem].helpers}
        // Kite half-width at a height on the unit shield (see aegisPoint).
        float kiteWidth(float c){
          c=clamp(c,-1.0,1.0);
          return c>=0.5?${PALADIN_BODY_FIT.shieldWidth.toFixed(2)}*(1.0-c)/0.5:${PALADIN_BODY_FIT.shieldWidth.toFixed(2)}*pow(max((c+1.0)/1.5,0.0),0.7);
        }
        float sq(float x){return x*x;}
        void main(){
          if(vKind>0.5){
            // Swirling wisp: thin ribbon, bright head, fading tail.
            float u=vUv.x;
            float w=exp(-vUv.y*vUv.y*4.0)*pow(max(u,0.0),1.4)*(0.75+0.25*sin(u*18.0-uTime*6.0))*vAlpha;
            if(!(w>=0.003)) discard;
            gl_FragColor=vec4(mix(uGold,uIvory,u*u*0.6)*1.6,w);
            #include <colorspace_fragment>
            return;
          }
          vec2 q=vUv.xy;
          float r=length(q);
          // Thick outer rim with a white-hot core, and a finer inner outline.
          float rim=exp(-sq((r-0.962)*26.0));
          float rimCore=exp(-sq((r-0.968)*70.0));
          float inner=exp(-sq((r-0.885)*95.0));
          // A highlight runs slowly round the rim.
          float around=atan(q.x,q.y)/6.2831853+0.5;
          float gap=abs(around-fract(uTime*0.18)); gap=min(gap,1.0-gap);
          float runner=exp(-gap*28.0)*rim;
          // Nested outlines converge on the point, with a seam down the centre.
          float across=vUv.z/max(kiteWidth(q.y),0.02);
          float nested=exp(-sq((abs(across)-0.62)*18.0))*0.4+exp(-sq((abs(across)-0.3)*22.0))*0.2;
          nested*=smoothstep(0.1,0.45,r)*(1.0-smoothstep(0.84,0.9,r));
          float seam=exp(-abs(vUv.z)*110.0)*0.35*(1.0-smoothstep(0.84,0.9,r));
          // Glass: brighter toward the rim, with a slow ripple outward.
          float glass=0.035+0.24*pow(max(r,0.0),4.0)+exp(-sq((r-fract(uTime*0.4))*7.0))*0.08;
          // Spec emblem at the centre, over a radiant sun glow.
          float w=vUv.z;${EMBLEM_GLSL[emblem].body}
          vec2 sun=vec2(vUv.z,q.y-0.04);
          float d=length(sun);
          float angle=atan(sun.y,sun.x);
          float halo=exp(-d*d*20.0)*0.3;
          float rays=pow(abs(cos(angle*4.0+uTime*0.3)),30.0)*exp(-d*4.0)*0.5;
          float motes=pow(max(0.0,sin(q.x*71.0+sin(q.y*28.0))*sin(q.y*59.0-uTime)),40.0);
          float twinkle=motes*(0.5+0.5*sin(uTime*5.0+q.x*40.0));
          float light=clamp(max(max(rimCore,emblem),runner),0.0,1.0);
          float a=(glass+rim*0.9+rimCore*0.8+runner*0.9+inner*0.45+nested+seam+halo+rays
            +emblem*1.2+emblemGlow*0.4+twinkle*0.35)*vAlpha;
          a*=1.0-smoothstep(0.989,1.0,r);
          if(!(a>=0.003)) discard;
          gl_FragColor=vec4(mix(uGold,uIvory,light)*1.8,a);
          #include <colorspace_fragment>
        }`,
    });
    material.name = `guardian_covenant:${this.kind}`;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name =
      emblem === 'sunmender' ? 'life-covenant-sun-aegis' : 'guardian-covenant-twin-aegis';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([[this.kind, geometry]]), material);
  }

  hold(id: number, value: number, facing: number): boolean {
    if (this.disposed || !this.preparation.ready(this.kind)) return false;
    let slot: Aegis | undefined;
    let free: Aegis | undefined;
    for (let i = 0; i < this.slots.length; i++) {
      const candidate = this.slots[i];
      if (candidate.id === id) {
        slot = candidate;
        break;
      }
      if (!free && candidate.id < 0) free = candidate;
    }
    slot ??= free;
    if (!slot) return false;
    if (slot.id !== id) {
      slot.id = id;
      slot.age = 0;
      slot.answerFacing = null;
    }
    const strength = value >= 0.29 ? 1.35 : 1;
    slot.strength = slot.seen ? Math.max(slot.strength, strength) : strength;
    slot.seen = true;
    slot.fade = AEGIS_FADE;
    slot.facing = Number.isFinite(facing) ? facing : 0;
    return true;
  }

  /** Includes the short expiry fade so Debt's own rim can return smoothly. */
  coverage(id: number, dt = 0): number {
    if (this.disposed) return 0;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const s of this.slots)
      if (s.id === id) return Math.max(0, (s.fade - (s.seen ? 0 : dt)) / AEGIS_FADE);
    return 0;
  }

  alignAnswer(id: number, facing: number): void {
    for (const s of this.slots) if (s.id === id) s.answerFacing = facing;
  }

  private emit(
    s: Aegis,
    x: number,
    y: number,
    z: number,
    t: number,
    edge: number,
    alpha: number,
  ): void {
    const sn = Math.sin(s.answerFacing ?? s.facing),
      cs = Math.cos(s.answerFacing ?? s.facing),
      v = this.vertex++;
    // Scale around the shield face centre, preserving the approved layer spacing.
    const localX = x;
    x *= AEGIS_VISUAL_SCALE;
    y = PALADIN_BODY_FIT.shieldCenter + (y - PALADIN_BODY_FIT.shieldCenter) * AEGIS_VISUAL_SCALE;
    z =
      PALADIN_BODY_FIT.shieldFront +
      AEGIS_BOW +
      (z - PALADIN_BODY_FIT.shieldFront - AEGIS_BOW) * AEGIS_VISUAL_SCALE;
    this.positions[v * 3] = s.x + (x * cs + z * sn) * s.height;
    this.positions[v * 3 + 1] = s.y + y * s.height;
    this.positions[v * 3 + 2] = s.z + (z * cs - x * sn) * s.height;
    this.uvs[v * 3] = t;
    this.uvs[v * 3 + 1] = edge;
    // Physical local width keeps the spec halo round on the tapered shield.
    this.uvs[v * 3 + 2] = localX;
    this.alphas[v] = alpha;
    this.kinds[v] = 0;
  }

  /** Ribbons of light swirling round the wearer, widened toward the camera. */
  private wisps(s: Aegis, alpha: number, reduced: boolean): void {
    const segments = reduced ? AEGIS_WISP_SEGMENTS / 2 : AEGIS_WISP_SEGMENTS;
    const e = this.camera?.matrixWorld.elements;
    const vx = e ? -e[8] : 0,
      vy = e ? -e[9] : 0,
      vz = e ? -e[10] : -1;
    const width = s.height * 0.02;
    for (let w = 0; w < AEGIS_WISPS; w++)
      for (let k = 0; k < segments; k++) {
        const a = this.wispA,
          b = this.wispB;
        aegisWispPoint(w, k / segments, s.age, reduced, a);
        aegisWispPoint(w, (k + 1) / segments, s.age, reduced, b);
        // Width across the ribbon, perpendicular to both it and the view.
        const dx = b.x - a.x,
          dy = b.y - a.y,
          dz = b.z - a.z;
        let px = dy * vz - dz * vy,
          py = dz * vx - dx * vz,
          pz = dx * vy - dy * vx;
        const length = Math.hypot(px, py, pz);
        if (length < 1e-6) {
          px = 0;
          py = 1;
          pz = 0;
        } else {
          px /= length;
          py /= length;
          pz /= length;
        }
        for (let j = 0; j < 6; j++) {
          const end = STRIP[j * 2],
            edge = STRIP[j * 2 + 1],
            p = end ? b : a,
            v = this.vertex++;
          this.positions[v * 3] = s.x + p.x * s.height + px * width * edge;
          this.positions[v * 3 + 1] = s.y + p.y * s.height + py * width * edge;
          this.positions[v * 3 + 2] = s.z + p.z * s.height + pz * width * edge;
          this.uvs[v * 3] = (k + end) / segments;
          this.uvs[v * 3 + 1] = edge;
          this.uvs[v * 3 + 2] = 0;
          this.alphas[v] = alpha;
          this.kinds[v] = 1;
        }
      }
  }

  update(dt: number, reduced: boolean): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.time += dt;
    this.vertex = 0;
    this.mesh.material.uniforms.uTime.value = reduced ? 0 : this.time;
    if (this.kind === 'life_covenant_ward') bindPaladinSpecIcons(this.mesh.material);
    const segments = reduced ? AEGIS_SEGMENTS / 2 : AEGIS_SEGMENTS;
    for (const s of this.slots) {
      if (s.id < 0) continue;
      s.age += dt;
      if (!s.seen) s.fade -= dt;
      if (s.fade <= 0 || !this.anchor(s.id, 0, this.feet) || !this.anchor(s.id, 1, this.head)) {
        s.id = -1;
        s.seen = false;
        continue;
      }
      s.x = this.feet.x;
      s.y = this.feet.y;
      s.z = this.feet.z;
      s.height = Math.max(0.6, Math.min(6, this.head.y - this.feet.y));
      const alpha =
        Math.min(1, s.age / 0.12) *
        (s.fade / AEGIS_FADE) *
        s.strength *
        (0.74 + 0.55 * Math.max(0, 1 - s.age / 0.65));
      // Shared radial rings keep the bowed surface and ivory rim in one draw.
      for (let ring = 0; ring < AEGIS_RINGS; ring++)
        for (let segment = 0; segment < segments; segment++)
          for (const corner of QUAD) {
            const radius = (ring + (corner >= 2 ? 1 : 0)) / AEGIS_RINGS;
            const angle =
              ((segment + (corner === 1 || corner === 2 ? 1 : 0)) / segments) * Math.PI * 2;
            aegisPoint(angle, radius, s.age, reduced, this.point);
            this.emit(
              s,
              this.point.x,
              this.point.y,
              this.point.z,
              Math.sin(angle) * radius,
              Math.cos(angle) * radius,
              alpha,
            );
          }
      this.wisps(s, alpha * 0.8, reduced);
      s.seen = false;
      s.answerFacing = null;
    }
    for (const name of ATTRIBUTES) {
      const a = this.mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      if (this.vertex) {
        a.addUpdateRange(0, this.vertex * a.itemSize);
        a.needsUpdate = true;
      }
    }
    if (this.preparation.ready(this.kind)) this.mesh.geometry.setDrawRange(0, this.vertex);
    this.mesh.visible = this.vertex > 0;
  }

  clear(): void {
    for (const s of this.slots) {
      s.id = -1;
      s.seen = false;
      s.answerFacing = null;
    }
    this.mesh.visible = false;
    if (this.preparation.ready(this.kind)) this.mesh.geometry.setDrawRange(0, 0);
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

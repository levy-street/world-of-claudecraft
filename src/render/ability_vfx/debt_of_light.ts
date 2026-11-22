import * as THREE from 'three';
import {
  DEBT_CAPACITY,
  DEBT_FADE_DURATION,
  DEBT_RETURN_DURATION,
  DEBT_SEGMENTS,
  DEBT_VERTEX_BUDGET,
  DEBT_WISP_SEGMENTS,
  DEBT_WISPS,
  debtEnvelope,
  debtShieldPoint,
  debtSpikeGrowth,
  debtSpikeRelease,
} from '../debt_of_light_core';
import { AEGIS_BOW, AEGIS_SUN_Y, AEGIS_VISUAL_SCALE } from '../guardian_covenant_core';
import { PALADIN_BODY_FIT } from '../paladin_body_fit';
import type { VfxAnchorResolver } from '../vfx_anchor';
import { CrestPrewarm } from './crest_prewarm';
import type { GuardianCovenant } from './guardian_covenant';

const CAPACITY = DEBT_CAPACITY * DEBT_VERTEX_BUDGET * 2;
// Keep the retaliatory layer just ahead of Guardian's bowed face.
const SHIELD_FRONT_CLEARANCE = 0.035;
// Sunheart spikes: a long central cone and four shorter ones around the sun.
const SPIKES = [0, 0, -0.105, 0.105, 0.105, 0.105, -0.105, -0.105, 0.105, -0.105];
const SPIKE_LENGTH = { centre: 0.24, outer: 0.16 };
const SPIKE_RADIUS = { centre: 0.058, outer: 0.042 };
const CORNERS = [0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1];
const COLORS = [
  new THREE.Color(0xe8bb76).multiplyScalar(1.25),
  new THREE.Color(0xfff1cc).multiplyScalar(1.45),
  new THREE.Color(0x947047),
];
const GOLD = 0,
  HOT = 1,
  BRONZE = 2;
/** Shader shapes. The membrane fan and its rim keep the original vertex order
 * Guardian Covenant composes against. */
const SHAPE = {
  line: 0,
  membrane: 1,
  rim: 3,
  spike: 4,
  sun: 5,
  wisp: 6,
  flare: 7,
} as const;
const ATTRIBUTES = ['position', 'aUv', 'aColor', 'aAlpha', 'aShape', 'aInfo'] as const;
interface Guard {
  id: number;
  age: number;
  seen: boolean;
  fade: number;
  strength: number;
  facing: number;
  x: number;
  y: number;
  z: number;
}
interface Answer {
  sourceId: number;
  active: boolean;
  age: number;
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  tz: number;
  absorbed: boolean;
}

/** Fixed pools, one prepared material, no texture loads or frame allocations. */
export class DebtOfLight {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly preparation: CrestPrewarm<'debt_of_light'>;
  private readonly guards: Guard[] = Array.from({ length: DEBT_CAPACITY }, () => ({
    id: -1,
    age: 0,
    seen: false,
    fade: 0,
    strength: 1,
    facing: 0,
    x: 0,
    y: 0,
    z: 0,
  }));
  private readonly answers: Answer[] = Array.from({ length: DEBT_CAPACITY }, () => ({
    sourceId: -1,
    active: false,
    age: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    tx: 0,
    ty: 0,
    tz: 0,
    absorbed: false,
  }));
  private readonly positions = new Float32Array(CAPACITY * 3);
  private readonly uvs = new Float32Array(CAPACITY * 2);
  private readonly colors = new Float32Array(CAPACITY * 3);
  private readonly alphas = new Float32Array(CAPACITY);
  private readonly shapes = new Float32Array(CAPACITY);
  /** Per vertex: perimeter position (rim), facet shade (spikes), or age. */
  private readonly infos = new Float32Array(CAPACITY * 2);
  private readonly source = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private vertex = 0;
  private shape: number = SHAPE.line;
  private info = 0;
  private time = 0;
  private readonly edgeA = { x: 0, y: 0, z: 0 };
  private readonly edgeB = { x: 0, y: 0, z: 0 };
  private disposed = false;
  constructor(
    scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly camera?: THREE.Camera,
    /** The two Guardian Covenant reads the return needs (coverage and the
     *  answer's facing), handed over as closures so this pool never holds
     *  the covenant's own meshes. */
    private readonly guardian?: Pick<GuardianCovenant, 'coverage' | 'alignAnswer'>,
  ) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['aUv', this.uvs, 2],
      ['aColor', this.colors, 3],
      ['aAlpha', this.alphas, 1],
      ['aShape', this.shapes, 1],
      ['aInfo', this.infos, 2],
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
        attribute vec2 aUv, aInfo; attribute vec3 aColor; attribute float aAlpha, aShape;
        varying vec2 vUv, vInfo; varying vec3 vColor; varying float vAlpha, vShape;
        void main(){vUv=aUv;vInfo=aInfo;vColor=aColor;vAlpha=aAlpha;vShape=aShape;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
      `,
      fragmentShader: `
        varying vec2 vUv, vInfo; varying vec3 vColor; varying float vAlpha, vShape;
        const vec3 HOT=vec3(1.0,0.88,0.604);
        float sq(float x){return x*x;}
        void main(){
          if(vAlpha<=0.001) discard;
          float t=vInfo.y;
          float mask;
          vec3 color=vColor;
          if(vShape>6.5){
            // Impact flare at the repaid attacker: core and a four-point star.
            vec2 p=vec2(vUv.x*2.0-1.0,vUv.y); float r=length(p);
            float core=exp(-r*r*16.0);
            float spokes=exp(-abs(p.y)*30.0)*exp(-abs(p.x)*1.8)+exp(-abs(p.x)*30.0)*exp(-abs(p.y)*2.4);
            mask=(core*1.5+exp(-r*r*4.0)*0.35+spokes*0.8)*(1.0-smoothstep(0.85,1.0,max(abs(p.x),abs(p.y))));
            color=mix(vColor,HOT,core);
          } else if(vShape>5.5){
            // Swirling wisp: thin ribbon, bright head, fading tail.
            mask=exp(-vUv.y*vUv.y*4.0)*pow(max(vUv.x,0.0),1.4)*(0.75+0.25*sin(vUv.x*18.0-t*6.0));
            color=mix(vColor,HOT,vUv.x*vUv.x*0.6);
          } else if(vShape>4.5){
            // Sun heart: white core, halo, eight rays and a long vertical glint.
            vec2 p=vec2(vUv.x*2.0-1.0,vUv.y); float r=length(p); float a=atan(p.y,p.x);
            float core=exp(-r*r*22.0);
            float rays=pow(abs(cos(a*4.0+t*0.4)),36.0)*exp(-r*3.0)*0.7;
            float glint=exp(-abs(p.x)*38.0)*exp(-abs(p.y)*1.4)*0.6+exp(-abs(p.y)*38.0)*exp(-abs(p.x)*2.6)*0.35;
            mask=(core*1.6+exp(-r*r*5.0)*0.4+rays+glint)*(1.0-smoothstep(0.85,1.0,max(abs(p.x),abs(p.y))));
            color=mix(vColor,HOT,core+glint*0.5);
          } else if(vShape>3.5){
            // Spike facet: bronze-gold at the root, white-hot at the point,
            // each facet lit by its own angle so the cone reads as solid.
            float tip=vUv.x;
            float shade=vInfo.x;
            mask=mix(0.45,1.25,pow(max(tip,0.0),1.4))*shade;
            color=mix(mix(vec3(0.29,0.16,0.06),vColor,0.6+0.4*shade),HOT,pow(max(tip,0.0),2.5));
          } else if(vShape>2.5){
            // Rim: gaussian glow with a hot centre; a highlight runs round it.
            float across=abs(vUv.y);
            float runner=fract(t*0.35);
            float gap=abs(vInfo.x-runner); gap=min(gap,1.0-gap);
            mask=exp(-across*across*3.5)*(1.0+1.4*exp(-gap*30.0));
            color=mix(vColor,HOT,exp(-across*across*18.0)*0.6);
          } else if(vShape>0.5){
            // Membrane: glassy, brighter toward the rim, with veins running
            // from the sun to the edge and a slow ripple of light outward.
            float r=vUv.x; float around=vUv.y;
            float vein=exp(-sq((fract(around*10.0+0.5)-0.5)*12.0))*r*0.55;
            float ripple=exp(-sq((r-fract(t*0.45))*7.0))*0.35;
            mask=0.3+0.9*pow(max(r,0.0),3.0)+vein+ripple;
            color=mix(vColor,HOT,vein*0.6+pow(max(r,0.0),6.0)*0.4);
          } else {
            mask=1.0-smoothstep(0.45,0.95,abs(vUv.y));
          }
          float opacity=vAlpha*mask;
          if(!(opacity>=0.003)) discard;
          gl_FragColor=vec4(color,opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'debt-of-light';
    this.mesh.userData.renderCategory = 'vfx';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.preparation = new CrestPrewarm(scene, new Map([['debt_of_light', geometry]]), material);
  }
  hold(id: number, strength = 1, facing = 0): boolean {
    if (this.disposed || !this.preparation.ready('debt_of_light')) return false;
    let slot: Guard | undefined;
    for (const candidate of this.guards)
      if (candidate.id === id) {
        slot = candidate;
        break;
      }
    if (!slot)
      for (const candidate of this.guards)
        if (candidate.id < 0) {
          slot = candidate;
          break;
        }
    if (!slot) return false;
    if (slot.id !== id) {
      slot.id = id;
      slot.age = 0;
    }
    slot.seen = true;
    slot.fade = DEBT_FADE_DURATION;
    slot.strength = Math.max(1, Math.min(1.5, Number.isFinite(strength) ? strength : 1));
    slot.facing = Number.isFinite(facing) ? facing : 0;
    return true;
  }
  answer(source: number, target: number, absorbed = false): boolean {
    if (this.disposed || source === target || !this.preparation.ready('debt_of_light'))
      return false;
    if (!this.anchor(source, 0.62, this.source) || !this.anchor(target, 0.62, this.target))
      return false;
    const slot = this.answers.find((s) => !s.active);
    if (!slot) return false;
    for (const guard of this.guards)
      if (guard.id === source) {
        guard.id = -1;
        guard.seen = false;
      }
    slot.sourceId = source;
    slot.active = true;
    slot.age = 0;
    slot.absorbed = absorbed;
    slot.sx = this.source.x;
    slot.sy = this.source.y;
    slot.sz = this.source.z;
    slot.tx = this.target.x;
    slot.ty = this.target.y;
    slot.tz = this.target.z;
    return true;
  }
  private write(v: number, u: number, w: number, color: number, alpha: number): void {
    const c = COLORS[color];
    this.uvs[v * 2] = u;
    this.uvs[v * 2 + 1] = w;
    this.colors[v * 3] = c.r;
    this.colors[v * 3 + 1] = c.g;
    this.colors[v * 3 + 2] = c.b;
    this.alphas[v] = Math.max(0, alpha);
    this.shapes[v] = this.shape;
    this.infos[v * 2] = this.info;
    this.infos[v * 2 + 1] = this.time;
  }
  private strip(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    width: number,
    color: number,
    alpha: number,
    tipScale = 1,
    infoA = this.info,
    infoB = this.info,
  ): void {
    this.forward.set(bx - ax, by - ay, bz - az);
    if (this.camera)
      this.view.set(
        this.camera.position.x - ax,
        this.camera.position.y - ay,
        this.camera.position.z - az,
      );
    else this.view.set(0, 0, 1);
    this.side.crossVectors(this.forward, this.view);
    if (this.side.lengthSq() < 0.000001) this.side.set(1, 0, 0);
    this.side.normalize().multiplyScalar(width);
    for (let j = 0; j < 6; j++) {
      const t = CORNERS[j * 2],
        edge = CORNERS[j * 2 + 1] * (1 + t * (tipScale - 1)),
        v = this.vertex++;
      this.positions[v * 3] = ax + (bx - ax) * t + this.side.x * edge;
      this.positions[v * 3 + 1] = ay + (by - ay) * t + this.side.y * edge;
      this.positions[v * 3 + 2] = az + (bz - az) * t + this.side.z * edge;
      this.info = t ? infoB : infoA;
      this.write(v, t, edge, color, alpha);
    }
    this.info = infoA;
  }
  private point(
    x: number,
    y: number,
    z: number,
    color: number,
    alpha: number,
    u = 0.5,
    w = 0,
  ): void {
    const v = this.vertex++;
    this.positions[v * 3] = x;
    this.positions[v * 3 + 1] = y;
    this.positions[v * 3 + 2] = z;
    this.write(v, u, w, color, alpha);
  }
  /** Flat quad in the plane spanned by (rx, ry, rz) and world up. */
  private panel(
    x: number,
    y: number,
    z: number,
    rx: number,
    rz: number,
    half: number,
    color: number,
    alpha: number,
  ): void {
    for (let j = 0; j < 6; j++) {
      const u = CORNERS[j * 2],
        side = CORNERS[j * 2 + 1],
        along = (u * 2 - 1) * half,
        v = this.vertex++;
      this.positions[v * 3] = x + rx * along;
      this.positions[v * 3 + 1] = y + side * half;
      this.positions[v * 3 + 2] = z + rz * along;
      this.write(v, u, side, color, alpha);
    }
  }
  /** Camera-facing quad. */
  private billboard(
    x: number,
    y: number,
    z: number,
    half: number,
    color: number,
    alpha: number,
  ): void {
    const e = this.camera?.matrixWorld.elements;
    const rx = e ? e[0] : 1,
      ry = e ? e[1] : 0,
      rz = e ? e[2] : 0,
      ux = e ? e[4] : 0,
      uy = e ? e[5] : 1,
      uz = e ? e[6] : 0;
    for (let j = 0; j < 6; j++) {
      const u = CORNERS[j * 2],
        side = CORNERS[j * 2 + 1],
        along = (u * 2 - 1) * half,
        up = side * half,
        v = this.vertex++;
      this.positions[v * 3] = x + rx * along + ux * up;
      this.positions[v * 3 + 1] = y + ry * along + uy * up;
      this.positions[v * 3 + 2] = z + rz * along + uz * up;
      this.write(v, u, side, color, alpha);
    }
  }
  private shield(
    x: number,
    y: number,
    z: number,
    nx: number,
    nz: number,
    alpha: number,
    age: number,
    segments: number,
    strength: number,
    growth: number,
    tx: number,
    ty: number,
    tz: number,
    height: number,
    coverage: number,
    spikeAlpha = alpha,
  ): void {
    this.time = age;
    // Bow the membrane forward. Every spike stays rooted in this same surface.
    x += nx * SHIELD_FRONT_CLEARANCE * height;
    z += nz * SHIELD_FRONT_CLEARANCE * height;
    // Grow the whole shield and spikes around its existing face centre.
    const centreCorrection = AEGIS_BOW * height * (1 - AEGIS_VISUAL_SCALE);
    x += nx * centreCorrection;
    z += nz * centreCorrection;
    height *= AEGIS_VISUAL_SCALE;
    for (let i = 0; i < segments; i++) {
      debtShieldPoint(i / segments, this.edgeA);
      debtShieldPoint((i + 1) / segments, this.edgeB);
      const a = this.edgeA,
        b = this.edgeB;
      const ax = x + (nz * a.x + nx * a.z) * height,
        ay = y + a.y * height,
        az = z + (-nx * a.x + nz * a.z) * height;
      const bx = x + (nz * b.x + nx * b.z) * height,
        by = y + b.y * height,
        bz = z + (-nx * b.x + nz * b.z) * height;
      // Glass face: a fan from the bowed centre; uv carries (toward rim, around).
      const membrane = alpha * (1 - coverage);
      this.shape = SHAPE.membrane;
      this.point(
        x + nx * AEGIS_BOW * height,
        y,
        z + nz * AEGIS_BOW * height,
        GOLD,
        membrane * 0.45,
        0,
        (i + 0.5) / segments,
      );
      this.point(ax, ay, az, BRONZE, membrane * 0.45, 1, i / segments);
      this.point(bx, by, bz, GOLD, membrane * 0.45, 1, (i + 1) / segments);
      // Thick glowing rim with a hot centre; the runner highlight rides it.
      this.shape = SHAPE.rim;
      this.strip(
        ax,
        ay,
        az,
        bx,
        by,
        bz,
        0.026 * height * strength,
        GOLD,
        alpha * 0.9,
        1,
        i / segments,
        (i + 1) / segments,
      );
      this.strip(
        ax,
        ay,
        az,
        bx,
        by,
        bz,
        0.008 * height,
        HOT,
        alpha * 1.2,
        1,
        i / segments,
        (i + 1) / segments,
      );
    }
    // The inner sun boss remains legible alone; the outer ward owns the combined sun flare.
    this.shape = SHAPE.line;
    this.info = 0;
    const bossY = y + AEGIS_SUN_Y * height;
    const bossZ = (AEGIS_BOW + 0.008) * height;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8,
        b = ((i + 1) * Math.PI) / 8;
      const radius = height * 0.065;
      this.strip(
        x + nx * bossZ + nz * Math.cos(a) * radius,
        bossY + Math.sin(a) * radius,
        z + nz * bossZ - nx * Math.cos(a) * radius,
        x + nx * bossZ + nz * Math.cos(b) * radius,
        bossY + Math.sin(b) * radius,
        z + nz * bossZ - nx * Math.cos(b) * radius,
        height * 0.011,
        GOLD,
        alpha * (1 - coverage * 0.75),
      );
    }
    for (let ray = 0; ray < 8; ray++) {
      const a = (ray * Math.PI) / 4 + 0.035 * Math.sin(age);
      this.strip(
        x + nx * bossZ,
        bossY,
        z + nz * bossZ,
        x + nx * bossZ + nz * Math.cos(a) * height * 0.11,
        bossY + Math.sin(a) * height * 0.11,
        z + nz * bossZ - nx * Math.cos(a) * height * 0.11,
        height * 0.007,
        HOT,
        alpha * (1 - coverage),
        0,
      );
    }
    // Radiant sun heart laid on the face.
    this.shape = SHAPE.sun;
    this.panel(
      x + nx * (bossZ + 0.004 * height),
      bossY,
      z + nz * (bossZ + 0.004 * height),
      nz,
      -nx,
      height * 0.2,
      HOT,
      alpha * (1 - coverage * 0.6),
    );
    for (let spike = 0; spike < 5; spike++) {
      const lateral = SPIKES[spike * 2] * height,
        vertical = (SPIKES[spike * 2 + 1] + AEGIS_SUN_Y) * height;
      const bow = (AEGIS_BOW + 0.008 - (spike === 0 ? 0 : 0.018)) * height;
      const bx = x + nz * lateral + nx * bow,
        by = y + vertical,
        bz = z - nx * lateral + nz * bow;
      const length = height * (spike === 0 ? SPIKE_LENGTH.centre : SPIKE_LENGTH.outer);
      const shortX = bx + nx * length,
        shortY = by,
        shortZ = bz + nz * length;
      const ex = shortX + (tx + nz * lateral * 0.2 - shortX) * growth;
      const ey = shortY + (ty + vertical * 0.2 - shortY) * growth;
      const ez = shortZ + (tz - nx * lateral * 0.2 - shortZ) * growth;
      const radius = height * (spike === 0 ? SPIKE_RADIUS.centre : SPIKE_RADIUS.outer);
      // Solid golden cone: six facets, each shaded by its angle to an
      // upper-left key light, base at uv 0 and point at uv 1.
      this.shape = SHAPE.spike;
      for (let face = 0; face < 6; face++) {
        const a = (face * Math.PI) / 3,
          b = ((face + 1) * Math.PI) / 3;
        this.info = 0.55 + 0.45 * Math.max(0, Math.cos((a + b) * 0.5 - 2.3));
        this.point(
          bx + nz * Math.cos(a) * radius,
          by + Math.sin(a) * radius,
          bz - nx * Math.cos(a) * radius,
          GOLD,
          spikeAlpha,
          0,
        );
        this.point(
          bx + nz * Math.cos(b) * radius,
          by + Math.sin(b) * radius,
          bz - nx * Math.cos(b) * radius,
          GOLD,
          spikeAlpha,
          0,
        );
        this.point(ex, ey, ez, HOT, spikeAlpha, 1);
      }
      // A soft sheath and a hot core; released spikes become lances of light.
      this.shape = SHAPE.line;
      this.info = 0;
      const lance = growth > 0 ? 1.8 : 1;
      this.strip(bx, by, bz, ex, ey, ez, radius * 0.6 * lance, GOLD, spikeAlpha * 0.6, 0);
      this.strip(bx, by, bz, ex, ey, ez, radius * 0.18 * lance, HOT, spikeAlpha, 0);
    }
  }
  /** Ribbons of light swirling round the wearer while the debt is held. */
  private wisps(
    fx: number,
    fy: number,
    fz: number,
    height: number,
    age: number,
    alpha: number,
    reduced: boolean,
  ): void {
    this.shape = SHAPE.wisp;
    this.time = age;
    const segments = reduced ? DEBT_WISP_SEGMENTS / 2 : DEBT_WISP_SEGMENTS;
    for (let w = 0; w < DEBT_WISPS; w++) {
      const spin = (reduced ? 0 : age * 1.3) + w * Math.PI;
      const tilt = w ? -0.35 : 0.35;
      const point = (u: number, out: THREE.Vector3) => {
        const angle = spin + u * 2.4;
        const radius = height * (0.46 + 0.05 * Math.sin(u * 5 + w));
        out.set(
          fx + Math.sin(angle) * radius,
          fy + height * (0.2 + u * 0.55 + tilt * 0.15 * Math.sin(angle)),
          fz + Math.cos(angle) * radius,
        );
      };
      for (let k = 0; k < segments; k++) {
        point(k / segments, this.source);
        point((k + 1) / segments, this.head);
        this.info = 0;
        const a = this.source,
          b = this.head;
        this.forward.set(b.x - a.x, b.y - a.y, b.z - a.z);
        if (this.camera)
          this.view.set(
            this.camera.position.x - a.x,
            this.camera.position.y - a.y,
            this.camera.position.z - a.z,
          );
        else this.view.set(0, 0, 1);
        this.side.crossVectors(this.forward, this.view);
        if (this.side.lengthSq() < 0.000001) this.side.set(0, 1, 0);
        this.side.normalize().multiplyScalar(height * 0.02);
        for (let j = 0; j < 6; j++) {
          const end = CORNERS[j * 2],
            edge = CORNERS[j * 2 + 1],
            p = end ? b : a,
            v = this.vertex++;
          this.positions[v * 3] = p.x + this.side.x * edge;
          this.positions[v * 3 + 1] = p.y + this.side.y * edge;
          this.positions[v * 3 + 2] = p.z + this.side.z * edge;
          this.write(v, (k + end) / segments, edge, GOLD, alpha);
        }
      }
    }
  }
  update(dt: number, reduced: boolean): void {
    if (this.disposed) return;
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.vertex = 0;
    const segments = reduced ? 16 : DEBT_SEGMENTS;
    for (const s of this.guards) {
      if (s.id < 0) continue;
      s.age += dt;
      if (!s.seen) s.fade -= dt;
      if (s.fade <= 0 || !this.anchor(s.id, 0, this.source) || !this.anchor(s.id, 1, this.head)) {
        s.id = -1;
        continue;
      }
      s.x = this.source.x;
      const height = Math.max(0.6, Math.min(6, this.head.y - this.source.y));
      const feet = this.source.y;
      s.y = this.source.y + PALADIN_BODY_FIT.shieldCenter * height;
      s.z = this.source.z;
      const alpha = Math.min(1, s.age / 0.12) * (s.fade / DEBT_FADE_DURATION);
      const cover = this.guardian?.coverage(s.id, dt) ?? 0;
      const nx = Math.sin(s.facing),
        nz = Math.cos(s.facing);
      this.shield(
        s.x + nx * PALADIN_BODY_FIT.shieldFront * height,
        s.y,
        s.z + nz * PALADIN_BODY_FIT.shieldFront * height,
        nx,
        nz,
        alpha,
        reduced ? 0 : s.age,
        segments,
        s.strength,
        0,
        0,
        0,
        0,
        height,
        cover,
      );
      // Guardian draws the shared wisps while it covers this wearer.
      this.wisps(s.x, feet, s.z, height, s.age, alpha * (1 - cover), reduced);
      s.seen = false;
    }
    for (const s of this.answers) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= DEBT_RETURN_DURATION) {
        s.active = false;
        continue;
      }
      if (!this.anchor(s.sourceId, 0, this.source) || !this.anchor(s.sourceId, 1, this.head)) {
        s.active = false;
        continue;
      }
      const height = Math.max(0.6, Math.min(6, this.head.y - this.source.y));
      s.sx = this.source.x;
      s.sy = this.source.y + PALADIN_BODY_FIT.shieldCenter * height;
      s.sz = this.source.z;
      const dim = s.absorbed ? 0.5 : 1;
      // The denied hit flashes the shield before it settles and fades.
      const alpha = debtEnvelope(s.age) * dim * (1 + 1.2 * Math.exp(-s.age * 18));
      const dx = s.tx - s.sx,
        dz = s.tz - s.sz,
        d = Math.hypot(dx, dz);
      const nx = d > 0.001 ? dx / d : 0,
        nz = d > 0.001 ? dz / d : 1;
      const offset = PALADIN_BODY_FIT.shieldFront * height;
      this.guardian?.alignAnswer(s.sourceId, Math.atan2(nx, nz));
      this.shield(
        s.sx + nx * offset,
        s.sy,
        s.sz + nz * offset,
        nx,
        nz,
        alpha,
        reduced ? 0 : s.age,
        segments,
        1,
        debtSpikeGrowth(s.age, reduced),
        s.tx,
        s.ty,
        s.tz,
        height,
        this.guardian?.coverage(s.sourceId, dt) ?? 0,
        debtSpikeRelease(s.age) * dim * 1.3,
      );
      // The shield owns the source response; only the struck enemy gets a burst.
      // A second star at the source anchor would protrude through the wearer.
      {
        const x = s.tx,
          y = s.ty,
          z = s.tz;
        const burst = debtSpikeRelease(s.age) * dim;
        this.shape = SHAPE.flare;
        this.info = 0;
        this.billboard(x, y, z, reduced ? 0.8 : 1.05, HOT, burst * 1.4);
        this.shape = SHAPE.line;
        for (let ray = 0; ray < 9; ray++) {
          const a = ray * 2.399963;
          const length = 1.05 * (reduced ? 0.65 : 1 + s.age * 0.8);
          const rx = Math.cos(a) * length,
            rz = Math.sin(a) * length,
            ry = Math.sin(ray * 4.1) * length;
          this.strip(x, y, z, x + rx, y + ry, z + rz, 0.13, GOLD, burst * 0.8, 0);
          this.strip(x, y, z, x + rx * 0.78, y + ry * 0.78, z + rz * 0.78, 0.045, HOT, burst, 0);
        }
      }
    }
    const geometry = this.mesh.geometry;
    for (const name of ATTRIBUTES) {
      const a = geometry.getAttribute(name) as THREE.BufferAttribute;
      a.clearUpdateRanges();
      if (this.vertex) {
        a.addUpdateRange(0, this.vertex * a.itemSize);
        a.needsUpdate = true;
      }
    }
    if (this.preparation.ready('debt_of_light')) geometry.setDrawRange(0, this.vertex);
    this.mesh.visible = this.vertex > 0;
  }
  clear(): void {
    for (const s of this.guards) {
      s.id = -1;
      s.seen = false;
    }
    for (const s of this.answers) s.active = false;
    this.mesh.visible = false;
    if (this.preparation.ready('debt_of_light')) this.mesh.geometry.setDrawRange(0, 0);
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

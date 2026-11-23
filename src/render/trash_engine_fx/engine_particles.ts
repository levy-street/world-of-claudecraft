// The trash engine's pooled particles and shock rings (lent to every engine
// layer through trash_engine_host.ts): soft smoke, steam and snow (normal
// blending), glowing motes and sparks (additive), and two flame pools through
// the pyre and the soulfire ramps (sanctum_fx_core.ts, shared so a branded
// player burns like the Goadsmith's iron and a spilled brazier like its
// bowl). Shock rings race out over the floor for impacts and pops.
//
// Cosmetic only (src/render/CLAUDE.md): every pool and ring is built once
// under the owner's root before its gated attach; emitting writes one slot,
// no per-frame allocation; the low tier thins the counts (`density`), never a
// telegraph. No light.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  PYRE_RAMP,
  rampGlsl,
  type SanctumPool,
  type SanctumPuffOptions,
  SOULFIRE_RAMP,
  shockRingLook,
} from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import {
  DUST_FRAG,
  FIRE_FRAG,
  FIRE_VERT,
  GHOST_RAMP,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from '../hollow_crypt/crypt_fx_particles';

const RING_SLOTS = 14;

const RING_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A shockwave over the floor: a hot leading edge, a broken frosty wake. */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSeed;
varying vec3 vLocal;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float r = length(vLocal.xz);
  float a = atan(vLocal.z, vLocal.x);
  float lead = smoothstep(0.78, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float broken = 0.6 + 0.4 * h(floor(a * 13.0) + uSeed);
  float wake = smoothstep(0.3, 0.95, r) * 0.22 * step(r, 1.0);
  gl_FragColor = vec4(uColor * (1.0 + lead * 1.3), (lead * broken + wake) * uAlpha);
}
`;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  radius: number;
  span: number;
  alive: boolean;
}

export class EngineParticles {
  private readonly pools: Record<SanctumPool, ParticlePool>;
  private readonly poolList: ParticlePool[];
  private readonly rings: Ring[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly spec: ParticleSpec = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
  private clock = 0;

  constructor(
    root: THREE.Group,
    uTime: { value: number },
    private readonly density: number,
    private readonly groundY: (x: number, z: number) => number,
    private readonly rand: () => number,
    private readonly reducedMotion: () => boolean,
    flameTex: THREE.Texture | null,
  ) {
    const pool = (
      name: string,
      vert: string,
      frag: string,
      blending: THREE.Blending,
      capacity: number,
      order: number,
    ): ParticlePool => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime, uTex: { value: flameTex } },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      const p = new ParticlePool(
        Math.round(capacity * density) + 64,
        m,
        floorVfxRenderOrder('encounter', order),
      );
      this.geometries.push(p.mesh.geometry);
      root.add(p.mesh);
      return p;
    };
    this.pools = {
      smoke: pool('trashEngineSmoke', PARTICLE_VERT, DUST_FRAG, THREE.NormalBlending, 1200, 6),
      glow: pool('trashEngineGlow', PARTICLE_VERT, GLOW_FRAG, THREE.AdditiveBlending, 1200, 8),
      soulfire: pool(
        'trashEngineSoulfire',
        FIRE_VERT,
        FIRE_FRAG.replace(GHOST_RAMP, rampGlsl(SOULFIRE_RAMP, 'ghostRamp')),
        THREE.AdditiveBlending,
        700,
        7,
      ),
      pyre: pool(
        'trashEnginePyre',
        FIRE_VERT,
        FIRE_FRAG.replace(GHOST_RAMP, rampGlsl(PYRE_RAMP, 'ghostRamp')),
        THREE.AdditiveBlending,
        600,
        7,
      ),
    };
    this.poolList = [this.pools.smoke, this.pools.glow, this.pools.soulfire, this.pools.pyre];
    const ringGeo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    for (let i = 0; i < RING_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'trashEngineRing',
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0 },
          uSeed: { value: i * 7.3 },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 4);
      root.add(mesh);
      this.rings.push({ mesh, mat, born: 0, radius: 0, span: 1, alive: false });
    }
  }

  /** Emit `n` particles round (x, y, z) (thinned by the tier and reduced motion). */
  puff(x: number, y: number, z: number, n: number, o: SanctumPuffOptions): void {
    if (this.reducedMotion() && n > 4) n = Math.ceil(n / 3);
    const pool = this.pools[o.pool ?? 'smoke'];
    const count = n <= 1 ? n : Math.max(1, Math.round(n * this.density));
    const s = this.spec;
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.5) * 2;
      let vx = Math.cos(a) * Math.sqrt(1 - e * e);
      let vy = e;
      let vz = Math.sin(a) * Math.sqrt(1 - e * e);
      if (o.dir) {
        const k = o.spread ?? 0.35;
        vx = o.dir[0] + vx * k;
        vy = o.dir[1] + vy * k;
        vz = o.dir[2] + vz * k;
      }
      const sp = o.speed * (0.55 + this.rand() * 0.9);
      const r = o.radius ? Math.sqrt(this.rand()) * o.radius : 0;
      const ra = this.rand() * Math.PI * 2;
      s.x = x + Math.cos(ra) * r;
      s.y = y;
      s.z = z + Math.sin(ra) * r;
      s.vx = vx * sp;
      s.vy = vy * sp + (o.up ?? 0);
      s.vz = vz * sp;
      s.ax = 0;
      s.ay = -(o.gravity ?? 0);
      s.az = 0;
      s.life = o.life * (0.7 + this.rand() * 0.6);
      s.drag = o.drag ?? 1.2;
      s.floor = y - 0.6;
      s.size0 = o.size[0];
      s.size1 = o.size[1];
      s.spin = (this.rand() - 0.5) * 2;
      s.seed = this.rand();
      s.r = o.color[0];
      s.g = o.color[1];
      s.b = o.color[2];
      s.a = o.alpha;
      pool.emit(this.clock, s);
    }
  }

  /** A shock ring racing out to `radius` over `seconds`. */
  shockRing(x: number, z: number, color: number, radius: number, seconds: number): void {
    const slot = this.rings.find((r) => !r.alive) ?? this.rings[0];
    slot.alive = true;
    slot.born = this.clock;
    slot.radius = radius;
    slot.span = seconds;
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    slot.mesh.position.set(x, this.groundY(x, z) + 0.14, z);
    slot.mesh.visible = true;
  }

  update(clock: number): void {
    this.clock = clock;
    for (const r of this.rings) {
      if (!r.alive) continue;
      const elapsed = clock - r.born;
      if (elapsed > r.span) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      const look = shockRingLook(elapsed, r.radius, r.span);
      r.mesh.scale.setScalar(Math.max(0.01, look.radius));
      r.mat.uniforms.uAlpha.value = look.alpha;
    }
    for (const p of this.poolList) p.update(clock);
  }

  hideRings(): void {
    for (const r of this.rings) {
      r.alive = false;
      r.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

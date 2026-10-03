// Ysolei's effects on the Moon Altar (the Codex-built serpent,
// public/models/creatures/temple_ysolei.glb), composed by temple_fx.ts:
//  - Lunar Tide: moonlight gathers in her open jaws (her Mouth_VFX bone) over
//    the 1.5 s bar, then a ring wave of freezing lagoon water bursts out to its
//    13 yd edge, a foaming wall with ice shards flung off its crest;
//  - the Undertow: while she channels, a spiral of currents runs INWARD across
//    the island floor and spray streams in low over the stones and up into
//    her mouth (suction, read from direction), then the Tidal Crash: a dome of
//    moonwater bursts up round her to its 12 yd edge and throws spray;
//  - the Rising Tide: a sheet of silver-teal water rises over the flooded half
//    of the island, foaming along the causeway line; the half about to flood
//    shimmers with ripples first.
// The floor telegraphs (the rings and the flood half-disc) are temple_fx.ts's
// and draw on every tier; this is the cosmetic layer, sheds density on low.
//
// Rules (src/render/CLAUDE.md): every mesh and material is built once here,
// under the gated temple root, and collapsed (never hidden) while idle so its
// program links with the temple. State is read off IWorld (cast bars,
// spellfx events, the tide objects), so offline and online look the same.

import * as THREE from 'three';
import { MOON_ALTAR } from '../../sim/content/drowned_temple_layout';
import {
  tideStateOf,
  YSOLEI_ID,
  YSOLEI_LUNAR_TIDE,
  YSOLEI_TIDAL_CRASH,
  YSOLEI_TUNING,
  YSOLEI_UNDERTOW,
} from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
} from '../hollow_crypt/crypt_fx_particles';

const COLLAPSED = 1e-4;
const SCAN_SEC = 0.5;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

const SHEET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A standing wall of water on a ring (a cylinder's side): foam at the crest.
const WALL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  float n = vnoise(vec2(vUv.x * 60.0, vUv.y * 3.0 - uTime * 3.0));
  vec3 body = mix(vec3(0.12, 0.38, 0.5), vec3(0.62, 0.86, 0.98), vUv.y);
  float crest = smoothstep(0.6, 0.95, vUv.y + (n - 0.5) * 0.3);
  vec3 col = mix(body, vec3(0.95, 0.98, 1.0), crest);
  float a = uAlpha * (0.35 + 0.55 * vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y) * 0.6);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// The Undertow's floor: currents spiralling INWARD (the arrows run to the centre).
const SPIRAL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec3 vLocal;
${NOISE}
void main() {
  vec2 p = vLocal.xy;
  float r = length(p);
  float a = atan(p.y, p.x);
  float rn = r / 26.0;
  // Log-spiral currents scrolling inward (a crest's radius shrinks as time
  // runs), broken by noise into streaks of foam over darker water.
  float band = sin(a * 5.0 + log(max(r, 0.5)) * 9.0 + uTime * 7.0);
  float n = vnoise(p * 0.5 + vec2(uTime * 0.7, -uTime * 0.5));
  float streak = smoothstep(0.78, 1.0, band) * (0.45 + 0.55 * n);
  float edge = smoothstep(1.0, 0.72, rn) * smoothstep(0.04, 0.16, rn);
  vec3 col = mix(vec3(0.18, 0.5, 0.66), vec3(0.8, 0.94, 1.0), streak);
  gl_FragColor = vec4(col, uAlpha * edge * (0.08 + 0.42 * streak));
  #include <colorspace_fragment>
}
`;

// The Tidal Crash: a dome of moonwater.
const DOME_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  float n = vnoise(vec2(vUv.x * 24.0, vUv.y * 8.0 - uTime * 4.0));
  vec3 col = mix(vec3(0.3, 0.7, 0.85), vec3(0.95, 0.98, 1.0), smoothstep(0.45, 0.9, n));
  float rim = smoothstep(0.0, 0.25, vUv.y);
  gl_FragColor = vec4(col, uAlpha * (0.3 + 0.5 * n) * rim);
  #include <colorspace_fragment>
}
`;

// The Rising Tide's water over one half of the island.
const FLOOD_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uShimmer;
varying vec3 vLocal;
${NOISE}
void main() {
  vec2 p = vLocal.xy;
  float n = vnoise(p * 0.35 + vec2(uTime * 0.4, -uTime * 0.3)) * 0.6 + vnoise(p * 1.1 - uTime * 0.7) * 0.4;
  vec3 col = mix(vec3(0.1, 0.36, 0.44), vec3(0.72, 0.9, 0.98), smoothstep(0.55, 0.85, n));
  // Foam along the causeway line (the half-disc's straight edge, y = 0).
  float foam = smoothstep(1.6, 0.0, abs(p.y)) * (0.6 + 0.4 * n);
  col = mix(col, vec3(0.96, 0.99, 1.0), foam * 0.8);
  float ripple = 0.5 + 0.5 * sin(length(p) * 1.8 - uTime * 3.0);
  float a = mix(uAlpha * (0.55 + 0.25 * n + foam * 0.2), uShimmer * ripple * 0.35, step(uAlpha, 0.001));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

interface Burst {
  mesh: THREE.Mesh;
  uniforms: { uTime: { value: number }; uAlpha: { value: number } };
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
}

export class TempleYsoleiFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: ParticlePool;
  private readonly spray: ParticlePool;
  private readonly ring: Burst;
  private readonly dome: Burst;
  private readonly spiral: THREE.Mesh;
  private readonly spiralUniforms = { uTime: this.uTime, uAlpha: { value: 0 } };
  private readonly floods: {
    mesh: THREE.Mesh;
    uniforms: {
      uTime: { value: number };
      uAlpha: { value: number };
      uShimmer: { value: number };
    };
    objectId: number;
    level: number;
  }[] = [];
  private bossId: number | null = null;
  private mouth: THREE.Object3D | null = null;
  private scan = 0;
  private seed = 7;
  private debt = 0;
  private readonly mouthPos = new THREE.Vector3();
  private readonly density: number;

  constructor(
    parent: THREE.Group,
    private readonly scene: THREE.Scene,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
  ) {
    this.root.name = 'drowned-temple-ysolei-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.4;
    const particleMat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.glow = new ParticlePool(
      Math.round(1400 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      13,
    );
    this.spray = new ParticlePool(
      Math.round(900 * this.density),
      particleMat(DUST_FRAG, THREE.NormalBlending),
      12,
    );
    this.root.add(this.glow.mesh, this.spray.mesh);
    this.geometries.push(this.glow.mesh.geometry, this.spray.mesh.geometry);

    const sheet = (frag: string, extra: Record<string, THREE.IUniform> = {}) => {
      const uniforms = { uTime: this.uTime, uAlpha: { value: 0 }, ...extra };
      const m = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: SHEET_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      return { m, uniforms };
    };
    // The Lunar Tide's ring wall: a unit open cylinder, scaled to its radius.
    const wall = sheet(WALL_FRAG);
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0);
    this.geometries.push(wallGeo);
    this.ring = this.burst(wallGeo, wall.m, wall.uniforms, 1.1);
    // The Tidal Crash's dome: a unit hemisphere.
    const dome = sheet(DOME_FRAG);
    const domeGeo = new THREE.SphereGeometry(1, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    this.geometries.push(domeGeo);
    this.dome = this.burst(domeGeo, dome.m, dome.uniforms, 1.2);
    // The Undertow's spiral over the island.
    const spiral = new THREE.ShaderMaterial({
      uniforms: this.spiralUniforms,
      vertexShader: SHEET_VERT,
      fragmentShader: SPIRAL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(spiral);
    // A disc in its local XY (the plane the shader reads), laid flat below.
    const spiralGeo = new THREE.CircleGeometry(26, 72);
    this.geometries.push(spiralGeo);
    this.spiral = new THREE.Mesh(spiralGeo, spiral);
    this.spiral.rotation.x = -Math.PI / 2;
    this.spiral.renderOrder = floorVfxRenderOrder('ground', 6);
    this.spiral.frustumCulled = false;
    this.spiral.scale.setScalar(COLLAPSED);
    this.root.add(this.spiral);
    // The two flood sheets (a half-disc each; its straight edge on the line).
    for (let i = 0; i < 2; i++) {
      const f = sheet(FLOOD_FRAG, { uShimmer: { value: 0 } });
      const geo = new THREE.CircleGeometry(MOON_ALTAR.r - 0.4, 64, 0, Math.PI);
      this.geometries.push(geo);
      const mesh = new THREE.Mesh(geo, f.m);
      mesh.renderOrder = floorVfxRenderOrder('ground', 5);
      mesh.frustumCulled = false;
      mesh.scale.setScalar(COLLAPSED);
      this.root.add(mesh);
      this.floods.push({
        mesh,
        uniforms: f.uniforms as (typeof this.floods)[number]['uniforms'],
        objectId: -1,
        level: 0,
      });
    }
  }

  private burst(
    geo: THREE.BufferGeometry,
    m: THREE.ShaderMaterial,
    uniforms: Burst['uniforms'],
    life: number,
  ): Burst {
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = floorVfxRenderOrder('ground', 7);
    mesh.scale.setScalar(COLLAPSED);
    this.root.add(mesh);
    return { mesh, uniforms, age: -1, life, x: 0, y: 0, z: 0 };
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private boss(): EntityView | null {
    const world = this.world;
    if (!world || this.bossId === null) return null;
    return world.entities.get(this.bossId) ?? null;
  }

  private rescan(): void {
    const world = this.world;
    if (!world) return;
    const me = world.entities.get(world.playerId);
    let best: EntityView | null = null;
    let bestD = Infinity;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== YSOLEI_ID) continue;
      const d = me ? Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) : 0;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if ((best?.id ?? null) !== this.bossId) this.mouth = null;
    this.bossId = best?.id ?? null;
    if (this.bossId !== null && !this.mouth) {
      // Her live rig's mouth socket (absent on the far bake: an anchor stands in).
      const id = this.bossId;
      for (const child of this.scene.children) {
        if (child.userData.entityId !== id) continue;
        this.mouth = child.getObjectByName('Mouth_VFX') ?? null;
        break;
      }
    }
    // The flood sheets follow the island's tide objects.
    for (const f of this.floods) f.objectId = -1;
    let k = 0;
    for (const e of world.entities.values()) {
      if (k >= this.floods.length || tideStateOf(e.templateId) === null) continue;
      if (Math.hypot(e.pos.x - (best?.pos.x ?? e.pos.x), e.pos.z - (best?.pos.z ?? e.pos.z)) > 80)
        continue;
      this.floods[k++].objectId = e.id;
    }
  }

  /** Where her jaws are: the live bone when the rig is up, else an anchor
   *  (her bind pose's mouth: 17.85 up and 5.3 ahead, at native scale). */
  private mouthAt(b: EntityView): THREE.Vector3 {
    if (this.mouth?.parent) {
      this.mouth.getWorldPosition(this.mouthPos);
      if (Number.isFinite(this.mouthPos.y)) return this.mouthPos;
    }
    return this.mouthPos.set(
      b.pos.x + Math.sin(b.facing) * 5.3,
      b.pos.y + 17.85,
      b.pos.z + Math.cos(b.facing) * 5.3,
    );
  }

  handleEvent(ev: SimEvent): void {
    if (ev.type !== 'spellfx' || ev.sourceId !== this.bossId) return;
    const b = this.boss();
    if (!b || ev.fx !== 'nova') return;
    if (ev.ability === YSOLEI_LUNAR_TIDE) this.fire(this.ring, b);
    else if (ev.ability === YSOLEI_TIDAL_CRASH) {
      this.fire(this.dome, b);
      this.crashSpray(b);
    }
  }

  private fire(burst: Burst, b: EntityView): void {
    burst.age = 0;
    burst.x = b.pos.x;
    burst.y = this.groundY(b.pos.x, b.pos.z);
    burst.z = b.pos.z;
    if (burst === this.ring) this.ringShards(b);
  }

  private ringShards(b: EntityView): void {
    const n = Math.round(140 * this.density);
    const y = this.groundY(b.pos.x, b.pos.z);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand() * 0.1;
      const s = YSOLEI_TUNING.lunarRadius / 0.8;
      this.glow.emit(this.uTime.value, {
        x: b.pos.x + Math.cos(a) * 2,
        y: y + 0.5 + this.rand() * 1.5,
        z: b.pos.z + Math.sin(a) * 2,
        vx: Math.cos(a) * s,
        vy: 2 + this.rand() * 4,
        vz: Math.sin(a) * s,
        ay: -9,
        drag: 0.9,
        life: 0.9 + this.rand() * 0.4,
        size0: 0.7,
        size1: 0.2,
        spin: 4,
        r: 0.75,
        g: 0.92,
        b: 1,
        a: 1,
      });
    }
  }

  private crashSpray(b: EntityView): void {
    const n = Math.round(220 * this.density);
    const y = this.groundY(b.pos.x, b.pos.z);
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const s = 6 + this.rand() * 10;
      this.spray.emit(this.uTime.value, {
        x: b.pos.x + Math.cos(a) * 3,
        y: y + 1 + this.rand() * 3,
        z: b.pos.z + Math.sin(a) * 3,
        vx: Math.cos(a) * s,
        vy: 6 + this.rand() * 10,
        vz: Math.sin(a) * s,
        ay: -14,
        drag: 0.6,
        life: 1.2 + this.rand() * 0.8,
        size0: 2,
        size1: 4.5,
        r: 0.86,
        g: 0.94,
        b: 1,
        a: 0.6,
      });
    }
  }

  update(dt: number, clock: number): void {
    this.uTime.value = clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.rescan();
    }
    const b = this.boss();
    if (b && !b.dead) {
      if (b.castingAbility === YSOLEI_LUNAR_TIDE) this.gather(b, dt, 0.8);
      const pulling = b.castingAbility === YSOLEI_UNDERTOW;
      if (pulling) this.suck(b, dt);
      const target = pulling ? 1 : 0;
      const alpha = this.spiralUniforms.uAlpha;
      alpha.value += (target - alpha.value) * Math.min(1, dt * 4);
      const live = alpha.value > 0.01;
      this.spiral.scale.setScalar(live ? 1 : COLLAPSED);
      if (live) this.spiral.position.set(b.pos.x, this.groundY(b.pos.x, b.pos.z) + 0.12, b.pos.z);
    } else {
      this.spiralUniforms.uAlpha.value = 0;
      this.spiral.scale.setScalar(COLLAPSED);
    }
    this.stepBurst(this.ring, dt, (k) => ({
      r: 1 + k * (YSOLEI_TUNING.lunarRadius - 1),
      h: 3.2 * Math.sin(Math.PI * Math.min(1, k * 1.1)),
      a: 1 - k * k,
    }));
    this.stepBurst(this.dome, dt, (k) => ({
      r: 2 + Math.min(1, k * 2.2) * (YSOLEI_TUNING.crashRadius - 2),
      h: YSOLEI_TUNING.crashRadius * 0.55 * Math.sin(Math.PI * Math.min(1, k * 1.2)),
      a: (1 - k) * 0.9,
    }));
    this.updateFloods(dt);
    this.glow.update(clock);
    this.spray.update(clock);
  }

  private stepBurst(
    burst: Burst,
    dt: number,
    shape: (k: number) => { r: number; h: number; a: number },
  ): void {
    if (burst.age < 0) return;
    burst.age += dt;
    const k = Math.min(1, burst.age / burst.life);
    const s = shape(k);
    burst.mesh.position.set(burst.x, burst.y, burst.z);
    burst.mesh.scale.set(s.r, Math.max(COLLAPSED, s.h), s.r);
    burst.uniforms.uAlpha.value = s.a;
    if (k >= 1) {
      burst.age = -1;
      burst.mesh.scale.setScalar(COLLAPSED);
    }
  }

  /** Moonlight drawn into her jaws while a Lunar Tide charges. */
  private gather(b: EntityView, dt: number, rate: number): void {
    const at = this.mouthAt(b);
    this.debt += 60 * rate * this.density * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = this.rand() * Math.PI * 2;
      const e = this.rand() * 1.2 - 0.3;
      const r = 5 + this.rand() * 4;
      const x = at.x + Math.cos(a) * Math.cos(e) * r;
      const y = at.y + Math.sin(e) * r;
      const z = at.z + Math.sin(a) * Math.cos(e) * r;
      const t = 0.55;
      this.glow.emit(this.uTime.value, {
        x,
        y,
        z,
        vx: (at.x - x) / t,
        vy: (at.y - y) / t,
        vz: (at.z - z) / t,
        life: t,
        size0: 0.5,
        size1: 1.1,
        r: 0.85,
        g: 0.92,
        b: 1,
        a: 0.9,
      });
    }
  }

  /** The Undertow's suction: spray streams in low over the stones toward her,
   *  and a funnel of moonlit water rises into her mouth. */
  private suck(b: EntityView, dt: number): void {
    const at = this.mouthAt(b);
    const floor = this.groundY(b.pos.x, b.pos.z);
    this.debt += 90 * this.density * dt;
    while (this.debt >= 1) {
      this.debt -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = 8 + this.rand() * 16;
      const x = b.pos.x + Math.cos(a) * r;
      const z = b.pos.z + Math.sin(a) * r;
      const t = 0.9 + this.rand() * 0.4;
      // Tangential swirl on the inward run: the spiral reads as suction.
      const swirl = 5;
      this.spray.emit(this.uTime.value, {
        x,
        y: floor + 0.3,
        z,
        vx: (b.pos.x - x) / t - Math.sin(a) * swirl,
        vy: 0.4,
        vz: (b.pos.z - z) / t + Math.cos(a) * swirl,
        life: t,
        size0: 1.4,
        size1: 0.5,
        r: 0.72,
        g: 0.88,
        b: 0.96,
        a: 0.5,
      });
      if (this.rand() < 0.45) {
        const fy = floor + 1 + this.rand() * 4;
        const tt = 0.7;
        this.glow.emit(this.uTime.value, {
          x: b.pos.x + Math.cos(a) * 4,
          y: fy,
          z: b.pos.z + Math.sin(a) * 4,
          vx: (at.x - (b.pos.x + Math.cos(a) * 4)) / tt,
          vy: (at.y - fy) / tt,
          vz: (at.z - (b.pos.z + Math.sin(a) * 4)) / tt,
          life: tt,
          size0: 0.8,
          size1: 0.35,
          r: 0.6,
          g: 0.85,
          b: 1,
          a: 0.85,
        });
      }
    }
  }

  private updateFloods(dt: number): void {
    const world = this.world;
    for (const f of this.floods) {
      const obj = f.objectId >= 0 ? world?.entities.get(f.objectId) : undefined;
      const state = obj ? tideStateOf(obj.templateId) : null;
      const flooded = state === 'flood';
      const warned = state === 'warn';
      f.level += ((flooded ? 1 : 0) - f.level) * Math.min(1, dt * 1.5);
      f.uniforms.uAlpha.value = f.level > 0.02 ? f.level : 0;
      f.uniforms.uShimmer.value = warned ? 1 : 0;
      const live = obj && (f.level > 0.02 || warned);
      if (!live || !obj) {
        f.mesh.scale.setScalar(COLLAPSED);
        continue;
      }
      // The straight edge on the causeway line; the half opens toward its side.
      const north = obj.facing < Math.PI / 2;
      const cz = obj.pos.z + (north ? -MOON_ALTAR.r * 0.5 : MOON_ALTAR.r * 0.5);
      const y = this.groundY(obj.pos.x, cz) - 0.3 + f.level * 0.7;
      f.mesh.scale.setScalar(1);
      f.mesh.position.set(obj.pos.x, y, cz);
      // Circle half (theta 0..PI) lies in local +y; lay it flat and turn it
      // to open north (+z) or south.
      f.mesh.rotation.set(north ? Math.PI / 2 : -Math.PI / 2, 0, 0);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.glow.dispose();
    this.spray.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// The Sanctum trash mechanics pass's creature effects (plan: sanctum_fx_core.ts;
// the floor telegraphs are sanctum_fx.ts's spec table: the Counterweight
// Lash's cone behind the Scaleguard, the Rime Breath's cone, the kick glyphs
// under Thaw the Held and the Branding Iron), composed by SanctumFx under its
// gated root:
//  - Thaw the Held: a twisting soul-green and violet tether from the
//    Thawcaller's censer down into the fallen Boneguard's corpse while the
//    bar runs, the ice over the corpse cracking open in soulfire and steaming;
//    on landing (corpse -> the risen Bonewalker) a column of soulfire erupts
//    where the soldier climbs out, flinging ice;
//  - the Counterweight Lash: the spiked tail sweeps the cone behind the
//    Scaleguard, a swoosh across the arc and a spray of snow and ice;
//  - the Branding Iron: a stream of red-hot sparks from the iron to its victim
//    over the bar; on landing a sear on the chest (the brand itself is the
//    trash engine's, ../trash_engine_fx);
//  - the Rime Breath: a quick puff of frost down the whelp's front;
//  - Fracture: the Glacier Splinter cracks and splits, ice and rune-iron flung
//    both ways between the two halves;
//  - Topple Brazier: the kicked Soul Brazier tips over away from its kicker
//    (its standing body hidden, a fallen brazier drawn in its place) and its
//    soulfire gouts out onto the ice where the spill lands.
//
// Cosmetic only: the telegraphs a player dodges are sanctum_fx.ts's. Built
// once under the host's root before its gated attach; no light; no per-frame
// allocation.

import * as THREE from 'three';
import {
  BONEWALKER_ID,
  SOUL_BRAZIER_ID,
  VELKHAR_ID,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import {
  SANCTUM_BRANDING_IRON,
  SANCTUM_COUNTERWEIGHT_LASH,
  SANCTUM_FRACTURE,
  SANCTUM_RIME_BREATH,
  SANCTUM_THAW_THE_HELD,
  SANCTUM_TOPPLE_BRAZIER,
} from '../../sim/mob/trash_kit/sanctum_cast_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { BRAZIER_TOPPLED_GESTURE } from '../characters/sanctum_creature_looks';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { surfaceMat } from '../gfx';
import {
  anchorPoint,
  BONEWALKER_RISE_GESTURE,
  BONEWALKER_RISE_WINDOW,
  bonewalkerRisesOnSight,
  brandIronAnchor,
  breathReachShare,
  ERUPTION_SECONDS,
  eruption,
  FLAME_HEAT,
  LASH_SWEEP_SECONDS,
  lashSweep,
  rgb,
  SANCTUM_PALETTE,
  SPLINTER_COPY_GESTURE,
  SPLINTER_COPY_WINDOW,
  SPLINTER_FRACTURE_GESTURE,
  sanctumAnchor,
  sanctumDrawnHeight,
  sanctumTelegraphSpecs,
  toppleTilt,
} from './sanctum_fx_core';
import type { SanctumFxHost } from './sanctum_fx_host';

const TETHER_SLOTS = 4;
const COLUMN_SLOTS = 2;
const SWEEP_SLOTS = 3;
const TOPPLE_SLOTS = 3;
/** Seconds a fallen brazier lies on the ice (its spill's life), then sinks. */
const TOPPLE_LIE_SECONDS = 8;

const TETHER_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** Thaw the Held: two strands of soul-stuff twisting round each other down
 *  the tether, green and violet, flowing into the corpse. */
const THAW_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLen;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
void main() {
  float y = vUv.y * uLen;
  float a1 = fract(vUv.x + y * 0.35 - uTime * 0.9);
  float a2 = fract(vUv.x + 0.5 + y * 0.35 - uTime * 0.9);
  float s1 = 1.0 - smoothstep(0.0, 0.14, abs(a1 - 0.5) - 0.32);
  float s2 = 1.0 - smoothstep(0.0, 0.14, abs(a2 - 0.5) - 0.32);
  float flow = 0.6 + 0.4 * sin(y * 3.0 - uTime * 7.0);
  vec3 col = uColA * s1 * 1.5 + uColB * s2 * 1.5;
  float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
  gl_FragColor = vec4(col * flow * (0.5 + 0.5 * edge), 1.0);
}
`;
/** The Branding Iron: a crackling stream of red-hot sparks racing out. */
const SPARK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLen;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float y = vUv.y * uLen;
  float cell = floor(y * 3.0 - uTime * 18.0);
  float f = fract(y * 3.0 - uTime * 18.0);
  float spark = step(0.45, h(cell + floor(vUv.x * 4.0) * 7.0)) * (1.0 - smoothstep(0.0, 0.35, abs(f - 0.5)));
  float core = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5) * 2.0);
  vec3 col = mix(uColA, uColB, spark) * (0.35 * core + spark * 1.6);
  gl_FragColor = vec4(col, 1.0);
}
`;

const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float n = vnoise(vec2(vUv.x * 8.0, vUv.y * 3.0 - uTime * 4.0));
  float m = vnoise(vec2(vUv.x * 15.0 + 3.0, vUv.y * 6.0 - uTime * 7.0));
  float up = 1.0 - smoothstep(0.35, 1.0, vUv.y);
  vec3 green = vec3(0.56, 0.84, 0.63);
  vec3 violet = vec3(0.48, 0.35, 0.72);
  vec3 col = mix(violet, green, n) * 1.6 + vec3(0.8, 1.0, 0.9) * pow(max(m, 0.0), 4.0);
  float a = (0.35 + 0.65 * n) * up * uAlpha;
  gl_FragColor = vec4(col * a, 1.0);
}
`;

const SWEEP_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The tail's swoosh over its cone: a bright edge sweeping across the arc,
 *  a frosted wake behind it. */
const SWEEP_FRAG = /* glsl */ `
uniform float uEdge;
uniform float uAlpha;
uniform float uHalf;
uniform float uDir;
varying vec2 vP;
void main() {
  float r = length(vP);
  float ang = atan(vP.x, vP.y);
  float s = clamp((ang * uDir + uHalf) / (2.0 * uHalf), 0.0, 1.0);
  if (s > uEdge) discard;
  float lead = exp(-pow(max((uEdge - s) * 9.0, 0.0), 2.0));
  float wake = (1.0 - (uEdge - s)) * 0.35;
  float radial = smoothstep(0.15, 0.4, r) * (1.0 - smoothstep(0.85, 1.0, r));
  vec3 col = mix(vec3(0.62, 0.86, 1.0), vec3(1.0), lead);
  gl_FragColor = vec4(col * (lead * 1.4 + wake) * radial * uAlpha, 1.0);
}
`;

const CRACK_FRAG = /* glsl */ `
uniform float uFill;
uniform float uTime;
varying vec2 vP;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float r = length(vP);
  if (r > 1.0) discard;
  float ang = atan(vP.x, vP.y);
  // Jagged cracks running out from the corpse as the rite goes on.
  float k = ang * 7.0 / 6.2831853 + 0.5;
  float id = floor(k * 1.0 * 7.0);
  float wob = sin(r * 13.0 + h(id) * 20.0) * 0.06;
  float line = 1.0 - smoothstep(0.0, 0.05, abs(fract(k * 7.0 + wob) - 0.5) * (0.4 + r));
  float reach = uFill * (0.5 + 0.5 * h(id + 3.0));
  float lit = line * step(r, reach) * (1.0 - r * 0.5);
  float pulse = 0.75 + 0.25 * sin(uTime * 9.0 + r * 8.0);
  vec3 col = mix(vec3(0.48, 0.35, 0.72), vec3(0.65, 1.0, 0.8), 1.0 - r);
  gl_FragColor = vec4(col * lit * pulse * 1.6 + vec3(0.6, 1.0, 0.8) * (1.0 - smoothstep(0.0, 0.3, r)) * uFill * 0.3, 1.0);
}
`;

interface Tether {
  casterId: number;
  castId: string;
  thaw: THREE.Mesh;
  thawMat: THREE.ShaderMaterial;
  spark: THREE.Mesh;
  sparkMat: THREE.ShaderMaterial;
  crack: THREE.Mesh;
  crackMat: THREE.ShaderMaterial;
}
interface Column {
  alive: boolean;
  born: number;
  x: number;
  y: number;
  z: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}
interface Sweep {
  alive: boolean;
  born: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  range: number;
  half: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}
interface Topple {
  bodyId: number;
  born: number;
  /** Pivot (the base's edge on the fall side) and the fall heading. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  height: number;
  landed: boolean;
  pivot: THREE.Group;
  tip: THREE.Group;
  embers: THREE.MeshBasicMaterial;
}

/** A brazier: a soulfire bowl on a three-legged iron stand, 1 yd tall
 *  (scaled to its drawn height), its foot at the origin. */
function brazierGeometry(): { iron: THREE.BufferGeometry; coals: THREE.BufferGeometry } {
  const bowl = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.02, 0.62),
      new THREE.Vector2(0.18, 0.64),
      new THREE.Vector2(0.3, 0.7),
      new THREE.Vector2(0.36, 0.8),
      new THREE.Vector2(0.38, 0.9),
      new THREE.Vector2(0.34, 0.9),
      new THREE.Vector2(0.3, 0.82),
      new THREE.Vector2(0.02, 0.76),
    ],
    14,
  );
  const parts: THREE.BufferGeometry[] = [bowl.toNonIndexed()];
  bowl.dispose();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.CylinderGeometry(0.03, 0.045, 0.7, 6)
      .rotateZ(0.22)
      .rotateY(-a)
      .translate(Math.cos(a) * 0.2, 0.35, Math.sin(a) * 0.2);
    parts.push(leg.toNonIndexed());
    leg.dispose();
  }
  const ring = new THREE.TorusGeometry(0.2, 0.025, 5, 16)
    .rotateX(Math.PI / 2)
    .translate(0, 0.32, 0);
  parts.push(ring.toNonIndexed());
  ring.dispose();
  // One geometry: append the attribute arrays (all non-indexed, same layout).
  let count = 0;
  for (const p of parts) count += p.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    const a = p.getAttribute('position') as THREE.BufferAttribute;
    pos.set(a.array as Float32Array, o);
    o += a.count * 3;
    p.dispose();
  }
  const iron = new THREE.BufferGeometry();
  iron.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  iron.computeVertexNormals();
  const coals = new THREE.CircleGeometry(0.32, 14).rotateX(-Math.PI / 2).translate(0, 0.84, 0);
  return { iron, coals };
}

export class SanctumKitFx {
  private readonly tethers: Tether[] = [];
  private readonly columns: Column[] = [];
  private readonly sweeps: Sweep[] = [];
  private readonly topples: Topple[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly lashRange: number;
  private readonly lashHalf: number;
  private readonly rimeRange: number;
  private readonly rimeHalf: number;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly anchorTmp: [number, number, number] = [0, 0, 0];
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** The Raised Bonewalkers the scan has already seen (each judged once). */
  private readonly walkersSeen = new Set<number>();
  /** Entrances on offer: entity id to its gesture and until when (a view or a
   *  first-loaded GLB may land a frame or two after the cue; the rig plays an
   *  entrance once, so re-offering is safe). */
  private readonly entrances = new Map<number, { gesture: string; until: number }>();
  private clock = 0;

  constructor(
    private readonly host: SanctumFxHost,
    private readonly world: IWorld,
  ) {
    const specs = sanctumTelegraphSpecs();
    const lash = specs[SANCTUM_COUNTERWEIGHT_LASH];
    const rime = specs[SANCTUM_RIME_BREATH];
    this.lashRange = lash?.range ?? 7;
    this.lashHalf = ((lash?.arcDeg ?? 100) * Math.PI) / 360;
    this.rimeRange = rime?.range ?? 6;
    this.rimeHalf = ((rime?.arcDeg ?? 60) * Math.PI) / 360;
    // Tethers: an open cylinder along +y, oriented each frame.
    const beam = new THREE.CylinderGeometry(0.26, 0.26, 1, 12, 1, true).translate(0, 0.5, 0);
    const disc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.geometries.push(beam, disc);
    const shader = (name: string, frag: string, a: number, b: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uTime: host.uTime,
          uLen: { value: 1 },
          uColA: { value: new THREE.Color(a) },
          uColB: { value: new THREE.Color(b) },
        },
        vertexShader: TETHER_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      return m;
    };
    for (let i = 0; i < TETHER_SLOTS; i++) {
      const thawMat = shader(
        'sanctumThawTether',
        THAW_FRAG,
        SANCTUM_PALETTE.soulGreen,
        SANCTUM_PALETTE.soulViolet,
      );
      const thaw = new THREE.Mesh(beam, thawMat);
      thaw.frustumCulled = false;
      thaw.visible = false;
      host.root.add(thaw);
      const sparkMat = shader('sanctumBrandingSparks', SPARK_FRAG, 0xb3200e, 0xffd08a);
      const spark = new THREE.Mesh(beam, sparkMat);
      spark.frustumCulled = false;
      spark.visible = false;
      host.root.add(spark);
      const crackMat = new THREE.ShaderMaterial({
        name: 'sanctumThawCracks',
        uniforms: { uFill: { value: 0 }, uTime: host.uTime },
        vertexShader: SWEEP_VERT,
        fragmentShader: CRACK_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(crackMat);
      const crack = new THREE.Mesh(disc, crackMat);
      crack.visible = false;
      crack.renderOrder = floorVfxRenderOrder('encounter', 5);
      host.root.add(crack);
      this.tethers.push({
        casterId: -1,
        castId: '',
        thaw,
        thawMat,
        spark,
        sparkMat,
        crack,
        crackMat,
      });
    }
    // The eruption column: an open cylinder flaring wider at the top.
    const column = new THREE.CylinderGeometry(1.5, 0.9, 1, 20, 1, true).translate(0, 0.5, 0);
    this.geometries.push(column);
    for (let i = 0; i < COLUMN_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'sanctumThawEruption',
        uniforms: { uTime: host.uTime, uAlpha: { value: 0 } },
        vertexShader: TETHER_VERT,
        fragmentShader: COLUMN_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(column, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 25);
      host.root.add(mesh);
      this.columns.push({ alive: false, born: 0, x: 0, y: 0, z: 0, mesh, mat });
    }
    // The lash's swoosh: a unit disc the shader cuts to the cone's arc.
    for (let i = 0; i < SWEEP_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'sanctumLashSweep',
        uniforms: {
          uEdge: { value: 0 },
          uAlpha: { value: 0 },
          uHalf: { value: 1 },
          uDir: { value: 1 },
        },
        vertexShader: SWEEP_VERT,
        fragmentShader: SWEEP_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(disc, mat);
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 23);
      host.root.add(mesh);
      this.sweeps.push({
        alive: false,
        born: 0,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        range: 1,
        half: 1,
        mesh,
        mat,
      });
    }
    // The fallen brazier.
    const { iron, coals } = brazierGeometry();
    this.geometries.push(iron, coals);
    const ironMat = surfaceMat({
      color: 0x3a3540,
      roughness: 0.55,
      metalness: 0.55,
      flatShading: true,
    });
    for (let i = 0; i < TOPPLE_SLOTS; i++) {
      const embers = new THREE.MeshBasicMaterial({
        color: 0x8fd6a0,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        name: 'sanctumToppledCoals',
      });
      this.materials.push(embers);
      const pivot = new THREE.Group();
      pivot.name = 'sanctumToppledBrazier';
      pivot.visible = false;
      const tip = new THREE.Group();
      const body = new THREE.Mesh(iron, ironMat);
      body.castShadow = host.density >= 1;
      tip.add(body);
      const coal = new THREE.Mesh(coals, embers);
      coal.renderOrder = floorVfxRenderOrder('encounter', 24);
      tip.add(coal);
      pivot.add(tip);
      host.root.add(pivot);
      this.topples.push({
        bodyId: -1,
        born: 0,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        height: 2.4,
        landed: false,
        pivot,
        tip,
        embers,
      });
    }
  }

  // ------------------------------------------------------------------ events

  /** The pass's spellfx. True when drawn here (the renderer skips its own). */
  handleEvent(ev: SimEvent & { type: 'spellfx' }, src: Entity): boolean {
    // Only the landing beats are drawn here; any other phase (a windup the
    // sim may send at a bar's start) is left to the renderer.
    const landing = ev.ability === SANCTUM_BRANDING_IRON ? 'heavyBolt' : 'nova';
    if (ev.fx !== landing) return false;
    switch (ev.ability) {
      case SANCTUM_THAW_THE_HELD:
        this.erupt(src.pos.x, src.pos.z);
        // The risen soldier (the event's target) climbs out of the ice.
        if (ev.targetId !== undefined && ev.targetId !== null)
          this.offerEntrance(ev.targetId, BONEWALKER_RISE_GESTURE, BONEWALKER_RISE_WINDOW);
        return true;
      case SANCTUM_COUNTERWEIGHT_LASH:
        this.lash(src);
        return true;
      case SANCTUM_BRANDING_IRON: {
        const victim = this.world.entities.get(ev.targetId);
        if (victim) this.sear(victim);
        return true;
      }
      case SANCTUM_RIME_BREATH:
        this.rimeBreath(src);
        return true;
      case SANCTUM_FRACTURE: {
        const copy = this.world.entities.get(ev.targetId);
        this.fracture(src, copy ?? null);
        return true;
      }
      case SANCTUM_TOPPLE_BRAZIER: {
        const body = this.world.entities.get(ev.targetId);
        if (body) this.topple(body, src);
        // The engine draws the strike; this adds the fall.
        return true;
      }
      default:
        return false;
    }
  }

  private erupt(x: number, z: number): void {
    const h = this.host;
    const gy = h.groundY(x, z);
    const col = this.columns.find((c) => !c.alive) ?? this.columns[0];
    col.alive = true;
    col.born = this.clock;
    col.x = x;
    col.y = gy;
    col.z = z;
    col.mesh.position.set(x, gy, z);
    col.mesh.visible = true;
    h.shockRing(x, z, SANCTUM_PALETTE.soulGreen, 5, 0.5);
    h.shockRing(x, z, SANCTUM_PALETTE.rime, 3.2, 0.35);
    h.shards.burst(x, gy + 0.5, z, 40, {
      speed: 6,
      up: 9,
      size: [0.3, 1.1],
      radius: 1.2,
      iron: 0.1,
    });
    h.puff(x, gy + 0.2, z, 30, {
      speed: 1.4,
      up: 3,
      life: 1,
      size: [2.4, 0.8],
      color: FLAME_HEAT,
      alpha: 1,
      pool: 'soulfire',
      radius: 1.2,
    });
    h.puff(x, gy + 0.5, z, 36, {
      speed: 4,
      up: 2,
      life: 1.8,
      size: [1.2, 3.4],
      color: [0.9, 0.95, 1],
      alpha: 0.5,
      radius: 1,
      drag: 2.4,
    });
    h.puff(x, gy + 1, z, 30, {
      speed: 3,
      up: 5,
      life: 1.1,
      size: [0.3, 0.06],
      color: rgb(SANCTUM_PALETTE.soulGreen),
      alpha: 1,
      pool: 'glow',
      radius: 0.8,
    });
    if (!h.reducedMotion()) h.shake(0.25);
  }

  private lash(src: Entity): void {
    const h = this.host;
    const s = this.sweeps.find((w) => !w.alive) ?? this.sweeps[0];
    const yaw = src.facing + Math.PI;
    s.alive = true;
    s.born = this.clock;
    s.x = src.pos.x;
    s.z = src.pos.z;
    s.y = h.groundY(src.pos.x, src.pos.z);
    s.yaw = yaw;
    s.range = this.lashRange;
    s.half = this.lashHalf;
    s.mesh.position.set(s.x, s.y + 0.12, s.z);
    s.mesh.rotation.y = yaw;
    s.mesh.scale.set(s.range, 1, s.range);
    s.mat.uniforms.uHalf.value = s.half;
    s.mat.uniforms.uDir.value = h.rand() < 0.5 ? 1 : -1;
    s.mesh.visible = true;
    h.shards.burst(s.x, s.y + 0.6, s.z, 26, {
      speed: 8,
      up: 3,
      size: [0.25, 0.8],
      radius: 2.5,
      heading: yaw,
      spread: this.lashHalf,
      iron: 0,
    });
  }

  private sear(victim: Entity): void {
    const h = this.host;
    const gy = h.groundY(victim.pos.x, victim.pos.z);
    const y = gy + sanctumDrawnHeight(victim.templateId, victim.scale) * 0.62;
    h.puff(victim.pos.x, y, victim.pos.z, 4, {
      speed: 0.2,
      life: 0.3,
      size: [2.6, 0.8],
      color: [1, 0.55, 0.2],
      alpha: 1,
      pool: 'glow',
    });
    h.puff(victim.pos.x, y, victim.pos.z, 30, {
      speed: 4.5,
      up: 1.5,
      life: 0.7,
      size: [0.2, 0.04],
      color: [1, 0.6, 0.25],
      alpha: 1,
      pool: 'glow',
      gravity: 8,
    });
    h.puff(victim.pos.x, y, victim.pos.z, 12, {
      speed: 0.8,
      up: 1.6,
      life: 1.4,
      size: [0.5, 1.6],
      color: [0.32, 0.26, 0.24],
      alpha: 0.4,
    });
  }

  private rimeBreath(src: Entity): void {
    const h = this.host;
    const gy = h.groundY(src.pos.x, src.pos.z);
    const bh = sanctumDrawnHeight(src.templateId, src.scale);
    const m = this.tmpA;
    const mouth = sanctumAnchor('breath', src.templateId);
    anchorPoint(mouth, src.pos.x, src.pos.z, gy, src.facing, bh, m);
    const mx = m.x;
    const mz = m.z;
    const my = m.y;
    // The puff starts at the jaws but stops where the sim's cone does.
    const reach = this.rimeRange * breathReachShare(this.rimeRange, mouth[0] * bh);
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = src.facing + (h.rand() * 2 - 1) * this.rimeHalf;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      h.puff(mx, my, mz, 1, {
        speed: reach * 2.4,
        up: -0.4,
        life: 0.55,
        size: [0.5, 2.2],
        color: [0.86, 0.95, 1],
        alpha: 0.5,
        dir: [dx, -0.15, dz],
        spread: 0.12,
        drag: 2.6,
      });
      if (i % 2 === 0)
        h.puff(mx, my, mz, 1, {
          speed: reach * 2.6,
          life: 0.5,
          size: [0.16, 0.04],
          color: rgb(SANCTUM_PALETTE.rime),
          alpha: 1,
          pool: 'glow',
          dir: [dx, -0.1, dz],
          spread: 0.15,
          drag: 2,
        });
    }
  }

  private fracture(src: Entity, copy: Entity | null): void {
    const h = this.host;
    const gy = h.groundY(src.pos.x, src.pos.z);
    const bh = sanctumDrawnHeight(src.templateId, src.scale);
    const x = copy ? (src.pos.x + copy.pos.x) / 2 : src.pos.x;
    const z = copy ? (src.pos.z + copy.pos.z) / 2 : src.pos.z;
    const heading = copy ? Math.atan2(copy.pos.x - src.pos.x, copy.pos.z - src.pos.z) : src.facing;
    // Both halves stagger as the crack runs through them: the original at
    // once, the copy as its entrance (offered until its view exists).
    h.gesture(src.id, SPLINTER_FRACTURE_GESTURE);
    if (copy) this.offerEntrance(copy.id, SPLINTER_COPY_GESTURE, SPLINTER_COPY_WINDOW);
    // The body splits along a seam: ice and rune-iron thrown both ways.
    for (const side of [0, Math.PI]) {
      h.shards.burst(x, gy + bh * 0.55, z, 28, {
        speed: 7,
        up: 5,
        size: [0.35, 1.2],
        radius: 0.8,
        heading: heading + side,
        spread: 0.7,
        iron: 0.35,
      });
    }
    h.shockRing(x, z, SANCTUM_PALETTE.runeBlue, 4.5, 0.45);
    h.shockRing(x, z, SANCTUM_PALETTE.rime, 2.8, 0.3);
    h.puff(x, gy + bh * 0.5, z, 6, {
      speed: 0.3,
      life: 0.35,
      size: [4, 1.2],
      color: rgb(SANCTUM_PALETTE.runeBlue),
      alpha: 1,
      pool: 'glow',
    });
    h.puff(x, gy + bh * 0.5, z, 34, {
      speed: 4.5,
      up: 1,
      life: 1.4,
      size: [0.9, 2.8],
      color: [0.86, 0.94, 1],
      alpha: 0.5,
      drag: 2.4,
    });
    h.puff(x, gy + bh * 0.55, z, 30, {
      speed: 5,
      up: 2,
      life: 0.8,
      size: [0.3, 0.06],
      color: rgb(SANCTUM_PALETTE.runeBlue),
      alpha: 1,
      pool: 'glow',
      drag: 1.6,
    });
    if (!h.reducedMotion()) h.shake(0.3);
  }

  private topple(body: Entity, user: Entity): void {
    if (body.templateId !== SOUL_BRAZIER_ID) return;
    const slot = this.topples.find((t) => t.bodyId < 0) ?? this.topples[0];
    const h = this.host;
    const dx = body.pos.x - user.pos.x;
    const dz = body.pos.z - user.pos.z;
    const yaw = Math.atan2(dx, dz);
    const height = sanctumDrawnHeight(body.templateId, body.scale);
    const base = height * 0.22;
    slot.bodyId = body.id;
    slot.born = this.clock;
    slot.yaw = yaw;
    slot.height = height;
    slot.landed = false;
    slot.x = body.pos.x + Math.sin(yaw) * base;
    slot.z = body.pos.z + Math.cos(yaw) * base;
    slot.y = h.groundY(body.pos.x, body.pos.z);
    slot.pivot.position.set(slot.x, slot.y, slot.z);
    slot.pivot.rotation.set(0, yaw, 0);
    slot.pivot.scale.setScalar(height);
    // The stand's foot sits back from the pivot by its base radius.
    slot.tip.position.set(0, 0, -0.22);
    slot.tip.rotation.set(0, 0, 0);
    slot.embers.opacity = 0.9;
    slot.pivot.visible = true;
    // The standing body is gone: its fallen double takes its place.
    h.gesture(body.id, BRAZIER_TOPPLED_GESTURE);
  }

  // ------------------------------------------------------------------- scans

  /** A mob seen by the scan: offer a fresh Bonewalker its rise, and claim a
   *  Thaw or Branding Iron tether. */
  scanMob(e: Entity): void {
    if (e.templateId === BONEWALKER_ID) this.offerRise(e);
    if (e.dead) return;
    const cast = e.castingAbility;
    if (cast !== SANCTUM_THAW_THE_HELD && cast !== SANCTUM_BRANDING_IRON) return;
    if (this.tethers.some((t) => t.casterId === e.id)) return;
    const t = this.tethers.find((s) => s.casterId < 0);
    if (!t) return;
    t.casterId = e.id;
    t.castId = cast;
  }

  /** A Bonewalker seen for the first time: one of Velkhar's adds climbing
   *  out while he fights rises (Thaw the Held's walkers rise off their own
   *  landing event, handleEvent). */
  private offerRise(e: Entity): void {
    if (this.walkersSeen.has(e.id)) return;
    this.walkersSeen.add(e.id);
    // Forget the bodies that left the world (bounded by the live walkers).
    for (const id of this.walkersSeen)
      if (!this.world.entities.has(id)) this.walkersSeen.delete(id);
    if (bonewalkerRisesOnSight(e.templateId, e.dead, this.velkharFighting()))
      this.offerEntrance(e.id, BONEWALKER_RISE_GESTURE, BONEWALKER_RISE_WINDOW);
  }

  /** True while a living Velkhar is in his fight (judged once per walker). */
  private velkharFighting(): boolean {
    for (const m of this.world.entities.values())
      if (m.templateId === VELKHAR_ID && !m.dead && m.inCombat) return true;
    return false;
  }

  private offerEntrance(id: number, gesture: string, window: number): void {
    this.entrances.set(id, { gesture, until: this.clock + window });
    this.host.gesture(id, gesture);
  }

  // ------------------------------------------------------------------- frame

  update(dt: number, clock: number): void {
    this.clock = clock;
    for (const [id, e] of this.entrances) {
      if (clock > e.until) this.entrances.delete(id);
      else this.host.gesture(id, e.gesture);
    }
    this.paintTethers(dt);
    this.paintColumns();
    this.paintSweeps(dt);
    this.paintTopples(dt);
  }

  private paintTethers(dt: number): void {
    const h = this.host;
    for (const t of this.tethers) {
      if (t.casterId < 0) continue;
      const caster = this.world.entities.get(t.casterId);
      const tid = caster?.castTargetId;
      const target = tid !== null && tid !== undefined ? this.world.entities.get(tid) : undefined;
      if (!caster || caster.dead || caster.castingAbility !== t.castId || !target) {
        this.releaseTether(t);
        continue;
      }
      const thaw = t.castId === SANCTUM_THAW_THE_HELD;
      const hc = sanctumDrawnHeight(caster.templateId, caster.scale);
      const from = this.tmpA;
      const barFill =
        caster.castTotal > 0
          ? Math.min(1, Math.max(0, 1 - caster.castRemaining / caster.castTotal))
          : 1;
      anchorPoint(
        thaw
          ? sanctumAnchor('riteCenser', caster.templateId)
          : brandIronAnchor(caster.templateId, barFill, this.anchorTmp),
        caster.pos.x,
        caster.pos.z,
        h.groundY(caster.pos.x, caster.pos.z),
        caster.facing,
        hc,
        from,
      );
      const tgy = h.groundY(target.pos.x, target.pos.z);
      // A corpse lies on the ice; a living victim takes it in the chest.
      const to = this.tmpB.set(
        target.pos.x,
        thaw ? tgy + 0.5 : tgy + sanctumDrawnHeight(target.templateId, target.scale) * 0.6,
        target.pos.z,
      );
      const len = from.distanceTo(to);
      const fill = barFill;
      const mesh = thaw ? t.thaw : t.spark;
      const mat = thaw ? t.thawMat : t.sparkMat;
      (thaw ? t.spark : t.thaw).visible = false;
      if (len < 0.2) {
        mesh.visible = false;
        continue;
      }
      mat.uniforms.uLen.value = len;
      const dirX = (to.x - from.x) / len;
      const dirY = (to.y - from.y) / len;
      const dirZ = (to.z - from.z) / len;
      // Motes along the tether: soul-stuff pouring in, or the iron's sparks.
      if (h.rand() < dt * (thaw ? 26 : 44) * h.density) {
        const k = h.rand() * 0.3;
        h.puff(
          from.x + (to.x - from.x) * k,
          from.y + (to.y - from.y) * k,
          from.z + (to.z - from.z) * k,
          1,
          {
            speed: len * 1.5,
            life: 0.6,
            size: thaw ? [0.42, 0.12] : [0.24, 0.05],
            color: thaw ? rgb(SANCTUM_PALETTE.soulGreen) : [1, 0.6, 0.22],
            alpha: 1,
            pool: 'glow',
            dir: [dirX, dirY, dirZ],
            spread: thaw ? 0.06 : 0.14,
            drag: 0.4,
            gravity: thaw ? 0 : 3,
          },
        );
      }
      to.sub(from).normalize();
      mesh.position.copy(from);
      mesh.quaternion.setFromUnitVectors(this.up, to);
      mesh.scale.set(thaw ? 1 : 0.55, len, thaw ? 1 : 0.55);
      mesh.visible = true;
      if (thaw) {
        // The ice over the corpse cracking open in soulfire, and steaming.
        t.crack.visible = true;
        t.crack.position.set(target.pos.x, tgy + 0.1, target.pos.z);
        t.crack.scale.set(2.6, 1, 2.6);
        t.crackMat.uniforms.uFill.value = fill;
        if (h.rand() < dt * (8 + 20 * fill) * h.density)
          h.puff(target.pos.x, tgy + 0.3, target.pos.z, 1, {
            speed: 0.4,
            up: 1.6,
            life: 1.8,
            size: [0.8, 2.4],
            color: [0.9, 0.95, 0.98],
            alpha: 0.32,
            radius: 1,
          });
        if (h.rand() < dt * 14 * fill * h.density)
          h.puff(target.pos.x, tgy + 0.2, target.pos.z, 1, {
            speed: 0.3,
            up: 1.2,
            life: 0.7,
            size: [1.2, 0.4],
            color: FLAME_HEAT,
            alpha: 1,
            pool: 'soulfire',
            radius: 0.9,
          });
      } else {
        t.crack.visible = false;
        // The iron's tip white-hot.
        if (h.rand() < dt * 20 * h.density)
          h.puff(from.x, from.y, from.z, 1, {
            speed: 0.3,
            life: 0.25,
            size: [0.7, 0.3],
            color: [1, 0.6, 0.25],
            alpha: 1,
            pool: 'glow',
          });
      }
    }
  }

  private releaseTether(t: Tether): void {
    t.casterId = -1;
    t.thaw.visible = false;
    t.spark.visible = false;
    t.crack.visible = false;
  }

  private paintColumns(): void {
    for (const c of this.columns) {
      if (!c.alive) continue;
      const elapsed = this.clock - c.born;
      if (elapsed > ERUPTION_SECONDS) {
        c.alive = false;
        c.mesh.visible = false;
        continue;
      }
      const e = eruption(elapsed);
      c.mesh.scale.set(1 + elapsed * 0.4, 7.5 * e.rise, 1 + elapsed * 0.4);
      c.mat.uniforms.uAlpha.value = e.alpha;
    }
  }

  private paintSweeps(dt: number): void {
    const h = this.host;
    for (const s of this.sweeps) {
      if (!s.alive) continue;
      const elapsed = this.clock - s.born;
      if (elapsed > LASH_SWEEP_SECONDS + 0.4) {
        s.alive = false;
        s.mesh.visible = false;
        continue;
      }
      const look = lashSweep(elapsed);
      s.mat.uniforms.uEdge.value = look.edge;
      s.mat.uniforms.uAlpha.value = look.alpha;
      // Snow and ice spray thrown off the leading edge, tangent to the sweep.
      if (elapsed < LASH_SWEEP_SECONDS) {
        const dir = s.mat.uniforms.uDir.value as number;
        const a = s.yaw + dir * (look.edge * 2 - 1) * s.half;
        const n = Math.max(1, Math.round(dt * 160 * h.density));
        for (let i = 0; i < n; i++) {
          const r = s.range * (0.35 + h.rand() * 0.65);
          const px = s.x + Math.sin(a) * r;
          const pz = s.z + Math.cos(a) * r;
          const ta = a + (dir * Math.PI) / 2;
          h.puff(px, s.y + 0.3, pz, 1, {
            speed: 5,
            up: 1.4,
            life: 0.9,
            size: [0.6, 2],
            color: [0.9, 0.95, 1],
            alpha: 0.45,
            dir: [
              Math.sin(ta) * 0.8 + Math.sin(a) * 0.4,
              0.25,
              Math.cos(ta) * 0.8 + Math.cos(a) * 0.4,
            ],
            spread: 0.35,
            drag: 2.6,
          });
          if (i % 2 === 0)
            h.puff(px, s.y + 0.4, pz, 1, {
              speed: 4,
              up: 2,
              life: 0.5,
              size: [0.14, 0.04],
              color: rgb(SANCTUM_PALETTE.rime),
              alpha: 1,
              pool: 'glow',
              gravity: 7,
            });
        }
      }
    }
  }

  private paintTopples(dt: number): void {
    const h = this.host;
    for (const t of this.topples) {
      if (t.bodyId < 0) continue;
      const elapsed = this.clock - t.born;
      if (elapsed > TOPPLE_LIE_SECONDS + 1) {
        t.bodyId = -1;
        t.pivot.visible = false;
        continue;
      }
      const look = toppleTilt(elapsed);
      t.tip.rotation.x = look.tilt;
      // Its last second: it sinks into the meltwater it made and goes out.
      const sink = Math.max(0, elapsed - TOPPLE_LIE_SECONDS);
      t.pivot.position.y = t.y - sink * 0.4;
      t.embers.opacity = Math.max(0, 0.9 - sink);
      if (look.landed && !t.landed) {
        t.landed = true;
        // It hits the ice: the bowl's soulfire gouts out along the fall.
        const fx = Math.sin(t.yaw);
        const fz = Math.cos(t.yaw);
        const bx = t.x + fx * t.height * 0.75;
        const bz = t.z + fz * t.height * 0.75;
        h.shockRing(bx, bz, SANCTUM_PALETTE.soulGreen, 3.5, 0.4);
        h.puff(bx, t.y + 0.3, bz, 26, {
          speed: 3.2,
          up: 1.6,
          life: 0.8,
          size: [2.2, 0.7],
          color: FLAME_HEAT,
          alpha: 1,
          pool: 'soulfire',
          dir: [fx, 0.2, fz],
          spread: 0.6,
          radius: 0.4,
        });
        h.puff(t.x, t.y + 0.2, t.z, 18, {
          speed: 2.4,
          up: 0.6,
          life: 1.3,
          size: [0.8, 2.2],
          color: [0.9, 0.93, 0.96],
          alpha: 0.45,
          drag: 2.4,
        });
        if (!h.reducedMotion()) h.shake(0.18);
      }
      // The coals still smoulder in the tipped bowl.
      if (look.landed && h.rand() < dt * 6 * h.density) {
        const bx = t.x + Math.sin(t.yaw) * t.height * 0.75;
        const bz = t.z + Math.cos(t.yaw) * t.height * 0.75;
        h.puff(bx, t.y + 0.3, bz, 1, {
          speed: 0.2,
          up: 1,
          life: 0.7,
          size: [0.9, 0.3],
          color: FLAME_HEAT,
          alpha: 1,
          pool: 'soulfire',
          radius: 0.3,
        });
      }
      // A view rebuilt under it would stand the body back up: hide it again.
      if (elapsed > 0.5 && Math.floor(elapsed) !== Math.floor(elapsed - dt))
        h.gesture(t.bodyId, BRAZIER_TOPPLED_GESTURE);
    }
  }

  hideAll(): void {
    for (const t of this.tethers) this.releaseTether(t);
    for (const c of this.columns) {
      c.alive = false;
      c.mesh.visible = false;
    }
    for (const s of this.sweeps) {
      s.alive = false;
      s.mesh.visible = false;
    }
    for (const t of this.topples) {
      t.bodyId = -1;
      t.pivot.visible = false;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

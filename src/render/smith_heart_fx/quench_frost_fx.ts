// The Guardian of the Quench's frost pass on the bodies (plan:
// quench_frost_fx_core.ts; the team's pass of 2026-11-04), owned by
// QuenchFightFx (quench_fight_fx.ts), which feeds it the bodies its scan found
// and the fight's cues. Presentation only, read from IWorld (the players'
// cold, warmth, frozen and splash auras and their immunities), so offline
// and online look the same:
//  - the icy aura: a shell of rime climbing each cold body with its bar,
//    pulsing past three quarters, its light rising with the cold; frost
//    veins BITE across it while the body hides in an immunity (an Ice Block:
//    the cold still bites), motes of frost drawn in to it; every tier;
//  - breath vapour off every cold body, more and thicker as it freezes;
//  - the huddle's ring: one ring of warm light round each huddle, linking
//    its members (the threads and the glows are QuenchFightFx's);
//  - the freeze: jagged rime spikes bursting out of the ice round the
//    encased; the shatter: chunks of ice thrown out tumbling across the lake;
//  - the splash: a shard of ice flying from the shattered to each ally it
//    struck (the sim's splash mark says who), bursting on them and flaring
//    their own shell, so the raid SEES the cold jump onto its neighbours;
//  - the bite: the immunity cracking with a burst of shards as the rime
//    takes the body anyway.
// The shells, rings, spikes and shards draw on every tier; the vapour, the
// motes and the chunks' count thin on the low tier.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the fight's root (QuenchFightFx attaches it through
// `attachSceneGroupGated`, so these programs link with the rest before the
// first cast); fixed pools, no per-frame allocation, no light.

import * as THREE from 'three';
import {
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_TUNING as T,
} from '../../sim/encounters/smith_heart/quench_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { heartKitSlotMaterial } from '../smith_heart/heart_kit';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { QUENCH_FIGHT_COLORS as C, fightHash } from './quench_fight_fx_core';
import {
  CHUNK_SECONDS,
  type ChunkPose,
  chunkPose,
  type HuddleBody,
  type HuddleRing,
  huddleRings,
  QUENCH_FROST_POOLS as P,
  type ShellLook,
  SPLASH_FLARE_SECONDS,
  SPLASH_FLIGHT_SECONDS,
  type SpikePose,
  shardFlight,
  shellLook,
  spikePose,
  vaporRate,
} from './quench_frost_fx_core';

const BODY_H = 2.05;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _fwd = new THREE.Vector3(0, 0, 1);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _look: ShellLook = { height: 0, glow: 0, pulse: 0, bite: 0, alpha: 0 };
const _chunk: ChunkPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, size: 0 };
const _spike: SpikePose = { a: 0, r: 0, lean: 0, h: 0, w: 0 };
const _p = { x: 0, y: 0, z: 0 };
const _p2 = { x: 0, y: 0, z: 0 };

// ---- shaders -----------------------------------------------------------------------------

/** The icy aura round a cold body: an open cylinder (y 0..1) whose
 *  per-instance aShell carries (height, glow, bite, alpha). */
const SHELL_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
attribute vec4 aShell;
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec4 vS;
varying float vSeed;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vL = position;
  vS = aShell;
  vSeed = fract(sin(dot(floor(instanceMatrix[3].xz * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFrost;
uniform vec3 uDeep;
uniform vec3 uBite;
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec4 vS;
varying float vSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float a = atan(vL.z, vL.x);
  float y = vL.y;
  vec2 q = vec2(a * 2.2 + vSeed * 9.0, y * 6.0);
  float rag = n(q * 1.7) * 0.12;
  // The rime's ragged front climbing the body, a bright lip at its edge.
  float front = vS.x + rag - 0.04;
  float under = 1.0 - smoothstep(front - 0.02, front + 0.03, y);
  float lip = smoothstep(front - 0.1, front - 0.01, y) * under;
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.7);
  // Feathered frost: crystalline cells, glints drifting up.
  float cell = h(floor(q * vec2(3.0, 4.0)));
  float feather = smoothstep(0.55, 0.95, n(q * 3.3 + vec2(0.0, -uTime * 0.25)));
  float glint = pow(max(0.0, n(q * 6.0 + vec2(uTime * 0.6, uTime * 0.9)) - 0.7) * 3.3, 3.0);
  // A glaze, not a sleeve: almost clear in its middle, rime at its edges,
  // a bright ragged lip, feathered streaks and glints.
  float streak = smoothstep(0.78, 0.98, n(vec2(a * 7.0 + vSeed * 5.0, y * 1.5)));
  vec3 col = mix(uDeep, uFrost, 0.45 + 0.55 * fres + 0.2 * cell);
  col = col * (0.75 + 0.35 * vS.y) + uFrost * (lip * 0.9 + glint * 1.1);
  float alpha = under * (0.02 + 0.3 * fres * fres + 0.16 * feather * fres + 0.22 * streak);
  alpha += under * (0.6 * lip + 0.55 * glint);
  // The bite: jagged veins racing up and round a body hidden in an immunity.
  float vein = abs(fract(a * 1.6 + y * 3.2 + n(q * 2.0) * 0.8 - uTime * 1.8) - 0.5);
  float veins = (1.0 - smoothstep(0.0, 0.05, vein)) * step(0.5, vS.z);
  float throb = 0.6 + 0.4 * sin(uTime * 11.0 + y * 6.0);
  col = mix(col, uBite, veins * 0.8);
  alpha = max(alpha, veins * throb * (0.55 + 0.35 * fres));
  gl_FragColor = vec4(col, clamp(alpha * vS.w, 0.0, 0.85));
  #include <colorspace_fragment>
}
`;
/** The huddle's ring on the ice (instanceColor: strength, members, seed). */
const RING_VERT = /* glsl */ `
varying vec2 vXY;
varying vec3 vP;
void main() {
  vXY = position.xz;
  vP = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const RING_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uWarm;
uniform vec3 uCore;
varying vec2 vXY;
varying vec3 vP;
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float a = atan(vXY.y, vXY.x);
  // A bright band at the rim, embers running round it, a soft warm floor.
  float band = smoothstep(0.84, 0.93, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float run = 0.55 + 0.45 * sin(a * 9.0 - uTime * 2.6 + vP.z * 20.0);
  float beads = smoothstep(0.82, 1.0, sin(a * 18.0 + uTime * 1.7 + vP.z * 7.0));
  float floorGlow = pow(1.0 - r, 1.4) * 0.28;
  float breathe = 0.85 + 0.15 * sin(uTime * 3.1 + vP.z * 31.0);
  vec3 col = uWarm * (band * (0.7 + 0.6 * run) + floorGlow) + uCore * beads * band * 1.2;
  float alpha = (band * (0.6 + 0.4 * run) + floorGlow + beads * band * 0.5) * vP.x * breathe;
  gl_FragColor = vec4(col * vP.x * breathe, alpha);
  #include <colorspace_fragment>
}
`;

// ---- records -----------------------------------------------------------------------------

interface Bolt {
  live: boolean;
  born: number;
  fromId: number;
  toId: number;
  fx: number;
  fz: number;
}

interface Burst {
  live: boolean;
  born: number;
  seed: number;
  x: number;
  y: number;
  z: number;
  n: number;
}

/** What the fight's painter hands the frost pass each frame. */
export interface QuenchFrostFrame {
  coldIds: readonly number[];
  warmIds: readonly number[];
  frozenIds: readonly number[];
  frozenSince: ReadonlyMap<number, number>;
}

export class QuenchFrostFx {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly shells: THREE.InstancedMesh;
  private readonly shellAttr: THREE.InstancedBufferAttribute;
  private readonly rings: THREE.InstancedMesh;
  private readonly spikes: THREE.InstancedMesh;
  private readonly chunks: THREE.InstancedMesh;
  private readonly bolts: THREE.InstancedMesh;
  private readonly boltPool: Bolt[] = [];
  private readonly bursts: Burst[] = [];
  private readonly ringRecs: HuddleRing[] = [];
  private readonly ringBodies: HuddleBody[] = [];
  private readonly ringParent = new Int16Array(32);
  /** Last splash-mark time left seen per player (a fresh mark is a new splash). */
  private readonly splashSeen = new Map<number, number>();
  /** When a splash shard last struck each player (their shell flares). */
  private readonly flareAt = new Map<number, number>();
  private readonly chunksPer: number;

  constructor(
    private readonly root: THREE.Group,
    private readonly uTime: { value: number },
    private readonly particles: EngineParticles,
    private readonly groundY: (x: number, z: number) => number,
    private readonly density: number,
    private readonly rand: () => number,
    detail: boolean,
  ) {
    this.chunksPer = detail ? P.chunksPer : Math.ceil(P.chunksPer / 2);
    const instanced = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      n: number,
      name: string,
    ): THREE.InstancedMesh => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) mesh.setMatrixAt(i, _zero);
      mesh.visible = false;
      this.root.add(mesh);
      return mesh;
    };

    // ---- the icy aura ----
    const shellGeo = new THREE.CylinderGeometry(0.44, 0.56, 1, 28, 8, true).translate(0, 0.5, 0);
    this.shellAttr = new THREE.InstancedBufferAttribute(new Float32Array(P.shells * 4), 4);
    this.shellAttr.setUsage(THREE.DynamicDrawUsage);
    shellGeo.setAttribute('aShell', this.shellAttr);
    this.geometries.push(shellGeo);
    const shellMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchFrostShell',
      uniforms: {
        uTime: this.uTime,
        uFrost: { value: new THREE.Color(...C.frost) },
        uDeep: { value: new THREE.Color(...C.frostDeep) },
        uBite: { value: new THREE.Color(0.75, 0.97, 1.0) },
      },
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.materials.push(shellMat);
    this.shells = instanced(shellGeo, shellMat, P.shells, 'smithHeartQuenchFrostShells');
    this.shells.renderOrder = 2;

    // ---- the huddle's rings ----
    const disc = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    const ringMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchHuddleRing',
      uniforms: {
        uTime: this.uTime,
        uWarm: { value: new THREE.Color(C.warm) },
        uCore: { value: new THREE.Color(...C.warmCore) },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(ringMat);
    this.rings = instanced(disc, ringMat, P.rings, 'smithHeartQuenchHuddleRings');
    for (let i = 0; i < P.rings; i++) this.rings.setColorAt(i, _c.setRGB(0, 0, 0));
    if (this.rings.instanceColor) this.rings.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.rings.renderOrder = floorVfxRenderOrder('encounter', 7);

    // ---- the ice: spikes and chunks share the kit's ice ----
    const iceMat = heartKitSlotMaterial('ice');
    const tint = (geo: THREE.BufferGeometry, lo: number, hi: number) => {
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = Math.min(1, Math.max(0, (pos.getY(i) - lo) / (hi - lo)));
        const face = 0.85 + 0.3 * fightHash(Math.floor(i / 3), 29);
        col.set(
          [
            Math.min(1, (0.3 + 0.6 * k) * face),
            Math.min(1, (0.55 + 0.4 * k) * face),
            Math.min(1, (0.78 + 0.22 * k) * face),
          ],
          i * 3,
        );
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
    };
    const spikeGeo = new THREE.ConeGeometry(1, 1, 4, 1).translate(0, 0.5, 0).toNonIndexed();
    tint(spikeGeo, 0, 1);
    const chunkGeo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
    tint(chunkGeo, -1, 1);
    this.geometries.push(spikeGeo, chunkGeo);
    this.spikes = instanced(spikeGeo, iceMat, P.frozen * P.spikesPer, 'smithHeartQuenchRimeSpikes');
    this.chunks = instanced(chunkGeo, iceMat, P.chunks, 'smithHeartQuenchShatterChunks');
    for (let i = 0; i < Math.ceil(P.chunks / P.chunksPer) + 1; i++)
      this.bursts.push({ live: false, born: 0, seed: 0, x: 0, y: 0, z: 0, n: 0 });

    // ---- the splash's shards ----
    const boltGeo = new THREE.OctahedronGeometry(1, 0);
    this.geometries.push(boltGeo);
    const boltMat = new THREE.MeshBasicMaterial({
      color: 0xd8f6ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      name: 'smithHeartQuenchSplashShard',
    });
    this.materials.push(boltMat);
    this.bolts = instanced(boltGeo, boltMat, P.bolts, 'smithHeartQuenchSplashShards');
    for (let i = 0; i < P.bolts; i++)
      this.boltPool.push({ live: false, born: 0, fromId: -1, toId: -1, fx: 0, fz: 0 });
  }

  // ---- the cues ----------------------------------------------------------------------------

  /** The fight's cues this pass adds to (QuenchFightFx still claims them). */
  event(ev: SimEvent, world: IWorld, clock: number): void {
    if (ev.type === 'spellfxAt' && ev.ability === QUENCH_CUES.shatter) {
      this.throwChunks(ev.x, ev.z, clock);
      return;
    }
    if (ev.type !== 'spellfx' || ev.ability !== QUENCH_CUES.bite) return;
    const e = world.entities.get(ev.targetId);
    if (e) this.biteBurst(e);
  }

  /** The immunity cracks: a burst of shards off the body, a ring of frost. */
  private biteBurst(e: Entity): void {
    const at = fxAnchor(e);
    const y = this.groundY(at.x, at.z);
    this.particles.puff(at.x, y + 1.1, at.z, 22, {
      speed: 6,
      up: 2.5,
      life: 0.8,
      size: [0.34, 0.08],
      color: C.shard,
      alpha: 1,
      pool: 'glow',
      gravity: 12,
      radius: 0.7,
    });
    this.particles.puff(at.x, y + 1, at.z, 8, {
      speed: 1.6,
      up: 0.6,
      life: 1.2,
      size: [0.9, 2.2],
      color: C.mist,
      alpha: 0.5,
    });
    this.particles.shockRing(at.x, at.z, 0xcff2ff, 3.2, 0.45);
  }

  private throwChunks(x: number, z: number, clock: number): void {
    const b = this.bursts.find((r) => !r.live) ?? this.bursts[0];
    b.live = true;
    b.born = clock;
    b.seed = Math.floor(this.rand() * 1e6);
    b.x = x;
    b.z = z;
    b.y = this.groundY(x, z);
    b.n = this.chunksPer;
  }

  // ---- the frame ---------------------------------------------------------------------------

  frame(world: IWorld, f: QuenchFrostFrame, dt: number, clock: number): void {
    this.paintShells(world, f, dt, clock);
    this.paintRings(world, f);
    this.paintSpikes(world, f, clock);
    this.paintChunks(clock);
    this.paintBolts(world, clock);
  }

  private paintShells(world: IWorld, f: QuenchFrostFrame, dt: number, clock: number): void {
    let n = 0;
    const arr = this.shellAttr.array as Float32Array;
    for (const id of f.coldIds) {
      if (n >= P.shells) break;
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      let cold = 0;
      let mark: { value: number; value2?: number; remaining: number } | null = null;
      let warded = e.damageImmune === true;
      for (const a of e.auras) {
        if (a.id === QUENCH_AURAS.cold) cold = a.value;
        else if (a.id === QUENCH_AURAS.splashed) mark = a;
        else if (a.kind === 'stasis') warded = true;
      }
      this.noteSplash(world, e, mark, clock);
      const flareT = this.flareAt.get(id);
      const flare =
        flareT === undefined ? 0 : Math.max(0, 1 - (clock - flareT) / SPLASH_FLARE_SECONDS);
      const look = shellLook(cold, warded, flare, clock, _look);
      if (look.alpha <= 0.01) continue;
      const at = fxAnchor(e);
      const floor = this.groundY(at.x, at.z);
      _v.set(at.x, floor + 0.02, at.z);
      const grow = 1 + flare * 0.18 + look.pulse * 0.05;
      _s.set(grow, BODY_H, grow);
      this.shells.setMatrixAt(n, _m.compose(_v, _q.identity(), _s));
      arr[n * 4] = look.height;
      arr[n * 4 + 1] = look.glow;
      arr[n * 4 + 2] = look.bite;
      arr[n * 4 + 3] = look.alpha;
      n++;
      // The breath's vapour, out ahead of the face.
      const rate = vaporRate(cold);
      if (rate > 0 && this.rand() < dt * rate * this.density) {
        const fx = Math.sin(e.facing);
        const fz = Math.cos(e.facing);
        this.particles.puff(at.x + fx * 0.35, floor + 1.72, at.z + fz * 0.35, 1, {
          speed: 0.5,
          up: 0.25,
          dir: [fx, 0.15, fz],
          spread: 0.4,
          life: 1 + cold / 100,
          size: [0.18, 0.55 + cold / 160],
          color: C.mist,
          alpha: 0.32 + cold / 300,
          drag: 2.2,
        });
      }
      // The cold biting through an immunity: motes of frost drawn in.
      if (warded && this.rand() < dt * 10 * this.density) {
        const a = this.rand() * Math.PI * 2;
        this.particles.puff(
          at.x + Math.cos(a) * 1.6,
          floor + 0.4 + this.rand() * 1.4,
          at.z + Math.sin(a) * 1.6,
          1,
          {
            speed: 2.2,
            dir: [-Math.cos(a), 0.1, -Math.sin(a)],
            spread: 0.15,
            life: 0.55,
            size: [0.2, 0.05],
            color: C.shard,
            alpha: 1,
            pool: 'glow',
          },
        );
      }
    }
    for (let i = n; i < P.shells; i++) this.shells.setMatrixAt(i, _zero);
    this.shells.instanceMatrix.needsUpdate = true;
    this.shellAttr.needsUpdate = true;
    this.shells.visible = n > 0;
  }

  /** A fresh splash mark on `e` launches a shard from whoever shattered. */
  private noteSplash(
    world: IWorld,
    e: Entity,
    mark: { value: number; value2?: number; remaining: number } | null,
    clock: number,
  ): void {
    if (!mark) {
      this.splashSeen.delete(e.id);
      return;
    }
    const seen = this.splashSeen.get(e.id);
    this.splashSeen.set(e.id, mark.remaining);
    if (seen !== undefined && mark.remaining <= seen + 0.05) return;
    if (mark.remaining < T.splashMarkSeconds - 0.6) return;
    const from = mark.value2 !== undefined ? world.entities.get(mark.value2) : undefined;
    const slot = this.boltPool.find((b) => !b.live) ?? this.boltPool[0];
    const src = from ? fxAnchor(from) : fxAnchor(e);
    slot.live = true;
    slot.born = clock;
    slot.fromId = from?.id ?? -1;
    slot.toId = e.id;
    slot.fx = src.x;
    slot.fz = src.z;
  }

  private paintRings(world: IWorld, f: QuenchFrostFrame): void {
    this.ringBodies.length = 0;
    for (const id of f.warmIds) {
      if (this.ringBodies.length >= this.ringParent.length) break;
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const at = fxAnchor(e);
      this.ringBodies.push({ id, x: at.x, z: at.z });
    }
    const count = huddleRings(this.ringBodies, this.ringRecs, P.rings, T.warmR, this.ringParent);
    for (let i = 0; i < count; i++) {
      const r = this.ringRecs[i];
      _v.set(r.x, this.groundY(r.x, r.z) + 0.07, r.z);
      _s.set(r.radius, 1, r.radius);
      this.rings.setMatrixAt(i, _m.compose(_v, _q.identity(), _s));
      this.rings.setColorAt(i, _c.setRGB(Math.min(1, 0.55 + 0.1 * r.members), r.members, i * 0.17));
    }
    for (let i = count; i < P.rings; i++) this.rings.setMatrixAt(i, _zero);
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.rings.visible = count > 0;
  }

  private paintSpikes(world: IWorld, f: QuenchFrostFrame, clock: number): void {
    let n = 0;
    for (const id of f.frozenIds) {
      if (n + P.spikesPer > P.frozen * P.spikesPer) break;
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const at = fxAnchor(e);
      const floor = this.groundY(at.x, at.z);
      const grow = Math.min(1, (clock - (f.frozenSince.get(id) ?? clock)) / 0.35);
      for (let k = 0; k < P.spikesPer; k++) {
        spikePose(id, k, grow, _spike);
        _v.set(
          at.x + Math.cos(_spike.a) * _spike.r,
          floor - 0.1,
          at.z + Math.sin(_spike.a) * _spike.r,
        );
        // Lean out from the body: about the axis across its radial line.
        _q.setFromAxisAngle(_w.set(Math.sin(_spike.a), 0, -Math.cos(_spike.a)), _spike.lean);
        _s.set(_spike.w, Math.max(0.001, _spike.h), _spike.w);
        this.spikes.setMatrixAt(n++, _m.compose(_v, _q, _s));
      }
    }
    for (let i = n; i < P.frozen * P.spikesPer; i++) this.spikes.setMatrixAt(i, _zero);
    this.spikes.instanceMatrix.needsUpdate = true;
    this.spikes.visible = n > 0;
  }

  private paintChunks(clock: number): void {
    let n = 0;
    for (const b of this.bursts) {
      if (!b.live) continue;
      const el = clock - b.born;
      if (el >= CHUNK_SECONDS) {
        b.live = false;
        continue;
      }
      for (let i = 0; i < b.n && n < P.chunks; i++) {
        if (!chunkPose(i, b.seed, el, _chunk) || _chunk.size <= 0.001) continue;
        _v.set(b.x + _chunk.x, b.y + _chunk.y, b.z + _chunk.z);
        _e.set(_chunk.rx, _chunk.ry, 0);
        _q.setFromEuler(_e);
        _s.set(_chunk.size, _chunk.size * 0.8, _chunk.size * 1.1);
        this.chunks.setMatrixAt(n++, _m.compose(_v, _q, _s));
      }
    }
    for (let i = n; i < P.chunks; i++) this.chunks.setMatrixAt(i, _zero);
    this.chunks.instanceMatrix.needsUpdate = true;
    this.chunks.visible = n > 0;
  }

  private paintBolts(world: IWorld, clock: number): void {
    let n = 0;
    for (const b of this.boltPool) {
      if (!b.live) continue;
      const to = world.entities.get(b.toId);
      const k = (clock - b.born) / SPLASH_FLIGHT_SECONDS;
      if (!to || to.dead) {
        b.live = false;
        continue;
      }
      const tAt = fxAnchor(to);
      if (k >= 1) {
        b.live = false;
        this.flareAt.set(b.toId, clock);
        const y = this.groundY(tAt.x, tAt.z);
        this.particles.puff(tAt.x, y + 1.2, tAt.z, 14, {
          speed: 4,
          up: 1.5,
          life: 0.6,
          size: [0.3, 0.07],
          color: C.shard,
          alpha: 1,
          pool: 'glow',
          gravity: 10,
          radius: 0.4,
        });
        this.particles.puff(tAt.x, y + 1, tAt.z, 4, {
          speed: 1,
          life: 0.9,
          size: [0.7, 1.7],
          color: C.mist,
          alpha: 0.45,
        });
        continue;
      }
      shardFlight(k, b.fx, b.fz, tAt.x, tAt.z, _p);
      shardFlight(Math.min(1, k + 0.06), b.fx, b.fz, tAt.x, tAt.z, _p2);
      const floor = this.groundY(_p.x, _p.z);
      _v.set(_p.x, floor + _p.y, _p.z);
      _w.set(_p2.x - _p.x, _p2.y - _p.y + 1e-4, _p2.z - _p.z).normalize();
      _q.setFromUnitVectors(_fwd, _w);
      _s.set(0.13, 0.13, 0.55);
      this.bolts.setMatrixAt(n++, _m.compose(_v, _q, _s));
      if (this.rand() < 0.7 * this.density)
        this.particles.puff(_v.x, _v.y, _v.z, 1, {
          speed: 0.3,
          life: 0.35,
          size: [0.22, 0.04],
          color: C.shard,
          alpha: 0.9,
          pool: 'glow',
        });
    }
    for (let i = n; i < P.bolts; i++) this.bolts.setMatrixAt(i, _zero);
    this.bolts.instanceMatrix.needsUpdate = true;
    this.bolts.visible = n > 0;
  }

  /** Leaving the lake: every pool empty. */
  clear(): void {
    for (const b of this.boltPool) b.live = false;
    for (const b of this.bursts) b.live = false;
    this.splashSeen.clear();
    this.flareAt.clear();
    for (const mesh of [this.shells, this.rings, this.spikes, this.chunks, this.bolts]) {
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, _zero);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = false;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const mesh of [this.shells, this.rings, this.spikes, this.chunks, this.bolts])
      mesh.dispose();
  }
}

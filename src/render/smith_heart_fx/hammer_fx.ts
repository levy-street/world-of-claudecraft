// The Hammer guardian's and the Slab's effects (plan: hammer_fx_core.ts),
// hosted by ../rift_death_zone.ts beside the dungeons' own fx. Presentation
// only, read from IWorld (the guardian's cast bar, its events, the mirrored
// gate memory), so offline and online look the same:
//  - Mountain's Wrath on its bar (cast by the Guardian or, the Guardian
//    fallen, by the Hammer Council member that took up its Wrath): molten
//    cracks race out from the caster's
//    feet across the quarry floor, loose stones lift and hang round it, dust
//    is drawn in toward it, grit shakes down; when it lands, a wall of rock
//    dust rides the trash engine's wave front out to the nova's radius, the
//    floating stones and a spray of rubble are flung outward, the cracks
//    flare and smoulder, the quarry shakes;
//  - Hammerfall: a fan of cracks torn open in the arc before it, rubble and
//    dust thrown along it, a short shake;
//  - the Slab: the split flares along its line, the stone bursts (chunks
//    tumbling both ways, a dust cloud rolling out, a shock ring over the
//    stair), grit pours from the lintel for a few seconds while the halves
//    part and sink (../smith_heart/heart_gates.ts); the Pit Mouth slamming
//    shut behind the raid throws a dust skirt along its foot.
// The readable telegraph of Mountain's Wrath is the trash engine's sight field
// (../trash_engine_fx/engine_nova.ts), drawn on every tier; nothing here is
// actionable, so the low tier and reduced motion thin the particles, the
// rubble and the shake, never the field.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the root before its gated attach (one compile-gated
// attach); no light; no per-frame allocation (fixed pools); the cracks are
// floor marks on the floor ladder's encounter band.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { councilRoleOf } from '../../sim/encounters/smith_heart/council_ids';
import { dungeonGateAt, dungeonGateStateOf } from '../../sim/instances/dungeon_gates';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX, sharedUniforms, surfaceMat } from '../gfx';
import { gateMemoryKey, gateView } from '../hollow_crypt/crypt_gate_state_core';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  ARC_CLEAVE_ABILITY,
  type CrackLine,
  crackLines,
  fxHash,
  HAMMER_FX_COLORS,
  HAMMER_FX_POOLS,
  HAMMER_GUARDIAN,
  hammerfallHeat,
  hammerGuardianKit,
  MOUNTAINS_WRATH,
  SLAB_BURST_AT,
  slabBreakDue,
  WRATH_AFTERGLOW,
  wrathBlastLook,
  wrathChargeLook,
} from './hammer_fx_core';

const SCAN_SEC = 0.1;
const SMITH_HEART = 'smith_heart';
const C = HAMMER_FX_COLORS;

// ---- the cracks ---------------------------------------------------------------------

const CRACK_VERT = /* glsl */ `
attribute float aT;
attribute float aEdge;
varying float vT;
varying float vEdge;
void main() {
  vT = aT;
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A crack: a dark lip, a molten core, revealed root to tip by uGrow. */
const CRACK_FRAG = /* glsl */ `
uniform float uGrow;
uniform float uHeat;
uniform float uAlpha;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform vec3 uDark;
varying float vT;
varying float vEdge;
void main() {
  if (vT > uGrow) discard;
  float e = abs(vEdge);
  float core = 1.0 - smoothstep(0.0, 0.55, e);
  float flick = 0.85 + 0.15 * sin(uTime * 23.0 + vT * 31.0);
  float front = smoothstep(uGrow - 0.08, uGrow, vT);
  float heat = uHeat * flick * (1.0 + front * 1.4);
  vec3 hot = mix(uEdge, uCore, core * clamp(heat - 0.3, 0.0, 1.0));
  vec3 col = mix(uDark, hot * heat, core);
  float a = uAlpha * (1.0 - smoothstep(0.75, 1.0, e)) * (0.65 + 0.35 * core);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

interface CrackStar {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  kind: 'wrath' | 'fall' | 'idle';
  owner: number;
}

/** One merged ribbon geometry for a set of crack lines (flat, at y 0). */
function crackGeometry(lines: readonly CrackLine[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const t: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  for (const line of lines) {
    const n = line.pts.length;
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const p = line.pts[i];
      const q = line.pts[Math.min(n - 1, i + 1)];
      const o = line.pts[Math.max(0, i - 1)];
      let dx = q.x - o.x;
      let dz = q.z - o.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const w = line.width * (1 - p.t * 0.85);
      for (const s of [-1, 1]) {
        pos.push(p.x - dz * w * s, 0, p.z + dx * w * s);
        t.push(p.t);
        edge.push(s);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---- the dust wall ------------------------------------------------------------------

const WALL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const WALL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uDust;
uniform vec3 uDark;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vec2(vUv.x * 48.0, vUv.y * 3.0 - uTime * 1.6);
  float billow = n(p) * 0.6 + n(p * 2.3 + 7.0) * 0.4;
  float rise = 1.0 - smoothstep(0.15 + billow * 0.55, 0.95, vUv.y);
  float a = uAlpha * rise * (0.45 + 0.55 * billow);
  gl_FragColor = vec4(mix(uDark, uDust, vUv.y * 0.7 + billow * 0.3), a);
  #include <colorspace_fragment>
}
`;

// ---- the rubble ---------------------------------------------------------------------

/** A jagged chunk: an icosahedron pulled about by a fixed hash (no rng). */
export function chunkGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.7 + fxHash(i, 91) * 0.6;
    p.setXYZ(i, p.getX(i) * k * 1.2, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export const STONE_TONES = [0x9a8466, 0x7a664e, 0xb39c7c, 0x5e4f3e].map((c) => new THREE.Color(c));

/** A fixed pool of tumbling stones: thrown, lying a moment, sinking away. */
export class Rubble {
  readonly mesh: THREE.InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly axis: Float32Array;
  private readonly angle: Float32Array;
  private readonly spin: Float32Array;
  private readonly size: Float32Array;
  private readonly floor: Float32Array;
  private readonly timer: Float32Array;
  /** 0 dead, 1 flying, 2 resting, 3 sinking. */
  private readonly state: Uint8Array;
  private cursor = 0;
  private live = 0;
  private readonly q = new THREE.Quaternion();
  private readonly a = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();

  constructor(
    root: THREE.Group,
    readonly capacity: number,
    geometry: THREE.BufferGeometry,
    private readonly groundY: (x: number, z: number) => number,
    private readonly rand: () => number,
  ) {
    this.mesh = new THREE.InstancedMesh(
      geometry,
      surfaceMat({ color: 0xffffff, roughness: 0.92, flatShading: true }),
      capacity,
    );
    this.mesh.name = 'smithHeartRubble';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setColorAt(i, STONE_TONES[i % STONE_TONES.length]);
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    root.add(this.mesh);
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.axis = new Float32Array(capacity * 3);
    this.angle = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.floor = new Float32Array(capacity);
    this.timer = new Float32Array(capacity);
    this.state = new Uint8Array(capacity);
  }

  /** Throw one stone from (x, y, z) with velocity (vx, vy, vz). */
  throw(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.state[i] === 0) this.live++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    const ax = this.rand() - 0.5;
    const ay = this.rand() - 0.5;
    const az = this.rand() - 0.5;
    const al = Math.hypot(ax, ay, az) || 1;
    this.axis[i * 3] = ax / al;
    this.axis[i * 3 + 1] = ay / al;
    this.axis[i * 3 + 2] = az / al;
    this.angle[i] = this.rand() * Math.PI * 2;
    this.spin[i] = (this.rand() - 0.5) * 14;
    this.size[i] = size;
    this.floor[i] = this.groundY(x + vx * 0.6, z + vz * 0.6);
    this.timer[i] = 0;
    this.state[i] = 1;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (this.live <= 0) {
      this.mesh.visible = false;
      return;
    }
    for (let i = 0; i < this.capacity; i++) {
      const st = this.state[i];
      if (st === 0) continue;
      let scale = this.size[i];
      if (st === 1) {
        this.vel[i * 3 + 1] -= 24 * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        this.angle[i] += this.spin[i] * dt;
        const rest = this.floor[i] + this.size[i] * 0.3;
        if (this.pos[i * 3 + 1] <= rest && this.vel[i * 3 + 1] < 0) {
          this.pos[i * 3 + 1] = rest;
          // One bounce for the big ones, then lie.
          if (this.size[i] > 0.9 && Math.abs(this.vel[i * 3 + 1]) > 6) {
            this.vel[i * 3 + 1] *= -0.3;
            this.vel[i * 3] *= 0.5;
            this.vel[i * 3 + 2] *= 0.5;
          } else {
            this.state[i] = 2;
            this.timer[i] = 1.6 + this.rand() * 1.8;
          }
        }
      } else if (st === 2) {
        this.timer[i] -= dt;
        if (this.timer[i] <= 0) {
          this.state[i] = 3;
          this.timer[i] = 0.7;
        }
      } else {
        this.timer[i] -= dt;
        scale *= Math.max(0, this.timer[i] / 0.7);
        this.pos[i * 3 + 1] -= dt * 0.4;
        if (this.timer[i] <= 0) {
          this.state[i] = 0;
          this.live--;
          this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
          continue;
        }
      }
      this.a.set(this.axis[i * 3], this.axis[i * 3 + 1], this.axis[i * 3 + 2]);
      this.q.setFromAxisAngle(this.a, this.angle[i]);
      this.p.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.s.setScalar(scale);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hideAll(): void {
    this.state.fill(0);
    this.live = 0;
    this.mesh.visible = false;
  }
}

// ---- the coordinator -----------------------------------------------------------------

interface Charge {
  id: number;
  x: number;
  y: number;
  z: number;
  star: CrackStar;
  progress: number;
  seen: number;
}

interface Emitter {
  x: number;
  y: number;
  z: number;
  until: number;
  acc: number;
  rate: number;
  kind: 'grit' | 'dust';
  spread: number;
}

export class HammerFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly rubble: Rubble;
  private readonly pebbles: THREE.InstancedMesh;
  private readonly stars: CrackStar[] = [];
  private readonly fallStars: CrackStar[] = [];
  private readonly wall: THREE.Mesh;
  private readonly wallMat: THREE.ShaderMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly charges = new Map<number, Charge>();
  private readonly emitters: Emitter[] = [];
  private readonly pending: { at: number; run: () => void }[] = [];
  private readonly slabPlayed = new Map<string, number>();
  private readonly pitSealSeen = new Map<string, number>();
  private readonly kit = hammerGuardianKit();
  private wallBorn = -99;
  private seed = 0x51a3;
  private scanTimer = 0;
  private clock = 0;
  private disposed = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-hammer-fx';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.4;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
    );
    const chunk = chunkGeometry();
    this.geometries.push(chunk);
    this.rubble = new Rubble(
      this.root,
      Math.round(HAMMER_FX_POOLS.debris * (detail ? 1 : 0.5)),
      chunk,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
    );
    // The rubble's material is the shared surfaceMat cache's (never ours to
    // dispose); the pebbles share it.
    this.pebbles = new THREE.InstancedMesh(
      chunk,
      this.rubble.mesh.material as THREE.Material,
      HAMMER_FX_POOLS.pebbles,
    );
    this.pebbles.name = 'smithHeartWrathStones';
    this.pebbles.frustumCulled = false;
    this.pebbles.visible = false;
    this.pebbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < HAMMER_FX_POOLS.pebbles; i++)
      this.pebbles.setColorAt(i, STONE_TONES[(i * 3) % STONE_TONES.length]);
    this.root.add(this.pebbles);
    // The crack stars: two all-round (Mountain's Wrath), two forward fans
    // (Hammerfall), each its own material (one program).
    const wrathGeo = crackGeometry(crackLines(0x6a11, 14, 17));
    const fallGeo = crackGeometry(crackLines(0x2b07, 7, this.kit.range + 1.5, 0, this.kit.arcDeg));
    this.geometries.push(wrathGeo, fallGeo);
    for (let i = 0; i < HAMMER_FX_POOLS.crackStars * 2; i++) {
      const wrath = i < HAMMER_FX_POOLS.crackStars;
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartCracks',
        uniforms: {
          uGrow: { value: 0 },
          uHeat: { value: 0 },
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uCore: { value: new THREE.Color(...C.crackCore) },
          uEdge: { value: new THREE.Color(...C.crackEdge) },
          uDark: { value: new THREE.Color(...C.crackDark) },
        },
        vertexShader: CRACK_VERT,
        fragmentShader: CRACK_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(wrath ? wrathGeo : fallGeo, mat);
      mesh.name = wrath ? 'smithHeartWrathCracks' : 'smithHeartHammerfallCracks';
      mesh.visible = false;
      mesh.frustumCulled = false;
      // Over the sight field's fill (thin lines: the field and its safe
      // shadow still read through), under the wave and its curtain.
      mesh.renderOrder = floorVfxRenderOrder('encounter', 18);
      this.root.add(mesh);
      (wrath ? this.stars : this.fallStars).push({ mesh, mat, born: -99, kind: 'idle', owner: -1 });
    }
    // The dust wall riding the wave out.
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0);
    this.geometries.push(wallGeo);
    this.wallMat = new THREE.ShaderMaterial({
      name: 'smithHeartDustWall',
      uniforms: {
        uAlpha: { value: 0 },
        uTime: this.uTime,
        uDust: { value: new THREE.Color(...C.dust) },
        uDark: { value: new THREE.Color(...C.dustDark) },
      },
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(this.wallMat);
    this.wall = new THREE.Mesh(wallGeo, this.wallMat);
    this.wall.name = 'smithHeartDustWall';
    this.wall.visible = false;
    this.wall.frustumCulled = false;
    this.root.add(this.wall);
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 60): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  /** Never claims an event: the renderer's own draws (the cleave's swing,
   *  the engine's nova wave) still play under these layers. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed || ev.type !== 'spellfx') return false;
    if (ev.fx === 'nova' && ev.ability === MOUNTAINS_WRATH) {
      const e = this.world.entities.get(ev.sourceId);
      if (e) this.blast(e);
    } else if (ev.fx === 'windup' && ev.ability === ARC_CLEAVE_ABILITY) {
      const e = this.world.entities.get(ev.sourceId);
      if (e && e.templateId === HAMMER_GUARDIAN) this.hammerfall(e);
    }
    return false;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scan(world);
    }
    this.updateCharges(world, dt);
    this.updateStars();
    this.updateWall();
    this.updateEmitters(dt);
    this.rubble.update(dt);
    this.particles.update(this.clock);
  }

  // ---- the scan: the guardian's bar and the gates -------------------------------------

  private scan(world: IWorld): void {
    const now = sharedUniforms.uTime.value;
    for (const e of world.entities.values()) {
      // The Hammer Council: whoever holds the Wrath (the Guardian, or its
      // heir once it has fallen) gathers it the same way.
      if (councilRoleOf(e.templateId) !== null) {
        if (!e.dead && e.castingAbility === MOUNTAINS_WRATH && !this.charges.has(e.id))
          this.startCharge(e);
        continue;
      }
      if (e.dungeonId !== SMITH_HEART || e.kind !== 'object') continue;
      const state = dungeonGateStateOf(e.templateId);
      if (state === null) continue;
      const def = DUNGEONS[SMITH_HEART];
      if (!def) continue;
      const o = instanceOrigin(def.index, instanceSlotForZ(e.pos.z));
      const gate = dungeonGateAt(SMITH_HEART, e.pos.x - o.x, e.pos.z - o.z);
      if (!gate) continue;
      const key = gateMemoryKey(o.x, o.z, gate.id);
      const view = gateView(key, now);
      if (gate.id === 'the_slab') {
        const start = slabBreakDue(view, now, this.slabPlayed.get(key));
        if (start !== null) {
          this.slabPlayed.set(key, start);
          this.breakSlab(o.x + gate.x, o.z + gate.z, gate.rot, gate.hw, now - start);
        }
      } else if (gate.kind === 'stone_slab' && view.state === 'sealed' && view.changed) {
        const start = now - view.since;
        const seen = this.pitSealSeen.get(key);
        if (view.since < 1.5 && (seen === undefined || Math.abs(seen - start) > 0.05)) {
          this.pitSealSeen.set(key, start);
          this.slamShut(o.x + gate.x, o.z + gate.z, gate.rot, gate.hw);
        }
      }
    }
  }

  // ---- Mountain's Wrath ----------------------------------------------------------------

  private startCharge(e: Entity): void {
    const star = this.stars.find((s) => s.kind === 'idle') ?? this.stars[0];
    const y = this.groundY(e.pos.x, e.pos.z);
    star.kind = 'wrath';
    star.owner = e.id;
    star.born = this.clock;
    star.mesh.position.set(e.pos.x, y + 0.06, e.pos.z);
    star.mesh.rotation.y = fxHash(e.id, 3) * Math.PI * 2;
    star.mesh.visible = true;
    star.mat.uniforms.uGrow.value = 0;
    star.mat.uniforms.uAlpha.value = 0.8;
    this.charges.set(e.id, {
      id: e.id,
      x: e.pos.x,
      y,
      z: e.pos.z,
      star,
      progress: 0,
      seen: this.clock,
    });
    this.pebbles.visible = true;
  }

  private updateCharges(world: IWorld, dt: number): void {
    if (this.charges.size === 0) return;
    for (const c of this.charges.values()) {
      const e = world.entities.get(c.id);
      const casting = !!e && !e.dead && e.castingAbility === MOUNTAINS_WRATH;
      if (!casting) {
        // The bar ended without a blast seen (a death, a reset): let the
        // cracks cool where they are.
        this.charges.delete(c.id);
        if (c.star.kind === 'wrath') c.star.born = this.clock - 99;
        this.pebbles.visible = this.charges.size > 0;
        continue;
      }
      const total = e.castTotal > 0 ? e.castTotal : this.kit.castTime;
      c.progress = Math.max(c.progress, Math.min(1, 1 - e.castRemaining / total));
      const look = wrathChargeLook(c.progress);
      c.star.mat.uniforms.uGrow.value = look.grow;
      c.star.mat.uniforms.uHeat.value = look.heat;
      this.posePebbles(c, look.rise);
      // Dust drawn in along the floor, grit shaken down round the pit.
      if (this.rand() < dt * 30 * look.gather * this.density) {
        const a = this.rand() * Math.PI * 2;
        const r = 7 + this.rand() * 12;
        this.particles.puff(c.x + Math.sin(a) * r, c.y + 0.3, c.z + Math.cos(a) * r, 2, {
          speed: 3 + look.gather * 5,
          life: 1.1,
          size: [1.4, 3.2],
          color: C.dust,
          alpha: 0.32,
          dir: [-Math.sin(a), 0.15, -Math.cos(a)],
          spread: 0.25,
          drag: 0.6,
        });
      }
      if (this.rand() < dt * 10 * look.heat * this.density) {
        const a = this.rand() * Math.PI * 2;
        const r = 3 + this.rand() * 12;
        this.particles.puff(c.x + Math.sin(a) * r, c.y + 0.2, c.z + Math.cos(a) * r, 2, {
          speed: 1.2,
          up: 2.5,
          life: 0.8,
          size: [0.3, 0.1],
          color: C.flash,
          alpha: 0.8,
          pool: 'glow',
        });
      }
    }
  }

  /** The loose stones round a casting guardian, hanging in the air. */
  private posePebbles(c: Charge, rise: number): void {
    const n = Math.round(HAMMER_FX_POOLS.pebbles * (this.density > 0.5 ? 1 : 0.5));
    for (let i = 0; i < HAMMER_FX_POOLS.pebbles; i++) {
      if (i >= n) {
        this.pebbles.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      const a = fxHash(i, 61) * Math.PI * 2 + this.clock * (0.12 + fxHash(i, 5) * 0.2);
      const r = 4 + fxHash(i, 67) * 13;
      const h = rise * (0.4 + fxHash(i, 71) * 2.6) + Math.sin(this.clock * 2.3 + i) * 0.12 * rise;
      const size = 0.25 + fxHash(i, 73) * 0.5;
      this.v.set(c.x + Math.sin(a) * r, c.y + h + size * 0.3, c.z + Math.cos(a) * r);
      this.q.setFromAxisAngle(
        this.s.set(0.3, 1, 0.2).normalize(),
        this.clock * (0.5 + fxHash(i, 79)),
      );
      this.s.setScalar(size * Math.min(1, rise * 3));
      this.pebbles.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
    }
    this.pebbles.instanceMatrix.needsUpdate = true;
  }

  private blast(e: Entity): void {
    const c = this.charges.get(e.id);
    const x = e.pos.x;
    const z = e.pos.z;
    const y = c?.y ?? this.groundY(x, z);
    const R = this.kit.radius;
    // The floating stones flung outward, then hidden.
    if (c) {
      for (let i = 0; i < HAMMER_FX_POOLS.pebbles * this.density; i++) {
        const a = fxHash(i, 61) * Math.PI * 2 + this.clock * (0.12 + fxHash(i, 5) * 0.2);
        const r = 4 + fxHash(i, 67) * 13;
        const sp = 12 + this.rand() * 10;
        this.rubble.throw(
          x + Math.sin(a) * r,
          y + 1 + fxHash(i, 71) * 2,
          z + Math.cos(a) * r,
          Math.sin(a) * sp,
          4 + this.rand() * 7,
          Math.cos(a) * sp,
          0.3 + fxHash(i, 73) * 0.5,
        );
      }
      this.charges.delete(e.id);
      this.pebbles.visible = this.charges.size > 0;
      c.star.born = this.clock;
      c.star.mat.uniforms.uGrow.value = 1;
      c.star.mat.uniforms.uAlpha.value = 1;
    }
    // Rubble from the guardian's feet.
    const n = Math.round(46 * this.density * (this.reducedMotion() ? 0.4 : 1));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = 8 + this.rand() * 18;
      this.rubble.throw(
        x + Math.sin(a) * 2,
        y + 0.8,
        z + Math.cos(a) * 2,
        Math.sin(a) * sp,
        6 + this.rand() * 12,
        Math.cos(a) * sp,
        0.35 + this.rand() * 0.9,
      );
    }
    // The dust wall riding the wave, the rings, the flash and the billow.
    this.wallBorn = this.clock;
    this.wall.position.set(x, y - 0.3, z);
    this.wall.visible = true;
    this.particles.shockRing(x, z, C.ring, R, 0.55);
    this.particles.shockRing(x, z, C.ringDust, R * 0.6, 0.9);
    this.particles.puff(x, y + 2.5, z, 18, {
      speed: 6,
      up: 1.5,
      life: 0.5,
      size: [3.5, 8],
      color: C.flash,
      alpha: 0.65,
      pool: 'glow',
    });
    this.particles.puff(x, y + 0.6, z, 30, {
      speed: 9,
      up: 3,
      life: 2.6,
      size: [3, 9],
      color: C.dust,
      alpha: 0.5,
      drag: 1.6,
      radius: 3,
    });
    // Grit shaken loose off the terraces round the pit, for a few seconds.
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + this.rand() * 0.6;
      this.emitters.push({
        x: x + Math.sin(a) * (R * 0.95),
        y: y + 18 + this.rand() * 14,
        z: z + Math.cos(a) * (R * 0.85),
        until: this.clock + 2.6,
        acc: 0,
        rate: 14,
        kind: 'grit',
        spread: 5,
      });
    }
    this.shakeNear(x, z, 0.85, R + 20);
  }

  private updateWall(): void {
    if (!this.wall.visible) return;
    const look = wrathBlastLook(this.clock - this.wallBorn, this.kit.radius);
    if (look.alpha <= 0) {
      this.wall.visible = false;
      return;
    }
    const r = Math.max(0.5, look.front);
    this.wall.scale.set(r, look.height, r);
    this.wallMat.uniforms.uAlpha.value = look.alpha * (this.density > 0.5 ? 1 : 0.7);
  }

  private updateStars(): void {
    for (const star of this.stars) this.updateStar(star);
    for (const star of this.fallStars) this.updateStar(star);
  }

  private updateStar(star: CrackStar): void {
    if (star.kind === 'idle') return;
    const age = this.clock - star.born;
    if (star.kind === 'wrath') {
      // While charging the charge drives it; after the blast it smoulders.
      if (this.charges.get(star.owner)?.star === star) return;
      const heat = wrathBlastLook(age, this.kit.radius).heat;
      star.mat.uniforms.uHeat.value = heat;
      star.mat.uniforms.uAlpha.value = Math.min(1, Math.max(0, 1 - (age - WRATH_AFTERGLOW) / 1.2));
      if (age > WRATH_AFTERGLOW + 1.2) {
        star.kind = 'idle';
        star.mesh.visible = false;
      }
      return;
    }
    star.mat.uniforms.uGrow.value = Math.min(1, age / 0.18);
    star.mat.uniforms.uHeat.value = hammerfallHeat(age);
    star.mat.uniforms.uAlpha.value = Math.min(1, Math.max(0, 1 - (age - 1.6) / 1.0));
    if (age > 2.6) {
      star.kind = 'idle';
      star.mesh.visible = false;
    }
  }

  // ---- Hammerfall ----------------------------------------------------------------------

  private hammerfall(e: Entity): void {
    const star = this.fallStars.find((s) => s.kind === 'idle') ?? this.fallStars[0];
    const x = e.pos.x;
    const z = e.pos.z;
    const y = this.groundY(x, z);
    star.kind = 'fall';
    star.owner = e.id;
    star.born = this.clock;
    star.mesh.position.set(x, y + 0.07, z);
    // The fan is built round +z: turn it to the guardian's facing.
    star.mesh.rotation.y = e.facing;
    star.mesh.visible = true;
    const half = (this.kit.arcDeg * Math.PI) / 360;
    const n = Math.round(16 * this.density);
    for (let i = 0; i < n; i++) {
      const a = e.facing + (this.rand() - 0.5) * 2 * half;
      const r = 2 + this.rand() * this.kit.range;
      const sp = 4 + this.rand() * 8;
      this.rubble.throw(
        x + Math.sin(a) * r,
        y + 0.4,
        z + Math.cos(a) * r,
        Math.sin(a) * sp,
        5 + this.rand() * 7,
        Math.cos(a) * sp,
        0.25 + this.rand() * 0.55,
      );
    }
    for (let k = 0; k < 4; k++) {
      const a = e.facing + (k / 3 - 0.5) * 2 * half * 0.8;
      const r = this.kit.range * 0.6;
      this.particles.puff(x + Math.sin(a) * r, y + 0.5, z + Math.cos(a) * r, 6, {
        speed: 4,
        up: 1.5,
        life: 1.6,
        size: [1.6, 4.4],
        color: C.dust,
        alpha: 0.45,
        dir: [Math.sin(a), 0.4, Math.cos(a)],
        spread: 0.6,
      });
    }
    this.particles.shockRing(
      x + Math.sin(e.facing) * 3,
      z + Math.cos(e.facing) * 3,
      C.ringDust,
      this.kit.range,
      0.35,
    );
    this.shakeNear(x, z, 0.35, 30);
  }

  // ---- the Slab ------------------------------------------------------------------------

  /** The Slab bursting (`late` seconds into its opening when first seen). */
  private breakSlab(x: number, z: number, rot: number, hw: number, late: number): void {
    const y = this.groundY(x, z);
    const ux = Math.cos(rot);
    const uz = -Math.sin(rot);
    const fx = Math.sin(rot);
    const fz = Math.cos(rot);
    const at = this.clock - late;
    // The flash along the split, then the burst (both ways along the stair).
    this.emitters.push({
      x,
      y: y + 4.5,
      z,
      until: at + SLAB_BURST_AT,
      acc: 0,
      rate: 60,
      kind: 'dust',
      spread: 0.3,
    });
    const burst = () => {
      const n = Math.round(70 * this.density * (this.reducedMotion() ? 0.5 : 1));
      for (let i = 0; i < n; i++) {
        const across = (this.rand() - 0.5) * hw * 1.6;
        const h = this.rand() * 8.5;
        const side = this.rand() < 0.5 ? -1 : 1;
        const sp = 3 + this.rand() * 7;
        this.rubble.throw(
          x + ux * across,
          y + h,
          z + uz * across,
          fx * side * sp + ux * (this.rand() - 0.5) * 5,
          2 + this.rand() * 6,
          fz * side * sp + uz * (this.rand() - 0.5) * 5,
          0.3 + this.rand() * 0.9,
        );
      }
      for (const side of [-1, 1]) {
        this.particles.puff(x + fx * side * 2, y + 3, z + fz * side * 2, 26, {
          speed: 7,
          up: 2,
          life: 3,
          size: [3, 9],
          color: C.dust,
          alpha: 0.55,
          dir: [fx * side, 0.25, fz * side],
          spread: 0.8,
          drag: 1.4,
          radius: hw * 0.6,
        });
      }
      this.particles.puff(x, y + 4.5, z, 20, {
        speed: 5,
        life: 0.6,
        size: [4, 10],
        color: C.flash,
        alpha: 0.7,
        pool: 'glow',
      });
      this.particles.shockRing(x, z, C.ring, 18, 0.6);
      this.particles.shockRing(x, z, C.ringDust, 11, 1.0);
      // Grit pouring off the lintel and the jambs while the halves part.
      for (const s of [-1, 0, 1]) {
        this.emitters.push({
          x: x + ux * s * (hw + 1.6) + fx * 2,
          y: y + 15,
          z: z + uz * s * (hw + 1.6) + fz * 2,
          until: this.clock + 3.6,
          acc: 0,
          rate: s === 0 ? 34 : 16,
          kind: 'grit',
          spread: s === 0 ? hw * 0.8 : 1.2,
        });
      }
      this.shakeNear(x, z, 0.9, 70);
    };
    if (late >= SLAB_BURST_AT) burst();
    else this.pending.push({ at: at + SLAB_BURST_AT, run: burst });
  }

  /** The Pit Mouth slamming shut behind the raid: a dust skirt along its foot. */
  private slamShut(x: number, z: number, rot: number, hw: number): void {
    const y = this.groundY(x, z);
    const ux = Math.cos(rot);
    const uz = -Math.sin(rot);
    for (let k = -2; k <= 2; k++) {
      this.particles.puff(x + ux * k * hw * 0.45, y + 0.4, z + uz * k * hw * 0.45, 5, {
        speed: 3,
        up: 1,
        life: 1.8,
        size: [1.6, 4],
        color: C.dust,
        alpha: 0.45,
      });
    }
    this.shakeNear(x, z, 0.3, 40);
  }

  private updateEmitters(dt: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.clock >= this.pending[i].at) {
        const p = this.pending[i];
        this.pending.splice(i, 1);
        p.run();
      }
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const em = this.emitters[i];
      if (this.clock > em.until) {
        this.emitters.splice(i, 1);
        continue;
      }
      em.acc += dt * em.rate * this.density;
      while (em.acc >= 1) {
        em.acc -= 1;
        const ox = (this.rand() - 0.5) * 2 * em.spread;
        const oz = (this.rand() - 0.5) * 2 * em.spread;
        if (em.kind === 'grit') {
          // A thin stream of grit and fine dust falling.
          this.particles.puff(em.x + ox, em.y, em.z + oz, 1, {
            speed: 0.4,
            life: 2.2,
            size: [0.5, 1.6],
            color: C.dust,
            alpha: 0.42,
            gravity: 6,
            drag: 0.4,
          });
        } else {
          this.particles.puff(em.x + ox, em.y + (this.rand() - 0.5) * 8, em.z + oz, 1, {
            speed: 0.6,
            life: 0.4,
            size: [0.8, 0.3],
            color: C.flash,
            alpha: 0.9,
            pool: 'glow',
          });
        }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.rubble.mesh.dispose();
    this.pebbles.dispose();
  }
}

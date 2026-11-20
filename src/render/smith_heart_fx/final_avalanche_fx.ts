// Avalanche's eruption (Elemental Fusion of the Quench and the Hammer), a part
// of FinalElementsFx (final_elements_fx.ts keeps the lane's floor telegraph
// and lends its host). Jose's playtest of 2026-11-20 read the old plain cones
// as "not very AAA"; the plan is final_avalanche_core.ts:
//   - real spike shapes: faceted ice crystals with shards at their feet and
//     broken stone blades, every spike its own height, girth, lean and turn;
//   - the eruption: each bursts up through the floor as the sim's front
//     passes (an overshoot), throws chunks and frost, shivers, then cracks,
//     topples a little, sinks and crumbles away, shedding chunks and dust;
//   - the floor torn open along the lane behind the front, frost glowing in
//     its cracks, fading once the last spike is gone;
//   - the lane is kept after the sim's object goes, so its last spikes
//     crumble instead of vanishing.
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (the kit's one gated attach); fixed pools;
// no light; no per-frame allocation; the scar on the kit's crust rung, the
// solids at the bodies' order.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  avalancheHash,
  avalancheLife,
  avalancheSpike,
  AVALANCHE_BEATS as B,
  debrisAt,
  AVALANCHE_POOLS as P,
  scarLook,
  spikeEruption,
} from './final_avalanche_core';
import { SCAR_FRAG, SCAR_VERT, SPIKE_FRAG } from './final_avalanche_glsl';
import { SOLID_VERT } from './final_elements_glsl';

/** What FinalElementsFx lends the eruption. */
export interface FinalAvalancheHost {
  root: THREE.Group;
  uTime: { value: number };
  particles: EngineParticles;
  groundY: (x: number, z: number) => number;
  rand: () => number;
  density: number;
  reducedMotion: () => boolean;
  shake: (x: number, z: number, amount: number, reach?: number) => void;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /** The lava crust's floor rung (under the fans' glows, over the floor). */
  crustRung: number;
  /** The standing bodies' draw order (past every floor rung). */
  bodyOrder: number;
}

interface Uni {
  [k: string]: THREE.IUniform;
}

interface Lane {
  id: number;
  sx: number;
  sz: number;
  facing: number;
  length: number;
  half: number;
  run: number;
  /** The painter clock the run began at. */
  runAt: number;
  seen: boolean;
  /** Spikes whose burst / crumble moment has been played (bit k). */
  burst: number;
  crumbled: number;
  scar: { mesh: THREE.Mesh; u: Uni };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _d = { x: 0, y: 0, z: 0, spin: 0, size: 0 };

/** Hardening Frost's crystals round its ring (and how many rings at once). */
const RIME_SHARDS = 14;
const RIME_RINGS = 3;

const ICE_COLORS = [0x8fd0ff, 0xa8dcff, 0x7cc4f4, 0xbfe6ff] as const;
const STONE_COLORS = [0x6b5a48, 0x5d5246, 0x77695a] as const;
const FROST_RGB = [0.78, 0.92, 1] as const;
const DUST_RGB = [0.62, 0.6, 0.58] as const;

export class FinalAvalancheFx {
  private readonly lanes: Lane[] = [];
  private readonly ice: THREE.InstancedMesh;
  private readonly stone: THREE.InstancedMesh;
  private readonly chunks: THREE.InstancedMesh;
  private iceUsed = 0;
  private stoneUsed = 0;
  private chunkUsed = 0;
  private clock = 0;

  constructor(private readonly h: FinalAvalancheHost) {
    const solid = (name: string, ice: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime: h.uTime, uIce: { value: ice } },
        vertexShader: SOLID_VERT,
        fragmentShader: SPIKE_FRAG,
      });
      h.materials.push(m);
      return m;
    };
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = h.bodyOrder;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) {
        m.setMatrixAt(i, ZERO);
        m.setColorAt(i, _c.setRGB(1, 1, 1));
      }
      m.visible = false;
      h.root.add(m);
      return m;
    };
    const iceGeo = iceSpikeGeometry();
    const stoneGeo = stoneSpikeGeometry();
    const chunkGeo = new THREE.DodecahedronGeometry(1, 0).toNonIndexed();
    chunkGeo.computeVertexNormals();
    h.geometries.push(iceGeo, stoneGeo, chunkGeo);
    const spikes = P.lanes * P.spikesPerLane;
    this.ice = instanced(
      iceGeo,
      solid('smithHeartAvalancheIce', 1),
      spikes + RIME_SHARDS * RIME_RINGS,
      'smithHeartAvalancheIce',
    );
    this.stone = instanced(
      stoneGeo,
      solid('smithHeartAvalancheStone', 0),
      spikes,
      'smithHeartAvalancheStone',
    );
    this.chunks = instanced(
      chunkGeo,
      solid('smithHeartAvalancheChunks', 0),
      spikes * P.chunksPerSpike,
      'smithHeartAvalancheChunks',
    );
    // The scars: one flat strip a lane (uv x across, y along).
    const strip = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    h.geometries.push(strip);
    for (let i = 0; i < P.lanes; i++) {
      const u: Uni = {
        uFront: { value: 0 },
        uAlpha: { value: 0 },
        uGlow: { value: 1 },
        uSeed: { value: i * 3.7 },
        uLength: { value: 40 },
      };
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartAvalancheScar',
        uniforms: u,
        vertexShader: SCAR_VERT,
        fragmentShader: SCAR_FRAG,
        transparent: true,
        depthWrite: false,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(strip, mat);
      mesh.name = 'smithHeartAvalancheScar';
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', h.crustRung);
      h.root.add(mesh);
      this.lanes.push({
        id: -1,
        sx: 0,
        sz: 0,
        facing: 0,
        length: 0,
        half: 0,
        run: 1,
        runAt: 0,
        seen: false,
        burst: 0,
        crumbled: 0,
        scar: { mesh, u },
      });
    }
  }

  begin(clock: number): void {
    this.clock = clock;
    this.iceUsed = 0;
    this.stoneUsed = 0;
    this.chunkUsed = 0;
    for (const l of this.lanes) l.seen = false;
  }

  /** Hardening Frost's ring this frame (Jose's playtest of 2026-11-20: the
   *  freeze must be seen coming): ice crystals pushing up all round its edge,
   *  taller and leaning further in as it closes (`fill` 0..1), frost mist
   *  creeping inward over the floor. */
  rime(x: number, z: number, r: number, fill: number, seed: number): void {
    const H = this.h;
    const f = fill < 0 ? 0 : fill > 1 ? 1 : fill;
    for (let k = 0; k < RIME_SHARDS; k++) {
      const i = this.iceUsed;
      if (i >= this.ice.count) break;
      const hk = (j: number) => avalancheHash(seed * 5 + k, j);
      const a = ((k + 0.5 * hk(1)) / RIME_SHARDS) * Math.PI * 2;
      const rr = r * (0.98 - 0.12 * hk(2));
      const px = x + Math.cos(a) * rr;
      const pz = z + Math.sin(a) * rr;
      // Out of the floor first, then tall and leaning in over the ring.
      const grow = Math.min(1, f * 1.6);
      const hgt = (0.4 + 2.2 * f * f) * (0.75 + 0.5 * hk(3)) * grow;
      if (hgt < 0.02) continue;
      this.iceUsed++;
      _q.setFromAxisAngle(_up, hk(4) * Math.PI * 2);
      // Leaning toward the centre: tilt about the tangent.
      _q2.setFromAxisAngle(_ax.set(-Math.sin(a), 0, Math.cos(a)), 0.3 + 0.55 * f);
      _q.premultiply(_q2);
      const w = (0.28 + 0.16 * hk(5)) * (0.6 + 0.4 * grow);
      _m.compose(_v.set(px, H.groundY(px, pz) - 0.1, pz), _q, _s.set(w, hgt, w));
      this.ice.setMatrixAt(i, _m);
      this.ice.setColorAt(i, _c.setHex(ICE_COLORS[k % ICE_COLORS.length]));
    }
    // The cold creeping in: mist off the edge drifting toward the middle.
    if (H.rand() < (0.4 + f) * H.density) {
      const a = H.rand() * Math.PI * 2;
      H.particles.puff(x + Math.cos(a) * r, H.groundY(x, z) + 0.25, z + Math.sin(a) * r, 1, {
        speed: 0.8 + 1.6 * f,
        up: 0.2,
        life: 1,
        size: [1.1, 2.2],
        color: [0.82, 0.92, 1],
        alpha: 0.35 + 0.25 * f,
        radius: 0.3,
        drag: 0.6,
      });
    }
  }

  /** Hardening Frost closes: the crystals shatter in over the ring. */
  rimeClose(x: number, z: number, r: number): void {
    const F = this.h.particles;
    const y = this.h.groundY(x, z);
    F.puff(x, y + 0.8, z, Math.round(26 * this.h.density) + 6, {
      speed: 5,
      up: 4,
      life: 0.8,
      size: [0.5, 0.12],
      color: FROST_RGB,
      alpha: 1,
      pool: 'glow',
      gravity: 12,
      radius: r * 0.8,
    });
    F.puff(x, y + 0.4, z, Math.round(6 * this.h.density) + 2, {
      speed: 1.2,
      up: 0.6,
      life: 1.4,
      size: [1.6, 3],
      color: [0.86, 0.94, 1],
      alpha: 0.5,
      radius: r * 0.7,
    });
    F.shockRing(x, z, 0xbfe6ff, r * 1.15, 0.45);
    this.h.shake(x, z, 0.25, 30);
  }

  /** A running Avalanche lane this frame (`sinceRun` seconds into its run;
   *  (sx, sz) its rim end; `run` the sim's run time). */
  see(
    id: number,
    sx: number,
    sz: number,
    facing: number,
    length: number,
    half: number,
    run: number,
    sinceRun: number,
  ): void {
    let l = this.lanes.find((k) => k.id === id);
    if (!l) {
      // A free slot, else the oldest.
      l = this.lanes.find((k) => k.id === -1);
      if (!l) {
        l = this.lanes[0];
        for (const k of this.lanes) if (k.runAt < l.runAt) l = k;
      }
      l.id = id;
      l.burst = 0;
      l.crumbled = 0;
      l.runAt = this.clock - sinceRun;
    }
    l.seen = true;
    l.sx = sx;
    l.sz = sz;
    l.facing = facing;
    l.length = length;
    l.half = half;
    l.run = run;
  }

  /** Draw every lane (seen this frame, or crumbling on after its object
   *  went); free the ones past their life. */
  end(): void {
    for (const l of this.lanes) {
      if (l.id === -1) continue;
      const since = this.clock - l.runAt;
      if (since > avalancheLife(l.run) || (since < 0 && !l.seen)) {
        l.id = -1;
        l.scar.mesh.visible = false;
        continue;
      }
      this.paintLane(l, since);
    }
    flush(this.ice, this.iceUsed);
    flush(this.stone, this.stoneUsed);
    flush(this.chunks, this.chunkUsed);
  }

  private paintLane(l: Lane, since: number): void {
    const H = this.h;
    const dx = Math.sin(l.facing);
    const dz = Math.cos(l.facing);
    // The scar, torn behind the front.
    const sc = scarLook(since, l.run);
    const midX = l.sx + dx * l.length * 0.5;
    const midZ = l.sz + dz * l.length * 0.5;
    const scar = l.scar;
    scar.mesh.position.set(midX, H.groundY(midX, midZ) + 0.07, midZ);
    scar.mesh.rotation.set(0, l.facing, 0);
    scar.mesh.scale.set(l.half * 2.5, 1, l.length);
    scar.u.uFront.value = sc.front;
    scar.u.uAlpha.value = sc.alpha;
    scar.u.uGlow.value = sc.glow;
    scar.u.uLength.value = l.length;
    scar.mesh.visible = sc.alpha > 0.01;
    const speed = l.length / Math.max(0.05, l.run);
    const seed = l.id;
    for (let k = 0; k < P.spikesPerLane; k++) {
      const sp = avalancheSpike(seed, k, l.length, l.half);
      const t = since - sp.along / speed;
      const px = l.sx + dx * sp.along + dz * sp.side;
      const pz = l.sz + dz * sp.along - dx * sp.side;
      const gy = H.groundY(px, pz);
      // Its moments (each played once).
      const bit = 1 << k;
      if (t >= 0 && !(l.burst & bit)) {
        l.burst |= bit;
        this.burstAt(px, gy, pz, sp.ice, sp.height);
      }
      if (t >= B.hold && !(l.crumbled & bit)) {
        l.crumbled |= bit;
        this.crumbleAt(px, gy, pz, sp.ice, sp.height);
      }
      // The chunks: thrown on the burst, shed on the crumble.
      for (let c = 0; c < P.chunksPerSpike; c++) {
        const kind: 0 | 1 = c === P.chunksPerSpike - 1 ? 1 : 0;
        const tt = kind === 0 ? t : t - B.hold;
        if (!debrisAt(seed * 17 + k, c, kind, tt, sp.height, _d)) continue;
        const i = this.chunkUsed++;
        if (i >= this.chunks.count) break;
        const ice = sp.ice && avalancheHash(seed + k, c) < 0.6;
        _q.setFromAxisAngle(_ax.set(0.6, 0.7, 0.3).normalize(), _d.spin + c);
        _m.compose(
          _v.set(px + _d.x, gy + _d.y, pz + _d.z),
          _q,
          _s.set(_d.size, _d.size * 0.8, _d.size * 1.1),
        );
        this.chunks.setMatrixAt(i, _m);
        this.chunks.setColorAt(i, _c.setHex(ice ? 0xcfeaff : STONE_COLORS[c % 3]));
      }
      const e = spikeEruption(t);
      if (!e.shown) continue;
      const mesh = sp.ice ? this.ice : this.stone;
      const i = sp.ice ? this.iceUsed++ : this.stoneUsed++;
      if (i >= mesh.count) continue;
      // Its own turn, then leaning along the run and out to its side,
      // toppling further as it crumbles.
      const leanDir = l.facing + sp.leanDir;
      const tilt = sp.lean + e.topple;
      _q.setFromAxisAngle(_up, sp.yaw);
      _q2.setFromAxisAngle(_ax.set(Math.cos(leanDir), 0, -Math.sin(leanDir)), tilt);
      _q.premultiply(_q2);
      const hgt = sp.height * e.rise;
      const w = sp.girth * 0.55 * e.swell;
      const shiver =
        t > B.burst && t < B.hold && !H.reducedMotion() ? Math.sin(t * 60 + k) * 0.03 : 0;
      _m.compose(_v.set(px + shiver, gy - 0.25 - sp.height * e.sink, pz), _q, _s.set(w, hgt, w));
      mesh.setMatrixAt(i, _m);
      const cols = sp.ice ? ICE_COLORS : STONE_COLORS;
      mesh.setColorAt(i, _c.setHex(cols[k % cols.length]));
    }
  }

  /** A spike breaks the floor: shards and frost thrown, a ring of grit. */
  private burstAt(x: number, y: number, z: number, ice: boolean, height: number): void {
    const F = this.h.particles;
    const n = Math.round(6 * this.h.density) + 2;
    F.puff(x, y + 0.4, z, n, {
      speed: 4.5,
      up: 7,
      life: 0.8,
      size: [0.45, 0.12],
      color: ice ? FROST_RGB : DUST_RGB,
      alpha: 1,
      pool: ice ? 'glow' : undefined,
      gravity: 18,
    });
    F.puff(x, y + 0.3, z, Math.round(3 * this.h.density) + 1, {
      speed: 2.4,
      up: 1.2,
      life: 1.2,
      size: [1.4, 2.8],
      color: [0.7, 0.74, 0.78],
      alpha: 0.45,
      radius: 0.8,
    });
    F.shockRing(x, z, ice ? 0xbfe6ff : 0xc8b090, 1.6 + height * 0.25, 0.3);
  }

  /** A spike cracks and gives way: frost dust down its length. */
  private crumbleAt(x: number, y: number, z: number, ice: boolean, height: number): void {
    const F = this.h.particles;
    F.puff(x, y + height * 0.5, z, Math.round(4 * this.h.density) + 1, {
      speed: 1.2,
      up: -0.5,
      life: 1.1,
      size: [0.9, 2],
      color: ice ? [0.85, 0.93, 1] : [0.6, 0.57, 0.53],
      alpha: 0.5,
      radius: 0.6,
    });
    F.puff(x, y + height * 0.6, z, Math.round(4 * this.h.density) + 1, {
      speed: 1.8,
      up: 1,
      life: 0.7,
      size: [0.3, 0.1],
      color: ice ? FROST_RGB : DUST_RGB,
      alpha: 1,
      pool: ice ? 'glow' : undefined,
      gravity: 14,
    });
  }

  hide(): void {
    for (const l of this.lanes) {
      l.id = -1;
      l.scar.mesh.visible = false;
    }
    flush(this.ice, 0);
    flush(this.stone, 0);
    flush(this.chunks, 0);
  }

  dispose(): void {
    this.ice.dispose();
    this.stone.dispose();
    this.chunks.dispose();
  }
}

function flush(m: THREE.InstancedMesh, used: number): void {
  const was = (m.userData.used as number | undefined) ?? 0;
  for (let i = used; i < was; i++) m.setMatrixAt(i, ZERO);
  m.userData.used = used;
  if (used > 0 || was > 0) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  m.visible = used > 0;
}

// ---- the shapes ---------------------------------------------------------------------

/** A faceted prism from rings (each [height, radius scale]) round `sides`,
 *  every ring's corners pushed in and out by `jag`, closed by an apex at
 *  (ax, ay, az) or a flat broken cap; appended to `out` as flat triangles. */
function prism(
  out: number[],
  sides: number,
  rings: readonly (readonly [number, number])[],
  jag: number,
  seed: number,
  apex: readonly [number, number, number] | null,
  place: (p: [number, number, number]) => [number, number, number],
): void {
  const pts: [number, number, number][][] = rings.map(([y, r], j) => {
    const ring: [number, number, number][] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + (avalancheHash(seed, i) - 0.5) * 0.5;
      const rr = r * (1 + (avalancheHash(seed + j * 7, i + 3) - 0.5) * 2 * jag);
      // A broken top: the last ring's corners at their own heights.
      const yy =
        apex === null && j === rings.length - 1
          ? y * (0.82 + 0.18 * avalancheHash(seed, i + 9))
          : y;
      ring.push(place([Math.cos(a) * rr, yy, Math.sin(a) * rr]));
    }
    return ring;
  });
  const tri = (a: number[], b: number[], c: number[]) => out.push(...a, ...b, ...c);
  for (let j = 0; j + 1 < pts.length; j++)
    for (let i = 0; i < sides; i++) {
      const a = pts[j][i];
      const b = pts[j][(i + 1) % sides];
      const c = pts[j + 1][(i + 1) % sides];
      const d = pts[j + 1][i];
      tri(a, c, b);
      tri(a, d, c);
    }
  const top = pts[pts.length - 1];
  if (apex) {
    const p = place([apex[0], apex[1], apex[2]]);
    for (let i = 0; i < sides; i++) tri(top[i], p, top[(i + 1) % sides]);
  } else {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const q of top) {
      cx += q[0] / sides;
      cy += q[1] / sides;
      cz += q[2] / sides;
    }
    for (let i = 0; i < sides; i++) tri(top[i], [cx, cy, cz], top[(i + 1) % sides]);
  }
}

function toGeometry(pos: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Shift and tilt a shard's local point onto its spot at the main crystal's
 *  foot. */
function shard(
  dx: number,
  dz: number,
  tilt: number,
  scale: number,
): (p: [number, number, number]) => [number, number, number] {
  const ang = Math.atan2(dz, dx);
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return ([x, y, z]) => {
    // Tilt outward (in the plane of its bearing), then scale and place.
    const along = x * Math.cos(ang) + z * Math.sin(ang);
    const across = -x * Math.sin(ang) + z * Math.cos(ang);
    const a2 = along * c + y * s;
    const y2 = -along * s + y * c;
    return [
      dx + (a2 * Math.cos(ang) - across * Math.sin(ang)) * scale,
      y2 * scale,
      dz + (a2 * Math.sin(ang) + across * Math.cos(ang)) * scale,
    ];
  };
}

/** An ice crystal: a tall six-sided blade to a skewed point, its facets
 *  uneven, and three smaller shards splayed round its foot. Foot at y 0,
 *  tip at y 1, base radius about 1. */
export function iceSpikeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const id = (p: [number, number, number]) => p;
  prism(
    pos,
    6,
    [
      [-0.05, 1],
      [0.12, 0.95],
      [0.5, 0.7],
      [0.78, 0.42],
    ],
    0.18,
    11,
    [0.12, 1, 0.06],
    id,
  );
  const shards: [number, number, number, number][] = [
    [0.85, 0.2, 0.55, 0.42],
    [-0.55, 0.7, 0.7, 0.32],
    [-0.4, -0.85, 0.6, 0.36],
  ];
  for (let k = 0; k < shards.length; k++) {
    const [dx, dz, tilt, sc] = shards[k];
    prism(
      pos,
      5,
      [
        [-0.1, 0.55],
        [0.45, 0.4],
      ],
      0.22,
      40 + k * 5,
      [0.05, 1, 0],
      shard(dx, dz, tilt, sc),
    );
  }
  return toGeometry(pos);
}

/** A stone blade: a broad five-sided slab tapering to a broken, slanted top,
 *  a fallen chunk leaning on its foot. */
export function stoneSpikeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const id = (p: [number, number, number]) => p;
  prism(
    pos,
    5,
    [
      [-0.05, 1],
      [0.3, 0.85],
      [0.7, 0.55],
      [1, 0.38],
    ],
    0.3,
    23,
    null,
    id,
  );
  prism(
    pos,
    5,
    [
      [-0.1, 0.5],
      [0.25, 0.42],
      [0.42, 0.25],
    ],
    0.35,
    71,
    null,
    shard(0.9, -0.3, 0.9, 0.7),
  );
  return toGeometry(pos);
}

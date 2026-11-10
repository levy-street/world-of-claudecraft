// The Seam Singer's crystal in the Hammer Council's entrance (plan:
// council_entrance_core.ts), a part of CouncilEntranceFx (council_entrance_
// fx.ts, which owns the root, the particles and the clock and paints it each
// frame):
//  - asleep: a vein of amber crystal broken up out of the floor, her body
//    curled inside its great cocoon (seen through it, dim), the crystal
//    glowing faintly;
//  - the song: the vein rings like a rising note, its light pulsing faster
//    and brighter, rings of resonance pulsing off it quicker and quicker,
//    the cocoon trembling, glints rising;
//  - the shatter: the vein bursts into shards that fly, fall, glint and
//    fade; a burst of light on her (the host's flash card);
//  - her shards: crystals gathered round her, orbiting as she floats out,
//    flung out with the wave of light on her high note;
//  - the note: a curtain of amber light racing out from her across the
//    quarry (the host flares every crystal in the room as it passes).
// The cocoon, the prisms and her orbiting shards draw on every tier (they
// are her vein, not a particle); the low tier thins the burst's shards and
// the glints.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (one gated attach); fixed pools, no
// light, no per-frame allocation.

import * as THREE from 'three';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  COUNCIL_ENTRANCE,
  COUNCIL_ENTRANCE_POOLS,
  COUNCIL_VEIN,
  type CouncilEntranceLook,
  CRYSTAL_SHARDS,
  councilEntranceLight,
  councilEntrancePicks,
  newFlyingStone,
  ORBIT_SHARDS,
  orbitShardAt,
  shardAt,
  VEIN_PRISMS,
  VEIN_RINGS,
} from './council_entrance_core';
import {
  CRYSTAL_FRAG,
  CRYSTAL_VERT,
  GLOW_FRAG,
  GLOW_VERT,
  LIGHT_WALL_FRAG,
  RING_FRAG,
  RING_VERT,
  WALL_VERT,
} from './council_entrance_glsl';

const E = COUNCIL_ENTRANCE;
const P = COUNCIL_ENTRANCE_POOLS;
/** Resonance rings alive at once (their pool). */
const RING_SLOTS = 6;
/** How long a resonance ring takes to spread and fade, and how far. */
const RING_FOR = 0.95;
const RING_TO = 15;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _st = newFlyingStone();

/** A crystal: a hexagonal prism (radius 1, its foot at 0) with a pointed
 *  tip at 1, `aH` its height share (the light climbs it), flat-shaded. */
export function crystalGeometry(): THREE.BufferGeometry {
  const sides = 6;
  const body = 0.78;
  const pos: number[] = [];
  const hgt: number[] = [];
  const ring = (k: number) => {
    const a = (k / sides) * Math.PI * 2;
    return [Math.sin(a), Math.cos(a)] as const;
  };
  for (let k = 0; k < sides; k++) {
    const [x0, z0] = ring(k);
    const [x1, z1] = ring(k + 1);
    // The body's face.
    pos.push(x0, 0, z0, x1, 0, z1, x1, body, z1);
    pos.push(x0, 0, z0, x1, body, z1, x0, body, z0);
    hgt.push(0, 0, body, 0, body, body);
    // The tip's face.
    pos.push(x0, body, z0, x1, body, z1, 0, 1, 0);
    hgt.push(body, body, 1);
    // The foot's cap.
    pos.push(x1, 0, z1, x0, 0, z0, 0, 0, 0);
    hgt.push(0, 0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hgt, 1));
  g.computeVertexNormals();
  return g;
}

/** A flat ring a yard round, `uv.y` 0 at its inner edge and 1 at its outer. */
function ringGeometry(inner: number, segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    pos.push(s * inner, 0, c * inner, s, 0, c);
    uv.push(i / segments, 0, i / segments, 1);
    if (i > 0) {
      const b = i * 2;
      idx.push(b - 2, b - 1, b, b - 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** What the part reads off its host. */
export interface CouncilEntranceCrystalHost {
  readonly particles: EngineParticles;
  readonly density: number;
  readonly detail: boolean;
  readonly uTime: { value: number };
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  rand(): number;
  reducedMotion(): boolean;
  groundY(x: number, z: number): number;
}

export class CouncilEntranceCrystal {
  /** Placed on the Singer's spot, turned to her facing (her frame). */
  readonly stage = new THREE.Group();
  /** Her orbiting shards ride her (placed on her each frame). */
  readonly orbitStage = new THREE.Group();
  private readonly vein: THREE.InstancedMesh;
  private readonly veinMat: THREE.ShaderMaterial;
  private readonly shards: THREE.InstancedMesh;
  private readonly shardMat: THREE.ShaderMaterial;
  private readonly orbit: THREE.InstancedMesh;
  private readonly orbitMat: THREE.ShaderMaterial;
  private readonly rings: THREE.InstancedMesh;
  private readonly wall: THREE.Mesh;
  private readonly wallMat: THREE.ShaderMaterial;
  /** Her own light as she floats out and sings (a card on her). */
  private readonly halo: THREE.InstancedMesh;
  private readonly shardPicks: number[];
  /** The motes owed off the ringing vein (seconds' worth). */
  private glints = 0;
  /** The vein was last laid still (no tremble to write while it sleeps). */
  private veinStill = true;

  constructor(
    parent: THREE.Object3D,
    private readonly h: CouncilEntranceCrystalHost,
  ) {
    this.stage.name = 'smithHeartCouncilEntranceVein';
    this.stage.visible = false;
    this.orbitStage.name = 'smithHeartCouncilEntranceOrbitStage';
    this.orbitStage.visible = false;
    parent.add(this.stage, this.orbitStage);
    const geo = crystalGeometry();
    h.geometries.push(geo);
    const crystal = (name: string, clear: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uGlow: { value: 0.2 }, uTime: h.uTime, uClear: { value: clear } },
        vertexShader: CRYSTAL_VERT,
        fragmentShader: CRYSTAL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      h.materials.push(m);
      return m;
    };
    // The vein: instance 0 the cocoon round her, then the prisms (the
    // cocoon's clearer face lets her silhouette through).
    this.veinMat = crystal('smithHeartCouncilEntranceVeinMat', 1);
    this.vein = new THREE.InstancedMesh(geo, this.veinMat, 1 + VEIN_PRISMS.length);
    this.vein.name = 'smithHeartCouncilEntranceCrystal';
    this.vein.frustumCulled = false;
    this.layVein();
    this.stage.add(this.vein);
    // The burst's shards.
    this.shardMat = crystal('smithHeartCouncilEntranceShardMat', 0);
    this.shardPicks = councilEntrancePicks(CRYSTAL_SHARDS.length, h.detail);
    this.shards = new THREE.InstancedMesh(geo, this.shardMat, this.shardPicks.length);
    this.shards.name = 'smithHeartCouncilEntranceShards';
    this.shards.frustumCulled = false;
    this.shards.visible = false;
    this.shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.shardPicks.length; i++) {
      this.shards.setMatrixAt(i, _zero);
      this.shards.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    this.stage.add(this.shards);
    // Her orbiting shards.
    this.orbitMat = crystal('smithHeartCouncilEntranceOrbitMat', 0);
    this.orbit = new THREE.InstancedMesh(geo, this.orbitMat, ORBIT_SHARDS.count);
    this.orbit.name = 'smithHeartCouncilEntranceOrbit';
    this.orbit.frustumCulled = false;
    this.orbit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < ORBIT_SHARDS.count; i++) {
      this.orbit.setMatrixAt(i, _zero);
      this.orbit.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    this.orbitStage.add(this.orbit);
    // The resonance rings.
    const ringGeo = ringGeometry(0.93, 96);
    h.geometries.push(ringGeo);
    const ringMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilEntranceResonance',
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    h.materials.push(ringMat);
    this.rings = new THREE.InstancedMesh(ringGeo, ringMat, RING_SLOTS);
    this.rings.name = 'smithHeartCouncilEntranceRings';
    this.rings.frustumCulled = false;
    this.rings.visible = false;
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < RING_SLOTS; i++) {
      this.rings.setMatrixAt(i, _zero);
      this.rings.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.stage.add(this.rings);
    // Her light: a soft amber glow round her once she is out of the crystal,
    // blazing with her note.
    const card = new THREE.PlaneGeometry(1, 1);
    h.geometries.push(card);
    const haloMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilEntranceHerLight',
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    h.materials.push(haloMat);
    this.halo = new THREE.InstancedMesh(card, haloMat, 1);
    this.halo.name = 'smithHeartCouncilEntranceHerLight';
    this.halo.frustumCulled = false;
    this.halo.visible = false;
    this.halo.setMatrixAt(0, _zero);
    this.halo.setColorAt(0, _c.setRGB(0, 0, 0));
    this.orbitStage.add(this.halo);
    // The note's curtain of light (an open band scaled to its radius).
    const band = new THREE.CylinderGeometry(1, 1, 1, 160, 3, true).translate(0, 0.5, 0);
    h.geometries.push(band);
    this.wallMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilEntranceLightWall',
      uniforms: { uAlpha: { value: 0 }, uTime: h.uTime, uWrap: { value: 60 } },
      vertexShader: WALL_VERT,
      fragmentShader: LIGHT_WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    h.materials.push(this.wallMat);
    this.wall = new THREE.Mesh(band, this.wallMat);
    this.wall.name = 'smithHeartCouncilEntranceLightWave';
    this.wall.frustumCulled = false;
    this.wall.visible = false;
    this.stage.add(this.wall);
  }

  /** The vein's crystals in place (the cocoon round her, the prisms leaning
   *  out of the floor round it). */
  private layVein(trembleX = 0, trembleZ = 0): void {
    const V = COUNCIL_VEIN;
    _p.set(trembleX, -0.4, trembleZ);
    _q.setFromAxisAngle(_up, 0.3);
    _s.set(V.cocoonR, V.cocoonH, V.cocoonR * 0.86);
    _m.compose(_p, _q, _s);
    this.vein.setMatrixAt(0, _m);
    this.vein.setColorAt(0, _c.setRGB(1, 1, 1));
    for (let i = 0; i < VEIN_PRISMS.length; i++) {
      const pr = VEIN_PRISMS[i];
      _q.setFromAxisAngle(_up, pr.bearing);
      _q2.setFromAxisAngle(_axis.set(1, 0, 0), pr.lean);
      _q.multiply(_q2);
      _p.set(pr.x + trembleX * 0.6, -0.3, pr.z + trembleZ * 0.6);
      _s.set(pr.r, pr.len, pr.r);
      _m.compose(_p, _q, _s);
      this.vein.setMatrixAt(1 + i, _m);
      this.vein.setColorAt(1 + i, _c.setRGB(0.75 + 0.25 * (i % 3) * 0.5, 1, 1));
    }
    this.vein.instanceMatrix.needsUpdate = true;
    if (this.vein.instanceColor) this.vein.instanceColor.needsUpdate = true;
  }

  /** Stand the vein on her spot (world place and facing). */
  place(x: number, z: number, facing: number): void {
    this.stage.position.set(x, this.h.groundY(x, z), z);
    this.stage.rotation.set(0, facing, 0);
    this.stage.updateMatrixWorld();
  }

  hide(): void {
    this.stage.visible = false;
    this.orbitStage.visible = false;
  }

  /** Paint the crystal at `look`; `her` her drawn place this frame (the
   *  orbit rides it), `crossed` true for a beat the scene crosses this
   *  frame. */
  paint(
    look: CouncilEntranceLook,
    her: { x: number; y: number; z: number },
    facing: number,
    dt: number,
    crossed: (at: number) => boolean,
  ): void {
    this.stage.visible = true;
    const reduced = this.h.reducedMotion();
    const whole = look.crystal > 0.5;
    // The vein: glowing, ringing, trembling.
    this.vein.visible = whole;
    if (whole) {
      const tr = reduced ? 0 : look.tremble * 0.06;
      if (tr > 0 || !this.veinStill) {
        const ph = look.t * 47;
        this.layVein(Math.sin(ph) * tr, Math.cos(ph * 1.3) * tr);
        this.veinStill = tr === 0;
      }
      this.veinMat.uniforms.uGlow.value = councilEntranceLight(look.veinGlow, reduced);
      // Glints rising off it as it rings.
      this.glints += dt * P.veinMotes * look.tremble * this.h.density;
      while (this.glints >= 1) {
        this.glints -= 1;
        const a = this.h.rand() * Math.PI * 2;
        const r = 1.2 + this.h.rand() * 2.4;
        _v.set(Math.sin(a) * r, 0.8 + this.h.rand() * 4, Math.cos(a) * r).applyMatrix4(
          this.stage.matrixWorld,
        );
        this.h.particles.puff(_v.x, _v.y, _v.z, 1, GLINT);
      }
    } else this.glints = 0;
    // The resonance rings: each born on its beat, spreading and fading.
    let ringsOn = false;
    for (let i = 0; i < RING_SLOTS; i++) this.rings.setMatrixAt(i, _zero);
    let slot = 0;
    for (let k = 0; k < VEIN_RINGS.length && slot < RING_SLOTS; k++) {
      const age = look.t - VEIN_RINGS[k];
      if (look.dormant || age < 0 || age > RING_FOR) continue;
      const kk = age / RING_FOR;
      const r = 1.8 + (RING_TO - 1.8) * (1 - (1 - kk) * (1 - kk));
      const a = councilEntranceLight((1 - kk) * (0.6 + 0.08 * k), reduced);
      _p.set(0, 1.2 + (k % 3) * 1.3, 0);
      _q.setFromAxisAngle(_axis.set(1, 0, 0), ((k % 2) - 0.5) * 0.18);
      _s.set(r, 1, r);
      _m.compose(_p, _q, _s);
      this.rings.setMatrixAt(slot, _m);
      this.rings.setColorAt(slot, _c.setRGB(a, a, a));
      slot++;
      ringsOn = true;
    }
    this.rings.visible = ringsOn;
    if (ringsOn) {
      this.rings.instanceMatrix.needsUpdate = true;
      if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    }
    // The shatter's burst of shards.
    if (crossed(E.shatterAt)) this.shatter();
    const burst = look.sinceShatter >= 0 && look.sinceShatter < 2.6;
    this.shards.visible = burst;
    if (burst) {
      this.shardMat.uniforms.uGlow.value = councilEntranceLight(
        0.6 + 1.6 * Math.exp(-look.sinceShatter * 2.5),
        reduced,
      );
      for (let k = 0; k < this.shardPicks.length; k++) {
        const c = CRYSTAL_SHARDS[this.shardPicks[k]];
        shardAt(c, look.sinceShatter, _st);
        if (_st.size <= 0.001) {
          this.shards.setMatrixAt(k, _zero);
          continue;
        }
        _axis.set(c.vz, 0.6, -c.vx).normalize();
        _q.setFromAxisAngle(_axis, _st.turn);
        _p.set(_st.x, _st.y, _st.z);
        _s.set(_st.size * 0.45, _st.size * 1.6, _st.size * 0.45);
        _m.compose(_p, _q, _s);
        this.shards.setMatrixAt(k, _m);
      }
      this.shards.instanceMatrix.needsUpdate = true;
    }
    // Her orbiting shards, round her drawn place.
    const orbiting = look.orbit > 0.001;
    this.orbitStage.visible = orbiting;
    if (orbiting) {
      this.orbitStage.position.set(her.x, this.h.groundY(her.x, her.z), her.z);
      this.orbitStage.rotation.set(0, facing, 0);
      const fling = look.orbitFling > 0;
      this.orbitMat.uniforms.uGlow.value = councilEntranceLight(
        0.9 + (fling ? 1.6 * Math.exp(-look.orbitFling * 2) : 0.25 * Math.sin(look.t * 3)),
        reduced,
      );
      for (let i = 0; i < ORBIT_SHARDS.count; i++) {
        orbitShardAt(i, look, _st);
        if (_st.size <= 0.001) {
          this.orbit.setMatrixAt(i, _zero);
          continue;
        }
        _q.setFromAxisAngle(_up, _st.turn);
        _q2.setFromAxisAngle(_axis.set(0, 0, 1), 0.35 + (i % 3) * 0.2);
        _q.multiply(_q2);
        _p.set(_st.x, _st.y, _st.z);
        const sz = (0.48 + 0.16 * (i % 3)) * _st.size;
        _s.set(sz, sz * 3.2, sz);
        _m.compose(_p, _q, _s);
        this.orbit.setMatrixAt(i, _m);
      }
      this.orbit.instanceMatrix.needsUpdate = true;
      // Her light: gathering with her shards, blazing on the note, fading
      // with the scene's tail.
      const tail = Math.max(0, Math.min(1, (E.end - look.t) / 2.4));
      const note = look.sinceNote >= 0 ? 1.6 * Math.exp(-look.sinceNote * 1.8) : 0;
      const k = councilEntranceLight((0.45 * look.orbit + note) * tail, reduced);
      this.halo.visible = k > 0.01;
      _p.set(0, 2.8, 0);
      _q.identity();
      _s.setScalar(8 + 6 * Math.min(1, note));
      _m.compose(_p, _q, _s);
      this.halo.setMatrixAt(0, _m);
      this.halo.setColorAt(0, _c.setRGB(k, 0.68 * k, 0.32 * k));
      this.halo.instanceMatrix.needsUpdate = true;
      if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
    }
    // The note's wave of light.
    const waveOn = look.wave > 0.01;
    this.wall.visible = waveOn;
    if (waveOn) {
      const hgt = 4.5 * (0.45 + 0.55 * look.wave);
      _v.set(her.x, 0, her.z);
      this.stage.worldToLocal(_v);
      this.wall.position.set(_v.x, 0.05, _v.z);
      this.wall.scale.set(look.waveR, hgt, look.waveR);
      this.wallMat.uniforms.uAlpha.value = councilEntranceLight(look.wave * 1.2, reduced);
      this.wallMat.uniforms.uWrap.value = Math.max(
        24,
        Math.round((Math.PI * 2 * look.waveR) / 1.3),
      );
    }
    if (crossed(E.noteAt)) this.note(her);
  }

  /** The shatter: glints flung, the floor's wave of light. */
  private shatter(): void {
    _v.set(0, COUNCIL_VEIN.cocoonH * 0.45, 0).applyMatrix4(this.stage.matrixWorld);
    this.h.particles.puff(_v.x, _v.y, _v.z, 46, SPARK);
    this.h.particles.puff(_v.x, _v.y - 1.5, _v.z, 14, CRYSTAL_DUST);
    this.h.particles.shockRing(this.stage.position.x, this.stage.position.z, 0xffc070, 18, 0.9, {
      wake: 0.25,
      crest: 0.12,
      strength: 0.8,
    });
  }

  /** The high note: a floor's wave of light under the curtain, sparks off her. */
  private note(her: { x: number; y: number; z: number }): void {
    this.h.particles.shockRing(her.x, her.z, 0xffd890, E.waveTo, E.waveFor, {
      wake: 0.08,
      crest: 0.05,
      strength: 0.7,
    });
    this.h.particles.puff(her.x, her.y + 3, her.z, 30, SPARK);
  }
}

// ---- particles' options ------------------------------------------------------------------------

const GLINT = {
  speed: 0.5,
  up: 2.4,
  life: 1.6,
  size: [0.28, 0.06] as [number, number],
  color: [1.0, 0.78, 0.42] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  drag: 0.6,
};
const SPARK = {
  speed: 15,
  up: 4,
  life: 1.3,
  size: [0.45, 0.08] as [number, number],
  color: [1.0, 0.86, 0.55] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 1.5,
  gravity: 9,
  drag: 0.5,
};
const CRYSTAL_DUST = {
  speed: 4,
  up: 1.6,
  life: 2.2,
  size: [2.5, 6] as [number, number],
  color: [0.85, 0.62, 0.38] as [number, number, number],
  alpha: 0.35,
  drag: 1.2,
  radius: 1.5,
};

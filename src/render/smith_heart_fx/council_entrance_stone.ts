// The Guardian's rock in the Hammer Council's entrance (plan:
// council_entrance_core.ts), a part of CouncilEntranceFx (council_entrance_
// fx.ts, which owns the root, the particles and the clock and paints it each
// frame):
//  - asleep: a spur of the quarry's sandstone round the Guardian, slab on
//    slab, a gap at its chest and head where its dark shape shows, a slow
//    light breathing deep inside;
//  - the cracks: burning ochre-gold seams racing up the spur from its foot
//    to its crown, white-hot at their front, the light inside swelling
//    through the gaps;
//  - the tear: every slab flung out and up, tumbling, landing with a puff of
//    dust and sinking back into the floor; a hail of rubble; a burst of light
//    and a cloud of dust round its feet;
//  - the punch: a rolling wall of dust and grit racing out from its fists
//    past the raid (cosmetic: no damage, no knockback), stone thrown up, the
//    floor's wave.
// Every slab draws on every tier (they are the rock itself); the low tier
// thins the rubble and the dust.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (one gated attach); fixed pools, no
// light, no per-frame allocation.

import * as THREE from 'three';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  COUNCIL_ENTRANCE,
  COUNCIL_ENTRANCE_POOLS,
  COUNCIL_ROCK,
  type CouncilEntranceLook,
  chunkAt,
  councilEntranceHash,
  councilEntranceLight,
  councilEntrancePicks,
  newFlyingStone,
  ROCK_CHUNKS,
  ROCK_SLABS,
  slabAt,
} from './council_entrance_core';
import {
  DUST_WALL_FRAG,
  GLOW_FRAG,
  GLOW_VERT,
  STONE_FRAG,
  STONE_VERT,
  WALL_VERT,
} from './council_entrance_glsl';

const E = COUNCIL_ENTRANCE;
const P = COUNCIL_ENTRANCE_POOLS;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _stone = newFlyingStone();
const _c = new THREE.Color();

/** A chunk of rock: a box cut 2 by 2 by 2, every corner pushed off true by a
 *  hash of its place (shared corners move together, so it stays closed),
 *  flat-shaded. */
export function rockGeometry(seed: number, jag: number): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(1, 1, 1, 1, 2, 1);
  const pos = box.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = Math.round(x * 4) * 73 + Math.round(y * 4) * 151 + Math.round(z * 4) * 283;
    const corner = Math.abs(x) + Math.abs(y) + Math.abs(z) > 1.2 ? 0.86 : 1;
    pos.setXYZ(
      i,
      x * corner + (councilEntranceHash(k, seed) - 0.5) * jag,
      y * corner + (councilEntranceHash(k, seed + 1) - 0.5) * jag,
      z * corner + (councilEntranceHash(k, seed + 2) - 0.5) * jag,
    );
  }
  const flat = box.toNonIndexed();
  box.dispose();
  flat.deleteAttribute('uv');
  flat.computeVertexNormals();
  return flat;
}

/** What the part reads off its host. */
export interface CouncilEntranceStoneHost {
  readonly particles: EngineParticles;
  readonly density: number;
  readonly detail: boolean;
  readonly uTime: { value: number };
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  rand(): number;
  reducedMotion(): boolean;
  /** The floor's height at world (x, z). */
  groundY(x: number, z: number): number;
}

export class CouncilEntranceStone {
  /** Placed on the Guardian, turned to its facing (its frame: +z its
   *  front). */
  readonly stage = new THREE.Group();
  private readonly slabs: THREE.InstancedMesh;
  private readonly rubble: THREE.InstancedMesh;
  readonly stoneMat: THREE.ShaderMaterial;
  private readonly flyMat: THREE.ShaderMaterial;
  private readonly core: THREE.InstancedMesh;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly dustWall: THREE.Mesh;
  private readonly dustWallMat: THREE.ShaderMaterial;
  private readonly rubblePicks: number[];
  /** Each slab's landing seen (its puff of dust plays once). */
  private readonly slabLanded: Uint8Array;
  /** The floor's height under the Guardian (world). */
  private floorY = 0;
  /** The slabs stand at rest in the spur (nothing to write while it
   *  sleeps). */
  private atRest = true;

  constructor(
    parent: THREE.Object3D,
    private readonly h: CouncilEntranceStoneHost,
  ) {
    this.stage.name = 'smithHeartCouncilEntranceRock';
    this.stage.visible = false;
    parent.add(this.stage);
    const slabGeo = rockGeometry(11, 0.24);
    const chunkGeo = rockGeometry(29, 0.45);
    h.geometries.push(slabGeo, chunkGeo);
    const stone = (name: string) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uCrack: { value: 0 },
          uHeat: { value: 0 },
          uHeight: { value: COUNCIL_ROCK.height },
          uEmber: { value: 0 },
          uTime: h.uTime,
          uTint: { value: 0 },
        },
        vertexShader: STONE_VERT,
        fragmentShader: STONE_FRAG,
      });
      h.materials.push(m);
      return m;
    };
    // The spur as it stands (the cracks' reveal reads each slab's place up
    // it) and the same stone flying (its cracks only a dull ember).
    this.stoneMat = stone('smithHeartCouncilEntranceRock');
    this.flyMat = stone('smithHeartCouncilEntranceRockFlying');
    this.slabs = new THREE.InstancedMesh(slabGeo, this.stoneMat, ROCK_SLABS.length);
    this.slabs.name = 'smithHeartCouncilEntranceSlabs';
    this.slabs.frustumCulled = false;
    this.slabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stage.add(this.slabs);
    this.slabLanded = new Uint8Array(ROCK_SLABS.length);
    this.rubblePicks = councilEntrancePicks(ROCK_CHUNKS.length, h.detail);
    this.rubble = new THREE.InstancedMesh(chunkGeo, this.flyMat, this.rubblePicks.length);
    this.rubble.name = 'smithHeartCouncilEntranceRubble';
    this.rubble.frustumCulled = false;
    this.rubble.visible = false;
    this.rubble.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.rubblePicks.length; i++) this.rubble.setMatrixAt(i, _zero);
    this.stage.add(this.rubble);
    this.restSlabs();

    // The light deep inside the spur (seen only through its gaps: the
    // slabs hide it where they stand).
    const card = new THREE.PlaneGeometry(1, 1);
    h.geometries.push(card);
    this.coreMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilEntranceRockCore',
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    h.materials.push(this.coreMat);
    this.core = new THREE.InstancedMesh(card, this.coreMat, 1);
    this.core.name = 'smithHeartCouncilEntranceRockCore';
    this.core.frustumCulled = false;
    this.core.setMatrixAt(0, _zero);
    this.core.setColorAt(0, _c.setRGB(0, 0, 0));
    this.stage.add(this.core);

    // The punch's wall of dust (an open band, scaled to its ring).
    const band = new THREE.CylinderGeometry(1, 1, 1, 128, 3, true).translate(0, 0.5, 0);
    h.geometries.push(band);
    this.dustWallMat = new THREE.ShaderMaterial({
      name: 'smithHeartCouncilEntranceDustWall',
      uniforms: { uAlpha: { value: 0 }, uTime: h.uTime, uWrap: { value: 40 } },
      vertexShader: WALL_VERT,
      fragmentShader: DUST_WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    h.materials.push(this.dustWallMat);
    this.dustWall = new THREE.Mesh(band, this.dustWallMat);
    this.dustWall.name = 'smithHeartCouncilEntranceDustWall';
    this.dustWall.frustumCulled = false;
    this.dustWall.visible = false;
    this.stage.add(this.dustWall);
  }

  /** The light inside the rock at `level` (its card's size and colour). */
  private setCore(level: number): void {
    const k = councilEntranceLight(level, this.h.reducedMotion());
    this.core.visible = k > 0.01;
    if (!this.core.visible) return;
    _p.set(0, COUNCIL_ROCK.height * 0.48, 0.8);
    _q.identity();
    _s.setScalar(5 + 5.5 * Math.min(1.6, k));
    _m.compose(_p, _q, _s);
    this.core.setMatrixAt(0, _m);
    this.core.setColorAt(0, _c.setRGB(1.0 * k, 0.62 * k, 0.24 * k));
    this.core.instanceMatrix.needsUpdate = true;
    if (this.core.instanceColor) this.core.instanceColor.needsUpdate = true;
  }

  /** Every slab back in the spur, the rubble hidden (a fresh scene). */
  restSlabs(): void {
    for (let i = 0; i < ROCK_SLABS.length; i++) {
      slabAt(ROCK_SLABS[i], -1, _stone);
      this.writeSlab(i, _stone);
      this.slabLanded[i] = 0;
    }
    this.slabs.instanceMatrix.needsUpdate = true;
    this.atRest = true;
  }

  private writeSlab(i: number, st: ReturnType<typeof newFlyingStone>): void {
    const s = ROCK_SLABS[i];
    _q.setFromAxisAngle(_up, s.yaw);
    _q2.setFromAxisAngle(_axis.set(1, 0, 0), s.tilt);
    _q.multiply(_q2);
    if (st.turn !== 0) {
      _axis.set(s.ax, 0.4, s.az).normalize();
      _q2.setFromAxisAngle(_axis, st.turn);
      _q.premultiply(_q2);
    }
    _p.set(st.x, st.y, st.z);
    _s.set(s.sx * st.size, s.sy * st.size, s.sz * st.size);
    _m.compose(_p, _q, _s);
    this.slabs.setMatrixAt(i, _m);
  }

  /** Stand the spur on the Guardian (world place and facing). */
  place(x: number, y: number, z: number, facing: number): void {
    this.floorY = this.h.groundY(x, z);
    this.stage.position.set(x, Math.min(y, this.floorY), z);
    this.stage.rotation.set(0, facing, 0);
    this.stage.updateMatrixWorld();
  }

  hide(): void {
    this.stage.visible = false;
  }

  /** Paint the rock at `look` (`prev`/`time` the painter's times: a beat is
   *  played once, as the scene crosses it). Returns the light inside it (the
   *  host's flash and shake read it). */
  paint(look: CouncilEntranceLook, crossed: (at: number) => boolean): void {
    this.stage.visible = true;
    const reduced = this.h.reducedMotion();
    const u = this.stoneMat.uniforms;
    u.uCrack.value = look.crack;
    u.uHeat.value = councilEntranceLight(look.crackHeat, reduced);
    const torn = look.sinceTear >= 0;
    // The flying stone keeps a dull ember in its seams a moment.
    this.flyMat.uniforms.uEmber.value = torn ? Math.max(0, 1 - look.sinceTear / 2.5) : 0;
    this.flyMat.uniforms.uHeat.value = 0;
    this.slabs.material = torn ? this.flyMat : this.stoneMat;
    this.setCore(look.core);
    // The slabs: whole (written once), then flung.
    if (!torn) {
      if (!this.atRest) this.restSlabs();
      this.slabs.visible = true;
    }
    let anyShown = !torn;
    for (let i = 0; torn && i < ROCK_SLABS.length; i++) {
      this.atRest = false;
      slabAt(ROCK_SLABS[i], look.sinceTear, _stone);
      if (_stone.size <= 0.66 && _stone.landed && _stone.sinceLand > ROCK_SLABS[i].rest + 1.3) {
        this.slabs.setMatrixAt(i, _zero);
        continue;
      }
      anyShown = true;
      this.writeSlab(i, _stone);
      // A puff of dust where a slab lands (once).
      if (_stone.landed && this.slabLanded[i] === 0) {
        this.slabLanded[i] = 1;
        if (_stone.sinceLand < 0.3) this.puffAt(_stone.x, _stone.z, 3, 'land');
      }
    }
    if (torn) {
      this.slabs.visible = anyShown;
      this.slabs.instanceMatrix.needsUpdate = true;
    }
    // The rubble.
    this.rubble.visible = torn && look.sinceTear < 4;
    if (this.rubble.visible) {
      for (let k = 0; k < this.rubblePicks.length; k++) {
        const c = ROCK_CHUNKS[this.rubblePicks[k]];
        chunkAt(c, look.sinceTear, _stone);
        if (_stone.size <= 0.001) {
          this.rubble.setMatrixAt(k, _zero);
          continue;
        }
        _axis.set(c.vz, 0.5, -c.vx).normalize();
        _q.setFromAxisAngle(_axis, _stone.turn);
        _p.set(_stone.x, _stone.y, _stone.z);
        _s.setScalar(_stone.size);
        _m.compose(_p, _q, _s);
        this.rubble.setMatrixAt(k, _m);
      }
      this.rubble.instanceMatrix.needsUpdate = true;
    }
    // The tear's cloud and the punch's debris, on their beats.
    if (crossed(E.tearAt)) this.tear();
    if (crossed(E.punchAt)) this.punch();
    // The punch's rolling wall of dust.
    const ringOn = look.ring > 0.01;
    this.dustWall.visible = ringOn;
    if (ringOn) {
      const hgt = 3.4 * (0.4 + 0.6 * look.ring);
      this.dustWall.scale.set(look.ringR, hgt, look.ringR);
      this.dustWall.position.set(0, 0.05, 0);
      this.dustWallMat.uniforms.uAlpha.value = look.ring * 0.85;
      this.dustWallMat.uniforms.uWrap.value = Math.max(
        16,
        Math.round((Math.PI * 2 * look.ringR) / 2.2),
      );
    }
  }

  /** A puff of dust at a point of the Guardian's frame (`kind`: a landing
   *  slab, the tear's cloud). */
  private puffAt(x: number, z: number, n: number, kind: 'land' | 'cloud'): void {
    _v.set(x, 0, z).applyMatrix4(this.stage.matrixWorld);
    const y = this.h.groundY(_v.x, _v.z) + 0.4;
    this.h.particles.puff(_v.x, y, _v.z, n, kind === 'land' ? LAND : CLOUD);
  }

  /** The tear: the cloud of dust round its feet, grit flung, a burst of light
   *  between the flying slabs. */
  private tear(): void {
    const n = Math.max(6, Math.round(P.tearDust * this.h.density));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = COUNCIL_ROCK.footR * (0.6 + 0.6 * this.h.rand());
      this.puffAt(Math.sin(a) * r, Math.cos(a) * r, 1, 'cloud');
    }
    _v.set(0, COUNCIL_ROCK.height * 0.5, 0).applyMatrix4(this.stage.matrixWorld);
    this.h.particles.puff(_v.x, _v.y, _v.z, 40, GRIT);
    this.h.particles.shockRing(this.stage.position.x, this.stage.position.z, 0xffb050, 22, 1.1, {
      wake: 0.2,
      crest: 0.12,
      strength: 0.7,
    });
  }

  /** The punch: stone thrown up out of the floor, the floor's wave racing
   *  out under the wall of dust. */
  private punch(): void {
    _v.set(0, 0, 3.2).applyMatrix4(this.stage.matrixWorld);
    const y = this.h.groundY(_v.x, _v.z) + 0.5;
    this.h.particles.puff(_v.x, y, _v.z, P.punchDebris, DEBRIS);
    this.h.particles.puff(_v.x, y, _v.z, 24, CLOUD);
    this.h.particles.shockRing(_v.x, _v.z, 0xd8a868, E.ringTo, E.ringFor, {
      wake: 0.12,
      crest: 0.06,
      strength: 0.75,
    });
  }
}

// ---- particles' options ------------------------------------------------------------------------

const LAND = {
  speed: 3.2,
  up: 1.4,
  life: 1.6,
  size: [2.2, 5.5] as [number, number],
  color: [0.62, 0.52, 0.4] as [number, number, number],
  alpha: 0.5,
  drag: 1.4,
  radius: 1.4,
};
const CLOUD = {
  speed: 5.5,
  up: 2.2,
  life: 3.2,
  size: [3.5, 9] as [number, number],
  color: [0.6, 0.5, 0.38] as [number, number, number],
  alpha: 0.55,
  drag: 1.1,
  radius: 2,
};
const GRIT = {
  speed: 16,
  up: 6,
  life: 1.6,
  size: [0.5, 0.12] as [number, number],
  color: [1.0, 0.72, 0.36] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 3,
  gravity: 16,
  drag: 0.3,
};
const DEBRIS = {
  speed: 13,
  up: 11,
  life: 1.8,
  size: [0.7, 0.25] as [number, number],
  color: [0.55, 0.45, 0.34] as [number, number, number],
  alpha: 0.95,
  radius: 2.4,
  gravity: 20,
  drag: 0.4,
};

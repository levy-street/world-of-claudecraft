// Living Rime drawn on its carrier (plan: quench_rime_core.ts; the sim:
// encounters/smith_heart/quench_rime.ts), owned by QuenchFightFx
// (quench_fight_fx.ts), which hands it the carriers its scan found and the
// fight's cues. Presentation only, read from IWorld (the carrier's rime
// aura), so offline and online look the same:
//  - the crust: plates of lake ice standing out of the body, as many as the
//    healing left asks, melting plate by plate as the healers land;
//  - the ring: the burst's 6 yd reach on the ice round them, dressed as the
//    shatter's ring (one language: a ring that fills is cold about to burst),
//    filling with its clock, so the carrier sees to leave the group and the
//    group sees to keep out;
//  - the cues: frost motes drawn in as it closes, a spray of crust as it is
//    healed through, a shock ring at its burst (the freeze itself is the
//    cold's own encasement).
// The crust and the ring draw on every graphics tier (both are actionable);
// only the motes thin on the low tier (the particles' density).
//
// Rules (src/render/CLAUDE.md): built in the constructor under the fight's
// gated root, no new program (the plates share the kit's ice material and the
// rime spikes' instanced, vertex-coloured shape; the rings are the kit's
// painted fans), fixed pools, no per-frame allocation, no light.

import * as THREE from 'three';
import {
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_TUNING as T,
} from '../../sim/encounters/smith_heart/quench_ids';
import type { Aura, Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { needsRedrape } from '../attached_fx_anchor_core';
import type { TelegraphFan, TelegraphKit } from '../floor_telegraph';
import { heartKitSlotMaterial } from '../smith_heart/heart_kit';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { QUENCH_FIGHT_COLORS as C, fightHash } from './quench_fight_fx_core';
import {
  QUENCH_RIME_POOLS as P,
  type RimeLook,
  type RimePlate,
  rimeLook,
  rimePlate,
} from './quench_rime_core';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _look: RimeLook = { crust: 0, plates: 0, fill: 0, pulse: 0 };
const _plate: RimePlate = { a: 0, h: 0, r: 0, lean: 0, len: 0, w: 0 };

interface RingSlot {
  fan: TelegraphFan;
  id: number;
  x: number;
  z: number;
}

export class QuenchRimeFx {
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly plates: THREE.InstancedMesh;
  private readonly rings: RingSlot[] = [];
  /** Plates drawn last frame (the ones to zero when fewer draw). */
  private lastPlates = 0;

  constructor(
    root: THREE.Group,
    private readonly kit: TelegraphKit,
    makeRing: () => TelegraphFan,
    private readonly particles: EngineParticles,
    private readonly groundY: (x: number, z: number) => number,
  ) {
    // The plate: the rime spikes' four-sided shard, tinted pale at its tip.
    const geo = new THREE.ConeGeometry(1, 1, 4, 1).translate(0, 0.5, 0).toNonIndexed();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.min(1, Math.max(0, pos.getY(i)));
      const face = 0.85 + 0.3 * fightHash(Math.floor(i / 3), 41);
      col[i * 3] = Math.min(1, (0.42 + 0.55 * k) * face);
      col[i * 3 + 1] = Math.min(1, (0.66 + 0.34 * k) * face);
      col[i * 3 + 2] = Math.min(1, (0.88 + 0.12 * k) * face);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.geometries.push(geo);
    const n = P.carriers * P.platesPer;
    this.plates = new THREE.InstancedMesh(geo, heartKitSlotMaterial('ice'), n);
    this.plates.name = 'smithHeartQuenchRimeCrust';
    this.plates.frustumCulled = false;
    this.plates.castShadow = false;
    this.plates.receiveShadow = false;
    this.plates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) this.plates.setMatrixAt(i, _zero);
    this.plates.visible = false;
    root.add(this.plates);
    for (let i = 0; i < P.carriers; i++) {
      const fan = makeRing();
      fan.group.visible = false;
      this.rings.push({ fan, id: -1, x: 0, z: 0 });
    }
  }

  // ---- the cues ----------------------------------------------------------------------------

  /** The rime's cues (QuenchFightFx claims them; this draws them). */
  event(ev: SimEvent, world: IWorld): void {
    if (ev.type === 'spellfxAt' && ev.ability === QUENCH_CUES.rimeBurst) {
      const r = ev.radius ?? T.rimeBurstR;
      this.particles.shockRing(ev.x, ev.z, 0xcff2ff, r, 0.55);
      this.particles.puff(ev.x, this.groundY(ev.x, ev.z) + 1, ev.z, 26, {
        speed: 7,
        up: 2,
        life: 0.9,
        size: [0.36, 0.08],
        color: C.shard,
        alpha: 1,
        pool: 'glow',
        gravity: 11,
        radius: 0.8,
      });
      return;
    }
    if (ev.type !== 'spellfx') return;
    const e = world.entities.get(ev.targetId);
    if (!e) return;
    if (ev.ability === QUENCH_CUES.rime) this.closes(e);
    else if (ev.ability === QUENCH_CUES.rimeBreak) this.falls(e);
  }

  /** The crust closes: frost motes drawn in to the body, a cold ring. */
  private closes(e: Entity): void {
    const at = fxAnchor(e);
    const y = this.groundY(at.x, at.z);
    this.particles.puff(at.x, y + 1.2, at.z, 18, {
      speed: -2.4,
      up: 0.4,
      life: 0.7,
      size: [0.08, 0.3],
      color: C.frost,
      alpha: 0.9,
      pool: 'glow',
      radius: 2.2,
    });
    this.particles.shockRing(at.x, at.z, 0x9fdcff, 2.4, 0.4);
  }

  /** Healed through: the crust breaks off in a spray of pale shards. */
  private falls(e: Entity): void {
    const at = fxAnchor(e);
    const y = this.groundY(at.x, at.z);
    this.particles.puff(at.x, y + 1.1, at.z, 20, {
      speed: 4.5,
      up: 1.8,
      life: 0.75,
      size: [0.28, 0.06],
      color: C.shard,
      alpha: 1,
      pool: 'glow',
      gravity: 12,
      radius: 0.6,
    });
    this.particles.puff(at.x, y + 1, at.z, 6, {
      speed: 1.2,
      up: 0.5,
      life: 1,
      size: [0.7, 1.8],
      color: C.mist,
      alpha: 0.45,
    });
  }

  // ---- the frame ---------------------------------------------------------------------------

  /** Draw every carrier in `ids` (the scan's), at clock `clock`. */
  frame(world: IWorld, ids: readonly number[], clock: number): void {
    let pi = 0;
    let ri = 0;
    for (const id of ids) {
      if (ri >= P.carriers) break;
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      let crust: Aura | null = null;
      for (const a of e.auras) if (a.id === QUENCH_AURAS.rime) crust = a;
      if (!crust) continue;
      rimeLook(crust.value, crust.value2 ?? crust.value, crust.remaining, clock, _look);
      const at = fxAnchor(e);
      const floor = this.groundY(at.x, at.z);
      // The ring: the burst's reach, filling with its clock.
      const slot = this.rings[ri++];
      const moved = slot.id !== id || needsRedrape(at.x, at.z, slot.x, slot.z);
      if (moved) {
        this.kit.drapeFan(slot.fan, this.groundY, at.x, floor, at.z, 0, T.rimeBurstR);
        slot.x = at.x;
        slot.z = at.z;
      } else this.kit.placeFan(slot.fan, at.x, floor, at.z);
      slot.id = id;
      slot.fan.group.visible = true;
      this.kit.paintFan(slot.fan, {
        fill: Math.min(1, 0.2 + 0.8 * _look.fill),
        clock,
        range: T.rimeBurstR,
      });
      // The crust: its plates, as many as the healing left asks.
      const swell = 1 + 0.06 * _look.pulse;
      for (let k = 0; k < _look.plates && pi < this.plates.count; k++) {
        rimePlate(id, k, _plate);
        _v.set(
          at.x + Math.sin(_plate.a) * _plate.r,
          floor + _plate.h,
          at.z + Math.cos(_plate.a) * _plate.r,
        );
        _e.set(_plate.lean, _plate.a, 0, 'YXZ');
        _q.setFromEuler(_e);
        _s.set(_plate.w * swell, _plate.len * swell, _plate.w * 0.55 * swell);
        this.plates.setMatrixAt(pi++, _m.compose(_v, _q, _s));
      }
    }
    for (let i = ri; i < P.carriers; i++) {
      this.rings[i].id = -1;
      this.rings[i].fan.group.visible = false;
    }
    // Nothing drawn this frame or the last: the pool is already zeroed.
    if (pi === 0 && this.lastPlates === 0) return;
    for (let i = pi; i < this.lastPlates; i++) this.plates.setMatrixAt(i, _zero);
    this.lastPlates = pi;
    this.plates.instanceMatrix.needsUpdate = true;
    this.plates.visible = pi > 0;
  }

  /** Everything hidden (the player left the lake). */
  clear(): void {
    for (const r of this.rings) {
      r.id = -1;
      r.fan.group.visible = false;
    }
    for (let i = 0; i < this.plates.count; i++) this.plates.setMatrixAt(i, _zero);
    this.lastPlates = 0;
    this.plates.instanceMatrix.needsUpdate = true;
    this.plates.visible = false;
  }

  /** The crust's instance buffer and its shard (the kit's ice material is
   *  shared and cache-owned: never disposed here). */
  dispose(): void {
    this.plates.removeFromParent();
    this.plates.dispose();
    for (const g of this.geometries) g.dispose();
  }

  /** Plates drawn last frame (the tests read it). */
  drawnPlates(): number {
    return this.lastPlates;
  }

  /** Rings shown (the tests read it). */
  shownRings(): number {
    return this.rings.filter((r) => r.fan.group.visible).length;
  }
}

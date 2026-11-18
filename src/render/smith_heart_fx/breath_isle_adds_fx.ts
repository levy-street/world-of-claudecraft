// The isles' adds' mechanics (encounters/smith_heart/breath_isle_adds.ts), a
// part of BreathIslesFx (looks: breath_isle_phase_core.ts):
//
//  - the Gust Herald's Shoving Gale: while its bar runs, its lane on the
//    floor along its locked facing at the sim's exact reach and width
//    (ISLE_TUNING.shoveReach, shoveHalfWidth) through the shared floor
//    telegraph in the wind's paint, filling with the bar; where the lane runs
//    past the isle's rim it hangs level in the air (it throws you off there);
//    the landing (ISLE_CUES.shoved): a gust tearing down the lane;
//  - the Squall Shieldbearer's Squall Ward (ISLE_AURAS.ward, value2 its front
//    arc's half): a curved shield of wind and stone across its front arc and
//    the arc itself on the floor, so the raid strikes its back;
//  - the Gale Mender's Mending Gale: while it channels, a beam of mint wind
//    from it to every ally it will mend; the mend (ISLE_CUES.mended) flares
//    each beam and bursts on its ally; cut, the beams part and fade;
//  - the Riven Squall's split (ISLE_CUES.split): a burst of storm grit and
//    shards, a ring, a thud.
// On EVERY tier the lane, the ward and the beams (the raid acts on them);
// sparks and grit thin on the low tier. Built in the constructor (the
// lanes through the host's telegraph kit, the rest under its root); fixed
// pools, no per-frame allocation.

import * as THREE from 'three';
import { isleAt } from '../../sim/encounters/smith_heart/breath_isle_geometry';
import {
  ISLE_AURAS,
  ISLE_CASTS,
  ISLE_MOBS,
} from '../../sim/encounters/smith_heart/breath_isle_ids';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { TELEGRAPH_THREAT_COLORS, type TelegraphKit, type TelegraphLane } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { heartKitSlotMaterial } from '../smith_heart/heart_kit';
import { IsleBeam } from './breath_isle_beam';
import {
  PHASE_POOLS as P,
  PHASE_COLORS as PC,
  phaseRgb,
  SHOVE_LANE,
  WARD_SHAPE,
  wardHalfArc,
} from './breath_isle_phase_core';
import {
  LANE_WIND_FRAG,
  PHASE_SHELL_VERT,
  PHASE_UV_VERT,
  WARD_FLOOR_FRAG,
  WARD_FRAG,
} from './breath_isle_phase_glsl';
import type { BreathIslesHost } from './breath_isles_fx';
import { beamCutLook } from './breath_isles_fx_core';
import type { BreathTelegraphKind } from './painted_telegraph_core';
import type { BreathTelegraphs, PaintedFan } from './painted_telegraphs';

/** What the adds lend from the fight's painter: its floor telegraph kit and
 *  the Breath's paints (the lanes wear the wind's). */
export interface IsleAddsKit {
  readonly kit: TelegraphKit;
  readonly paints: BreathTelegraphs;
}

interface LaneSlot {
  lane: TelegraphLane;
  painted: PaintedFan<BreathTelegraphKind>;
  /** The wind flowing down it, filling with the bar. */
  wind: THREE.Mesh;
  windMat: THREE.ShaderMaterial;
  id: number;
}

interface WardSlot {
  group: THREE.Group;
  shield: THREE.Mesh;
  shieldMat: THREE.ShaderMaterial;
  floor: THREE.Mesh;
  floorMat: THREE.ShaderMaterial;
  stones: THREE.InstancedMesh;
  id: number;
}

interface BeamSlot {
  beam: IsleBeam;
  mender: number;
  ally: number;
  /** Channelling now (seen this frame). */
  live: boolean;
  flare: number;
  /** When the channel ended (NaN: on) and when it was cut (NaN: not). */
  endAt: number;
  cutAt: number;
}

const WARD_STONES = 7;

/** A Mending Gale's arch over the yards between its ends: a gentle bow
 *  between two bodies side by side (a fixed 4.5 yd lift stood the beam up
 *  as a tall loop there), up to a high arch across the isle. */
export function beamLift(d: number): number {
  return Math.min(7, 0.4 + d * 0.75);
}

/** The beam's half width at its start: slim between bodies close together. */
export function beamHalf(d: number): number {
  return Math.min(1.25, 0.35 + d * 0.18);
}
const MEND_RGB = phaseRgb(0xd8fff2);
const GRIT_RGB = [0.5, 0.52, 0.58] as const;
const WIND_RGB = phaseRgb(PC.ward);
const _from = { x: 0, y: 0, z: 0 };
const _to = { x: 0, y: 0, z: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class BreathIsleAddsFx {
  private readonly lanes: LaneSlot[] = [];
  private readonly wards: WardSlot[] = [];
  private readonly beams: BeamSlot[] = [];
  private readonly heralds: number[] = [];
  private readonly shields: number[] = [];
  private readonly menders: number[] = [];
  private readonly adds: number[] = [];
  private clock = 0;
  private seed = 0x24f1;
  /** The lane's floor: level over the void at its herald's own height. */
  private laneY = 0;
  private readonly laneGround = (x: number, z: number): number => {
    const g = this.h.groundY(x, z);
    return Math.abs(g - this.laneY) > 1.5 ? this.laneY : g;
  };

  constructor(
    private readonly h: BreathIslesHost,
    private readonly t: IsleAddsKit,
  ) {
    // The lane's wind: a strip from the Herald (z 0) to the lane's end (z 1).
    const windGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    windGeo.rotateX(Math.PI / 2);
    windGeo.translate(0, 0, 0.5);
    h.geometries.push(windGeo);
    for (let k = 0; k < P.lanes; k++) {
      const lane = t.kit.lane(13);
      const painted = t.paints.dress(lane, 'gust');
      const windMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathShoveWind',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(PC.ward) },
          uFill: { value: 0 },
          uGlow: { value: 1 },
        },
        vertexShader: PHASE_UV_VERT,
        fragmentShader: LANE_WIND_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      h.materials.push(windMat);
      const wind = new THREE.Mesh(windGeo, windMat);
      wind.name = 'smithHeartBreathShoveWind';
      wind.renderOrder = floorVfxRenderOrder('encounter', 14);
      wind.frustumCulled = false;
      wind.visible = false;
      h.root.add(wind);
      this.lanes.push({ lane, painted, wind, windMat, id: -1 });
    }
    const shieldGeo = new THREE.SphereGeometry(
      1,
      48,
      10,
      0,
      Math.PI * 2,
      Math.PI * 0.1,
      Math.PI * 0.44,
    );
    const floorGeo = new THREE.CircleGeometry(1, 48);
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(0, 0.08, 0);
    const chip = new THREE.DodecahedronGeometry(1, 0);
    // The kits' shared stone reads its paint from the vertex colour.
    const chipN = chip.getAttribute('position').count;
    const chipCol = new Float32Array(chipN * 3);
    for (let k = 0; k < chipN; k++) {
      const v = 0.5 + 0.1 * ((k * 5) % 3);
      chipCol[k * 3] = v;
      chipCol[k * 3 + 1] = v * 1.02;
      chipCol[k * 3 + 2] = v * 1.06;
    }
    chip.setAttribute('color', new THREE.BufferAttribute(chipCol, 3));
    h.geometries.push(shieldGeo, floorGeo, chip);
    for (let k = 0; k < P.wards; k++) {
      const group = new THREE.Group();
      group.name = 'smithHeartBreathSquallWard';
      group.visible = false;
      h.root.add(group);
      const shieldMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathSquallWard',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(PC.ward) },
          uRim: { value: new THREE.Color(PC.wardRim) },
          uGlow: { value: 1 },
          uHalf: { value: Math.PI / 3 },
        },
        vertexShader: PHASE_SHELL_VERT,
        fragmentShader: WARD_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      h.materials.push(shieldMat);
      const shield = new THREE.Mesh(shieldGeo, shieldMat);
      shield.scale.set(WARD_SHAPE.radius, WARD_SHAPE.height, WARD_SHAPE.radius);
      shield.position.y = 0.3;
      shield.frustumCulled = false;
      group.add(shield);
      const floorMat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathSquallWardFloor',
        uniforms: {
          uTime: h.uTime,
          uColor: { value: new THREE.Color(PC.ward) },
          uGlow: { value: 1 },
          uHalf: { value: Math.PI / 3 },
        },
        vertexShader: PHASE_UV_VERT,
        fragmentShader: WARD_FLOOR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      h.materials.push(floorMat);
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.scale.setScalar(WARD_SHAPE.floor);
      // The disc's +y (its arc's middle) turned to the group's +z.
      floor.rotation.y = Math.PI;
      floor.renderOrder = floorVfxRenderOrder('encounter', 9);
      floor.frustumCulled = false;
      group.add(floor);
      const stones = new THREE.InstancedMesh(chip, heartKitSlotMaterial('stone'), WARD_STONES);
      stones.frustumCulled = false;
      stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(stones);
      this.wards.push({ group, shield, shieldMat, floor, floorMat, stones, id: -1 });
    }
    for (let k = 0; k < P.mendBeams; k++)
      this.beams.push({
        beam: new IsleBeam(h, 'smithHeartBreathMendBeam', PC.mend, 0xffffff),
        mender: -1,
        ally: -1,
        live: false,
        flare: 0,
        endAt: Number.NaN,
        cutAt: Number.NaN,
      });
  }

  beginScan(): void {
    this.heralds.length = 0;
    this.shields.length = 0;
    this.menders.length = 0;
    this.adds.length = 0;
  }

  /** A living isle add. */
  takeMob(e: Entity): void {
    this.adds.push(e.id);
    if (e.templateId === ISLE_MOBS.herald) this.heralds.push(e.id);
    else if (e.templateId === ISLE_MOBS.mender) this.menders.push(e.id);
    else if (e.templateId === ISLE_MOBS.shieldbearer) this.shields.push(e.id);
  }

  endScan(): void {
    this.lanes.forEach((l, k) => {
      l.id = k < this.heralds.length ? this.heralds[k] : -1;
      if (l.id < 0) {
        l.lane.group.visible = false;
        l.wind.visible = false;
      }
    });
    this.wards.forEach((w, k) => {
      w.id = k < this.shields.length ? this.shields[k] : -1;
      if (w.id < 0) w.group.visible = false;
    });
  }

  update(world: IWorld, dt: number): void {
    this.clock += dt;
    const t = this.h.uTime.value;
    // ---- the Heralds' lanes ----
    for (const l of this.lanes) {
      const e = l.id >= 0 ? world.entities.get(l.id) : undefined;
      if (!e || e.dead || e.castingAbility !== ISLE_CASTS.shove) {
        l.lane.group.visible = false;
        l.wind.visible = false;
        continue;
      }
      const a = fxAnchor(e);
      this.laneY = e.pos.y;
      const fill = 1 - e.castRemaining / Math.max(0.01, e.castTotal);
      l.lane.group.visible = true;
      this.t.kit.drapeLane(
        l.lane,
        this.laneGround,
        a.x,
        e.pos.y,
        a.z,
        e.facing,
        SHOVE_LANE.length,
        SHOVE_LANE.half,
        { color: TELEGRAPH_THREAT_COLORS.control, accent: PC.ward },
      );
      this.t.kit.paintLane(l.lane, { fill, clock: this.clock, range: SHOVE_LANE.length });
      // Its wind streaming down it, bright where the bar has filled.
      l.wind.visible = true;
      l.wind.position.set(a.x, this.laneGround(a.x, a.z) + 0.16, a.z);
      l.wind.rotation.y = e.facing;
      l.wind.scale.set(SHOVE_LANE.half * 2, 1, SHOVE_LANE.length);
      l.windMat.uniforms.uFill.value = fill;
      l.windMat.uniforms.uGlow.value = 0.9 + 0.5 * fill;
      // Wind gathering at the Herald's hands, drawn down the lane (cosmetic).
      if (this.rand() < dt * 18 * this.h.density) {
        const along = this.rand() * SHOVE_LANE.length * fill;
        const across = (this.rand() - 0.5) * SHOVE_LANE.half * 1.6;
        const sx = Math.sin(e.facing);
        const sz = Math.cos(e.facing);
        this.h.particles.puff(
          a.x + sx * along + sz * across,
          e.pos.y + 0.4,
          a.z + sz * along - sx * across,
          1,
          {
            speed: 6,
            life: 0.6,
            size: [0.5, 0.12],
            color: WIND_RGB,
            alpha: 0.85,
            pool: 'glow',
            dir: [sx, 0.1, sz],
            spread: 0.1,
            drag: 0.5,
          },
        );
      }
    }
    // ---- the Shieldbearers' wards ----
    for (const w of this.wards) {
      const e = w.id >= 0 ? world.entities.get(w.id) : undefined;
      const aura = e && !e.dead ? e.auras.find((x) => x.id === ISLE_AURAS.ward) : undefined;
      if (!e || !aura) {
        w.group.visible = false;
        continue;
      }
      const a = fxAnchor(e);
      const half = wardHalfArc(aura.value2);
      w.group.visible = true;
      w.group.position.set(a.x, e.pos.y, a.z);
      w.group.rotation.y = e.facing;
      // Round its body, never a dome over the raid: its scale held near 1.
      w.group.scale.setScalar(Math.min(1.45, Math.max(1, (e.scale ?? 1) * 0.6)));
      w.shieldMat.uniforms.uHalf.value = half;
      w.shieldMat.uniforms.uGlow.value = 0.6 + 0.1 * Math.sin(t * 4.2);
      w.floorMat.uniforms.uHalf.value = half;
      w.floorMat.uniforms.uGlow.value = 0.75 + 0.1 * Math.sin(t * 3);
      // The stone riding in the shield's wind, across the arc.
      for (let k = 0; k < WARD_STONES; k++) {
        const u = (((k / WARD_STONES + t * 0.12 * (k % 2 === 0 ? 1 : -1)) % 1) + 1) % 1;
        const ang = (u * 2 - 1) * half;
        const r = WARD_SHAPE.radius * (1.02 + 0.05 * Math.sin(t + k));
        const y = 0.6 + ((k * 0.37) % 1) * WARD_SHAPE.height * 0.7;
        _e.set(t * (0.7 + k * 0.1), t * 0.5, k);
        _q.setFromEuler(_e);
        const size = 0.13 + 0.06 * ((k * 0.61) % 1);
        _m.compose(
          _p.set(Math.sin(ang) * r, y, Math.cos(ang) * r),
          _q,
          _s.set(size, size * 0.8, size),
        );
        w.stones.setMatrixAt(k, _m);
      }
      w.stones.instanceMatrix.needsUpdate = true;
    }
    // ---- the Menders' beams ----
    this.updateBeams(world, dt, t);
  }

  private updateBeams(world: IWorld, dt: number, t: number): void {
    for (const b of this.beams) b.live = false;
    for (const mid of this.menders) {
      const m = world.entities.get(mid);
      if (!m || m.dead || m.castingAbility !== ISLE_CASTS.mending) continue;
      for (const aid of this.adds) {
        if (aid === mid) continue;
        const ally = world.entities.get(aid);
        if (!ally || ally.dead) continue;
        // Its own isle's adds only (the sim mends no other).
        if (this.isleOf(ally.pos.x, ally.pos.z) !== this.isleOf(m.pos.x, m.pos.z)) continue;
        let slot = this.beams.find((b) => b.mender === mid && b.ally === aid);
        if (!slot) {
          slot = this.beams.find(
            (b) =>
              b.mender < 0 ||
              (!Number.isNaN(b.endAt) &&
                b.flare <= 0 &&
                !Number.isNaN(b.cutAt) &&
                this.clock - b.cutAt > 0.8),
          );
          if (!slot) continue;
          slot.mender = mid;
          slot.ally = aid;
          slot.flare = 0;
        }
        slot.live = true;
        slot.endAt = Number.NaN;
        slot.cutAt = Number.NaN;
      }
    }
    for (const b of this.beams) {
      b.flare = Math.max(0, b.flare - dt * 1.6);
      if (b.mender < 0) continue;
      if (!b.live && Number.isNaN(b.endAt)) b.endAt = this.clock;
      const m = world.entities.get(b.mender);
      const ally = world.entities.get(b.ally);
      if (m && ally) {
        const ma = fxAnchor(m);
        const aa = fxAnchor(ally);
        _from.x = ma.x;
        _from.y = m.pos.y + 1.6 * Math.max(1, m.scale ?? 1);
        _from.z = ma.z;
        _to.x = aa.x;
        _to.y = ally.pos.y + 1.3 * Math.max(1, ally.scale ?? 1);
        _to.z = aa.z;
      }
      // Ended a breath ago with no mend's flare: it was cut.
      if (!b.live && Number.isNaN(b.cutAt) && b.flare < 0.5 && this.clock - b.endAt > 0.25)
        this.cut(b, t);
      const cut = !Number.isNaN(b.cutAt);
      const cutLook = cut ? beamCutLook(this.clock - b.cutAt) : null;
      if (!m || !ally || (!b.live && b.flare <= 0 && (!cutLook || cutLook.glow <= 0))) {
        b.beam.hide();
        if (!b.live) {
          b.mender = -1;
          b.ally = -1;
        }
        continue;
      }
      const d = Math.hypot(_to.x - _from.x, _to.z - _from.z);
      b.beam.lay(_from, _to, beamHalf(d), beamLift(d), 0.3 * Math.min(1, d / 4), t);
      if (cutLook) b.beam.paint(1.6 * cutLook.glow, cutLook.cut);
      else b.beam.paint((b.live ? 2 + 0.4 * Math.sin(t * 11) : 0) + b.flare * 2.4, 0);
      // The mint wind gathering in the Mender's raised hands.
      if (b.live && this.rand() < dt * 16 * (0.5 + 0.5 * this.h.density))
        this.h.particles.puff(_from.x, _from.y, _from.z, 2, {
          speed: 1.5,
          life: 0.45,
          size: [1.1, 0.2],
          color: MEND_RGB,
          alpha: 1,
          pool: 'glow',
          floor: -1e6,
        });
      if (b.live && this.rand() < dt * 14 * (0.5 + 0.5 * this.h.density)) {
        const p = IsleBeam.point(_from, _to, this.rand(), beamLift(d), 0.3, t);
        this.h.particles.puff(p.x, p.y, p.z, 1, {
          speed: 1,
          life: 0.5,
          size: [0.4, 0.1],
          color: MEND_RGB,
          alpha: 0.95,
          pool: 'glow',
          floor: -1e6,
        });
      }
    }
  }

  /** The isle under world (x, z) (its floor), or -1. */
  private isleOf(x: number, z: number): number {
    const o = this.h.local.position;
    return isleAt(x - o.x, z - o.z);
  }

  private cut(b: BeamSlot, t: number): void {
    b.cutAt = this.clock;
    const m = this.beamMid(b, t);
    if (!m) return;
    const n = Math.round(18 * (0.5 + 0.5 * this.h.density));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      this.h.particles.puff(m.x, m.y, m.z, 1, {
        speed: 7 + this.rand() * 7,
        life: 0.55,
        size: [0.45, 0.1],
        color: MEND_RGB,
        alpha: 1,
        pool: 'glow',
        dir: [Math.sin(a), this.rand() - 0.3, Math.cos(a)],
        spread: 0.3,
        drag: 1.4,
        gravity: 6,
        floor: -1e6,
      });
    }
  }

  private beamMid(_b: BeamSlot, t: number): { x: number; y: number; z: number } | null {
    const d = Math.hypot(_to.x - _from.x, _to.z - _from.z);
    if (!(d > 0)) return null;
    return IsleBeam.point(_from, _to, 0.5, beamLift(d), 0.3, t);
  }

  /** Mending Gale landed on `allyId` from `menderId` (the cue). */
  mended(world: IWorld, menderId: number, allyId: number): void {
    const b = this.beams.find((q) => q.mender === menderId && q.ally === allyId);
    if (b) b.flare = 1;
    const ally = world.entities.get(allyId);
    if (!ally) return;
    const a = fxAnchor(ally);
    this.h.particles.puff(a.x, ally.pos.y + 1.4, a.z, 14, {
      speed: 4,
      up: 2,
      life: 0.8,
      size: [0.8, 0.15],
      color: MEND_RGB,
      alpha: 1,
      pool: 'glow',
      spread: 1,
      drag: 0.8,
    });
  }

  /** Shoving Gale landed (the cue on its Herald): a gust down its lane. */
  shoved(world: IWorld, heraldId: number): void {
    const e = world.entities.get(heraldId);
    if (!e) return;
    const a = fxAnchor(e);
    const sx = Math.sin(e.facing);
    const sz = Math.cos(e.facing);
    const n = Math.round(46 * (0.4 + 0.6 * this.h.density));
    for (let i = 0; i < n; i++) {
      const across = (this.rand() - 0.5) * SHOVE_LANE.half * 2;
      const back = this.rand() * 3;
      this.h.particles.puff(
        a.x - sx * back + sz * across,
        e.pos.y + 0.3 + this.rand() * 2.5,
        a.z - sz * back - sx * across,
        1,
        {
          speed: 22 + this.rand() * 12,
          life: 1,
          size: [0.9, 0.25],
          color: this.rand() < 0.5 ? WIND_RGB : [1, 1, 1],
          alpha: 0.9,
          pool: 'glow',
          dir: [sx, 0.05, sz],
          spread: 0.08,
          drag: 0.9,
          floor: -1e6,
        },
      );
    }
    for (let i = 0; i < Math.round(20 * this.h.density); i++) {
      const along = this.rand() * SHOVE_LANE.length * 0.6;
      this.h.particles.puff(a.x + sx * along, e.pos.y + 0.3, a.z + sz * along, 1, {
        speed: 10,
        life: 1.2,
        size: [0.6, 1.8],
        color: GRIT_RGB,
        alpha: 0.45,
        dir: [sx, 0.2, sz],
        spread: 0.3,
        drag: 1.2,
      });
    }
    this.h.particles.shockRing(a.x + sx * 3, a.z + sz * 3, PC.ward, 7, 0.5);
    this.h.shakeNear(a.x, a.z, 0.25, 26);
  }

  /** A Riven Squall split at (x, z) (world). */
  split(x: number, z: number): void {
    const y = this.h.groundY(x, z);
    const n = Math.round(40 * (0.4 + 0.6 * this.h.density));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const up = 0.2 + this.rand() * 0.9;
      this.h.particles.puff(x, y + 1.6, z, 1, {
        speed: 8 + this.rand() * 9,
        life: 0.9,
        size: [0.7, 0.15],
        color: this.rand() < 0.5 ? WIND_RGB : [0.75, 0.6, 1],
        alpha: 1,
        pool: 'glow',
        dir: [Math.sin(a), up, Math.cos(a)],
        spread: 0.3,
        drag: 1,
      });
    }
    for (let i = 0; i < Math.round(14 * this.h.density); i++) {
      const a = this.rand() * Math.PI * 2;
      this.h.particles.puff(x, y + 0.5, z, 1, {
        speed: 5,
        life: 1.4,
        size: [0.8, 2.6],
        color: GRIT_RGB,
        alpha: 0.5,
        dir: [Math.sin(a), 0.3, Math.cos(a)],
        spread: 0.2,
        drag: 1,
      });
    }
    this.h.particles.shockRing(x, z, PC.angry, 9, 0.7);
    this.h.particles.shockRing(x, z, 0xffffff, 5, 0.4);
    this.h.shakeNear(x, z, 0.2, 20);
  }

  leave(): void {
    for (const l of this.lanes) {
      l.id = -1;
      l.lane.group.visible = false;
      l.wind.visible = false;
    }
    for (const w of this.wards) {
      w.id = -1;
      w.group.visible = false;
    }
    for (const b of this.beams) {
      b.mender = -1;
      b.ally = -1;
      b.beam.hide();
    }
  }

  dispose(): void {
    for (const w of this.wards) w.stones.dispose();
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }
}

// The Tidebound Acolyte's Brine Column (plan: bastion_trash_fx_core.ts): a
// swirling column of sea water round the player its channel roots (the
// BASTION_BRINE_COLUMN root aura): two counter-turning sleeves of water with
// foam in the vortex, bubbles rising through it, spray off its crown and a
// ring of foam at its foot, fed by a stream poured from the acolyte's conch
// while it channels. On the last tick (spellfx nova) it collapses in a
// splash; if the root vanished without that cue the channel broke, and the
// water bursts apart sideways.
//
// The column draws on EVERY tier (a rooted, drowning friend is what a kick or
// a stun answers); the bubbles, spray and splashes shed with the effects
// density. Pooled, built once, no per-frame allocation.

import * as THREE from 'three';
import { BASTION_BRINE_COLUMN } from '../../sim/mob/trash_kit/bastion_cast_ids';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  ACOLYTE,
  ACOLYTE_CONCH,
  ACOLYTE_RAW_HEIGHT,
  COLUMN_HEIGHT,
  COLUMN_RADIUS,
  type ColumnStage,
  columnPhase,
  columnShape,
  streamPoint,
  TRASH_FX_SLOTS,
} from './bastion_trash_fx_core';
import {
  LOOK,
  SHELL_MODE,
  type ShellSlot,
  type ShellUniforms,
  softRing,
  type TrashBody,
  type TrashFxKit,
} from './bastion_trash_fx_kit';

const STREAM_SEGMENTS = 22;
/** Seconds a column waits for its landing cue once its root vanished before
 *  it reads the channel as broken. */
const COLUMN_CUE_GRACE = 0.18;
const WATER = new THREE.Color(0.22, 0.55, 0.58);

/** The poured stream: two crossed strips of STREAM_SEGMENTS segments whose
 *  positions are written while it pours. */
function streamGeometry(): THREE.BufferGeometry {
  const n = STREAM_SEGMENTS + 1;
  const uv = new Float32Array(n * 4 * 2);
  const nrm = new Float32Array(n * 4 * 3);
  const idx: number[] = [];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < n; i++) {
      const v = s * n * 2 + i * 2;
      uv.set([i / STREAM_SEGMENTS, 0, i / STREAM_SEGMENTS, 1], v * 2);
      nrm.set([0, 1, 0, 0, 1, 0], v * 3);
      if (i < STREAM_SEGMENTS) idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3);
  g.setAttribute('position', pos.setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

interface ColumnSlot {
  group: THREE.Group;
  outer: ShellSlot;
  inner: ShellSlot;
  foamMat: THREE.MeshBasicMaterial;
  foam: THREE.Mesh;
  stream: THREE.Mesh;
  streamU: ShellUniforms;
  streamPos: THREE.BufferAttribute;
  victimId: number;
  casterId: number;
  x: number;
  y: number;
  z: number;
  born: number;
  /** When the column ended (its last tick, or its channel broke), or -1. */
  endedAt: number;
  broke: boolean;
  /** When its root was first seen gone without the landing cue, or -1. */
  missingSince: number;
  nextBubble: number;
  burstDone: boolean;
}

export class BastionBrineColumnFx {
  private readonly slots: ColumnSlot[] = [];
  private readonly conch = { x: 0, y: 0, z: 0 };
  private readonly at = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly kit: TrashFxKit,
    sleeve: THREE.BufferGeometry,
  ) {
    const foamGeo = softRing(64);
    kit.geometries.push(foamGeo);
    for (let i = 0; i < TRASH_FX_SLOTS.columns; i++) {
      const group = new THREE.Group();
      group.name = 'bastion-brine-column';
      group.visible = false;
      kit.root.add(group);
      const outer = kit.shellSlot(group, sleeve, SHELL_MODE.water, WATER, false);
      const inner = kit.shellSlot(
        group,
        sleeve,
        SHELL_MODE.water,
        WATER.clone().multiplyScalar(1.3),
        true,
      );
      // The inner sleeve turns the other way (its seed flips the swirl).
      inner.u.uSeed.value += 37;
      outer.mesh.visible = true;
      inner.mesh.visible = true;
      const foamMat = new THREE.MeshBasicMaterial({
        color: 0xd8fff4,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      kit.materials.push(foamMat);
      const foam = new THREE.Mesh(foamGeo, foamMat);
      foam.renderOrder = floorVfxRenderOrder('encounter', 12);
      foam.position.y = 0.06;
      group.add(foam);
      const streamGeo = streamGeometry();
      kit.geometries.push(streamGeo);
      const { u: streamU, mat } = kit.shellMaterial(
        SHELL_MODE.band,
        WATER.clone().multiplyScalar(1.7),
        false,
      );
      const stream = new THREE.Mesh(streamGeo, mat);
      stream.renderOrder = floorVfxRenderOrder('encounter', 29);
      stream.frustumCulled = false;
      stream.visible = false;
      kit.root.add(stream);
      this.slots.push({
        group,
        outer,
        inner,
        foamMat,
        foam,
        stream,
        streamU,
        streamPos: streamGeo.getAttribute('position') as THREE.BufferAttribute,
        victimId: -1,
        casterId: -1,
        x: 0,
        y: 0,
        z: 0,
        born: 0,
        endedAt: -1,
        broke: false,
        missingSince: -1,
        nextBubble: 0,
        burstDone: false,
      });
    }
  }

  /** A rooted victim the scan found (its column aura's caster `casterId`). */
  claim(victim: TrashBody, casterId: number): void {
    const kit = this.kit;
    const live = this.slots.find((c) => c.victimId === victim.id && c.endedAt < 0);
    if (live) {
      live.missingSince = -1;
      return;
    }
    // Never takes a standing column; a full pool leaves the newcomer to the
    // next scan (claim is asked every scan while the root holds).
    const slot = this.slots.find((c) => c.victimId < 0);
    if (!slot) return;
    slot.victimId = victim.id;
    slot.casterId = casterId;
    slot.x = victim.pos.x;
    slot.y = kit.groundY(victim.pos.x, victim.pos.z);
    slot.z = victim.pos.z;
    slot.born = kit.now;
    slot.endedAt = -1;
    slot.broke = false;
    slot.missingSince = -1;
    slot.nextBubble = kit.now;
    slot.burstDone = false;
    slot.group.visible = true;
    // It erupts out of the flags under them.
    kit.splash(slot.x, slot.y + 0.2, slot.z, 18, 5, 4);
    kit.ring(slot.x, slot.z, 0xd8fff4, 0.4, COLUMN_RADIUS * 2.2, 0.5, 0.9);
  }

  /** The channel ran out (its last tick's spellfx nova): the column falls. */
  landed(victimId: number): void {
    const slot = this.slots.find((c) => c.victimId === victimId && c.endedAt < 0);
    if (!slot) return;
    slot.endedAt = this.kit.now;
    slot.broke = false;
    // A ring of water slapping out over the flags and spray thrown up.
    this.kit.splash(slot.x, slot.y + 1.2, slot.z, 30, 6, 6);
    this.kit.ring(slot.x, slot.z, 0xd8fff4, COLUMN_RADIUS, COLUMN_RADIUS * 4, 0.7, 1);
  }

  /** The scan's check: a column whose root vanished starts its grace. */
  scan(world: IWorld): void {
    for (const slot of this.slots) {
      if (slot.victimId < 0 || slot.endedAt >= 0) continue;
      const v = world.entities.get(slot.victimId);
      const rooted = v?.auras.some((a) => a.id === BASTION_BRINE_COLUMN && a.kind === 'root');
      if (rooted && !v?.dead) slot.missingSince = -1;
      else if (slot.missingSince < 0) slot.missingSince = this.kit.now;
    }
  }

  update(world: IWorld): void {
    const kit = this.kit;
    for (const slot of this.slots) {
      if (slot.victimId < 0) continue;
      const lost = slot.missingSince >= 0 && kit.now - slot.missingSince > COLUMN_CUE_GRACE;
      if (slot.endedAt < 0 && lost) {
        slot.endedAt = kit.now;
        slot.broke = true;
      }
      const v = world.entities.get(slot.victimId);
      if (v && slot.endedAt < 0) {
        slot.x = v.pos.x;
        slot.z = v.pos.z;
        slot.y = kit.groundY(v.pos.x, v.pos.z);
      }
      const ended = slot.endedAt < 0 ? -1 : kit.now - slot.endedAt;
      const phase = columnPhase(kit.now - slot.born, ended, slot.broke);
      if (phase.stage === 'done') {
        slot.victimId = -1;
        slot.group.visible = false;
        slot.stream.visible = false;
        continue;
      }
      if (phase.stage === 'burst' && !slot.burstDone) {
        slot.burstDone = true;
        this.burst(slot);
      }
      const shape = columnShape(phase.stage, phase.k);
      slot.group.position.set(slot.x, slot.y, slot.z);
      const r = COLUMN_RADIUS * shape.width;
      const h = Math.max(0.01, COLUMN_HEIGHT * shape.height);
      slot.outer.mesh.scale.set(r, h, r);
      slot.inner.mesh.scale.set(r * 0.72, h * 0.94, r * 0.72);
      const ending = phase.stage === 'collapse' || phase.stage === 'burst';
      const fade = ending ? 1 - phase.k : 1;
      slot.outer.u.uAlpha.value = 0.95 * fade;
      slot.inner.u.uAlpha.value = 0.55 * fade;
      slot.foam.scale.set(r * 1.5, 1, r * 1.5);
      slot.foamMat.opacity = 0.75 * fade;
      if (phase.stage === 'hold' && kit.now >= slot.nextBubble && kit.near(slot.x, slot.z)) {
        slot.nextBubble = kit.now + kit.every(0.06);
        this.churn(slot);
      }
      this.pour(world, slot, phase.stage);
    }
  }

  /** Bubbles rising through the column and spray thrown off its crown. */
  private churn(slot: ColumnSlot): void {
    const kit = this.kit;
    const a = kit.rand() * Math.PI * 2;
    const rr = kit.rand() * COLUMN_RADIUS * 0.8;
    const by = slot.y + 0.3 + kit.rand() * 0.6;
    const bx = slot.x + Math.cos(a) * rr;
    const bz = slot.z + Math.sin(a) * rr;
    kit.emit(kit.glow, LOOK.bubble, bx, by, bz, 0, 2 + kit.rand() * 1.5, 0, 1);
    const c = kit.rand() * Math.PI * 2;
    const ox = Math.cos(c);
    const oz = Math.sin(c);
    const top = slot.y + COLUMN_HEIGHT;
    const sx = slot.x + ox * COLUMN_RADIUS;
    const sz = slot.z + oz * COLUMN_RADIUS;
    kit.emit(kit.glow, LOOK.drop, sx, top, sz, ox * 2.4, 1.5 + kit.rand(), oz * 2.4, 0.6, 0.8);
  }

  /** The channel broke: the water bursts apart sideways. */
  private burst(slot: ColumnSlot): void {
    const kit = this.kit;
    const n = kit.reducedMotion() ? 6 : kit.count(34);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + kit.rand() * 0.2;
      const ox = Math.cos(a);
      const oz = Math.sin(a);
      const sp = 6 + kit.rand() * 5;
      const y = slot.y + 0.4 + kit.rand() * COLUMN_HEIGHT * 0.8;
      const x = slot.x + ox * COLUMN_RADIUS;
      const z = slot.z + oz * COLUMN_RADIUS;
      kit.emit(
        kit.glow,
        LOOK.drop,
        x,
        y,
        z,
        ox * sp,
        kit.rand() * 3,
        oz * sp,
        0.5 + kit.rand() * 0.3,
      );
    }
    kit.splash(slot.x, slot.y + 1, slot.z, 10, 4, 5);
    kit.ring(slot.x, slot.z, 0xbfe8dc, COLUMN_RADIUS, COLUMN_RADIUS * 3, 0.5, 0.8);
  }

  /** The water poured from the acolyte's conch to the column's crown while
   *  it channels. */
  private pour(world: IWorld, slot: ColumnSlot, stage: ColumnStage): void {
    const kit = this.kit;
    const caster = world.entities.get(slot.casterId);
    const pouring =
      !!caster &&
      !caster.dead &&
      caster.templateId === ACOLYTE &&
      caster.castingAbility === BASTION_BRINE_COLUMN &&
      (stage === 'rise' || stage === 'hold');
    if (!caster || !pouring) {
      slot.stream.visible = false;
      return;
    }
    const c = kit.point(caster, kit.scaleOf(caster, ACOLYTE_RAW_HEIGHT), ACOLYTE_CONCH, this.conch);
    const y1 = slot.y + COLUMN_HEIGHT * 0.92;
    const pos = slot.streamPos;
    const n = STREAM_SEGMENTS + 1;
    // Across the stream on the ground plane (the flat strip) and straight up.
    let ax = slot.z - c.z;
    let az = -(slot.x - c.x);
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    for (let i = 0; i < n; i++) {
      const t = i / STREAM_SEGMENTS;
      const p = streamPoint(t, c.x, c.y, c.z, slot.x, y1, slot.z, this.at);
      const w = 0.21 * (0.6 + 0.4 * Math.sin(Math.PI * t));
      pos.setXYZ(i * 2, p.x - ax * w, p.y, p.z - az * w);
      pos.setXYZ(i * 2 + 1, p.x + ax * w, p.y, p.z + az * w);
      pos.setXYZ(n * 2 + i * 2, p.x, p.y - w, p.z);
      pos.setXYZ(n * 2 + i * 2 + 1, p.x, p.y + w, p.z);
    }
    pos.needsUpdate = true;
    slot.streamU.uAlpha.value = 0.95;
    slot.stream.visible = true;
  }
}

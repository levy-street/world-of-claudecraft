// The Drowned Watchman's Boathook Drag (plan: bastion_trash_fx_core.ts): a
// rusted boathook on a heavy mooring chain shot down the lane the floor
// marked. When it catches someone the chain snaps taut from the watchman's
// fist to them for the whole drag (the sim moves them; the chain is laid
// between the two live bodies every frame), with a burst of brine where it
// bit; a miss splashes at the lane's end and reels back in slack.
//
// The hook and the chain draw on EVERY tier (the chain says who is being
// dragged and by whom); the splashes shed with the effects density. Pooled,
// built once, no per-frame allocation.

import * as THREE from 'three';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  CHAIN_MAX_LINKS,
  chainDrop,
  chainLinkCount,
  chainSag,
  HOOK_VICTIM_CHEST,
  type HookStage,
  hookFlightSeconds,
  hookPhase,
  hookSpec,
  TRASH_FX_SLOTS,
  WATCHMAN_HOOK_HAND,
  WATCHMAN_RAW_HEIGHT,
} from './bastion_trash_fx_core';
import { LOOK, SEA, type TrashFxKit } from './bastion_trash_fx_kit';

interface HookSlot {
  group: THREE.Group;
  hook: THREE.Group;
  chain: THREE.InstancedMesh;
  alive: boolean;
  watchmanId: number;
  victimId: number;
  caught: boolean;
  born: number;
  flight: number;
  end: THREE.Vector3;
  splashed: boolean;
}

export class BastionBoathookFx {
  private readonly slots: HookSlot[] = [];
  private readonly spec = hookSpec();
  private readonly hand = { x: 0, y: 0, z: 0 };
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly m = new THREE.Matrix4();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly roll = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    Math.PI / 2,
  );

  constructor(private readonly kit: TrashFxKit) {
    // The boathook, built once along +Z (the crook forward): a rusted iron
    // shank, the crook and its barbed point, the eye the chain runs from.
    const shank = new THREE.CylinderGeometry(0.07, 0.08, 1.3, 7);
    shank.rotateX(Math.PI / 2);
    const crook = new THREE.TorusGeometry(0.34, 0.07, 6, 14, Math.PI * 1.15);
    crook.rotateY(Math.PI / 2);
    crook.translate(0, 0.34, 0.62);
    const spike = new THREE.ConeGeometry(0.09, 0.42, 6);
    spike.rotateX(Math.PI / 2);
    spike.translate(0, 0, 0.82);
    const barb = new THREE.ConeGeometry(0.07, 0.3, 5);
    barb.rotateX(-Math.PI * 0.75);
    barb.translate(0, 0.62, 0.42);
    const eye = new THREE.TorusGeometry(0.13, 0.04, 6, 12);
    eye.translate(0, 0, -0.72);
    const glint = new THREE.SphereGeometry(0.3, 10, 8);
    // A heavy mooring-chain link: an oval torus along +Z, flat in XZ.
    const link = new THREE.TorusGeometry(0.13, 0.042, 5, 10);
    link.scale(1, 1.7, 1);
    link.rotateX(Math.PI / 2);
    kit.geometries.push(shank, crook, spike, barb, eye, glint, link);
    // Rusted iron with a breath of sea light, so it reads in the fog.
    const rust = new THREE.MeshLambertMaterial({ color: 0x6e4a32, emissive: 0x1a2622 });
    const iron = new THREE.MeshLambertMaterial({ color: 0x4a4440, emissive: 0x16302a });
    const glintMat = new THREE.MeshBasicMaterial({
      color: SEA.clone().multiplyScalar(0.8),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    kit.materials.push(rust, iron, glintMat);
    for (let i = 0; i < TRASH_FX_SLOTS.hooks; i++) {
      const group = new THREE.Group();
      group.name = 'bastion-boathook';
      group.visible = false;
      const hook = new THREE.Group();
      for (const g of [shank, crook, spike, barb, eye]) hook.add(new THREE.Mesh(g, rust));
      const halo = new THREE.Mesh(glint, glintMat);
      halo.position.z = 0.55;
      halo.renderOrder = floorVfxRenderOrder('encounter', 29);
      hook.add(halo);
      // Drawn big: a boathook a player reads at range.
      hook.scale.setScalar(1.6);
      const chain = new THREE.InstancedMesh(link, iron, CHAIN_MAX_LINKS);
      chain.count = 0;
      chain.frustumCulled = false;
      chain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(hook, chain);
      kit.root.add(group);
      this.slots.push({
        group,
        hook,
        chain,
        alive: false,
        watchmanId: -1,
        victimId: -1,
        caught: false,
        born: 0,
        flight: 0,
        end: new THREE.Vector3(),
        splashed: false,
      });
    }
  }

  /** The hook leaves the watchman's fist (spellfx heavyBolt): at the victim
   *  it caught, or down the lane when it caught nobody (target = itself). */
  throw(watchmanId: number, targetId: number): void {
    const kit = this.kit;
    const w = kit.world?.entities.get(watchmanId);
    if (!w) return;
    // A full pool drops the newcomer: a hook dragging someone is never cut.
    const slot = this.slots.find((h) => !h.alive);
    if (!slot) return;
    const victim = targetId !== watchmanId ? kit.world?.entities.get(targetId) : undefined;
    const hand = kit.point(w, kit.scaleOf(w, WATCHMAN_RAW_HEIGHT), WATCHMAN_HOOK_HAND, this.hand);
    if (victim) {
      slot.end.set(victim.pos.x, victim.pos.y + HOOK_VICTIM_CHEST, victim.pos.z);
    } else {
      const ex = w.pos.x + Math.sin(w.facing) * this.spec.length;
      const ez = w.pos.z + Math.cos(w.facing) * this.spec.length;
      slot.end.set(ex, kit.groundY(ex, ez) + 0.9, ez);
    }
    const dist = Math.hypot(slot.end.x - hand.x, slot.end.y - hand.y, slot.end.z - hand.z);
    slot.alive = true;
    slot.watchmanId = watchmanId;
    slot.victimId = victim ? targetId : -1;
    slot.caught = !!victim;
    slot.born = kit.now;
    slot.flight = hookFlightSeconds(dist);
    slot.splashed = false;
    slot.group.visible = true;
    // The throw: a crack of sea light at the fist and a spray of brine.
    kit.emit(kit.glow, LOOK.flash, hand.x, hand.y, hand.z, 0, 0, 0, 0.22, 1.6);
    kit.splash(hand.x, hand.y, hand.z, 8, 4, 2);
  }

  update(world: IWorld): void {
    const kit = this.kit;
    for (const slot of this.slots) {
      if (!slot.alive) continue;
      const w = world.entities.get(slot.watchmanId);
      const phase = hookPhase(kit.now - slot.born, slot.flight, slot.caught, this.spec.pullSeconds);
      if (!w || phase.stage === 'done') {
        slot.alive = false;
        slot.group.visible = false;
        slot.chain.count = 0;
        continue;
      }
      const hand = kit.point(w, kit.scaleOf(w, WATCHMAN_RAW_HEIGHT), WATCHMAN_HOOK_HAND, this.hand);
      this.from.set(hand.x, hand.y, hand.z);
      // While it holds them, the hook rides the victim's chest.
      if (slot.caught) {
        const v = world.entities.get(slot.victimId);
        if (v) slot.end.set(v.pos.x, v.pos.y + HOOK_VICTIM_CHEST, v.pos.z);
      }
      let reach = 1;
      if (phase.stage === 'fly') reach = phase.k;
      else if (phase.stage === 'reel') reach = 1 - phase.k;
      this.to.copy(this.from).lerp(slot.end, reach);
      if (phase.stage !== 'fly' && !slot.splashed) {
        slot.splashed = true;
        this.bite(slot);
      }
      // The hook itself, crook first along the chain.
      this.dir.copy(this.to).sub(this.from);
      const length = this.dir.length();
      slot.hook.position.copy(this.to);
      if (length > 1e-3)
        slot.hook.quaternion.setFromUnitVectors(this.zAxis, this.dir.divideScalar(length));
      this.layChain(slot, length, phase.stage, phase.k);
    }
  }

  /** Where the hook bites: brine burst off the victim, or a splash at the
   *  lane's end when it caught nobody. */
  private bite(slot: HookSlot): void {
    const kit = this.kit;
    const e = slot.end;
    if (slot.caught) {
      kit.splash(e.x, e.y, e.z, 22, 5.5, 5);
      kit.emit(kit.glow, LOOK.flash, e.x, e.y, e.z, 0, 0, 0, 0.3, 2);
      kit.ring(e.x, e.z, 0xd8fff4, 0.5, 3.2, 0.5, 0.9);
      return;
    }
    const floor = kit.groundY(e.x, e.z);
    kit.splash(e.x, floor + 0.2, e.z, 14, 4, 3);
    kit.ring(e.x, e.z, 0xbfe8dc, 0.4, 2.2, 0.45, 0.7);
  }

  /** Lay the chain's links from the fist (`from`) to the hook (`to`). */
  private layChain(slot: HookSlot, length: number, stage: HookStage, k: number): void {
    const n = chainLinkCount(length);
    const sag = chainSag(length, stage, k);
    // A taut chain thrums.
    const thrum = stage === 'drag' ? Math.sin(this.kit.now * 70) * 0.04 : 0;
    const a = this.from;
    const b = this.to;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const t2 = Math.min(1, t + 1 / n);
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t - chainDrop(t, sag) + thrum * Math.sin(Math.PI * t);
      const z = a.z + (b.z - a.z) * t;
      this.dir.set(
        a.x + (b.x - a.x) * t2 - x,
        a.y + (b.y - a.y) * t2 - chainDrop(t2, sag) - y,
        a.z + (b.z - a.z) * t2 - z,
      );
      if (this.dir.lengthSq() < 1e-8) this.dir.set(0, 0, 1);
      this.q.setFromUnitVectors(this.zAxis, this.dir.normalize());
      // Every other link turned a quarter, as a real chain hangs.
      if (i % 2 === 1) this.q.multiply(this.roll);
      this.m.makeRotationFromQuaternion(this.q);
      this.m.setPosition(x, y, z);
      slot.chain.setMatrixAt(i, this.m);
    }
    slot.chain.count = n;
    slot.chain.instanceMatrix.needsUpdate = true;
  }

  /** Frees each chain's instance buffer (the shared geometries and materials
   *  are the kit's to dispose). */
  dispose(): void {
    for (const slot of this.slots) slot.chain.dispose();
  }
}

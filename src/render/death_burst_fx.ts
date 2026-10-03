// The trash kit's death-burst rings (plan: death_burst_fx_core.ts): a dead kit
// mob with a delayed burst (sim/mob/trash_kit/death_burst.ts) leaves a ring on
// the floor where it fell, filling to the moment it bursts, so the melee can
// step out (the Gravewyrm Sanctum's Rime Whelp and Glacier Splinter). Every
// shape is the shared floor telegraph (./floor_telegraph).
//
// Rules (src/render/CLAUDE.md): pooled geometry and materials built once,
// attached through the compile gate, no per-frame allocation in the pool. The
// ring is ACTIONABLE: its footprint draws on every tier; only the flashes shed
// on the low tier. Everything is derived from IWorld entity state, so offline
// and online look the same.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { DEATH_BURST_RING } from '../sim/mob/trash_kit/death_burst';
import type { IWorld } from '../world_api';
import { burstDelayForRadius, burstRingFill, DEATH_BURST_RING_LOOK } from './death_burst_fx_core';
import { type TelegraphFan, TelegraphKit } from './floor_telegraph';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX } from './gfx';
import { setRenderCategory } from './renderer_diagnostics';

/** A whole pack can fall at once. */
const RING_SLOTS = 16;
const SCAN_SEC = 0.1;

interface RingSlot extends TelegraphFan {
  objectId: number;
  since: number;
}

export class DeathBurstFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly rings: RingSlot[] = [];
  private readonly kit: TelegraphKit;
  private scan = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.root.name = 'death-burst-rings';
    setRenderCategory(this.root, 'ui3d');
    const flashesOn =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.kit = new TelegraphKit(this.root, flashesOn);
    for (let i = 0; i < RING_SLOTS; i++) {
      const slot: RingSlot = { ...this.kit.fan(16), objectId: -1, since: 0 };
      this.kit.layOutFan(slot, 360, {
        color: DEATH_BURST_RING_LOOK.color,
        accent: DEATH_BURST_RING_LOOK.accent,
        sigil: false,
      });
      this.rings.push(slot);
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    for (const slot of this.rings) {
      if (slot.objectId < 0) continue;
      const obj = world.entities.get(slot.objectId);
      if (!obj || obj.templateId !== DEATH_BURST_RING) {
        slot.objectId = -1;
        slot.group.visible = false;
        continue;
      }
      const radius = obj.scale;
      const fill = burstRingFill(this.clock - slot.since, burstDelayForRadius(radius, obj.name));
      const x = obj.pos.x;
      const z = obj.pos.z;
      this.kit.drapeFan(slot, this.groundY, x, this.groundY(x, z), z, 0, radius);
      this.kit.paintFan(slot, { fill, clock: this.clock, range: radius });
    }
  }

  private scanWorld(world: IWorld): void {
    for (const e of world.entities.values()) {
      if (e.kind === 'player' || e.kind === 'mob' || e.templateId !== DEATH_BURST_RING) continue;
      if (this.rings.some((r) => r.objectId === e.id)) continue;
      const slot = this.rings.find((r) => r.objectId < 0);
      if (!slot) return;
      slot.objectId = e.id;
      slot.since = this.clock;
      slot.group.visible = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.kit.dispose();
  }
}

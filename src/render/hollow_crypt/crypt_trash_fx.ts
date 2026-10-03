// The Hollow Crypt trash telegraphs and impacts (plan: crypt_trash_fx_core.ts):
//  - a floor telegraph under every trash cast you dodge, filling as its bar
//    runs: the Ossuary Warrior's Grave Cleave cone, the drake's Barrowflame
//    Breath cone and Tail Lash behind it, the Wing Gust and Stone Shriek rings,
//    and a kick glyph on the grave a Raise Bones is opening (and round a
//    Murder Call);
//  - the Bone Minion's burst ring, filling over its fuse where it fell;
//  - a flash when a strike lands.
// Every shape is the shared floor telegraph (../floor_telegraph): the same
// layered look, threat colours and edge glow as every other dungeon.
//
// Rules (src/render/CLAUDE.md): every geometry and material is pooled and
// built once, attached through the compile gate; no per-frame allocation. The
// telegraphs are ACTIONABLE, so their footprint draws on every graphics tier
// (fairness: docs/design/graphics-settings-fairness.md); the edge curtains,
// flowing bands and motes and the landing flashes are cosmetic and shed on the
// low tier. Everything is derived from IWorld entity state (cast fields, the
// dead flag), so offline and online look the same.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { TELEGRAPH_ACCENTS, type TelegraphFan, TelegraphKit } from '../floor_telegraph';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  boneBurstPhase,
  boneBurstSpec,
  CRYPT_TELEGRAPH_COLORS,
  type CryptTelegraphSpec,
  cryptTelegraphSpecs,
  telegraphFill,
  telegraphYaw,
} from './crypt_trash_fx_core';

const TELEGRAPH_SLOTS = 10;
const BURST_SLOTS = 8;
const FLASH_SLOTS = 6;
const SCAN_SEC = 0.1;
const FLASH_SEC = 0.5;
const BONE_MINION = 'crypt_bone_minion';

interface TelegraphSlot extends TelegraphFan {
  casterId: number;
  castId: string;
}

interface BurstSlot extends TelegraphFan {
  corpseId: number;
  since: number;
}

interface FlashSlot extends TelegraphFan {
  age: number;
  radius: number;
  x: number;
  z: number;
}

export class CryptTrashFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly specs = cryptTelegraphSpecs();
  private readonly burst = boneBurstSpec();
  private readonly telegraphs: TelegraphSlot[] = [];
  private readonly bursts: BurstSlot[] = [];
  private readonly flashes: FlashSlot[] = [];
  private readonly flashesOn: boolean;
  private readonly kit: TelegraphKit;
  private readonly seenDead = new Set<number>();
  private scan = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
  ) {
    this.root.name = 'crypt-trash-telegraphs';
    setRenderCategory(this.root, 'ui3d');
    this.flashesOn =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.kit = new TelegraphKit(this.root, this.flashesOn);
    for (let i = 0; i < TELEGRAPH_SLOTS; i++)
      this.telegraphs.push({ ...this.kit.fan(18), casterId: -1, castId: '' });
    for (let i = 0; i < BURST_SLOTS; i++)
      this.bursts.push({ ...this.kit.fan(15), corpseId: -1, since: 0 });
    if (this.flashesOn) {
      for (let i = 0; i < FLASH_SLOTS; i++)
        this.flashes.push({ ...this.kit.fan(21), age: -1, radius: 1, x: 0, z: 0 });
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private layOut(slot: TelegraphFan, spec: CryptTelegraphSpec): void {
    this.kit.layOutFan(slot, spec.arcDeg, {
      color: spec.color,
      accent: spec.accent,
      sigil: spec.shape === 'sigil',
    });
  }

  /** A landing strike's flash (cosmetic; the damage already has its number). */
  handleEvent(ev: SimEvent): void {
    if (!this.flashesOn || ev.type !== 'spellfx' || ev.fx !== 'nova' || !this.world) return;
    const ability = ev.ability ?? '';
    const spec = this.specs[ability];
    if (!spec && ability !== 'crypt_bone_growth') return;
    const at = this.world.entities.get(ev.targetId);
    if (!at) return;
    const slot = this.flashes.find((f) => f.age < 0) ?? this.flashes[0];
    slot.radius =
      spec?.shape === 'ring'
        ? spec.range
        : spec?.shape === 'sigil'
          ? 3
          : spec
            ? spec.range * 0.6
            : 3;
    this.kit.layOutFan(slot, 360, {
      color: spec?.color ?? CRYPT_TELEGRAPH_COLORS.shadow,
      accent: 0xffffff,
    });
    slot.age = 0;
    slot.x = at.pos.x;
    slot.z = at.pos.z;
    slot.group.visible = true;
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
    for (const slot of this.telegraphs) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.specs[slot.castId];
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const fill = telegraphFill(caster.castRemaining, caster.castTotal);
      let x = caster.pos.x;
      let z = caster.pos.z;
      if (spec.ahead) {
        x += Math.sin(caster.facing) * spec.ahead;
        z += Math.cos(caster.facing) * spec.ahead;
      }
      const floor = this.groundY(x, z);
      let yaw = telegraphYaw(spec.shape, caster.facing);
      if (spec.shape === 'sigil') yaw += this.clock * 1.4;
      this.kit.drapeFan(slot, this.groundY, x, floor, z, yaw, spec.range);
      this.kit.paintFan(slot, { fill, clock: this.clock, range: spec.range });
    }
    for (const slot of this.bursts) {
      if (slot.corpseId < 0) continue;
      const corpse = world.entities.get(slot.corpseId);
      const phase = boneBurstPhase(this.clock - slot.since, this.burst.delay);
      if (!corpse || phase.stage === 'done') {
        slot.corpseId = -1;
        slot.group.visible = false;
        continue;
      }
      const floor = this.groundY(corpse.pos.x, corpse.pos.z);
      const flashing = phase.stage === 'flash';
      const radius = this.burst.radius * (flashing ? 1 + phase.fill * 0.3 : 1);
      this.kit.drapeFan(slot, this.groundY, corpse.pos.x, floor, corpse.pos.z, 0, radius);
      this.kit.paintFan(slot, {
        fill: flashing ? 1 : phase.fill,
        clock: this.clock,
        range: radius,
        fade: flashing ? 1 - phase.fill : 1,
      });
    }
    for (const slot of this.flashes) {
      if (slot.age < 0) continue;
      slot.age += dt;
      const k = slot.age / FLASH_SEC;
      if (k >= 1) {
        slot.age = -1;
        slot.group.visible = false;
        continue;
      }
      const r = slot.radius * (0.4 + 0.8 * k);
      const floor = this.groundY(slot.x, slot.z);
      this.kit.drapeFan(slot, this.groundY, slot.x, floor, slot.z, 0, r);
      this.kit.paintFan(slot, { fill: 1, clock: this.clock, range: r, fade: 1 - k, front: 0 });
    }
  }

  private scanWorld(world: IWorld): void {
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob') continue;
      if (e.dead) {
        if (e.templateId === BONE_MINION && !this.seenDead.has(e.id)) {
          this.seenDead.add(e.id);
          const slot = this.bursts.find((b) => b.corpseId < 0);
          if (slot) {
            this.kit.layOutFan(slot, 360, {
              color: CRYPT_TELEGRAPH_COLORS.bone,
              accent: TELEGRAPH_ACCENTS.bone,
            });
            slot.corpseId = e.id;
            slot.since = this.clock;
            slot.group.visible = true;
          }
        }
        continue;
      }
      const castId = e.castingAbility;
      if (!castId || !this.specs[castId]) continue;
      if (this.telegraphs.some((t) => t.casterId === e.id)) continue;
      const slot = this.telegraphs.find((t) => t.casterId < 0);
      if (!slot) continue;
      this.layOut(slot, this.specs[castId]);
      slot.casterId = e.id;
      slot.castId = castId;
      slot.group.visible = true;
    }
    // Forget corpses the world has dropped (the set stays bounded).
    if (this.seenDead.size > 64) {
      for (const id of this.seenDead) if (!world.entities.has(id)) this.seenDead.delete(id);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.kit.dispose();
  }
}

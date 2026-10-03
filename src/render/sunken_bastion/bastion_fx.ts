// The Sunken Bastion's floor telegraphs (plan: bastion_fx_core.ts):
//  - a floor mark under every cast you dodge or kick, filling as its bar runs:
//    the Drowned Watchman's Halberd Sweep and the Turretback Hermit's Claw
//    Sweep cones, the Hermit's Shell Slam ring, the Fogbound Arbalest's
//    Piercing Bolt lane (locked on its aim), and a kick glyph under a Brine
//    Mend or a Fog Ward;
//  - the Barnacle Crawler's Brine Burst ring, filling over its fuse where it fell;
//  - a flash when a strike lands;
//  - the creatures' own effects (bastion_creature_fx.ts): the Fogbound
//    Arbalest's crossbow bolts and the Gaol Turnkey's lantern flare;
//  - the gaol's cage, anchor and shackles (bastion_gaol_fx.ts) and the
//    reaper's pool, sweep and soul wisps (bastion_reaper_fx.ts).
// Boss casts register more lanes and rings through registerBastionTelegraph.
// Every shape is the shared floor telegraph (../floor_telegraph): the same
// layered look, threat colours and edge glow as every other dungeon.
//
// Rules (src/render/CLAUDE.md): every geometry and material is pooled and
// built once, attached through the compile gate; no per-frame allocation. The
// telegraphs are ACTIONABLE, so their footprint draws on every graphics tier;
// the edge curtains, flowing bands and motes and the landing flashes shed on
// the low tier. Everything is derived from IWorld entity state (cast fields,
// facing, the dead flag), so offline and online look the same.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_ACCENTS,
  type TelegraphFan,
  TelegraphKit,
  type TelegraphLane,
} from '../floor_telegraph';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { BASTION_BOSS_TELEGRAPHS, BastionBossFx } from './bastion_boss_fx';
import { BastionCreatureFx } from './bastion_creature_fx';
import {
  BASTION_TELEGRAPH_COLORS,
  type BastionTelegraphSpec,
  bastionTelegraphFill,
  bastionTelegraphSpecs,
  brineBurstPhase,
  brineBurstSpec,
} from './bastion_fx_core';
import { BastionGaolFx } from './bastion_gaol_fx';
import { BastionReaperFx } from './bastion_reaper_fx';

const FAN_SLOTS = 12;
const LANE_SLOTS = 8;
const BURST_SLOTS = 8;
const FLASH_SLOTS = 6;
const SCAN_SEC = 0.1;
const FLASH_SEC = 0.5;
const CRAWLER = 'barnacle_crawler';

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

/** Extra telegraphs a boss visual registers: a spec per cast id, and for a
 *  lane an optional resolver of its live length (a charge that stops at a
 *  buttress or at the rim). */
const extraSpecs = new Map<string, BastionTelegraphSpec>();
const laneLengths = new Map<string, (caster: EntityView) => number>();

export function registerBastionTelegraph(
  castId: string,
  spec: BastionTelegraphSpec,
  laneLength?: (caster: EntityView) => number,
): void {
  extraSpecs.set(castId, spec);
  if (laneLength) laneLengths.set(castId, laneLength);
}

interface FanSlot extends TelegraphFan {
  casterId: number;
  castId: string;
}

interface LaneSlot extends TelegraphLane {
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

export class BastionFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly specs = bastionTelegraphSpecs();
  private readonly burst = brineBurstSpec();
  private readonly fans: FanSlot[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly bursts: BurstSlot[] = [];
  private readonly flashes: FlashSlot[] = [];
  private readonly flashesOn: boolean;
  private readonly kit: TelegraphKit;
  private readonly seenDead = new Set<number>();
  private readonly boss: BastionBossFx;
  private readonly creatures: BastionCreatureFx;
  private readonly gaol: BastionGaolFx;
  private readonly reaper: BastionReaperFx;
  private scan = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    playGesture?: (entityId: number, gesture: string) => void,
    reducedMotion?: () => boolean,
  ) {
    this.root.name = 'sunken-bastion-telegraphs';
    setRenderCategory(this.root, 'ui3d');
    this.flashesOn =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.kit = new TelegraphKit(this.root, this.flashesOn);
    for (let i = 0; i < FAN_SLOTS; i++)
      this.fans.push({ ...this.kit.fan(18), casterId: -1, castId: '' });
    for (let i = 0; i < LANE_SLOTS; i++)
      this.lanes.push({ ...this.kit.lane(18), casterId: -1, castId: '' });
    for (let i = 0; i < BURST_SLOTS; i++)
      this.bursts.push({ ...this.kit.fan(15), corpseId: -1, since: 0 });
    if (this.flashesOn) {
      for (let i = 0; i < FLASH_SLOTS; i++)
        this.flashes.push({ ...this.kit.fan(21), age: -1, radius: 1, x: 0, z: 0 });
    }
    // The boss visuals ride this root (one compile gate); their casts paint
    // through the same lane and ring pools.
    this.boss = new BastionBossFx(this.root, groundY, world, this.flashesOn);
    // The creatures' own effects (the arbalest's bolts, the Turnkey's lantern)
    // ride the same root and compile gate.
    const creatures = new THREE.Group();
    creatures.name = 'sunken-bastion-creature-fx';
    this.root.add(creatures);
    this.creatures = new BastionCreatureFx(creatures, groundY, world, playGesture, reducedMotion);
    // The fifth pass's gaol and reaper visuals ride the same root and gate.
    this.gaol = new BastionGaolFx(this.root, groundY, world, this.flashesOn);
    this.reaper = new BastionReaperFx(this.root, groundY, world, this.flashesOn);
    const B = BASTION_BOSS_TELEGRAPHS;
    registerBastionTelegraph(
      B.charge,
      {
        shape: 'lane',
        range: 44,
        arcDeg: 0,
        halfWidth: B.laneHalf,
        color: BASTION_TELEGRAPH_COLORS.lethal,
        accent: TELEGRAPH_ACCENTS.physical,
      },
      (caster) => this.boss.laneLength(caster),
    );
    registerBastionTelegraph(B.surge, {
      shape: 'ring',
      range: B.surgeRadius,
      arcDeg: 360,
      color: BASTION_TELEGRAPH_COLORS.lethal,
      accent: TELEGRAPH_ACCENTS.frost,
    });
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private specFor(castId: string): BastionTelegraphSpec | undefined {
    return this.specs[castId] ?? extraSpecs.get(castId);
  }

  /** A landing strike's flash (cosmetic; the damage already has its number).
   *  True when a creature effect CLAIMED the event (the arbalest's bolt, the
   *  Turnkey's lantern), so the generic projectile or nova is not drawn too. */
  handleEvent(ev: SimEvent): boolean {
    if (this.creatures.handleEvent(ev)) return true;
    if (this.gaol.handleEvent(ev)) return true;
    if (this.reaper.handleEvent(ev)) return true;
    this.flash(ev);
    return false;
  }

  private flash(ev: SimEvent): void {
    if (!this.flashesOn || ev.type !== 'spellfx' || !this.world) return;
    const spec = this.specFor(ev.ability ?? '');
    if (!spec || spec.shape === 'lane' || spec.shape === 'sigil') return;
    const at = this.world.entities.get(ev.sourceId);
    if (!at) return;
    const slot = this.flashes.find((f) => f.age < 0) ?? this.flashes[0];
    if (!slot) return;
    this.kit.layOutFan(slot, 360, { color: spec.color, accent: 0xffffff });
    slot.age = 0;
    slot.radius = spec.shape === 'ring' ? spec.range : spec.range * 0.6;
    slot.x = at.pos.x;
    slot.z = at.pos.z;
    slot.group.visible = true;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.boss.update(dt);
    this.creatures.update(dt);
    this.gaol.update(dt);
    this.reaper.update(dt);
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    for (const slot of this.fans) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.specFor(slot.castId);
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const fill = bastionTelegraphFill(caster.castRemaining, caster.castTotal);
      const x = caster.pos.x;
      const z = caster.pos.z;
      const yaw = spec.shape === 'sigil' ? this.clock * 1.4 : caster.facing;
      this.kit.drapeFan(slot, this.groundY, x, this.groundY(x, z), z, yaw, spec.range);
      this.kit.paintFan(slot, { fill, clock: this.clock, range: spec.range });
    }
    for (const slot of this.lanes) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.specFor(slot.castId);
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const fill = bastionTelegraphFill(caster.castRemaining, caster.castTotal);
      const length = laneLengths.get(slot.castId)?.(caster) ?? spec.range;
      const x = caster.pos.x;
      const z = caster.pos.z;
      this.kit.drapeLane(
        slot,
        this.groundY,
        x,
        this.groundY(x, z),
        z,
        caster.facing,
        length,
        spec.halfWidth ?? 1,
        { color: spec.color, accent: spec.accent },
      );
      this.kit.paintLane(slot, { fill, clock: this.clock, range: length });
    }
    for (const slot of this.bursts) {
      if (slot.corpseId < 0) continue;
      const corpse = world.entities.get(slot.corpseId);
      const phase = brineBurstPhase(this.clock - slot.since, this.burst.delay);
      if (!corpse || phase.stage === 'done') {
        slot.corpseId = -1;
        slot.group.visible = false;
        continue;
      }
      const flashing = phase.stage === 'flash';
      const radius = this.burst.radius * (flashing ? 1 + phase.fill * 0.3 : 1);
      const floor = this.groundY(corpse.pos.x, corpse.pos.z);
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
        if (e.templateId === CRAWLER && !this.seenDead.has(e.id)) {
          this.seenDead.add(e.id);
          const slot = this.bursts.find((b) => b.corpseId < 0);
          if (slot) {
            this.kit.layOutFan(slot, 360, {
              color: BASTION_TELEGRAPH_COLORS.brine,
              accent: TELEGRAPH_ACCENTS.brine,
            });
            slot.corpseId = e.id;
            slot.since = this.clock;
            slot.group.visible = true;
          }
        }
        continue;
      }
      const castId = e.castingAbility;
      const spec = castId ? this.specFor(castId) : undefined;
      if (!castId || !spec) continue;
      if (spec.shape === 'lane') {
        if (this.lanes.some((t) => t.casterId === e.id)) continue;
        const slot = this.lanes.find((t) => t.casterId < 0);
        if (!slot) continue;
        slot.casterId = e.id;
        slot.castId = castId;
        slot.group.visible = true;
        continue;
      }
      if (this.fans.some((t) => t.casterId === e.id)) continue;
      const slot = this.fans.find((t) => t.casterId < 0);
      if (!slot) continue;
      this.kit.layOutFan(slot, spec.arcDeg, {
        color: spec.color,
        accent: spec.accent,
        sigil: spec.shape === 'sigil',
      });
      slot.casterId = e.id;
      slot.castId = castId;
      slot.group.visible = true;
    }
    if (this.seenDead.size > 64) {
      for (const id of this.seenDead) if (!world.entities.has(id)) this.seenDead.delete(id);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.boss.dispose();
    this.creatures.dispose();
    this.gaol.dispose();
    this.reaper.dispose();
    this.root.removeFromParent();
    this.kit.dispose();
  }
}

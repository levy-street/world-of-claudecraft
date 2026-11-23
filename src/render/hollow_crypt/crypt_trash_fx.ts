// The Hollow Crypt trash telegraphs and impacts (plan: crypt_trash_fx_core.ts):
//  - a floor telegraph under every trash cast you dodge, filling as its bar
//    runs: the Ossuary Warrior's Grave Cleave cone, the drake's Barrowflame
//    Breath cone and Tail Lash behind it, the Wing Gust and Stone Shriek rings,
//    and a kick glyph on the grave a Raise Bones is opening (and round a
//    Murder Call);
//  - the Bone Minion's burst ring, filling over its fuse where it fell;
//  - the trash mechanics pass (mob/trash_kit/crypt_kit.ts): the Bone Brute's
//    Marrow Crush cone, the Bonechill Widow's Rimesilk Spit lane (locked on
//    her aim), kick glyphs under a Grave Rupture and a Carrion Eye, and the
//    floor objects the kit lays: the rupture's danger ring on its corpse
//    (filling with its caster's bar), the heroic pool's and the Barrow Embers'
//    burning edges while their objects stand;
//  - a flash when a strike lands.
// The kit's hero effects (the bone pile, the blasts, the marks on a body)
// ride crypt_trash_kit_fx.ts, which this painter owns and forwards to.
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
import { CRYPT_GRAVE_RUPTURE } from '../../sim/mob/trash_kit/cast_ids';
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
import {
  boneBurstPhase,
  boneBurstSpec,
  CRYPT_TELEGRAPH_COLORS,
  type CryptObjectTelegraph,
  type CryptTelegraphSpec,
  cryptObjectTelegraphs,
  cryptTelegraphSpecs,
  ruptureCasterReach,
  telegraphFill,
  telegraphYaw,
} from './crypt_trash_fx_core';
import { CryptTrashKitFx } from './crypt_trash_kit_fx';
import {
  hazardLevel,
  inHollowCrypt,
  ruptureRingFill,
  ruptureSpec,
} from './crypt_trash_kit_fx_core';

const TELEGRAPH_SLOTS = 10;
const BURST_SLOTS = 8;
const FLASH_SLOTS = 6;
const LANE_SLOTS = 4;
const OBJECT_SLOTS = 8;
const SCAN_SEC = 0.1;
const FLASH_SEC = 0.5;
const BONE_MINION = 'crypt_bone_minion';

interface TelegraphSlot extends TelegraphFan {
  casterId: number;
  castId: string;
}

interface LaneSlot extends TelegraphLane {
  casterId: number;
  castId: string;
}

interface ObjectSlot extends TelegraphFan {
  objectId: number;
  spec: CryptObjectTelegraph | null;
  born: number;
  /** Clock time its object went (it fades out), or -1 while it stands. */
  goneAt: number;
  x: number;
  z: number;
  facing: number;
  range: number;
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
  private readonly lanes: LaneSlot[] = [];
  private readonly objects: ObjectSlot[] = [];
  private readonly objectSpecs = cryptObjectTelegraphs();
  private readonly rupture = ruptureSpec();
  private readonly ruptureReach = ruptureCasterReach();
  private readonly kitFx: CryptTrashKitFx | null;
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
    reducedMotion?: () => boolean,
    shake?: (amount: number) => void,
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
    for (let i = 0; i < LANE_SLOTS; i++)
      this.lanes.push({ ...this.kit.lane(18), casterId: -1, castId: '' });
    for (let i = 0; i < OBJECT_SLOTS; i++)
      this.objects.push({
        ...this.kit.fan(16),
        objectId: -1,
        spec: null,
        born: 0,
        goneAt: -1,
        x: 0,
        z: 0,
        facing: 0,
        range: 1,
      });
    if (this.flashesOn) {
      for (let i = 0; i < FLASH_SLOTS; i++)
        this.flashes.push({ ...this.kit.fan(21), age: -1, radius: 1, x: 0, z: 0 });
    }
    this.kitFx = world
      ? new CryptTrashKitFx(scene, groundY, world, compileGate, reducedMotion, shake)
      : null;
    const own = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed);
    this.readyForEntry = Promise.all([own, this.kitFx?.readyForEntry])
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

  /** A landing strike's flash (cosmetic; the damage already has its number),
   *  then the kit's hero effects. True when the kit CLAIMED the event (its
   *  bolt or blast replaces the generic one). */
  handleEvent(ev: SimEvent): boolean {
    if (this.disposed) return false;
    this.flash(ev);
    return this.kitFx?.handleEvent(ev) ?? false;
  }

  private flash(ev: SimEvent): void {
    if (!this.flashesOn || ev.type !== 'spellfx' || ev.fx !== 'nova' || !this.world) return;
    const ability = ev.ability ?? '';
    const spec = this.specs[ability];
    if (!spec && ability !== 'crypt_bone_growth') return;
    // A landed Grave Rupture is the kit's own blast (crypt_bone_fx.ts).
    if (ability === CRYPT_GRAVE_RUPTURE) return;
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
    this.kitFx?.update(dt);
    this.clock += dt;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      // Nothing of the crypt to find outside its claim: skip the roster walk.
      if (inHollowCrypt(world.player.pos.x)) this.scanWorld(world);
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
    for (const slot of this.lanes) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.specs[slot.castId];
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      // The lane holds the aim the bar locked (the sim faces the caster along it).
      const x = caster.pos.x;
      const z = caster.pos.z;
      this.kit.drapeLane(
        slot,
        this.groundY,
        x,
        this.groundY(x, z),
        z,
        caster.facing,
        spec.range,
        spec.halfWidth ?? 1,
        { color: spec.color, accent: spec.accent },
      );
      this.kit.paintLane(slot, {
        fill: telegraphFill(caster.castRemaining, caster.castTotal),
        clock: this.clock,
        range: spec.range,
      });
    }
    for (const slot of this.objects) {
      if (slot.objectId < 0 || !slot.spec) continue;
      const obj = world.entities.get(slot.objectId);
      if (obj) {
        slot.x = obj.pos.x;
        slot.z = obj.pos.z;
      } else if (slot.goneAt < 0) slot.goneAt = this.clock;
      const gone = slot.goneAt >= 0 ? this.clock - slot.goneAt : -1;
      const spec = slot.spec;
      let fill = 1;
      let fade = 1;
      if (spec.drive === 'cast') {
        // A burst ring goes at once with its bar (the kit's blast takes over).
        if (gone >= 0) {
          this.freeObject(slot);
          continue;
        }
        fill = ruptureRingFill(
          this.casterFill(world, spec.castId ?? '', slot.x, slot.z),
          this.clock - slot.born,
          this.rupture.castTime,
        );
      } else {
        fade = hazardLevel(this.clock - slot.born, gone, 0.2, 0.45);
        if (fade <= 0 && gone >= 0) {
          this.freeObject(slot);
          continue;
        }
      }
      const yaw = spec.shape === 'cone' ? slot.facing : 0;
      const floor = this.groundY(slot.x, slot.z);
      this.kit.drapeFan(slot, this.groundY, slot.x, floor, slot.z, yaw, slot.range);
      this.kit.paintFan(slot, { fill, clock: this.clock, range: slot.range, fade });
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

  /** The bar of the nearest living caster of `castId` within the cast's
   *  reach of (x, z), or null when none is in view. */
  private casterFill(world: IWorld, castId: string, x: number, z: number): number | null {
    let best: number | null = null;
    let bestD = this.ruptureReach * this.ruptureReach;
    for (const slot of this.telegraphs) {
      if (slot.casterId < 0 || slot.castId !== castId) continue;
      const c = world.entities.get(slot.casterId);
      if (!c || c.dead || c.castingAbility !== castId) continue;
      const dx = c.pos.x - x;
      const dz = c.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d <= bestD) {
        bestD = d;
        best = telegraphFill(c.castRemaining, c.castTotal);
      }
    }
    return best;
  }

  private freeObject(slot: ObjectSlot): void {
    slot.objectId = -1;
    slot.spec = null;
    slot.goneAt = -1;
    slot.group.visible = false;
  }

  private holdObject(e: {
    id: number;
    templateId: string;
    pos: { x: number; z: number };
    facing: number;
    scale: number;
  }): void {
    const spec = this.objectSpecs[e.templateId];
    if (!spec || this.objects.some((o) => o.objectId === e.id)) return;
    const slot = this.objects.find((o) => o.objectId < 0);
    if (!slot) return;
    this.kit.layOutFan(slot, spec.shape === 'cone' ? (spec.arcDeg ?? 60) : 360, {
      color: spec.color,
      accent: spec.accent,
    });
    slot.objectId = e.id;
    slot.spec = spec;
    slot.born = this.clock;
    slot.goneAt = -1;
    slot.x = e.pos.x;
    slot.z = e.pos.z;
    slot.facing = e.facing;
    slot.range = e.scale > 0 ? e.scale : this.rupture.radius || 1;
    slot.group.visible = true;
  }

  private scanWorld(world: IWorld): void {
    for (const e of world.entities.values()) {
      if (e.kind === 'object') {
        if (this.objectSpecs[e.templateId]) this.holdObject(e);
        continue;
      }
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
      const spec = castId ? this.specs[castId] : undefined;
      if (!castId || !spec) continue;
      if (spec.shape === 'lane') {
        if (this.lanes.some((t) => t.casterId === e.id)) continue;
        const lane = this.lanes.find((t) => t.casterId < 0);
        if (!lane) continue;
        lane.casterId = e.id;
        lane.castId = castId;
        lane.group.visible = true;
        continue;
      }
      if (this.telegraphs.some((t) => t.casterId === e.id)) continue;
      const slot = this.telegraphs.find((t) => t.casterId < 0);
      if (!slot) continue;
      this.layOut(slot, spec);
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
    this.kitFx?.dispose();
  }
}

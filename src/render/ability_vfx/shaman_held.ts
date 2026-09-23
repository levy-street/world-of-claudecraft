import * as THREE from 'three';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import { OVERLAY_CELL } from './fx_textures';
import type { OverlaySprites } from './overlay_sprites';
import type { AbilityVfxRibbons } from './ribbons';
import { drawShamanEmpowerment } from './shaman_empowerment';
import { drawShamanWaterGuard } from './shaman_water_guard';
import { ShamanWeaponEnchantments } from './shaman_weapon_enchantments';

interface HeldAura {
  readonly id: string;
  readonly kind?: string;
  readonly remaining?: number;
  readonly value?: number;
  readonly stacks?: number;
  readonly charges?: number;
  readonly sourceId?: number;
}
export interface ShamanHeldEntity {
  readonly id: number;
  readonly dead?: boolean;
  readonly hp?: number;
  readonly maxHp?: number;
  readonly auras: readonly HeldAura[];
}
interface Anchors {
  anchorOf(id: number, fraction: number, out: THREE.Vector3): unknown;
  facingAt?(id: number): number | null | undefined;
}
type Equipment = (id: number, hand: 0 | 1) => WeaponAnchorSampler | null;
type Ribbons = Pick<AbilityVfxRibbons, 'appendHeld'>;
type Overlay = Pick<OverlaySprites, 'push'>;
const CAPACITY = 24;
const STONE = 1;
const TRANCE = 2;
const MASTERY = 4;
const EXALTATION = 8;
const CHORUS = 16;
const UNLEASH_GUARD = 32;
const WATER_GUARD = 64;
interface Wearer {
  id: number;
  frame: number;
  thunder: number;
  cadence: number;
  current: number;
  flags: number;
  stones: number;
  imbue: number;
  priority: boolean;
  chorusRemaining: number;
  primalRemaining: number;
  sample: WeaponAnchorSampler | null;
  offSample: WeaponAnchorSampler | null;
  retryAt: number;
  offRetryAt: number;
}

/** Persistent support borrows the prepared immediate-mode buffers. Every shape
 * represents a live aura on this exact actor, never a heal or an inferred link.
 * Thunder Ward remains exclusively owned by HeldConduction. */
export class ShamanHeld {
  private readonly wearers: Wearer[] = Array.from({ length: CAPACITY }, () => ({
    id: -1,
    frame: -1,
    thunder: 0,
    cadence: 0,
    current: 0,
    flags: 0,
    stones: 0,
    imbue: 0,
    priority: false,
    chorusRemaining: 0,
    primalRemaining: 0,
    sample: null,
    offSample: null,
    retryAt: 0,
    offRetryAt: 0,
  }));
  private readonly points = Array.from({ length: 12 }, () => new THREE.Vector3());
  private readonly origin = new THREE.Vector3();
  private readonly enchantments = new ShamanWeaponEnchantments();
  private disposed = false;

  sync(frame: number, entity: ShamanHeldEntity, preferredOwnerId?: number): void {
    if (this.disposed) return;
    let old: Wearer | undefined;
    let vacant: Wearer | undefined;
    let replaceable: Wearer | undefined;
    for (const slot of this.wearers) {
      if (slot.id === entity.id) old = slot;
      if (!vacant && (slot.id < 0 || slot.frame < frame - 1)) vacant = slot;
      if (!replaceable && !slot.priority) replaceable = slot;
    }
    if (entity.dead || (entity.hp ?? 1) <= 0) {
      if (old) this.release(old);
      return;
    }
    let thunder = 0,
      cadence = 0,
      current = 0,
      flags = 0,
      stones = 0,
      imbue = 0;
    let ownedCurrent = false,
      ownedChorus = false;
    let chorusRemaining = 0,
      primalRemaining = 0;
    for (const aura of entity.auras) {
      if (!((aura.remaining ?? 0) > 0)) continue;
      switch (aura.id) {
        case 'shaman_thunder_charges':
          thunder = Math.min(5, Math.max(0, Math.floor(aura.stacks ?? 0)));
          break;
        case 'shaman_warspirit_cadence':
          cadence = Math.min(4, Math.max(0, Math.floor(aura.stacks ?? 0)));
          break;
        case 'shaman_stormcast':
          cadence = 4;
          break;
        case 'shaman_mending_current': {
          const value = aura.value ?? 0;
          const maxHp = entity.maxHp ?? 0;
          const owner = preferredOwnerId !== undefined && aura.sourceId === preferredOwnerId;
          if (Number.isFinite(value) && value > 0 && maxHp > 0 && (!ownedCurrent || owner)) {
            const fill = Math.min(1, value / (maxHp * 0.3));
            current = owner && !ownedCurrent ? fill : Math.max(current, fill);
            ownedCurrent ||= owner;
          }
          break;
        }
        case 'shaman_stoneward':
          stones = Math.min(6, Math.max(0, Math.floor(aura.charges ?? 0)));
          if (stones > 0) flags |= STONE;
          break;
        case 'shaman_stonebound_unleash_guard':
          flags |= UNLEASH_GUARD;
          break;
        case 'unleash_weapon':
          if (aura.kind === 'absorb' && (aura.value ?? 0) > 0) flags |= WATER_GUARD;
          break;
        case 'elemental_trance':
          flags |= TRANCE;
          break;
        case 'elemental_mastery':
          flags |= MASTERY;
          break;
        case 'shaman_primal_exaltation':
          flags |= EXALTATION;
          primalRemaining = aura.remaining ?? 0;
          break;
        case 'bloodlust':
          if (aura.kind === 'buff_haste' || aura.kind === undefined) {
            flags |= CHORUS;
            chorusRemaining = aura.remaining ?? 0;
            ownedChorus ||= preferredOwnerId !== undefined && aura.sourceId === preferredOwnerId;
          }
          break;
        case 'rockbiter_weapon':
          imbue = 1;
          break;
        case 'flametongue_weapon':
          imbue = 2;
          break;
        case 'galeheart_weapon':
          imbue = 3;
          break;
        case 'lifespring_weapon':
          imbue = 4;
          break;
      }
    }
    if (!(thunder || cadence || current || flags || imbue)) {
      if (old) this.release(old);
      return;
    }
    const priority = entity.id === preferredOwnerId || ownedCurrent || ownedChorus;
    const slot = old ?? vacant ?? (priority ? replaceable : undefined);
    if (!slot) return;
    if (slot.id !== entity.id) this.release(slot);
    slot.id = entity.id;
    slot.frame = frame;
    slot.thunder = thunder;
    slot.cadence = cadence;
    slot.current = current;
    slot.flags = flags;
    slot.stones = stones;
    slot.imbue = imbue;
    slot.priority = priority;
    slot.chorusRemaining = chorusRemaining;
    slot.primalRemaining = primalRemaining;
  }

  draw(
    frame: number,
    time: number,
    reducedMotion: boolean,
    quality: number,
    host: Anchors,
    ribbons: Ribbons,
    overlay: Overlay,
    equipment?: Equipment,
  ): void {
    if (this.disposed) return;
    const t = reducedMotion ? 0 : time;
    const detail = quality >= 0.5;
    let chorusCount = 0;
    for (const slot of this.wearers) if (slot.frame === frame && slot.flags & CHORUS) chorusCount++;
    // Own party recipients win admission and draw before distant decoration.
    for (let pass = 0; pass < 2; pass++)
      for (const slot of this.wearers) {
        if (slot.priority !== (pass === 0)) continue;
        if (slot.id < 0) continue;
        if (slot.frame !== frame || !host.anchorOf(slot.id, 0, this.origin)) {
          this.release(slot);
          continue;
        }
        const facing = host.facingAt?.(slot.id) ?? 0;
        // Five short dorsal prongs read as a bank, distinct from the three broad
        // side/front conductors of defensive Thunder Ward. No empty charges draw.
        for (let n = 0; n < slot.thunder; n++) {
          const side = (n - 2) * 0.24;
          for (let j = 0; j < 4; j++) {
            this.local(
              j,
              side + (j % 2 ? 0.05 : -0.035),
              1.32 + j * 0.13 + Math.sin(t * 4 + n) * 0.025,
              -0.34,
              facing,
            );
          }
          ribbons.appendHeld(this.points, 4, 0.038, 0x8fddff, 1.55);
          const end = this.points[3];
          overlay.push(end.x, end.y, end.z, 0xc6f1ff, 0.11, OVERLAY_CELL.spark, 0.8, 1.7);
        }
        if (slot.current > 0) {
          // A quiet meniscus held beside the actual recipient. It never pulses
          // outward as if another heal arrived between authoritative heal events.
          for (let side = -1; side <= 1; side += 2) {
            for (let j = 0; j < 9; j++) {
              const u = j / 8;
              this.local(
                j,
                side * (0.53 + Math.sin(u * Math.PI) * 0.18),
                0.35 + u * (0.34 + slot.current * 0.65),
                -0.1 + Math.sin(u * Math.PI) * 0.1 + Math.sin(t * 1.2 + u * 3) * 0.015,
                facing,
              );
            }
            ribbons.appendHeld(this.points, 9, 0.04 + slot.current * 0.045, 0x4fbbb8, 0.85);
            if (detail) ribbons.appendHeld(this.points, 9, 0.017, 0xc9f2e1, 1.1);
          }
        }
        if (slot.flags & STONE) {
          for (let n = 0; n < slot.stones; n++) {
            const side = n % 2 ? 1 : -1;
            const y = 0.42 + Math.floor(n / 2) * 0.32;
            this.local(0, side * 0.67, y, -0.04, facing);
            this.local(1, side * 0.81, y + 0.13, -0.07, facing);
            this.local(2, side * 0.74, y + 0.28, -0.02, facing);
            ribbons.appendHeld(this.points, 3, 0.08, 0xb29a72, 0.68);
          }
        }
        if (slot.flags & UNLEASH_GUARD) {
          // Two braced slate shoulders, not another receiving eruption. The
          // actual guard survives a missed attack and ends with its own aura.
          // Keep the centre and face open, including on the lowest quality.
          for (let side = -1; side <= 1; side += 2) {
            this.local(0, side * 0.76, 0.42, 0.12, facing);
            this.local(1, side * 0.99, 0.66, 0.22, facing);
            this.local(2, side * 1.03, 1.22, 0.2, facing);
            this.local(3, side * 0.87, 1.57, 0.09, facing);
            this.local(4, side * 0.7, 1.62, 0.02, facing);
            ribbons.appendHeld(this.points, 5, 0.18, 0x84928a, 0.72);
            if (detail) {
              this.local(0, side * 0.89, 0.72, 0.235, facing);
              this.local(1, side * 0.93, 1.18, 0.215, facing);
              this.local(2, side * 0.8, 1.48, 0.105, facing);
              ribbons.appendHeld(this.points, 3, 0.028, 0xc4b184, 0.8);
            }
          }
        }
        if (slot.flags & WATER_GUARD)
          drawShamanWaterGuard(this.points, this.origin, facing, t, detail, ribbons);
        if (slot.flags & CHORUS)
          drawShamanEmpowerment(
            this.points,
            this.origin,
            facing,
            t,
            'chorus',
            slot.chorusRemaining,
            detail,
            ribbons,
            chorusCount > 5,
            slot.id,
          );
        if (slot.flags & EXALTATION)
          drawShamanEmpowerment(
            this.points,
            this.origin,
            facing,
            t,
            'primal',
            slot.primalRemaining,
            detail,
            ribbons,
          );
        for (let kind = TRANCE; kind <= MASTERY; kind *= 2) {
          if (!(slot.flags & kind)) continue;
          const color = kind === TRANCE ? 0x64bdb1 : 0x83d8fa;
          for (let side = -1; side <= 1; side += 2) {
            for (let j = 0; j < 9; j++) {
              const u = j / 8;
              const reach =
                kind === MASTERY ? 0.28 + u * 0.43 : 0.48 + Math.sin(u * Math.PI) * 0.24;
              const up = kind === MASTERY ? 1.48 - u * 0.61 : 0.68 + u * 0.7;
              this.local(
                j,
                side * reach,
                up,
                (kind === MASTERY ? 0.18 : -0.24) + Math.sin(t * 2 + u * 4) * 0.025,
                facing,
              );
            }
            ribbons.appendHeld(this.points, 9, kind === TRANCE ? 0.085 : 0.04, color, 0.75);
          }
        }
        if (slot.imbue || slot.cadence)
          this.weapon(slot, time, t, detail, ribbons, overlay, equipment);
      }
  }

  private weapon(
    slot: Wearer,
    time: number,
    t: number,
    detail: boolean,
    ribbons: Ribbons,
    overlay: Overlay,
    equipment?: Equipment,
  ): void {
    if (!slot.sample && time >= slot.retryAt) {
      slot.sample = equipment?.(slot.id, 0) ?? null;
      slot.retryAt = time + 0.5;
    }
    if (
      slot.sample &&
      !this.enchantments.draw(slot.sample, slot.imbue, slot.cadence, t, detail, ribbons, overlay)
    ) {
      slot.sample = null;
      slot.retryAt = time + 0.5;
    }
    if (!slot.offSample && time >= slot.offRetryAt) {
      slot.offSample = equipment?.(slot.id, 1) ?? null;
      slot.offRetryAt = time + 0.5;
    }
    if (
      slot.offSample &&
      !this.enchantments.draw(slot.offSample, slot.imbue, slot.cadence, t, detail, ribbons, overlay)
    ) {
      slot.offSample = null;
      slot.offRetryAt = time + 0.5;
    }
  }

  private local(index: number, x: number, y: number, z: number, facing: number): void {
    const c = Math.cos(facing),
      s = Math.sin(facing);
    this.points[index].set(
      this.origin.x + c * x + s * z,
      this.origin.y + y,
      this.origin.z - s * x + c * z,
    );
  }

  private release(slot: Wearer): void {
    slot.id = -1;
    slot.frame = -1;
    slot.sample = null;
    slot.offSample = null;
    slot.retryAt = 0;
    slot.offRetryAt = 0;
    slot.priority = false;
  }

  sleep(entityId: number): void {
    for (const slot of this.wearers) if (slot.id === entityId) this.release(slot);
  }

  clear(): void {
    for (const slot of this.wearers) this.release(slot);
  }
  dispose(): void {
    this.clear();
    this.disposed = true;
  }
}

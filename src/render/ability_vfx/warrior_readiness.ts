import * as THREE from 'three';
import { WARRIOR_READINESS as R } from '../warrior_readiness_core';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import type { AbilityVfxFx } from './fx';
import type { OverlaySprites } from './overlay_sprites';
import type { AbilityVfxRibbons } from './ribbons';
import { WarriorReadinessShapes } from './warrior_readiness_shapes';

type Host = Pick<AbilityVfxFx, 'anchorOf' | 'groundYAt' | 'bakedAt'>;
type Equipment = (id: number, hand: 0 | 1) => WeaponAnchorSampler | null;
interface Wearer {
  stamp: number;
  bits: number;
  priority: boolean;
  samples: [WeaponAnchorSampler | null, WeaponAnchorSampler | null];
  retryAt: [number, number];
  previousX: number;
  previousZ: number;
  previousTime: number;
  nextDust: number;
}
const CAPACITY = 64;

/** One bounded wearer entry merges simultaneous states. Held geometry borrows
 * the existing ribbon/overlay buffers and never occupies timed attack slots. */
export class WarriorReadiness {
  private readonly wearers = new Map<number, Wearer>();
  private readonly shapes = new WarriorReadinessShapes();
  private readonly frames = [new THREE.Matrix4(), new THREE.Matrix4()];
  private readonly tips = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly feet = new THREE.Vector3();
  private readonly path = Array.from({ length: 4 }, () => new THREE.Vector3());

  hold(id: number, bit: number, frame: number, priority: boolean): void {
    if (!(bit & 255)) return;
    let entry = this.wearers.get(id);
    if (!entry) {
      if (this.wearers.size >= CAPACITY) {
        if (!priority) return;
        for (const [otherId, other] of this.wearers) {
          if (!other.priority) {
            this.wearers.delete(otherId);
            break;
          }
        }
        if (this.wearers.size >= CAPACITY) return;
      }
      entry = {
        stamp: frame,
        bits: 0,
        priority,
        samples: [null, null],
        retryAt: [0, 0],
        previousX: 0,
        previousZ: 0,
        previousTime: -1,
        nextDust: 0,
      };
      this.wearers.set(id, entry);
    }
    entry.bits = entry.stamp === frame ? entry.bits | bit : bit;
    entry.stamp = frame;
    entry.priority = priority;
  }

  draw(
    frame: number,
    time: number,
    reducedMotion: boolean,
    quality: number,
    host: Host,
    ribbons: AbilityVfxRibbons,
    overlay: OverlaySprites,
    equipment?: Equipment,
  ): void {
    for (const [id, entry] of this.wearers) if (entry.stamp !== frame) this.wearers.delete(id);
    // Local readiness consumes the remaining decoration budget first.
    for (let pass = 0; pass < 2; pass++)
      for (const [id, entry] of this.wearers) {
        if (entry.priority !== (pass === 0)) continue;
        if (!host.anchorOf(id, 0, this.feet)) {
          this.wearers.delete(id);
          continue;
        }
        if (entry.bits & 127) {
          const main = this.sample(entry, id, 0, time, equipment);
          const off =
            !!(entry.bits & (R.berserker | R.guarded | R.revenge)) &&
            this.sample(entry, id, 1, time, equipment);
          if (main)
            this.shapes.draw(
              ribbons,
              overlay,
              this.frames[0],
              this.tips[0],
              entry.bits,
              0,
              off,
              time,
              reducedMotion,
            );
          if (off)
            this.shapes.draw(
              ribbons,
              overlay,
              this.frames[1],
              this.tips[1],
              entry.bits,
              1,
              true,
              time,
              reducedMotion,
            );
        }
        if (entry.bits & R.pursuit) this.pursuit(entry, time, quality, host, ribbons);
        entry.previousX = this.feet.x;
        entry.previousZ = this.feet.z;
        entry.previousTime = time;
      }
  }

  private sample(
    entry: Wearer,
    id: number,
    hand: 0 | 1,
    time: number,
    equipment?: Equipment,
  ): boolean {
    if (!entry.samples[hand] && time >= entry.retryAt[hand]) {
      entry.samples[hand] = equipment?.(id, hand) ?? null;
      entry.retryAt[hand] = time + 0.25;
    }
    const sample = entry.samples[hand];
    if (!sample?.(this.tips[hand]) || !sample.frame?.(this.frames[hand])) {
      entry.samples[hand] = null;
      return false;
    }
    return true;
  }

  private pursuit(
    entry: Wearer,
    time: number,
    quality: number,
    host: Host,
    ribbons: AbilityVfxRibbons,
  ): void {
    const dt = time - entry.previousTime;
    if (entry.previousTime < 0 || dt <= 0 || dt > 0.2) return;
    let dx = this.feet.x - entry.previousX,
      dz = this.feet.z - entry.previousZ;
    const distance = Math.hypot(dx, dz),
      speed = distance / dt;
    if (speed < 0.75 || speed > 30) return;
    dx /= distance;
    dz /= distance;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < this.path.length; i++) {
        const behind = 0.08 + i * 0.22,
          spread = side * (0.16 + i * 0.025);
        const x = this.feet.x - dx * behind + dz * spread,
          z = this.feet.z - dz * behind - dx * spread;
        this.path[i].set(x, host.groundYAt(x, z) + 0.05 + i * 0.012, z);
      }
      ribbons.appendHeld(this.path, this.path.length, 0.035, 0xba9675, 0.65);
    }
    if (quality > 0.55 && time >= entry.nextDust) {
      entry.nextDust = time + 0.16;
      const x = this.feet.x - dx * 0.28,
        z = this.feet.z - dz * 0.28;
      host.bakedAt(
        'shout_dust',
        x,
        host.groundYAt(x, z) + 0.12,
        z,
        0.8,
        0x635047,
        0xbca789,
        0.24,
        0,
        0,
        Math.atan2(dx, dz),
      );
    }
  }

  clear(): void {
    this.wearers.clear();
  }
}

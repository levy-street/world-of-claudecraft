// Free-form bursts on the cannon's one puff draw: a fixed pool of slots, each a
// handful of launched puffs (cannon_puff_core.ts) and the frame seconds they
// start from, so an effect that is not the shot itself (the thrown monsters'
// contact dust) rides the same instanced quad and material instead of minting
// its own. The painter is cannon_shell_visuals.ts.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES) and allocation-free after construction.

import { type CannonPuff, newCannonPuff } from './cannon_puff_core';

export interface CannonPuffBurst {
  active: boolean;
  /** Frame seconds at which the burst is age 0 (earlier than now for a contact seen late). */
  at: number;
  /** Seconds after `at` by which every puff is spent. */
  life: number;
  count: number;
  readonly puffs: CannonPuff[];
}

export class CannonPuffBursts {
  readonly slots: CannonPuffBurst[];

  constructor(
    slots: number,
    readonly perSlot: number,
  ) {
    this.slots = Array.from({ length: Math.max(0, slots) }, () => ({
      active: false,
      at: 0,
      life: 0,
      count: 0,
      puffs: Array.from({ length: Math.max(0, perSlot) }, newCannonPuff),
    }));
  }

  get capacity(): number {
    return this.slots.length * this.perSlot;
  }

  /**
   * A slot for a burst seen at `now`: a free or spent one, else the one nearest
   * its end (its last puffs are the faintest). Null when the pool has no slot.
   * The caller launches the puffs and sets `at`, `life` and `count`.
   */
  take(now: number): CannonPuffBurst | null {
    let pick: CannonPuffBurst | null = null;
    let left = Number.POSITIVE_INFINITY;
    for (const slot of this.slots) {
      // A slot taken this frame has no life yet: it is not free until its caller's puffs are spent.
      if (!slot.active || (slot.life > 0 && now - slot.at >= slot.life)) {
        pick = slot;
        break;
      }
      const remaining = slot.at + slot.life - now;
      if (remaining < left) {
        left = remaining;
        pick = slot;
      }
    }
    if (!pick) return null;
    pick.active = true;
    pick.at = now;
    pick.life = 0;
    pick.count = 0;
    return pick;
  }

  /** Retires the spent slots at `now`; true while any burst still lives. */
  sweep(now: number): boolean {
    let live = false;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      if (now - slot.at >= slot.life) slot.active = false;
      else live = true;
    }
    return live;
  }

  clear(): void {
    for (const slot of this.slots) slot.active = false;
  }
}

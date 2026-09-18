// The reticle tick ring: a fixed arc of slots around screen centre, one per proc
// the player asked to track there, unlit until it fires.
//
// Why an ARC and not a full circle: the lower half of screen centre is where the
// character and the cast bar sit, and the top is where nameplates and the target
// frame land. A shallow arc above centre is the one band that stays clear, and it
// keeps every tick inside foveal vision, which is the whole point of the channel.
//
// Pure: angles and colours only, no DOM. Allocation-light by the same contract the
// aura view holds: the slot array is preallocated and mutated in place, and tick()
// returns the SAME container every call.

/** Total sweep of the arc, centred on straight up. Widening this past a right
 *  angle starts putting ticks where the target frame lives. */
export const RETICLE_ARC_DEGREES = 96;
/** Ticks beyond this are dropped rather than crowded: past eight the marks are
 *  closer together than they are wide, and stop being separately readable. */
export const RETICLE_MAX_TICKS = 8;

export interface ReticleTickInput {
  id: string;
  color: string;
  active: boolean;
  /** Whether the player chose the reticle channel for this proc. */
  enabled: boolean;
}

export interface ReticleTickSlot {
  id: string;
  color: string;
  active: boolean;
  /** Degrees from straight up, negative to the left. */
  angleDeg: number;
}

export interface ReticleTicksState {
  slots: ReticleTickSlot[];
  count: number;
}

export interface ReticleTicksView {
  tick(inputs: readonly ReticleTickInput[]): ReticleTicksState;
}

function makeSlot(): ReticleTickSlot {
  return { id: '', color: '', active: false, angleDeg: 0 };
}

/**
 * Angles are assigned by POSITION IN THE ENABLED LIST, not by whether a proc is
 * currently up, so a given spell keeps the same slot all fight. A tick that moved
 * when its neighbour fired would be unreadable at a glance, which is the only
 * thing this channel is for.
 */
export function createReticleTicksView(): ReticleTicksView {
  const slots: ReticleTickSlot[] = [];
  const state: ReticleTicksState = { slots, count: 0 };
  return {
    tick(inputs) {
      let count = 0;
      for (const input of inputs) {
        if (!input.enabled) continue;
        if (count >= RETICLE_MAX_TICKS) break;
        if (count >= slots.length) slots.push(makeSlot());
        const slot = slots[count];
        slot.id = input.id;
        slot.color = input.color;
        slot.active = input.active;
        count++;
      }
      // One tick sits straight up; two or more spread evenly across the arc.
      const step = count > 1 ? RETICLE_ARC_DEGREES / (count - 1) : 0;
      const start = count > 1 ? -RETICLE_ARC_DEGREES / 2 : 0;
      for (let i = 0; i < count; i++) slots[i].angleDeg = start + step * i;
      state.count = count;
      return state;
    },
  };
}

// The renderer's memory of each Smith's Heart claim's arrival light: how
// bright each altar's vein burns and how hard the sky flares while the
// Masterless Strength's arrival plays (../smith_heart_fx/final_arrival_core.ts:
// the veins dim round the dormant statue, each lighting as its stream runs,
// the sky blazing under the beam), and how much of the floor's rite marks show
// (the grooves and the sockets, the arrival's and the death's alone). The final boss's effects
// (../smith_heart_fx/final_fx.ts, which reads the boss from IWorld and runs
// the scene's clock, a pull's skip included) write it; the interior's frame
// driver (heart_interior.ts), which has no world, reads it. No note: the room
// as it always is (every vein burning, no flare). Keyed like the seal memory
// (heart_seal_core.ts `heartSealSlotKey`).
//
// Pure and Three-free.

import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';

interface ArrivalLight {
  veins: Record<SmithHeartVein, number>;
  flare: number;
  /** How much of the floor's rite marks show (the grooves and the sockets:
   *  heart_floor_rite_core.ts); 0 with no note. */
  rite: number;
}

const memory = new Map<string, ArrivalLight>();

/** Slot `key`'s arrival light this frame (null: no scene, the room as is). */
export function noteHeartArrivalLight(
  key: string,
  light: {
    veins: Readonly<Record<SmithHeartVein, number>>;
    flare: number;
    rite: number;
  } | null,
): void {
  if (!light) {
    memory.delete(key);
    return;
  }
  let m = memory.get(key);
  if (!m) {
    m = { veins: { hammer: 1, breath: 1, quench: 1, heat: 1 }, flare: 0, rite: 0 };
    memory.set(key, m);
  }
  m.veins.hammer = light.veins.hammer;
  m.veins.breath = light.veins.breath;
  m.veins.quench = light.veins.quench;
  m.veins.heat = light.veins.heat;
  m.flare = light.flare;
  m.rite = light.rite;
}

/** How much of the floor's rite marks show in slot `key` (0: none). */
export function heartArrivalRite(key: string): number {
  return memory.get(key)?.rite ?? 0;
}

/** How bright `vein`'s altar burns in slot `key` (1: as always). */
export function heartArrivalVein(key: string, vein: SmithHeartVein): number {
  return memory.get(key)?.veins[vein] ?? 1;
}

/** How hard the sky flares in slot `key` (0: not at all). */
export function heartArrivalFlare(key: string): number {
  return memory.get(key)?.flare ?? 0;
}

/** Forget every slot (tests). */
export function clearHeartArrivalLightForTest(): void {
  memory.clear();
}

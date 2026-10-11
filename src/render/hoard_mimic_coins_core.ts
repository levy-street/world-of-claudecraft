// How the Voracious Chest's cursed coins LOOK: each puddle it spits is a handful
// of real coins flying out of its mouth in an arc, landing in the puddle as its
// warning ends, lying there glinting while the puddle burns, then sinking away.
// The puddle itself is the ordinary hoard telegraph (a gold disc); the damage is
// the sim's (src/sim/rift/hoard_mimic.ts). No Three.js, no DOM: a Vitest imports
// this directly, and hoard_mimic_coins.ts beside it only copies these numbers
// onto an instanced mesh. The coins are the Coinsack Scurrier's coins
// (hoard_goblin_coins_core.ts): the same size, gold and glint.

import { coinRandom } from './hoard_goblin_coins_core';

export const MIMIC_COIN_LOOK = Object.freeze({
  /** Coins per puddle, and on the low tier. */
  perPuddle: 6,
  lowPerPuddle: 3,
  /** The arc peaks this far above the straight line from mouth to puddle. */
  arcPeak: 3,
  /** Where the coins leave from: this high above the chest's feet. */
  mouthHeight: 2.2,
  /** They land within this share of the puddle's radius. */
  spread: 0.7,
  /** A coin already lying when first seen still takes this long to settle in. */
  minFlightSec: 0.25,
  /** After the puddle is gone they sink away over this long. */
  sinkSec: 0.6,
});

export interface MimicCoinFlight {
  /** Where it lands, relative to the puddle centre. */
  dx: number;
  dz: number;
  /** Its turn about the vertical as it lies, and its tumble rates in flight. */
  yaw: number;
  spinX: number;
  spinZ: number;
  /** Each coin leaves a little after the one before, so the handful fans out. */
  delay: number;
}

/** Plan the coins of one puddle: where each lands and how it tumbles. The same
 *  puddle (seed) always scatters the same way. */
export function planMimicCoins(seed: number, count: number, radius: number): MimicCoinFlight[] {
  const rand = coinRandom(seed);
  const out: MimicCoinFlight[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ((i + rand() * 0.7) / count) * Math.PI * 2;
    const reach = Math.sqrt(rand()) * radius * MIMIC_COIN_LOOK.spread;
    out.push({
      dx: Math.sin(angle) * reach,
      dz: Math.cos(angle) * reach,
      yaw: rand() * Math.PI * 2,
      spinX: (rand() - 0.5) * 24,
      spinZ: (rand() - 0.5) * 24,
      delay: (i / Math.max(1, count)) * 0.18,
    });
  }
  return out;
}

/** Where a coin is along its flight: `t` 0 at the mouth, 1 landed. A parabola
 *  over the straight line between the two points. */
export function mimicCoinArc(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  t: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const k = Math.max(0, Math.min(1, t));
  out.x = from.x + (to.x - from.x) * k;
  out.z = from.z + (to.z - from.z) * k;
  out.y = from.y + (to.y - from.y) * k + 4 * MIMIC_COIN_LOOK.arcPeak * k * (1 - k);
  return out;
}

/** How far along its flight a coin is, from the puddle's warning clock: it leaves
 *  after its delay and lands exactly as the warning ends. */
export function mimicCoinProgress(elapsed: number, flightSec: number, delay: number): number {
  const span = Math.max(1e-3, flightSec - delay);
  return Math.max(0, Math.min(1, (elapsed - delay) / span));
}

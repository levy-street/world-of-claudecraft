// Where each Smith's Heart guardian's loot is taken from: an authored spot on
// open floor in its arena (instance-local yards), where the forge coffer
// rises after the kill (render/smith_heart_fx/loot_coffer_core.ts) instead of
// tucking itself beside or under the fallen body. Each spot is clear of the
// body, the arena's set pieces and its hazards, and stands on the raid's way
// in (off the floor's light rivers), its front turned to `face` (the point
// the raid walks up from), so the
// coffer reads from the approach and nothing stands between it and the eye.
//
// The spot is a loot position, not only a look: the corpse loot gate
// (loot/corpse_loot_reach.ts corpseLootDistance) accepts a looter standing at
// the body's spot as well as at the body, on the authoritative sim and in
// every client mirror, so a click on the coffer (its pick proxy carries the
// corpse's id) loots from where the coffer stands. Pinned by
// tests/smith_heart_loot_coffer.test.ts and tests/corpse_loot_reach.test.ts.
//
// Pure: data, the instance frame (sim/data.ts) and the boss ids only.

import { SMITH_HEART_DUNGEON } from '../../content/smith_heart';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../data';
import { BREATH_GUARDIAN } from './breath_ids';
import { COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER } from './council_ids';
import { FINAL_BOSS } from './final_ids';
import { HEAT_GUARDIAN } from './heat_ids';
import { QUENCH_GUARDIAN } from './quench_ids';

export interface SmithHeartLootSpot {
  /** Instance-local yards. */
  readonly x: number;
  readonly z: number;
  /** The instance-local point the coffer's front turns to (the way in). */
  readonly face: { readonly x: number; readonly z: number };
}

/** The authored spot per guardian (its template id). */
export const SMITH_HEART_LOOT_SPOTS: Readonly<Record<string, SmithHeartLootSpot>> = {
  // The Quarry: the two council coffers side by side inside the west mouth of
  // the ring of columns, where the gallery's descent comes down into the pit.
  [COUNCIL_GUARDIAN]: { x: -4, z: -176, face: { x: -30, z: -176 } },
  [COUNCIL_SEAM_SINGER]: { x: -4, z: -164, face: { x: -30, z: -164 } },
  // The Storm Cornice: on the plateau's west side, before the walled climb's
  // head, well inside the open rim and its wind channels, off the vein's river.
  [BREATH_GUARDIAN]: { x: -12, z: 186, face: { x: -46, z: 183 } },
  // The Quench Basin: on the frozen lake's west shore, where the walk comes
  // in off the Singing Ice, clear of the sunk blades and with no brazier
  // between it and the way in.
  [QUENCH_GUARDIAN]: { x: 174, z: -22, face: { x: 146, z: -36 } },
  // The Hearth: between the door and the wellspring's burning lip (10.5 yd),
  // just off the vein's river that runs down the hall's centre, facing the door.
  [HEAT_GUARDIAN]: { x: -194, z: -9, face: { x: -170, z: -9 } },
  // The Anvil of the World: on open floor in the south quarter, between its
  // ridges and clear of the vein grooves, the altars and every quarter's boss
  // spot, facing the arrival terrace.
  [FINAL_BOSS]: { x: 181, z: 135, face: { x: 128, z: 112 } },
};

/** Where this body's loot is taken from, in world yards, with the coffer's
 *  yaw (the game's bearing: forward is (sin, cos)); null for any body that is
 *  not a Smith's Heart guardian. The instance is the body's own (its slot off
 *  its z), so every claim's coffer stands in its own arena. */
export function smithHeartLootSpot(
  templateId: string,
  bodyZ: number,
  out: { x: number; z: number; yaw: number } = { x: 0, z: 0, yaw: 0 },
): { x: number; z: number; yaw: number } | null {
  const spot = SMITH_HEART_LOOT_SPOTS[templateId];
  if (!spot) return null;
  const def = DUNGEONS[SMITH_HEART_DUNGEON];
  if (!def) return null;
  const o = instanceOrigin(def.index, instanceSlotForZ(bodyZ));
  out.x = o.x + spot.x;
  out.z = o.z + spot.z;
  out.yaw = Math.atan2(spot.face.x - spot.x, spot.face.z - spot.z);
  return out;
}

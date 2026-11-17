// The burst of the heart seal crystal (docs/design/raid/smith_heart.md, "The
// heart seal"): the press that opens the portal to the Heart. Once all four
// veins burn and the Ring is clear the seal is READY (seal.ts: the markers'
// charge bit, which also makes the crystal pressable, seal_crystal.ts); a
// living player standing within reach presses it (the existing `pickup`
// command: interaction.ts pickUpObject routes the crystal here) and it bursts:
//   - the PORTAL bit goes onto every seal marker AT ONCE (the same template
//     rewrite the seal's tick does), so this very tick's portal hop
//     (portal.ts) already finds the way open and every client mirrors it;
//   - the crystal leaves the claim and its wall goes (seal_crystal.ts), so the
//     portal's trigger at the dais centre is reachable;
//   - the raid reads one line.
// The bit is sticky (seal.ts keeps it for the claim's life), so a second press
// has nothing to burst, and a fresh claim starts shut again. A press on a
// crystal that is not charged answers with its own line and changes nothing.
// `/dev heart portal` is a forced burst through the same function.
//
// Sits above seal.ts and seal_crystal.ts (it imports both; neither imports
// it). Draws NO rng.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import {
  announce,
  markerMask,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_PORTAL_OPEN_LOG,
  smithHeartPortalBitSet,
  smithHeartReadyBitSet,
  writeSealMarkers,
} from './seal';
import { inSealCrystalReach, retireSealCrystal, sealCrystalClaim } from './seal_crystal';

/** The English line a press on a crystal that is not charged answers with
 *  (re-localized by src/ui/sim_i18n.ts, EXACT matcher). */
export const SMITH_HEART_SEAL_DARK_TEXT =
  'The heart seal crystal is dark. Light all four veins and clear the Ring first.';

/**
 * Burst the claim's crystal: the portal bit onto every marker, the crystal
 * gone with its wall, one line to the raid. Returns false (and changes
 * nothing) for a claim without seal markers or one whose crystal has burst
 * already.
 */
export function burstSmithHeartSeal(ctx: SimContext, inst: InstanceSlot): boolean {
  const before = markerMask(ctx, inst);
  if (before === null || smithHeartPortalBitSet(before)) return false;
  writeSealMarkers(ctx, inst, before | SMITH_HEART_PORTAL_BIT);
  retireSealCrystal(ctx, inst);
  announce(ctx, inst, SMITH_HEART_PORTAL_OPEN_LOG);
  return true;
}

/**
 * A living player's press on the crystal (`crystal` is the entity pressed,
 * `body` the player's own, `pid` the id errors go to): out of reach, a dark
 * crystal and a burst one each refuse; a charged crystal within reach bursts.
 * The caller (pickUpObject) has already turned the dead and the ghosts away.
 */
export function pressSmithHeartSealCrystal(
  ctx: SimContext,
  crystal: Entity,
  body: Entity,
  pid: number,
): boolean {
  const inst = sealCrystalClaim(ctx, crystal);
  if (!inst || !inSealCrystalReach(ctx, inst, crystal, body)) {
    ctx.error(pid, 'Too far away.');
    return false;
  }
  const value = markerMask(ctx, inst);
  if (value === null || smithHeartPortalBitSet(value)) return false;
  if (!smithHeartReadyBitSet(value)) {
    ctx.error(pid, SMITH_HEART_SEAL_DARK_TEXT);
    return false;
  }
  return burstSmithHeartSeal(ctx, inst);
}

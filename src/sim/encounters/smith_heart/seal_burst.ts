// The forced burst of the heart seal crystal (docs/design/raid/smith_heart.md,
// "The heart seal"): `/dev heart portal`. In play the crystal bursts on its own
// (seal.ts tickSmithHeartSeal: once all four veins burn and the Ring is clear, the
// first tick a living player of the claim stands in the middle circle,
// seal_crystal.ts sealCrystalTriggered); this is the same outcome, forced:
//   - the PORTAL bit goes onto every seal marker AT ONCE (the same template
//     rewrite the seal's tick does), so this very tick's portal hop (portal.ts)
//     already finds the way open and every client mirrors it;
//   - the crystal leaves the claim and its wall goes (seal_crystal.ts), so the
//     portal's trigger at the dais centre is reachable;
//   - the raid reads one line.
// The bit is sticky (seal.ts keeps it for the claim's life), so a second call has
// nothing to burst, and a fresh claim starts shut again.
//
// Sits above seal.ts and seal_crystal.ts (it imports both; neither imports it).
// Draws NO rng.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import {
  announce,
  markerMask,
  SMITH_HEART_PORTAL_BIT,
  SMITH_HEART_PORTAL_OPEN_LOG,
  smithHeartPortalBitSet,
  writeSealMarkers,
} from './seal';
import { retireSealCrystal } from './seal_crystal';

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

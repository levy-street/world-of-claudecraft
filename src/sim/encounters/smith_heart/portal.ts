// The Smith's Heart's portal hop (docs/design/raid/smith_heart.md, "The
// portal"): the heart seal on the Ring's dais opens into a portal once all
// four veins burn and the Ring is clear (seal.ts derives that and carries it
// on the seal markers); walking into it sets a living player down on the
// Heart's Arrival Terrace, a separate area of the same slot no floor joins
// to the main map. The return portal on the terrace walks the raid back to
// the dais at any time (a wipe's walk back, a corpse run's way out); it can
// only be reached through the open portal anyway.
//
// A corpse run needs nothing more: a released spirit rises at the raid's
// entrance (instances/dungeons.ts), walks the main map to the dais and steps
// through, because a portal once open stays open for the claim's life.
//
// Draws ZERO rng (the shared displacement recipe, displacement.ts), and runs
// once a tick per live claim from seal.ts tickSmithHeart.

import {
  HEART_ARRIVAL,
  HEART_RETURN_PORTAL,
  RING_PORTAL,
  RING_PORTAL_LANDING,
} from '../../content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../../data';
import { displacePlayer } from '../../displacement';
import { instanceHalfWidthOf } from '../../instances/instance_footprint';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';

/** The English line a player reads stepping through the Ring's portal
 *  (re-localized by src/ui/sim_i18n.ts, EXACT matcher). */
export const SMITH_HEART_PORTAL_HOP_TEXT =
  "The seal's light pulls you down into the heart of the mountain.";
/** ... and stepping through the return portal. */
export const SMITH_HEART_PORTAL_RETURN_TEXT = 'The light carries you back up to the heart seal.';

/**
 * One tick of one claim's portals: every living player standing in the
 * Ring's portal (while `ringOpen`) crosses to the Heart; every one standing
 * in the return portal crosses back to the dais.
 */
export function tickSmithHeartPortal(ctx: SimContext, inst: InstanceSlot, ringOpen: boolean): void {
  const dungeon = DUNGEONS[inst.dungeonId];
  if (!dungeon) return;
  const o = instanceOrigin(dungeon.index, inst.slot);
  const half = instanceHalfWidthOf(inst.dungeonId);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    const lx = e.pos.x - o.x;
    const lz = e.pos.z - o.z;
    if (Math.abs(lx) >= half || Math.abs(lz) >= 250) continue;
    if (ringOpen && Math.hypot(lx - RING_PORTAL.x, lz - RING_PORTAL.z) < RING_PORTAL.r) {
      displacePlayer(
        ctx,
        e,
        { x: o.x + HEART_ARRIVAL.x, z: o.z + HEART_ARRIVAL.z, facing: HEART_ARRIVAL.facing },
        SMITH_HEART_PORTAL_HOP_TEXT,
      );
    } else if (
      Math.hypot(lx - HEART_RETURN_PORTAL.x, lz - HEART_RETURN_PORTAL.z) < HEART_RETURN_PORTAL.r
    ) {
      displacePlayer(
        ctx,
        e,
        {
          x: o.x + RING_PORTAL_LANDING.x,
          z: o.z + RING_PORTAL_LANDING.z,
          facing: RING_PORTAL_LANDING.facing,
        },
        SMITH_HEART_PORTAL_RETURN_TEXT,
      );
    }
  }
}

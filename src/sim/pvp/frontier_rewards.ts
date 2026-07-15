// Frost-rare kill reward: every eligible contributor to a rare that dies INSIDE
// the Frontier band earns flat honor plus hero points (personal-loot-style, so a
// tapping party is all rewarded, not just whoever lands the last hit). Reuses the
// world-boss/rare contributor roster (bossDamagers, snapshotted by handleDeath).
// Draws NO rng, so it never perturbs the parity draw order.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { FRONTIER_RARE_HERO_POINTS, FRONTIER_RARE_HONOR, isFrontierPos } from './frontier';
import { grantHeroPoints } from './hero_points';
import { grantHonor } from './honor';

// The Incursion's frost rares. The reward gates on template id, not just position, so
// no future rare or owned mob dragged into the band can pay out (review note #10).
const FROSTREACH_RARE_IDS = new Set(['rimefang_stalker', 'frostbound_revenant']);

export function awardFrontierRareKill(
  ctx: SimContext,
  mob: Entity,
  contributors: PlayerMeta[] | null,
): void {
  if (!contributors || contributors.length === 0) return;
  if (!isFrontierPos(mob.pos.x) || !FROSTREACH_RARE_IDS.has(mob.templateId)) return;
  for (const meta of contributors) {
    grantHonor(ctx, meta, FRONTIER_RARE_HONOR, 'frontier_rare');
    grantHeroPoints(ctx, meta, FRONTIER_RARE_HERO_POINTS, 'frontier_rare');
    // Book of Deeds: the frost-rare hunter/warden deeds read this lifetime counter.
    ctx.bumpDeedStat(meta, 'frontierRareKills', 1);
  }
}

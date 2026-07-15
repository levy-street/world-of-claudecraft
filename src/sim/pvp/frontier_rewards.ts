// Frost-rare kill reward: every eligible contributor to a rare that dies INSIDE
// the Frontier band earns flat honor plus hero points (personal-loot-style, so a
// tapping party is all rewarded, not just whoever lands the last hit). Reuses the
// world-boss/rare contributor roster (bossDamagers, snapshotted by handleDeath).
// Draws NO rng, so it never perturbs the parity draw order.

import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import {
  FRONTIER_KILL_HONOR_MULT,
  FRONTIER_RARE_HERO_POINTS,
  FRONTIER_RARE_HONOR,
  inFrontierHub,
  isFrontierPos,
} from './frontier';
import { grantHeroPoints } from './hero_points';
import { FIESTA_KILL_HONOR, grantHonor } from './honor';

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

// Open-world player-kill reward: killing a hostile player out in the band (not the
// safe hub) pays the killer honor at the Frontier premium (FRONTIER_KILL_HONOR_MULT x
// the Fiesta takedown base). Draws no rng. Pets credit their owner.
export function awardFrontierPlayerKill(
  ctx: SimContext,
  victim: Entity,
  killer: Entity | null,
): void {
  if (victim.kind !== 'player' || !killer) return;
  if (!isFrontierPos(victim.pos.x) || inFrontierHub(victim.pos.x, victim.pos.z)) return;
  const killerId = killer.kind === 'player' ? killer.id : killer.ownerId;
  if (killerId === null || killerId === victim.id) return;
  const killerMeta = ctx.players.get(killerId);
  if (!killerMeta) return;
  grantHonor(ctx, killerMeta, FIESTA_KILL_HONOR * FRONTIER_KILL_HONOR_MULT, 'frontier_kill');
}

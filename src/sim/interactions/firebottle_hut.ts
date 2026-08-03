// Firebottle huts (q_deepfen_purge / "Back to the Shallows"). The player is given
// a firebottle on accept; torching a murloc hut is gated on holding the bottle,
// being right up against the hut, and the bottle's throw cooldown. Burning a hut
// credits the interact objective and ignites it for a relight cooldown so the
// quest stays repeatable. The pure check is unit-tested; tryBurnHut applies it.
import { interactObjectForQuests } from '../encounters/nythraxis';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity } from '../types';

export const HUT_QUEST_ID = 'q_deepfen_purge';
export const FIREBOTTLE_ITEM_ID = 'firebottle';
export const HUT_OBJECT_ID = 'murloc_hut';
export const HUT_BURN_RANGE = 3.5; // must be right up against the hut
export const FIREBOTTLE_COOLDOWN_SECS = 5;
export const HUT_RELIGHT_SECS = 45;

export type HutBurnReason = 'notOnQuest' | 'noBottle' | 'tooFar' | 'onCooldown' | 'alreadyBurning';
export type HutBurnResult = { ok: true } | { ok: false; reason: HutBurnReason };

export function firebottleBurnCheck(opts: {
  onQuest: boolean;
  hasBottle: boolean;
  distance: number;
  time: number;
  bottleReadyAt: number;
  hutBurningUntil: number;
}): HutBurnResult {
  if (!opts.onQuest) return { ok: false, reason: 'notOnQuest' };
  if (!opts.hasBottle) return { ok: false, reason: 'noBottle' };
  if (opts.distance > HUT_BURN_RANGE) return { ok: false, reason: 'tooFar' };
  if (opts.bottleReadyAt > opts.time) return { ok: false, reason: 'onCooldown' };
  if (opts.hutBurningUntil > opts.time) return { ok: false, reason: 'alreadyBurning' };
  return { ok: true };
}

const REASON_MESSAGE: Record<HutBurnReason, string | null> = {
  notOnQuest: null, // not on the quest: a plain click does nothing
  noBottle: 'You need a firebottle to torch that.',
  tooFar: 'Get right up against the hut to torch it.',
  onCooldown: 'Your firebottle is not ready yet.',
  alreadyBurning: 'That hut is already ablaze.',
};

export function tryBurnHut(
  ctx: SimContext,
  hut: Entity,
  player: Entity,
  meta: PlayerMeta,
): boolean {
  const qp = meta.questLog.get(HUT_QUEST_ID);
  const result = firebottleBurnCheck({
    onQuest: !!qp && (qp.state === 'active' || qp.state === 'ready'),
    hasBottle: ctx.countItem(FIREBOTTLE_ITEM_ID, meta.entityId) > 0,
    distance: dist2d(player.pos, hut.pos),
    time: ctx.time,
    bottleReadyAt: meta.firebottleReadyAt ?? 0,
    hutBurningUntil: hut.burnBurstUntil ?? 0,
  });
  if (!result.ok) {
    const msg = REASON_MESSAGE[result.reason];
    if (msg) ctx.error(meta.entityId, msg);
    return false;
  }
  meta.firebottleReadyAt = ctx.time + FIREBOTTLE_COOLDOWN_SECS;
  hut.burnBurstUntil = ctx.time + HUT_RELIGHT_SECS;
  // Throw animation (windup) + the bottle arcing to the hut + the blaze itself.
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: hut.id,
    school: 'fire',
    fx: 'windup',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: player.id,
    targetId: hut.id,
    school: 'fire',
    fx: 'projectile',
  });
  ctx.emit({
    type: 'worldObjectBurning',
    objectId: hut.id,
    x: hut.pos.x,
    z: hut.pos.z,
    durationSecs: HUT_RELIGHT_SECS,
  });
  interactObjectForQuests(ctx, hut, meta);
  return true;
}

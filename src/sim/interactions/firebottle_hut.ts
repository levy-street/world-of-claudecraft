// Firebottle huts (q_deepfen_purge / "Back to the Shallows"). The player gets a
// reusable firebottle on accept; USING it (from the bag or action bar) hurls it at
// the nearest murloc hut they are standing against, torching it. Gated on holding
// the bottle, being right up against a hut, and the bottle's throw cooldown.
// Burning a hut credits the "burn huts" objective and ignites it for a relight
// cooldown so the quest stays repeatable. The pure check is unit-tested.
import { QUESTS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, questObjectiveRequired } from '../types';

export const HUT_QUEST_ID = 'q_deepfen_purge';
export const FIREBOTTLE_ITEM_ID = 'firebottle';
export const HUT_OBJECT_ID = 'murloc_hut';
export const HUT_BURN_RANGE = 5; // must be right up against the hut
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
  notOnQuest: null, // no quest: silent, so a stray use is not spammy
  noBottle: 'You need a firebottle to torch that.',
  tooFar: 'Get right up against a hut to torch it.',
  onCooldown: 'Your firebottle is not ready yet.',
  alreadyBurning: 'That hut is already ablaze.',
};

// Credit the q_deepfen_purge "burn huts" interact objective by one, capped at its
// required count (each hut ignites once, then relights only after HUT_RELIGHT_SECS).
function creditHutObjective(ctx: SimContext, meta: PlayerMeta): void {
  const qp = meta.questLog.get(HUT_QUEST_ID);
  if (!qp || qp.state !== 'active') return;
  const quest = QUESTS[HUT_QUEST_ID];
  quest.objectives.forEach((objective, i) => {
    if (objective.type !== 'interact' || objective.targetObjectItemId !== HUT_OBJECT_ID) return;
    const required = questObjectiveRequired(quest, qp, i);
    if (qp.counts[i] >= required) return;
    qp.counts[i]++;
    meta.counters.questProgress++;
    ctx.emit({
      type: 'questProgress',
      questId: HUT_QUEST_ID,
      objectiveIndex: i,
      current: qp.counts[i],
      required,
      text: `${objective.label}: ${qp.counts[i]}/${required}`,
      pid: meta.entityId,
    });
    ctx.checkQuestReady(qp, meta);
  });
}

function burnHut(ctx: SimContext, hut: Entity, player: Entity, meta: PlayerMeta): void {
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
  creditHutObjective(ctx, meta);
}

// Using the firebottle throws it at the nearest not-yet-burning hut in range.
// Reusable: the bottle is not consumed; the throw cooldown paces the burns.
export function throwFirebottleAtNearestHut(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
): void {
  let nearest: Entity | null = null;
  let nearestD = Number.POSITIVE_INFINITY;
  for (const e of ctx.entities.values()) {
    if (e.objectItemId !== HUT_OBJECT_ID) continue;
    if ((e.burnBurstUntil ?? 0) > ctx.time) continue; // already ablaze
    const d = dist2d(player.pos, e.pos);
    if (d < nearestD) {
      nearestD = d;
      nearest = e;
    }
  }
  const qp = meta.questLog.get(HUT_QUEST_ID);
  const result = firebottleBurnCheck({
    onQuest: !!qp && (qp.state === 'active' || qp.state === 'ready'),
    hasBottle: ctx.countItem(FIREBOTTLE_ITEM_ID, meta.entityId) > 0,
    distance: nearest ? nearestD : Number.POSITIVE_INFINITY,
    time: ctx.time,
    bottleReadyAt: meta.firebottleReadyAt ?? 0,
    hutBurningUntil: 0,
  });
  if (!result.ok) {
    const msg = REASON_MESSAGE[result.reason];
    if (msg) ctx.error(meta.entityId, msg);
    return;
  }
  if (nearest) burnHut(ctx, nearest, player, meta);
}

// Click-on-hut path (interaction.ts). The primary flow is using the bottle from
// the bag, but clicking the hut object works too.
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
  burnHut(ctx, hut, player, meta);
  return true;
}

// Firebottle huts (q_deepfen_purge / "Back to the Shallows"). The player gets a
// reusable firebottle on accept; USING it hurls it at the nearest murloc hut they
// are standing against, torching it. Gated on holding the bottle, being right up
// against a hut, and the bottle's throw cooldown. A freshly torched hut smolders on
// a per-player HUT_REBURN_COOLDOWN_SECS cooldown (recorded on the QuestProgress);
// while it is smoldering a re-throw is a warning, but once the cooldown lapses the
// same hut can be torched and credited again. So the objective is forgiving (five
// distinct huts, or one hut re-burned every couple of minutes) and no permanent
// per-run state can strand it. The pure check is unit-tested.
import { QUESTS } from '../data';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, type QuestProgress, questObjectiveRequired } from '../types';

export const HUT_QUEST_ID = 'q_deepfen_purge';
export const FIREBOTTLE_ITEM_ID = 'firebottle';
export const HUT_OBJECT_ID = 'murloc_hut';
export const HUT_BURN_RANGE = 5; // must be right up against the hut
export const FIREBOTTLE_COOLDOWN_SECS = 5;
// A torched hut smolders for two minutes before it can be burned (and credited) again.
export const HUT_REBURN_COOLDOWN_SECS = 120;

export type HutBurnReason = 'notOnQuest' | 'noBottle' | 'onCooldown' | 'tooFar' | 'hutOnCooldown';
export type HutBurnResult = { ok: true } | { ok: false; reason: HutBurnReason };

export function firebottleBurnCheck(opts: {
  onQuest: boolean;
  hasBottle: boolean;
  distance: number;
  time: number;
  bottleReadyAt: number;
  hutOnCooldown: boolean;
}): HutBurnResult {
  if (!opts.onQuest) return { ok: false, reason: 'notOnQuest' };
  if (!opts.hasBottle) return { ok: false, reason: 'noBottle' };
  if (opts.bottleReadyAt > opts.time) return { ok: false, reason: 'onCooldown' };
  if (opts.distance > HUT_BURN_RANGE) return { ok: false, reason: 'tooFar' };
  if (opts.hutOnCooldown) return { ok: false, reason: 'hutOnCooldown' };
  return { ok: true };
}

const REASON_MESSAGE: Record<HutBurnReason, string | null> = {
  notOnQuest: null, // no quest: silent, so a stray use is not spammy
  noBottle: 'You need a firebottle to torch that.',
  onCooldown: 'Your firebottle is not ready yet.',
  tooFar: 'Get right up against a hut to torch it.',
  hutOnCooldown: 'This hut is still burning.',
};

const burnedList = (qp: QuestProgress): { key: string; at: number }[] => qp.burnedObjects ?? [];

// STABLE per-hut key for the persisted burn stamps: the object item id plus the
// rounded spawn position. Runtime entity ids are spawn-order-assigned, so a
// persisted id could alias a different object after a reboot or a content change
// that shifts spawn order; the content position cannot.
export function stableHutKey(hut: Entity): string {
  return `${hut.objectItemId}@${Math.round(hut.pos.x)},${Math.round(hut.pos.z)}`;
}

// A hut is on its re-burn cooldown if it was torched within the last
// HUT_REBURN_COOLDOWN_SECS. A burn stamped in the FUTURE (a server restart reset
// sim-time under a persisted run) reads as lapsed, never stuck forever.
function hutOnReburnCooldown(qp: QuestProgress, hutKey: string, now: number): boolean {
  const entry = burnedList(qp).find((b) => b.key === hutKey);
  if (!entry) return false;
  return now >= entry.at && now - entry.at < HUT_REBURN_COOLDOWN_SECS;
}

// Credit the q_deepfen_purge "burn huts" interact objective by one, capped at its
// required count. Called once per NEWLY burned hut.
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

function burnHut(
  ctx: SimContext,
  hut: Entity,
  player: Entity,
  meta: PlayerMeta,
  qp: QuestProgress,
): void {
  meta.firebottleReadyAt = ctx.time + FIREBOTTLE_COOLDOWN_SECS;
  // Materialized remaining seconds so the bag can paint the throw-cooldown swipe.
  player.firebottleCdRemaining = FIREBOTTLE_COOLDOWN_SECS;
  // Stamp this hut's burn time, keeping only the latest entry per hut, so it goes
  // on its re-burn cooldown and can be torched again once the cooldown lapses.
  const hutKey = stableHutKey(hut);
  qp.burnedObjects = [
    ...burnedList(qp).filter((b) => b.key !== hutKey),
    { key: hutKey, at: ctx.time },
  ];
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
  ctx.emit({ type: 'worldObjectBurning', objectId: hut.id, x: hut.pos.x, z: hut.pos.z });
  creditHutObjective(ctx, meta);
}

// Using the firebottle throws it at the nearest hut in range. Reusable: the bottle
// is not consumed; the throw cooldown paces the burns, and a hut already burned
// this run gives the "already burning" warning instead of crediting again.
export function throwFirebottleAtNearestHut(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
): void {
  let nearest: Entity | null = null;
  let nearestD = Number.POSITIVE_INFINITY;
  for (const e of ctx.entities.values()) {
    if (e.objectItemId !== HUT_OBJECT_ID) continue;
    const d = dist2d(player.pos, e.pos);
    if (d < nearestD) {
      nearestD = d;
      nearest = e;
    }
  }
  const qp = meta.questLog.get(HUT_QUEST_ID);
  const onQuest = !!qp && (qp.state === 'active' || qp.state === 'ready');
  const hutOnCooldown =
    !!qp && !!nearest && hutOnReburnCooldown(qp, stableHutKey(nearest), ctx.time);
  const result = firebottleBurnCheck({
    onQuest,
    hasBottle: ctx.countItem(FIREBOTTLE_ITEM_ID, meta.entityId) > 0,
    distance: nearest ? nearestD : Number.POSITIVE_INFINITY,
    time: ctx.time,
    bottleReadyAt: meta.firebottleReadyAt ?? 0,
    hutOnCooldown,
  });
  if (!result.ok) {
    const msg = REASON_MESSAGE[result.reason];
    if (msg) ctx.error(meta.entityId, msg);
    return;
  }
  if (nearest && qp) burnHut(ctx, nearest, player, meta, qp);
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
  const onQuest = !!qp && (qp.state === 'active' || qp.state === 'ready');
  const result = firebottleBurnCheck({
    onQuest,
    hasBottle: ctx.countItem(FIREBOTTLE_ITEM_ID, meta.entityId) > 0,
    distance: dist2d(player.pos, hut.pos),
    time: ctx.time,
    bottleReadyAt: meta.firebottleReadyAt ?? 0,
    hutOnCooldown: !!qp && hutOnReburnCooldown(qp, stableHutKey(hut), ctx.time),
  });
  if (!result.ok) {
    const msg = REASON_MESSAGE[result.reason];
    if (msg) ctx.error(meta.entityId, msg);
    return false;
  }
  if (qp) burnHut(ctx, hut, player, meta, qp);
  return true;
}

// Weekly quests: one charge per week chosen at the emissary, credited by the
// game's own completion signals, paid once, and rolled every Tuesday.
//
// The module owns the whole rule set behind the SimContext seam: the week
// identity (derived from the host-fed reset day, so every host agrees), the
// emissary spawn, the talk that opens the client window, the pick, the three
// credit hooks the existing systems call (dungeon and raid clears from the
// deeds credit path, battleground results, world-boss kills), the reward, and
// the save shape. Nothing here draws randomness.
import {
  WEEKLY_EMISSARY_NPC_DEF,
  WEEKLY_EMISSARY_NPC_ID,
  WEEKLY_EMISSARY_TALK_RANGE,
  WEEKLY_QUEST_EPOCH_DAY,
  WEEKLY_QUEST_REWARD,
  WEEKLY_QUEST_WEEK_PREFIX,
  WEEKLY_QUESTS_BY_ID,
  type WeeklyQuestDef,
  type WeeklyQuestKind,
} from './content/weekly_quests';
import { createNpc } from './entity';
import {
  awardFactionReputation,
  FACTION_IDS,
  type FactionId,
  factionDisplayName,
} from './factions';
import { formatMoney } from './format_money';
import { DAILY_LOCKOUT_RAID_ROOMS, WEEKLY_LOCKOUT_RAID_ROOMS } from './instances/dungeons';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { Entity, WeeklyQuestProgress } from './types';
import { civilDayNumber } from './world_quest_rotation';

const EPOCH_DAY = civilDayNumber(WEEKLY_QUEST_EPOCH_DAY) as number;

/** The week a reset day belongs to ('' for a malformed day): weeks start on
 *  the epoch's weekday, so the id rolls on the realm's Tuesday reset. */
export function weeklyQuestWeekForResetDay(resetDay: string): string {
  const day = civilDayNumber(resetDay);
  if (day === null) return '';
  return `${WEEKLY_QUEST_WEEK_PREFIX}${Math.floor((day - EPOCH_DAY) / 7)}`;
}

export function currentWeeklyQuestWeek(ctx: Pick<SimContext, 'resetDay'>): string {
  return weeklyQuestWeekForResetDay(ctx.resetDay);
}

/** A pick from an earlier week is over, done or not: the ledger starts clean. */
export function resetWeeklyQuestIfNeeded(
  ctx: Pick<SimContext, 'resetDay'>,
  meta: PlayerMeta,
): void {
  const progress = meta.weeklyQuest;
  if (!progress) return;
  if (progress.week !== currentWeeklyQuestWeek(ctx)) {
    meta.weeklyQuest = null;
    meta.wireRev++;
  }
}

export function weeklyQuestRewardCopper(level: number): number {
  const { base, perLevel } = WEEKLY_QUEST_REWARD.copper;
  return base + perLevel * Math.max(1, Math.floor(level));
}

function contentEnabled(ctx: SimContext): boolean {
  return !ctx.cfg.world || !!ctx.cfg.world.npcs[WEEKLY_EMISSARY_NPC_DEF.id];
}

/** The emissary stands in town for everyone; spawned on demand like the instructors. */
export function ensureWeeklyEmissary(ctx: SimContext): void {
  if (!contentEnabled(ctx) || ctx.entities.has(WEEKLY_EMISSARY_NPC_ID)) return;
  const def = WEEKLY_EMISSARY_NPC_DEF;
  ctx.addEntity(createNpc(WEEKLY_EMISSARY_NPC_ID, def, ctx.groundPos(def.pos.x, def.pos.z)));
}

function isWeeklyEmissary(npc: Entity): boolean {
  return (
    npc.kind === 'npc' &&
    npc.id === WEEKLY_EMISSARY_NPC_ID &&
    npc.templateId === WEEKLY_EMISSARY_NPC_DEF.id
  );
}

function nearEmissary(ctx: SimContext, player: Entity): Entity | undefined {
  const npc = ctx.entities.get(WEEKLY_EMISSARY_NPC_ID);
  if (!npc || !isWeeklyEmissary(npc) || npc.dead) return undefined;
  const dx = player.pos.x - npc.pos.x,
    dz = player.pos.z - npc.pos.z;
  if (Math.hypot(dx, dz) > WEEKLY_EMISSARY_TALK_RANGE) return undefined;
  if (Math.abs(player.pos.y - npc.pos.y) > 3) return undefined;
  return npc;
}

/** Talking to the emissary opens the weekly window (a structured personal
 *  event; the client owns every visible string). True when the talk was his. */
export function talkToWeeklyEmissary(
  ctx: SimContext,
  npc: Entity,
  meta: PlayerMeta,
  player: Entity,
): boolean {
  if (!isWeeklyEmissary(npc)) return false;
  if (!nearEmissary(ctx, player)) return true;
  resetWeeklyQuestIfNeeded(ctx, meta);
  ctx.emit({ type: 'worldQuestWeeklyOpen', pid: meta.entityId });
  return true;
}

/** The authoritative pick: alive, beside the emissary, a real offer, and no
 *  charge taken yet this week (a finished one counts as taken). */
export function chooseWeeklyQuest(ctx: SimContext, questId: string, pid?: number): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { meta, e: player } = resolved;
  const quest = WEEKLY_QUESTS_BY_ID[questId];
  if (!quest || player.dead || !nearEmissary(ctx, player)) return;
  resetWeeklyQuestIfNeeded(ctx, meta);
  if (meta.weeklyQuest) return;
  const week = currentWeeklyQuestWeek(ctx);
  if (!week) return;
  meta.weeklyQuest = { questId: quest.id, week, count: 0, state: 'active' };
  meta.wireRev++;
  ctx.emit({ type: 'worldQuestWeeklyChosen', questId: quest.id, pid: meta.entityId });
}

/** The emissary's commendation: once the week's charge is finished, one
 *  faction of the owner's choice receives WEEKLY_QUEST_REWARD.commendationStanding.
 *  One claim per week; a faction with no standing headroom at this level is
 *  refused and the choice stays open. The award rides awardFactionReputation,
 *  so the tier plate, the chat line and the standing deeds all follow. */
export function commendWeeklyQuest(ctx: SimContext, factionId: string, pid?: number): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { meta, e: player } = resolved;
  if (!(FACTION_IDS as readonly string[]).includes(factionId)) return;
  resetWeeklyQuestIfNeeded(ctx, meta);
  const progress = meta.weeklyQuest;
  if (!progress || progress.state !== 'completed' || progress.commended) return;
  const result = awardFactionReputation(
    meta,
    factionId as FactionId,
    WEEKLY_QUEST_REWARD.commendationStanding,
    player.level,
  );
  if (result.gained <= 0) return;
  progress.commended = factionId;
  meta.wireRev++;
  ctx.markDeedsDirty(meta.entityId);
  ctx.emit({
    type: 'loot',
    text: `+${result.gained} ${factionDisplayName(factionId as FactionId)} Standing.`,
    pid: meta.entityId,
  });
}

function activeWeeklyQuest(
  ctx: Pick<SimContext, 'resetDay'>,
  meta: PlayerMeta,
): { quest: WeeklyQuestDef; progress: WeeklyQuestProgress } | null {
  resetWeeklyQuestIfNeeded(ctx, meta);
  const progress = meta.weeklyQuest;
  if (!progress || progress.state !== 'active') return null;
  const quest = WEEKLY_QUESTS_BY_ID[progress.questId];
  return quest ? { quest, progress } : null;
}

/** One completion of `kind` for this player. Pays and closes the charge when
 *  the count is met; a charge of another kind is untouched. */
export function creditWeeklyQuest(ctx: SimContext, meta: PlayerMeta, kind: WeeklyQuestKind): void {
  const active = activeWeeklyQuest(ctx, meta);
  if (!active || active.quest.kind !== kind) return;
  const { quest, progress } = active;
  progress.count = Math.min(quest.count, progress.count + 1);
  meta.wireRev++;
  if (progress.count < quest.count) {
    ctx.emit({
      type: 'worldQuestWeeklyProgress',
      questId: quest.id,
      count: progress.count,
      required: quest.count,
      pid: meta.entityId,
    });
    return;
  }
  progress.state = 'completed';
  const player = ctx.entities.get(meta.entityId);
  const copper = weeklyQuestRewardCopper(player?.level ?? 1);
  meta.copper += copper;
  ctx.emit({ type: 'loot', text: `You receive ${formatMoney(copper)}.`, pid: meta.entityId });
  ctx.addItem(WEEKLY_QUEST_REWARD.cacheItemId, WEEKLY_QUEST_REWARD.cacheCount, meta.entityId);
  ctx.emit({ type: 'worldQuestWeeklyDone', questId: quest.id, pid: meta.entityId });
}

// ---- the credit hooks the existing systems call ----------------------------

/** A final boss fell: a raid room credits the raid charge, any other dungeon
 *  the dungeon charge. Recipients are the caller's clear-credit roster. */
export function onDungeonClearedForWeeklyQuests(
  ctx: SimContext,
  dungeonId: string,
  recipients: readonly PlayerMeta[],
): void {
  const raid = WEEKLY_LOCKOUT_RAID_ROOMS.has(dungeonId) || DAILY_LOCKOUT_RAID_ROOMS.has(dungeonId);
  for (const meta of recipients) creditWeeklyQuest(ctx, meta, raid ? 'raid' : 'dungeons');
}

/** A battleground match resolved for this fighter, win or lose. */
export function onBattlegroundMatchForWeeklyQuests(ctx: SimContext, meta: PlayerMeta): void {
  creditWeeklyQuest(ctx, meta, 'battlegrounds');
}

/** A world boss fell: everyone on its contributor roster. */
export function onWorldBossKilledForWeeklyQuests(
  ctx: SimContext,
  contributors: readonly PlayerMeta[],
): void {
  for (const meta of contributors) creditWeeklyQuest(ctx, meta, 'worldboss');
}

// ---- persistence and wire ---------------------------------------------------

/** Accept only a well-formed pick for a real quest; anything else loads as none. */
export function sanitizeWeeklyQuestProgress(value: unknown): WeeklyQuestProgress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<WeeklyQuestProgress>;
  const quest = typeof row.questId === 'string' ? WEEKLY_QUESTS_BY_ID[row.questId] : undefined;
  if (!quest) return null;
  if (typeof row.week !== 'string' || !row.week.startsWith(WEEKLY_QUEST_WEEK_PREFIX)) return null;
  if (row.state !== 'active' && row.state !== 'completed') return null;
  const count =
    typeof row.count === 'number' && Number.isFinite(row.count)
      ? Math.max(0, Math.min(quest.count, Math.floor(row.count)))
      : 0;
  const commended =
    row.state === 'completed' &&
    typeof row.commended === 'string' &&
    (FACTION_IDS as readonly string[]).includes(row.commended)
      ? row.commended
      : undefined;
  return {
    questId: quest.id,
    week: row.week,
    count: row.state === 'completed' ? quest.count : count,
    state: row.state,
    ...(commended === undefined ? {} : { commended }),
  };
}

export function savedWeeklyQuestProgress(meta: PlayerMeta): WeeklyQuestProgress | undefined {
  return meta.weeklyQuest ? { ...meta.weeklyQuest } : undefined;
}

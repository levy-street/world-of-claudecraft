// Fire and Fly as a world quest: Master Gunner Alder at the Evergarden gate,
// spawned lazily like the glider's instructor, and the one start both entries
// share (the plain talk at the default scenario, the dialog's pick through
// startWorldQuestActivity). The seat, its arena and its run live in
// turret_defense_session.ts; a won run is credited by completeWorldQuestTurret
// in world_quests.ts, from the run this start captured on the seat.

import { TURRET_SCENARIOS } from './content/fire_and_fly_scenarios';
import {
  FIRE_AND_FLY_NPC_DEF,
  FIRE_AND_FLY_NPC_ID,
  FIRE_AND_FLY_QUEST_ID,
  WORLD_QUEST_FIRE_AND_FLY,
} from './content/world_quest_fire_and_fly';
import { createNpc } from './entity';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { seatTurret, type TurretSeatRefusal } from './turret_defense_session';
import {
  type Entity,
  INTERACT_RANGE,
  type TurretScenarioDef,
  type TurretWorldQuestRun,
} from './types';
import { playerActiveWorldQuests } from './world_quest_reroll';

/** Why a start was refused: the seat's own reasons, plus the instructor's. */
export type FireAndFlyStartRefusal =
  | TurretSeatRefusal
  /** No scenario has that id. */
  | 'scenario'
  /** The instructor is not standing at his post. */
  | 'instructor'
  | 'level'
  | 'range'
  /** Neither today's row to play for nor a completed one to practice. */
  | 'offer';

const POST_TOLERANCE = 0.1;
const TALK_HEIGHT = 3;

export function ensureFireAndFlyInstructor(ctx: SimContext): void {
  if (ctx.cfg.world && !ctx.cfg.world.npcs[FIRE_AND_FLY_NPC_DEF.id]) return;
  if (ctx.entities.has(FIRE_AND_FLY_NPC_ID)) return;
  const { x, z } = FIRE_AND_FLY_NPC_DEF.pos;
  ctx.addEntity(createNpc(FIRE_AND_FLY_NPC_ID, FIRE_AND_FLY_NPC_DEF, ctx.groundPos(x, z)));
}

export function fireAndFlyScenarioById(id: string): Readonly<TurretScenarioDef> | null {
  return TURRET_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}

function atPost(npc: Entity | undefined): npc is Entity {
  return (
    !!npc &&
    npc.kind === 'npc' &&
    npc.templateId === FIRE_AND_FLY_NPC_DEF.id &&
    Math.hypot(npc.pos.x - FIRE_AND_FLY_NPC_DEF.pos.x, npc.pos.z - FIRE_AND_FLY_NPC_DEF.pos.z) <=
      POST_TOLERANCE
  );
}

/**
 * Seats the player for a run of `scenarioId` when every gate holds, in the
 * glider pick's order: a known scenario, alive, the level, within talking range
 * of the instructor, and a row to play for (today's active offer) or to practice
 * (a completed one: the practice run never pays). The mount gate is the seat's
 * own: a vehicle seat or a mount race refuses, and a rider is set on foot with
 * the mount remembered and given back on leaving. The return point is where the
 * player stood, next to the instructor. `mintRow` runs only once the player
 * stands at the instructor, just before the row is read: the dialog's pick
 * sweeps the area there, as the glider's does.
 */
export function startFireAndFly(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  scenarioId: string,
  mintRow?: () => void,
): FireAndFlyStartRefusal | null {
  const refusal = seatForTrial(ctx, meta, player, scenarioId, mintRow);
  if (refusal) sayRefusal(ctx, meta.entityId, refusal);
  return refusal;
}

function seatForTrial(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  scenarioId: string,
  mintRow: (() => void) | undefined,
): FireAndFlyStartRefusal | null {
  const scenario = fireAndFlyScenarioById(scenarioId);
  if (!scenario) return 'scenario';
  const npc = ctx.entities.get(FIRE_AND_FLY_NPC_ID);
  if (!atPost(npc)) return 'instructor';
  if (player.dead || player.ghost) return 'dead';
  if (player.level < WORLD_QUEST_FIRE_AND_FLY.minLevel) return 'level';
  if (
    Math.hypot(player.pos.x - npc.pos.x, player.pos.z - npc.pos.z) > INTERACT_RANGE ||
    Math.abs(player.pos.y - npc.pos.y) > TALK_HEIGHT
  )
    return 'range';
  mintRow?.();
  const run = trialRun(meta);
  if (!run) return 'offer';
  return seatTurret(ctx, meta.entityId, scenario, undefined, run);
}

/**
 * The run a trial seats for on the character's current day: practice once the day's
 * row is completed, a paid run while it is today's active offer, null for neither.
 */
function trialRun(meta: PlayerMeta): TurretWorldQuestRun | null {
  const progress = meta.worldQuestLog.get(FIRE_AND_FLY_QUEST_ID);
  const practice = progress?.state === 'completed';
  const offered = progress?.state === 'active' && todaysOffer(meta);
  if (!practice && !offered) return null;
  return { questId: FIRE_AND_FLY_QUEST_ID, cycle: meta.worldQuestCycle, practice };
}

function todaysOffer(meta: PlayerMeta): boolean {
  return playerActiveWorldQuests(meta).some((quest) => quest.id === FIRE_AND_FLY_QUEST_ID);
}

/**
 * The run a Replay of an instructor's seat gets, by the start's rules on the day the
 * caller reconciled: practice after the day's reward, else the day's paid run. A day
 * that rolled over while the player sat in the arena has no row yet (the area sweep
 * mints one only beside the instructor, where the player stood to be seated), so
 * `mintRow` starts it here as the sweep would. Null when the character has no row to
 * play.
 */
export function fireAndFlyReplayRun(
  meta: PlayerMeta,
  player: Entity,
  mintRow: () => void,
): TurretWorldQuestRun | null {
  if (player.level < WORLD_QUEST_FIRE_AND_FLY.minLevel) return null;
  if (!meta.worldQuestLog.has(FIRE_AND_FLY_QUEST_ID) && todaysOffer(meta)) mintRow();
  return trialRun(meta);
}

/** The player's line for a refusal they can act on; the rest stay silent (the dialog never offers them). */
function sayRefusal(ctx: SimContext, pid: number, refusal: FireAndFlyStartRefusal): void {
  switch (refusal) {
    case 'dead':
      ctx.error(pid, "You can't do that while dead.");
      return;
    case 'combat':
      ctx.error(pid, "You can't do that while in combat.");
      return;
    case 'range':
      ctx.error(pid, 'Too far away.');
      return;
    case 'water':
      ctx.error(pid, "You can't do that while swimming.");
      return;
    case 'level':
      ctx.error(pid, "You are not yet ready for the gunner's trials.");
      return;
    case 'full':
      ctx.error(pid, 'Every Fire and Fly tower is manned. Try again in a moment.');
      return;
    case 'seated':
    case 'match':
    case 'instance':
    case 'busy':
    case 'cargo':
      ctx.error(pid, 'You are busy.');
      return;
    case 'missing':
    case 'leaving':
    case 'scenario':
    case 'instructor':
    case 'offer':
      return;
  }
}

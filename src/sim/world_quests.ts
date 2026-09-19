import { maybeAwardClueScroll, updateClueHunt } from './clue_scrolls';
import { WORLD_QUEST_CALLIGRAPHY_ID } from './content/world_quest_calligraphy';
import { FORGE_QUEST_ID } from './content/world_quest_forging';
import { GLIDER_APPRENTICE_NPC_DEF, GLIDER_QUEST_ID } from './content/world_quest_glider';
import { INVESTIGATION_QUEST_ID } from './content/world_quest_investigation';
import { SHADOW_QUEST_ID } from './content/world_quest_shadow';
import { WISP_MAZE_QUEST_ID } from './content/world_quest_wisp_maze';
import { WORLD_QUEST_MIN_LEVEL, WORLD_QUESTS, WORLD_QUESTS_BY_ID } from './content/world_quests';
import { grantDeed } from './deeds';
import {
  awardFactionReputation,
  factionDisplayName,
  worldQuestFaction,
  worldQuestStandingReward,
} from './factions';
import { formatMoney } from './format_money';
import { sanitizeForgeResult } from './minigames/forge_workshop';
import { applyGliderBoost } from './minigames/glider_boost';
import {
  hasInteractObjectCredit,
  interactObjectCreditKey,
  recordInteractObjectCredit,
  sanitizeCreditedObjects,
} from './quests/interact_object_credit';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type {
  Entity,
  GatherNodeDef,
  WorldQuestDef,
  WorldQuestProgress,
  WorldQuestReward,
} from './types';
import { xpForLevel } from './types';
import { vehicleStationById } from './vehicle_stations';
import { ensureWeeklyEmissary } from './weekly_quests';
import { recordWeeklyWorldQuest } from './weekly_rewards';
import {
  FARSHORE_SALVAGE_AMBUSH,
  triggerWorldQuestAmbush,
  updateWorldQuestAmbush,
} from './world_quest_ambush';
import {
  awardWorldQuestBonusCopper,
  WISP_MAZE_HARD_BONUS,
  worldQuestBonusCopper,
} from './world_quest_bonus';
import { summonWorldQuestChampion, updateWorldQuestChampions } from './world_quest_champion';
import {
  resolveWorldQuestLeyPuzzle as beamPuzzle,
  resolveWorldQuestMatch3Level as match3Level,
} from './world_quest_daily_levels';
import {
  dropWorldQuestDeliveryCargo,
  hasWorldQuestDeliveryCargo,
  takeWorldQuestDeliveryCargo,
} from './world_quest_delivery';
import {
  clearForgeWorkshop,
  ensureForgeWorkshop,
  forgeStationForEntity,
  respondForgeWorkshop,
  startForgeWorkshop,
  updateForgeWorkshop,
} from './world_quest_forging';
import {
  cancelGliderForRotation,
  clearGliderEncounter,
  ensureGliderInstructor,
  startGliderFlight,
  updateGliderEncounter,
  updateGliderLaunchUpdraft,
} from './world_quest_glider';
import { sanitizeGliderResult } from './world_quest_glider_wire';
import {
  accuseInvestigationSuspect,
  clearInvestigationEncounter,
  ensureInvestigationPost,
  investigationKillCounts,
  readInvestigationClue,
  talkToInvestigation,
  updateInvestigationEncounter,
} from './world_quest_investigation';
import {
  claimLeyBonus,
  leyBonusPending,
  sanitizeLeyBonusProgress,
  unlockLeyBonus,
} from './world_quest_ley_bonus';
import {
  applyWorldQuestMatch3Move,
  sanitizeWorldQuestMatch3Board,
  worldQuestMatch3InitialBoard,
} from './world_quest_match3';
import { dismountForWorldQuestInstructor } from './world_quest_mount_gate';
import {
  sanitizeWorldQuestPuzzleRotations,
  traceWorldQuestPuzzle,
  worldQuestPuzzleInitialRotations,
} from './world_quest_puzzle';
import { playerActiveWorldQuests } from './world_quest_reroll';
import {
  activeWorldQuestsForCycle,
  normalizeWorldQuestCycle,
  worldQuestCycleNumber,
  worldQuestPuzzleVariantForCycle,
} from './world_quest_rotation';
import {
  isWorldQuestSalvageObject,
  isWorldQuestSalvageObjectInCurrentLayout,
} from './world_quest_salvage';
import {
  clearShadowEncounter,
  ensureShadowPost,
  performShadowAction,
  startShadowEncounter,
  updateShadowEncounter,
  updateShadowPatrols,
} from './world_quest_shadow';
import { sanitizeShadowCreditedObjects } from './world_quest_shadow_wire';
import {
  sanitizeWorldQuestTraceScores,
  scoreWorldQuestTraceLesson,
} from './world_quest_trace_score';
import {
  sanitizeWorldQuestTraceVariant,
  worldQuestTraceVariantForStudent,
} from './world_quest_trace_variants';
import {
  clearWorldQuestTracing,
  ensureWorldQuestTraceInstructors,
  startWorldQuestTracing,
  updateWorldQuestTracing,
} from './world_quest_tracing';
import {
  ensureWispMazeInstructor,
  pauseWispMaze,
  startWispMaze,
  updateWispMaze,
} from './world_quest_wisp_maze';

export {
  canRerollWorldQuest,
  playerActiveWorldQuests,
  rerollWorldQuest,
  sanitizeWorldQuestReplacements,
} from './world_quest_reroll';
export {
  activeWorldQuestsForCycle,
  WORLD_QUEST_ROTATION_DAYS,
  WORLD_QUESTS_PER_ROTATION,
  worldQuestCycleForResetDay,
} from './world_quest_rotation';

export const WORLD_QUEST_LEY_TIMER_SECONDS = 90;
const WORLD_QUEST_CLAIM_PREFIX = '__wq_claim__:';

function worldQuestById(questId: string): WorldQuestDef | undefined {
  return Object.hasOwn(WORLD_QUESTS_BY_ID, questId) ? WORLD_QUESTS_BY_ID[questId] : undefined;
}

function claimToken(cycle: string, questId: string): string {
  return `${WORLD_QUEST_CLAIM_PREFIX}${cycle}:${questId}`;
}

function parseClaimToken(value: unknown): { cycle: string; quest: WorldQuestDef } | null {
  if (typeof value !== 'string') return null;
  if (!value.startsWith(WORLD_QUEST_CLAIM_PREFIX)) return null;
  const separator = value.indexOf(':', WORLD_QUEST_CLAIM_PREFIX.length);
  if (separator < 0) return null;
  const cycle = sanitizeWorldQuestCycle(value.slice(WORLD_QUEST_CLAIM_PREFIX.length, separator));
  const questId = value.slice(separator + 1);
  if (!cycle || !Object.hasOwn(WORLD_QUESTS_BY_ID, questId)) return null;
  return { cycle, quest: WORLD_QUESTS_BY_ID[questId] };
}

/** Recovers completion claims after an older binary rewrites the character blob.
 *  `unlockedMilestones` is deliberately dual-written because v0.41 preserves
 *  unknown ids there, while its hand-enumerated save shape drops `worldQuests`.
 *  The markers are bounded to one cycle and never surface as milestone badges. */
export function restoreWorldQuestClaims(meta: PlayerMeta): void {
  const claims = [...meta.unlockedMilestones]
    .map(parseClaimToken)
    .filter((claim): claim is NonNullable<typeof claim> => claim !== null);
  if (claims.length === 0) return;
  if (!meta.worldQuestCycle) {
    meta.worldQuestCycle = claims.reduce(
      (latest, claim) =>
        (worldQuestCycleNumber(claim.cycle) ?? Number.NEGATIVE_INFINITY) >
        (worldQuestCycleNumber(latest) ?? Number.NEGATIVE_INFINITY)
          ? claim.cycle
          : latest,
      '',
    );
  }
  for (const claim of claims) {
    if (claim.cycle !== meta.worldQuestCycle) continue;
    // The current save format already carries the authoritative completed
    // progress (including minigame result fields). Claims only reconstruct a
    // row lost by an older binary. An inconsistent active row is still
    // replaced so the durable claim cannot be replayed for another reward.
    if (meta.worldQuestLog.get(claim.quest.id)?.state === 'completed') continue;
    meta.worldQuestLog.set(claim.quest.id, {
      questId: claim.quest.id,
      count: claim.quest.count,
      state: 'completed',
    });
  }
}

export function worldQuestRewardAmount(
  reward: Extract<WorldQuestReward, { type: 'xp' | 'copper' }>,
  level: number,
): number {
  const safeLevel = Math.max(1, Math.floor(level));
  if (reward.type === 'xp') return Math.max(1, Math.round(xpForLevel(safeLevel) * reward.rate));
  return Math.max(0, Math.round(reward.base + reward.perLevel * safeLevel));
}

function positionInWorldQuestArea(
  pos: Pick<Entity['pos'], 'x' | 'z'>,
  quest: WorldQuestDef,
): boolean {
  const dx = pos.x - quest.area.x;
  const dz = pos.z - quest.area.z;
  return dx * dx + dz * dz <= quest.area.radius * quest.area.radius;
}

function inWorldQuestArea(entity: Entity, quest: WorldQuestDef): boolean {
  return positionInWorldQuestArea(entity.pos, quest);
}

function isWorldQuestMinigame(quest: WorldQuestDef): boolean {
  return quest.objective.type === 'puzzle' || quest.objective.type === 'match3';
}

function resetCycleIfNeeded(ctx: SimContext, meta: PlayerMeta, resolvedCycle?: string): void {
  const cycle = resolvedCycle ?? meta.devWorldQuestCycle ?? ctx.currentWorldQuestRotation().cycle;
  if (!cycle || meta.worldQuestCycle === cycle) return;
  const player = ctx.entities.get(meta.entityId);
  if (player) dropWorldQuestDeliveryCargo(ctx, player);
  if (meta.openWorldQuestPuzzleId) {
    ctx.emit({
      type: 'worldQuestPuzzleClosed',
      questId: meta.openWorldQuestPuzzleId,
      pid: meta.entityId,
    });
  }
  cancelGliderForRotation(ctx, meta);
  clearShadowEncounter(ctx, meta);
  clearInvestigationEncounter(ctx, meta);
  meta.worldQuestCycle = cycle;
  meta.worldQuestLog.clear();
  meta.worldQuestAreas.clear();
  meta.openWorldQuestPuzzleId = null;
  meta.worldQuestRerollCycle = '';
  meta.worldQuestReplacements = {};
  for (const id of meta.unlockedMilestones) {
    if (typeof id === 'string' && id.startsWith(WORLD_QUEST_CLAIM_PREFIX)) {
      meta.unlockedMilestones.delete(id);
    }
  }
  // wqday/wqlog/wqexp share the heavy owner snapshot; rollover must not rely
  // on the staggered refresh backstop to make the new cycle visible online.
  meta.wireRev++;
}

/** Whether this character may start the authored escort in its already
 * reconciled current rotation. The player tick owns cycle rollover. */
export function hasActiveWorldQuest(meta: PlayerMeta, questId: string): boolean {
  const progress = meta.worldQuestLog.get(questId);
  if (progress?.state !== 'active') return false;
  return playerActiveWorldQuests(meta).some((quest) => quest.id === questId);
}

/** Starts every eligible objective whose area the living player enters. */
export function updateWorldQuests(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  ensureGliderInstructor(ctx);
  updateGliderLaunchUpdraft(ctx, meta, player);
  ensureWeeklyEmissary(ctx);
  if (player.level < WORLD_QUEST_MIN_LEVEL) {
    clearShadowEncounter(ctx, meta);
    clearInvestigationEncounter(ctx, meta);
    for (const progress of meta.worldQuestLog.values()) clearForgeWorkshop(meta, progress);
    for (const progress of meta.worldQuestLog.values()) clearWorldQuestTracing(meta, progress);
    return;
  }
  const rotation = ctx.currentWorldQuestRotation();
  const devCycle = meta.devWorldQuestCycle ?? null;
  const cycle = devCycle ?? rotation.cycle;
  resetCycleIfNeeded(ctx, meta, cycle);
  // Clue Scrolls: the landmark-step sweep rides this per-player site (one
  // null check per tick with no hunt); the hook itself skips a dead player.
  updateClueHunt(ctx, meta, player);
  updateInvestigationEncounter(ctx, meta, player);
  // Shared-site machinery advances once per tick from whichever player ticks
  // first, inside or outside the site, so an abandoned rift still tears down.
  updateWorldQuestAmbush(ctx, FARSHORE_SALVAGE_AMBUSH);
  updateWorldQuestChampions(ctx);
  const shadowProgress = meta.worldQuestLog.get(SHADOW_QUEST_ID);
  if (updateShadowEncounter(ctx, meta, player) && shadowProgress)
    creditWorldQuest(ctx, meta, WORLD_QUESTS_BY_ID[SHADOW_QUEST_ID], shadowProgress);
  if (player.dead) {
    pauseWispMaze(meta);
    for (const progress of meta.worldQuestLog.values()) clearGliderEncounter(meta, progress);
    for (const progress of meta.worldQuestLog.values()) clearForgeWorkshop(meta, progress);
    for (const progress of meta.worldQuestLog.values()) clearWorldQuestTracing(meta, progress);
    dropWorldQuestDeliveryCargo(ctx, player);
    if (meta.openWorldQuestPuzzleId) {
      ctx.emit({
        type: 'worldQuestPuzzleClosed',
        questId: meta.openWorldQuestPuzzleId,
        pid: meta.entityId,
      });
      meta.openWorldQuestPuzzleId = null;
    }
    return;
  }
  if (player.mountKey) dropWorldQuestDeliveryCargo(ctx, player);
  const activeQuests =
    devCycle === null
      ? playerActiveWorldQuests(meta, rotation.cycle, rotation.quests)
      : playerActiveWorldQuests(meta, devCycle);
  for (const quest of activeQuests) {
    if (player.level < quest.minLevel) continue;
    const inside = inWorldQuestArea(player, quest);
    const wasInside = meta.worldQuestAreas.has(quest.id);
    if (!inside) {
      if (quest.objective.type === 'wisp_maze') pauseWispMaze(meta);
      const progress = meta.worldQuestLog.get(quest.id);
      if (progress) clearForgeWorkshop(meta, progress);
      if (progress) clearWorldQuestTracing(meta, progress);
      if (wasInside && quest.objective.type === 'delivery')
        dropWorldQuestDeliveryCargo(ctx, player);
      if (wasInside && meta.openWorldQuestPuzzleId === quest.id) {
        ctx.emit({
          type: 'worldQuestPuzzleClosed',
          questId: quest.id,
          pid: meta.entityId,
        });
        meta.openWorldQuestPuzzleId = null;
      }
      meta.worldQuestAreas.delete(quest.id);
      continue;
    }
    const existing = meta.worldQuestLog.get(quest.id);
    if (quest.objective.type === 'puzzle') {
      if (
        meta.openWorldQuestPuzzleId === quest.id &&
        existing &&
        (existing.state === 'active' || leyBonusPending(existing)) &&
        existing.puzzleExpiresAt !== undefined &&
        existing.puzzleExpiresAt > 0 &&
        ctx.time >= existing.puzzleExpiresAt
      ) {
        const puzzle = beamPuzzle(quest, existing);
        if (puzzle) {
          existing.puzzleRotations = worldQuestPuzzleInitialRotations(puzzle);
        }
        existing.puzzleExpiresAt = 0;
        meta.wireRev++;
        ctx.emit({
          type: 'worldQuestPuzzleFailed',
          questId: quest.id,
          pid: meta.entityId,
        });
      }
    }
    if (quest.objective.type === 'investigation') ensureInvestigationPost(ctx);
    if (quest.objective.type === 'shadow') {
      ensureShadowPost(ctx);
      updateShadowPatrols(ctx);
    }
    if (quest.objective.type === 'wisp_maze') {
      ensureWispMazeInstructor(ctx);
      if (existing && updateWispMaze(ctx, meta, player, existing) && existing.state === 'active') {
        const hard = existing.wispMaze?.difficulty === 'hard';
        creditWorldQuest(ctx, meta, quest, existing);
        if (hard)
          awardWorldQuestBonusCopper(
            ctx,
            meta,
            worldQuestBonusCopper(
              WISP_MAZE_HARD_BONUS.base,
              WISP_MAZE_HARD_BONUS.perLevel,
              player.level,
            ),
          );
      }
    }
    if (quest.objective.type === 'glider') {
      if (
        existing &&
        updateGliderEncounter(ctx, meta, player, existing) &&
        existing.state === 'active'
      )
        creditWorldQuest(ctx, meta, quest, existing);
    }
    if (quest.objective.type === 'forging') {
      ensureForgeWorkshop(ctx);
      if (existing) updateForgeWorkshop(ctx, meta, player, existing);
    }
    if (quest.objective.type === 'tracing') {
      ensureWorldQuestTraceInstructors(ctx);
      if (
        existing &&
        updateWorldQuestTracing(ctx, meta, player, quest, existing) &&
        existing.state === 'active'
      )
        creditWorldQuest(ctx, meta, quest, existing);
      if (existing?.state === 'completed') {
        meta.worldQuestAreas.delete(quest.id);
        continue;
      }
    }
    if (isWorldQuestMinigame(quest) && existing?.state === 'completed') {
      meta.worldQuestAreas.delete(quest.id);
      continue;
    }
    if (!existing) {
      const progress: WorldQuestProgress = {
        questId: quest.id,
        count: 0,
        state: 'active',
      };
      if (quest.objective.type === 'tracing')
        progress.traceVariant = worldQuestTraceVariantForStudent(
          meta.worldQuestCycle,
          meta.entityId,
        );
      if (isWorldQuestMinigame(quest) && !meta.devWorldQuestCycle)
        progress.puzzleDay = worldQuestCycleNumber(meta.worldQuestCycle) ?? 0;
      if (
        quest.objective.type === 'puzzle' ||
        quest.objective.type === 'match3' ||
        quest.objective.type === 'salvage'
      ) {
        const variants =
          quest.objective.type === 'puzzle'
            ? quest.objective.puzzles.length
            : quest.objective.type === 'match3'
              ? quest.objective.levels.length
              : quest.objective.layouts.length;
        progress.puzzleVariant = worldQuestPuzzleVariantForCycle(meta.worldQuestCycle, variants);
      }
      if (quest.objective.type === 'puzzle') {
        const puzzle = beamPuzzle(quest, progress);
        if (puzzle) progress.puzzleRotations = worldQuestPuzzleInitialRotations(puzzle);
      } else if (quest.objective.type === 'match3') {
        const level = match3Level(quest, progress);
        if (level) {
          progress.match3Board = worldQuestMatch3InitialBoard(level);
          progress.match3Moves = 0;
          progress.match3RefillIndex = 0;
        }
      }
      meta.worldQuestLog.set(quest.id, progress);
      ctx.emit({
        type: 'worldQuestStarted',
        questId: quest.id,
        pid: meta.entityId,
      });
    }
    meta.worldQuestAreas.add(quest.id);
  }
}

/** The plain keeper talk enters the maze on the Normal profile; the dialog's
 *  explicit pick (world_quest_activity.ts) is the only way to the Hard one. */
function startWispMazeNormal(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
  npc: Entity,
  progress: WorldQuestProgress,
): void {
  startWispMaze(ctx, meta, player, npc, progress, 'normal');
}

/** Existing target-and-interact command, with no client-supplied trace or credit. */
export function talkToWorldQuestInstructor(
  ctx: SimContext,
  npc: Entity,
  meta: PlayerMeta,
  player: Entity,
): boolean {
  resetCycleIfNeeded(ctx, meta);
  if (talkToInvestigation(ctx, npc, meta, player)) return true;
  if (npc.templateId === GLIDER_APPRENTICE_NPC_DEF.id) {
    // The rider's mount is put away on the talk (see world_quest_mount_gate); a
    // vehicle seat or a race still owns the player, so the talk is consumed idle.
    if (!dismountForWorldQuestInstructor(ctx, player, meta)) return true;
    const existing = meta.worldQuestLog.get(GLIDER_QUEST_ID) ?? {
      questId: GLIDER_QUEST_ID,
      count: 0,
      state: 'active',
    };
    startGliderFlight(ctx, meta, player, npc, existing);
    return true;
  }
  const quest = WORLD_QUESTS.find(
    (candidate) =>
      (candidate.objective.type === 'tracing' ||
        candidate.objective.type === 'forging' ||
        candidate.objective.type === 'wisp_maze' ||
        candidate.objective.type === 'glider' ||
        candidate.objective.type === 'shadow') &&
      candidate.objective.instructorNpcId === npc.templateId,
  );
  if (!quest) return false;
  if (!dismountForWorldQuestInstructor(ctx, player, meta)) return true;
  resetCycleIfNeeded(ctx, meta);
  const progress = meta.worldQuestLog.get(quest.id);
  if (quest.objective.type === 'shadow') {
    if (
      player.level >= quest.minLevel &&
      progress &&
      hasActiveWorldQuest(meta, quest.id) &&
      inWorldQuestArea(player, quest)
    )
      startShadowEncounter(ctx, meta, player, npc, progress);
    return true;
  }
  if (quest.objective.type === 'glider') {
    const isQuestActive =
      player.level >= quest.minLevel &&
      progress &&
      inWorldQuestArea(player, quest) &&
      playerActiveWorldQuests(meta).some((active) => active.id === quest.id);
    if (isQuestActive && progress) {
      startGliderFlight(ctx, meta, player, npc, progress);
    } else {
      const practice = meta.worldQuestLog.get(GLIDER_QUEST_ID) ?? {
        questId: GLIDER_QUEST_ID,
        count: 0,
        state: 'active',
      };
      meta.worldQuestLog.set(GLIDER_QUEST_ID, practice);
      startGliderFlight(ctx, meta, player, npc, practice, true);
    }
    return true;
  }
  if (quest.objective.type === 'forging' || quest.objective.type === 'wisp_maze') {
    if (
      player.level >= quest.minLevel &&
      progress &&
      inWorldQuestArea(player, quest) &&
      playerActiveWorldQuests(meta).some((active) => active.id === quest.id)
    )
      (quest.objective.type === 'wisp_maze' ? startWispMazeNormal : startForgeWorkshop)(
        ctx,
        meta,
        player,
        npc,
        progress,
      );
    return true;
  }
  if (
    player.level >= quest.minLevel &&
    hasActiveWorldQuest(meta, quest.id) &&
    progress &&
    inWorldQuestArea(player, quest)
  )
    startWorldQuestTracing(ctx, meta, player, npc, quest, progress);
  return true;
}

export function awardWorldQuest(ctx: SimContext, meta: PlayerMeta, quest: WorldQuestDef): void {
  const player = ctx.entities.get(meta.entityId);
  if (!player) return;
  if (quest.reward.type === 'xp') {
    ctx.grantXp(worldQuestRewardAmount(quest.reward, player.level), meta);
  } else if (quest.reward.type === 'copper') {
    const amount = worldQuestRewardAmount(quest.reward, player.level);
    meta.copper += amount;
    ctx.emit({
      type: 'loot',
      text: `You receive ${formatMoney(amount)}.`,
      pid: meta.entityId,
    });
  } else {
    ctx.addItem(quest.reward.itemId, quest.reward.count, meta.entityId);
  }

  const factionId = worldQuestFaction(quest);
  const standingAward = worldQuestStandingReward(quest, player.level);
  const standingResult = awardFactionReputation(meta, factionId, standingAward, player.level);
  if (standingResult.gained > 0) {
    // Standing feeds the prog_<faction>_* meter deeds; no narrow key covers
    // PlayerMeta.factions, so the award site requests a full pass.
    ctx.markDeedsDirty(meta.entityId);
    ctx.emit({
      type: 'loot',
      text: `+${standingResult.gained} ${factionDisplayName(factionId)} Standing.`,
      pid: meta.entityId,
    });
  }
}

function creditWorldQuest(
  ctx: SimContext,
  meta: PlayerMeta,
  quest: WorldQuestDef,
  progress: WorldQuestProgress,
  amount = 1,
): void {
  progress.count = Math.min(quest.count, progress.count + amount);
  meta.counters.questProgress++;
  if (progress.count < quest.count) {
    ctx.emit({
      type: 'worldQuestProgress',
      questId: quest.id,
      count: progress.count,
      required: quest.count,
      pid: meta.entityId,
    });
    return;
  }
  progress.state = 'completed';
  const player = ctx.entities.get(meta.entityId);
  if (player) dropWorldQuestDeliveryCargo(ctx, player);
  delete progress.creditedObjects;
  delete progress.puzzleVariant;
  delete progress.puzzleDay;
  delete progress.puzzleRotations;
  delete progress.match3Board;
  delete progress.match3Moves;
  delete progress.match3RefillIndex;
  if (meta.openWorldQuestPuzzleId === quest.id) meta.openWorldQuestPuzzleId = null;
  meta.worldQuestAreas.delete(quest.id);
  meta.counters.questsCompleted++;
  meta.unlockedMilestones.add(claimToken(meta.worldQuestCycle, quest.id));
  // The Weekly Vault's world row counts this completion once: the claim token
  // above is the once-per-cycle guard, and no client command reaches the counter.
  recordWeeklyWorldQuest(ctx, meta.entityId);
  awardWorldQuest(ctx, meta, quest);
  // Clue Scrolls: with the day's rewards and standing already landed above,
  // the last zone slot of the slate pays the scroll (once per cycle).
  if (player) maybeAwardClueScroll(ctx, meta, player);
  // A plain quest's optional encore: a champion of the site for anyone to fight.
  summonWorldQuestChampion(ctx, quest, meta);
  if (quest.id === SHADOW_QUEST_ID) {
    clearShadowEncounter(ctx, meta);
    grantDeed(ctx, meta, 'exp_duskweave_dispatches');
  }
  if (quest.id === INVESTIGATION_QUEST_ID) grantDeed(ctx, meta, 'exp_borrowed_face');
  if (quest.id === FORGE_QUEST_ID) grantDeed(ctx, meta, 'exp_forge_helper');
  if (quest.id === GLIDER_QUEST_ID) grantDeed(ctx, meta, 'exp_windrider_slalom');
  if (quest.id === WISP_MAZE_QUEST_ID) grantDeed(ctx, meta, 'exp_wisp_maze');
  if (quest.id === WORLD_QUEST_CALLIGRAPHY_ID) {
    grantDeed(ctx, meta, 'exp_arcane_calligraphy');
    if (progress.traceResult?.rating === 'gold')
      grantDeed(ctx, meta, 'exp_arcane_calligraphy_gold');
  }
  ctx.emit({
    type: 'worldQuestDone',
    questId: quest.id,
    pid: meta.entityId,
    ...(quest.id === WORLD_QUEST_CALLIGRAPHY_ID && progress.traceResult
      ? { traceResult: { score: progress.traceResult.score, rating: progress.traceResult.rating } }
      : {}),
  });
}

/** Complete one escort objective for a nearby eligible participant. The
 * escort engine owns proximity; this seam revalidates rotation, objective id,
 * and authored area before awarding the public-event reward. */
export function completeWorldQuestEscort(
  ctx: SimContext,
  meta: PlayerMeta,
  questId: string,
  escortId: string,
  escortee: Entity,
): void {
  resetCycleIfNeeded(ctx, meta);
  if (!hasActiveWorldQuest(meta, questId)) return;
  const player = ctx.entities.get(meta.entityId);
  const quest = worldQuestById(questId);
  const progress = meta.worldQuestLog.get(questId);
  if (
    !player ||
    player.dead ||
    !quest ||
    quest.objective.type !== 'escort' ||
    quest.objective.escortId !== escortId ||
    progress?.state !== 'active' ||
    !inWorldQuestArea(player, quest) ||
    !inWorldQuestArea(escortee, quest)
  )
    return;
  creditWorldQuest(ctx, meta, quest, progress, quest.count);
}

/** Only an authoritative winning personal session may award vehicle credit. */
export function completeWorldQuestVehicle(
  ctx: SimContext,
  meta: PlayerMeta,
  stationId: string,
): void {
  resetCycleIfNeeded(ctx, meta);
  const session = meta.vehicle;
  const station = vehicleStationById(stationId);
  if (!station) return;
  const quest = worldQuestById(station.questId);
  const progress = meta.worldQuestLog.get(station.questId);
  const player = ctx.entities.get(meta.entityId);
  if (
    !session ||
    session.stationId !== stationId ||
    session.cycle !== meta.worldQuestCycle ||
    session.encounter.phase !== 'won' ||
    !session.encounter.commanderKilled ||
    !player ||
    player.dead ||
    !quest ||
    quest.objective.type !== 'vehicle' ||
    quest.objective.stationId !== stationId ||
    progress?.state !== 'active' ||
    !hasActiveWorldQuest(meta, quest.id) ||
    !inWorldQuestArea(player, quest)
  )
    return;
  creditWorldQuest(ctx, meta, quest, progress, quest.count);
}

/** Credits an eligible participant for a target killed inside the active area. */
export function onMobKilledForWorldQuests(ctx: SimContext, mob: Entity, meta: PlayerMeta): void {
  resetCycleIfNeeded(ctx, meta);
  const player = ctx.entities.get(meta.entityId);
  if (!player || player.dead) return;
  const activeQuests = playerActiveWorldQuests(meta);
  for (const progress of meta.worldQuestLog.values()) {
    if (progress.state !== 'active') continue;
    const quest = activeQuests.find((candidate) => candidate.id === progress.questId);
    if (
      !quest ||
      (quest.objective.type !== 'kill' && quest.objective.type !== 'investigation') ||
      (quest.objective.type === 'investigation' && !investigationKillCounts(meta, mob)) ||
      mob.templateId !== quest.objective.targetMobId ||
      !inWorldQuestArea(player, quest) ||
      !inWorldQuestArea(mob, quest)
    )
      continue;
    creditWorldQuest(ctx, meta, quest, progress);
  }
}

/** Credits one successful authoritative profession-node harvest. */
export function onNodeGatheredForWorldQuests(
  ctx: SimContext,
  node: GatherNodeDef,
  meta: PlayerMeta,
): void {
  resetCycleIfNeeded(ctx, meta);
  const player = ctx.entities.get(meta.entityId);
  if (!player || player.dead) return;
  for (const progress of meta.worldQuestLog.values()) {
    if (progress.state !== 'active') continue;
    const quest = worldQuestById(progress.questId);
    if (
      !quest ||
      quest.objective.type !== 'gather' ||
      quest.objective.nodeType !== node.type ||
      !inWorldQuestArea(player, quest) ||
      !positionInWorldQuestArea(node.pos, quest)
    )
      continue;
    creditWorldQuest(ctx, meta, quest, progress);
  }
}

/** Credits one distinct authored object after the ordinary interaction range gate. */
export function onObjectInteractedForWorldQuests(
  ctx: SimContext,
  obj: Entity,
  meta: PlayerMeta,
): boolean {
  resetCycleIfNeeded(ctx, meta);
  const player = ctx.entities.get(meta.entityId);
  if (!player || player.dead || !obj.objectItemId) return false;
  if (readInvestigationClue(ctx, obj, meta, player)) return true;
  if (forgeStationForEntity(obj)) {
    const quest = worldQuestById(FORGE_QUEST_ID);
    const progress = meta.worldQuestLog.get(FORGE_QUEST_ID);
    if (
      quest &&
      progress &&
      player.level >= quest.minLevel &&
      inWorldQuestArea(player, quest) &&
      playerActiveWorldQuests(meta).some((active) => active.id === quest.id)
    ) {
      const completed = respondForgeWorkshop(ctx, meta, player, obj, progress);
      if (completed && progress.state === 'active')
        creditWorldQuest(ctx, meta, quest, progress, quest.count);
    }
    return true;
  }
  let handled = false;
  // Salvage props deliberately reuse an existing non-inventory flotsam token.
  // Claim them here even when their world quest is unavailable, so a forced
  // stale click can never leak into that token's ordinary quest interaction.
  for (const quest of WORLD_QUESTS) {
    if (!isWorldQuestSalvageObject(obj, quest)) continue;
    handled = true;
    const progress = meta.worldQuestLog.get(quest.id);
    if (
      progress?.state !== 'active' ||
      !inWorldQuestArea(player, quest) ||
      !inWorldQuestArea(obj, quest) ||
      !isWorldQuestSalvageObjectInCurrentLayout(obj, quest, progress, meta.worldQuestCycle)
    ) {
      continue;
    }
    const key = interactObjectCreditKey(0, obj.pos);
    if (hasInteractObjectCredit(progress, key)) continue;
    recordInteractObjectCredit(progress, key);
    creditWorldQuest(ctx, meta, quest, progress);
    // Half the debris gone: the wreck's raiders contest the strand.
    if (quest.id === FARSHORE_SALVAGE_AMBUSH.questId)
      triggerWorldQuestAmbush(ctx, FARSHORE_SALVAGE_AMBUSH, meta, progress.count);
  }
  if (handled) return true;
  for (const progress of meta.worldQuestLog.values()) {
    // A completed ley quest still answers its cache while a bonus board is charged.
    if (progress.state !== 'active' && !leyBonusPending(progress)) continue;
    const quest = worldQuestById(progress.questId);
    if (!quest || !inWorldQuestArea(player, quest) || !inWorldQuestArea(obj, quest)) continue;
    if (quest.objective.type === 'puzzle' || quest.objective.type === 'match3') {
      if (quest.objective.activationObjectItemId !== obj.objectItemId) continue;
      handled = true;
      meta.openWorldQuestPuzzleId = quest.id;
      if (quest.objective.type === 'puzzle') {
        const puzzle = beamPuzzle(quest, progress);
        if (
          puzzle &&
          (!progress.puzzleRotations ||
            progress.puzzleExpiresAt === undefined ||
            progress.puzzleExpiresAt === 0 ||
            ctx.time >= progress.puzzleExpiresAt)
        ) {
          progress.puzzleRotations = worldQuestPuzzleInitialRotations(puzzle);
          progress.puzzleExpiresAt = ctx.time + WORLD_QUEST_LEY_TIMER_SECONDS;
        }
        meta.wireRev++;
      }
      ctx.emit({
        type: 'worldQuestPuzzleOpened',
        questId: quest.id,
        pid: meta.entityId,
      });
      continue;
    }
    if (quest.objective.type === 'delivery') {
      if (
        obj.objectItemId !== quest.objective.pickupObjectItemId &&
        obj.objectItemId !== quest.objective.deliveryObjectItemId
      ) {
        continue;
      }
      handled = true;
      if (obj.objectItemId === quest.objective.pickupObjectItemId) {
        takeWorldQuestDeliveryCargo(ctx, player);
        continue;
      }
      if (hasWorldQuestDeliveryCargo(player)) {
        dropWorldQuestDeliveryCargo(ctx, player);
        creditWorldQuest(ctx, meta, quest, progress);
      }
      continue;
    }
    if (
      quest.objective.type !== 'interact' ||
      quest.objective.targetObjectItemId !== obj.objectItemId
    )
      continue;
    handled = true;
    const key = interactObjectCreditKey(0, obj.pos);
    if (hasInteractObjectCredit(progress, key)) continue;
    recordInteractObjectCredit(progress, key);
    creditWorldQuest(ctx, meta, quest, progress);
  }
  return handled;
}

/** Server-authoritative quarter-turn for the active beam puzzle. */
export function rotateWorldQuestPuzzleTile(
  ctx: SimContext,
  questId: string,
  tileIndex: number,
  pid?: number,
): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { e: player, meta } = resolved;
  resetCycleIfNeeded(ctx, meta);
  const quest = worldQuestById(questId);
  const progress = meta.worldQuestLog.get(questId);
  const puzzle = quest && progress ? beamPuzzle(quest, progress) : null;
  if (
    player.dead ||
    !quest ||
    quest.objective.type !== 'puzzle' ||
    !puzzle ||
    !progress ||
    (progress.state !== 'active' && !leyBonusPending(progress)) ||
    meta.openWorldQuestPuzzleId !== questId ||
    !inWorldQuestArea(player, quest) ||
    (progress.puzzleExpiresAt !== undefined &&
      (progress.puzzleExpiresAt === 0 || ctx.time >= progress.puzzleExpiresAt)) ||
    !Number.isSafeInteger(tileIndex) ||
    tileIndex < 0 ||
    tileIndex >= puzzle.tiles.length
  )
    return;
  const rotations = sanitizeWorldQuestPuzzleRotations(progress.puzzleRotations, puzzle);
  rotations[tileIndex] = (rotations[tileIndex] + 1) % 4;
  progress.puzzleRotations = rotations;
  meta.wireRev++;
  ctx.emit({
    type: 'worldQuestPuzzleUpdated',
    questId,
    tileIndex,
    rotation: rotations[tileIndex],
    pid: meta.entityId,
  });
  if (traceWorldQuestPuzzle(puzzle, rotations).solved) {
    delete progress.puzzleExpiresAt;
    if (progress.state === 'active') {
      // The daily solve completes the quest and charges the first bonus board.
      const day = progress.puzzleDay;
      creditWorldQuest(ctx, meta, quest, progress, quest.count);
      unlockLeyBonus(progress, day);
    } else {
      claimLeyBonus(ctx, meta, progress);
    }
    meta.wireRev++;
  }
}

/** Server-authoritative adjacent swap for the active confection puzzle. */
export function swapWorldQuestMatch3Tiles(
  ctx: SimContext,
  questId: string,
  fromIndex: number,
  toIndex: number,
  pid?: number,
): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { e: player, meta } = resolved;
  resetCycleIfNeeded(ctx, meta);
  const quest = worldQuestById(questId);
  const progress = meta.worldQuestLog.get(questId);
  const level = quest && progress ? match3Level(quest, progress) : null;
  if (
    player.dead ||
    !quest ||
    quest.objective.type !== 'match3' ||
    !level ||
    progress?.state !== 'active' ||
    meta.openWorldQuestPuzzleId !== questId ||
    !inWorldQuestArea(player, quest) ||
    (progress.match3Moves ?? 0) >= level.maxMoves
  )
    return;
  const result = applyWorldQuestMatch3Move(
    level,
    sanitizeWorldQuestMatch3Board(progress.match3Board, level),
    fromIndex,
    toIndex,
    progress.match3RefillIndex ?? 0,
  );
  if (!result.accepted) return;
  progress.match3Board = result.board;
  progress.match3Moves = (progress.match3Moves ?? 0) + 1;
  progress.match3RefillIndex = result.refillIndex;
  meta.wireRev++;
  ctx.emit({ type: 'worldQuestMatch3Updated', questId, pid: meta.entityId });
  creditWorldQuest(ctx, meta, quest, progress, result.cleared);
}

export function resetWorldQuestMatch3(ctx: SimContext, questId: string, pid?: number): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { e: player, meta } = resolved;
  resetCycleIfNeeded(ctx, meta);
  const quest = worldQuestById(questId);
  const progress = meta.worldQuestLog.get(questId);
  const level = quest && progress ? match3Level(quest, progress) : null;
  if (
    player.dead ||
    !quest ||
    quest.objective.type !== 'match3' ||
    !level ||
    progress?.state !== 'active' ||
    meta.openWorldQuestPuzzleId !== questId ||
    !inWorldQuestArea(player, quest)
  )
    return;
  progress.count = 0;
  progress.match3Board = worldQuestMatch3InitialBoard(level);
  progress.match3Moves = 0;
  progress.match3RefillIndex = 0;
  meta.wireRev++;
  ctx.emit({ type: 'worldQuestMatch3Updated', questId, pid: meta.entityId });
}

export function boostWorldQuestGlider(ctx: SimContext, pid?: number): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { e: player, meta } = resolved;
  resetCycleIfNeeded(ctx, meta);
  const progress = meta.worldQuestLog.get(GLIDER_QUEST_ID);
  if (player.dead || player.ghost || progress?.state !== 'active' || !progress.glider) return;
  if (applyGliderBoost(progress.glider)) meta.wireRev++;
}

export function resetWorldQuestPuzzle(ctx: SimContext, questId: string, pid?: number): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  const { e: player, meta } = resolved;
  resetCycleIfNeeded(ctx, meta);
  const quest = worldQuestById(questId);
  const progress = meta.worldQuestLog.get(questId);
  const puzzle = quest && progress ? beamPuzzle(quest, progress) : null;
  if (
    player.dead ||
    !quest ||
    quest.objective.type !== 'puzzle' ||
    !puzzle ||
    !progress ||
    (progress.state !== 'active' && !leyBonusPending(progress)) ||
    meta.openWorldQuestPuzzleId !== questId ||
    !inWorldQuestArea(player, quest) ||
    (progress.puzzleExpiresAt !== 0 &&
      (progress.puzzleExpiresAt === undefined || ctx.time < progress.puzzleExpiresAt))
  )
    return;
  progress.puzzleRotations = worldQuestPuzzleInitialRotations(puzzle);
  progress.puzzleExpiresAt = ctx.time + WORLD_QUEST_LEY_TIMER_SECONDS;
  meta.wireRev++;
  ctx.emit({
    type: 'worldQuestPuzzleOpened',
    questId,
    pid: meta.entityId,
  });
}

export function sanitizeWorldQuestCycle(value: unknown): string {
  return normalizeWorldQuestCycle(value);
}

export function sanitizeWorldQuestProgress(
  value: unknown,
  cycle?: unknown,
  includeSessionDeadlines = false,
  replacements?: Record<string, string>,
): WorldQuestProgress[] {
  if (!Array.isArray(value)) return [];
  const output: WorldQuestProgress[] = [];
  const seen = new Set<string>();
  const activeIds =
    cycle === undefined
      ? null
      : new Set([
          ...activeWorldQuestsForCycle(cycle).map((quest) => quest.id),
          ...(replacements ? Object.values(replacements) : []),
        ]);
  const scanLimit = Math.min(value.length, WORLD_QUESTS.length * 4);
  for (let entryIndex = 0; entryIndex < scanLimit; entryIndex++) {
    const entry = value[entryIndex];
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Partial<WorldQuestProgress>;
    const quest =
      typeof raw.questId === 'string' && Object.hasOwn(WORLD_QUESTS_BY_ID, raw.questId)
        ? WORLD_QUESTS_BY_ID[raw.questId]
        : undefined;
    if (!quest || (activeIds && !activeIds.has(quest.id)) || seen.has(quest.id)) continue;
    if (raw.state !== 'active' && raw.state !== 'completed') continue;
    const upper = raw.state === 'completed' ? quest.count : Math.max(0, quest.count - 1);
    const count =
      raw.state === 'completed'
        ? quest.count
        : Number.isFinite(raw.count)
          ? Math.max(0, Math.min(upper, Math.floor(raw.count as number)))
          : 0;
    const normalized: WorldQuestProgress = {
      questId: quest.id,
      count,
      state: raw.state,
    };
    if (quest.objective.type === 'shadow' && raw.state === 'active') {
      normalized.creditedObjects = sanitizeShadowCreditedObjects(raw.creditedObjects).slice(
        0,
        quest.count - 1,
      );
      normalized.count = normalized.creditedObjects.length;
    }
    if (quest.objective.type === 'forging' && raw.state === 'completed') {
      const result = sanitizeForgeResult(raw.forgeResult);
      if (result) normalized.forgeResult = result;
    }
    if (quest.objective.type === 'glider' && raw.state === 'completed') {
      const result = sanitizeGliderResult(raw.gliderResult);
      if (result) normalized.gliderResult = result;
    }
    if (quest.objective.type === 'tracing') {
      normalized.traceVariant =
        raw.traceVariant === undefined
          ? 'star'
          : sanitizeWorldQuestTraceVariant(
              raw.traceVariant,
              typeof cycle === 'string' ? cycle : '',
            );
      const scores = sanitizeWorldQuestTraceScores(raw.traceScores, count);
      if (scores.length > 0) normalized.traceScores = scores;
      if (raw.state === 'completed' && scores.length === quest.count)
        normalized.traceResult = scoreWorldQuestTraceLesson(scores);
    }
    if (
      raw.state === 'active' &&
      (quest.objective.type === 'interact' || quest.objective.type === 'salvage')
    ) {
      const creditedObjects = sanitizeCreditedObjects(raw.creditedObjects)?.slice(0, count);
      if (creditedObjects && creditedObjects.length > 0) {
        normalized.creditedObjects = creditedObjects;
      }
    }
    if (raw.state === 'active' && quest.objective.type === 'puzzle') {
      const variant =
        Number.isSafeInteger(raw.puzzleVariant) && (raw.puzzleVariant as number) >= 0
          ? Math.min(quest.objective.puzzles.length - 1, raw.puzzleVariant as number)
          : 0;
      normalized.puzzleVariant = variant;
      if (Number.isSafeInteger(raw.puzzleDay) && normalizeWorldQuestCycle(cycle))
        normalized.puzzleDay = worldQuestCycleNumber(cycle) ?? 0;
      const puzzle = beamPuzzle(quest, normalized)!;
      normalized.puzzleRotations = sanitizeWorldQuestPuzzleRotations(raw.puzzleRotations, puzzle);
      if (
        includeSessionDeadlines &&
        typeof raw.puzzleExpiresAt === 'number' &&
        Number.isFinite(raw.puzzleExpiresAt) &&
        raw.puzzleExpiresAt >= 0
      ) {
        normalized.puzzleExpiresAt = raw.puzzleExpiresAt;
      }
    }
    if (
      raw.state === 'completed' &&
      quest.objective.type === 'puzzle' &&
      sanitizeLeyBonusProgress(
        raw,
        normalized,
        quest,
        normalizeWorldQuestCycle(cycle) ? (worldQuestCycleNumber(cycle) ?? 0) : undefined,
      )
    ) {
      const puzzle = beamPuzzle(quest, normalized);
      if (puzzle && Array.isArray(raw.puzzleRotations))
        normalized.puzzleRotations = sanitizeWorldQuestPuzzleRotations(raw.puzzleRotations, puzzle);
      if (
        includeSessionDeadlines &&
        typeof raw.puzzleExpiresAt === 'number' &&
        Number.isFinite(raw.puzzleExpiresAt) &&
        raw.puzzleExpiresAt >= 0
      ) {
        normalized.puzzleExpiresAt = raw.puzzleExpiresAt;
      }
    }
    if (raw.state === 'active' && quest.objective.type === 'match3') {
      const variant =
        Number.isSafeInteger(raw.puzzleVariant) && (raw.puzzleVariant as number) >= 0
          ? Math.min(quest.objective.levels.length - 1, raw.puzzleVariant as number)
          : 0;
      normalized.puzzleVariant = variant;
      if (Number.isSafeInteger(raw.puzzleDay) && normalizeWorldQuestCycle(cycle))
        normalized.puzzleDay = worldQuestCycleNumber(cycle) ?? 0;
      const level = match3Level(quest, normalized)!;
      normalized.match3Board = sanitizeWorldQuestMatch3Board(raw.match3Board, level);
      normalized.match3Moves = Number.isSafeInteger(raw.match3Moves)
        ? Math.max(0, Math.min(level.maxMoves, raw.match3Moves as number))
        : 0;
      normalized.match3RefillIndex = Number.isSafeInteger(raw.match3RefillIndex)
        ? Math.max(0, Math.min(1_000_000, raw.match3RefillIndex as number))
        : 0;
    }
    if (raw.state === 'active' && quest.objective.type === 'salvage') {
      const variant =
        Number.isSafeInteger(raw.puzzleVariant) && (raw.puzzleVariant as number) >= 0
          ? Math.min(quest.objective.layouts.length - 1, raw.puzzleVariant as number)
          : 0;
      normalized.puzzleVariant = variant;
    }
    output.push(normalized);
    seen.add(quest.id);
    if (output.length >= WORLD_QUESTS.length) break;
  }
  return output;
}

export function accuseWorldQuestSuspect(ctx: SimContext, npcId: number, pid?: number): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  updateWorldQuests(ctx, resolved.meta, resolved.e);
  accuseInvestigationSuspect(ctx, npcId, resolved.meta, resolved.e);
}

export function shadowWorldQuestAction(
  ctx: SimContext,
  action: 'pickpocket' | 'leave',
  targetId?: number,
  pid?: number,
): void {
  const resolved = ctx.resolve(pid);
  if (!resolved) return;
  updateWorldQuests(ctx, resolved.meta, resolved.e);
  if (action !== 'leave' && !hasActiveWorldQuest(resolved.meta, SHADOW_QUEST_ID)) return;
  performShadowAction(ctx, resolved.meta, resolved.e, action, targetId);
}

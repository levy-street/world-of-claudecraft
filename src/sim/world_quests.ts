import { WORLD_QUEST_MIN_LEVEL, WORLD_QUESTS, WORLD_QUESTS_BY_ID } from './content/world_quests';
import { formatMoney } from './format_money';
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
import {
  dropWorldQuestDeliveryCargo,
  hasWorldQuestDeliveryCargo,
  takeWorldQuestDeliveryCargo,
} from './world_quest_delivery';
import {
  applyWorldQuestMatch3Move,
  sanitizeWorldQuestMatch3Board,
  worldQuestMatch3InitialBoard,
} from './world_quest_match3';
import {
  sanitizeWorldQuestPuzzleRotations,
  traceWorldQuestPuzzle,
  worldQuestPuzzleInitialRotations,
} from './world_quest_puzzle';
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

export {
  activeWorldQuestsForCycle,
  WORLD_QUEST_ROTATION_DAYS,
  WORLD_QUESTS_PER_ROTATION,
  worldQuestCycleForResetDay,
} from './world_quest_rotation';

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

function puzzleVariant(progress: WorldQuestProgress, variantCount: number): number {
  if (variantCount <= 0) return 0;
  const raw = Number.isSafeInteger(progress.puzzleVariant) ? (progress.puzzleVariant as number) : 0;
  return ((raw % variantCount) + variantCount) % variantCount;
}

function beamPuzzle(quest: WorldQuestDef, progress: WorldQuestProgress) {
  if (quest.objective.type !== 'puzzle') return null;
  return quest.objective.puzzles[puzzleVariant(progress, quest.objective.puzzles.length)] ?? null;
}

function match3Level(quest: WorldQuestDef, progress: WorldQuestProgress) {
  if (quest.objective.type !== 'match3') return null;
  return quest.objective.levels[puzzleVariant(progress, quest.objective.levels.length)] ?? null;
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
  meta.worldQuestCycle = cycle;
  meta.worldQuestLog.clear();
  meta.worldQuestAreas.clear();
  meta.openWorldQuestPuzzleId = null;
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
  return activeWorldQuestsForCycle(meta.worldQuestCycle).some((quest) => quest.id === questId);
}

/** Starts every eligible objective whose area the living player enters. */
export function updateWorldQuests(ctx: SimContext, meta: PlayerMeta, player: Entity): void {
  if (player.level < WORLD_QUEST_MIN_LEVEL) return;
  const rotation = ctx.currentWorldQuestRotation();
  const devCycle = meta.devWorldQuestCycle ?? null;
  const cycle = devCycle ?? rotation.cycle;
  resetCycleIfNeeded(ctx, meta, cycle);
  if (player.dead) {
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
  const activeQuests = devCycle === null ? rotation.quests : activeWorldQuestsForCycle(devCycle);
  for (const quest of activeQuests) {
    if (player.level < quest.minLevel) continue;
    const inside = inWorldQuestArea(player, quest);
    const wasInside = meta.worldQuestAreas.has(quest.id);
    if (!inside) {
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

function awardWorldQuest(ctx: SimContext, meta: PlayerMeta, quest: WorldQuestDef): void {
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
  delete progress.puzzleRotations;
  delete progress.match3Board;
  delete progress.match3Moves;
  delete progress.match3RefillIndex;
  if (meta.openWorldQuestPuzzleId === quest.id) meta.openWorldQuestPuzzleId = null;
  meta.worldQuestAreas.delete(quest.id);
  meta.counters.questsCompleted++;
  meta.unlockedMilestones.add(claimToken(meta.worldQuestCycle, quest.id));
  awardWorldQuest(ctx, meta, quest);
  ctx.emit({ type: 'worldQuestDone', questId: quest.id, pid: meta.entityId });
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

/** Credits an eligible participant for a target killed inside the active area. */
export function onMobKilledForWorldQuests(ctx: SimContext, mob: Entity, meta: PlayerMeta): void {
  resetCycleIfNeeded(ctx, meta);
  const player = ctx.entities.get(meta.entityId);
  if (!player || player.dead) return;
  const activeQuests = activeWorldQuestsForCycle(meta.worldQuestCycle);
  for (const progress of meta.worldQuestLog.values()) {
    if (progress.state !== 'active') continue;
    const quest = activeQuests.find((candidate) => candidate.id === progress.questId);
    if (
      !quest ||
      quest.objective.type !== 'kill' ||
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
  }
  if (handled) return true;
  for (const progress of meta.worldQuestLog.values()) {
    if (progress.state !== 'active') continue;
    const quest = worldQuestById(progress.questId);
    if (!quest || !inWorldQuestArea(player, quest) || !inWorldQuestArea(obj, quest)) continue;
    if (quest.objective.type === 'puzzle' || quest.objective.type === 'match3') {
      if (quest.objective.activationObjectItemId !== obj.objectItemId) continue;
      handled = true;
      meta.openWorldQuestPuzzleId = quest.id;
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
    progress?.state !== 'active' ||
    meta.openWorldQuestPuzzleId !== questId ||
    !inWorldQuestArea(player, quest) ||
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
    creditWorldQuest(ctx, meta, quest, progress, quest.count);
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

export function sanitizeWorldQuestCycle(value: unknown): string {
  return normalizeWorldQuestCycle(value);
}

export function sanitizeWorldQuestProgress(value: unknown, cycle?: unknown): WorldQuestProgress[] {
  if (!Array.isArray(value)) return [];
  const output: WorldQuestProgress[] = [];
  const seen = new Set<string>();
  const activeIds =
    cycle === undefined ? null : new Set(activeWorldQuestsForCycle(cycle).map((quest) => quest.id));
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
      const puzzle = quest.objective.puzzles[variant];
      normalized.puzzleRotations = sanitizeWorldQuestPuzzleRotations(raw.puzzleRotations, puzzle);
    }
    if (raw.state === 'active' && quest.objective.type === 'match3') {
      const variant =
        Number.isSafeInteger(raw.puzzleVariant) && (raw.puzzleVariant as number) >= 0
          ? Math.min(quest.objective.levels.length - 1, raw.puzzleVariant as number)
          : 0;
      const level = quest.objective.levels[variant];
      normalized.puzzleVariant = variant;
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

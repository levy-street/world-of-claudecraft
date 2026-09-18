import {
  INVESTIGATION_CLUES,
  INVESTIGATION_MOB_ID,
  INVESTIGATION_NPC_IDS,
  INVESTIGATION_NPCS,
  INVESTIGATION_QUEST_ID,
  INVESTIGATION_VARIANTS,
  WORLD_QUEST_INVESTIGATION,
} from './content/world_quest_investigation';
import { summonQuestMob } from './encounters/quest_summon';
import { createGroundObject, createNpc } from './entity';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, INTERACT_RANGE, type WorldQuestInvestigationState } from './types';
import { activeWorldQuestsForCycle, worldQuestPuzzleVariantForCycle } from './world_quest_rotation';

function contentEnabled(ctx: SimContext): boolean {
  return !ctx.cfg.world || !!ctx.cfg.world.npcs[INVESTIGATION_NPCS[0].id];
}

export function ensureInvestigationPost(ctx: SimContext): void {
  if (!contentEnabled(ctx)) return;
  for (const [index, definition] of INVESTIGATION_NPCS.entries()) {
    const id = INVESTIGATION_NPC_IDS[index];
    if (!ctx.entities.has(id))
      ctx.addEntity(createNpc(id, definition, ctx.groundPos(definition.pos.x, definition.pos.z)));
  }
  for (const clue of INVESTIGATION_CLUES) {
    if (!ctx.entities.has(clue.entityId))
      ctx.addEntity(
        createGroundObject(
          clue.entityId,
          clue.objectItemId,
          clue.name,
          ctx.groundPos(clue.x, clue.z),
        ),
      );
  }
}

function nearby(player: Entity, entity: Entity): boolean {
  return (
    !player.dead &&
    !entity.dead &&
    dist2d(player.pos, entity.pos) <= INTERACT_RANGE + 2 &&
    Math.abs(player.pos.y - entity.pos.y) <= INTERACT_RANGE
  );
}
function active(ctx: SimContext, meta: PlayerMeta, player: Entity): boolean {
  const area = WORLD_QUEST_INVESTIGATION.area;
  return (
    contentEnabled(ctx) &&
    !player.dead &&
    player.level >= WORLD_QUEST_INVESTIGATION.minLevel &&
    Math.hypot(player.pos.x - area.x, player.pos.z - area.z) <= area.radius &&
    meta.worldQuestLog.get(INVESTIGATION_QUEST_ID)?.state === 'active' &&
    activeWorldQuestsForCycle(meta.worldQuestCycle).some(
      (quest) => quest.id === INVESTIGATION_QUEST_ID,
    )
  );
}
function stateFor(meta: PlayerMeta): WorldQuestInvestigationState {
  const progress = meta.worldQuestLog.get(INVESTIGATION_QUEST_ID);
  if (!progress) throw new Error('Investigation progress is missing');
  progress.investigation ??= { heard: 0, clues: 0, cleared: 0 };
  return progress.investigation;
}
function npcIndex(npc: Entity): number {
  return INVESTIGATION_NPCS.findIndex(
    (definition, index) =>
      npc.kind === 'npc' &&
      npc.id === INVESTIGATION_NPC_IDS[index] &&
      npc.templateId === definition.id &&
      Math.hypot(npc.pos.x - definition.pos.x, npc.pos.z - definition.pos.z) < 0.1,
  );
}
function openDialogue(ctx: SimContext, meta: PlayerMeta, targetId: number): void {
  meta.wireRev++;
  ctx.emit({ type: 'worldQuestInvestigationDialogue', targetId, pid: meta.entityId });
}

export function talkToInvestigation(
  ctx: SimContext,
  npc: Entity,
  meta: PlayerMeta,
  player: Entity,
): boolean {
  const index = npcIndex(npc);
  if (index < 0) return false;
  if (!nearby(player, npc)) return true;
  if (active(ctx, meta, player)) {
    const state = stateFor(meta);
    if (index > 0 && !state.mobId) state.heard |= 1 << (index - 1);
  }
  openDialogue(ctx, meta, npc.id);
  return true;
}

export function readInvestigationClue(
  ctx: SimContext,
  obj: Entity,
  meta: PlayerMeta,
  player: Entity,
): boolean {
  const index = INVESTIGATION_CLUES.findIndex(
    (clue) =>
      obj.kind === 'object' &&
      obj.id === clue.entityId &&
      obj.objectItemId === clue.objectItemId &&
      obj.templateId === `ground_${clue.objectItemId}` &&
      Math.hypot(obj.pos.x - clue.x, obj.pos.z - clue.z) < 0.1,
  );
  if (index < 0) return false;
  if (!nearby(player, obj)) return true;
  if (active(ctx, meta, player)) stateFor(meta).clues |= 1 << index;
  openDialogue(ctx, meta, obj.id);
  return true;
}

export function clearInvestigationEncounter(ctx: SimContext, meta: PlayerMeta): void {
  const state = meta.worldQuestLog.get(INVESTIGATION_QUEST_ID)?.investigation;
  if (!state?.mobId) return;
  const mob = ctx.entities.get(state.mobId);
  if (mob?.templateId === INVESTIGATION_MOB_ID && mob.tappedById === meta.entityId && !mob.dead)
    ctx.dropEntity(mob.id);
  delete state.mobId;
  meta.wireRev++;
}

export function updateInvestigationEncounter(
  ctx: SimContext,
  meta: PlayerMeta,
  player: Entity,
): void {
  const progress = meta.worldQuestLog.get(INVESTIGATION_QUEST_ID);
  const state = progress?.investigation;
  if (!state?.mobId) return;
  const mob = ctx.entities.get(state.mobId);
  if (!active(ctx, meta, player) || !mob || mob.dead || mob.aiState === 'evade')
    clearInvestigationEncounter(ctx, meta);
}

export function accuseInvestigationSuspect(
  ctx: SimContext,
  npcId: number,
  meta: PlayerMeta,
  player: Entity,
): void {
  if (
    !Number.isSafeInteger(npcId) ||
    !active(ctx, meta, player) ||
    player.inCombat ||
    player.mountKey
  )
    return;
  // The accusation is spoken to the sergeant (the player stands at his post
  // and names a guard); the named guard is resolved only for the reveal.
  const captain = ctx.entities.get(INVESTIGATION_NPC_IDS[0]);
  if (!captain || npcIndex(captain) !== 0 || !nearby(player, captain)) return;
  const npc = ctx.entities.get(npcId);
  if (!npc) return;
  const index = npcIndex(npc) - 1;
  if (index < 0) return;
  const state = stateFor(meta);
  if (state.heard !== 15 || state.clues !== 3 || state.mobId || state.cleared & (1 << index))
    return;
  const variant =
    INVESTIGATION_VARIANTS[
      worldQuestPuzzleVariantForCycle(meta.worldQuestCycle, INVESTIGATION_VARIANTS.length)
    ];
  if (index !== variant.culprit) {
    state.cleared |= 1 << index;
    openDialogue(ctx, meta, captain.id);
    return;
  }
  const expectedId = ctx.nextId;
  summonQuestMob(ctx, INVESTIGATION_MOB_ID, { ...npc.pos, z: npc.pos.z - 3 }, meta.entityId, {
    perOwner: true,
    hardDespawnSeconds: 180,
    announceOwnerOnly: true,
  });
  const mob = ctx.entities.get(expectedId);
  if (mob?.templateId !== INVESTIGATION_MOB_ID || mob.tappedById !== meta.entityId) return;
  state.mobId = mob.id;
  meta.wireRev++;
}

export function investigationKillCounts(meta: PlayerMeta, mob: Entity): boolean {
  const state = meta.worldQuestLog.get(INVESTIGATION_QUEST_ID)?.investigation;
  return (
    state?.mobId === mob.id &&
    mob.templateId === INVESTIGATION_MOB_ID &&
    mob.tappedById === meta.entityId &&
    state.heard === 15 &&
    state.clues === 3
  );
}

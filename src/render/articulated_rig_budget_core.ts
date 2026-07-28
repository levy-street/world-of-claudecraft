import { animatesEveryFrame } from './crowd_lod';

export type CharacterRenderMode = 'rig' | 'localFar' | 'batchedFar';

export interface RigBudgetCandidate {
  id: number;
  distanceSq: number;
  priority: number;
  actionable: boolean;
}

export interface RigBudgetEntityState {
  id: number;
  kind: string;
  castingAbility: string | null;
  inCombat: boolean;
  ownerId: number | null;
  targetId: number | null;
  aggroTargetId: number | null;
}

export interface RigBudgetAuraState {
  id: string;
  kind: string;
}

export interface RigBudgetPresentationState {
  dead: boolean;
  auras: readonly RigBudgetAuraState[];
}

export interface RigBudgetDecision {
  id: number;
  mode: CharacterRenderMode;
}

export interface RigBudgetScratch {
  ordinary: RigBudgetCandidate[];
  decisions: RigBudgetDecision[];
}

export function createRigBudgetScratch(): RigBudgetScratch {
  return { ordinary: [], decisions: [] };
}

function writeDecision(
  decisions: RigBudgetDecision[],
  pool: RigBudgetDecision[],
  index: number,
  id: number,
  mode: CharacterRenderMode,
): void {
  let decision = pool[index];
  if (!decision) {
    decision = { id, mode };
    pool.push(decision);
  }
  decision.id = id;
  decision.mode = mode;
  decisions[index] = decision;
}

export function rigBudgetPriority(kind: string): number | null {
  if (kind === 'player') return 0;
  if (kind === 'mob') return 1;
  if (kind === 'npc') return 2;
  return null;
}

export function isRigBudgetActionable(
  distanceSq: number,
  maxDistanceSq: number,
  entityId: number,
  localPlayerId: number,
  targetId: number | null,
  castingAbility: string | null,
  inCombat = false,
  ownerId: number | null = null,
  combatTargetId: number | null = null,
  combatTargetOwnerId: number | null = null,
): boolean {
  if (distanceSq > maxDistanceSq) return false;
  return animatesEveryFrame(
    entityId,
    localPlayerId,
    targetId,
    castingAbility,
    inCombat,
    ownerId,
    combatTargetId,
    combatTargetOwnerId,
  );
}

export function writeRigBudgetCandidate(
  candidate: RigBudgetCandidate,
  entity: RigBudgetEntityState,
  distanceSq: number,
  maxDistanceSq: number,
  localPlayerId: number,
  localTargetId: number | null,
  combatTargetOwnerId: number | null,
  hasArticulatedVisual = true,
  visibleToLocalPlayer = true,
): boolean {
  const priority = rigBudgetPriority(entity.kind);
  if (
    priority === null ||
    !visibleToLocalPlayer ||
    (entity.kind !== 'player' && !hasArticulatedVisual)
  ) {
    return false;
  }
  const combatTargetId = entity.aggroTargetId ?? entity.targetId;
  candidate.id = entity.id;
  candidate.distanceSq = distanceSq;
  candidate.priority = priority;
  candidate.actionable = isRigBudgetActionable(
    distanceSq,
    maxDistanceSq,
    entity.id,
    localPlayerId,
    localTargetId,
    entity.castingAbility,
    entity.inCombat,
    entity.ownerId,
    combatTargetId,
    combatTargetOwnerId,
  );
  return true;
}

export function requiresLocalCharacterVisual(entity: RigBudgetPresentationState): boolean {
  if (entity.dead) return true;
  for (const aura of entity.auras) {
    if (
      aura.kind === 'polymorph' ||
      aura.kind === 'form_bear' ||
      aura.kind === 'form_cat' ||
      aura.kind === 'form_travel' ||
      aura.kind === 'form_fireball' ||
      aura.kind === 'stealth' ||
      aura.kind === 'form_shadow' ||
      aura.kind === 'form_moonkin' ||
      aura.kind === 'form_metamorph' ||
      aura.id === 'ghost_wolf' ||
      aura.id === 'ice_block' ||
      aura.id === 'frost_trap_freeze' ||
      aura.id === 'temporal_hourglass' ||
      aura.id === 'frost_nova_root' ||
      aura.id === 'rings_of_frost_root' ||
      aura.id === 'ice_barrier' ||
      aura.id === 'blazing_barrier' ||
      aura.id === 'temporal_barrier' ||
      aura.id === 'mass_barrier'
    ) {
      return true;
    }
  }
  return false;
}

export function resolveRigBudgetRenderMode(
  kind: string,
  desiredMode: CharacterRenderMode | undefined,
  rigReady: boolean,
  requiresLocalVisual = false,
): CharacterRenderMode | undefined {
  if (kind === 'player') {
    if (!rigReady) return requiresLocalVisual ? 'localFar' : 'batchedFar';
    if (desiredMode === 'batchedFar') {
      return requiresLocalVisual ? 'localFar' : 'batchedFar';
    }
    return desiredMode;
  }
  if (kind === 'mob' || kind === 'npc') {
    // Only players have an instanced far batch. Non-player overflow keeps its
    // existing visual resident but draws through that visual's static far mesh.
    return desiredMode === 'batchedFar' ? 'localFar' : desiredMode;
  }
  return undefined;
}

export function shouldHidePendingLocalCharacterVisual(
  kind: string,
  rigCompilePending: boolean,
  requiresLocalVisual: boolean,
): boolean {
  return kind === 'player' && rigCompilePending && requiresLocalVisual;
}

export function articulatedRigLimit(
  tier: 'low' | 'medium' | 'high' | 'ultra',
  constrained: boolean,
  budgetPressure: number,
): number {
  // Dense MMO crowds need a hard ordinary-rig ceiling well below the legacy
  // single-player draw budget. Actionable poses remain exempt in the planner.
  const base = tier === 'low' ? 8 : tier === 'medium' ? 16 : tier === 'high' ? 24 : 32;
  const memoryScale = constrained ? 0.65 : 1;
  const pressureScale = 1 - Math.min(1, Math.max(0, budgetPressure)) * 0.5;
  return Math.max(6, Math.floor(base * memoryScale * pressureScale));
}

export function planArticulatedRigs(
  candidates: readonly RigBudgetCandidate[],
  rigLimit: number,
  localFarLimit: number,
  decisions: RigBudgetDecision[],
  scratch: RigBudgetScratch,
): number {
  if (!Number.isInteger(rigLimit) || rigLimit < 0) throw new RangeError('invalid rig limit');
  if (!Number.isInteger(localFarLimit) || localFarLimit < 0) {
    throw new RangeError('invalid local far limit');
  }
  scratch.ordinary.length = 0;
  let decisionCount = 0;
  for (const candidate of candidates) {
    if (candidate.actionable) {
      writeDecision(decisions, scratch.decisions, decisionCount++, candidate.id, 'rig');
    } else scratch.ordinary.push(candidate);
  }
  scratch.ordinary.sort(
    (a, b) => a.priority - b.priority || a.distanceSq - b.distanceSq || a.id - b.id,
  );
  for (let index = 0; index < scratch.ordinary.length; index++) {
    const candidate = scratch.ordinary[index];
    const mode: CharacterRenderMode =
      index < rigLimit ? 'rig' : index < rigLimit + localFarLimit ? 'localFar' : 'batchedFar';
    writeDecision(decisions, scratch.decisions, decisionCount++, candidate.id, mode);
  }
  decisions.length = decisionCount;
  return decisionCount;
}

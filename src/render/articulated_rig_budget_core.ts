export type CharacterRenderMode = 'rig' | 'localFar' | 'batchedFar';

export interface RigBudgetCandidate {
  id: number;
  distanceSq: number;
  actionable: boolean;
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
  scratch.ordinary.sort((a, b) => a.distanceSq - b.distanceSq || a.id - b.id);
  for (let index = 0; index < scratch.ordinary.length; index++) {
    const candidate = scratch.ordinary[index];
    const mode: CharacterRenderMode =
      index < rigLimit ? 'rig' : index < rigLimit + localFarLimit ? 'localFar' : 'batchedFar';
    writeDecision(decisions, scratch.decisions, decisionCount++, candidate.id, mode);
  }
  decisions.length = decisionCount;
  return decisionCount;
}

// The starter tutorial's state machine: pure, DOM-free, i18n-free, Node-testable.
//
// The controller (starter_tutorial.ts) samples IWorld into a `TutorialSnapshot`
// and folds each frame's drained SimEvents into a `TutorialTick` of deltas; this
// module decides what the current step is, how far along its objective is, and
// when the tutorial is done. It NEVER writes sim state: like the in-world
// coachmark it is an observer, which is why the whole tutorial needs no IWorld
// member and no wire command.
//
// Progress is monotonic on purpose. The counters only ever accumulate, so a
// wolf that respawns, an aura that falls off, or a target the player drops after
// the step already completed cannot walk a finished step backwards.

import type { QuestState } from '../sim/types';
import type { TutorialObjective, TutorialStepDef } from './starter_tutorial_script';

/** A frame's read of the world. Everything the objectives can look at. */
export interface TutorialSnapshot {
  /** Yards from the player to the Warden. */
  distToWarden: number;
  /** Template id of the player's current target, or null. */
  targetTemplateId: string | null;
  /** Ability ids of the auras currently on the player. */
  auraAbilityIds: readonly string[];
  /** Does the player have a living pet out. */
  hasPet: boolean;
  /** How many of the tutorial's loot item the player holds. */
  lootItemCount: number;
  /** State of the isle's quest. */
  questState: QuestState;
}

/** One frame's worth of new evidence, folded out of the drained SimEvents. */
export interface TutorialTick {
  /** Plain auto-attack swings that landed on a practice dummy. */
  autoAttackHits: number;
  /** Ranged auto-shots that landed (on anything). */
  rangedHits: number;
  /** Heals the player landed on themselves. */
  selfHeals: number;
  /** Hits landed per ABILITY ID (the controller maps the event's name back). */
  abilityHits: Readonly<Record<string, number>>;
}

export interface TutorialState {
  /** Index into the class's script; === script.length once every step is done. */
  stepIndex: number;
  /** Cumulative evidence, so a completed objective can never un-complete. */
  autoAttackHits: number;
  rangedHits: number;
  selfHeals: number;
  abilityHits: Readonly<Record<string, number>>;
  /** Sticky: an aura or a pet counts once seen, even after it drops. */
  aurasSeen: readonly string[];
  petSeen: boolean;
  /** The player dismissed the tutorial. */
  skipped: boolean;
}

export function initialTutorialState(): TutorialState {
  return {
    stepIndex: 0,
    autoAttackHits: 0,
    rangedHits: 0,
    selfHeals: 0,
    abilityHits: {},
    aurasSeen: [],
    petSeen: false,
    skipped: false,
  };
}

export const EMPTY_TICK: TutorialTick = {
  autoAttackHits: 0,
  rangedHits: 0,
  selfHeals: 0,
  abilityHits: {},
};

/** Quest states, weakest first: an objective asking for `active` is also
 *  satisfied by `ready` or `done` (a player who blitzes the quest before the
 *  step's copy is even read must not strand the tutorial on a passed milestone). */
const QUEST_RANK: Record<QuestState, number> = {
  unavailable: 0,
  available: 1,
  active: 2,
  ready: 3,
  done: 4,
};

function questReached(now: QuestState, wanted: QuestState): boolean {
  return QUEST_RANK[now] >= QUEST_RANK[wanted];
}

/** How far along the step's objective is: `current` of `total`. A step whose
 *  objective is a one-shot reads 0/1 or 1/1, which is what the checklist renders. */
export function objectiveProgress(
  objective: TutorialObjective,
  state: TutorialState,
  snap: TutorialSnapshot,
): { current: number; total: number } {
  switch (objective.kind) {
    case 'reachWarden':
      return { current: snap.distToWarden <= WARDEN_REACH ? 1 : 0, total: 1 };
    case 'targetMob':
      return { current: snap.targetTemplateId === objective.templateId ? 1 : 0, total: 1 };
    case 'autoAttack':
      return { current: Math.min(state.autoAttackHits, objective.count), total: objective.count };
    case 'abilityHit':
      return {
        current: Math.min(state.abilityHits[objective.abilityId] ?? 0, objective.count),
        total: objective.count,
      };
    case 'auraUp':
      return {
        current:
          state.aurasSeen.includes(objective.abilityId) ||
          snap.auraAbilityIds.includes(objective.abilityId)
            ? 1
            : 0,
        total: 1,
      };
    case 'healSelf':
      return { current: Math.min(state.selfHeals, objective.count), total: objective.count };
    case 'rangedHit':
      return { current: Math.min(state.rangedHits, objective.count), total: objective.count };
    case 'petSummoned':
      return { current: state.petSeen || snap.hasPet ? 1 : 0, total: 1 };
    case 'questState':
      return { current: questReached(snap.questState, objective.state) ? 1 : 0, total: 1 };
    case 'lootItem':
      return {
        current: Math.min(snap.lootItemCount, objective.count),
        total: objective.count,
      };
  }
}

// Kept in sync with the script's WARDEN_REACH_YARDS by the script test; inlined
// here so the core imports only types from the script module.
const WARDEN_REACH = 6;

export function objectiveComplete(
  objective: TutorialObjective,
  state: TutorialState,
  snap: TutorialSnapshot,
): boolean {
  const p = objectiveProgress(objective, state, snap);
  return p.current >= p.total;
}

/** Fold one frame of evidence into the state, then advance past every step whose
 *  objective is now satisfied (more than one can fall in a single frame: a player
 *  who already looted a fang clears `spoils` the instant `hunt` completes). */
export function advanceTutorial(
  state: TutorialState,
  script: readonly TutorialStepDef[],
  snap: TutorialSnapshot,
  tick: TutorialTick,
): TutorialState {
  if (state.skipped || state.stepIndex >= script.length) return state;

  const abilityHits: Record<string, number> = { ...state.abilityHits };
  for (const [id, n] of Object.entries(tick.abilityHits)) {
    abilityHits[id] = (abilityHits[id] ?? 0) + n;
  }
  // Sticky union: an aura the player put up this frame stays "seen" after it
  // expires, so a short imbue cannot un-complete the step it satisfied.
  const aurasSeen = [...new Set([...state.aurasSeen, ...snap.auraAbilityIds])];

  let next: TutorialState = {
    ...state,
    autoAttackHits: state.autoAttackHits + tick.autoAttackHits,
    rangedHits: state.rangedHits + tick.rangedHits,
    selfHeals: state.selfHeals + tick.selfHeals,
    abilityHits,
    aurasSeen,
    petSeen: state.petSeen || snap.hasPet,
  };

  while (
    next.stepIndex < script.length &&
    objectiveComplete(script[next.stepIndex].objective, next, snap)
  ) {
    next = { ...next, stepIndex: next.stepIndex + 1 };
  }
  return next;
}

/** The live step, or null once the tutorial is finished or skipped. */
export function currentStep(
  state: TutorialState,
  script: readonly TutorialStepDef[],
): TutorialStepDef | null {
  if (state.skipped || state.stepIndex >= script.length) return null;
  return script[state.stepIndex];
}

export function isTutorialComplete(
  state: TutorialState,
  script: readonly TutorialStepDef[],
): boolean {
  return !state.skipped && state.stepIndex >= script.length;
}

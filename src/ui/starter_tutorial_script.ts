// The starter tutorial's step script: what Dawnhaven Isle actually teaches, and
// in what order, for each of the nine classes.
//
// Pure data. Every step names an OBJECTIVE (the evidence that advances it, read
// from IWorld plus the drained SimEvents by starter_tutorial_core.ts) and the
// i18n keys for its copy. No English lives here and no DOM is touched, so the
// whole script is drivable headlessly by a Vitest.
//
// Shape: a shared seven-step spine (land, enlist, target, strike, hunt, spoils,
// report) with two CLASS-SPECIFIC steps spliced in the middle (signature,
// mastery). Every class's kit is its level-1 kit, because the tutorial character
// really is a fresh level 1: nothing here asks for an ability the player has not
// been taught yet (`tests/starter_tutorial_script.test.ts` pins that against the
// real ABILITIES table).

import {
  DAWNHAVEN_AMBUSH,
  DAWNHAVEN_HOLLOW,
  DAWNHAVEN_WARDEN_POS,
  DAWNHAVEN_YARD,
} from '../sim/content/tutorial';
import type { PlayerClass, QuestState } from '../sim/types';

/** The isle's ids, mirrored from src/sim/content/tutorial/isle.ts. */
export const TUTORIAL_QUEST_ID = 'q_dawnhaven_wolves';
export const TUTORIAL_DUMMY_ID = 'dawnhaven_dummy';
export const TUTORIAL_WOLF_ID = 'dawnhaven_strandwolf';
export const TUTORIAL_WARDEN_ID = 'dawnhaven_warden';
export const TUTORIAL_LOOT_ITEM_ID = 'wolf_fang';

/** How close the player has to get before the Warden counts as reached. */
export const WARDEN_REACH_YARDS = 6;

// What a step watches for. Each variant is evaluated by exactly one arm of
// `objectiveProgress` in the core, against a snapshot of IWorld plus the counters
// the core accumulates from drained events.
export type TutorialObjective =
  /** Walk up the beach path to the Warden. */
  | { kind: 'reachWarden' }
  /** The player's current target is a mob of this template. */
  | { kind: 'targetMob'; templateId: string }
  /** Land N plain auto-attack swings (no ability) on the practice dummy. */
  | { kind: 'autoAttack'; count: number }
  /** Land N hits with a specific ability. */
  | { kind: 'abilityHit'; abilityId: string; count: number }
  /** Carry an aura applied by this ability (buffs, imbues, seals, armors). */
  | { kind: 'auraUp'; abilityId: string }
  /** Heal yourself N times. */
  | { kind: 'healSelf'; count: number }
  /** Land N ranged auto-shots (the hunter's whole point: fight at distance). */
  | { kind: 'rangedHit'; count: number }
  /** Have a pet out (the warlock's demon). */
  | { kind: 'petSummoned' }
  /** The isle's quest reaches this state. */
  | { kind: 'questState'; state: QuestState }
  /** Hold at least N of an item (the loot lesson). */
  | { kind: 'lootItem'; itemId: string; count: number };

export interface TutorialStepDef {
  /** Stable id: the i18n keys are `hudChrome.starterTutorial.steps.<id>.*`. */
  id: string;
  objective: TutorialObjective;
  /** Where the on-screen arrow points while this step is live. */
  pointAt: 'warden' | 'yard' | 'hollow' | null;
}

// Where the on-screen arrow points, and where the reveals fire. Taken straight
// from the isle's station anchors, never re-typed, so moving a station in the map
// data moves the arrow and the cinematic trigger with it.
export const TUTORIAL_POINTS = {
  warden: DAWNHAVEN_WARDEN_POS,
  yard: DAWNHAVEN_YARD,
  hollow: DAWNHAVEN_HOLLOW,
  ambush: DAWNHAVEN_AMBUSH,
} as const;

// The two class-specific steps. `signature` is the class's level-1 damage opener
// (the paladin has none at level 1, so hers is the seal that arms her swings);
// `mastery` is the second half of its level-1 identity: the shout, the finisher
// that spends the combo points the signature built, the demon, the heal, the
// self-buff, or, for the hunter, backing off and shooting.
const SIGNATURE: Record<PlayerClass, TutorialObjective> = {
  warrior: { kind: 'abilityHit', abilityId: 'heroic_strike', count: 2 },
  paladin: { kind: 'auraUp', abilityId: 'seal_of_righteousness' },
  hunter: { kind: 'abilityHit', abilityId: 'raptor_strike', count: 2 },
  rogue: { kind: 'abilityHit', abilityId: 'sinister_strike', count: 3 },
  priest: { kind: 'abilityHit', abilityId: 'smite', count: 2 },
  mage: { kind: 'abilityHit', abilityId: 'fireball', count: 2 },
  warlock: { kind: 'abilityHit', abilityId: 'shadow_bolt', count: 2 },
  druid: { kind: 'abilityHit', abilityId: 'wrath', count: 2 },
  shaman: { kind: 'abilityHit', abilityId: 'lightning_bolt', count: 2 },
};

const MASTERY: Record<PlayerClass, TutorialObjective> = {
  warrior: { kind: 'auraUp', abilityId: 'battle_shout' },
  paladin: { kind: 'healSelf', count: 1 },
  hunter: { kind: 'rangedHit', count: 3 },
  rogue: { kind: 'abilityHit', abilityId: 'eviscerate', count: 1 },
  priest: { kind: 'healSelf', count: 1 },
  mage: { kind: 'auraUp', abilityId: 'frost_armor' },
  warlock: { kind: 'petSummoned' },
  druid: { kind: 'auraUp', abilityId: 'mark_of_the_wild' },
  shaman: { kind: 'auraUp', abilityId: 'rockbiter_weapon' },
};

/** The ordered steps this class is taught, spine plus its two class challenges. */
export function starterTutorialScript(cls: PlayerClass): TutorialStepDef[] {
  return [
    { id: 'land', objective: { kind: 'reachWarden' }, pointAt: 'warden' },
    { id: 'enlist', objective: { kind: 'questState', state: 'active' }, pointAt: 'warden' },
    {
      id: 'target',
      objective: { kind: 'targetMob', templateId: TUTORIAL_DUMMY_ID },
      pointAt: 'yard',
    },
    { id: 'strike', objective: { kind: 'autoAttack', count: 3 }, pointAt: 'yard' },
    { id: 'signature', objective: SIGNATURE[cls], pointAt: 'yard' },
    { id: 'mastery', objective: MASTERY[cls], pointAt: 'yard' },
    { id: 'hunt', objective: { kind: 'questState', state: 'ready' }, pointAt: 'hollow' },
    {
      id: 'spoils',
      objective: { kind: 'lootItem', itemId: TUTORIAL_LOOT_ITEM_ID, count: 1 },
      pointAt: 'hollow',
    },
    { id: 'report', objective: { kind: 'questState', state: 'done' }, pointAt: 'warden' },
  ];
}

/** The ability a class's signature / mastery step names, when it names one. The
 *  panel needs it to render the ability's icon and localized name in the copy. */
export function stepAbilityId(objective: TutorialObjective): string | null {
  if (objective.kind === 'abilityHit' || objective.kind === 'auraUp') return objective.abilityId;
  return null;
}

/** Every ability id the script can ask any class for. The script test walks this
 *  to prove each one is real and learned by that class at level 1. */
export function scriptedAbilityIds(cls: PlayerClass): string[] {
  return [SIGNATURE[cls], MASTERY[cls]]
    .map(stepAbilityId)
    .filter((id): id is string => id !== null);
}

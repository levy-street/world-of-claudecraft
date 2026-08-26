// Pure, host-agnostic model for the Proving Shore movement bootcamp: the
// coachmark that meets a fresh arrival at Warden Tam's Gauntlet, the walled
// two-elbow lane course on the south strand, and walks them through it one
// ordered lesson per lane.
//
// The ladder: TALK to Warden Tam (press F, which starts the run quest), hold
// forward down lane 1, turn with the turn key and walk the south lane, then
// swing the view with the mouse and STRAFE the last lane to the red flag,
// where Overseer Pell takes the run in. The flags are credited sim-side in
// running order (the quest's own objective count,
// tutorial/gauntlet_run.ts); this ladder folds that count with the quest's
// log state into one lesson at a time.
//
// The island's on-rails quest chain teaches the GAME (combat, looting,
// trades, the bank); this overlay teaches the HANDS. It is the island
// sibling of the Eastbrook new-adventurer coachmark (tutorial.ts +
// tutorial_copy.ts). Copy has THREE arms: keyboard/mouse, touch, and
// gamepad, chosen by the live input-hint mode (src/game/input_hint_mode.ts).
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md);
// registered in UI_PURE_CORES (tests/architecture.test.ts); driven directly
// by tests/bootcamp_view.test.ts.

import {
  BOOTCAMP_COURSE_CHECKPOINTS,
  PROVING_SHORE_NPCS,
  PROVING_SHORE_OBJECTS,
  PROVING_SHORE_QUEST_ORDER,
  PROVING_SHORE_QUESTS,
} from '../sim/content/proving_shore';
import type { TranslationKey } from './i18n';

/** The control family the copy speaks for. Structurally identical to
 *  input_hint_mode.ts's InputHintMode; declared here rather than imported so
 *  this core stays free of game/ imports (the pure-core purity scan). */
export type BootcampInputMode = 'keyboard' | 'touch' | 'pad';

export type BootcampStep = 'talk' | 'forward' | 'turnwalk' | 'strafe' | 'camera' | 'done';

export const BOOTCAMP_STEP_ORDER: readonly BootcampStep[] = [
  'talk',
  'forward',
  'turnwalk',
  'strafe',
  'camera',
];

/** How far (radians of accumulated view travel) the camera lesson asks the
 *  player to swing before it counts as learned: one deliberate drag, about a
 *  quarter turn, and the card moves straight on to the hand-in. */
export const CAMERA_LESSON_TRAVEL_RAD = 0.5;

export interface BootcampSnapshot {
  /** The run quest sits in the quest log (accepted at Warden Tam). */
  questActive: boolean;
  /** Gauntlet flags tagged so far, in running order (0..3). */
  checkpointsReached: number;
  /** The end-of-course camera lesson's own tally: the overlay accumulates
   *  view-yaw travel and flips this at CAMERA_LESSON_TRAVEL_RAD. */
  cameraTurned: boolean;
}

/** The current lesson: talk to the keeper, one lane at a time, then the
 *  camera swing at the finish, then the hand-in. */
export function computeBootcampStep(s: BootcampSnapshot): BootcampStep {
  if (!s.questActive) return 'talk';
  if (s.checkpointsReached <= 0) return 'forward';
  if (s.checkpointsReached === 1) return 'turnwalk';
  if (s.checkpointsReached === 2) return 'strafe';
  if (!s.cameraTurned) return 'camera';
  return 'done';
}

/** The world point the guidance arrow should aim at: Warden Tam for the talk
 *  lesson, the current lane's flag while running, Overseer Pell at the end.
 *  The camera lesson has no world target (the lesson is the view itself). */
export function bootcampArrowTarget(
  step: BootcampStep,
  checkpointsReached: number,
): { x: number; z: number } | null {
  if (step === 'talk') return PROVING_SHORE_NPCS.warden_tam.pos;
  if (step === 'camera') return null;
  if (step === 'done') return PROVING_SHORE_NPCS.overseer_pell.pos;
  return BOOTCAMP_COURSE_CHECKPOINTS[checkpointsReached] ?? null;
}

export type BootcampParam =
  | 'forwardKey'
  /** Turn RIGHT: lane 2's corner. */
  | 'turnKey'
  /** Turn LEFT: lane 3's corner. Both lanes teach the same shape, turn and
   *  THEN walk, so the course never asks a new player to learn two idioms. */
  | 'turnLeftKey'
  | 'strafeKey'
  | 'interactKey';

export interface BootcampBodyPlan {
  bodyKey: TranslationKey;
  /** Which interpolation params the body needs (keyboard arms only; touch and
   *  pad copy names sticks and on-screen affordances instead of bind labels). */
  params: readonly BootcampParam[];
}

const KEYBOARD: Record<BootcampStep, BootcampBodyPlan> = {
  talk: { bodyKey: 'hudChrome.bootcamp.talkBody', params: ['interactKey'] },
  forward: { bodyKey: 'hudChrome.bootcamp.forwardBody', params: ['forwardKey'] },
  turnwalk: { bodyKey: 'hudChrome.bootcamp.turnwalkBody', params: ['turnKey', 'forwardKey'] },
  strafe: { bodyKey: 'hudChrome.bootcamp.strafeBody', params: ['turnLeftKey', 'forwardKey'] },
  camera: { bodyKey: 'hudChrome.bootcamp.cameraBody', params: [] },
  done: { bodyKey: 'hudChrome.bootcamp.doneBody', params: ['interactKey'] },
};

const TOUCH: Record<BootcampStep, BootcampBodyPlan> = {
  talk: { bodyKey: 'hudChrome.bootcamp.talkBodyTouch', params: [] },
  forward: { bodyKey: 'hudChrome.bootcamp.forwardBodyTouch', params: [] },
  turnwalk: { bodyKey: 'hudChrome.bootcamp.turnwalkBodyTouch', params: [] },
  strafe: { bodyKey: 'hudChrome.bootcamp.strafeBodyTouch', params: [] },
  camera: { bodyKey: 'hudChrome.bootcamp.cameraBodyTouch', params: [] },
  done: { bodyKey: 'hudChrome.bootcamp.doneBodyTouch', params: [] },
};

const PAD: Record<BootcampStep, BootcampBodyPlan> = {
  talk: { bodyKey: 'hudChrome.bootcamp.talkBodyPad', params: [] },
  forward: { bodyKey: 'hudChrome.bootcamp.forwardBodyPad', params: [] },
  turnwalk: { bodyKey: 'hudChrome.bootcamp.turnwalkBodyPad', params: [] },
  strafe: { bodyKey: 'hudChrome.bootcamp.strafeBodyPad', params: [] },
  camera: { bodyKey: 'hudChrome.bootcamp.cameraBodyPad', params: [] },
  done: { bodyKey: 'hudChrome.bootcamp.doneBodyPad', params: [] },
};

export function bootcampBodyPlan(step: BootcampStep, mode: BootcampInputMode): BootcampBodyPlan {
  if (mode === 'touch') return TOUCH[step];
  if (mode === 'pad') return PAD[step];
  return KEYBOARD[step];
}

export function bootcampTitleKey(step: BootcampStep): TranslationKey {
  const titles: Record<BootcampStep, TranslationKey> = {
    talk: 'hudChrome.bootcamp.talkTitle',
    forward: 'hudChrome.bootcamp.forwardTitle',
    turnwalk: 'hudChrome.bootcamp.turnwalkTitle',
    strafe: 'hudChrome.bootcamp.strafeTitle',
    camera: 'hudChrome.bootcamp.cameraTitle',
    done: 'hudChrome.bootcamp.doneTitle',
  };
  return titles[step];
}

/** The physical keycap chips to show under the body ("the buttons they need
 *  to press, on screen"). Keyboard only: touch and pad have no keycaps, their
 *  copy names the stick or on-screen affordance instead. */
export function bootcampKeycaps(
  step: BootcampStep,
  mode: BootcampInputMode,
  labels: {
    forwardKey: string;
    turnKey: string;
    turnLeftKey: string;
    strafeKey: string;
    interactKey: string;
  },
): readonly string[] {
  if (mode !== 'keyboard') return [];
  const caps: Record<BootcampStep, readonly string[]> = {
    talk: [labels.interactKey],
    forward: [labels.forwardKey],
    // Both corners read in press order (the chips row separates them with a
    // localized "then") and teach the SAME shape: turn, THEN walk. Lane 2
    // turns right, lane 3 turns left.
    turnwalk: [labels.turnKey, labels.forwardKey],
    strafe: [labels.turnLeftKey, labels.forwardKey],
    camera: [],
    done: [labels.interactKey],
  };
  return caps[step].filter(Boolean);
}

// ---------------------------------------------------------------------------
// The rail coach: the same card, kept up for EVERY quest on the island's
// relay after the Gauntlet's own lesson ladder. One generic three-state
// template per quest (walk to the giver, do the task, return to the turn-in),
// with a per-quest arrow target while the task is underway, so the top-of-
// screen helper never goes dark between the pier and the crossing home.
// ---------------------------------------------------------------------------

/** The rail's head quest, whose card is the lesson ladder above instead of
 *  the generic coach (mirrors tutorial/gauntlet_run.ts GAUNTLET_QUEST_ID
 *  without importing sim logic into this pure core). */
export const COACH_GAUNTLET_QUEST_ID = PROVING_SHORE_QUEST_ORDER[0];

export type CoachState = 'available' | 'active' | 'ready';

export interface CoachFocus {
  questId: string;
  state: CoachState;
}

/** The first rail quest still moving, in chain order: the relay hands one
 *  quest to the next, so the first available/active/ready quest IS the
 *  player's current station. Null once the whole rail is done (or none of it
 *  is offered), which folds the card away. */
export function coachFocus(stateOf: (questId: string) => CoachState | null): CoachFocus | null {
  for (const questId of PROVING_SHORE_QUEST_ORDER) {
    const state = stateOf(questId);
    if (state) return { questId, state };
  }
  return null;
}

/** Where the arrow points while each quest's task is underway (the giver and
 *  turn-in states aim at the NPCs themselves). Coordinates mirror the quest
 *  content: the effigy yard, the scuttler strand's anchor, Finch's stall,
 *  the signpost's reading spot, and Odo at the crossing. The crate line
 *  deliberately carries NO marker (null): the crates line the path itself,
 *  and the card says so. */
export const COACH_ACTIVE_TARGETS: Readonly<Record<string, { x: number; z: number } | null>> = {
  q_ps_strike_true: { x: -336, z: -14 },
  // The same effigy yard: the ability drill is the second lesson at one
  // station (tutorial/ability_drill.ts ABILITY_DRILL_RING's centre).
  q_ps_hone_the_edge: { x: -336, z: -14 },
  q_ps_shell_and_claw: { x: -380, z: -42 },
  // The tide pool (interactions/crab_summon.ts CRAB_SUMMON_SITE; a ui core
  // mirrors the coordinate, tests/bootcamp_view.test.ts pins them equal).
  q_ps_mother_of_pearl: { x: -398, z: -17 },
  q_ps_the_wreck_line: null,
  q_ps_pouch_and_purse: PROVING_SHORE_NPCS.quartermaster_finch.pos,
  q_ps_the_signpost: { x: -312, z: 42.5 },
  // The Passing Stone (content/proving_shore.ts PROVING_SHORE_OBJECTS); a ui
  // core mirrors the coordinate, tests/bootcamp_view.test.ts pins them equal.
  q_ps_the_long_walk: { x: -312, z: -6 },
  q_ps_set_sail: PROVING_SHORE_NPCS.ferryman_odo.pos,
};

export type CoachParam =
  | 'interactKey'
  | 'mapKey'
  | 'targetKey'
  | 'attackKey'
  | 'bagsKey'
  | 'charKey'
  /** The ability lesson's own button: the keycap the class's taught attack
   *  sits on. Distinct from attackKey, which is the autoattack toggle for a
   *  melee class; the drill is about the OTHER button. */
  | 'abilityKey';

export interface CoachCardPlan {
  /** Null on the active state: the overlay titles that card with the quest's
   *  own localized name instead of a chrome key. */
  titleKey: TranslationKey | null;
  /** The title splices {npc} (the localized NPC name). */
  titleHasNpc: boolean;
  bodyKey: TranslationKey;
  /** Bind labels the body splices (keyboard arm only; touch and pad copy
   *  names sticks and on-screen affordances instead). */
  params: readonly CoachParam[];
  /** The body splices {npc}. */
  bodyHasNpc: boolean;
  /** The body splices {ability}: the localized name of the attack THIS class
   *  was taught. True on every input mode, unlike params. */
  bodyHasAbility: boolean;
  /** Whose localized name fills {npc}: the giver on the way in, the turn-in
   *  on the way back (also the active state's arrow fallback). */
  npcId: string;
  /** Null hides the guidance arrow for this card (the crate line's choice). */
  arrow: { x: number; z: number } | null;
}

const COACH_BODY: Record<CoachState, Record<BootcampInputMode, TranslationKey>> = {
  available: {
    keyboard: 'hudChrome.bootcamp.coachNextBody',
    touch: 'hudChrome.bootcamp.coachNextBodyTouch',
    pad: 'hudChrome.bootcamp.coachNextBodyPad',
  },
  active: {
    keyboard: 'hudChrome.bootcamp.coachTaskBody',
    touch: 'hudChrome.bootcamp.coachTaskBodyTouch',
    pad: 'hudChrome.bootcamp.coachTaskBodyPad',
  },
  ready: {
    keyboard: 'hudChrome.bootcamp.coachReadyBody',
    touch: 'hudChrome.bootcamp.coachReadyBodyTouch',
    pad: 'hudChrome.bootcamp.coachReadyBodyPad',
  },
};

/** Per-quest mechanic lessons that replace the generic bodies: the ACTIVE
 *  card teaches the quest's own hands (targeting and the swing for the
 *  effigy fell, the pinch-and-retreat rules for the scuttler cull, the
 *  pickup press for the crate line, the stall purchase for the pouch), and
 *  the pouch lesson's READY card walks the buckle-on before the hand-in. */
interface CoachBodyOverride {
  keys: Record<BootcampInputMode, TranslationKey>;
  /** Caster-class arms (mage, warlock, priest, druid): their first real
   *  button is the slot-2 spell, so the combat lessons speak of casting and
   *  the second button instead of swinging and the first. */
  casterKeys?: Record<BootcampInputMode, TranslationKey>;
  /** Keyboard-arm bind labels the body splices. */
  params: readonly CoachParam[];
  bodyHasNpc: boolean;
  /** Whose localized name fills {npc} when bodyHasNpc: default 'turnIn'. */
  npcRole?: 'giver' | 'turnIn';
  /** The body splices {ability}, the localized name of the attack THIS class
   *  was taught (starting_attack.ts). Separate from params because params is
   *  the keyboard-only keycap list, and the ability's name belongs in the
   *  touch and pad bodies too. */
  bodyHasAbility?: boolean;
}

const COACH_ACTIVE_OVERRIDES: Readonly<Record<string, CoachBodyOverride>> = {
  q_ps_strike_true: {
    keys: {
      keyboard: 'hudChrome.bootcamp.taskStrikeTrueBody',
      touch: 'hudChrome.bootcamp.taskStrikeTrueBodyTouch',
      pad: 'hudChrome.bootcamp.taskStrikeTrueBodyPad',
    },
    casterKeys: {
      keyboard: 'hudChrome.bootcamp.taskStrikeTrueBodyCaster',
      touch: 'hudChrome.bootcamp.taskStrikeTrueBodyCasterTouch',
      pad: 'hudChrome.bootcamp.taskStrikeTrueBodyCasterPad',
    },
    params: ['attackKey'],
    bodyHasNpc: false,
  },
  q_ps_hone_the_edge: {
    keys: {
      keyboard: 'hudChrome.bootcamp.taskHoneBody',
      touch: 'hudChrome.bootcamp.taskHoneBodyTouch',
      pad: 'hudChrome.bootcamp.taskHoneBodyPad',
    },
    params: ['abilityKey'],
    bodyHasNpc: false,
    bodyHasAbility: true,
  },
  q_ps_shell_and_claw: {
    keys: {
      keyboard: 'hudChrome.bootcamp.taskShellBody',
      touch: 'hudChrome.bootcamp.taskShellBodyTouch',
      pad: 'hudChrome.bootcamp.taskShellBodyPad',
    },
    casterKeys: {
      keyboard: 'hudChrome.bootcamp.taskShellBodyCaster',
      touch: 'hudChrome.bootcamp.taskShellBodyCasterTouch',
      pad: 'hudChrome.bootcamp.taskShellBodyCasterPad',
    },
    // Names the ABILITY, not slot 1. This lesson comes after the drill, so
    // sending a player back to the plain attack would unteach it, and "press
    // 1" is flatly wrong for a caster whose spell sits on 2 (CX).
    params: ['abilityKey'],
    bodyHasNpc: false,
    bodyHasAbility: true,
  },
  q_ps_mother_of_pearl: {
    keys: {
      keyboard: 'hudChrome.bootcamp.taskPearlBody',
      touch: 'hudChrome.bootcamp.taskPearlBodyTouch',
      pad: 'hudChrome.bootcamp.taskPearlBodyPad',
    },
    params: ['bagsKey', 'interactKey'],
    bodyHasNpc: false,
  },
  q_ps_the_wreck_line: {
    keys: {
      keyboard: 'hudChrome.bootcamp.taskWreckLineBody',
      touch: 'hudChrome.bootcamp.taskWreckLineBodyTouch',
      pad: 'hudChrome.bootcamp.taskWreckLineBodyPad',
    },
    params: ['interactKey'],
    bodyHasNpc: false,
  },
  q_ps_the_long_walk: {
    keys: {
      keyboard: 'hudChrome.bootcamp.taskLongWalkBody',
      touch: 'hudChrome.bootcamp.taskLongWalkBodyTouch',
      pad: 'hudChrome.bootcamp.taskLongWalkBodyPad',
    },
    params: ['bagsKey'],
    bodyHasNpc: false,
  },
  q_ps_pouch_and_purse: {
    keys: {
      keyboard: 'hudChrome.bootcamp.taskPouchBody',
      touch: 'hudChrome.bootcamp.taskPouchBodyTouch',
      pad: 'hudChrome.bootcamp.taskPouchBodyPad',
    },
    params: ['interactKey'],
    bodyHasNpc: true,
    npcRole: 'giver',
  },
};

const COACH_READY_OVERRIDES: Readonly<Record<string, CoachBodyOverride>> = {
  q_ps_pouch_and_purse: {
    keys: {
      keyboard: 'hudChrome.bootcamp.readyPouchBody',
      touch: 'hudChrome.bootcamp.readyPouchBodyTouch',
      pad: 'hudChrome.bootcamp.readyPouchBodyPad',
    },
    params: ['bagsKey', 'interactKey'],
    bodyHasNpc: true,
  },
};

/** Where the death lesson's card is in its own three-beat arc. The player's
 *  live/dead/ghost state, resolved by the consumer and passed in, because a
 *  pure core cannot read the world. */
export type DeathLessonPhase = 'alive' | 'dead' | 'ghost';

/** The death lesson's bodies per phase and input arm: walk to the stone,
 *  release the spirit, then walk back to the body. */
const LONG_WALK_BODIES: Readonly<
  Record<DeathLessonPhase, Record<BootcampInputMode, TranslationKey>>
> = {
  alive: {
    keyboard: 'hudChrome.bootcamp.taskLongWalkBody',
    touch: 'hudChrome.bootcamp.taskLongWalkBodyTouch',
    pad: 'hudChrome.bootcamp.taskLongWalkBodyPad',
  },
  dead: {
    keyboard: 'hudChrome.bootcamp.taskLongWalkDeadBody',
    touch: 'hudChrome.bootcamp.taskLongWalkDeadBodyTouch',
    pad: 'hudChrome.bootcamp.taskLongWalkDeadBodyPad',
  },
  ghost: {
    keyboard: 'hudChrome.bootcamp.taskLongWalkGhostBody',
    touch: 'hudChrome.bootcamp.taskLongWalkGhostBodyTouch',
    pad: 'hudChrome.bootcamp.taskLongWalkGhostBodyPad',
  },
};

export const DEATH_LESSON_QUEST_ID = 'q_ps_the_long_walk';

export function coachCardPlan(
  focus: CoachFocus,
  mode: BootcampInputMode,
  caster = false,
  deathPhase: DeathLessonPhase = 'alive',
): CoachCardPlan {
  const quest = PROVING_SHORE_QUESTS[focus.questId];
  const giver = PROVING_SHORE_NPCS[quest.giverNpcId];
  const turnIn = PROVING_SHORE_NPCS[quest.turnInNpcId];
  if (focus.state === 'available') {
    return {
      titleKey: 'hudChrome.bootcamp.coachNextTitle',
      titleHasNpc: true,
      bodyKey: COACH_BODY.available[mode],
      params: mode === 'keyboard' ? ['interactKey'] : [],
      bodyHasNpc: true,
      bodyHasAbility: false,
      npcId: quest.giverNpcId,
      arrow: giver.pos,
    };
  }
  if (focus.state === 'active') {
    // The death lesson swaps its whole body once the player is dead: the
    // card that said "go kneel" is useless to a corpse, and the one that
    // says "walk back" is useless to someone still alive.
    if (focus.questId === DEATH_LESSON_QUEST_ID && deathPhase !== 'alive') {
      return {
        titleKey: null,
        titleHasNpc: false,
        bodyKey: LONG_WALK_BODIES[deathPhase][mode],
        params: [],
        bodyHasNpc: false,
        bodyHasAbility: false,
        npcId: quest.turnInNpcId,
        // A ghost steers by its own corpse marker, not by the stone it
        // already knelt at.
        arrow: null,
      };
    }
    const override = COACH_ACTIVE_OVERRIDES[focus.questId];
    const overrideKeys = override
      ? caster && override.casterKeys
        ? override.casterKeys
        : override.keys
      : null;
    return {
      titleKey: null,
      titleHasNpc: false,
      bodyKey: overrideKeys ? overrideKeys[mode] : COACH_BODY.active[mode],
      params: mode === 'keyboard' ? (override ? override.params : ['mapKey']) : [],
      bodyHasNpc: override?.bodyHasNpc ?? false,
      bodyHasAbility: override?.bodyHasAbility ?? false,
      npcId: override?.npcRole === 'giver' ? quest.giverNpcId : quest.turnInNpcId,
      // An authored null means NO marker; only a missing entry falls back.
      arrow:
        COACH_ACTIVE_TARGETS[focus.questId] === undefined
          ? turnIn.pos
          : COACH_ACTIVE_TARGETS[focus.questId],
    };
  }
  const override = COACH_READY_OVERRIDES[focus.questId];
  return {
    titleKey: 'hudChrome.bootcamp.coachReadyTitle',
    titleHasNpc: false,
    bodyKey: override ? override.keys[mode] : COACH_BODY.ready[mode],
    params: mode === 'keyboard' ? (override ? override.params : ['interactKey']) : [],
    bodyHasNpc: override?.bodyHasNpc ?? true,
    bodyHasAbility: override?.bodyHasAbility ?? false,
    npcId: quest.turnInNpcId,
    arrow: turnIn.pos,
  };
}

/** Keycap chips for the coach cards: the plan's own bind labels, minus the
 *  map key (a wayfinding aside, not a button the lesson is about). Keyboard
 *  only, the ladder's rule. */
export function coachKeycaps(
  plan: Pick<CoachCardPlan, 'params'>,
  mode: BootcampInputMode,
  labels: Readonly<Record<CoachParam, string>>,
): readonly string[] {
  if (mode !== 'keyboard') return [];
  return plan.params
    .filter((p) => p !== 'mapKey')
    .map((p) => labels[p])
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// The closing bell step and the one island-wide step ladder.
// ---------------------------------------------------------------------------

/** The island ferry bell's authored spot (the strait column entry of the
 *  ps_ferry_bell ground object), the final card's arrow target. */
export const BELL_STEP_TARGET: { x: number; z: number } = (() => {
  const bell = PROVING_SHORE_OBJECTS.find((o) => o.itemId === 'ps_ferry_bell');
  return bell?.positions.find((p) => p.x < -180) ?? { x: -279, z: -10 };
})();

export interface BellCardPlan {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  params: readonly CoachParam[];
  arrow: { x: number; z: number };
}

/** The card shown once the whole rail is handed in: ring the bell home. */
export function bellCardPlan(mode: BootcampInputMode): BellCardPlan {
  const bodies: Record<BootcampInputMode, TranslationKey> = {
    keyboard: 'hudChrome.bootcamp.bellBody',
    touch: 'hudChrome.bootcamp.bellBodyTouch',
    pad: 'hudChrome.bootcamp.bellBodyPad',
  };
  return {
    titleKey: 'hudChrome.bootcamp.bellTitle',
    bodyKey: bodies[mode],
    params: mode === 'keyboard' ? ['interactKey'] : [],
    arrow: BELL_STEP_TARGET,
  };
}

// ---------------------------------------------------------------------------
// The ring equip lesson (the Mother of Pearl hand-in's coda): the reward
// sits in the bags, and the card walks wearing it (B, click the ring) and
// then admiring it (C, the character sheet), Guy's equip-tutorial ask.
// ---------------------------------------------------------------------------

export const RING_LESSON_QUEST_ID = 'q_ps_mother_of_pearl';
export const RING_LESSON_ITEM_ID = 'mother_of_pearl';

export type RingLessonPhase = 'equip' | 'admire';

export interface RingLessonState {
  /** The pearl quest is handed in (the ring exists). */
  questDone: boolean;
  /** The ring sits in a bag slot. */
  inBags: boolean;
  /** The ring sits on a finger (either ring slot). */
  equipped: boolean;
  /** The character sheet has been opened since equipping (the lesson's end). */
  charSeen: boolean;
}

/** Which ring-lesson card is due, or null when the lesson is over (or has
 *  nothing to teach: the ring vanished to the bank or a vendor, their call). */
export function ringLessonPhase(s: RingLessonState): RingLessonPhase | null {
  if (!s.questDone) return null;
  if (s.equipped) return s.charSeen ? null : 'admire';
  return s.inBags ? 'equip' : null;
}

export interface RingCardPlan {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  params: readonly CoachParam[];
}

export function ringCardPlan(phase: RingLessonPhase, mode: BootcampInputMode): RingCardPlan {
  if (phase === 'equip') {
    const bodies: Record<BootcampInputMode, TranslationKey> = {
      keyboard: 'hudChrome.bootcamp.ringEquipBody',
      touch: 'hudChrome.bootcamp.ringEquipBodyTouch',
      pad: 'hudChrome.bootcamp.ringEquipBodyPad',
    };
    return {
      titleKey: 'hudChrome.bootcamp.ringEquipTitle',
      bodyKey: bodies[mode],
      params: mode === 'keyboard' ? ['bagsKey'] : [],
    };
  }
  const bodies: Record<BootcampInputMode, TranslationKey> = {
    keyboard: 'hudChrome.bootcamp.ringAdmireBody',
    touch: 'hudChrome.bootcamp.ringAdmireBodyTouch',
    pad: 'hudChrome.bootcamp.ringAdmireBodyPad',
  };
  return {
    titleKey: 'hudChrome.bootcamp.ringAdmireTitle',
    bodyKey: bodies[mode],
    params: mode === 'keyboard' ? ['charKey'] : [],
  };
}

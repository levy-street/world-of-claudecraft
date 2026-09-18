// Pure, host-agnostic models for the tutorial island's live ferry notes.
// The DOM consumer localizes these stable keys and speaker identities.

import type { TranslationKey } from './i18n';

/** The greeter NPC the dialog speaks as (the Eastbrook spawn's harbor guide,
 *  content/proving_shore.ts). The painter resolves her localized name and
 *  title through entity i18n off this id. */
const TUTORIAL_GREETER_NPC_ID = 'wayfarer_bryn';

/** The quest the golden guidance draws for. Once it is done the guidance has
 *  nothing left to render, so the homecoming stops offering the choice. */
const WOLVES_QUEST_ID = 'q_wolves';

/** The shared speaker/body/button model for the live ferry notes. */
export interface TutorialGreetingNote {
  speakerNpcId: string;
  bodyKey: TranslationKey;
  /** Further paragraphs after the body, each its own localized key. */
  extraBodyKeys?: readonly TranslationKey[];
  closeKey: TranslationKey;
  guidanceChoice?: boolean;
}

/** The town-bell homecoming while Wolves at the Door is still ahead of the
 *  character: the guidance choice, then the return-bell note (the ride may
 *  have been a misclick). Offered on every such crossing, so a changed mind
 *  is one ride away and a browser that cannot persist settings still asks. */
export function buildFerryBellHomeNote(): TutorialGreetingNote {
  return {
    speakerNpcId: TUTORIAL_GREETER_NPC_ID,
    bodyKey: 'hudChrome.tutorialGreeting.eastbrookGuidanceNote',
    extraBodyKeys: ['hudChrome.tutorialGreeting.bellHomeNote'],
    closeKey: 'hudChrome.tutorialGreeting.noteClose',
    guidanceChoice: true,
  };
}

/** The same homecoming once the quest is done: the return-bell note alone,
 *  which the HUD shows once per device (the pre-guidance one-shot). */
export function buildFerryBellReturnNote(): TutorialGreetingNote {
  return {
    speakerNpcId: TUTORIAL_GREETER_NPC_ID,
    bodyKey: 'hudChrome.tutorialGreeting.bellHomeNote',
    closeKey: 'hudChrome.tutorialGreeting.noteClose',
  };
}

/** Which homecoming a character gets, read off their own quest state. */
export function ferryBellHomeNoteFor(world: {
  questState(questId: string): string;
}): TutorialGreetingNote {
  return world.questState(WOLVES_QUEST_ID) === 'done'
    ? buildFerryBellReturnNote()
    : buildFerryBellHomeNote();
}

/** Ferryman Odo's island welcome: shown on a character's first arrival at the
 *  Proving Shore, directing the newcomer up the road to Maren. The gate is
 *  PER-CHARACTER, not per-device: the sim computes it from the quest log
 *  (interactions/ferry_bell.ts isFirstIslandVisit) and the HUD arm renders on
 *  that flag alone, so every new character is taught even on a browser that
 *  has seen it before. */
export function buildFerryIslandArrivalNote(): TutorialGreetingNote {
  return {
    speakerNpcId: 'ferryman_odo',
    bodyKey: 'hudChrome.tutorialGreeting.islandArrivalNote',
    closeKey: 'hudChrome.tutorialGreeting.noteClose',
  };
}

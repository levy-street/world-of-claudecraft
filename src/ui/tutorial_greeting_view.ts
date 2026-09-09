// Pure, host-agnostic models for the tutorial island's live ferry notes.
// The DOM consumer localizes these stable keys and speaker identities.

import type { TranslationKey } from './i18n';

/** The greeter NPC the dialog speaks as (the Eastbrook spawn's harbor guide,
 *  content/proving_shore.ts). The painter resolves her localized name and
 *  title through entity i18n off this id. */
const TUTORIAL_GREETER_NPC_ID = 'wayfarer_bryn';

/** The shared speaker/body/button model for the live ferry notes. */
export interface TutorialGreetingNote {
  speakerNpcId: string;
  bodyKey: TranslationKey;
  closeKey: TranslationKey;
}

export function buildFerryBellHomeNote(): TutorialGreetingNote {
  return {
    speakerNpcId: TUTORIAL_GREETER_NPC_ID,
    bodyKey: 'hudChrome.tutorialGreeting.bellHomeNote',
    closeKey: 'hudChrome.tutorialGreeting.noteClose',
  };
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

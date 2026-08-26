// Pure, host-agnostic model for the spawn greeting dialog (tutorial island):
// the one-time choice fired by the `tutorialGreeting` SimEvent when a fresh
// character first stands in the world. The sim guarantees once-ever (a
// persisted one-shot flag, sim/tutorial/greeting.ts), so this model owns one
// decision only: which body copy the greeter speaks, first-character welcome
// vs returning-player refresher, off the event's server-recomputed account
// fact. The two buttons (take the tutorial / skip it) are static.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md;
// reference profession_tutorial_view.ts): DOM-free, emitting stable
// TranslationKey identifiers plus the greeter's npc id for the painter to
// localize. Registered in the UI_PURE_CORES allowlist
// (tests/architecture.test.ts); driven directly by
// tests/tutorial_greeting_view.test.ts.

import type { TranslationKey } from './i18n';

/** The greeter NPC the dialog speaks as (the Eastbrook spawn's harbor guide,
 *  content/proving_shore.ts). The painter resolves her localized name and
 *  title through entity i18n off this id. */
export const TUTORIAL_GREETER_NPC_ID = 'wayfarer_bryn';

export interface TutorialGreetingModel {
  speakerNpcId: string;
  bodyKey: TranslationKey;
  playKey: TranslationKey;
  skipKey: TranslationKey;
}

/** Build the greeting model: first-character welcome vs refresher copy. */
export function buildTutorialGreetingModel(firstCharacter: boolean): TutorialGreetingModel {
  return {
    speakerNpcId: TUTORIAL_GREETER_NPC_ID,
    bodyKey: firstCharacter
      ? 'hudChrome.tutorialGreeting.bodyFirst'
      : 'hudChrome.tutorialGreeting.bodyRefresher',
    playKey: 'hudChrome.tutorialGreeting.play',
    skipKey: 'hudChrome.tutorialGreeting.skip',
  };
}

/** The single-button note variant of the greeting dialog: the same speaker
 *  and chrome, one closing affordance. Two notes exist: the decline
 *  follow-up (skip pressed: the bell still stands) and the first bell
 *  homecoming (the town's twin bell pointed out after a possible misclick). */
export interface TutorialGreetingNote {
  speakerNpcId: string;
  bodyKey: TranslationKey;
  closeKey: TranslationKey;
}

export function buildTutorialDeclineNote(): TutorialGreetingNote {
  return {
    speakerNpcId: TUTORIAL_GREETER_NPC_ID,
    bodyKey: 'hudChrome.tutorialGreeting.declineNote',
    closeKey: 'hudChrome.tutorialGreeting.noteClose',
  };
}

export function buildFerryBellHomeNote(): TutorialGreetingNote {
  return {
    speakerNpcId: TUTORIAL_GREETER_NPC_ID,
    bodyKey: 'hudChrome.tutorialGreeting.bellHomeNote',
    closeKey: 'hudChrome.tutorialGreeting.noteClose',
  };
}

/** Ferryman Odo's island welcome: shown once per device on the first arrival
 *  at the Proving Shore, directing the newcomer up the road to Maren. */
export function buildFerryIslandArrivalNote(): TutorialGreetingNote {
  return {
    speakerNpcId: 'ferryman_odo',
    bodyKey: 'hudChrome.tutorialGreeting.islandArrivalNote',
    closeKey: 'hudChrome.tutorialGreeting.noteClose',
  };
}

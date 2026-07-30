// Tutorial body-copy selection — pure, host-agnostic, unit-tested.
//
// The new-adventurer tutorial (tutorial.ts) ships two phrasings of the steps
// that reference how you control the game: the default keyboard/mouse copy
// (hud.tutorial.*Body, with "W/A/S/D" / "press {interactKey}" splice points) and
// a touch variant (hudChrome.tutorial.*Touch) for the on-screen-stick interface.
// This module owns the single decision of which body string (and which of its
// interpolation params) a step uses, so the DOM-bound overlay stays a thin
// consumer and the swap logic is testable without a browser.

import type { TranslationKey } from './i18n';
import type { TutorialStep } from './tutorial';

// The interpolation values a body string may splice in. Only the keyboard copy
// references the keyboard binds; the touch copy needs none of them except the
// player name on the closing card. targetKey is only ever used by the slay-step
// combat hint below.
export type TutorialParam = 'moveKeys' | 'interactKey' | 'questKey' | 'name' | 'targetKey';

export interface TutorialBodyPlan {
  bodyKey: TranslationKey;
  params: TutorialParam[];
}

const KEYBOARD: Record<TutorialStep, TutorialBodyPlan> = {
  move: { bodyKey: 'hud.tutorial.moveBody', params: ['moveKeys'] },
  seek: { bodyKey: 'hud.tutorial.seekBody', params: [] },
  talk: { bodyKey: 'hud.tutorial.talkBody', params: ['interactKey'] },
  slay: { bodyKey: 'hud.tutorial.slayBody', params: [] },
  return: { bodyKey: 'hud.tutorial.returnBody', params: ['interactKey'] },
  done: { bodyKey: 'hud.tutorial.doneBody', params: ['name', 'questKey'] },
};

// Only the steps whose copy names a control differ on touch. seek/slay describe
// the world (a marker to follow, wolves to hunt) and read identically, so they
// fall through to the shared keyboard entry.
const TOUCH: Partial<Record<TutorialStep, TutorialBodyPlan>> = {
  move: { bodyKey: 'hudChrome.tutorial.moveBodyTouch', params: [] },
  talk: { bodyKey: 'hudChrome.tutorial.talkBodyTouch', params: [] },
  return: { bodyKey: 'hudChrome.tutorial.returnBodyTouch', params: [] },
  done: { bodyKey: 'hudChrome.tutorial.doneBodyTouch', params: ['name'] },
};

// Resolve the body string + its params for a step, given whether the on-screen
// touch interface is active.
export function tutorialBodyPlan(step: TutorialStep, touch: boolean): TutorialBodyPlan {
  return (touch && TOUCH[step]) || KEYBOARD[step];
}

// The slay step's body (hud.tutorial.slayBody, above) describes the OBJECTIVE
// (hunt the wolves) but never says how to engage one, which playtesters found
// confusing on a first character. This appends a short combat hint naming the
// actual bound target key (Tab by default) or a click on keyboard, and a tap on
// touch, so a brand-new player learns targeting the first time they need it
// rather than discovering it by accident. Only the slay step gets this hint;
// every other step's objective (move, talk, turn in) is self-explanatory once
// its body names the control.
export function tutorialSlayHintPlan(touch: boolean): TutorialBodyPlan {
  return touch
    ? { bodyKey: 'hudChrome.tutorial.slayTargetHintTouch', params: [] }
    : { bodyKey: 'hudChrome.tutorial.slayTargetHint', params: ['targetKey'] };
}

// True when a step's rendered card actually changes between the touch and
// keyboard interfaces. move/talk/return/done have touch variants; seek reads
// identically (it describes a marker to follow), so a mode toggle on it is a
// no-op for the rendered text. slay's own body is mode-agnostic (it just names
// the objective), but its rendered card also appends the slayHintPlan hint,
// which DOES differ by mode (targetKey vs a tap), so slay counts as
// mode-dependent through the hint even though its body key does not change.
export function tutorialStepDiffersByTouch(step: TutorialStep): boolean {
  if (tutorialBodyPlan(step, true).bodyKey !== tutorialBodyPlan(step, false).bodyKey) return true;
  if (step === 'slay') {
    return tutorialSlayHintPlan(true).bodyKey !== tutorialSlayHintPlan(false).bodyKey;
  }
  return false;
}

// Whether the overlay must rebuild its card. True on a step change (including the
// first engage from a null step), and also when the interface mode flips while a
// step whose copy depends on the mode is showing: touch and keyboard pick
// different control copy, so a card left open across an Interface Mode toggle
// would otherwise keep the stale "movement stick"/"press F" phrasing until the
// next step. A toggle on a mode-agnostic step (seek/slay) does not rebuild.
export function tutorialNeedsRerender(
  prevStep: TutorialStep | null,
  nextStep: TutorialStep,
  prevTouch: boolean,
  nextTouch: boolean,
): boolean {
  if (nextStep !== prevStep) return true;
  return nextTouch !== prevTouch && tutorialStepDiffersByTouch(nextStep);
}

// A "where to next" tip shown under the closing 'done' card: a body string that
// splices in the bound key for a keybinds.ts action, so a brand-new player has a
// concrete pointer (quest log / map / social) instead of being dropped into the
// open world with nothing after the last tutorial step. Identical on touch and
// keyboard: these name chrome windows (opened the same way on both interfaces),
// not movement/interact controls, so unlike the step bodies above they need no
// touch variant.
export interface TutorialNextTip {
  bodyKey: TranslationKey;
  keybindId: string;
}

export const TUTORIAL_NEXT_TIPS: TutorialNextTip[] = [
  { bodyKey: 'hudChrome.tutorial.nextTipQuestLog', keybindId: 'questlog' },
  { bodyKey: 'hudChrome.tutorial.nextTipMap', keybindId: 'map' },
  { bodyKey: 'hudChrome.tutorial.nextTipSocial', keybindId: 'social' },
];

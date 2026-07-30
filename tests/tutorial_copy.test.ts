import { describe, expect, it } from 'vitest';
import { BIND_ACTIONS } from '../src/game/keybinds';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import type { TutorialStep } from '../src/ui/tutorial';
import {
  TUTORIAL_NEXT_TIPS,
  tutorialBodyPlan,
  tutorialNeedsRerender,
  tutorialSlayHintPlan,
  tutorialStepDiffersByTouch,
} from '../src/ui/tutorial_copy';

describe('tutorialBodyPlan', () => {
  const STEPS: TutorialStep[] = ['move', 'seek', 'talk', 'slay', 'return', 'done'];

  it('uses the keyboard/mouse copy when touch is off', () => {
    for (const step of STEPS) {
      expect(tutorialBodyPlan(step, false).bodyKey).toBe(`hud.tutorial.${step}Body`);
    }
  });

  it('swaps in touch copy for control-referencing steps only', () => {
    // move/talk/return/done mention controls, so they get a touch variant.
    expect(tutorialBodyPlan('move', true).bodyKey).toBe('hudChrome.tutorial.moveBodyTouch');
    expect(tutorialBodyPlan('talk', true).bodyKey).toBe('hudChrome.tutorial.talkBodyTouch');
    expect(tutorialBodyPlan('return', true).bodyKey).toBe('hudChrome.tutorial.returnBodyTouch');
    expect(tutorialBodyPlan('done', true).bodyKey).toBe('hudChrome.tutorial.doneBodyTouch');
  });

  it('keeps the shared keyboard copy for steps that never mention controls', () => {
    // seek/slay describe the world, not the input device: identical on both.
    expect(tutorialBodyPlan('seek', true).bodyKey).toBe('hud.tutorial.seekBody');
    expect(tutorialBodyPlan('slay', true).bodyKey).toBe('hud.tutorial.slayBody');
  });

  it('drops keyboard-only params (moveKeys, interactKey, questKey) from touch copy', () => {
    expect(tutorialBodyPlan('move', true).params).toEqual([]);
    expect(tutorialBodyPlan('talk', true).params).toEqual([]);
    expect(tutorialBodyPlan('return', true).params).toEqual([]);
    // The done copy still personalizes with the player name on touch.
    expect(tutorialBodyPlan('done', true).params).toEqual(['name']);
  });

  it('keeps the interpolation params the keyboard copy needs', () => {
    expect(tutorialBodyPlan('move', false).params).toEqual(['moveKeys']);
    expect(tutorialBodyPlan('talk', false).params).toEqual(['interactKey']);
    expect(tutorialBodyPlan('return', false).params).toEqual(['interactKey']);
    expect(tutorialBodyPlan('done', false).params).toEqual(['name', 'questKey']);
  });
});

describe('tutorialNeedsRerender', () => {
  it('re-renders on the first engage (null to a step)', () => {
    expect(tutorialNeedsRerender(null, 'move', false, false)).toBe(true);
    expect(tutorialNeedsRerender(null, 'move', true, true)).toBe(true);
  });

  it('re-renders when the step advances, regardless of touch state', () => {
    expect(tutorialNeedsRerender('move', 'seek', false, false)).toBe(true);
    expect(tutorialNeedsRerender('talk', 'slay', true, true)).toBe(true);
    expect(tutorialNeedsRerender('move', 'seek', true, false)).toBe(true);
  });

  it('re-renders when Interface Mode is toggled mid-step on a step whose copy differs by mode', () => {
    // The control copy differs between touch and keyboard, so an open card must
    // rebuild when the mode changes even though the step is the same. slay's own
    // body never changes, but the rendered card also appends the slayHintPlan
    // hint (see tutorialStepDiffersByTouch), which does differ by mode.
    for (const step of ['move', 'talk', 'return', 'done', 'slay'] as const) {
      expect(tutorialNeedsRerender(step, step, false, true)).toBe(true);
      expect(tutorialNeedsRerender(step, step, true, false)).toBe(true);
    }
  });

  it('does not re-render on a mode toggle for the mode-agnostic seek step', () => {
    // seek reads identically on touch and keyboard, so a toggle is a no-op for
    // the rendered card.
    expect(tutorialNeedsRerender('seek', 'seek', false, true)).toBe(false);
    expect(tutorialNeedsRerender('seek', 'seek', true, false)).toBe(false);
  });

  it('does not re-render when neither the step nor the touch state changed', () => {
    expect(tutorialNeedsRerender('move', 'move', false, false)).toBe(false);
    expect(tutorialNeedsRerender('slay', 'slay', true, true)).toBe(false);
  });
});

describe('tutorialStepDiffersByTouch', () => {
  it('is true for the steps that have a touch-variant body, plus slay via its appended hint', () => {
    // slay's own body key never changes by mode, but its rendered card also
    // appends tutorialSlayHintPlan's hint, which does (targetKey vs a tap), so
    // slay counts as mode-dependent through the hint.
    for (const step of ['move', 'talk', 'return', 'done', 'slay'] as const) {
      expect(tutorialStepDiffersByTouch(step)).toBe(true);
    }
    expect(tutorialStepDiffersByTouch('seek')).toBe(false);
  });
});

describe('TUTORIAL_NEXT_TIPS', () => {
  it('points each tip at a real Interface keybind id', () => {
    // Cross-check against the live registry, not a literal copy of it: a
    // rename in keybinds.ts (or a typo mirrored into both places) would
    // otherwise slip through and silently render "Unbound" for every player.
    const registeredIds = BIND_ACTIONS.map((a) => a.id);
    expect(TUTORIAL_NEXT_TIPS.map((t) => t.keybindId)).toEqual(['questlog', 'map', 'social']);
    for (const tip of TUTORIAL_NEXT_TIPS) {
      expect(registeredIds).toContain(tip.keybindId);
    }
  });

  it('every tip body key resolves to a real English string with a {key} splice point', () => {
    for (const tip of TUTORIAL_NEXT_TIPS) {
      const [domain, ...rest] = tip.bodyKey.split('.');
      expect(domain).toBe('hudChrome');
      const leaf = rest.reduce<unknown>(
        (obj, k) => (obj as Record<string, unknown>)?.[k],
        hudChromeStrings,
      );
      expect(typeof leaf).toBe('string');
      expect(leaf as string).toContain('{key}');
    }
  });
});

describe('touch tutorial copy is control-accurate', () => {
  // Guards the actual English strings (not just which key is chosen): the touch
  // copy must never reference a keyboard, the mouse, a fixed stick side, or a
  // keyboard-only interpolation param. (hud.tutorial.*Body keep those; the touch
  // variants drop them.)
  const FORBIDDEN =
    /\bW\/?A\/?S\/?D\b|\bWASD\b|\bmouse\b|\bkeyboard\b|\b(left|right) stick\b|\{moveKeys\}|\{interactKey\}|\{questKey\}/i;
  const touch = hudChromeStrings.tutorial as Record<string, string>;

  for (const [key, text] of Object.entries(touch)) {
    it(`${key} references touch controls only`, () => {
      expect(text).not.toMatch(FORBIDDEN);
    });
  }
});

describe('tutorialSlayHintPlan', () => {
  // The slay step's objective body (hud.tutorial.slayBody) never explains HOW to
  // engage a wolf; this hint is appended to teach targeting the first time a
  // brand-new player needs it (playtester feedback: the wolf tutorial step never
  // says how to target a wolf).
  it('points at the target-key hint and needs the bound key on keyboard', () => {
    const plan = tutorialSlayHintPlan(false);
    expect(plan.bodyKey).toBe('hudChrome.tutorial.slayTargetHint');
    expect(plan.params).toEqual(['targetKey']);
  });

  it('points at the tap-only hint and needs no params on touch', () => {
    const plan = tutorialSlayHintPlan(true);
    expect(plan.bodyKey).toBe('hudChrome.tutorial.slayTargetHintTouch');
    expect(plan.params).toEqual([]);
  });

  it('the keyboard hint interpolates {targetKey} and never mentions Tab literally', () => {
    // Naming the literal default ("Tab") in the string would go stale the moment
    // a player rebinds Target Nearest Enemy; the {targetKey} splice always reads
    // the live bind (see renderPanel in tutorial.ts).
    const en = hudChromeStrings.tutorial.slayTargetHint;
    expect(en).toMatch(/\{targetKey\}/);
    expect(en).not.toMatch(/\bTab\b/);
  });

  it('the touch hint never references a keyboard, mouse, or {targetKey}', () => {
    const en = hudChromeStrings.tutorial.slayTargetHintTouch;
    expect(en).not.toMatch(/\bkeyboard\b|\bmouse\b|\{targetKey\}/i);
  });
});

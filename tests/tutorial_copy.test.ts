import { describe, expect, it } from 'vitest';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import type { TutorialStep } from '../src/ui/tutorial';
import {
  tutorialBodyPlan,
  tutorialNeedsRerender,
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
    // rebuild when the mode changes even though the step is the same.
    for (const step of ['move', 'talk', 'return', 'done'] as const) {
      expect(tutorialNeedsRerender(step, step, false, true)).toBe(true);
      expect(tutorialNeedsRerender(step, step, true, false)).toBe(true);
    }
  });

  it('does not re-render on a mode toggle for mode-agnostic steps (seek/slay)', () => {
    // seek/slay read identically on touch and keyboard, so a toggle is a no-op for
    // the rendered card (the slay kill counter still refreshes on its own path).
    for (const step of ['seek', 'slay'] as const) {
      expect(tutorialNeedsRerender(step, step, false, true)).toBe(false);
      expect(tutorialNeedsRerender(step, step, true, false)).toBe(false);
    }
  });

  it('does not re-render when neither the step nor the touch state changed', () => {
    expect(tutorialNeedsRerender('move', 'move', false, false)).toBe(false);
    expect(tutorialNeedsRerender('slay', 'slay', true, true)).toBe(false);
  });
});

describe('tutorialStepDiffersByTouch', () => {
  it('is true only for the steps that have a touch-variant body', () => {
    for (const step of ['move', 'talk', 'return', 'done'] as const) {
      expect(tutorialStepDiffersByTouch(step)).toBe(true);
    }
    for (const step of ['seek', 'slay'] as const) {
      expect(tutorialStepDiffersByTouch(step)).toBe(false);
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

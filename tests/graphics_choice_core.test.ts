// The shared graphics-choice policy behind the landing Graphics select and the first-login
// graphics prompt (src/ui/graphics_choice_core.ts): what the prompt offers, how a raw value
// parses, what each choice persists, and when the prompt asks.
import { describe, expect, it } from 'vitest';
import { SETTING_RANGES } from '../src/game/settings';
import {
  currentGraphicsChoice,
  GRAPHICS_CHOICE_AUTO,
  graphicsChoiceOptions,
  graphicsChoicePatch,
  parseGraphicsChoice,
  shouldPromptGraphicsChoice,
} from '../src/ui/graphics_choice_core';

const RANGE = SETTING_RANGES.graphicsPreset;
const AUTO_PRESET = SETTING_RANGES.graphicsPreset.def;

describe('graphicsChoiceOptions', () => {
  it('offers Auto first, then the fixed Low to Ultra ladder on a desktop', () => {
    expect(graphicsChoiceOptions({ touchDevice: false }).map((o) => o.choice)).toEqual([
      GRAPHICS_CHOICE_AUTO,
      1,
      2,
      3,
      4,
    ]);
  });

  it('caps a touch device at Medium (High and Ultra stay an in-world Options choice)', () => {
    expect(graphicsChoiceOptions({ touchDevice: true }).map((o) => o.choice)).toEqual([
      GRAPHICS_CHOICE_AUTO,
      1,
      2,
    ]);
  });

  it('never offers the expert Advanced (5) or Insane (6) presets', () => {
    const choices = graphicsChoiceOptions({ touchDevice: false }).map((o) => o.choice);
    expect(choices).not.toContain(5);
    expect(choices).not.toContain(6);
  });

  it('gives every option its own title and description key', () => {
    const options = graphicsChoiceOptions({ touchDevice: false });
    expect(new Set(options.map((o) => o.titleKey)).size).toBe(options.length);
    expect(new Set(options.map((o) => o.descKey)).size).toBe(options.length);
    expect(options[0].descKey).toBe('graphicsPrompt.autoDesc');
  });
});

describe('parseGraphicsChoice', () => {
  it('reads auto, and every in-range integer preset as itself', () => {
    expect(parseGraphicsChoice('auto', RANGE)).toBe(GRAPHICS_CHOICE_AUTO);
    for (let p = RANGE.min; p <= RANGE.max; p++)
      expect(parseGraphicsChoice(String(p), RANGE)).toBe(p);
  });

  it('falls back to auto for a missing, malformed, fractional, or out-of-range value', () => {
    for (const raw of [null, '', 'ultra', '2.5', '0', String(RANGE.max + 1), '-1']) {
      expect(parseGraphicsChoice(raw, RANGE)).toBe(GRAPHICS_CHOICE_AUTO);
    }
  });
});

describe('currentGraphicsChoice', () => {
  it('shows the stored preset once one is pinned, and auto while detection still owns it', () => {
    expect(currentGraphicsChoice(true, 3)).toBe(3);
    expect(currentGraphicsChoice(false, 3)).toBe(GRAPHICS_CHOICE_AUTO);
  });
});

describe('graphicsChoicePatch', () => {
  it('auto resets the preset to its default and clears the detection marker', () => {
    expect(graphicsChoicePatch(GRAPHICS_CHOICE_AUTO, AUTO_PRESET)).toEqual({
      graphicsPreset: AUTO_PRESET,
      graphicsDefaultApplied: false,
    });
  });

  it('auto leaves the prompt marker untouched (the landing select must not re-open the prompt)', () => {
    expect('graphicsPromptAnswered' in graphicsChoicePatch(GRAPHICS_CHOICE_AUTO, AUTO_PRESET)).toBe(
      false,
    );
  });

  it('an explicit preset pins it against detection and answers the prompt', () => {
    expect(graphicsChoicePatch(1, AUTO_PRESET)).toEqual({
      graphicsPreset: 1,
      graphicsDefaultApplied: true,
      graphicsPromptAnswered: true,
    });
    expect(graphicsChoicePatch(4, AUTO_PRESET).graphicsPreset).toBe(4);
  });

  it('round-trips through currentGraphicsChoice', () => {
    for (const choice of [GRAPHICS_CHOICE_AUTO, 1, 2, 3, 4, 5] as const) {
      const patch = graphicsChoicePatch(choice, AUTO_PRESET);
      expect(currentGraphicsChoice(patch.graphicsDefaultApplied, patch.graphicsPreset)).toBe(
        choice,
      );
    }
  });
});

describe('shouldPromptGraphicsChoice', () => {
  const base = { answered: false, tierForcedByUrl: false, automated: false };

  it('asks a first-time player', () => {
    expect(shouldPromptGraphicsChoice(base)).toBe(true);
  });

  it('never asks again once answered', () => {
    expect(shouldPromptGraphicsChoice({ ...base, answered: true })).toBe(false);
  });

  it('skips when the URL forces a render tier', () => {
    expect(shouldPromptGraphicsChoice({ ...base, tierForcedByUrl: true })).toBe(false);
  });

  it('skips an automated WebDriver session', () => {
    expect(shouldPromptGraphicsChoice({ ...base, automated: true })).toBe(false);
  });
});

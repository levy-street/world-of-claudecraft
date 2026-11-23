// The player's graphics-preset CHOICE, as the two pre-game surfaces that ask for it share it:
// the landing page's Graphics select and the first-login graphics prompt
// (graphics_choice_prompt.ts). Pure and DOM-free: what to offer, how a raw select value parses,
// what a choice persists, and whether the prompt should ask at all. The callers own their DOM and
// their Settings instance and write the returned patch in one Settings.patch().
//
// "Auto" is not a stored preset. It means "let the device decide": the preset returns to its
// default and the graphicsDefaultApplied marker clears, so main.ts's first-run probe
// (firstRunGraphicsPreset in render/gfx.ts) classifies the device on the next world entry. Any
// other choice is an explicit preset, pinned by setting the marker so detection never overrides it.

import type { TranslationKey } from './i18n';

export const GRAPHICS_CHOICE_AUTO = 'auto';

/** 'auto', or an explicit graphicsPreset value (1 low .. 6 insane, see SETTING_RANGES). */
export type GraphicsChoice = typeof GRAPHICS_CHOICE_AUTO | number;

/** The persisted fields a choice writes; a subset of GameSettings for Settings.patch(). */
export interface GraphicsChoicePatch {
  graphicsPreset: number;
  graphicsDefaultApplied: boolean;
  graphicsPromptAnswered?: boolean;
}

export interface GraphicsChoiceOption {
  choice: GraphicsChoice;
  titleKey: TranslationKey;
  descKey: TranslationKey;
}

/**
 * The first-login prompt's options, Auto first (the default). Only the fixed ladder a new player
 * can judge: the expert Advanced mix and the Insane showcase stay in Options, Graphics. A touch
 * device (phone, tablet, or the native mobile shell) is offered only Auto, Low, and Medium: device
 * detection starts every touch device at LOW because a first world-entry scene build at a higher
 * tier is what gets phone-class WebKit killed (resolveDefaultGraphicsPreset in render/gfx.ts), so
 * High and Ultra stay an Options choice made once the player is in the world.
 */
export function graphicsChoiceOptions(env: { touchDevice: boolean }): GraphicsChoiceOption[] {
  const options: GraphicsChoiceOption[] = [
    {
      choice: GRAPHICS_CHOICE_AUTO,
      titleKey: 'hud.options.graphicsPresetAuto',
      descKey: 'graphicsPrompt.autoDesc',
    },
    { choice: 1, titleKey: 'hud.options.graphicsPresetLow', descKey: 'graphicsPrompt.lowDesc' },
    {
      choice: 2,
      titleKey: 'hud.options.graphicsPresetMedium',
      descKey: 'graphicsPrompt.mediumDesc',
    },
  ];
  if (!env.touchDevice) {
    options.push(
      { choice: 3, titleKey: 'hud.options.graphicsPresetHigh', descKey: 'graphicsPrompt.highDesc' },
      {
        choice: 4,
        titleKey: 'hud.options.graphicsPresetUltra',
        descKey: 'graphicsPrompt.ultraDesc',
      },
    );
  }
  return options;
}

/** A raw select/radio value as a choice; anything out of range or malformed reads as Auto. */
export function parseGraphicsChoice(
  raw: string | null,
  range: { min: number; max: number },
): GraphicsChoice {
  if (raw === null || raw === GRAPHICS_CHOICE_AUTO) return GRAPHICS_CHOICE_AUTO;
  const preset = Number(raw);
  if (Number.isInteger(preset) && preset >= range.min && preset <= range.max) return preset;
  return GRAPHICS_CHOICE_AUTO;
}

/** The choice the stored settings currently express (the landing select's displayed value). */
export function currentGraphicsChoice(defaultApplied: boolean, preset: number): GraphicsChoice {
  return defaultApplied ? preset : GRAPHICS_CHOICE_AUTO;
}

/**
 * What a choice persists. `autoPreset` is the preset Auto resets to (SETTING_RANGES def). An
 * explicit preset also marks the first-login prompt answered: a player who already picked one on
 * the landing page is not asked again. Auto leaves that marker alone, so choosing Auto on the
 * landing page neither answers the prompt nor re-opens one already answered; the prompt sets it
 * itself for every answer, Auto included.
 */
export function graphicsChoicePatch(
  choice: GraphicsChoice,
  autoPreset: number,
): GraphicsChoicePatch {
  if (choice === GRAPHICS_CHOICE_AUTO) {
    return { graphicsPreset: autoPreset, graphicsDefaultApplied: false };
  }
  return { graphicsPreset: choice, graphicsDefaultApplied: true, graphicsPromptAnswered: true };
}

/**
 * Ask on world entry only until answered. Never when the URL already forces a render tier
 * (?gfx= / ?lowgfx wins over any stored preset, so the answer would not take effect), and never
 * in an automated (WebDriver) session: that is never a first-time player, and the E2E and
 * screenshot scripts drive world entry with no one to answer a modal.
 */
export function shouldPromptGraphicsChoice(state: {
  answered: boolean;
  tierForcedByUrl: boolean;
  automated: boolean;
}): boolean {
  return !state.answered && !state.tierForcedByUrl && !state.automated;
}

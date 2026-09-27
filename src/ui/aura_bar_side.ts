// Aura-row placement settings that are purely presentational: each one is a
// body class or a CSS var the stylesheet keys off, needing no DOM reparenting
// (unlike aurasOnPlayerFrame, which goes through src/ui/hud.ts). main.ts's
// applySetting applies them directly through these helpers. Pulled into its
// own module (not inlined in main.ts) so each has a real behavioral Vitest
// instead of a source-text pin on main.ts, which has no lightweight
// instantiation seam of its own.

/** The player frame's anchored buff row (aurasOnPlayerFrame) sits above the
 *  frame by default; auraBarBelowFrame is the player's own choice to flip it
 *  below instead (src/styles/hud.css keys off this exact class). */
export const AURA_BAR_BELOW_CLASS = 'auras-below-frame';

/** The target frame's aura strip (#tf-debuffs) sits above the frame by
 *  default, since the stock target seat is directly over the action bar;
 *  targetAurasBelowFrame is the player's own choice to hang it below the
 *  frame instead, the classic layout, for a frame they have moved elsewhere
 *  (src/styles/hud.css keys off this exact class). */
export const TARGET_AURAS_BELOW_CLASS = 'target-auras-below-frame';

/** Which body class each side setting owns. Keyed by the settings key so the
 *  applySetting switch can route both through one call. */
export const AURA_SIDE_CLASSES = {
  auraBarBelowFrame: AURA_BAR_BELOW_CLASS,
  targetAurasBelowFrame: TARGET_AURAS_BELOW_CLASS,
} as const;

export type AuraSideSetting = keyof typeof AURA_SIDE_CLASSES;

/** Narrowed to just the one DOMTokenList method used, so a Vitest can drive
 *  this against a hand-rolled fake classList (repo convention, no jsdom). */
export interface ClassTogglable {
  classList: { toggle(cls: string, force?: boolean): boolean };
}

export function applyAuraBarSide(
  body: ClassTogglable,
  setting: AuraSideSetting,
  below: boolean,
): void {
  body.classList.toggle(AURA_SIDE_CLASSES[setting], below);
}

/** Icon flow of the standalone buff/debuff rows (Frames Settings menu): the
 *  stock layout grows right-to-left from its anchor beside the minimap; 'row'
 *  flips a row to read left to right. CSS vars rather than classes so the
 *  stylesheet's aurasOnPlayerFrame override (a docked buff row always reads
 *  left to right) keeps winning by specificity. */
export const AURA_DIRECTION_VARS = {
  buffsLeftToRight: '--buff-bar-direction',
  debuffsLeftToRight: '--debuff-bar-direction',
} as const;

export type AuraDirectionSetting = keyof typeof AURA_DIRECTION_VARS;

/** Narrowed to the one CSSStyleDeclaration method used. */
export interface PropertySettable {
  style: { setProperty(name: string, value: string): void };
}

export function applyAuraBarDirection(
  root: PropertySettable,
  setting: AuraDirectionSetting,
  leftToRight: boolean,
): void {
  root.style.setProperty(AURA_DIRECTION_VARS[setting], leftToRight ? 'row' : 'row-reverse');
}

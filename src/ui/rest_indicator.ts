// Pure derivation of the player unit-frame "resting" indicator state. Kept
// UI-framework-free (no DOM) so the label precedence can be snapshot tested
// directly, mirroring xp_bar.ts. Reads only the three booleans the sim already
// exposes on the player Entity (and which ride along in online snapshots), so
// the indicator works identically offline and online with zero sim/net change.

export interface RestStateInput {
  sitting: boolean;
  eating: boolean;
  drinking: boolean;
}

// The tooltip text is surfaced as a translation key (resolved by the HUD via
// t()) rather than baked English, so this module stays DOM/i18n-free. '' means
// "no indicator / no tooltip". The eating/drinking keys reuse the existing
// hud.core.* entries; the bare-sit case uses the hudChrome.rest.resting key.
export type RestLabelKey =
  | ''
  | 'hud.core.eatingDrinking'
  | 'hud.core.eating'
  | 'hud.core.drinking'
  | 'hudChrome.rest.resting';

export interface RestView {
  resting: boolean; // any seated state → show the indicator
  labelKey: RestLabelKey; // i18n key for the tooltip / aria text ('' when not resting)
  glyph: string; // single-char marker shown on the portrait
}

// Label precedence: recovering (eating/drinking) is the more informative state,
// so it wins over a plain seat. Eating and drinking can run at once (separate
// slots); we surface the combined "Recovering" rather than picking one. A bare
// sit (no consumable) reads as classic "Resting".
export function restView(input: RestStateInput): RestView {
  const { sitting, eating, drinking } = input;
  if (eating && drinking) return { resting: true, labelKey: 'hud.core.eatingDrinking', glyph: 'z' };
  if (eating) return { resting: true, labelKey: 'hud.core.eating', glyph: 'z' };
  if (drinking) return { resting: true, labelKey: 'hud.core.drinking', glyph: 'z' };
  if (sitting) return { resting: true, labelKey: 'hudChrome.rest.resting', glyph: 'z' };
  return { resting: false, labelKey: '', glyph: 'z' };
}

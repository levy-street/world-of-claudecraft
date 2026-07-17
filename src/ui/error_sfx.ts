// Maps raw (pre-localization) sim error text to a distinct error cue, so
// "ability still on cooldown" / "out of mana" / "target out of range" don't
// all play the same generic bloop. Every text NOT listed here still gets the
// generic ui_error fallback: this only carves out the handful of failures a
// player triggers constantly during normal play (spamming an ability on the
// GCD, pulling with no mana, clicking a target that walked out of range),
// where one interchangeable sound is the most noticeable and the most
// annoying. See docs/design/sound_effects.md.
const COOLDOWN_TEXT = new Set(['That ability is not ready yet.']);

const RESOURCE_TEXT = new Set([
  'Not enough rage!',
  'Not enough energy!',
  'Not enough mana!',
  'Not enough health.',
]);

const RANGE_TEXT = new Set([
  'Out of range.',
  'Too close!',
  'You have no target.',
  'You must be facing your target.',
  'Line of sight.',
  'You must be behind your target.',
]);

export type ErrorSfxKey = 'ui_error' | 'ui_error_cooldown' | 'ui_error_resource' | 'ui_error_range';

/** Resolve the UI error cue for raw sim error text. Unrecognized text (the
 *  large majority of distinct error strings) falls back to the generic
 *  ui_error buzz, same as before this cue was split out. */
export function errorSfxKey(text: string): ErrorSfxKey {
  if (COOLDOWN_TEXT.has(text)) return 'ui_error_cooldown';
  if (RESOURCE_TEXT.has(text)) return 'ui_error_resource';
  if (RANGE_TEXT.has(text)) return 'ui_error_range';
  return 'ui_error';
}

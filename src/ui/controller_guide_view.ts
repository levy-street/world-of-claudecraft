// Pure, DOM/i18n-free core for the controller onboarding overlay. Maps the live
// gamepad button->action layout into an ordered list of {glyph, action} rows the
// thin painter (controller_guide.ts) renders. Glyph + action-label resolution is
// injected so this stays a deterministic transform, unit-testable without a real
// controller (mirrors the pure-core split of the other HUD windows).
//
// Host-agnostic: it imports nothing from game/ (the architecture pure-core guard
// forbids it), so `kind` is a pass-through generic the painter binds to the real
// GamepadKind, and the unbound sentinel is mirrored locally.

// Mirrors GAMEPAD_NONE ('none') from game/gamepad_map. Kept as a local literal so
// this core stays free of any game/ import; the value is a stable protocol token.
const UNBOUND = 'none';

export interface ControllerGuideRow {
  /** Hardware glyph for the physical button (e.g. "A", "Cross", "D-pad up"). */
  glyph: string;
  /** Localized name of the action bound to that button. */
  action: string;
}

export interface ControllerGuideModel {
  buttons: ControllerGuideRow[];
}

export interface ControllerGuideDeps<K> {
  /** Physical glyph for a button on the detected pad brand (gamepadButtonLabel). */
  glyph(button: number, kind: K): string;
  /** Localized display name for a bound action id (slotN / target / interact / ...). */
  actionLabel(actionId: string): string;
}

/**
 * Build the guide's button rows from the current bindings. Entries are taken in
 * their given order (the panel's display order); an unbound button ('none' or
 * empty) is skipped so the overlay only lists buttons that actually do something.
 * Pure: all glyph/label lookups come from `deps`.
 */
export function controllerGuideModel<K>(
  entries: readonly { button: number; action: string }[],
  kind: K,
  deps: ControllerGuideDeps<K>,
): ControllerGuideModel {
  const buttons: ControllerGuideRow[] = [];
  for (const { button, action } of entries) {
    if (!action || action === UNBOUND) continue;
    buttons.push({ glyph: deps.glyph(button, kind), action: deps.actionLabel(action) });
  }
  return { buttons };
}

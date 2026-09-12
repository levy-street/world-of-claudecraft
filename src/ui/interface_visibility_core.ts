// The Hide Interface toggle (Alt+Z by default, keybinds.ts `hideInterface`):
// one flag that decides whether the whole HUD is drawn, so a player can take a
// clean screenshot or video of the world. A pure core (tests/architecture.test.ts
// UI_PURE_CORES): it owns the state and the key routing, and reports each
// change to one listener; the painter (interface_visibility.ts) is
// where the body class lands. Deliberately NOT persisted: a hidden interface
// is a moment, never a setting, so every fresh session starts with it shown.
//
// Escape restores the interface before it does anything else (main.ts), so a
// player who forgets the bind can always get the HUD back with the one key that
// is never rebindable.

/** The body class the CSS hide set keys on (src/styles/hud.css). */
export const INTERFACE_HIDDEN_CLASS = 'interface-hidden';

/** The keybind action id (src/game/keybinds.ts) both dispatch arms route here. */
export const HIDE_INTERFACE_ACTION = 'hideInterface';

export class InterfaceVisibility {
  private hiddenState = false;

  constructor(private readonly onChange: (hidden: boolean) => void) {}

  get hidden(): boolean {
    return this.hiddenState;
  }

  /** Flip the interface; returns the new hidden state. */
  toggle(): boolean {
    this.set(!this.hiddenState);
    return this.hiddenState;
  }

  /** Bring the interface back. Returns true when it WAS hidden (the caller
   *  consumed the press), false when there was nothing to restore. */
  show(): boolean {
    if (!this.hiddenState) return false;
    this.set(false);
    return true;
  }

  private set(hidden: boolean): void {
    if (hidden === this.hiddenState) return;
    this.hiddenState = hidden;
    this.onChange(hidden);
  }
}

/** Shared keyboard + controller routing: true when `action` was the hide
 *  interface bind (and the toggle ran), false for every other action. */
export function dispatchInterfaceVisibilityAction(
  action: string,
  visibility: InterfaceVisibility,
): boolean {
  if (action !== HIDE_INTERFACE_ACTION) return false;
  visibility.toggle();
  return true;
}

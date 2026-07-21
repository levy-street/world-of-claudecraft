// A separate, remappable gamepad button layout, deliberately NOT folded into
// the keyboard Keybinds map (gamepad button indices and KeyboardEvent.codes are
// different input spaces, and merging them would complicate Keybinds' one-code-
// per-action uniqueness sweep). Persists to its own localStorage key. Pure aside
// from localStorage (matching Keybinds/Settings), so the bind/clear/reset logic
// is testable.
import {
  DEFAULT_GAMEPAD_BINDINGS,
  BINDABLE_BUTTONS,
  GAMEPAD_NONE,
  type GamepadActionId,
} from './gamepad_map';

const STORE_KEY = 'woc_gamepad';
const BINDABLE = new Set(BINDABLE_BUTTONS);

export class GamepadBindings {
  // buttonIndex -> action id
  private map = new Map<number, GamepadActionId>();

  constructor() {
    this.load();
  }

  private load(): void {
    this.map = new Map(Object.entries(DEFAULT_GAMEPAD_BINDINGS).map(([k, v]) => [Number(k), v]));
    let stored: unknown = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); } catch { /* corrupt */ }
    if (stored && typeof stored === 'object') {
      for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
        const idx = Number(k);
        if (BINDABLE.has(idx) && typeof v === 'string') this.map.set(idx, v);
      }
    }
  }

  private save(): void {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.map) obj[k] = v;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch { /* storage unavailable */ }
  }

  /** Action bound to a button, or 'none' if unbound. */
  actionFor(buttonIndex: number): GamepadActionId {
    return this.map.get(buttonIndex) ?? GAMEPAD_NONE;
  }

  /** Rebind a button (or clear it with 'none'); ignores non-bindable indices.
   *  Unlike the keyboard Keybinds map there is no one-action-per-button uniqueness
   *  sweep: a pad may point several buttons at the same action (duplicates allowed
   *  by design, e.g. both bumpers on one slot). */
  bind(buttonIndex: number, action: GamepadActionId): void {
    if (!BINDABLE.has(buttonIndex)) return;
    if (action === GAMEPAD_NONE) this.map.delete(buttonIndex);
    else this.map.set(buttonIndex, action);
    this.save();
  }

  reset(): void {
    this.map = new Map(Object.entries(DEFAULT_GAMEPAD_BINDINGS).map(([k, v]) => [Number(k), v]));
    this.save();
  }

  /** Snapshot for the options UI: every bindable button with its current action. */
  entries(): { button: number; action: GamepadActionId }[] {
    return BINDABLE_BUTTONS.map((button) => ({ button, action: this.actionFor(button) }));
  }
}

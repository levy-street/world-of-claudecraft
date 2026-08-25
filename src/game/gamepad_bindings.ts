// A separate, remappable gamepad button layout, deliberately NOT folded into
// the keyboard Keybinds map (gamepad button indices and KeyboardEvent.codes are
// different input spaces, and merging them would complicate Keybinds' one-code-
// per-action uniqueness sweep). Persists to its own localStorage key. Pure aside
// from localStorage (matching Keybinds/Settings), so the bind/clear/reset logic
// is testable.
import {
  BINDABLE_BUTTONS,
  DEFAULT_GAMEPAD_BINDINGS,
  GAMEPAD_CYCLE_HUD,
  GAMEPAD_NONE,
  type GamepadActionId,
  type GamepadKind,
  GP,
  gamepadButtonLabel,
} from './gamepad_map';
import { parseStoredJson } from './local_storage_json';

const STORE_KEY = 'woc_gamepad';
const BINDABLE = new Set(BINDABLE_BUTTONS);

export interface GamepadBindingEntry {
  button: number;
  action: GamepadActionId;
}

/** Resolve a displayed hardware glyph from the public bindings snapshot used
 *  by UI seams. The snapshot is button-sorted, so duplicate actions choose the
 *  same first physical button as GamepadBindings.labelForAction. */
export function labelForGamepadAction(
  entries: readonly GamepadBindingEntry[],
  action: GamepadActionId,
  kind: GamepadKind,
): string | null {
  const entry = entries.find((candidate) => candidate.action === action);
  return entry ? gamepadButtonLabel(entry.button, kind) : null;
}

/** Resolve the button that selects a hostile target. Explicit remaps win; when
 *  none exists, the manager's bare d-pad target cycle is available on the first
 *  horizontal direction whose binding would otherwise do nothing. */
export function labelForGamepadTarget(
  entries: readonly GamepadBindingEntry[],
  kind: GamepadKind,
  crossHotbarEnabled = false,
): string | null {
  const explicit =
    labelForGamepadAction(entries, 'target', kind) ??
    labelForGamepadAction(entries, 'targetPrev', kind);
  if (explicit) return explicit;
  for (const button of [GP.DPAD_RIGHT, GP.DPAD_LEFT]) {
    const entry = entries.find((candidate) => candidate.button === button);
    if (
      entry?.action === GAMEPAD_NONE ||
      (crossHotbarEnabled && entry?.action.startsWith('slot'))
    ) {
      return gamepadButtonLabel(button, kind);
    }
  }
  return null;
}

export class GamepadBindings {
  // buttonIndex -> action id
  private map = new Map<number, GamepadActionId>();

  constructor() {
    this.load();
  }

  private load(): void {
    this.map = new Map(Object.entries(DEFAULT_GAMEPAD_BINDINGS).map(([k, v]) => [Number(k), v]));
    const stored = parseStoredJson(STORE_KEY);
    if (stored && typeof stored === 'object') {
      const saved = stored as Record<string, unknown>;
      for (const [k, v] of Object.entries(saved)) {
        const idx = Number(k);
        if (BINDABLE.has(idx) && typeof v === 'string') this.map.set(idx, v);
      }
      // The previous shipped defaults had no inventory route: Back walked the
      // whole interface, R3 duplicated friendly targeting, and LB carried a slot
      // that the default cross hotbar swallowed. Repair only that exact signature
      // so a player's deliberate remap is never mistaken for an old default.
      if (
        saved[GP.BACK] === GAMEPAD_CYCLE_HUD &&
        saved[GP.R3] === 'targetFriendly' &&
        saved[GP.LB] === 'slot2'
      ) {
        this.map.set(GP.BACK, 'bags');
        this.map.set(GP.R3, GAMEPAD_CYCLE_HUD);
        this.map.set(GP.LB, GAMEPAD_NONE);
        this.save();
      }
    }
  }

  private save(): void {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.map) obj[k] = v;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(obj));
    } catch {
      /* storage unavailable */
    }
  }

  /** Action bound to a button, or 'none' if unbound. */
  actionFor(buttonIndex: number): GamepadActionId {
    return this.map.get(buttonIndex) ?? GAMEPAD_NONE;
  }

  /** The printed glyph for the first physical button currently bound to an
   *  action. Uses the connected pad brand, so the same W3C button index reads
   *  A on Xbox, Cross on PlayStation, or B on Nintendo. */
  labelForAction(action: GamepadActionId, kind: GamepadKind): string | null {
    return labelForGamepadAction(this.entries(), action, kind);
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
  entries(): GamepadBindingEntry[] {
    return BINDABLE_BUTTONS.map((button) => ({ button, action: this.actionFor(button) }));
  }
}

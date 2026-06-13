// Player-rebindable action-bar hotkeys. The 12 action slots (slot 0 is the
// Attack / auto-attack toggle, slots 1-11 the ability bar) each map to a
// KeyboardEvent.code. Input dispatches a keypress to a slot via slotForCode;
// the HUD renders the per-slot label via keyLabel. Bindings persist globally
// (not per character) in localStorage. This module is pure — no DOM — so the
// conflict and persistence logic is unit-testable.

export const ACTION_SLOTS = 12; // bar slots 0..11
const STORE_KEY = 'woc_keybinds';

// slot 0..11 -> default code; matches the original hard-coded 1..0,-,= bar
const DEFAULT_CODES: string[] = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
  'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal',
];

// Core movement / camera / system keys that must keep working — binding an
// action onto these would break basic control (e.g. W would move AND cast),
// so the rebind UI refuses them.
const RESERVED = new Set<string>([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Tab', 'Escape', 'Enter', 'NumpadEnter',
]);

export function isReservedCode(code: string): boolean {
  return RESERVED.has(code);
}

// e.code -> short on-screen label (matches the keycap shown on the action bar)
export function keyLabel(code: string | null): string {
  if (!code) return '';
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return 'Num' + code.slice(6);
  const named: Record<string, string> = {
    Minus: '-', Equal: '=', Backquote: '`', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Space: 'Space', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*',
    NumpadDivide: 'Num/', NumpadDecimal: 'Num.', NumpadEnter: 'NumEnter',
  };
  return named[code] ?? code;
}

export class Keybinds {
  // index = slot, value = e.code, or null when the slot has no key
  private codes: (string | null)[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    let stored: unknown = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); } catch { /* corrupt */ }
    const seen = new Set<string>();
    this.codes = DEFAULT_CODES.map((def, i) => {
      const v = Array.isArray(stored) ? stored[i] : undefined;
      // accept a stored code only if it's a string and not already claimed by
      // an earlier slot; missing/invalid entries fall back to the default
      const code = v === null ? null : (typeof v === 'string' ? v : def);
      if (code !== null && seen.has(code)) return null;
      if (code !== null) seen.add(code);
      return code;
    });
  }

  private save(): void {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.codes)); } catch { /* storage unavailable */ }
  }

  /** Slot a keypress should trigger, or null if the code is unbound. */
  slotForCode(code: string): number | null {
    const i = this.codes.indexOf(code);
    return i === -1 ? null : i;
  }

  codeForSlot(slot: number): string | null {
    return this.codes[slot] ?? null;
  }

  label(slot: number): string {
    return keyLabel(this.codes[slot] ?? null);
  }

  /**
   * Bind a key to a slot. A reserved key is rejected (returns false, no
   * change). Binding a key already held by another slot clears it there
   * first (WoW-style), so a code is never on two slots.
   */
  bind(slot: number, code: string): boolean {
    if (slot < 0 || slot >= ACTION_SLOTS) return false;
    if (isReservedCode(code)) return false;
    const existing = this.codes.indexOf(code);
    if (existing !== -1 && existing !== slot) this.codes[existing] = null;
    this.codes[slot] = code;
    this.save();
    return true;
  }

  /** Clear a slot's binding (the action stays clickable, just no hotkey). */
  clear(slot: number): void {
    if (slot < 0 || slot >= ACTION_SLOTS) return;
    this.codes[slot] = null;
    this.save();
  }

  reset(): void {
    this.codes = DEFAULT_CODES.slice();
    this.save();
  }
}

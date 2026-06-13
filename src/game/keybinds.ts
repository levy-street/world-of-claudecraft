// Player-rebindable controls. Every bindable game action — movement, camera,
// targeting, interface windows, and the 12 action-bar slots — lives in one
// registry, and the Keybinds map holds up to two KeyboardEvent.codes per
// action (primary + secondary, e.g. W and ArrowUp both Move Forward). Input
// dispatches edge actions and polls held (movement) actions through this map;
// the HUD renders the rebind menu and action-bar keycaps from it. Bindings
// persist globally in localStorage. Pure (no DOM) so the conflict/persistence
// logic is unit-testable.
//
// Escape is deliberately NOT a bindable action: it always opens/closes the
// game menu, so it stays out of the registry and is refused by bind().

export type BindKind = 'held' | 'edge';

export interface BindAction {
  id: string;
  label: string;
  category: string;
  kind: BindKind;
  defaults: string[]; // 1 or 2 codes; index 0 = primary, 1 = secondary
}

export const ACTION_BAR_SLOTS = 12; // slot 0 is Attack, 1..11 the ability bar

const SLOT_DEFAULTS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
  'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];

export const BIND_ACTIONS: BindAction[] = [
  // Movement / camera — polled every frame (held)
  { id: 'forward', label: 'Move Forward', category: 'Movement', kind: 'held', defaults: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Move Backward', category: 'Movement', kind: 'held', defaults: ['KeyS', 'ArrowDown'] },
  { id: 'turnLeft', label: 'Turn Left', category: 'Movement', kind: 'held', defaults: ['KeyA', 'ArrowLeft'] },
  { id: 'turnRight', label: 'Turn Right', category: 'Movement', kind: 'held', defaults: ['KeyD', 'ArrowRight'] },
  { id: 'strafeLeft', label: 'Strafe Left', category: 'Movement', kind: 'held', defaults: ['KeyQ'] },
  { id: 'strafeRight', label: 'Strafe Right', category: 'Movement', kind: 'held', defaults: ['KeyE'] },
  { id: 'jump', label: 'Jump', category: 'Movement', kind: 'held', defaults: ['Space'] },
  { id: 'autorun', label: 'Toggle Autorun', category: 'Movement', kind: 'edge', defaults: ['KeyR'] },
  // Targeting / interaction
  { id: 'target', label: 'Target Nearest Enemy', category: 'Targeting', kind: 'edge', defaults: ['Tab'] },
  { id: 'interact', label: 'Interact / Loot', category: 'Targeting', kind: 'edge', defaults: ['KeyF'] },
  // Interface windows
  { id: 'char', label: 'Character', category: 'Interface', kind: 'edge', defaults: ['KeyC'] },
  { id: 'spellbook', label: 'Spellbook', category: 'Interface', kind: 'edge', defaults: ['KeyP'] },
  { id: 'questlog', label: 'Quest Log', category: 'Interface', kind: 'edge', defaults: ['KeyL'] },
  { id: 'map', label: 'World Map', category: 'Interface', kind: 'edge', defaults: ['KeyM'] },
  { id: 'bags', label: 'Bags', category: 'Interface', kind: 'edge', defaults: ['KeyB'] },
  { id: 'nameplates', label: 'Toggle Nameplates', category: 'Interface', kind: 'edge', defaults: ['KeyV'] },
  { id: 'meters', label: 'Damage Meters', category: 'Interface', kind: 'edge', defaults: ['KeyN'] },
  { id: 'chat', label: 'Open Chat', category: 'Interface', kind: 'edge', defaults: ['Enter', 'NumpadEnter'] },
  // Action bar (slot 0 = Attack)
  ...SLOT_DEFAULTS.map((code, i): BindAction => ({
    id: `slot${i}`,
    label: i === 0 ? 'Attack' : `Action Bar ${i + 1}`,
    category: 'Action Bar',
    kind: 'edge',
    defaults: [code],
  })),
];

const ACTION_BY_ID = new Map(BIND_ACTIONS.map((a) => [a.id, a]));
export const BIND_CATEGORIES = [...new Set(BIND_ACTIONS.map((a) => a.category))];
const STORE_KEY = 'woc_keybinds';
const SLOTS_PER_ACTION = 2; // primary + secondary

export function actionKind(id: string): BindKind | null {
  return ACTION_BY_ID.get(id)?.kind ?? null;
}

export function isReservedCode(code: string): boolean {
  return code === 'Escape'; // the game-menu key is never rebindable
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
    ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl',
    AltLeft: 'LAlt', AltRight: 'RAlt', CapsLock: 'Caps',
    NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*',
    NumpadDivide: 'Num/', NumpadDecimal: 'Num.', NumpadEnter: 'NumEnter',
  };
  return named[code] ?? code;
}

export class Keybinds {
  // actionId -> [primary, secondary] codes (either may be null)
  private map = new Map<string, (string | null)[]>();

  constructor() {
    this.load();
  }

  private defaults(): Map<string, (string | null)[]> {
    const m = new Map<string, (string | null)[]>();
    for (const a of BIND_ACTIONS) {
      m.set(a.id, [a.defaults[0] ?? null, a.defaults[1] ?? null]);
    }
    return m;
  }

  private load(): void {
    this.map = this.defaults();
    let stored: unknown = null;
    try { stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); } catch { /* corrupt */ }
    if (!stored || typeof stored !== 'object') return;
    // Apply stored codes over the defaults, but only for known actions and
    // never letting one code land on two actions (first writer keeps it).
    const claimed = new Set<string>();
    for (const a of BIND_ACTIONS) {
      const entry = (stored as Record<string, unknown>)[a.id];
      const slots: (string | null)[] = [null, null];
      for (let i = 0; i < SLOTS_PER_ACTION; i++) {
        const v = Array.isArray(entry) ? entry[i] : undefined;
        if (typeof v === 'string' && !claimed.has(v) && !isReservedCode(v)) {
          slots[i] = v;
          claimed.add(v);
        } else {
          slots[i] = null;
        }
      }
      this.map.set(a.id, slots);
    }
  }

  private save(): void {
    const obj: Record<string, (string | null)[]> = {};
    for (const [id, codes] of this.map) obj[id] = codes;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch { /* storage unavailable */ }
  }

  /** The action a keypress should trigger, or null if the code is unbound. */
  actionForCode(code: string): string | null {
    for (const [id, codes] of this.map) {
      if (codes.includes(code)) return id;
    }
    return null;
  }

  /** Non-null codes bound to an action (for held-key polling). */
  codesForAction(id: string): string[] {
    return (this.map.get(id) ?? []).filter((c): c is string => c !== null);
  }

  codeAt(id: string, index: number): string | null {
    return this.map.get(id)?.[index] ?? null;
  }

  labelAt(id: string, index: number): string {
    return keyLabel(this.codeAt(id, index));
  }

  /** Primary (or, if unset, secondary) label — used for action-bar keycaps. */
  primaryLabel(id: string): string {
    const codes = this.map.get(id) ?? [];
    return keyLabel(codes[0] ?? codes[1] ?? null);
  }

  /**
   * Bind a code to (action, index). Reserved keys are refused (returns false).
   * The code is first removed from wherever else it lives so it is never on
   * two actions at once (WoW-style).
   */
  bind(id: string, index: number, code: string): boolean {
    const codes = this.map.get(id);
    if (!codes || index < 0 || index >= SLOTS_PER_ACTION) return false;
    if (isReservedCode(code)) return false;
    for (const [otherId, otherCodes] of this.map) {
      for (let i = 0; i < otherCodes.length; i++) {
        if (otherCodes[i] === code && !(otherId === id && i === index)) otherCodes[i] = null;
      }
    }
    codes[index] = code;
    this.save();
    return true;
  }

  clear(id: string, index: number): void {
    const codes = this.map.get(id);
    if (!codes || index < 0 || index >= SLOTS_PER_ACTION) return;
    codes[index] = null;
    this.save();
  }

  reset(): void {
    this.map = this.defaults();
    this.save();
  }
}

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
  // When true this action is exempt from the WoW-style "one code per action"
  // uniqueness sweep: its code may deliberately overlap another action's. Used
  // by Attack Move, whose default (A) intentionally shadows Turn Left — the two
  // are mutually exclusive (Attack Move mode disables WASD), so they can share a
  // key without either stealing it from the other on save/load.
  allowShared?: boolean;
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
  { id: 'targetFriendly', label: 'Target Nearest Friendly', category: 'Targeting', kind: 'edge', defaults: ['KeyH'] },
  { id: 'targetFriendlyNext', label: 'Cycle Friendly Target', category: 'Targeting', kind: 'edge', defaults: ['KeyJ'] },
  { id: 'interact', label: 'Interact / Loot', category: 'Targeting', kind: 'edge', defaults: ['KeyF'] },
  // Only acts while the Attack Move setting is on (then WASD is disabled); shares
  // its default key with Turn Left intentionally — see allowShared.
  { id: 'attackMove', label: 'Attack Move', category: 'Targeting', kind: 'edge', defaults: ['KeyA'], allowShared: true },
  // Interface windows
  { id: 'char', label: 'Character', category: 'Interface', kind: 'edge', defaults: ['KeyC'] },
  { id: 'spellbook', label: 'Spellbook', category: 'Interface', kind: 'edge', defaults: ['KeyP'] },
  { id: 'questlog', label: 'Quest Log', category: 'Interface', kind: 'edge', defaults: ['KeyL'] },
  { id: 'map', label: 'World Map', category: 'Interface', kind: 'edge', defaults: ['KeyM'] },
  { id: 'bags', label: 'Bags', category: 'Interface', kind: 'edge', defaults: ['KeyB'] },
  { id: 'nameplates', label: 'Toggle Nameplates', category: 'Interface', kind: 'edge', defaults: ['KeyV'] },
  { id: 'talents', label: 'Talents', category: 'Interface', kind: 'edge', defaults: ['KeyN'] },
  { id: 'meters', label: 'Damage Meters', category: 'Interface', kind: 'edge', defaults: ['KeyH'] },
  { id: 'social', label: 'Friends & Guild', category: 'Interface', kind: 'edge', defaults: ['KeyO'] },
  { id: 'arena', label: 'Arena (Ashen Coliseum)', category: 'Interface', kind: 'edge', defaults: ['KeyG'] },
  { id: 'skills', label: 'Skills', category: 'Interface', kind: 'edge', defaults: ['KeyK'] },
  { id: 'leaderboard', label: 'Leaderboard', category: 'Interface', kind: 'edge', defaults: ['KeyY'] },
  { id: 'chat', label: 'Open Chat', category: 'Interface', kind: 'edge', defaults: ['Enter', 'NumpadEnter'] },
  { id: 'emoteWheel', label: 'Emote Wheel', category: 'Interface', kind: 'held', defaults: ['KeyX'] },
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

// Actions exempt from the one-code-per-action uniqueness sweep (see BindAction).
export function actionAllowsShared(id: string): boolean {
  return ACTION_BY_ID.get(id)?.allowShared === true;
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
    const obj = stored as Record<string, unknown>;
    // Apply stored codes over the defaults, but only for known actions and
    // never letting one code land on two actions (first writer keeps it).
    // Actions absent from the stored blob (e.g. ones added in a later release
    // than the player's last save) KEEP their defaults rather than loading
    // unbound — explicit stored bindings still win, so this only fills gaps.
    const claimed = new Set<string>();
    for (const a of BIND_ACTIONS) {
      const entry = obj[a.id];
      if (!Array.isArray(entry)) continue; // missing action: keep its default
      const slots: (string | null)[] = [null, null];
      const shared = actionAllowsShared(a.id);
      for (let i = 0; i < SLOTS_PER_ACTION; i++) {
        const v = entry[i];
        // Shared actions keep their code even if another action already claimed
        // it, and never claim it themselves, so the overlap survives a round-trip.
        if (typeof v === 'string' && !isReservedCode(v) && (shared || !claimed.has(v))) {
          slots[i] = v;
          if (!shared) claimed.add(v);
        }
      }
      this.map.set(a.id, slots);
    }
    // Second pass: for actions that kept their defaults, drop any code an
    // explicit stored binding already claimed so the same key can't drive two
    // actions (preserving the WoW-style uniqueness invariant).
    for (const a of BIND_ACTIONS) {
      if (Array.isArray(obj[a.id])) continue;
      if (actionAllowsShared(a.id)) continue; // keep its (intentionally shared) default
      const slots = this.map.get(a.id)!;
      for (let i = 0; i < slots.length; i++) {
        const c = slots[i];
        if (c === null) continue;
        if (claimed.has(c)) slots[i] = null;
        else claimed.add(c);
      }
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
   * two actions at once (classic-MMO-style).
   */
  bind(id: string, index: number, code: string): boolean {
    const codes = this.map.get(id);
    if (!codes || index < 0 || index >= SLOTS_PER_ACTION) return false;
    if (isReservedCode(code)) return false;
    // A shared action (or rebinding one) is allowed to overlap, so skip the
    // mutual-eviction sweep whenever either side opts into sharing.
    if (!actionAllowsShared(id)) {
      for (const [otherId, otherCodes] of this.map) {
        if (actionAllowsShared(otherId)) continue;
        for (let i = 0; i < otherCodes.length; i++) {
          if (otherCodes[i] === code && !(otherId === id && i === index)) otherCodes[i] = null;
        }
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

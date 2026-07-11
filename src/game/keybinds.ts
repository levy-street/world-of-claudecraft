// Player-rebindable controls. Every bindable game action, movement, camera,
// targeting, interface windows, and the 23 action-bar slots, lives in one
// registry, and the Keybinds map holds up to two KeyboardEvent.codes per
// action (primary + secondary, e.g. W and ArrowUp both Move Forward). Input
// dispatches edge actions and polls held (movement) actions through this map;
// the HUD renders the rebind menu and action-bar keycaps from it. Bindings
// persist per character in localStorage (a fresh character seeds once from the
// legacy account-wide blob; see KEY_PREFIX below). Pure (no DOM) so the
// conflict/persistence logic is unit-testable.
//
// Escape is deliberately NOT a bindable action: it always opens/closes the
// game menu, so it stays out of the registry and is refused by bind().

export type BindKind = 'held' | 'edge';

export interface BindAction {
  id: string;
  label: string;
  category: string;
  kind: BindKind;
  defaults: string[]; // 0, 1, or 2 codes; index 0 = primary, 1 = secondary
  // (0 codes = intentionally unbound by default, e.g. strafeLeft/strafeRight,
  // which the classic keyboard-turner rebinds; see the default-layout note below).
  // When true this action is exempt from the classic-style "one code per action"
  // uniqueness sweep: its code may deliberately overlap another action's. Used
  // by Attack Move, whose default (A) intentionally shadows Turn Left while the
  // setting is on, so they can share a key without either stealing it from the
  // other on save/load.
  allowShared?: boolean;
}

// slot 0 is Attack, 1..11 the primary ability bar, 12..22 the secondary bar.
export const ACTION_BAR_SLOTS = 23;

// Per-slot default codes (index 0 = primary, 1 = secondary). Slots 0..9 keep the
// bare number row. Slots 10/11 ('Action Bar 11'/'Action Bar 12') put Q/E on the
// primary so players see Q/E on those buttons (Q/E are the ergonomic spell keys
// freed up from strafeLeft/strafeRight), and keep Minus/Equal as secondaries so
// nothing is lost. The secondary bar (slots 12..22) primaries stay on the numpad
// (never colliding with the primary number row); slots 12..21 also carry
// 'Shift+Digit1'..'Shift+Digit0' as secondaries so the whole page is reachable
// without a numpad. Shift+<digit> is a DISTINCT edge chord from the bare <digit>
// (edge actions match the full combo), so it never evicts an action-bar primary.
// (The Shift chords cover all ten digits, not just a subset, so the secondary
// page has no dead keys.) SLOTS_PER_ACTION = 2 fits each row exactly.
const SLOT_DEFAULTS: string[][] = [
  ['Digit1'],
  ['Digit2'],
  ['Digit3'],
  ['Digit4'],
  ['Digit5'],
  ['Digit6'],
  ['Digit7'],
  ['Digit8'],
  ['Digit9'],
  ['Digit0'],
  ['KeyQ', 'Minus'],
  ['KeyE', 'Equal'],
  ['Numpad1', 'Shift+Digit1'],
  ['Numpad2', 'Shift+Digit2'],
  ['Numpad3', 'Shift+Digit3'],
  ['Numpad4', 'Shift+Digit4'],
  ['Numpad5', 'Shift+Digit5'],
  ['Numpad6', 'Shift+Digit6'],
  ['Numpad7', 'Shift+Digit7'],
  ['Numpad8', 'Shift+Digit8'],
  ['Numpad9', 'Shift+Digit9'],
  ['Numpad0', 'Shift+Digit0'],
  ['NumpadDecimal'],
];

export const BIND_ACTIONS: BindAction[] = [
  // Movement / camera — polled every frame (held)
  {
    id: 'forward',
    label: 'Move Forward',
    category: 'Movement',
    kind: 'held',
    defaults: ['KeyW', 'ArrowUp'],
  },
  {
    id: 'back',
    label: 'Move Backward',
    category: 'Movement',
    kind: 'held',
    defaults: ['KeyS', 'ArrowDown'],
  },
  {
    id: 'turnLeft',
    label: 'Turn Left',
    category: 'Movement',
    kind: 'held',
    defaults: ['KeyA', 'ArrowLeft'],
  },
  {
    id: 'turnRight',
    label: 'Turn Right',
    category: 'Movement',
    kind: 'held',
    defaults: ['KeyD', 'ArrowRight'],
  },
  // Strafe ships UNBOUND by default: Q/E are reserved for the spell action bar
  // (slots 10/11), so the classic keyboard-turner binds their own strafe keys.
  // The Keybinds pane's unbound banner truthfully lists these until rebound.
  {
    id: 'strafeLeft',
    label: 'Strafe Left',
    category: 'Movement',
    kind: 'held',
    defaults: [],
  },
  {
    id: 'strafeRight',
    label: 'Strafe Right',
    category: 'Movement',
    kind: 'held',
    defaults: [],
  },
  { id: 'jump', label: 'Jump', category: 'Movement', kind: 'held', defaults: ['Space'] },
  {
    id: 'autorun',
    label: 'Toggle Autorun',
    category: 'Movement',
    kind: 'edge',
    defaults: ['KeyR'],
  },
  // Targeting / interaction
  {
    id: 'target',
    label: 'Target Nearest Enemy',
    category: 'Targeting',
    kind: 'edge',
    defaults: ['Tab'],
  },
  {
    id: 'targetFriendly',
    label: 'Target Nearest Friendly',
    category: 'Targeting',
    kind: 'edge',
    defaults: ['KeyH'],
  },
  {
    id: 'targetFriendlyNext',
    label: 'Cycle Friendly Target',
    category: 'Targeting',
    kind: 'edge',
    defaults: ['KeyJ'],
  },
  {
    id: 'interact',
    label: 'Interact / Loot',
    category: 'Targeting',
    kind: 'edge',
    defaults: ['KeyF'],
  },
  // Only acts while the Attack Move setting is on; shares its default key with
  // Turn Left intentionally, and only that key is reserved while active.
  {
    id: 'attackMove',
    label: 'Attack Move',
    category: 'Targeting',
    kind: 'edge',
    defaults: ['KeyA'],
    allowShared: true,
  },
  // Interface windows
  { id: 'char', label: 'Character', category: 'Interface', kind: 'edge', defaults: ['KeyC'] },
  { id: 'spellbook', label: 'Spellbook', category: 'Interface', kind: 'edge', defaults: ['KeyP'] },
  { id: 'questlog', label: 'Quest Log', category: 'Interface', kind: 'edge', defaults: ['KeyL'] },
  { id: 'map', label: 'World Map', category: 'Interface', kind: 'edge', defaults: ['KeyM'] },
  { id: 'bags', label: 'Bags', category: 'Interface', kind: 'edge', defaults: ['KeyB'] },
  { id: 'crafting', label: 'Crafting', category: 'Interface', kind: 'edge', defaults: ['KeyT'] },
  {
    id: 'nameplates',
    label: 'Toggle Nameplates',
    category: 'Interface',
    kind: 'edge',
    defaults: ['KeyV'],
  },
  { id: 'talents', label: 'Talents', category: 'Interface', kind: 'edge', defaults: ['KeyN'] },
  // Damage Meters moves off KeyH (the one free ergonomic letter is KeyZ), so it
  // no longer collides with Target Nearest Friendly (which keeps KeyH). A fresh
  // profile therefore shows no keyboard duplicate from this pair.
  { id: 'meters', label: 'Damage Meters', category: 'Interface', kind: 'edge', defaults: ['KeyZ'] },
  {
    id: 'social',
    label: 'Friends & Guild',
    category: 'Interface',
    kind: 'edge',
    defaults: ['KeyO'],
  },
  {
    id: 'arena',
    label: 'Arena (Ashen Coliseum)',
    category: 'Interface',
    kind: 'edge',
    defaults: ['KeyG'],
  },
  {
    id: 'valecup',
    label: 'Vale Cup',
    category: 'Interface',
    kind: 'edge',
    defaults: ['KeyY'],
  },
  {
    id: 'leaderboard',
    label: 'Leaderboard',
    category: 'Interface',
    kind: 'edge',
    defaults: ['KeyK'],
  },
  {
    id: 'calendar',
    label: 'Event Calendar',
    category: 'Interface',
    kind: 'edge',
    defaults: ['KeyI'],
  },
  {
    id: 'discord',
    label: 'Discord',
    category: 'Interface',
    kind: 'edge',
    defaults: ['KeyU'],
  },
  {
    id: 'chat',
    label: 'Open Chat',
    category: 'Interface',
    kind: 'edge',
    defaults: ['Enter', 'NumpadEnter'],
  },
  {
    id: 'emoteWheel',
    label: 'Emote Wheel',
    category: 'Interface',
    kind: 'held',
    defaults: ['KeyX'],
  },
  // Pet bar (hunter/warlock pet commands). Bound to Ctrl + 1..5 by default, so the
  // action-bar 1..5 stay free; every one is rebindable like any other action. The
  // handlers live in main.ts (onPet -> the IWorld pet commands).
  {
    id: 'petAttack',
    label: 'Pet: Attack',
    category: 'Pet',
    kind: 'edge',
    defaults: ['Ctrl+Digit1'],
  },
  { id: 'petStop', label: 'Pet: Stop', category: 'Pet', kind: 'edge', defaults: ['Ctrl+Digit2'] },
  { id: 'petTaunt', label: 'Pet: Taunt', category: 'Pet', kind: 'edge', defaults: ['Ctrl+Digit3'] },
  {
    id: 'petDefensive',
    label: 'Pet: Defensive',
    category: 'Pet',
    kind: 'edge',
    defaults: ['Ctrl+Digit4'],
  },
  {
    id: 'petAggressive',
    label: 'Pet: Aggressive',
    category: 'Pet',
    kind: 'edge',
    defaults: ['Ctrl+Digit5'],
  },
  // Action bar (slot 0 = Attack)
  ...SLOT_DEFAULTS.map(
    (codes, i): BindAction => ({
      id: `slot${i}`,
      label: i === 0 ? 'Attack' : i <= 11 ? `Action Bar ${i + 1}` : `Secondary Bar ${i - 11}`,
      category: 'Action Bar',
      kind: 'edge',
      defaults: codes,
    }),
  ),
];

const ACTION_BY_ID = new Map(BIND_ACTIONS.map((a) => [a.id, a]));
export const BIND_CATEGORIES = [...new Set(BIND_ACTIONS.map((a) => a.category))];
// Bindings persist per character. The legacy account-wide blob lives under the
// bare prefix; a per-character profile lives under `${KEY_PREFIX}:${scope}` (the
// online characterId, or `offline:<class>:<name>` offline). A fresh character
// with no stored profile seeds from the legacy blob once, then diverges on its
// first rebind. The legacy blob is read-only here and never overwritten.
const KEY_PREFIX = 'woc_keybinds';
const SLOTS_PER_ACTION = 2; // primary + secondary

export function actionKind(id: string): BindKind | null {
  return ACTION_BY_ID.get(id)?.kind ?? null;
}

// Actions exempt from the one-code-per-action uniqueness sweep (see BindAction).
export function actionAllowsShared(id: string): boolean {
  return ACTION_BY_ID.get(id)?.allowShared === true;
}

// --- modifier-aware bindings ---------------------------------------------
// A binding is serialized as a single "combo" string: the bare KeyboardEvent
// .code, optionally prefixed by held modifiers in a fixed canonical order
// (Ctrl, Alt, Shift, Meta), joined by '+'. Examples: "Digit1" (no modifiers),
// "Shift+Digit1", "Ctrl+Alt+KeyA", "Meta+Digit1" (Cmd/Win + 1). A modifier-free
// combo is byte-identical to a bare code, so every binding saved before modifier
// support loads unchanged (back-compat). `meta` is optional so call sites that
// predate Cmd/Win support keep compiling.
export interface KeyMods {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta?: boolean;
}

// e.code values for the modifier keys themselves — never bindable on their own.
const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

// Build the canonical combo string. No e.code contains '+', so '+' is a safe
// separator. Order is fixed (Ctrl, Alt, Shift, Meta) so capture and dispatch
// always produce the same string for the same physical chord. Meta is Cmd on
// macOS and the Windows key elsewhere; folding it in keeps Cmd+1 a distinct
// chord instead of silently capturing (and evicting) a bare 1.
export function makeCombo(code: string, mods: KeyMods): string {
  const parts: string[] = [];
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.alt) parts.push('Alt');
  if (mods.shift) parts.push('Shift');
  if (mods.meta) parts.push('Meta');
  parts.push(code);
  return parts.join('+');
}

// The bare e.code at the tail of a combo (drops any modifier prefix).
export function comboCode(combo: string): string {
  const i = combo.lastIndexOf('+');
  return i === -1 ? combo : combo.slice(i + 1);
}

export function comboMods(combo: string): KeyMods {
  const head = combo.slice(0, Math.max(0, combo.lastIndexOf('+')));
  const parts = head ? head.split('+') : [];
  return {
    ctrl: parts.includes('Ctrl'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
    meta: parts.includes('Meta'),
  };
}

export function isReservedCode(combo: string): boolean {
  return comboCode(combo) === 'Escape'; // the game-menu key is never rebindable
}

// short on-screen label for a single e.code (the keycap glyph)
function codeLabel(code: string): string {
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`;
  const named: Record<string, string> = {
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ShiftLeft: 'LShift',
    ShiftRight: 'RShift',
    ControlLeft: 'LCtrl',
    ControlRight: 'RCtrl',
    AltLeft: 'LAlt',
    AltRight: 'RAlt',
    CapsLock: 'Caps',
    NumpadAdd: 'Num+',
    NumpadSubtract: 'Num-',
    NumpadMultiply: 'Num*',
    NumpadDivide: 'Num/',
    NumpadDecimal: 'Num.',
    NumpadEnter: 'NumEnter',
  };
  return named[code] ?? code;
}

// Read a stored bindings blob, returning a plain object map or null. A missing,
// corrupt (unparseable), or non-object value (including a JSON array) counts as
// "no profile"; the caller then falls back to the legacy seed or to defaults.
function readBindingsBlob(key: string): Record<string, unknown> | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    /* corrupt */
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

// combo -> short on-screen label (matches the keycap shown on the action bar),
// e.g. "Shift+Digit1" -> "Shift+1", "Digit1" -> "1".
export function keyLabel(combo: string | null): string {
  if (!combo) return '';
  const code = comboCode(combo);
  const head = combo.slice(0, combo.length - code.length); // "Shift+" or ""
  return head + codeLabel(code);
}

export class Keybinds {
  // actionId -> [primary, secondary] codes (either may be null)
  private map = new Map<string, (string | null)[]>();
  // localStorage key this profile reads/writes. A non-empty scope namespaces it
  // per character; an empty scope keeps the bare legacy/global key.
  private readonly storeKey: string;

  constructor(scope = '') {
    this.storeKey = scope ? `${KEY_PREFIX}:${scope}` : KEY_PREFIX;
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
    // This character's own profile, or the legacy account-wide blob as a
    // one-time seed when it has none yet, so existing players keep their layout.
    // Saving writes the scoped key, so the character diverges from here on. A
    // missing, corrupt, or malformed scoped value counts as "no profile" and
    // still seeds rather than dropping to bare defaults; the legacy blob is only
    // ever read here, never overwritten.
    let obj = readBindingsBlob(this.storeKey);
    if (!obj && this.storeKey !== KEY_PREFIX) obj = readBindingsBlob(KEY_PREFIX);
    if (!obj) return;
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
    // actions (preserving the classic-style uniqueness invariant).
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
    try {
      localStorage.setItem(this.storeKey, JSON.stringify(obj));
    } catch {
      /* storage unavailable */
    }
  }

  /**
   * Test-only convenience: the action whose binding exactly equals this combo
   * (any kind), or null. Production dispatch uses `edgeActionForCombo` (full
   * chord) and `heldActionForCode` (bare key); this stays for the layout tests.
   */
  actionForCode(combo: string): string | null {
    for (const [id, codes] of this.map) {
      if (codes.includes(combo)) return id;
    }
    return null;
  }

  /**
   * The EDGE action bound to this exact modifier combo, or null. Edge actions
   * (ability slots, window toggles) match the full chord, so "Shift+Digit1" is
   * distinct from "Digit1".
   */
  edgeActionForCombo(combo: string): string | null {
    for (const [id, codes] of this.map) {
      if (actionKind(id) === 'edge' && codes.includes(combo)) return id;
    }
    return null;
  }

  /**
   * The HELD (movement) action driven by this physical key, ignoring modifiers
   * so movement survives a held Shift/Ctrl/Alt. Compares the bare code only.
   */
  heldActionForCode(code: string): string | null {
    for (const [id, codes] of this.map) {
      if (actionKind(id) !== 'held') continue;
      if (codes.some((c) => c !== null && comboCode(c) === code)) return id;
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
  bind(id: string, index: number, combo: string): boolean {
    const codes = this.map.get(id);
    if (!codes || index < 0 || index >= SLOTS_PER_ACTION) return false;
    // Held (movement) actions are polled per-frame against the physical e.code
    // and deliberately ignore modifiers (so e.g. Shift+W still walks). Store
    // them bare so the poll keeps matching; only edge actions keep the full
    // modifier combo.
    const value = actionKind(id) === 'held' ? comboCode(combo) : combo;
    if (isReservedCode(value)) return false;
    // A shared action (or rebinding one) is allowed to overlap, so skip the
    // mutual-eviction sweep whenever either side opts into sharing. The sweep
    // compares the full combo string, so "Shift+Digit1" and "Digit1" are
    // distinct bindings and never evict each other.
    if (!actionAllowsShared(id)) {
      for (const [otherId, otherCodes] of this.map) {
        if (actionAllowsShared(otherId)) continue;
        for (let i = 0; i < otherCodes.length; i++) {
          if (otherCodes[i] === value && !(otherId === id && i === index)) otherCodes[i] = null;
        }
      }
    }
    codes[index] = value;
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

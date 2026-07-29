// IWorldActionBar: per-character action-bar layout persistence. The layout is
// pure client PRESENTATION state (a remap over learned abilities + item
// shortcuts), NOT sim gameplay state, so it never rides the deterministic
// CharacterState. Offline it lives in localStorage exactly as before; online it
// is persisted per character on the server and restored at login on any device.
//
// This module is the ONE home both the server and the client share for the wire
// payload MODEL and its bounds validation: it is DOM-free and sim-free (only
// plain types), so `server/game.ts` (which cannot import `src/ui/`) and the
// client controller both import the same `sanitizeActionBarLayout`. The
// localStorage read/write side lives in `src/ui/hud/action_bar/
// action_bar_layout_sync.ts` (browser-only), which imports the type from here.

// The six action-bar "forms" a character can arrange independently: the base
// bar, the druid Bear/Cat/Cat-stealth kits, the rogue Stealth bar, and the Vale
// Cup sport bar. This is the full sibling set the localStorage keys cover.
export const ACTION_BAR_LAYOUT_FORMS = [
  'normal',
  'bear',
  'cat',
  'cat_stealth',
  'stealth',
  'sport',
] as const;
export type ActionBarLayoutForm = (typeof ACTION_BAR_LAYOUT_FORMS)[number];

// Bounds for the untrusted client payload (validated server-side). The slot cap
// is the current configurable-slot count (SAVED_LOADOUT_BAR_SLOTS, three rows);
// a legacy shorter/longer array is tolerated up to the cap, never past it.
export const ACTION_BAR_LAYOUT_VERSION = 1;
export const ACTION_BAR_LAYOUT_MAX_SLOTS = 33;
export const ACTION_BAR_LAYOUT_MAX_ID_LEN = 64;
// Hard ceiling on distinct form keys accepted before the whole payload is
// rejected as abusive (a legitimate client sends at most ACTION_BAR_LAYOUT_FORMS).
export const ACTION_BAR_LAYOUT_MAX_FORM_KEYS = 16;

export type ActionBarSlotAction = { type: 'ability' | 'item'; id: string };

export interface ActionBarFormLayout {
  // The configurable slots (index 0 is bar slot 1). Entries are an ability/item
  // binding or null for an empty slot. Up to ACTION_BAR_LAYOUT_MAX_SLOTS long.
  bar: (ActionBarSlotAction | null)[];
  // The player-assignable Attack control binding (bar slot 0), or null/absent.
  attack?: ActionBarSlotAction | null;
}

export interface ActionBarLayout {
  v: number;
  // PARTIAL by design: an absent form means "leave the device's state for that
  // form alone" on apply (version-tolerant, mirroring the hotbar tail rule).
  forms: Partial<Record<ActionBarLayoutForm, ActionBarFormLayout>>;
}

// How the client should reconcile its local layout with the server copy at
// world entry (resolved once per ClientWorld from the login self-payload):
//   - 'server': the server has a copy; it WINS (seed the controller + overwrite
//     the local mirror).
//   - 'seed':   the server has NO copy; the device's local layout seeds the
//     first server copy (or, if the device has none either, defaults stand).
//   - 'noop':   nothing to do (offline play, or a reconnect that keeps the
//     already-authoritative local mirror).
export type ActionBarLayoutRestore =
  | { source: 'server'; layout: ActionBarLayout }
  | { source: 'seed' }
  | { source: 'noop' };

export interface IWorldActionBar {
  // Persist the full action-bar layout for this character. Offline: a no-op
  // (localStorage, written by the controller, is the store). Online: a debounced
  // wire save; the localStorage mirror is written by the controller as before.
  saveActionBarLayout(layout: ActionBarLayout): void;
  // One-shot at world entry: the login-time reconciliation decision, consumed
  // once (subsequent calls return undefined). Returns undefined while the
  // resolution is still pending (online, before the login self-payload arrives),
  // so the caller polls until it resolves. Offline resolves to 'noop' at once.
  takeActionBarLayoutRestore(): ActionBarLayoutRestore | undefined;
}

const KNOWN_FORMS = new Set<string>(ACTION_BAR_LAYOUT_FORMS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeSlotAction(value: unknown): ActionBarSlotAction | null {
  if (!isPlainObject(value)) return null;
  const type = value.type;
  const id = value.id;
  if (type !== 'ability' && type !== 'item') return null;
  if (typeof id !== 'string') return null;
  if (id.length === 0 || id.length > ACTION_BAR_LAYOUT_MAX_ID_LEN) return null;
  return { type, id };
}

function sanitizeFormLayout(value: unknown): ActionBarFormLayout | null {
  if (!isPlainObject(value)) return null;
  const rawBar = value.bar;
  if (!Array.isArray(rawBar)) return null;
  // Reject an oversized bar outright rather than silently truncating untrusted
  // input; a legitimate client never sends past the slot cap.
  if (rawBar.length > ACTION_BAR_LAYOUT_MAX_SLOTS) return null;
  const bar = rawBar.map((entry) => (entry === null ? null : sanitizeSlotAction(entry)));
  const layout: ActionBarFormLayout = { bar };
  if ('attack' in value) {
    layout.attack = value.attack === null ? null : sanitizeSlotAction(value.attack);
  }
  return layout;
}

/**
 * Validate + bound an untrusted action-bar layout payload. Returns a clean,
 * in-bounds ActionBarLayout, or null when the input is fundamentally malformed
 * (not an object, or an oversized/garbage form). Never throws: a bad payload
 * yields null so the caller can drop it without crashing the session.
 */
export function sanitizeActionBarLayout(value: unknown): ActionBarLayout | null {
  if (!isPlainObject(value)) return null;
  const rawForms = value.forms;
  if (!isPlainObject(rawForms)) return null;
  const keys = Object.keys(rawForms);
  if (keys.length > ACTION_BAR_LAYOUT_MAX_FORM_KEYS) return null;
  const forms: Partial<Record<ActionBarLayoutForm, ActionBarFormLayout>> = {};
  for (const key of keys) {
    if (!KNOWN_FORMS.has(key)) continue; // ignore unknown form keys
    const form = sanitizeFormLayout(rawForms[key]);
    if (form === null) return null; // an oversized/garbage form rejects the payload
    forms[key as ActionBarLayoutForm] = form;
  }
  return { v: ACTION_BAR_LAYOUT_VERSION, forms };
}

/** True when a layout carries no form data (nothing worth persisting/seeding). */
export function actionBarLayoutIsEmpty(layout: ActionBarLayout): boolean {
  return Object.keys(layout.forms).length === 0;
}

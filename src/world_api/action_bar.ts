// IWorldActionBar: per-character action-bar layout persistence. The layout is
// pure client PRESENTATION state (a remap over learned abilities + item
// shortcuts), NOT sim gameplay state, so it never rides the deterministic
// CharacterState. Offline it lives in localStorage exactly as before; online it
// is persisted per character on the server and restored at login on any device.
//
// PROFILES: a character keeps one arrangement per input surface (the desktop
// keyboard row, the touch ring, a gamepad), because each surface reaches the
// slots in a different shape (eleven number keys, pages of five ring buttons,
// eight pad buttons), so one shared arrangement made every platform swap
// clobber the other one. The stored document is v2:
//   { v: 2, profiles: { desktop?: <layout>, touch?: <layout>, gamepad?: <layout> } }
// where each profile is the v1 per-form layout below. A v1 document at rest (or
// from a pre-profile client bundle) reads as the desktop profile, and a save
// that names no profile lands on it. The `hbl` self wire field carries the v2
// document PLUS a `forms` mirror of the desktop profile (ActionBarLayoutWire), so
// a pre-profile client still reads a valid v1 layout during a rollout.
//
// This module is the ONE home both the server and the client share for the wire
// payload MODEL and its bounds validation: it is DOM-free and sim-free (only
// plain types), so `server/hotbar_layout.ts` (which cannot import `src/ui/`) and
// the client controller both import the same sanitizers. The localStorage
// read/write side lives in `src/ui/hud/action_bar/action_bar_layout_sync.ts`
// (browser-only), which imports the types from here.

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

// The input surfaces a character keeps an independent arrangement for. The
// client resolves ONE active profile per world entry (desktop or touch today;
// the gamepad profile is reserved for the runtime pad switch) and every
// upload names it, so the server merges that profile alone.
export const ACTION_BAR_LAYOUT_PROFILES = ['desktop', 'touch', 'gamepad'] as const;
export type ActionBarLayoutProfile = (typeof ACTION_BAR_LAYOUT_PROFILES)[number];
// What a pre-profile client, a v1 document at rest, and the unsuffixed
// localStorage keys all mean.
export const ACTION_BAR_LAYOUT_LEGACY_PROFILE: ActionBarLayoutProfile = 'desktop';
// Seed order for a surface with no arrangement of its own: the first present,
// non-empty profile in its list becomes the starting point. The seed is applied
// locally and never uploaded, so the surface keeps following that bar until the
// player edits it there (the first edit uploads under the surface's own key).
export const ACTION_BAR_LAYOUT_PROFILE_FALLBACK: Readonly<
  Record<ActionBarLayoutProfile, readonly ActionBarLayoutProfile[]>
> = {
  desktop: ['touch', 'gamepad'],
  touch: ['desktop', 'gamepad'],
  gamepad: ['desktop', 'touch'],
};

// Bounds for the untrusted client payload (validated server-side). The slot cap
// is the current configurable-slot count (SAVED_LOADOUT_BAR_SLOTS, three rows);
// a legacy shorter/longer array is tolerated up to the cap, never past it.
export const ACTION_BAR_LAYOUT_VERSION = 1;
export const ACTION_BAR_LAYOUT_PROFILES_VERSION = 2;
export const ACTION_BAR_LAYOUT_MAX_SLOTS = 33;
export const ACTION_BAR_LAYOUT_MAX_ID_LEN = 64;
// Hard ceiling on distinct form keys accepted before the whole payload is
// rejected as abusive (a legitimate client sends at most ACTION_BAR_LAYOUT_FORMS).
export const ACTION_BAR_LAYOUT_MAX_FORM_KEYS = 16;
// The same ceiling for profile keys in a v2 document.
export const ACTION_BAR_LAYOUT_MAX_PROFILE_KEYS = 8;

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

// The stored per-character document: one v1 layout per input-surface profile.
// PARTIAL by design: an absent profile means that surface has never saved.
export interface ActionBarLayoutProfiles {
  v: number;
  profiles: Partial<Record<ActionBarLayoutProfile, ActionBarLayout>>;
}

// The `hbl` self wire shape: the v2 document plus a `forms` mirror of the
// legacy (desktop) profile, so a pre-profile client bundle reads it as a v1
// layout. `profiles` is authoritative; `forms` is the compatibility view.
export interface ActionBarLayoutWire extends ActionBarLayoutProfiles {
  forms: ActionBarLayout['forms'];
}

// What the JSONB column can hold: a v2 document, or a v1 layout written before
// profiles shipped. Re-validated (sanitizeActionBarLayoutProfiles) on read.
export type StoredActionBarLayout = ActionBarLayoutProfiles | ActionBarLayout;

// One client save: the profile it arranges plus that profile's full layout.
export interface ActionBarLayoutSave {
  profile: ActionBarLayoutProfile;
  layout: ActionBarLayout;
}

// How the client should reconcile its local layout with the server copy at
// world entry (resolved once per ClientWorld from the login self-payload):
//   - 'server': the server has a document; the client's own profile WINS when
//               present (seed the controller + overwrite the local mirror),
//               else the surface seeds locally from a fallback profile.
//   - 'seed':   the server has NO document; the device's local layout seeds the
//               first server copy (or, if the device has none either, defaults
//               stand).
//   - 'noop':   nothing to do (offline play, or a reconnect that keeps the
//               already-authoritative local mirror).
export type ActionBarLayoutRestore =
  | { source: 'server'; profiles: ActionBarLayoutProfiles }
  | { source: 'seed' }
  | { source: 'noop' };

export interface IWorldActionBar {
  // Persist one profile's full action-bar layout for this character. Offline: a
  // no-op (localStorage, written by the controller, is the store). Online: a
  // debounced wire save naming the profile; the localStorage mirror is written
  // by the controller as before.
  saveActionBarLayout(profile: ActionBarLayoutProfile, layout: ActionBarLayout): void;
  // One-shot at world entry: the login-time reconciliation decision, consumed
  // once (subsequent calls return undefined). Returns undefined while the
  // resolution is still pending (online, before the login self-payload arrives),
  // so the caller polls until it resolves. Offline resolves to 'noop' at once.
  takeActionBarLayoutRestore(): ActionBarLayoutRestore | undefined;
}

const KNOWN_FORMS = new Set<string>(ACTION_BAR_LAYOUT_FORMS);
const KNOWN_PROFILES = new Set<string>(ACTION_BAR_LAYOUT_PROFILES);

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

/** The profile name of an untrusted save, or null for anything but a known one. */
export function sanitizeActionBarLayoutProfile(value: unknown): ActionBarLayoutProfile | null {
  if (typeof value !== 'string' || !KNOWN_PROFILES.has(value)) return null;
  return value as ActionBarLayoutProfile;
}

/**
 * Validate + bound an untrusted stored/wired document. A v1 layout (no
 * `profiles` key) reads as the legacy (desktop) profile; a v2 document keeps
 * every known profile with a well-formed layout, drops unknown profile keys (a
 * newer bundle's surface) and any profile whose layout is garbage (so a corrupt
 * row at rest loses that one surface, never the others), and is rejected whole
 * only when the key count is abusive or `profiles` is not an object. The server
 * never runs client input through this arm (a save is one profile, validated by
 * sanitizeActionBarLayout), so leniency here costs nothing. Never throws.
 */
export function sanitizeActionBarLayoutProfiles(value: unknown): ActionBarLayoutProfiles | null {
  if (!isPlainObject(value)) return null;
  if (!('profiles' in value)) {
    const legacy = sanitizeActionBarLayout(value);
    if (legacy === null) return null;
    return withActionBarLayoutProfile(null, ACTION_BAR_LAYOUT_LEGACY_PROFILE, legacy);
  }
  const rawProfiles = value.profiles;
  if (!isPlainObject(rawProfiles)) return null;
  const keys = Object.keys(rawProfiles);
  if (keys.length > ACTION_BAR_LAYOUT_MAX_PROFILE_KEYS) return null;
  const profiles: Partial<Record<ActionBarLayoutProfile, ActionBarLayout>> = {};
  for (const key of keys) {
    const profile = sanitizeActionBarLayoutProfile(key);
    if (profile === null) continue;
    const layout = sanitizeActionBarLayout(rawProfiles[key]);
    if (layout === null) continue; // a garbage profile is dropped, the rest kept
    profiles[profile] = layout;
  }
  return { v: ACTION_BAR_LAYOUT_PROFILES_VERSION, profiles };
}

/** A new document with one profile replaced; every other profile is untouched. */
export function withActionBarLayoutProfile(
  current: ActionBarLayoutProfiles | null,
  profile: ActionBarLayoutProfile,
  layout: ActionBarLayout,
): ActionBarLayoutProfiles {
  return {
    v: ACTION_BAR_LAYOUT_PROFILES_VERSION,
    profiles: { ...(current?.profiles ?? {}), [profile]: layout },
  };
}

/**
 * The layout a surface starts from: its own profile when the document has one
 * (even an empty one), else the first present, non-empty fallback profile, else
 * null (nothing usable). The returned profile says which arm was taken.
 */
export function resolveActionBarLayoutProfile(
  doc: ActionBarLayoutProfiles,
  profile: ActionBarLayoutProfile,
): ActionBarLayoutSave | null {
  const own = doc.profiles[profile];
  if (own) return { profile, layout: own };
  for (const fallback of ACTION_BAR_LAYOUT_PROFILE_FALLBACK[profile]) {
    const layout = doc.profiles[fallback];
    if (layout && !actionBarLayoutIsEmpty(layout)) return { profile: fallback, layout };
  }
  return null;
}

/** The `hbl` wire view of a stored document (see ActionBarLayoutWire). */
export function actionBarLayoutWire(doc: ActionBarLayoutProfiles): ActionBarLayoutWire {
  return {
    v: doc.v,
    profiles: doc.profiles,
    forms: doc.profiles[ACTION_BAR_LAYOUT_LEGACY_PROFILE]?.forms ?? {},
  };
}

/** True when a layout carries no form data (nothing worth persisting/seeding). */
export function actionBarLayoutIsEmpty(layout: ActionBarLayout): boolean {
  return Object.keys(layout.forms).length === 0;
}

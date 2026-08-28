// Pure envelope logic for the settings/frame-layout export + import codes
// (options window, General and Frames tabs). DOM-free and storage-free: the
// caller supplies a key/value snapshot and gets a code string back, or hands a
// pasted code in and gets the validated entries out. Registered in
// tests/architecture.test.ts UI_PURE_CORES.
//
// The key allowlist is the security boundary: an import writes localStorage,
// and a crafted code must never be able to plant arbitrary keys (a fake
// session, a poisoned cache) through the paste box. Unknown keys are DROPPED,
// not errors, so a code exported by a NEWER build with an extra frame family
// still imports the parts this build understands; a code with NOTHING this
// build understands is rejected as invalid rather than silently "importing"
// zero keys.

/** What a code carries: the frame layout alone, or every setting family. */
export type TransferKind = 'frames' | 'settings';

/** Frame-geometry families: every key the movable frames, the chat box, the
 *  meter panels, the target-aura panel and the warlock doom meter persist
 *  (the same surfaces resetUnitFrames restores). */
const FRAME_KEY_PREFIXES = ['woc_hud_frame_'] as const;
const FRAME_KEYS = [
  'woc_player_frame_pos',
  'woc_target_frame_pos',
  'woc_party_frame_pos',
  'woc_chat_geometry',
  'woc_meters_frame',
  'woc_meters_frame_heal',
  'woc_meters_frame_threat',
  'woc_meters_detached',
  'woc_target_auras_frame',
  'woc_warlock_doom_frame_pos',
] as const;

/** The extra families the ALL-SETTINGS code carries on top of the layout:
 *  the settings object, the theme, the keybinds, and the panel preferences. */
const SETTINGS_KEY_PREFIXES = ['woc_target_auras_', 'woc_chat_'] as const;
const SETTINGS_KEYS = [
  'woc_settings',
  'woc_theme',
  'woc_keybinds',
  'woc_mobile_chat_bottom',
] as const;

/** Whether `key` belongs to `kind`'s allowlist ('settings' is a superset). */
export function transferKeyAllowed(kind: TransferKind, key: string): boolean {
  const inFrames =
    FRAME_KEYS.includes(key as (typeof FRAME_KEYS)[number]) ||
    FRAME_KEY_PREFIXES.some((p) => key.startsWith(p));
  if (kind === 'frames') return inFrames;
  return (
    inFrames ||
    SETTINGS_KEYS.includes(key as (typeof SETTINGS_KEYS)[number]) ||
    SETTINGS_KEY_PREFIXES.some((p) => key.startsWith(p))
  );
}

/** The envelope marker, so a random pasted JSON blob never reads as a code. */
const ENVELOPE = 'woc-transfer';
const VERSION = 1;

/** Build the shareable code for `entries` (already filtered by the caller or
 *  not: disallowed keys are dropped here too, so the code never leaks a
 *  storage key outside the advertised families). */
export function buildTransferCode(kind: TransferKind, entries: Record<string, string>): string {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (transferKeyAllowed(kind, key) && typeof value === 'string') data[key] = value;
  }
  return JSON.stringify({ woc: ENVELOPE, v: VERSION, kind, data });
}

export type ParsedTransfer =
  | { ok: true; entries: Record<string, string> }
  | { ok: false; reason: 'format' | 'kind' | 'empty' };

/** Parse a pasted code for `kind`. Returns the allowed entries, or why not:
 *  'format' (not a code at all), 'kind' (a valid code of the OTHER kind, so
 *  the message can say "that is a settings export" instead of "invalid"),
 *  'empty' (a valid code carrying nothing this build accepts). */
export function parseTransferCode(kind: TransferKind, text: string): ParsedTransfer {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return { ok: false, reason: 'format' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'format' };
  const env = raw as { woc?: unknown; v?: unknown; kind?: unknown; data?: unknown };
  if (
    env.woc !== ENVELOPE ||
    typeof env.v !== 'number' ||
    typeof env.data !== 'object' ||
    env.data === null
  ) {
    return { ok: false, reason: 'format' };
  }
  if (env.kind !== kind) {
    // A settings code pasted into the frames box still contains the frame
    // families, so accept the superset direction; the reverse is a real
    // mismatch (a frames code cannot fill a settings import).
    if (!(kind === 'frames' && env.kind === 'settings')) return { ok: false, reason: 'kind' };
  }
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(env.data as Record<string, unknown>)) {
    if (transferKeyAllowed(kind, key) && typeof value === 'string') entries[key] = value;
  }
  if (Object.keys(entries).length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, entries };
}

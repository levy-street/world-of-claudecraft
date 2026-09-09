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

/** What a code carries: the frame layout alone, the setting families the
 *  Interface tab has always offered, or the FULL preference set (every
 *  player-facing family this client persists, including per-character key
 *  bindings, controller binds and dismissed hints). Each kind is a strict
 *  superset of the one before it, so a code of a wider kind fills a narrower
 *  import. */
export type TransferKind = 'frames' | 'settings' | 'full';
/** Superset order: a code of rank N carries everything a rank < N import wants. */
const KIND_RANK: Record<TransferKind, number> = { frames: 0, settings: 1, full: 2 };
function kindRank(kind: unknown): number | null {
  // Own keys only: `'constructor' in KIND_RANK` is true through the prototype.
  return typeof kind === 'string' && Object.hasOwn(KIND_RANK, kind)
    ? KIND_RANK[kind as TransferKind]
    : null;
}

/** Frame-geometry families: every key the movable frames, the chat box, the
 *  meter panels, the target-aura panel and the warlock doom meter persist
 *  (the same surfaces resetUnitFrames restores). */
const FRAME_KEY_PREFIXES = ['woc_hud_frame_'] as const;
const FRAME_KEYS = [
  'woc_player_frame_pos',
  'woc_target_frame_pos',
  'woc_party_frame_pos',
  'woc_chat_geometry',
  // (The pre-frames 'woc_meters_frame' key is dead: the tabbed window's box
  // rides the damageMeter registry row's woc_hud_frame_meters prefix now.)
  'woc_meters_frame_heal',
  'woc_meters_frame_threat',
  'woc_meters_detached',
  'woc_target_auras_frame',
  'woc_warlock_doom_frame_pos',
  // The doom meter's frames-menu hidden flag: every other governed frame's
  // rides the woc_hud_frame_ prefix, but the doom row keeps its pre-registry
  // storage key, so its _hidden sibling is spelled out here.
  'woc_warlock_doom_frame_pos_hidden',
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

/** The extra families only the FULL code carries: the per-character key
 *  binding profiles and cross-hotbar pages, the aura overlay configs, the
 *  emote wheel / deed watch / reliquary pin lists, and the spawn-intro latch. */
const FULL_KEY_PREFIXES = [
  'woc_keybinds:',
  'woc_gamepad_xhb:',
  'woc_aura_overlays:',
  'woc_emote_wheel_',
  'woc_deed_watch_',
  'woc_reliquary_pins_',
  'woc_spawn_intro_seen:',
] as const;
/** Exact FULL-only keys: controller binds, the movable frames' hidden flags,
 *  the layout-reset epoch (so a fresh browser does not wipe the imported
 *  frame positions at its first boot), chat/clock/minimap toggles, window
 *  filters and tabs, roster prefs, the chat ignore list, audio and haptics
 *  toggles, language, the proc-overlay anchors, the perf overlay config, the
 *  character-select sort, and the one-time dismissed hints. NEVER a session,
 *  wallet, purchase, attribution or cache key: see tests. */
const FULL_KEYS = [
  'woc_gamepad',
  'woc_gamepad_xhb',
  'woc_gamepad_xhb_claimed',
  'woc_player_frame_pos_hidden',
  'woc_target_frame_pos_hidden',
  'woc_party_frame_pos_hidden',
  'woc_layout_reset_epoch',
  'chatTimestamps',
  'chatClock',
  'clock24h',
  'minimapZoom',
  'woc_bag_filter',
  'woc_bank_filter',
  'woc_crafting_tab',
  'woc_guild_hide_offline',
  'woc_party_collapsed',
  // (woc_ignored_chat_names is deliberately NOT here: it names other players,
  // and a shared setup code must never carry someone's ignore list.)
  'woc_haptics_on',
  'ev_music_on',
  'woc_homepage_music_muted',
  'locale',
  'woc_native_auto_locale',
  'paladinDevotionAnchor',
  'procOverlayAnchor',
  'woc_perf_overlay',
  'wocc.charSort',
  'woc.tutorial.v1',
  'woc.ferrybellhint.v1',
  'woc_unsupported_browser_dismissed',
  'woc_gpu_notice_dismissed',
  'woc_gpu_notice_hybrid_dismissed',
  'woc_perf_nudge_dismissed',
  'woc_keyboard_layout',
  'woc_keyboard_legends',
] as const;

/** Whether `key` belongs to `kind`'s allowlist (each kind is a superset of
 *  the one before it: frames < settings < full). */
export function transferKeyAllowed(kind: TransferKind, key: string): boolean {
  const inFrames =
    FRAME_KEYS.includes(key as (typeof FRAME_KEYS)[number]) ||
    FRAME_KEY_PREFIXES.some((p) => key.startsWith(p));
  if (kind === 'frames') return inFrames;
  const inSettings =
    inFrames ||
    SETTINGS_KEYS.includes(key as (typeof SETTINGS_KEYS)[number]) ||
    SETTINGS_KEY_PREFIXES.some((p) => key.startsWith(p));
  if (kind === 'settings') return inSettings;
  return (
    inSettings ||
    FULL_KEYS.includes(key as (typeof FULL_KEYS)[number]) ||
    FULL_KEY_PREFIXES.some((p) => key.startsWith(p))
  );
}

/** The envelope marker, so a random pasted JSON blob never reads as a code. */
const ENVELOPE = 'woc-transfer';
const VERSION = 1;
/** Bounds on a pasted code, so an import can never fill the origin's storage
 *  quota (which would silently break every later save, the session's
 *  included). A real full export is a few tens of kilobytes. */
export const TRANSFER_CODE_MAX_CHARS = 512 * 1024;
export const TRANSFER_VALUE_MAX_CHARS = 128 * 1024;
export const TRANSFER_MAX_ENTRIES = 400;

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
  if (text.length > TRANSFER_CODE_MAX_CHARS) return { ok: false, reason: 'format' };
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
  // A wider code pasted into a narrower box still contains that box's
  // families (a full or settings code fills a frames import), so accept the
  // superset direction; the reverse is a real mismatch (a frames code cannot
  // fill a settings import, nor a settings code a full one).
  const envRank = kindRank(env.kind);
  if (envRank === null || envRank < KIND_RANK[kind]) return { ok: false, reason: 'kind' };
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(env.data as Record<string, unknown>)) {
    if (!transferKeyAllowed(kind, key) || typeof value !== 'string') continue;
    // One oversized value or an absurd key count is a malformed code, not a
    // partial import: nothing this size is a real export.
    if (value.length > TRANSFER_VALUE_MAX_CHARS) return { ok: false, reason: 'format' };
    entries[key] = value;
    if (Object.keys(entries).length > TRANSFER_MAX_ENTRIES) return { ok: false, reason: 'format' };
  }
  if (Object.keys(entries).length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, entries };
}

// Which boot a home page load takes (src/boot.ts), and the touch-interface answer
// the landing page needs before the game client exists. Pure: no DOM, no imports.
//
// 'landing' is a plain first visit: the landing page paints from the HTML and the
// stylesheets alone, and src/main.ts (the whole client) downloads in the background
// and starts on the visitor's first interaction (src/ui/landing_first.ts).
// 'game' is every visit that needs the client at once, which starts it straight away
// exactly as before: a saved session, a pending login hand-off, a non-English page
// (the client localizes it), a crash probe, the native and desktop shells.
export type BootMode = 'landing' | 'game';

export interface BootInputs {
  pathname: string;
  search: string;
  nativeApp: boolean;
  desktopApp: boolean;
  /** A localStorage value, or null when unset or storage is unavailable. */
  stored: (key: string) => string | null;
  /** A sessionStorage value, or null when unset or storage is unavailable. */
  session: (key: string) => string | null;
}

/** The paths that serve the home page; any other (e.g. /desktop-login) needs the client. */
export const LANDING_PATHS: readonly string[] = ['/', '/index.html'];

/**
 * localStorage keys that send the boot straight to the client: a saved session
 * (src/net/online.ts), a pending Discord account choice (server/discord.ts), and the
 * world-entry crash probes main.ts reads on boot.
 */
export const GAME_NOW_STORED_KEYS: readonly string[] = [
  'woc_session',
  'woc_discord_choice',
  'woc_entry_probe',
  'woc_graphics_rebuild_probe',
];

/** sessionStorage keys that do the same: the map editor's play-test hand-off. */
export const GAME_NOW_SESSION_KEYS: readonly string[] = ['woc_editor_playtest'];

/**
 * Query keys that do the same: a password reset link, diagnostics, browser tooling,
 * and the release's direct world-entry flows. `boot=now` also opts out for tools
 * that drive the client at load.
 */
export const GAME_NOW_QUERY_KEYS: readonly string[] = [
  'reset',
  'diagnostics',
  'headless',
  'map',
  'editorPlaytest',
  'boss',
];

export function bootModeFor(input: BootInputs): BootMode {
  if (input.nativeApp || input.desktopApp) return 'game';
  if (!LANDING_PATHS.includes(input.pathname)) return 'game';
  const query = new URLSearchParams(input.search);
  if (GAME_NOW_QUERY_KEYS.some((key) => query.has(key)) || query.get('boot') === 'now') {
    return 'game';
  }
  // The HTML is English; any other language is applied by the client
  // (src/ui/i18n.ts reads ?lang first, then the stored locale).
  const lang = query.get('lang') ?? input.stored('locale');
  if (lang !== null && lang !== 'en') return 'game';
  if (GAME_NOW_STORED_KEYS.some((key) => input.stored(key) !== null)) return 'game';
  if (GAME_NOW_SESSION_KEYS.some((key) => input.session(key) !== null)) return 'game';
  return 'landing';
}

/**
 * Mirrors PHONE_TOUCH_QUERY in src/game/mobile_controls.ts, which imports the i18n
 * runtime and so cannot load before the client. tests/landing_first_core.test.ts
 * pins the two equal.
 */
export const LANDING_PHONE_TOUCH_QUERY =
  '(pointer: coarse) and (hover: none), (pointer: coarse) and (max-width: 940px), (pointer: coarse) and (max-height: 760px)';

/**
 * Whether the landing page shows the touch interface (body.mobile-touch): the stored
 * Interface Mode (0 Auto, 1 Desktop, 2 Touch) wins, Auto follows the phone query.
 * Same answer as resolveTouchInterface(interfaceModeFromSetting(mode), phone) in
 * src/game/mobile_controls.ts, pinned by the test.
 */
export function landingTouchInterface(interfaceMode: number, phoneTouch: boolean): boolean {
  if (interfaceMode >= 2) return true;
  if (interfaceMode >= 1) return false;
  return phoneTouch;
}

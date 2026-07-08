// The running client's display version + build id, from the compile-time
// constants Vite injects (see vite.config.ts `define`). Centralized here so both
// the page-level footer (main.ts) and the in-game settings panel read one source
// and one formatter instead of each re-declaring the globals.

declare const __APP_VERSION__: string;
declare const __APP_BUILD_ID__: string;

/** Trim a trailing ".0" so a release like "0.23.0" shows as "0.23" (the historical
 *  page-footer form; tests/release_version.test.ts pins the rendered footer). */
export function formatFooterVersion(version: string): string {
  return version.replace(/\.0$/, '');
}

/** The version + build id to display, already formatted. Reads the Vite-defined
 *  globals through a typeof guard so it does not throw when they are absent (the
 *  standalone browser-test config injects no defines; Vite textually replaces the
 *  identifiers in the real build, so the guard resolves to the value there). */
export function appVersionInfo(): { version: string; build: string } {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
  const build = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
  return { version: formatFooterVersion(version), build };
}

// The HTTP status of serveStatic's SPA shell fallback (server/main.ts).
//
// serveStatic answers any extensionless or .html path it has no file for with a
// shell: index.html, guide.html under /wiki, admin.html on the admin host. That
// used to be HTTP 200 for every path, so any invented or mistyped URL
// (/game, /cp, /MMORPGS/free) looked like a second copy of the homepage, which
// search engines report as a "soft 404" and keep re-crawling.
//
// Real client routes keep 200. Every other path still gets the SAME shell body,
// so a visitor following an old or mistyped link sees the homepage exactly as
// before; only the status changes to 404. Asset paths are not decided here:
// serveStatic 404s a missing asset before it ever reaches the fallback.

/** Pretty URLs that serve standalone static HTML pages (serveStatic rewrites to the file). */
export const STATIC_PAGE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['/links', '/links.html'],
  ['/links/', '/links.html'],
  ['/social', '/links.html'],
  ['/social/', '/links.html'],
  ['/social-media-links', '/links.html'],
  ['/social-media-links/', '/links.html'],
  ['/play', '/play.html'],
  ['/play/', '/play.html'],
  ['/wallet-handoff', '/wallet-handoff.html'],
  ['/wallet-handoff/', '/wallet-handoff.html'],
  ['/privacy', '/privacy.html'],
  ['/privacy/', '/privacy.html'],
  ['/terms', '/terms.html'],
  ['/terms/', '/terms.html'],
  ['/merch', '/merch.html'],
  ['/merch/', '/merch.html'],
  ['/press', '/press.html'],
  ['/press/', '/press.html'],
  ['/data-deletion', '/data-deletion.html'],
  ['/data-deletion/', '/data-deletion.html'],
  ['/support', '/support.html'],
  ['/support/', '/support.html'],
  ['/wiki', '/guide.html'],
  ['/wiki/', '/guide.html'],
  ['/editor', '/editor.html'],
  ['/editor/', '/editor.html'],
]);

/** Main-host paths the game shell (index.html) or a server flow relies on. */
export const SHELL_CLIENT_ROUTES: ReadonlySet<string> = new Set([
  '/',
  // The admin shell's local entry (isAdminRequest in main.ts); admin routes are query strings.
  '/admin',
  '/admin/',
  // The desktop sign-in handoff page (src/main.ts isDesktopLoginRoute, server/discord.ts).
  '/desktop-login',
  '/desktop-login/',
  // The browser redirect target of server/http/errors.ts (serializeRedirect).
  '/error',
  // Linked from every /c/ profile page (server/profile_page.ts). No leaderboard page exists
  // yet, so this shows the homepage; kept 200 so ~50K profiles do not link to a 404.
  '/leaderboard',
]);

/** The guide/wiki SPA routes its own paths, so every /wiki path keeps 200 (out of scope here). */
function isGuidePath(pathname: string): boolean {
  return pathname === '/wiki' || pathname.startsWith('/wiki/');
}

/**
 * The status for a shell served by the SPA fallback.
 *
 * @param pathname the request's raw URL pathname (no query string), before alias rewriting.
 * @param adminRequest whether the request targets the admin shell (admin host); left as 200.
 * @param staticAliases the pretty-URL aliases for standalone pages; a known alias keeps 200 even
 *   when its file is missing from the build.
 */
export function spaFallbackStatus(
  pathname: string,
  adminRequest: boolean,
  staticAliases: ReadonlyMap<string, string>,
): 200 | 404 {
  if (adminRequest) return 200;
  if (isGuidePath(pathname)) return 200;
  if (SHELL_CLIENT_ROUTES.has(pathname)) return 200;
  if (staticAliases.has(pathname)) return 200;
  return 404;
}

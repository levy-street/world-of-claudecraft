'use strict';

// Pure, Node-testable resolution of the desktop shell's runtime configuration:
// which distribution channel this build is (website download vs Steam depot),
// whether the in-app auto-updater may run, and where crash minidumps may be
// submitted. Lives beside shell_guards.cjs for the same reason: electron/main.cjs
// runs outside tsc and vitest, so every decision worth pinning is made here where
// tests/electron_desktop_config.test.ts can exercise it directly. No electron
// imports; callers pass everything in.
//
// The channel is stamped into the PACKAGED package.json by scripts/electron-build.mjs
// (electron-builder extraMetadata writes a `wocDesktop` object), because a shipped
// app has no build-time env: the Steam depot and the website installer are the same
// code and differ only by this stamp. WOC_DISTRIBUTION overrides it for local
// testing of either path in `electron .` / electron:dev.

const { PRODUCTION_API_ORIGIN, updateChannelForOrigin } = require('./update_guard.cjs');

const DISTRIBUTIONS = new Set(['website', 'steam']);

// Resolve the distribution channel. The WOC_DISTRIBUTION env override applies
// ONLY to unpackaged checkouts (`electron .` / electron:dev): a PACKAGED
// build's channel is its stamp, period. Honoring env on a packaged build
// would be exactly the escape hatch updaterAllowed promises not to have
// (WOC_DISTRIBUTION=website on a Steam install would flip the updater back
// on). Unknown values collapse to the default rather than throwing: a
// half-stamped build must still launch, and 'website' is the safe channel
// (its only extra behavior, the updater, is additionally gated on isPackaged).
function resolveDistribution({ packagedMetadata, env, isPackaged } = {}) {
  const fromEnv = env?.WOC_DISTRIBUTION;
  if (isPackaged !== true && typeof fromEnv === 'string' && DISTRIBUTIONS.has(fromEnv)) {
    return fromEnv;
  }
  const stamped = packagedMetadata?.wocDesktop?.distribution;
  if (typeof stamped === 'string' && DISTRIBUTIONS.has(stamped)) return stamped;
  return 'website';
}

// The crash-minidump submit URL, if the maintainer provisioned one at build
// time (stamped like the distribution). WOC_CRASH_SUBMIT_URL is a DEV-ONLY
// override, ignored on packaged builds for the same reason as the channel:
// minidumps carry process memory, so a local env var must not be able to
// redirect where an installed app uploads them. Only https: is accepted;
// empty string means "keep dumps local only".
function resolveCrashSubmitUrl({ packagedMetadata, env, isPackaged } = {}) {
  const candidates =
    isPackaged === true
      ? [packagedMetadata?.wocDesktop?.crashSubmitUrl]
      : [env?.WOC_CRASH_SUBMIT_URL, packagedMetadata?.wocDesktop?.crashSubmitUrl];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol === 'https:') return candidate;
  }
  return '';
}

// The web origins the shell trusts: the API origin (REST + WebSocket; it feeds
// the app:// CSP connect-src) and the origin openDesktopLogin() sends the
// player's browser to for credential entry. Both are stamped at build time by
// scripts/electron-build.mjs (apiOrigin also feeds the Vite client build, so
// the packaged main process always agrees with the baked bundle; loginOrigin
// is main-process-only), because a packaged build honoring VITE_DESKTOP_* from
// runtime env would let a local env var widen the CSP or redirect the login
// page: the same escape hatch resolveDistribution and resolveCrashSubmitUrl
// close. Env applies to unpackaged checkouts only. Values are picked, not
// sanitized; the caller (electron/main.cjs) still derives/normalizes them
// before use, so a garbage stamp degrades to the production origin there.
function resolveDesktopOrigins({ packagedMetadata, env, isPackaged } = {}) {
  const stamped = packagedMetadata?.wocDesktop ?? {};
  const pick = (envValue, stampedValue) => {
    if (isPackaged !== true && typeof envValue === 'string' && envValue !== '') return envValue;
    if (typeof stampedValue === 'string' && stampedValue !== '') return stampedValue;
    return '';
  };
  const apiOrigin = pick(env?.VITE_DESKTOP_API_ORIGIN, stamped.apiOrigin) || PRODUCTION_API_ORIGIN;
  const loginOrigin = pick(env?.VITE_DESKTOP_LOGIN_ORIGIN, stamped.loginOrigin) || apiOrigin;
  return { apiOrigin, loginOrigin };
}

// The one gate the auto-updater honors. Steam builds MUST NOT self-update
// (SteamPipe owns updates; Valve's guidance is explicit), and an unpackaged
// checkout has nothing to update, so the updater runs only for a packaged
// website build. There is deliberately no env escape hatch to force it ON in
// a Steam build; WOC_DISTRIBUTION=website on a dev checkout still stays off
// via isPackaged.
function updaterAllowed({ distribution, isPackaged }) {
  return isPackaged === true && distribution === 'website';
}

// One-call summary used by electron/main.cjs at startup. updateChannel is a
// pure function of the resolved apiOrigin (electron/update_guard.cjs): there
// is deliberately no stamp and no env hatch for it, so a build baked with a
// non-production origin can never read the production update feed, however it
// was stamped or launched.
function resolveDesktopConfig({ packagedMetadata, env, isPackaged } = {}) {
  const distribution = resolveDistribution({ packagedMetadata, env, isPackaged });
  const origins = resolveDesktopOrigins({ packagedMetadata, env, isPackaged });
  return {
    distribution,
    updaterEnabled: updaterAllowed({ distribution, isPackaged }),
    crashSubmitUrl: resolveCrashSubmitUrl({ packagedMetadata, env, isPackaged }),
    updateChannel: updateChannelForOrigin(origins.apiOrigin),
    ...origins,
  };
}

module.exports = {
  resolveDistribution,
  resolveCrashSubmitUrl,
  resolveDesktopOrigins,
  updaterAllowed,
  resolveDesktopConfig,
};

'use strict';

// Pure, Node-testable guard logic for the auto-updater's prod/dev track split
// (tests/electron_update_guard.test.ts). One origin rule decides everything: a
// build baked with the production API origin lives on the 'latest' update
// channel (the feed production installs have always read), and a build baked
// with ANY other origin (dev, staging, a localhost smoke-test pack) lives on
// the 'dev' channel, whose feed files (dev-mac.yml, dev.yml, dev-linux*.yml) a
// production install never requests. scripts/electron-builder-config.mjs
// imports the same rule at build time, so the channel a build publishes to and
// the channel it reads at runtime cannot drift apart.
//
// evaluateUpdateOffer is the runtime defense in depth behind that split: the
// build stamps every emitted feed file with the API origin its artifact was
// baked with (wocApiOrigin, scripts/electron-build.mjs), and
// electron/updater.cjs refuses to download an update whose stamp differs from
// this install's own origin, so a feed file renamed or uploaded onto the wrong
// track still cannot flip a shipped app to another backend. No electron
// imports; callers pass everything in.

const PRODUCTION_API_ORIGIN = 'https://worldofclaudecraft.com';

// Normalize an origin-ish string to its URL origin so 'https://x.com' and
// 'https://x.com/' compare equal; null when the value is not a parseable
// http(s) URL.
function apiOriginKey(value) {
  if (typeof value !== 'string' || value === '') return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed.origin;
}

function isProductionApiOrigin(origin) {
  return apiOriginKey(origin) === PRODUCTION_API_ORIGIN;
}

// The electron-updater channel for a build baked with this API origin. Only
// the exact production origin earns the production channel; anything else,
// including a missing or garbage value, fails safe onto 'dev'.
function updateChannelForOrigin(apiOrigin) {
  return isProductionApiOrigin(apiOrigin) ? 'latest' : 'dev';
}

// Decide whether an offered update (electron-updater's UpdateInfo, which is
// the parsed feed yml, so the wocApiOrigin stamp rides along) may be
// downloaded by an install whose own baked origin is apiOrigin. Feed files
// published before the track split carry no stamp and are accepted
// (stamped: false); a present stamp must match exactly, and an unverifiable
// side (garbage stamp, garbage own origin) refuses rather than guesses.
function evaluateUpdateOffer({ apiOrigin, info } = {}) {
  const offered = info?.wocApiOrigin;
  if (offered === undefined || offered === null || offered === '') {
    return { ok: true, stamped: false };
  }
  const offeredKey = apiOriginKey(offered);
  const ownKey = apiOriginKey(apiOrigin);
  if (offeredKey !== null && ownKey !== null && offeredKey === ownKey) {
    return { ok: true, stamped: true };
  }
  return {
    ok: false,
    stamped: true,
    offeredOrigin: typeof offered === 'string' ? offered : String(offered),
    expectedOrigin: typeof apiOrigin === 'string' ? apiOrigin : String(apiOrigin),
  };
}

module.exports = {
  PRODUCTION_API_ORIGIN,
  apiOriginKey,
  isProductionApiOrigin,
  updateChannelForOrigin,
  evaluateUpdateOffer,
};

'use strict';

// The desktop shell's ONLY Steam surface: producing a link ticket for the
// account-link handshake (POST /api/steam/link verifies it server-side).
// Lives beside desktop_config.cjs for the same reason: every decision worth
// pinning is made here, Node-testable with injected fakes, and
// electron/main.cjs stays a thin consumer.
//
// steamworks.js is lazily required ONLY when this build is the Steam
// distribution (or the unpackaged dev override below): website builds never
// load or initialize Steam, and the packaged Steam depot build is the only
// artifact that ships the native module (scripts/electron-builder-config.mjs
// includes node_modules/steamworks.js/** for the steam channel alone).
//
// No steam_appid.txt anywhere: init(appId) passes the id directly, the dev
// loop uses the Spacewar fallback below, and the packaged build.files
// whitelist (dist/electron/icons/package.json) could not ship a stray root
// file even if one existed.

/** Valve's public test app (Spacewar): the dev-loop fallback app id. */
const SPACEWAR_APP_ID = 480;

/** The identity string the link ticket is bound to. MUST equal
 *  TICKET_IDENTITY in server/steam/ticket.ts (the server verifies with the
 *  same value); both sides pin the literal in their tests. */
const LINK_TICKET_IDENTITY = 'wocc-link';

// Whether this build may touch Steam at all. The env override applies ONLY to
// unpackaged checkouts (`electron .` / electron:dev with WOC_STEAM_DEV=1): a
// PACKAGED build's answer is its distribution stamp, period, mirroring the
// WOC_DISTRIBUTION hatch closure in desktop_config.cjs (a local env var must
// not be able to make an installed website build load native Steam code).
function steamIntegrationEnabled({ distribution, env, isPackaged } = {}) {
  if (distribution === 'steam') return true;
  return isPackaged !== true && env?.WOC_STEAM_DEV === '1';
}

// The app id init() is called with: the wocDesktop stamp (written by
// electron-builder extraMetadata for a real Steam depot build), else the
// WOC_STEAM_APP_ID env override on unpackaged checkouts, else Spacewar. A
// garbage stamp degrades to the dev fallback rather than throwing: a
// half-stamped build must still launch (only its Steam features degrade).
function resolveSteamAppId({ packagedMetadata, env, isPackaged } = {}) {
  // Both string branches hold the number branch's > 0 bar: app id 0 is not a
  // real Steam app, so a "0" stamp or env override is garbage and degrades to
  // the dev fallback like any other malformed id.
  const stamped = packagedMetadata?.wocDesktop?.steamAppId;
  if (typeof stamped === 'number' && Number.isInteger(stamped) && stamped > 0) return stamped;
  if (typeof stamped === 'string' && /^\d+$/.test(stamped) && Number(stamped) > 0) {
    return Number(stamped);
  }
  if (isPackaged !== true) {
    const fromEnv = env?.WOC_STEAM_APP_ID;
    if (typeof fromEnv === 'string' && /^\d+$/.test(fromEnv) && Number(fromEnv) > 0) {
      return Number(fromEnv);
    }
  }
  return SPACEWAR_APP_ID;
}

/**
 * Build the shell's Steam facade. `requireSteamworks` is injectable for tests;
 * production passes nothing and gets the real lazy require. The returned
 * getLinkTicket() NEVER throws (it answers null on every failure path), so
 * the IPC handler can hand its result straight across the bridge.
 */
function createSteamShell({
  distribution,
  packagedMetadata,
  env,
  isPackaged,
  log,
  requireSteamworks,
} = {}) {
  const enabled = steamIntegrationEnabled({ distribution, env, isPackaged });
  const appId = resolveSteamAppId({ packagedMetadata, env, isPackaged });
  const loadSteamworks = requireSteamworks ?? (() => require('steamworks.js'));
  let client = null;
  let lastTicket = null;

  // Cancelling must never break the ticket path (the never-throws contract
  // below): the handle may lack cancel() and cancel itself may throw; either
  // way the worst outcome is one dangling handle until process exit.
  function cancelQuietly(ticket) {
    try {
      ticket?.cancel?.();
    } catch {}
  }

  // Deliberately NOT latched on failure: init throws when Steam is not
  // running, and the player may start Steam and click Link again, so every
  // call retries. The call sites are manual clicks behind the server's link
  // rate limit, so re-init cost is never hot-path cost.
  function clientOrNull() {
    if (!enabled) return null;
    if (client) return client;
    try {
      client = loadSteamworks().init(appId);
    } catch (err) {
      log?.warn?.('[steam] init failed (is Steam running?)', err?.message ?? err);
      return null;
    }
    return client;
  }

  // The hex form of a web-api auth ticket bound to the link identity, or null
  // (integration off, Steam not running, or the ticket call failed). Handles
  // are kept to at most one live per session: the renderer awaits the server's
  // verify (POST /api/steam/link) and then signals completion, so the live
  // handle is normally cancelled the moment the attempt settles
  // (cancelLinkTicket below, wired to the desktop-steam-link-settled IPC). As a
  // fallback the live handle is also cancelled when the NEXT mint supersedes it
  // (a renderer too old to signal), an empty-bytes ticket (never sent to the
  // server) is cancelled on the spot, and the final handle dies with the Steam
  // session at process exit.
  async function getLinkTicket() {
    try {
      if (lastTicket) {
        cancelQuietly(lastTicket);
        lastTicket = null;
      }
      const c = clientOrNull();
      if (!c || typeof c.auth?.getAuthTicketForWebApi !== 'function') return null;
      const ticket = await c.auth.getAuthTicketForWebApi(LINK_TICKET_IDENTITY);
      const bytes = typeof ticket?.getBytes === 'function' ? ticket.getBytes() : null;
      if (!bytes || bytes.length === 0) {
        cancelQuietly(ticket);
        return null;
      }
      lastTicket = ticket;
      return Buffer.from(bytes).toString('hex');
    } catch (err) {
      // Never throw across IPC; a failed ticket is just "no ticket".
      log?.warn?.('[steam] link ticket failed', err?.message ?? err);
      return null;
    }
  }

  // Release the live link ticket once the renderer reports the attempt settled
  // (server verify resolved or rejected): Valve's contract wants
  // CancelAuthTicket when the ticket is done with, rather than the handle
  // lingering to the next mint or process exit. Idempotent and never throws (the
  // never-throws contract): a repeat signal, or one with no live handle
  // (integration off, website build, a null/empty mint), is a no-op.
  function cancelLinkTicket() {
    cancelQuietly(lastTicket);
    lastTicket = null;
  }

  return { enabled, appId, getLinkTicket, cancelLinkTicket };
}

module.exports = {
  SPACEWAR_APP_ID,
  LINK_TICKET_IDENTITY,
  steamIntegrationEnabled,
  resolveSteamAppId,
  createSteamShell,
};

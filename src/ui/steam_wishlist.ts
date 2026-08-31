import type { DesktopBridge } from '../runtime';
import { desktopBridge } from '../runtime';

// The "Wishlist on Steam" reminder: one quiet, permanently visible link to the
// store page, repeated on every shell surface that already carries the Donate
// call to action (homepage header, homepage footer, the in-game community rail,
// and the mobile More tray).
//
// Sibling of steam_link.ts, and deliberately NOT part of it: that module is the
// authed account-link card (deeds mirrored into Steam achievements) and depends
// on a server capability advert, while this one is a static outbound link that
// must render before login, offline, and on a dark server. The only thing the
// two share is the Steam mark in ui_icons.ts.
//
// This module owns the store URL and the one decision worth pinning: WHO must
// never see the reminder. Markup lives in index.html / play.html (both entries,
// byte-identical blocks, pinned by tests/steam_wishlist.test.ts) and the
// styling in hud.css / shell.css, so nothing here builds DOM.

/** Valve app id for World of ClaudeCraft. */
export const STEAM_APP_ID = 4897790;

/** The store page every wishlist surface links out to. */
export const STEAM_WISHLIST_URL = `https://store.steampowered.com/app/${STEAM_APP_ID}/World_of_ClaudeCraft/`;

/**
 * Body class the stylesheet hides every wishlist surface behind. The native-app
 * suppression is static CSS (body.native-app, alongside Donate); this one needs
 * a runtime answer from the desktop shell, so it arrives as a class instead.
 */
export const STEAM_BUILD_BODY_CLASS = 'steam-build';

/**
 * Fail-closed boot class stamped in both entry documents. Website builds clear
 * it as soon as the (missing) desktop probe resolves; Steam builds keep the
 * reminder hidden by replacing it with STEAM_BUILD_BODY_CLASS. This prevents a
 * one-frame wishlist flash while the desktop shell answers asynchronously.
 */
export const STEAM_WISHLIST_PENDING_BODY_CLASS = 'steam-wishlist-pending';

/**
 * Whether the reminder must stay hidden for this client. Pure so the policy is
 * testable without a DOM or a shell.
 *
 * - `steamBuild`: this IS the Steam distribution of the desktop app, so the
 *   player already owns the game on Steam and a wishlist prompt is noise.
 * - `nativeApp`: the iOS / Android shells, which hide outbound store links the
 *   same way they already hide Donate.
 */
export function steamWishlistSuppressed(env: { nativeApp: boolean; steamBuild: boolean }): boolean {
  return env.nativeApp || env.steamBuild;
}

/** The only slice of the desktop bridge this module reads. */
export type SteamDistributionProbe = Pick<DesktopBridge, 'steamLinkSupported'>;

/**
 * Whether the desktop shell reports itself as the Steam distribution.
 *
 * Unlike steam_link.ts's ticket capability, a MISSING probe answers false here:
 * the two failure directions are not symmetric. Hiding the reminder from every
 * website desktop build (the older-shell case) costs far more than showing it
 * once to a Steam player, so absence degrades to "show it".
 */
export async function isSteamDistribution(bridge: SteamDistributionProbe | null): Promise<boolean> {
  if (typeof bridge?.steamLinkSupported !== 'function') return false;
  try {
    return (await bridge.steamLinkSupported()) === true;
  } catch {
    return false;
  }
}

/**
 * Resolve the fail-closed boot state once. Web and native clients have no
 * bridge and reveal immediately; only the desktop shell waits for an answer.
 */
export async function syncSteamWishlistVisibility(
  desktopApp: boolean,
  bridge: SteamDistributionProbe | null = desktopApp ? desktopBridge() : null,
  body: { classList: { toggle(token: string, force: boolean): unknown } } | null = globalThis
    .document?.body ?? null,
): Promise<void> {
  if (!body) return;
  body.classList.toggle(STEAM_BUILD_BODY_CLASS, await isSteamDistribution(bridge));
  body.classList.toggle(STEAM_WISHLIST_PENDING_BODY_CLASS, false);
}

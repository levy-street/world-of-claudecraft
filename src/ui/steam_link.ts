import type { Api } from '../net/online';
import { DESKTOP_APP } from '../net/online';
import type { DesktopBridge } from '../runtime';
import { desktopBridge } from '../runtime';
import { userFacingApiError } from './api_error_i18n';
import { t } from './i18n';

// Steam account link (the deeds achievement mirror), a stacked card beside the
// GitHub one. Entirely capability-driven: the group renders ONLY when the
// server's /api/status advert says the Steam surface is lit, so a dark server
// shows nothing anywhere. Linking needs a Steam session ticket, which only the
// desktop shell can mint (wocDesktop.steamLinkTicket); the web build shows
// link status and Unlink only.
//
// Extracted from main.ts so the client entry stays a firewall; the shell ids
// referenced here exist only in index.html, so every lookup keeps tolerating
// absence (main.ts is shared with play.html).

// Flash a message into the Steam status line for 4s, then restore whatever it
// was showing (the flashGithubError shape in main.ts, targeting #steam-status).
function flashSteamStatus(message: string): void {
  const statusEl = document.getElementById('steam-status');
  if (!statusEl) return;
  const previousText = statusEl.textContent;
  const previousHidden = statusEl.hidden;
  statusEl.textContent = message;
  statusEl.hidden = false;
  window.setTimeout(() => {
    if (statusEl.textContent !== message) return; // a real status refresh already overwrote it
    statusEl.textContent = previousText;
    statusEl.hidden = previousHidden;
  }, 4000);
}

// Whether the shell can actually mint a link ticket. Method presence alone is
// not capability: every Electron shell exposes steamLinkTicket, including
// packaged website builds where a ticket can never exist, so the shell's real
// answer (wocDesktop.steamLinkSupported) decides. Older shells predate the
// probe; there the ticket method's presence stays the answer (the renderer is
// served live, shells lag behind it).
async function steamTicketCapability(bridge: DesktopBridge | null): Promise<boolean> {
  if (typeof bridge?.steamLinkTicket !== 'function') return false;
  if (typeof bridge.steamLinkSupported !== 'function') return true;
  try {
    return (await bridge.steamLinkSupported()) === true;
  } catch {
    return true;
  }
}

export async function refreshSteamLinkStatus(api: Api): Promise<void> {
  const group = document.getElementById('cs-steam-group');
  if (!group) return;
  if (!api.token) {
    group.hidden = true;
    return;
  }
  // The public capability advert gates everything below; without it no
  // authed steam call is even attempted.
  if (!(await api.steamAdvert())) {
    group.hidden = true;
    return;
  }
  let status: Record<string, unknown> | null = null;
  try {
    status = await api.steamStatus();
  } catch (err) {
    console.error('[steam] could not load status', err);
  }
  if (!status || status.enabled !== true) {
    group.hidden = true;
    return;
  }
  group.hidden = false;
  const linked = status.linked === true;
  const steamId = typeof status.steamId === 'string' ? status.steamId : '';
  const statusEl = document.getElementById('steam-status');
  if (statusEl) {
    if (linked) {
      statusEl.textContent = t('hudChrome.steam.linked', { id: steamId });
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
  }
  const bridge = DESKTOP_APP ? desktopBridge() : null;
  const canMintTicket = await steamTicketCapability(bridge);
  const linkBtn = document.getElementById('btn-steam-link');
  if (linkBtn) linkBtn.hidden = linked || !canMintTicket;
  const unlinkBtn = document.getElementById('btn-steam-unlink');
  if (unlinkBtn) unlinkBtn.hidden = !linked;
}

// One link attempt at a time: without the latch a double click mints a second
// ticket, which makes the shell cancel the first handle while the server may
// still be verifying it, and strands the second handle uncancelled (the shell
// reads its last-ticket slot before the mint await resolves). The latch drops
// re-entry until the whole attempt settles.
let linkInFlight = false;

async function startSteamLink(api: Api): Promise<void> {
  if (linkInFlight) return;
  linkInFlight = true;
  try {
    const bridge = DESKTOP_APP ? desktopBridge() : null;
    if (typeof bridge?.steamLinkTicket !== 'function') return;
    if (!(await steamTicketCapability(bridge))) return;
    let ticket: string | null = null;
    try {
      ticket = await bridge.steamLinkTicket();
    } catch {
      ticket = null;
    }
    if (!ticket) {
      flashSteamStatus(t('hudChrome.steam.noTicket'));
      return;
    }
    try {
      await api.steamLink(ticket);
    } catch (err) {
      // Refresh BEFORE flashing. The unlinked branch of refreshSteamLinkStatus
      // toggles #steam-status hidden, and the flash's restore guard only
      // protects a textContent overwrite, not the hidden toggle; a refresh
      // fired after the flash would hide the error within a frame. Refreshing
      // first keeps the panel truthful (e.g. an already_linked race) and lets
      // the flash own the last write, so the error survives its full 4s.
      await refreshSteamLinkStatus(api).catch(() => {});
      flashSteamStatus(userFacingApiError(err));
      return;
    }
    void refreshSteamLinkStatus(api);
  } finally {
    linkInFlight = false;
    // Tell the shell the attempt has settled (success or failure) so it can
    // cancel the Steam auth ticket promptly (Valve's CancelAuthTicket contract)
    // instead of the handle lingering to the next mint or process exit.
    // Optional-chained and swallowed: an older shell without the bridge method,
    // or a web build (bridge null), is a no-op, and the shell's cancel is
    // idempotent.
    const bridge = DESKTOP_APP ? desktopBridge() : null;
    try {
      await bridge?.steamLinkSettled?.();
    } catch {
      // A settle-signal failure must never surface to the player.
    }
  }
}

export function wireSteamLink(api: Api): void {
  document.getElementById('btn-steam-link')?.addEventListener('click', () => {
    void startSteamLink(api);
  });
  document.getElementById('btn-steam-unlink')?.addEventListener('click', () => {
    void api
      .unlinkSteam()
      .then(() => refreshSteamLinkStatus(api))
      .catch((err) => {
        // Dev-channel log stays English; the player gets the localized reason.
        // An unlink failure was previously silent (console-only, no feedback).
        console.error('[steam] unlink failed', err);
        flashSteamStatus(userFacingApiError(err));
      });
  });
  void refreshSteamLinkStatus(api);
}

import type { Api } from '../net/online';
import { DESKTOP_APP } from '../net/online';
import type { DesktopBridge } from '../runtime';
import { desktopBridge } from '../runtime';
import { userFacingApiError } from './api_error_i18n';
import { t } from './i18n';

// Epic account link (the deeds achievement mirror), a stacked card beside the
// Steam one. Entirely capability-driven: the group renders ONLY when the
// server's /api/status advert says the Epic surface is lit, so a dark server
// shows nothing anywhere (D3, D18). Linking needs a shell-minted proof
// (wocDesktop.epicLinkProof); the web / website / steam shells show link
// status and Unlink only. Never a sign-in method (D2).
//
// Twin of steam_link.ts. Extracted so the client entry stays a firewall; the
// shell ids referenced here exist only in index.html / play.html, so every
// lookup keeps tolerating absence.

// Flash a message into the Epic status line for 4s, then restore whatever it
// was showing (the flashSteamStatus shape, targeting #epic-status).
function flashEpicStatus(message: string): void {
  const statusEl = document.getElementById('epic-status');
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

// Whether the shell can actually mint a link proof. Method presence alone is
// not capability: every Electron shell may expose epicLinkProof, including
// packaged website/steam builds where a proof can never exist, so the shell's
// real answer (wocDesktop.epicLinkSupported) decides. Older shells predate the
// probe; there the proof method's presence stays the answer (the renderer is
// served live, shells lag behind it).
async function epicProofCapability(bridge: DesktopBridge | null): Promise<boolean> {
  if (typeof bridge?.epicLinkProof !== 'function') return false;
  if (typeof bridge.epicLinkSupported !== 'function') return true;
  try {
    return (await bridge.epicLinkSupported()) === true;
  } catch {
    return true;
  }
}

export async function refreshEpicLinkStatus(api: Api): Promise<void> {
  const group = document.getElementById('cs-epic-group');
  if (!group) return;
  if (!api.token) {
    group.hidden = true;
    return;
  }
  // The public capability advert gates everything below; without it no
  // authed epic call is even attempted (D18).
  if (!(await api.epicAdvert())) {
    group.hidden = true;
    return;
  }
  let status: Record<string, unknown> | null = null;
  try {
    status = await api.epicStatus();
  } catch (err) {
    console.error('[epic] could not load status', err);
  }
  if (!status || status.enabled !== true) {
    group.hidden = true;
    return;
  }
  group.hidden = false;
  const linked = status.linked === true;
  const epicAccountId = typeof status.epicAccountId === 'string' ? status.epicAccountId : '';
  const statusEl = document.getElementById('epic-status');
  if (statusEl) {
    if (linked) {
      statusEl.textContent = t('hudChrome.epic.linked', { id: epicAccountId });
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
  }
  const bridge = DESKTOP_APP ? desktopBridge() : null;
  const canMintProof = await epicProofCapability(bridge);
  const linkBtn = document.getElementById('btn-epic-link');
  if (linkBtn) linkBtn.hidden = linked || !canMintProof;
  const unlinkBtn = document.getElementById('btn-epic-unlink');
  if (unlinkBtn) unlinkBtn.hidden = !linked;
}

// One link attempt at a time: without the latch a double click mints a second
// proof, which makes the shell cancel the first handle while the server may
// still be verifying it, and strands the second handle uncancelled. The latch
// drops re-entry until the whole attempt settles.
let linkInFlight = false;

async function startEpicLink(api: Api): Promise<void> {
  if (linkInFlight) return;
  linkInFlight = true;
  try {
    const bridge = DESKTOP_APP ? desktopBridge() : null;
    if (typeof bridge?.epicLinkProof !== 'function') return;
    if (!(await epicProofCapability(bridge))) return;
    let proof: string | null = null;
    try {
      proof = await bridge.epicLinkProof();
    } catch {
      proof = null;
    }
    if (!proof) {
      flashEpicStatus(t('hudChrome.epic.noProof'));
      return;
    }
    try {
      await api.epicLink(proof);
    } catch (err) {
      // Refresh BEFORE flashing. The unlinked branch of refreshEpicLinkStatus
      // toggles #epic-status hidden, and the flash's restore guard only
      // protects a textContent overwrite, not the hidden toggle; a refresh
      // fired after the flash would hide the error within a frame. Refreshing
      // first keeps the panel truthful (e.g. an already_linked race) and lets
      // the flash own the last write, so the error survives its full 4s.
      await refreshEpicLinkStatus(api).catch(() => {});
      flashEpicStatus(userFacingApiError(err));
      return;
    }
    void refreshEpicLinkStatus(api);
  } finally {
    linkInFlight = false;
    // Tell the shell the attempt has settled (success or failure) so it can
    // cancel any cancelable adapter handle. Optional-chained and swallowed:
    // an older shell without the bridge method, or a web build (bridge null),
    // is a no-op, and the shell's cancel is idempotent (D9).
    const bridge = DESKTOP_APP ? desktopBridge() : null;
    try {
      await bridge?.epicLinkSettled?.();
    } catch {
      // A settle-signal failure must never surface to the player.
    }
  }
}

export function wireEpicLink(api: Api): void {
  document.getElementById('btn-epic-link')?.addEventListener('click', () => {
    void startEpicLink(api);
  });
  document.getElementById('btn-epic-unlink')?.addEventListener('click', () => {
    void api
      .unlinkEpic()
      .then(() => refreshEpicLinkStatus(api))
      .catch((err) => {
        // Dev-channel log stays English; the player gets the localized reason.
        console.error('[epic] unlink failed', err);
        flashEpicStatus(userFacingApiError(err));
      });
  });
  void refreshEpicLinkStatus(api);
}

// The Discord OAuth client flow (login AND in-game link/relink), web popup and
// native handoff alike. Extracted out of src/main.ts (the firewall, not a home
// for this) behind a small injected deps bag so it needs no ClientWorld/socket
// state; see src/net/CLAUDE.md "Sibling modules".
//
// LOGIN failures surface on the pre-game auth screen's #login-error line, which
// is invisible once the player is in the game. A LINK (relink) attempt, by
// contrast, is always initiated FROM in-game (the Discord HUD panel, or the
// character-select "link your account" CTA before entering online play), so its
// failures are tracked here as a transient flag the panel reads instead
// (discordLinkErrorActive) and the caller re-renders through onLinkPanelUpdate.
// Routing every failure through #login-error regardless of mode was the bug: a
// relink that failed for ANY reason (an expired popup, Discord's own "cancel",
// a rare already-linked race) looked to the player like clicking Link did
// nothing at all, because the only place the error text landed was off-screen.
import { t } from '../ui/i18n';
import { createNativeAttestationProof } from './native_attestation';
import type { NativeDiscordResult } from './native_discord';
import {
  createNativeDiscordProof,
  openNativeDiscordOAuth,
  takeNativeDiscordVerifier,
} from './native_discord';
import type { Api } from './online';
import { NATIVE_APP } from './online';

// Marks a login start so the next boot drops the player straight into online
// play (read + cleared by src/main.ts's boot sequence).
export const DISCORD_ONBOARD_KEY = 'woc_discord_onboard';

export interface DiscordOAuthFlowDeps {
  api: Api;
  /** Whether the current page is the desktop shell's OS-browser login handoff. */
  isDesktopLoginPage: () => boolean;
  /** Refresh link status + presence after a successful in-game LINK. */
  onLinkSuccess: () => void | Promise<void>;
  /** Re-render the in-game Discord panel (if open) after the link-error notice
   *  is armed or cleared, so a visible panel reflects it immediately. */
  onLinkPanelUpdate: () => void;
  /** A first-time native LOGIN has no account yet: park the verified identity so
   *  the create-new/link-existing chooser can pick it up on the next boot (the
   *  storage key stays owned by src/game/discord_login_choice.ts). */
  onNativeChoosePending: (linkToken: string, username: string) => void;
}

let discordPopup: Window | null = null;
let linkErrorActive = false;

/** Whether the in-game Discord panel should show its "could not link" notice. */
export function discordLinkErrorActive(): boolean {
  return linkErrorActive;
}

function setDiscordLinkError(active: boolean, deps: DiscordOAuthFlowDeps): void {
  linkErrorActive = active;
  deps.onLinkPanelUpdate();
}

/** The pre-game auth screen's inline error line. LOGIN mode only: it sits on
 *  #login-panel, which is hidden once the player is in the game, so a LINK
 *  failure must never route here (use setDiscordLinkError instead). Exported
 *  for the desktop-bridge login callbacks in src/main.ts, which are always
 *  login-screen failures and never go through startDiscordOAuth. */
export function showLoginDiscordError(): void {
  const el = document.getElementById('login-error');
  if (el) el.textContent = t('hudChrome.discord.link.error');
}

export function startDiscordOAuth(mode: 'login' | 'link', deps: DiscordOAuthFlowDeps): void {
  if (mode === 'login') {
    try {
      localStorage.setItem(DISCORD_ONBOARD_KEY, '1');
    } catch {
      /* storage disabled */
    }
    if (NATIVE_APP) {
      void createNativeDiscordProof()
        .then(async ({ verifier, challenge }) => {
          const attestation = await createNativeAttestationProof(deps.api.base, 'discord');
          const { url } = await deps.api.discordStart('login', true, challenge, attestation);
          await openNativeDiscordOAuth(url, verifier);
        })
        .catch((err) => {
          console.error('[discord] could not start native oauth', err);
          showLoginDiscordError();
        });
      return;
    }
    // LOGIN from the auth screen: a FULL-PAGE redirect, not a popup. The popup's
    // window.opener is severed by the cross-origin hop to Discord (COOP), so the
    // result never returns; a same-tab redirect always lands the callback, which
    // writes the session + onboard flag and reloads us into play. The desktop shell
    // opens THIS login screen at /desktop-login in the OS browser (electron/main.cjs
    // openDesktopLogin, via shell.openExternal), never inside Electron itself, so
    // NATIVE_APP/DESKTOP_APP are both false here: the signal that this is a desktop
    // handoff is the page we are ON, not the runtime. Pass it through so the callback
    // bounces back to /desktop-login (which mints the worldofclaudecraft:// deep-link
    // code, see completeDesktopBrowserLogin) instead of the plain web '/'.
    void deps.api
      .discordStart('login', false, '', undefined, deps.isDesktopLoginPage())
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((err) => {
        console.error('[discord] could not start oauth', err);
        showLoginDiscordError();
      });
    return;
  }
  // LINK (in-game): clear any stale failure notice from a prior attempt before
  // trying again, so a retry always starts from a clean panel.
  setDiscordLinkError(false, deps);
  if (NATIVE_APP) {
    void createNativeDiscordProof()
      .then(async ({ verifier, challenge }) => {
        const attestation = await createNativeAttestationProof(deps.api.base, 'discord');
        const { url } = await deps.api.discordStart('link', true, challenge, attestation);
        await openNativeDiscordOAuth(url, verifier);
      })
      .catch((err) => {
        console.error('[discord] could not start native oauth', err);
        setDiscordLinkError(true, deps);
      });
    return;
  }
  // LINK (in-game, web): keep a popup so we never navigate away from a running game.
  const popup = window.open('about:blank', 'woc-discord', 'width=520,height=720');
  discordPopup = popup;
  void deps.api
    .discordStart('link')
    .then(({ url }) => {
      if (popup) popup.location.href = url;
      else setDiscordLinkError(true, deps);
    })
    .catch((err) => {
      console.error('[discord] could not start oauth', err);
      popup?.close();
      setDiscordLinkError(true, deps);
    });
}

export async function handleNativeDiscordResult(
  result: NativeDiscordResult,
  deps: DiscordOAuthFlowDeps,
): Promise<void> {
  if (!result.ok) {
    if (result.mode === 'link') setDiscordLinkError(true, deps);
    else showLoginDiscordError();
    return;
  }
  if (result.mode === 'link') {
    takeNativeDiscordVerifier();
    setDiscordLinkError(false, deps);
    await deps.onLinkSuccess();
    return;
  }
  if (!result.code) {
    showLoginDiscordError();
    return;
  }
  const verifier = takeNativeDiscordVerifier();
  if (!verifier) {
    showLoginDiscordError();
    return;
  }
  try {
    const exchange = await deps.api.exchangeNativeDiscordCode(result.code, verifier);
    if (exchange.choose && exchange.linkToken) {
      deps.onNativeChoosePending(exchange.linkToken, exchange.username);
    } else {
      deps.api.saveSession();
    }
    window.location.reload();
  } catch (err) {
    console.error('[discord] could not exchange native login code', err);
    showLoginDiscordError();
  }
}

// Popup bounce-page result (link mode; login uses a full redirect). Same-origin
// only. Registered once by src/main.ts alongside the native handler above.
export function installDiscordPopupListener(deps: DiscordOAuthFlowDeps): void {
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== location.origin) return;
    const d = e.data as { source?: string; ok?: boolean; mode?: string } | null;
    if (d?.source !== 'woc-discord') return;
    discordPopup?.close();
    discordPopup = null;
    if (!d.ok) {
      if (d.mode === 'link') setDiscordLinkError(true, deps);
      else showLoginDiscordError();
      return;
    }
    if (d.mode === 'login') {
      window.location.reload();
      return;
    }
    // link succeeded: clear any stale notice and refresh the in-game panel.
    setDiscordLinkError(false, deps);
    void deps.onLinkSuccess();
  });
}

// The Esc menu (Game Menu): paints the pure buildOptionsMenu entries as the
// row plates and dispatches each press. Extracted from the options window
// painter (at its monolith ceiling, tests/monolith_budget.test.ts) when the
// Unlock Interface entry joined the menu, and grown here (never in the window)
// when the menu consolidated (issue #1653): the root now holds Settings, the
// help-shaped rows and the quick toggles and links that left the mobile More
// tray, while every settings category moved into the Settings view's rail.
//
// Three entry shapes paint differently. Unlock Interface and the quick
// toggles are ACTIONS that relabel themselves in place, so their paint
// outlives the click; the quick links hop out of the game. Every routing entry
// (Settings, a sub-view, the wiki hop, unstuck, logout, close) hands its action
// back to the window, which owns the view state the routing mutates.
// Named *_controller so it sits in the painter gate's cold bucket
// (tests/hud_perf_budget.test.ts) as well as in UI_DOM_MODULES.

import { audio } from '../game/audio';
import { isNativeAppShell, useTouchInterface } from '../game/mobile_controls';
import { appVersionInfo } from './app_version';
import {
  gameMenuHooks,
  gameMenuQuickState,
  openDonatePage,
  toggleMusic,
  toggleNameplates,
} from './game_menu_hooks';
import { t } from './i18n';
import { interfaceUnlockLabelKey } from './interface_unlock_core';
import {
  buildOptionsMenu,
  type GameMenuLinkId,
  type GameMenuQuickState,
  type GameMenuToggleId,
  type OptionsMenuAction,
  type OptionsMenuEntry,
} from './options_view';
import {
  STEAM_BUILD_BODY_CLASS,
  STEAM_WISHLIST_URL,
  steamWishlistSuppressed,
} from './steam_wishlist';
import { svgIcon } from './ui_icons';

/** A menu action the window routes itself (everything but the in-place
 *  actions this list runs: the unlock toggle, the quick toggles and links). */
export type OptionsMenuRoutedAction = Exclude<
  OptionsMenuAction,
  { kind: 'interfaceUnlock' } | { kind: 'toggle' } | { kind: 'link' }
>;

/** The window-side seam the list dispatches through. OptionsWindowDeps
 *  satisfies the frame-editing member structurally. */
export interface OptionsMainMenuDeps {
  /** Flip every movable HUD frame at once; returns the new unlocked state. */
  toggleInterfaceUnlock(): boolean;
  /** Route a pressed entry: the window changes view, opens the wiki, logs out,
   *  unsticks, or closes. */
  dispatch(action: OptionsMenuRoutedAction): void;
  /** Flip a quick toggle; returns the new state. Defaults to runQuickToggle. */
  toggleQuick?(id: GameMenuToggleId): boolean;
  /** Open a quick link. Defaults to openQuickLink. */
  openLink?(id: GameMenuLinkId): void;
}

/** The `.opt-list` column of row plates, one button per entry, in entry order.
 *  Consecutive quick entries sit together in one `.opt-quick` group. */
export function buildOptionsMenuList(
  entries: readonly OptionsMenuEntry[],
  deps: OptionsMainMenuDeps,
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'opt-list';
  let quick: HTMLElement | null = null;
  for (const entry of entries) {
    if (entry.group !== 'quick') {
      quick = null;
      list.appendChild(menuButton(entry, deps));
      continue;
    }
    if (!quick) {
      quick = document.createElement('div');
      quick.className = 'opt-quick';
      list.appendChild(quick);
    }
    quick.appendChild(menuButton(entry, deps));
  }
  return list;
}

/** The window's main view: the menu for this host, then the running build. */
export function paintOptionsMainMenu(
  body: HTMLElement,
  state: { bugReportAvailable: boolean; interfaceUnlocked: boolean },
  deps: OptionsMainMenuDeps,
): void {
  const entries = buildOptionsMenu({
    bugReportAvailable: state.bugReportAvailable,
    // Frame editing is desktop-only: the same gate as the Frames tab's row,
    // and the same union that raises the touch HUD (mobile_controls
    // setActive), which is what Hud.toggleInterfaceUnlock refuses on.
    interfaceUnlockAvailable: !(useTouchInterface() || isNativeAppShell()),
    interfaceUnlocked: state.interfaceUnlocked,
    quick: currentQuickState(),
  });
  body.appendChild(buildOptionsMenuList(entries, deps));
  // Running build, as small secondary text at the foot of the menu, so players can
  // confirm their version without leaving the settings window (issue 1541).
  const { version, build } = appVersionInfo();
  const ver = document.createElement('div');
  ver.className = 'opt-version';
  ver.textContent = t('hudChrome.options.version', { version, build });
  body.appendChild(ver);
}

/** The quick group for this host, or undefined before main.ts attaches its
 *  hooks. Donate and the wishlist follow the tray's own visibility policy. */
export function currentQuickState(): GameMenuQuickState | undefined {
  const hooks = gameMenuHooks();
  if (!hooks) return undefined;
  const nativeApp = isNativeAppShell();
  return gameMenuQuickState(hooks, {
    nativeApp,
    steamWishlistSuppressed: steamWishlistSuppressed({
      nativeApp,
      steamBuild: document.body.classList.contains(STEAM_BUILD_BODY_CLASS),
    }),
  });
}

/** Flip a quick toggle through the SAME action the More tray ran. */
export function runQuickToggle(id: GameMenuToggleId): boolean {
  if (id === 'music') return toggleMusic();
  const hooks = gameMenuHooks();
  if (!hooks) return false;
  return id === 'nameplates' ? toggleNameplates(hooks.nameplates) : hooks.haptics.toggleHaptics();
}

/** Open a quick link through the SAME action the More tray ran. */
export function openQuickLink(id: GameMenuLinkId): void {
  if (id === 'discord') gameMenuHooks()?.discord?.();
  else if (id === 'donate') openDonatePage();
  else window.open(STEAM_WISHLIST_URL, '_blank', 'noopener,noreferrer');
}

function menuButton(entry: OptionsMenuEntry, deps: OptionsMainMenuDeps): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ui-btn opt-btn';
  b.textContent = t(entry.labelKey);
  const a = entry.action;
  // A stable, label-free hook for the capture rigs and browser suites (the
  // sub-view id for a routing row, the toggle or link id for a quick row, the
  // action kind otherwise): the list's order shifts by host, so an index is not.
  b.dataset.menuAction =
    a.kind === 'goto'
      ? a.view
      : a.kind === 'toggle'
        ? a.toggle
        : a.kind === 'link'
          ? a.link
          : a.kind;
  if (a.kind === 'interfaceUnlock') {
    wireInterfaceUnlock(b, a.unlocked, deps);
    return b;
  }
  if (a.kind === 'toggle') {
    wireQuickToggle(b, a.toggle, a.on, deps);
    return b;
  }
  if (a.kind === 'link') {
    wireQuickLink(b, a.link, deps);
    return b;
  }
  if (a.kind === 'close') b.classList.add('ui-btn--red', 'ui-btn--lg');
  if (a.kind === 'logout') b.classList.add('opt-btn-hostile');
  if (a.kind === 'wiki' || a.kind === 'settings') appendChevron(b);
  if (a.kind === 'goto' && a.view === 'bugreport') {
    const status = document.createElement('span');
    status.className = 'opt-btn-status ui-muted';
    status.textContent = t('hudChrome.bugReport.online');
    status.setAttribute('aria-hidden', 'true');
    b.setAttribute('aria-label', `${t(entry.labelKey)}: ${t('hudChrome.bugReport.online')}`);
    b.appendChild(status);
  }
  b.addEventListener('click', () => {
    audio.click();
    deps.dispatch(a);
  });
  return b;
}

function appendChevron(b: HTMLButtonElement): void {
  const chevron = document.createElement('span');
  chevron.className = 'opt-btn-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = svgIcon('next');
  b.appendChild(chevron);
}

// A quick toggle: the label stays the setting's name and the state rides
// aria-pressed (announced as "Nameplates, toggle button, pressed") plus a
// visible On/Off status, so neither sighted nor screen-reader players guess.
// A press repaints from the seam's ANSWER, never an assumed flip, exactly as
// the Unlock Interface row does. The menu stays open: these are settings.
function wireQuickToggle(
  b: HTMLButtonElement,
  id: GameMenuToggleId,
  on: boolean,
  deps: OptionsMainMenuDeps,
): void {
  b.classList.add('opt-btn-toggle');
  const status = document.createElement('span');
  status.className = 'opt-btn-status ui-muted';
  status.setAttribute('aria-hidden', 'true');
  b.appendChild(status);
  const sync = (isOn: boolean) => {
    b.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    b.classList.toggle('ui-btn--on', isOn);
    status.textContent = t(isOn ? 'hud.options.on' : 'hud.options.off');
  };
  sync(on);
  b.addEventListener('click', () => {
    audio.click();
    sync((deps.toggleQuick ?? runQuickToggle)(id));
  });
}

// A quick link: the same outbound hop the More tray pill made. The Steam row
// carries the shared `.steam-wishlist` class so the stylesheet's own
// suppression (pending, Steam build, native app) hides it exactly as it hides
// every other wishlist surface; its accessible name is the tray's, which opens
// with the visible label (WCAG 2.5.3).
function wireQuickLink(b: HTMLButtonElement, id: GameMenuLinkId, deps: OptionsMainMenuDeps): void {
  appendChevron(b);
  if (id === 'steamWishlist') {
    b.classList.add('steam-wishlist');
    b.setAttribute('aria-label', t('hudChrome.steam.wishlistAria'));
  } else if (id === 'donate') {
    b.setAttribute('aria-label', t('a11y.donateProject'));
  }
  b.addEventListener('click', () => {
    audio.click();
    (deps.openLink ?? openQuickLink)(id);
  });
}

// "Unlock interface" as a menu row: the same press-and-repaint contract as the
// Frames tab's row. The establishing paint follows the state the entry was
// built from (one source, the core); a press repaints from the seam's ANSWER
// (the mobile backstop refuses and answers false), never from an assumed flip,
// so the menu can never claim the frames are loose when they are not. The
// on-state is the library's declared .ui-btn--on fill: the label already
// states the NEXT action, so the row carries no aria-pressed (which would
// announce "Lock interface, pressed" for an unlocked interface). The menu stays
// open, exactly as the Frames tab does after its press: the floating Lock
// Interface control is the mode's own exit.
function wireInterfaceUnlock(
  b: HTMLButtonElement,
  unlocked: boolean,
  deps: OptionsMainMenuDeps,
): void {
  const sync = (isUnlocked: boolean) => {
    b.textContent = t(interfaceUnlockLabelKey(isUnlocked));
    b.classList.toggle('ui-btn--on', isUnlocked);
  };
  sync(unlocked);
  b.addEventListener('click', () => {
    audio.click();
    sync(deps.toggleInterfaceUnlock());
  });
}

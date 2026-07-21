// Browser-notice bootstrap: resolves detection, creates the dismissible
// toast DOM, wires the dismiss + download link, and persists the dismissal
// across sessions. main.ts stays a firewall: it only calls initBrowserNotice()
// once at startup. Lives in src/game so the DOM consumer lives alongside
// sibling notices (software_render_notice.ts pattern).

import {
  type BrowserNoticeState,
  dismissBrowserNotice,
  resolveBrowserNotice,
} from '../ui/browser_notice_view';
import { t } from '../ui/i18n';
import { detectBrowserKind } from './browser_detect';
import { desktopDownloadUrl, detectDesktopPlatform } from './desktop_download';

const DISMISSED_KEY = 'woc_browser_notice_dismissed';

function readDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage unavailable: in-memory dismissal still hides it this session.
  }
}

/**
 * Call once at startup, AFTER the desktop/native shell guards have been
 * checked (DESKTOP_APP / NATIVE_APP). Inside a bundled shell the browser
 * detection is irrelevant (they bundle Chromium), so those paths skip
 * this call entirely.
 *
 * The notice attaches a fixed-position element to document.body and works
 * on both the pre-game shell and in-world.
 */
export async function initBrowserNotice(): Promise<void> {
  // Edge: navigator.brave exists as an object with a .brave() method on
  // Brave. Resolving it needs an async call, so we do that here.
  let isBrave = false;
  try {
    const brave = (navigator as unknown as { brave?: { isBrave: () => Promise<boolean> } }).brave;
    if (brave && typeof brave.isBrave === 'function') {
      isBrave = await brave.isBrave();
    }
  } catch {
    // navigator.brave access threw. Definitely not Brave.
  }

  const kind = detectBrowserKind(navigator.userAgent, isBrave);
  const unsupported = kind === 'unsupported';

  let state: BrowserNoticeState = resolveBrowserNotice({
    unsupported,
    dismissedBefore: readDismissed(),
  });
  if (!state.shown) return;

  let root: HTMLDivElement | null = null;
  let dismissButton: HTMLButtonElement | null = null;
  let downloadLink: HTMLAnchorElement | null = null;

  const ensureDom = (): void => {
    if (root) return;
    root = document.createElement('div');
    root.id = 'browser-notice';
    root.setAttribute('role', 'alert');
    root.hidden = true;

    const title = document.createElement('strong');
    title.className = 'browser-notice-title';
    title.textContent = t('hudChrome.browserNotice.title');

    const body = document.createElement('span');
    body.className = 'browser-notice-body';
    body.textContent = t('hudChrome.browserNotice.body');

    downloadLink = document.createElement('a');
    downloadLink.className = 'browser-notice-download';
    const platform = detectDesktopPlatform(navigator.userAgent);
    const url = desktopDownloadUrl(platform);
    if (url) {
      downloadLink.href = url;
      downloadLink.textContent = t('hudChrome.browserNotice.downloadDesktop');
      downloadLink.target = '_blank';
      downloadLink.rel = 'noopener noreferrer';
    } else {
      // No published artifact for this platform. Hide the link.
      downloadLink.hidden = true;
    }

    dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'browser-notice-dismiss';
    dismissButton.textContent = t('hudChrome.browserNotice.dismiss');
    dismissButton.addEventListener('click', () => {
      state = dismissBrowserNotice(state);
      writeDismissed();
      render();
    });

    root.append(title, body, downloadLink, dismissButton);
    document.body.appendChild(root);
  };

  const render = (): void => {
    if (!state.shown) {
      if (root) root.hidden = true;
      return;
    }
    ensureDom();
    if (!root) return;
    root.hidden = false;
  };

  render();

  // Re-render on locale flip (the pre-game language selector and in-game
  // options both dispatch woc:languagechange).
  document.addEventListener('woc:languagechange', () => {
    if (!root || root.hidden) return;
    // Rebuild the DOM to pick up fresh t() values.
    const title = root.querySelector('.browser-notice-title');
    if (title) title.textContent = t('hudChrome.browserNotice.title');
    const body = root.querySelector('.browser-notice-body');
    if (body) body.textContent = t('hudChrome.browserNotice.body');
    if (downloadLink) {
      const platform = detectDesktopPlatform(navigator.userAgent);
      const url = desktopDownloadUrl(platform);
      if (url) {
        downloadLink.href = url;
        downloadLink.textContent = t('hudChrome.browserNotice.downloadDesktop');
        downloadLink.hidden = false;
      } else {
        downloadLink.hidden = true;
      }
    }
    if (dismissButton) dismissButton.textContent = t('hudChrome.browserNotice.dismiss');
  });
}

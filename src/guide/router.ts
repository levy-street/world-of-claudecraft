// Tiny history-based router for the Guide SPA. No dependencies: intercepts in-app
// link clicks, drives history.pushState, and notifies on every navigation (click,
// back/forward, initial load). Clean URLs (/guide/classes/warrior) work because both
// vite.config.ts and server/main.ts fall back to guide.html for /guide* paths.

import { GUIDE_BASE } from './routes';

export type NavigateHandler = (pathname: string) => void;

export class GuideRouter {
  private onNavigate: NavigateHandler;

  constructor(onNavigate: NavigateHandler) {
    this.onNavigate = onNavigate;
  }

  /** Wire global listeners and fire the initial route. */
  start(): void {
    document.addEventListener('click', this.handleClick);
    window.addEventListener('popstate', this.handlePopState);
    this.onNavigate(window.location.pathname);
  }

  /** Programmatic navigation (also used by the router's own intercepts). */
  go(pathname: string): void {
    if (pathname === window.location.pathname) {
      this.onNavigate(pathname);
      return;
    }
    window.history.pushState({}, '', pathname);
    this.onNavigate(pathname);
  }

  private handlePopState = (): void => {
    this.onNavigate(window.location.pathname);
  };

  private handleClick = (ev: MouseEvent): void => {
    // Respect modified clicks (new tab/window) and non-primary buttons.
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) {
      return;
    }
    const anchor = (ev.target as Element | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    // Same-page in-page anchors (the skip link, any table-of-contents jump) must be
    // left to the browser so it scrolls and focuses the target natively. Intercepting
    // them would route to a #hash path and render notFound.
    if (href.startsWith('#') || (anchor.hash && anchor.pathname === window.location.pathname)) return;
    // Only intercept same-origin links that live under the Guide base. Everything
    // else (the game, the community wiki, external links, downloads) navigates normally.
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    if (anchor.origin !== window.location.origin) return;
    const path = anchor.pathname;
    if (path !== GUIDE_BASE && !path.startsWith(`${GUIDE_BASE}/`)) return;
    ev.preventDefault();
    this.go(path + anchor.hash);
  };
}

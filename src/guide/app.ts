// Guide app orchestrator. Owns the chrome + router, renders the matched page into the
// <main> landmark, and keeps title, active-nav, sidebar visibility, document language,
// and focus in sync on every navigation and language switch.

import {
  ensureLocaleLoaded,
  getLanguage,
  languageTag,
  type SupportedLanguage,
  setLanguage,
  type TranslationKey,
  t,
} from '../ui/i18n';
import { buildChrome, type GuideChrome } from './chrome';
import { applyRouteHead } from './head';
import { breadcrumbHtml, mountToc, sequenceHtml } from './nav_aids';
import { notFoundHtml, type PageContext, pageFor, placeholderHtml } from './pages';
import { GuideRouter } from './router';
import { type GuideRoute, matchRoute } from './routes';

const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);
function isRtl(tag: string): boolean {
  return RTL_LANGS.has(tag.split('-')[0]);
}

export class GuideApp {
  private readonly mount: HTMLElement;
  private readonly router: GuideRouter;
  private chrome!: GuideChrome;
  private chromeAbort: AbortController | null = null;
  private firstNav = true;
  private pageCleanups: (() => void)[] = [];

  constructor(mount: HTMLElement) {
    this.mount = mount;
    this.router = new GuideRouter((pathname) => this.navigate(pathname));
  }

  start(): void {
    this.rebuildChrome();
    this.applyDocumentLang();
    this.router.start();
  }

  private rebuildChrome(): void {
    this.chromeAbort?.abort();
    this.chromeAbort = new AbortController();
    this.chrome = buildChrome(
      this.mount,
      { onLanguageChange: (lang) => void this.changeLanguage(lang) },
      this.chromeAbort.signal,
    );
  }

  private applyDocumentLang(): void {
    const tag = languageTag(getLanguage());
    document.documentElement.lang = tag;
    document.documentElement.dir = isRtl(tag) ? 'rtl' : 'ltr';
  }

  private async changeLanguage(lang: SupportedLanguage): Promise<void> {
    await ensureLocaleLoaded(lang);
    setLanguage(lang);
    // The chrome rebuild rides the same transition as the page swap, so the whole
    // relocalization lands as one cross-fade instead of the chrome popping first.
    this.withViewTransition(() => {
      this.rebuildChrome();
      this.applyDocumentLang();
      // Preserve the fragment across the relocalize so a language switch on a
      // deep-linked section re-scrolls to that anchor, not back to the top.
      this.renderRoute(window.location.pathname + window.location.hash);
    });
  }

  private navigate(pathname: string): void {
    this.withViewTransition(() => this.renderRoute(pathname));
  }

  // Cross-fade DOM swaps through the View Transitions API where it exists. The initial
  // render and reduced-motion readers get the plain swap, and the API falls back to it
  // untransitioned everywhere else. A swap error must still surface: the transition
  // would otherwise turn it into a silently rejected updateCallbackDone.
  private withViewTransition(swap: () => void): void {
    const vt = (
      document as Partial<{
        startViewTransition: (cb: () => void) => { updateCallbackDone: Promise<void> };
      }>
    ).startViewTransition;
    if (!this.firstNav && vt && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      vt.call(document, swap).updateCallbackDone.catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('Guide navigation failed mid transition', err);
      });
    } else {
      swap();
    }
  }

  private renderRoute(pathname: string): void {
    // Tear down the previous page's listeners before swapping its DOM out.
    this.runPageCleanup();
    const match = matchRoute(pathname);
    let titleKey: TranslationKey;
    let dynamicTitle: string | null = null;
    let headRoute: GuideRoute | null = null;
    let headSub = '';
    let detailId: string | null = null;
    if (!match) {
      this.chrome.mainEl.innerHTML = notFoundHtml();
      titleKey = 'guide.notFound.title';
      this.chrome.setActive('');
      this.chrome.setSidebarVisible(false);
      document.body.dataset.guideRoute = 'notfound';
    } else {
      const { route, params } = match;
      const ctx: PageContext = { params, sub: route.sub, titleKey: route.navKey };
      const page = pageFor(route.id);
      const pageHtml = page ? page.render(ctx) : placeholderHtml(ctx);
      titleKey = page?.titleKey ?? route.navKey;
      dynamicTitle = page?.titleFor ? page.titleFor(ctx) : null;
      headRoute = route;
      detailId = params.length > 0 ? params[0] : null;
      headSub = params.length > 0 ? `${route.sub}/${params.join('/')}` : route.sub;
      // The home landing is a marketing page: no breadcrumb, prev/next, or TOC chrome.
      const isHome = route.id === 'home';
      if (isHome) {
        this.chrome.mainEl.innerHTML = pageHtml;
      } else {
        const isDetail = params.length > 0;
        const leaf = dynamicTitle ?? t(route.navKey);
        this.chrome.mainEl.innerHTML =
          breadcrumbHtml(route, isDetail, leaf) + pageHtml + sequenceHtml(route);
      }
      if (page?.mount) this.addCleanup(page.mount(this.chrome.mainEl, ctx));
      if (!isHome) this.addCleanup(mountToc(this.chrome.mainEl));
      this.chrome.setActive(route.sub);
      this.chrome.setSidebarVisible(!isHome);
      document.body.dataset.guideRoute = route.id;
    }

    const pageTitle = dynamicTitle ?? t(titleKey);
    const brand = t('guide.brand');
    const title = pageTitle === brand ? brand : t('guide.docTitle', { page: pageTitle, brand });
    // One seam for all per-route head metadata (title, description, canonical, og/twitter,
    // hreflang alternates, JSON-LD). Runs on every navigation and after a language switch.
    applyRouteHead({ route: headRoute, sub: headSub, title, detailId });
    this.chrome.closeMenu();
    this.focusMain(pathname);
  }

  private addCleanup(cleanup: (() => void) | void): void {
    if (cleanup) this.pageCleanups.push(cleanup);
  }

  private runPageCleanup(): void {
    const cleanups = this.pageCleanups;
    this.pageCleanups = [];
    for (const cleanup of cleanups) cleanup();
  }

  private focusMain(pathname: string): void {
    const hashIndex = pathname.indexOf('#');
    const hash = hashIndex >= 0 ? pathname.slice(hashIndex) : '';
    // Instant, never smooth: this runs inside the view-transition callback, and a
    // smooth scroll still in flight when the new-state snapshot is taken would fade
    // to a mid-scroll frame. Landing a NEW page at its position instantly is also the
    // native cross-page behavior.
    if (hash.length > 1) {
      const target = this.chrome.mainEl.querySelector(hash);
      if (target) {
        (target as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'start' });
        return;
      }
    }
    // On the initial load leave focus at the document default so the skip link is the
    // first tab stop. On later client-side navigations move focus to the content region
    // so keyboard and screen-reader users land on the new page, not the unchanged header.
    if (this.firstNav) {
      this.firstNav = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    this.chrome.mainEl.focus({ preventScroll: true });
  }
}

// Builds the persistent Guide chrome: skip link, header (brand, top nav, language
// picker, Play CTA, mobile menu toggle), the docs sidebar, the <main> landmark, and
// the footer. Pure DOM construction; the app owns routing and active-state updates.
// All player-visible text is a t() key; all interpolated text passes through esc().

import { esc } from '../ui/esc';
import {
  getLanguage,
  languageTag,
  type SupportedLanguage,
  supportedLanguages,
  t,
} from '../ui/i18n';
import { GUIDE_BASE, type GuideGroup, groupedRoutes, hrefFor, topbarRoutes } from './routes';
import { mountSearch } from './search';

export interface GuideChrome {
  root: HTMLElement;
  mainEl: HTMLElement;
  /** Highlight the active route in the top nav and sidebar. */
  setActive(sub: string): void;
  /** Show or hide the docs sidebar (hidden on the home/overview landing). */
  setSidebarVisible(visible: boolean): void;
  /** Collapse the mobile nav drawer (called after navigation). */
  closeMenu(): void;
}

function endonym(lang: SupportedLanguage): string {
  const tag = languageTag(lang);
  try {
    const dn = new Intl.DisplayNames([tag], { type: 'language' });
    const name = dn.of(tag);
    if (name) return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    // Intl.DisplayNames unavailable: fall back to the tag.
  }
  return tag;
}

function topNavHtml(): string {
  const items = topbarRoutes()
    .map(
      (r) =>
        `<li><a class="guide-nav-link" data-sub="${esc(r.sub)}" href="${esc(hrefFor(r.sub))}">${esc(t(r.navKey))}</a></li>`,
    )
    .join('');
  return `<ul class="guide-nav-list">${items}</ul>`;
}

function sidebarHtml(): string {
  const groups = groupedRoutes()
    .map(({ group, routes }) => {
      const label = esc(t(`guide.groups.${group}` as `guide.groups.${GuideGroup}`));
      const links = routes
        .map(
          (r) =>
            `<li><a class="guide-side-link" data-sub="${esc(r.sub)}" href="${esc(hrefFor(r.sub))}">${esc(t(r.navKey))}</a></li>`,
        )
        .join('');
      return `<div class="guide-side-group"><h2 class="guide-side-heading">${label}</h2><ul>${links}</ul></div>`;
    })
    .join('');
  return groups;
}

function searchHtml(): string {
  // The slash keycap is a keyboard glyph (like the controls page kbds), decorative for
  // assistive tech; the input keeps its accessible label.
  return `
    <div class="guide-search" role="search">
      <label class="guide-search-label" for="guide-search-input">${esc(t('guide.search.label'))}</label>
      <input id="guide-search-input" class="guide-search-input" type="search" role="combobox"
        aria-expanded="false" aria-controls="guide-search-results" aria-autocomplete="list"
        autocomplete="off" placeholder="${esc(t('guide.search.placeholder'))}" />
      <kbd class="guide-search-hint" aria-hidden="true">/</kbd>
      <div id="guide-search-results" class="guide-search-results" role="listbox" aria-label="${esc(t('guide.search.label'))}" hidden></div>
    </div>`;
}

function languagePickerHtml(): string {
  const current = getLanguage();
  const options = supportedLanguages
    .map(
      (lang) =>
        `<option value="${esc(lang)}"${lang === current ? ' selected' : ''}>${esc(endonym(lang))}</option>`,
    )
    .join('');
  return `
    <div class="guide-lang">
      <label class="guide-lang-label" for="guide-lang-select">${esc(t('guide.language.label'))}</label>
      <select id="guide-lang-select" class="guide-lang-select" aria-label="${esc(t('guide.language.select'))}">${options}</select>
    </div>`;
}

export interface ChromeOptions {
  onLanguageChange(lang: SupportedLanguage): void;
}

export function buildChrome(
  mount: HTMLElement,
  opts: ChromeOptions,
  signal: AbortSignal,
): GuideChrome {
  mount.innerHTML = `
    <a class="guide-skip" href="#guide-main">${esc(t('guide.skipToContent'))}</a>
    <header class="guide-header">
      <div class="guide-header-inner">
        <a class="guide-brand" href="${esc(GUIDE_BASE)}">
          <img class="guide-brand-logo" src="/woc-logo-guide.webp" width="239" height="160" alt="${esc(t('guide.brand'))}" decoding="async" />
        </a>
        <button type="button" class="guide-menu-toggle" aria-expanded="false" aria-controls="guide-primary-nav" aria-label="${esc(t('guide.nav.openMenu'))}">
          <span class="guide-menu-bars" aria-hidden="true"></span>
        </button>
        <nav class="guide-primary-nav" id="guide-primary-nav" aria-label="${esc(t('guide.nav.primary'))}">
          ${topNavHtml()}
          <div class="guide-nav-actions">
            ${searchHtml()}
            ${languagePickerHtml()}
            <a class="guide-cta" href="/play">${esc(t('guide.nav.playNow'))}</a>
          </div>
        </nav>
      </div>
    </header>
    <div class="guide-layout">
      <aside class="guide-sidebar" id="guide-sidebar" hidden>
        <button type="button" class="guide-topics-toggle" aria-expanded="false" aria-controls="guide-sidebar-nav">${esc(t('guide.nav.topics'))}<span class="guide-topics-current"></span></button>
        <nav class="guide-sidebar-nav" id="guide-sidebar-nav" aria-label="${esc(t('guide.nav.sidebarLabel'))}">
          ${sidebarHtml()}
        </nav>
      </aside>
      <main class="guide-main" id="guide-main" tabindex="-1"></main>
    </div>
    <footer class="guide-footer">
      <div class="guide-footer-inner">
        <p class="guide-footer-blurb">${esc(t('guide.footer.blurb'))}</p>
        <nav class="guide-footer-links" aria-label="${esc(t('guide.footer.linksLabel'))}">
          <a class="guide-cta guide-cta-sm" href="/play">${esc(t('guide.footer.playNow'))}</a>
          <a href="https://github.com/levy-street/world-of-claudecraft" target="_blank" rel="noopener">${esc(t('guide.footer.github'))}</a>
          <a href="https://discord.com/invite/worldofclaudecraft" target="_blank" rel="noopener">${esc(t('guide.footer.discord'))}</a>
        </nav>
        <p class="guide-footer-rights">&copy; ${esc(t('guide.footer.rights'))}</p>
      </div>
    </footer>`;

  const mainEl = mount.querySelector('#guide-main') as HTMLElement;
  const header = mount.querySelector('.guide-header') as HTMLElement;
  const nav = mount.querySelector('#guide-primary-nav') as HTMLElement;
  const menuToggle = mount.querySelector('.guide-menu-toggle') as HTMLButtonElement;
  const sidebar = mount.querySelector('#guide-sidebar') as HTMLElement;
  const topicsToggle = mount.querySelector('.guide-topics-toggle') as HTMLButtonElement;
  const langSelect = mount.querySelector('#guide-lang-select') as HTMLSelectElement;

  // Mobile nav drawer.
  const setMenu = (open: boolean) => {
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', t(open ? 'guide.nav.closeMenu' : 'guide.nav.openMenu'));
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('guide-menu-open', open);
  };
  menuToggle.addEventListener('click', () =>
    setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'),
  );
  // Document-level listeners use { signal } so a language switch (which rebuilds the
  // chrome) cleanly removes the old handlers instead of stacking duplicates.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        menuToggle.focus();
      }
    },
    { signal },
  );
  // While the drawer is open, Tab loops within the header (toggle + drawer controls) so
  // keyboard focus cannot wander into the scroll-locked page behind it.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab' || menuToggle.getAttribute('aria-expanded') !== 'true') return;
      const focusables = Array.from(
        header.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === menuToggle);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !header.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    },
    { signal },
  );
  document.addEventListener(
    'click',
    (e) => {
      if (menuToggle.getAttribute('aria-expanded') !== 'true') return;
      const target = e.target as Node;
      if (!header.contains(target)) setMenu(false);
    },
    { signal },
  );

  // Keyboard entry points for search: "/" (outside form fields) and Cmd/Ctrl+K.
  const searchInput = mount.querySelector('#guide-search-input') as HTMLInputElement;
  const searchWrap = mount.querySelector('.guide-search') as HTMLElement;
  document.addEventListener(
    'keydown',
    (e) => {
      const inField = (e.target as HTMLElement | null)?.closest(
        'input, select, textarea, [contenteditable]',
      );
      const slash = e.key === '/' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey;
      const combo =
        e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
      if (!slash && !combo) return;
      e.preventDefault();
      // On collapsed-header viewports the search lives inside the drawer; open it first.
      if (getComputedStyle(menuToggle).display !== 'none') setMenu(true);
      searchInput.focus();
      searchInput.select();
    },
    { signal },
  );
  searchInput.addEventListener('input', () => {
    searchWrap.classList.toggle('is-typing', searchInput.value.length > 0);
  });

  // Mobile "Topics" disclosure for the docs sidebar.
  topicsToggle.addEventListener('click', () => {
    const open = topicsToggle.getAttribute('aria-expanded') !== 'true';
    topicsToggle.setAttribute('aria-expanded', String(open));
    sidebar.classList.toggle('topics-open', open);
  });

  langSelect.addEventListener('change', () => {
    opts.onLanguageChange(langSelect.value as SupportedLanguage);
  });

  // Header search: builds its index from already-loaded data and navigates via the router.
  mountSearch(mount, signal);

  return {
    root: mount,
    mainEl,
    setActive(sub: string) {
      let currentLabel = '';
      mount.querySelectorAll<HTMLAnchorElement>('[data-sub]').forEach((a) => {
        const match = a.dataset.sub === sub;
        a.classList.toggle('is-active', match);
        if (match) {
          a.setAttribute('aria-current', 'page');
          if (a.classList.contains('guide-side-link')) currentLabel = a.textContent ?? '';
        } else a.removeAttribute('aria-current');
      });
      // Echo the current page on the collapsed Topics disclosure, so the reader knows
      // where they stand without opening it.
      const topicsCurrent = topicsToggle.querySelector('.guide-topics-current');
      if (topicsCurrent) topicsCurrent.textContent = currentLabel;
    },
    setSidebarVisible(visible: boolean) {
      sidebar.hidden = !visible;
      document.body.classList.toggle('guide-has-sidebar', visible);
    },
    closeMenu() {
      setMenu(false);
      topicsToggle.setAttribute('aria-expanded', 'false');
      sidebar.classList.remove('topics-open');
    },
  };
}

// The single-page reader: loads the whole seed and routes articles by #hash. The offline
// export (scripts/mediawiki/export_reader.mjs) runs on it. The public site is the static
// build instead (scripts/wiki_site/build.mjs plus wiki_page.js); both render pages
// through page_render.js.
import { sectionRoute } from './article_layout.js';
import { displayTitle } from './browse.js';
import { mountWikiTooltips } from './hover_tooltip.js';
import { mountImageViewer } from './image_viewer.js';
import { enhanceItemTables } from './item_table.js';
import {
  addIndexFilter,
  buildSite,
  escapeHtml,
  href,
  image,
  link,
  mainPageMarkup,
  navMarkup,
  pageRecord,
  renderArticle,
} from './page_render.js';
import { tooltipLookup } from './tooltip_content.js';

async function readPayload(url, packed) {
  if (packed) {
    const bytes = Uint8Array.from(atob(packed), (s) => s.charCodeAt(0));
    return new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
  }
  const response = await fetch(url);
  if (!response.ok) throw Error('Could not load the encyclopedia data.');
  return response.text();
}

export async function openReader({ seedUrl, packed, cardsUrl, packedCards, assetUrl }) {
  const view = document.querySelector('#view'),
    input = document.querySelector('#lookup'),
    nav = document.querySelector('#navigation');
  mountImageViewer(view, () => view.querySelector('.article-heading h1')?.textContent ?? '');
  const cover = assetUrl('/website-hero-eastbrook-v1.webp');
  const observer = new IntersectionObserver(
    (changes) => {
      for (const { target, isIntersecting } of changes)
        if (isIntersecting) {
          target.src = assetUrl(target.dataset.gameArt);
          observer.unobserve(target);
        }
    },
    { rootMargin: '300px' },
  );
  function loadArt() {
    observer.disconnect();
    for (const el of view.querySelectorAll('[data-game-art]')) observer.observe(el);
  }
  try {
    const lookupReady =
      cardsUrl || packedCards
        ? readPayload(cardsUrl, packedCards)
            .then((text) => tooltipLookup(JSON.parse(text), assetUrl))
            .catch((error) => {
              console.error('Unable to load encyclopedia tooltips', error);
              return null;
            })
        : null;
    const xmlText = await readPayload(seedUrl, packed);
    const dom = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (dom.querySelector('parsererror')) throw Error('Could not read the article index.');
    const pages = new Map();
    for (const page of dom.getElementsByTagName('page')) {
      const title = page.getElementsByTagName('title')[0].textContent;
      if (title.startsWith('MediaWiki:')) continue;
      pages.set(title, pageRecord(title, page.getElementsByTagName('text')[0].textContent));
    }
    const site = buildSite(pages, assetUrl);
    const { all } = site;
    const wideNav = window.matchMedia('(min-width: 768px)');
    const drawer = document.querySelector('.browse-drawer');
    if (drawer) drawer.open = wideNav.matches;
    nav.innerHTML = navMarkup(site, wideNav.matches);
    function openNavGroups(open) {
      for (const group of nav.querySelectorAll('details')) group.open = open;
    }
    wideNav.addEventListener('change', (event) => {
      openNavGroups(event.matches);
      if (drawer) drawer.open = event.matches;
      const contents = view.querySelector('.directory-contents');
      if (contents) contents.open = event.matches;
    });
    nav.addEventListener('click', (event) => {
      if (!wideNav.matches && event.target.closest('a')) {
        openNavGroups(false);
        if (drawer) drawer.open = false;
      }
    });
    document.documentElement.style.setProperty('--cover', 'url("' + cover + '")');
    let timer;
    function route() {
      try {
        return sectionRoute(location.hash).article;
      } catch {
        return 'Main Page';
      }
    }
    function search(q, limit = 70) {
      view.classList.remove('wiki-directory', 'activity-directory');
      const search = q.toLocaleLowerCase('en').trim(),
        terms = search.split(/\s+/).filter(Boolean);
      const named = all.filter((p) => terms.every((t) => p.sort.includes(t)));
      const namedSet = new Set(named);
      const full =
        terms.length && q.length >= 3
          ? all.filter(
              (p) =>
                !namedSet.has(p) &&
                !p.categories.includes('Portals') &&
                p.title !== 'All Pages' &&
                terms.every((t) => p.text.toLowerCase().includes(t)),
            )
          : [];
      const found = [...named, ...full];
      view.innerHTML =
        '<p class="overline">Article search</p><h1>' +
        escapeHtml(q || 'All articles') +
        '</h1><p>' +
        found.length.toLocaleString('en') +
        ' results</p><ul class="results">' +
        found
          .slice(0, limit)
          .map(
            (p) =>
              '<li class="result">' +
              image(p.art, 'result-icon') +
              link(p.title) +
              ' <small>' +
              escapeHtml(p.categories[0] || 'Reference') +
              '</small></li>',
          )
          .join('') +
        '</ul>' +
        (found.length > limit ? '<button id="more">Show more results</button>' : '');
      loadArt();
      document.querySelector('#more')?.addEventListener('click', () => search(q, limit + 100));
    }
    function show() {
      view.classList.remove('wiki-directory', 'activity-directory');
      const current = route();
      for (const a of nav.querySelectorAll('a')) {
        if (a.hash === href(current)) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
      if (current.startsWith('search=')) {
        const q = current.slice(7);
        input.value = q;
        search(q);
        return;
      }
      input.value = '';
      view.dataset.article = current;
      const page = pages.get(current);
      document.title =
        (current === 'Main Page' ? 'Player Encyclopedia' : displayTitle(current)) +
        ' | World of ClaudeCraft';
      if (!page) {
        view.innerHTML =
          '<h1>Article unavailable</h1><p>' +
          link('All Pages', 'Browse the complete index') +
          '</p>';
        return;
      }
      if (current === 'Main Page') {
        view.innerHTML = mainPageMarkup(site);
        loadArt();
        return;
      }
      const directory = renderArticle(view, site, current, wideNav.matches);
      if (directory) addIndexFilter(view);
      enhanceItemTables(view);
      loadArt();
      for (const a of view.querySelectorAll('[data-part]')) {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById(a.dataset.part)?.scrollIntoView();
        });
      }
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = input.value;
        history.replaceState(null, '', href('search=' + s));
        search(s);
      }, 140);
    });
    window.addEventListener('hashchange', () => {
      clearTimeout(timer);
      show();
      if (!scrollToSection()) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        view.focus({ preventScroll: true });
      }
    });
    function scrollToSection() {
      let target;
      try {
        const section = sectionRoute(location.hash).section;
        target = section && document.getElementById('section-' + section);
      } catch {
        return false;
      }
      if (!target) return false;
      for (let node = target.parentElement; node; node = node.parentElement) {
        if (node.tagName === 'DETAILS') node.open = true;
      }
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      target.focus({ preventScroll: true });
      return true;
    }
    show();
    scrollToSection();
    const lookup = await lookupReady;
    if (lookup) mountWikiTooltips(view, lookup);
  } catch (error) {
    view.textContent = 'The encyclopedia could not open. ' + error.message;
  }
}

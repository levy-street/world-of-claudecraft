// Behavior for a static encyclopedia page (scripts/wiki_site/build.mjs). The article is
// already in the HTML, so search engines and readers without scripts get the whole page;
// this adds what needs a script: tabs, sortable item tables, list filters, the picture
// viewer, hover cards and title search.
import { mountWikiTooltips } from './hover_tooltip.js';
import { mountImageViewer } from './image_viewer.js';
import { enhanceItemTables } from './item_table.js';
import { addIndexFilter, escapeHtml } from './page_render.js';
import { bindTabs } from './tabs.js';
import { tooltipLookup } from './tooltip_content.js';

const RESULT_LIMIT = 70;

/** Search rows are [title, path, art, category]; every word must appear in the title. */
export function searchRows(rows, query) {
  const terms = query.toLocaleLowerCase('en').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return rows.filter(([title]) => {
    const name = title.toLocaleLowerCase('en');
    return terms.every((term) => name.includes(term));
  });
}

/** The results view for a query. */
export function resultsMarkup(query, found, limit = RESULT_LIMIT) {
  return (
    '<p class="overline">Article search</p><h1>' +
    escapeHtml(query) +
    '</h1><p>' +
    found.length.toLocaleString('en') +
    (found.length === 1 ? ' result' : ' results') +
    '</p><ul class="results">' +
    found
      // The index is a same-origin build file; still, only wiki paths become links.
      .filter(([, path]) => typeof path === 'string' && path.startsWith('/wiki/'))
      .slice(0, limit)
      .map(
        ([title, path, art, category]) =>
          '<li class="result">' +
          (typeof art === 'string' && /^\/(?!\/)/.test(art)
            ? '<img class="result-icon" src="' +
              escapeHtml(art) +
              '" alt="" width="32" height="32" loading="lazy" decoding="async">'
            : '') +
          '<a href="' +
          escapeHtml(path) +
          '">' +
          escapeHtml(title) +
          '</a> <small>' +
          escapeHtml(category || 'Reference') +
          '</small></li>',
      )
      .join('') +
    '</ul>' +
    (found.length > limit ? '<button type="button" id="more">Show more results</button>' : '')
  );
}

// Opens the closed disclosures around the element a #fragment points at.
function revealTarget() {
  let id = '';
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return; // A malformed fragment names nothing on the page.
  }
  const target = id && document.getElementById(id);
  if (!target) return;
  for (let node = target.parentElement; node; node = node.parentElement)
    if (node.tagName === 'DETAILS') node.open = true;
  target.scrollIntoView({ block: 'start' });
}

function mountSearch(view, input, enhance) {
  const article = view.innerHTML;
  const articleClass = view.className;
  let rows = null;
  let timer;
  // Each search bumps this; a slow index fetch for an older query must not land.
  let latest = 0;
  const load = () => {
    rows ??= fetch(document.body.dataset.searchIndex)
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => []);
    return rows;
  };
  async function show(query, limit = RESULT_LIMIT) {
    const ticket = ++latest;
    const url = new URL(location.href);
    if (!query.trim()) {
      url.searchParams.delete('q');
      history.replaceState(null, '', url);
      view.className = articleClass;
      view.innerHTML = article;
      enhance();
      return;
    }
    url.searchParams.set('q', query);
    history.replaceState(null, '', url);
    const all = await load();
    if (ticket !== latest) return;
    const found = searchRows(all, query);
    view.className = '';
    view.innerHTML = resultsMarkup(query, found, limit);
    view.querySelector('#more')?.addEventListener('click', () => show(query, limit + 100));
  }
  input.addEventListener('focus', load, { once: true });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => show(input.value), 140);
  });
  // Enter searches instead of adding a line to the one-line box.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  const initial = new URL(location.href).searchParams.get('q');
  if (initial) {
    input.value = initial;
    show(initial);
  }
}

export function enhanceWikiPage() {
  const view = document.querySelector('#view');
  const input = document.querySelector('#lookup');
  if (!view) return;
  // The page ships with lists open, as a wide screen shows them; a phone starts closed.
  const wide = window.matchMedia('(min-width: 768px)');
  const setOpen = (open) => {
    for (const details of document.querySelectorAll(
      '#navigation details, .browse-drawer, .wiki-contents, .directory-contents',
    ))
      details.open = open;
  };
  if (!wide.matches) setOpen(false);
  wide.addEventListener('change', (event) => setOpen(event.matches));
  const enhance = () => {
    bindTabs(view);
    enhanceItemTables(view);
    if ('directory' in view.dataset) addIndexFilter(view);
  };
  // Search keeps the untouched article to put back, so it is set up before enhancing.
  if (input) mountSearch(view, input, enhance);
  enhance();
  mountImageViewer(view, () => view.querySelector('.article-heading h1')?.textContent ?? '');
  revealTarget();
  window.addEventListener('hashchange', revealTarget);
  // Hover cards are a large file, so they load once the page itself is done.
  const cards = document.body.dataset.cards;
  if (cards) {
    const start = () =>
      fetch(cards)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!data) return;
          mountWikiTooltips(
            view,
            tooltipLookup(data, (path) => path),
            {
              titleForLink: (link) =>
                link.origin === location.origin && link.pathname.startsWith('/wiki/')
                  ? link.pathname
                  : null,
            },
          );
        })
        .catch((error) => console.error('Unable to load encyclopedia hover cards', error));
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }
}

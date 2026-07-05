// Site-wide client-side search for the Guide. Builds a small in-memory index from data
// already loaded in the client (routes, generated class/zone/family/dungeon data, and the
// glossary terms), so there is no backend and no separate build step. Renders an
// accessible combobox + listbox in the header chrome; results are real links the router
// intercepts. Rebuilt per language because the chrome is rebuilt on a language switch.

import { t, type TranslationKey } from '../ui/i18n';
import { esc } from '../ui/esc';
import { GUIDE_ROUTES, hrefFor } from './routes';
import { GUIDE_CLASSES, GUIDE_ZONES, GUIDE_FAMILIES, GUIDE_DUNGEONS } from './content.generated';
import { GLOSSARY_TERMS } from './pages/glossary';

interface SearchEntry { label: string; type: string; href: string; haystack: string; }

const MAX_RESULTS = 8;

function buildIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const add = (label: string, type: string, href: string, extra = '') => {
    if (label) entries.push({ label, type, href, haystack: `${label} ${extra}`.toLowerCase() });
  };

  for (const r of GUIDE_ROUTES) {
    if (r.id === 'home') continue;
    add(t(r.navKey), t('guide.search.typePage'), hrefFor(r.sub));
  }
  for (const c of GUIDE_CLASSES) {
    add(t(`classes.${c.id}` as TranslationKey), t('guide.search.typeClass'), hrefFor(`classes/${c.id}`), `${c.roles.join(' ')} ${c.resource}`);
  }
  for (const z of GUIDE_ZONES) {
    add(z.name, t('guide.search.typeZone'), `${hrefFor('world')}#zone-${z.biome}`);
  }
  for (const f of GUIDE_FAMILIES) {
    add(t(`guide.family.${f.family}.name` as TranslationKey), t('guide.search.typeCreature'), `${hrefFor('bestiary')}#fam-${f.family}`);
  }
  for (const d of GUIDE_DUNGEONS) {
    add(d.isRaid ? t('guide.dungeonsPage.raidName') : (d.name ?? ''), t('guide.search.typeDungeon'), hrefFor('dungeons'));
  }
  for (const g of GLOSSARY_TERMS) {
    add(t(g.term), t('guide.search.typeTerm'), `${hrefFor('reference/glossary')}#term-${g.slug}`);
  }
  return entries;
}

function rank(index: SearchEntry[], query: string): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = index.filter((e) => e.haystack.includes(q));
  // Prefix matches on the label first, then the rest, alphabetical within each.
  hits.sort((a, b) => {
    const ap = a.label.toLowerCase().startsWith(q) ? 0 : 1;
    const bp = b.label.toLowerCase().startsWith(q) ? 0 : 1;
    return ap - bp || a.label.localeCompare(b.label);
  });
  return hits.slice(0, MAX_RESULTS);
}

/** Wire the header search combobox. Cleaned up via the chrome's AbortSignal. */
export function mountSearch(root: HTMLElement, signal: AbortSignal): void {
  const input = root.querySelector<HTMLInputElement>('#guide-search-input');
  const panel = root.querySelector<HTMLElement>('#guide-search-results');
  if (!input || !panel) return;
  const index = buildIndex();
  let options: HTMLAnchorElement[] = [];
  let active = -1;

  const close = () => {
    panel.hidden = true;
    panel.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    options = [];
    active = -1;
  };

  const setActive = (next: number) => {
    if (!options.length) return;
    active = (next + options.length) % options.length;
    options.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
    const current = options[active];
    current.classList.add('is-active');
    options.forEach((o, i) => { if (i !== active) o.classList.remove('is-active'); });
    input.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({ block: 'nearest' });
  };

  const render = () => {
    const results = rank(index, input.value);
    if (!results.length) {
      if (input.value.trim()) {
        panel.hidden = false;
        panel.innerHTML = `<p class="guide-search-empty">${esc(t('guide.search.noResults'))}</p>`;
        input.setAttribute('aria-expanded', 'true');
      } else {
        close();
      }
      options = [];
      active = -1;
      return;
    }
    panel.innerHTML = results
      .map((r, i) => `<a class="guide-search-opt" role="option" id="gso-${i}" href="${esc(r.href)}" aria-selected="false" tabindex="-1"><span class="guide-search-opt-label">${esc(r.label)}</span><span class="guide-search-opt-type">${esc(r.type)}</span></a>`)
      .join('');
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    options = Array.from(panel.querySelectorAll<HTMLAnchorElement>('.guide-search-opt'));
    active = -1;
    input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', render, { signal });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') {
      if (active >= 0 && options[active]) { e.preventDefault(); options[active].click(); }
    } else if (e.key === 'Escape') {
      input.value = '';
      close();
    }
  }, { signal });
  // A chosen result navigates via the router (link click); just close the panel.
  panel.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.guide-search-opt')) { input.value = ''; close(); }
  }, { signal });
  // Close when focus or a click leaves the search box.
  document.addEventListener('click', (e) => {
    if (!root.querySelector('.guide-search')?.contains(e.target as Node)) close();
  }, { signal });
}

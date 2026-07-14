// Site-wide client-side search for the Guide. Builds a small in-memory index from data
// already loaded in the client (routes, generated class/zone/family/dungeon data, and the
// glossary terms), so there is no backend and no separate build step. Renders an
// accessible combobox + listbox in the header chrome; results are real links the router
// intercepts. Rebuilt per language because the chrome is rebuilt on a language switch.

import { esc } from '../ui/esc';
import { getLanguage, languageTag, type TranslationKey, t } from '../ui/i18n';
import {
  GUIDE_CLASSES,
  GUIDE_DEEDS,
  GUIDE_DELVES,
  GUIDE_DUNGEONS,
  GUIDE_FAMILIES,
  GUIDE_ZONES,
} from './content.generated';
import { GLOSSARY_TERMS } from './pages/glossary';
import { GUIDE_ROUTES, hrefFor } from './routes';

export interface SearchEntry {
  label: string;
  type: string;
  href: string;
  haystack: string;
}

const MAX_RESULTS = 10;

// Case-fold through the active locale so the haystack and the needle lower-case
// identically. A locale-agnostic toLowerCase mishandles the Turkish dotted-I:
// 'Insansilar-with-dotted-I'.toLowerCase() injects a combining dot after the i, so
// a typed plain 'insan' never matches. The deeds window folds the same way
// (src/ui/deeds_window.ts).
const fold = (s: string): string => s.toLocaleLowerCase(languageTag(getLanguage()));

/** Exported for the node-level tests; the UI consumes it through mountSearch. */
export function buildIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const add = (label: string, type: string, href: string, extra = '') => {
    if (label) entries.push({ label, type, href, haystack: fold(`${label} ${extra}`) });
  };

  for (const r of GUIDE_ROUTES) {
    if (r.id === 'home') continue;
    add(t(r.navKey), t('guide.search.typePage'), hrefFor(r.sub));
  }
  for (const c of GUIDE_CLASSES) {
    const cls = t(`classes.${c.id}` as TranslationKey);
    add(
      cls,
      t('guide.search.typeClass'),
      hrefFor(`classes/${c.id}`),
      `${c.roles.join(' ')} ${c.resource}`,
    );
    // Signature abilities land on the class page that showcases them; ability names are
    // English proper nouns from the sim, like class and creature names.
    for (const a of c.signatureAbilities) {
      add(a.name, t('guide.search.typeAbility'), hrefFor(`classes/${c.id}`), cls);
    }
  }
  for (const z of GUIDE_ZONES) {
    add(z.name, t('guide.search.typeZone'), `${hrefFor('world')}#zone-${z.biome}`);
  }
  for (const f of GUIDE_FAMILIES) {
    add(
      t(`guide.family.${f.family}.name` as TranslationKey),
      t('guide.search.typeCreature'),
      `${hrefFor('bestiary')}#fam-${f.family}`,
    );
  }
  for (const d of GUIDE_DUNGEONS) {
    add(
      d.isRaid ? t('guide.dungeonsPage.raidName') : (d.name ?? ''),
      t('guide.search.typeDungeon'),
      `${hrefFor('dungeons')}#dungeon-${d.id}`,
    );
  }
  for (const d of GUIDE_DELVES) {
    add(d.name, t('guide.search.typeDelve'), `${hrefFor('delves')}#delve-${d.id}`);
  }
  for (const g of GLOSSARY_TERMS) {
    add(t(g.term), t('guide.search.typeTerm'), `${hrefFor('reference/glossary')}#term-${g.slug}`);
  }
  // Public deed names (hidden deeds never reach GUIDE_DEEDS), deep-linked to their
  // category's section of the full roll.
  for (const d of GUIDE_DEEDS) {
    add(d.name, t('guide.search.typeDeed'), `${hrefFor('deeds')}#deed-cat-${d.category}`);
  }
  return entries;
}

// Token match: every query token must appear somewhere in the haystack, so word order
// never matters ("crypt hollow" finds The Hollow Crypt). Scored so label prefixes beat
// word prefixes beat plain substrings.
function scoreEntry(e: SearchEntry, tokens: string[]): number {
  const label = fold(e.label);
  let score = 0;
  for (const tok of tokens) {
    if (!e.haystack.includes(tok)) return -1;
    if (label.startsWith(tok)) score += 3;
    else if (label.includes(` ${tok}`)) score += 2;
    else if (label.includes(tok)) score += 1;
  }
  return score;
}

/** Exported for the node-level tests; the UI consumes it through mountSearch. */
export function rank(index: SearchEntry[], query: string): SearchEntry[] {
  const q = fold(query.trim());
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const hits = index.map((e) => ({ e, score: scoreEntry(e, tokens) })).filter((h) => h.score >= 0);
  hits.sort((a, b) => b.score - a.score || a.e.label.localeCompare(b.e.label));
  return hits.slice(0, MAX_RESULTS).map((h) => h.e);
}

// Wrap each matched query token in <mark> so the reader sees why a result matched.
// Matches on the RAW label, then escapes every segment individually (matched and
// unmatched alike), so entities in a label ("Gear & Items") can never be split by a
// token and no unescaped text ever reaches the panel HTML.
function highlightLabel(label: string, query: string): string {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return esc(label);
  const re = new RegExp(`(${tokens.join('|')})`, 'gi');
  return label
    .split(re)
    .map((part, i) => (i % 2 === 1 ? `<mark>${esc(part)}</mark>` : esc(part)))
    .join('');
}

// Ranked results grouped by their type, keeping the score order both across groups (a
// group sits where its best hit ranked) and within each group. Pure over its input, so
// the node tests exercise it directly.
export function groupByType(results: SearchEntry[]): [string, SearchEntry[]][] {
  const groups = new Map<string, SearchEntry[]>();
  for (const r of results) {
    const g = groups.get(r.type);
    if (g) g.push(r);
    else groups.set(r.type, [r]);
  }
  return [...groups.entries()];
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
    options.forEach((o, i) => {
      o.setAttribute('aria-selected', String(i === active));
    });
    const current = options[active];
    current.classList.add('is-active');
    options.forEach((o, i) => {
      if (i !== active) o.classList.remove('is-active');
    });
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
    // Group by kind under small eyebrow headings. Option ids stay sequential across
    // groups so the combobox keyboard order is unchanged.
    let optId = 0;
    panel.innerHTML = groupByType(results)
      .map(([type, rs]) => {
        const opts = rs
          .map(
            (r) =>
              `<a class="guide-search-opt" role="option" id="gso-${optId++}" href="${esc(r.href)}" aria-selected="false" tabindex="-1"><span class="guide-search-opt-label">${highlightLabel(r.label, input.value)}</span><span class="guide-sr-only">, ${esc(r.type)}</span></a>`,
          )
          .join('');
        return `<div class="guide-search-group" role="group" aria-label="${esc(type)}"><div class="guide-search-group-h" aria-hidden="true">${esc(type)}</div>${opts}</div>`;
      })
      .join('');
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    options = Array.from(panel.querySelectorAll<HTMLAnchorElement>('.guide-search-opt'));
    active = -1;
    input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', render, { signal });
  input.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(active + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(active - 1);
      } else if (e.key === 'Enter') {
        if (active >= 0 && options[active]) {
          e.preventDefault();
          options[active].click();
        }
      } else if (e.key === 'Escape') {
        input.value = '';
        close();
      }
    },
    { signal },
  );
  // A chosen result navigates via the router (link click); just close the panel.
  panel.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement).closest('.guide-search-opt')) {
        input.value = '';
        close();
      }
    },
    { signal },
  );
  // Close when focus or a click leaves the search box.
  document.addEventListener(
    'click',
    (e) => {
      if (!root.querySelector('.guide-search')?.contains(e.target as Node)) close();
    },
    { signal },
  );
}

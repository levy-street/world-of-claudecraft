// Markup for the Adventure Journal's boss search (strings only, never DOM):
// the field at the top of the instance list and its result list, each result
// a boss portrait, its name and its instance. Also the search's page list:
// every boss page the player may browse, its names localized in the current
// language for the pure matcher (journal_search_view.ts).

import { esc } from '../../esc';
import { FOCUS_KEY_ATTR } from '../../focus_restore';
import { formatNumber, t, tPlural } from '../../i18n';
import type { JournalInstance } from './journal_catalog';
import { instanceName, mobName, pageName } from './journal_page_html';
import type { JournalSearchPage, JournalSearchResult } from './journal_search_view';

/** The result list's id, the field's aria-controls. */
export const SEARCH_LIST_ID = 'aj-search-results';

// A magnifier and a cross drawn for this field. Decorative: the field and its
// clear button carry their own names.
const GLYPH_SEARCH =
  '<svg class="aj-glyph aj-search-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.4 10.4L14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const GLYPH_CLEAR =
  '<svg class="aj-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** Every boss page of the instances the list shows, in list order, with
 *  the names the player reads (a council answers to its title and to each
 *  member's name). */
export function journalSearchPages(instances: readonly JournalInstance[]): JournalSearchPage[] {
  const pages: JournalSearchPage[] = [];
  for (const instance of instances) {
    const place = instanceName(instance.id);
    for (const bossKey of instance.source.bossKeys) {
      const view = instance.source.view(bossKey, 'normal');
      const members = view.members ?? [view.mobId];
      pages.push({
        instanceId: instance.id,
        bossKey,
        name: pageName(members, view.nameKey),
        aliases: members.length > 1 || view.nameKey ? members.map(mobName) : [],
        instanceName: place,
        portraitUrl: view.portraitUrl,
      });
    }
  }
  return pages;
}

/** The id of one result row (the field's aria-activedescendant). */
export function searchOptionId(index: number): string {
  return `aj-search-opt-${index}`;
}

/** What the polite status line says for a query: how many bosses matched,
 *  or that none did; empty with no query. Plain text (the controller writes
 *  it into one persistent live region). */
export function searchStatusText(query: string, results: readonly JournalSearchResult[]): string {
  if (!query.trim()) return '';
  return results.length
    ? tPlural('hudChrome.adventureJournal.searchCount', results.length, {
        count: formatNumber(results.length),
      })
    : t('hudChrome.adventureJournal.searchEmpty');
}

/** The result list for a query: the hits, or the empty state. Empty markup
 *  when there is no query. */
export function searchResultsHtml(
  query: string,
  results: readonly JournalSearchResult[],
  active: number,
): string {
  if (!query.trim()) return '';
  if (!results.length) {
    return `<p class="aj-search-empty" aria-hidden="true">${esc(
      t('hudChrome.adventureJournal.searchEmpty'),
    )}</p>`;
  }
  return `<ul class="aj-search-list" id="${SEARCH_LIST_ID}" role="listbox" aria-label="${esc(
    t('hudChrome.adventureJournal.searchResults'),
  )}">${results
    .map((result, index) => {
      const selected = index === active;
      return `<li class="aj-search-hit${selected ? ' active' : ''}" role="option" id="${searchOptionId(
        index,
      )}" aria-selected="${selected}" data-search-hit="${index}"><span class="aj-boss-portrait"><img src="${esc(
        result.portraitUrl,
      )}" alt="" aria-hidden="true"></span><span class="aj-boss-text"><span class="aj-search-name">${esc(
        result.name,
      )}</span><span class="aj-search-instance">${esc(result.instanceName)}</span></span></li>`;
    })
    .join('')}</ul>`;
}

/** The search field (a magnifier, the input and its clear button) and the
 *  box its results paint into. */
export function searchFieldHtml(
  query: string,
  results: readonly JournalSearchResult[],
  active: number,
): string {
  const open = query.trim() !== '' && results.length > 0;
  const clear = t('hudChrome.adventureJournal.searchClear');
  return `<div class="aj-search"><div class="aj-search-field">${GLYPH_SEARCH}<input type="search" class="ui-input aj-search-input" role="combobox" aria-autocomplete="list" aria-controls="${SEARCH_LIST_ID}" aria-expanded="${open}"${
    open && active >= 0 ? ` aria-activedescendant="${searchOptionId(active)}"` : ''
  } aria-label="${esc(t('hudChrome.adventureJournal.searchLabel'))}" ${FOCUS_KEY_ATTR}="journal-search" value="${esc(
    query,
  )}" placeholder="${esc(
    t('hudChrome.adventureJournal.searchPlaceholder'),
  )}" autocomplete="off" spellcheck="false" enterkeyhint="search"><button type="button" class="aj-search-clear" data-search-clear ${FOCUS_KEY_ATTR}="journal-search-clear" aria-label="${esc(
    clear,
  )}" title="${esc(clear)}">${GLYPH_CLEAR}</button></div><span class="visually-hidden" role="status" data-search-status>${esc(
    searchStatusText(query, results),
  )}</span><div class="aj-search-results" data-search-results>${searchResultsHtml(
    query,
    results,
    active,
  )}</div></div>`;
}

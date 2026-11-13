import { sharedName } from './article_mentions';

// Pages that share a name point at each other. With one other page, the note links
// straight to it. With more, the note links to a disambiguation page that lists them all.

export interface NamedPage {
  title: string;
  text: string;
}

export const DISAMBIGUATION = 'Disambiguation';

/** Article pages take part; indexes, directories and wiki housekeeping pages do not. */
export function articleName(page: NamedPage): string | null {
  if (/^(?:Category|MediaWiki):/.test(page.title) || / index\)(?: \(\d+\))?$/.test(page.title))
    return null;
  if (/\[\[Category:(?:Portals|Wiki|Sources|[^\]]* directories)\]\]/.test(page.text)) return null;
  return sharedName(page.title);
}

const ART = /^<woc-art [^>]*\/>\n/;

// The note goes above the article but below the page art line, which must stay first.
function withNote(text: string, note: string): string {
  const art = ART.exec(text)?.[0] ?? '';
  return art + ":''" + note + "''\n\n" + text.slice(art.length);
}

/**
 * `baseOf` gives the shared name of a page ("Mother of Pearl" for both the item and the
 * quest) or null for pages that take no part (indexes, directories). Adds a see-also note
 * to every page whose name is shared and returns the new disambiguation pages.
 */
export function addDisambiguation(
  pages: NamedPage[],
  baseOf: (page: NamedPage) => string | null,
): NamedPage[] {
  const taken = new Set(pages.map((p) => p.title));
  const groups = new Map<string, NamedPage[]>();
  for (const page of pages) {
    const base = baseOf(page);
    if (base === null) continue;
    groups.set(base, [...(groups.get(base) ?? []), page]);
  }
  const created: NamedPage[] = [];
  for (const [base, group] of groups) {
    if (group.length < 2) continue;
    if (group.length === 2) {
      const [a, b] = group;
      a.text = withNote(a.text, 'Another page has this name: [[' + b.title + ']].');
      b.text = withNote(b.text, 'Another page has this name: [[' + a.title + ']].');
      // The plain name leads to both when no page owns it.
      if (!taken.has(base)) created.push(listPage(base, base, group));
      continue;
    }
    const title = taken.has(base) ? base + ' (disambiguation)' : base;
    if (taken.has(title)) continue;
    created.push(listPage(title, base, group));
    for (const page of group)
      page.text = withNote(
        page.text,
        'Other pages have this name. See [[' + title + '|all pages named ' + base + ']].',
      );
  }
  for (const page of created) taken.add(page.title);
  return created;
}

function listPage(title: string, base: string, group: NamedPage[]): NamedPage {
  return {
    title,
    text:
      'More than one page is named ' +
      base +
      '. Pick the one you want.\n\n' +
      [...group]
        .sort((a, b) => a.title.localeCompare(b.title, 'en'))
        .map((p) => '* [[' + p.title + ']]')
        .join('\n') +
      '\n\n[[Category:' +
      DISAMBIGUATION +
      ']]',
  };
}

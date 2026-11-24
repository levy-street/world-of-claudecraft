// Stable public addresses for encyclopedia articles. Every article lives under /wiki at
// /wiki/<section>/<slug>, where the section names what the page is (an item, a quest) and
// can never be one of the Guide's own top-level paths. Once an address ships it is pinned
// in mediawiki/site_paths.json, so a later change to how pages are classified never moves
// a page; a renamed or removed page keeps its old address as a redirect.
import { isDirectory } from '../../mediawiki/reader/browse.js';

export const WIKI_BASE = '/wiki';
export const SITE_ORIGIN = 'https://worldofclaudecraft.com';
/** The encyclopedia's front page. */
export const HOME_PATH = '/wiki/encyclopedia';

// What a page is, from its info-box category, in the order the reader checks them.
const SECTION_BY_CATEGORY = [
  ['Items', 'item'],
  ['Mobs', 'creature'],
  ['Friendly creatures', 'creature'],
  ['NPCs', 'npc'],
  ['Quests', 'quest'],
  ['World quests', 'quest'],
  ['Weekly quests', 'quest'],
  ['Zones', 'zone'],
  ['Raids', 'raid'],
  ['Dungeons', 'dungeon'],
  ['Abilities', 'ability'],
  ['Classes', 'class'],
  ['Book of Deeds', 'deed'],
  ['Talent choices', 'talent'],
  ['Specializations', 'spec'],
  ['Crafting recipes', 'recipe'],
];

/** Every section an encyclopedia address can start with (after /wiki/). */
export const SECTIONS = [
  ...new Set([
    'encyclopedia',
    'browse',
    'topic',
    ...SECTION_BY_CATEGORY.map(([, section]) => section),
  ]),
];

/** A URL-safe slug: lower case ASCII words joined by hyphens. */
export function slugify(title) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'page';
}

/** A title without its final parenthesized qualifier: "Wolf (Mob)" becomes "Wolf". */
export function stripQualifier(title) {
  return title.replace(/\s*\([^()]*\)$/, '') || title;
}

/** The section a new page's address goes under. */
export function sectionFor(page) {
  if (page.title === 'Main Page') return 'encyclopedia';
  if (isDirectory(page)) return 'browse';
  for (const [category, section] of SECTION_BY_CATEGORY)
    if (page.categories.includes(category)) return section;
  return 'topic';
}

/**
 * Addresses for every page. `registry.pages` (title to path) wins for pages already
 * published; new pages get /wiki/<section>/<slug>, with a number added when two titles
 * share a slug. Returns the full title-to-path map and the titles that were new.
 */
export function assignPaths(pages, registry = { pages: {}, redirects: {} }) {
  const paths = new Map();
  const taken = new Set([...Object.keys(registry.redirects ?? {})]);
  const pinned = registry.pages ?? {};
  for (const title of pages.keys()) {
    if (Object.hasOwn(pinned, title)) {
      paths.set(title, pinned[title]);
      taken.add(pinned[title]);
    }
  }
  const added = [];
  // A trailing qualifier such as "(Deed)" or "(Mob)" only tells same-named pages apart;
  // the section already says what the page is, so the short slug is used wherever it
  // is unique within its section.
  const fresh = [...pages.keys()].filter((title) => !paths.has(title)).sort();
  const shortCount = new Map();
  for (const title of fresh) {
    const key = sectionFor(pages.get(title)) + '/' + slugify(stripQualifier(title));
    shortCount.set(key, (shortCount.get(key) ?? 0) + 1);
  }
  // Sorted so the numbering of a shared slug never depends on page order.
  for (const title of fresh) {
    const page = pages.get(title);
    const section = sectionFor(page);
    const short = slugify(stripQualifier(title));
    const slug = shortCount.get(section + '/' + short) === 1 ? short : slugify(title);
    const base = section === 'encyclopedia' ? HOME_PATH : `${WIKI_BASE}/${section}/${slug}`;
    let path = base;
    for (let n = 2; taken.has(path); n++) path = `${base}-${n}`;
    taken.add(path);
    paths.set(title, path);
    added.push(title);
  }
  return { paths, added };
}

/**
 * What changed against the registry: pages new since it was written, and published
 * addresses whose page no longer exists and has no redirect yet.
 */
export function registryDrift(paths, registry) {
  const pinned = registry.pages ?? {};
  const missing = Object.keys(pinned).filter((title) => !paths.has(title));
  const added = [...paths.keys()].filter((title) => !Object.hasOwn(pinned, title));
  return { added, missing };
}

/** The file a page's static HTML is written to, relative to the site root. */
export function fileForPath(path) {
  return path.replace(/^\//, '') + '/index.html';
}

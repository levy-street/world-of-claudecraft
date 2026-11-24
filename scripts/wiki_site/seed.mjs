// Reads the generated MediaWiki seed (scripts/mediawiki/build_seed.mjs) into the page
// records the reader renders. The export format is fixed by that generator, so a
// streaming regex is enough and avoids parsing 30 MB of XML into a DOM.
import { readFileSync } from 'node:fs';
import { pageRecord } from '../../mediawiki/reader/page_render.js';
import { sectionFor } from './paths.mjs';

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const unescapeXml = (text) => text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => ENTITIES[name]);

/** Page records by title, from the seed's XML text. MediaWiki: pages are skipped. */
export function parseSeed(xml) {
  const pages = new Map();
  const pattern = /<page>\s*<title>([^<]*)<\/title>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>/g;
  for (const match of xml.matchAll(pattern)) {
    const title = unescapeXml(match[1]);
    if (title.startsWith('MediaWiki:')) continue;
    pages.set(title, pageRecord(title, unescapeXml(match[2])));
  }
  return pages;
}

/** The seed's pages plus its hover cards (the .tooltips.json written beside it). */
export function readSeed(file) {
  const pages = parseSeed(readFileSync(file, 'utf8'));
  const cardsFile = file.replace(/\.xml$/i, '') + '.tooltips.json';
  let tooltips = {};
  try {
    tooltips = JSON.parse(readFileSync(cardsFile, 'utf8'));
  } catch {}
  return { pages, tooltips };
}

const KIND_LABELS = {
  item: 'Item',
  creature: 'Creature',
  npc: 'Character',
  quest: 'Quest',
  zone: 'Zone',
  raid: 'Raid',
  dungeon: 'Dungeon',
  ability: 'Ability',
  class: 'Class',
  deed: 'Book of Deeds entry',
  talent: 'Talent choice',
  spec: 'Specialization',
  recipe: 'Crafting recipe',
  browse: 'Directory',
  topic: 'Reference page',
};

/** What a page is, in words, for its fallback description. */
export function pageKind(page, directory = false) {
  if (page.categories.includes('Disambiguation')) return 'Disambiguation page';
  return KIND_LABELS[directory ? 'browse' : sectionFor(page)] ?? 'Reference page';
}

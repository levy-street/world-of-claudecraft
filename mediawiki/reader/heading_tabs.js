// A run of three or more subheadings that are each a single link (the per-class tables on
// the Emissary's Cache, for example) reads better as tabs than as a long stack. The
// subheading becomes the tab, and everything under it until the next heading its panel.
import { makeTabs } from './tabs.js';

const MIN_TABS = 3;
// Only a class makes a tab: deed chapters and other link headings stay as they are, since
// each of those is part of the page a reader needs to see whole. A class missing here
// simply stays stacked.
const CLASS_NAMES = new Set([
  'Warrior',
  'Paladin',
  'Hunter',
  'Rogue',
  'Priest',
  'Shaman',
  'Mage',
  'Warlock',
  'Druid',
  'Necromancer',
]);

function isLinkHeading(node) {
  return (
    node?.tagName === 'H3' &&
    node.children.length === 1 &&
    node.firstElementChild.tagName === 'A' &&
    node.textContent.trim() === node.firstElementChild.textContent.trim() &&
    CLASS_NAMES.has(node.textContent.trim())
  );
}

/** Each run of link-only h3s directly under the article becomes one tab set. */
export function layoutHeadingTabs(article, idPrefix = 'heading-tabs-') {
  let set = 0;
  let node = article.firstElementChild;
  while (node) {
    if (!isLinkHeading(node)) {
      node = node.nextElementSibling;
      continue;
    }
    const groups = [];
    let cursor = node;
    while (isLinkHeading(cursor)) {
      const nodes = [];
      let body = cursor.nextElementSibling;
      while (body && !body.matches('h2, h3')) {
        nodes.push(body);
        body = body.nextElementSibling;
      }
      groups.push({ heading: cursor, label: cursor.textContent.trim(), nodes });
      cursor = body;
    }
    if (groups.length >= MIN_TABS) {
      const { tabs, panels } = makeTabs(groups, {
        label: 'Choose one',
        idPrefix: idPrefix + set++ + '-',
        tabClass: 'loot-tab heading-tab',
        panelClass: 'heading-panel',
        listClass: 'loot-tabs heading-tabs',
      });
      groups[0].heading.before(tabs, ...panels);
      for (const group of groups) group.heading.remove();
    }
    node = cursor;
  }
}

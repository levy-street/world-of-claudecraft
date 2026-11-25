// Turns the "Normal loot" and "Heroic loot" subsections of a creature page into two tabs,
// so a reader sees one difficulty at a time. Also marks the small titles above each table.
import { makeTabs } from './tabs.js';

const TABS = ['Normal loot', 'Heroic loot'];

export function sectionNodes(heading) {
  const nodes = [];
  for (
    let node = heading.nextElementSibling;
    node && !node.matches('h2,h3');
    node = node.nextElementSibling
  )
    nodes.push(node);
  return nodes;
}

export function layoutLoot(article) {
  const loot = [...article.children].find(
    (node) => node.tagName === 'H2' && node.textContent === 'Loot',
  );
  if (!loot) return;
  // A paragraph that is only a bold phrase is the title of the table below it.
  for (let node = loot.nextElementSibling; node && node.tagName !== 'H2'; ) {
    const strong = node.tagName === 'P' && node.children.length === 1 && node.firstElementChild;
    if (strong && strong.tagName === 'STRONG' && node.textContent === strong.textContent)
      node.classList.add('loot-title');
    node = node.nextElementSibling;
  }
  const headings = [];
  for (let node = loot.nextElementSibling; node && node.tagName !== 'H2'; ) {
    if (node.tagName === 'H3' && TABS.includes(node.textContent)) headings.push(node);
    node = node.nextElementSibling;
  }
  if (headings.length < 2) return;
  const { tabs, panels } = makeTabs(
    headings.map((heading) => ({
      label: heading.textContent.replace(' loot', ''),
      nodes: sectionNodes(heading),
    })),
    {
      label: 'Loot by difficulty',
      idPrefix: 'loot-panel-',
      tabClass: 'loot-tab',
      panelClass: 'loot-panel',
      listClass: 'loot-tabs',
    },
  );
  headings[0].before(tabs, ...panels);
  for (const heading of headings) heading.remove();
}

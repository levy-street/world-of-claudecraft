// A boss page prints its fight twice, once per difficulty ("Normal encounter", "Heroic
// encounter"). The reader shows it once, as an "Encounter" section with Normal and Heroic
// tabs, and groups each phase's heading, summary and attacks into one block.
import { makeTabs } from './tabs.js';

const TIERS = [
  ['Normal encounter', 'Normal'],
  ['Heroic encounter', 'Heroic'],
];
// Blocks the generator adds after the phases (scripts/mediawiki/encounter_articles.ts).
const EXTRAS = new Set(['Tips by role', 'Your choice', 'Heroic changes']);

function sectionBody(heading) {
  const nodes = [];
  for (let node = heading.nextElementSibling; node && node.tagName !== 'H2'; ) {
    nodes.push(node);
    node = node.nextElementSibling;
  }
  return nodes;
}

/** The lead paragraphs stay as the overview; each h3 opens a phase block. */
export function groupPhases(nodes, blockClass = 'encounter-phase') {
  const out = [];
  let block = null;
  for (const node of nodes) {
    if (node.tagName === 'H3') {
      block = document.createElement('section');
      block.className = EXTRAS.has(node.textContent) ? blockClass + ' encounter-extra' : blockClass;
      block.append(node);
      out.push(block);
    } else if (block) {
      if (node.tagName === 'P' && block.children.length === 1)
        node.classList.add('encounter-summary');
      block.append(node);
    } else {
      if (node.tagName === 'P') node.classList.add('encounter-overview');
      out.push(node);
    }
  }
  return out;
}

/** A class page's specializations: one card per spec (its h3 and everything under it). */
export function layoutSpecCards(article) {
  const heading = [...article.children].find(
    (n) => n.tagName === 'H2' && n.textContent === 'Specializations',
  );
  if (!heading) return;
  const nodes = groupPhases(sectionBody(heading), 'spec-card');
  heading.after(...nodes);
}

export function layoutEncounter(article) {
  const found = TIERS.map(([title, label]) => ({
    heading: [...article.children].find((n) => n.tagName === 'H2' && n.textContent === title),
    label,
  })).filter((tier) => tier.heading);
  if (!found.length) return;
  const groups = found.map((tier) => ({
    label: tier.label,
    nodes: groupPhases(sectionBody(tier.heading)),
  }));
  const first = found[0].heading;
  if (groups.length === 1) {
    first.after(...groups[0].nodes);
    return;
  }
  const { tabs, panels } = makeTabs(groups, {
    label: 'Encounter by difficulty',
    idPrefix: 'encounter-panel-',
    tabClass: 'loot-tab encounter-tab',
    panelClass: 'encounter-panel',
    listClass: 'loot-tabs encounter-tabs',
  });
  first.textContent = 'Encounter';
  first.after(tabs, ...panels);
  for (const tier of found.slice(1)) tier.heading.remove();
}

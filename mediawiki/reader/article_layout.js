import { organizeReferenceDetails } from './article_disclosures.js';

// Arrange the rendered wikitext without reinterpreting game values or their links.
const factSections = {
  Zones: 'Facts',
  Items: 'Facts',
  Mobs: 'Facts',
  Classes: 'Starting statistics',
  NPCs: 'Details',
  Abilities: 'Learn and use',
  Quests: 'Quest brief',
  Dungeons: 'Entry',
  Raids: 'Entry',
};
const boxTitles = {
  Zones: 'Zone information',
  Items: 'Item information',
  Mobs: 'Creature information',
  Classes: 'Class information',
  NPCs: 'Character information',
  Abilities: 'Ability information',
  Quests: 'Quest information',
  Dungeons: 'Dungeon information',
  Raids: 'Raid information',
  'Book of Deeds': 'Deed information',
};

function sectionBody(heading) {
  const body = [];
  for (
    let node = heading?.nextElementSibling;
    node && !node.matches('h2,h3');
    node = node.nextElementSibling
  )
    body.push(node);
  return body;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A section has its own shareable fragment after the encoded article title. */
export function sectionRoute(hash) {
  const split = hash.indexOf('#', 1);
  return {
    article: decodeURIComponent(hash.slice(1, split < 0 ? undefined : split)) || 'Main Page',
    section: split < 0 ? '' : decodeURIComponent(hash.slice(split + 1)),
  };
}

function contents(article, pageTitle, wide) {
  const headings = [...article.children].filter((node) => node.matches('h2,h3'));
  const details = element('details', 'wiki-contents');
  details.open = wide;
  details.append(element('summary', null, 'Contents'));
  const nav = element('nav');
  nav.setAttribute('aria-label', 'Article contents');
  const list = element('ol');
  const seen = new Set();
  let parent = null,
    sublist = null;
  for (const h of headings) {
    const base =
      h.textContent
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '') || 'section';
    let slug = base;
    for (let n = 2; seen.has(slug); n++) slug = base + '-' + n;
    seen.add(slug);
    h.id = 'section-' + slug;
    h.tabIndex = -1;
    const item = element('li'),
      a = element('a', null, h.textContent);
    a.href = '#' + encodeURIComponent(pageTitle) + '#' + encodeURIComponent(slug);
    item.append(a);
    if (h.tagName === 'H3' && parent) {
      if (!sublist) {
        sublist = element('ol');
        parent.append(sublist);
      }
      sublist.append(item);
    } else {
      list.append(item);
      parent = item;
      sublist = null;
    }
  }
  nav.append(list);
  details.append(nav);
  return headings.length >= 2 ? details : null;
}

function extractLead(article, headings) {
  if (article.firstElementChild?.tagName === 'P') return article.firstElementChild;
  const heading = headings[0];
  if (
    !heading ||
    !['Overview', 'How it works', 'Effect', 'How to start'].includes(heading.textContent)
  )
    return null;
  const [first, ...rest] = sectionBody(heading);
  if (first?.tagName !== 'P') return null;
  if (!rest.length) heading.remove();
  return first;
}

const STAT_HEADINGS = ['Ability stats', 'At a glance'];

// The headline numbers of an ability, talent, specialization or creature (cost, cast time, cooldown, range) as one strip
// under the title. Values for several ranks arrive already joined with slashes.
function statStrip(article, headings) {
  const heading = headings.find((el) => STAT_HEADINGS.includes(el.textContent));
  const table = sectionBody(heading)[0]?.querySelector?.('table');
  if (!table) return null;
  const strip = element('dl', 'ability-stats');
  for (const row of table.querySelectorAll('tr')) {
    const label = row.querySelector('th'),
      value = row.querySelector('td');
    if (!label || !value) continue;
    const stat = element('div');
    const dd = element('dd');
    dd.append(...value.childNodes);
    stat.append(element('dt', null, label.textContent), dd);
    strip.append(stat);
  }
  for (const node of sectionBody(heading)) node.remove();
  heading.remove();
  return strip;
}

export function layoutArticle(view, page, wide, zoneName) {
  const article = view.querySelector('article'),
    pageHeading = view.querySelector('.article-heading');
  article.classList.add('wiki-prose');
  pageHeading.classList.add('wiki-title');
  const kind = page.categories[0];
  const headings = [...article.children].filter((e) => e.tagName === 'H2');
  const heading = headings.find((el) => el.textContent === factSections[kind]);
  const factNodes = sectionBody(heading);
  let facts = null;
  if (
    factNodes.length === 1 &&
    factNodes[0].matches('.scroll') &&
    factNodes[0].querySelector('table')
  ) {
    facts = factNodes[0];
    facts.remove();
    heading.remove();
  }
  const stats = statStrip(article, headings);
  const lead = extractLead(article, headings);
  if (lead) {
    lead.remove();
    lead.classList.add('wiki-lead');
  }
  const art = pageHeading.querySelector('img');
  const rewardHeading =
    kind === 'Book of Deeds' ? headings.find((h) => h.textContent === 'Reward') : null;
  const rewards = sectionBody(rewardHeading).filter(
    (node) => !(node.tagName === 'P' && node.textContent === 'See Book of Deeds.'),
  );
  if (rewards.length) rewardHeading.remove();
  let box = null;
  if (facts || rewards.length) {
    box = element('aside', 'wiki-infobox');
    const name = boxTitles[kind] || 'Article information';
    box.setAttribute('aria-label', name);
    box.append(element('div', 'wiki-box-title', name));
    if (art) {
      const figure = element('div', 'wiki-box-art');
      figure.append(art);
      box.append(figure);
    }
    if (facts) box.append(facts);
    if (rewards.length) {
      const block = element('div', 'wiki-reward');
      block.append(element('strong', null, 'Reward'), ...rewards);
      box.append(block);
    }
  }
  let introduction = lead;
  if (!introduction && kind === 'Quests') {
    introduction = element('p', 'wiki-lead');
    introduction.append(
      element('strong', null, page.title),
      zoneName ? ' is a quest in ' + zoneName + '.' : ' is a quest.',
    );
  }
  if (kind === 'Zones' && facts) {
    const rows = new Map(
      [...facts.querySelectorAll('tr')].map((row) => [
        row.querySelector('th')?.textContent,
        row.querySelector('td')?.textContent,
      ]),
    );
    if (rows.get('Level range') && rows.get('Hub')) {
      introduction = element('p', 'wiki-lead');
      const level = rows.get('Level range').split('-');
      const band =
        level[1] && level[0] !== level[1] ? 'levels ' + level.join(' to ') : 'level ' + level[0];
      introduction.append(
        element('strong', null, page.title),
        ' is a zone for adventurers at ' + band + '. Its hub is ' + rows.get('Hub') + '.',
      );
      if (lead) {
        lead.className = 'wiki-flavor';
        article.prepend(lead);
      }
    }
  }
  organizeReferenceDetails(article);
  const toc = contents(article, page.title, wide);
  const front = element('div', 'wiki-opening');
  if (stats) front.append(stats);
  if (introduction) front.append(introduction);
  if (toc) front.append(toc);
  if (front.childNodes.length) article.prepend(front);
  if (box) article.prepend(box);
  const tags = view.querySelector('.tags');
  if (tags?.children.length) {
    tags.classList.add('wiki-categories');
    tags.setAttribute('aria-label', 'Article categories');
    tags.prepend(element('strong', null, 'Categories'));
    article.after(tags);
  } else tags?.remove();
}

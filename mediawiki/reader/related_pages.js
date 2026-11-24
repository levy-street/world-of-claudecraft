import { directoryLink, isCollection, isDirectory } from './browse.js';

const labelFor = (title) =>
  title === 'Mobs'
    ? 'Enemies'
    : title.replace(/ \((?:Items|Abilities|NPCs|Enemies|Quests) index\)(?: \(\d+\))?$/, '');

// Only directory membership and explicit categories establish a relationship.
// An incidental link in a walkthrough must not turn into a navigation category.
export function relatedPageIndex(pages) {
  const groups = new Map(),
    memberships = new Map(),
    owners = new Set();
  function addGroup(title, entries, label = labelFor(title)) {
    const members = [...new Map(entries.map((entry) => [entry.title, entry])).values()]
      .filter((entry) => pages.has(entry.title) && entry.title !== title)
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
    if (!members.length) return;
    const group = { title, label, members };
    groups.set(title + '#' + label, group);
    owners.add(title);
    for (const member of members) {
      const found = memberships.get(member.title) ?? [];
      found.push(group);
      memberships.set(member.title, found);
    }
  }
  for (const page of pages.values()) {
    if (!isDirectory(page)) continue;
    const entries = [];
    const sections = new Map();
    let section = '';
    for (const line of page.text.split('\n')) {
      const heading = line.match(/^== (.+) ==$/);
      if (heading) section = heading[1];
      if (!line.startsWith('* ')) continue;
      const entry = directoryLink(line.slice(2));
      if (!entry || !pages.has(entry.title)) continue;
      if (isCollection(page) && pages.get(entry.title).categories[0] !== page.title) continue;
      entries.push(entry);
      const members = sections.get(section) ?? [];
      members.push(entry);
      sections.set(section, members);
    }
    if (page.title === 'Gameplay Systems' && sections.size > 1) {
      for (const [label, members] of sections) addGroup(page.title, members, label);
    } else addGroup(page.title, entries);
  }
  const categories = new Map();
  for (const page of pages.values()) {
    if (isDirectory(page)) continue;
    for (const category of page.categories) {
      if (!pages.has(category) || owners.has(category)) continue;
      const entries = categories.get(category) ?? [];
      entries.push({ title: page.title, label: page.title });
      categories.set(category, entries);
    }
  }
  for (const [title, entries] of categories) addGroup(title, entries);
  return { groups, memberships };
}

export function relatedGroups(page, index) {
  const candidates = index.memberships.get(page.title) ?? [];
  // A specific item/quest directory takes precedence over the whole catalog.
  const specific = candidates.filter(
    (group) => !page.categories.includes(group.title) || group.label !== labelFor(group.title),
  );
  const selected = candidates.filter((group) =>
    specific.length ? group.members.length <= 30 || specific.includes(group) : true,
  );
  const seen = new Set();
  return selected.filter((group) => {
    const key = group.members
      .map((member) => member.title)
      .sort()
      .join('\n');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function pageLink(title, label) {
  const node = el('a', null, label);
  node.href = '#' + encodeURIComponent(title);
  return node;
}
function memberList(members, current) {
  const list = el('ul', 'wiki-navbox-links');
  for (const member of members) {
    const item = el('li');
    if (member.title === current) {
      const name = el('strong', 'wiki-navbox-current', member.label);
      name.setAttribute('aria-current', 'page');
      item.append(name);
    } else item.append(pageLink(member.title, member.label));
    list.append(item);
  }
  return list;
}

export function mountRelatedPages(view, page, index, pages, { seeAllLinks = false } = {}) {
  const groups = relatedGroups(page, index);
  if (!groups.length) return;
  const nav = el('nav', 'wiki-navbox');
  nav.setAttribute('aria-label', 'Related pages');
  const box = el('details');
  box.open = true;
  box.append(el('summary', 'wiki-navbox-title', 'Related pages'));
  for (const group of groups) {
    const row = el('div', 'wiki-navbox-row');
    const heading = el('div', 'wiki-navbox-group');
    heading.append(pageLink(group.title, group.label));
    row.append(heading);
    const body = el('div', 'wiki-navbox-body');
    const position = group.members.findIndex((member) => member.title === page.title);
    const start = Math.max(0, Math.min(position - 5, group.members.length - 12));
    const preview = group.members.slice(start, start + 12);
    body.append(memberList(preview, page.title));
    if (group.members.length > preview.length && seeAllLinks) {
      // A static page cannot fill the list on demand, and every member page repeating
      // the whole group would bloat the site, so it links to the group's own page.
      const more = el('p', 'wiki-navbox-more');
      more.append(pageLink(group.title, 'See all ' + group.members.length + ' pages'));
      body.append(more);
    } else if (group.members.length > preview.length) {
      const more = el('details', 'wiki-navbox-more');
      more.append(el('summary', null, 'Show all ' + group.members.length + ' pages'));
      more.addEventListener('toggle', () => {
        if (more.open && !more.querySelector('ul')) {
          more.append(memberList(group.members, page.title));
        }
      });
      body.append(more);
    }
    row.append(body);
    box.append(row);
  }
  const categories = page.categories.filter((title) => pages.has(title) && title !== page.title);
  if (categories.length) {
    const footer = el('div', 'wiki-navbox-footer', 'Browse: ');
    categories.forEach((title, i) => {
      if (i) footer.append(' · ');
      footer.append(pageLink(title, labelFor(title)));
    });
    box.append(footer);
  }
  nav.append(box);
  view.querySelector('article').after(nav);
}

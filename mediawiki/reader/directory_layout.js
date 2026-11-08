// Give generated directory entries a reading order without duplicating game data.
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

export function activityFacts(text) {
  return text
    .split(' · ')
    .map((part) => {
      const value = part.trim();
      if (value.startsWith('Normal Finder levels '))
        return ['Normal level', value.slice('Normal Finder levels '.length)];
      if (value === 'Heroic available') return ['Difficulty', 'Normal / Heroic'];
      if (value === 'Normal and Heroic') return ['Difficulty', 'Normal / Heroic'];
      if (/^\d+ players$/.test(value)) return ['Group size', value];
      if (/^\d+ (boss )?encounters?$/.test(value)) return ['Bosses', value.split(' ')[0]];
      return ['', value];
    })
    .filter(([, value]) => value);
}

function activityList(list, raids) {
  list.classList.remove('browse-records');
  list.classList.add('activity-list');
  if (raids) list.classList.add('activity-raids');
  for (const row of list.children) {
    const link = row.querySelector('a');
    if (!link) continue;
    const art = row.querySelector('img');
    const title = link.textContent;
    const facts = activityFacts(row.textContent.slice(title.length).replace(/^\s*·\s*/, ''));
    const content = node('div', 'activity-copy');
    content.append(node('span', 'activity-name', title));
    const details = node('dl', 'activity-facts');
    for (const [label, value] of facts) {
      const fact = node('div');
      if (label) fact.append(node('dt', null, label));
      fact.append(node('dd', null, value));
      details.append(fact);
    }
    content.append(details);
    link.className = 'activity-link';
    link.replaceChildren();
    if (art) {
      art.className = 'activity-art';
      art.removeAttribute('width');
      art.removeAttribute('height');
      const frame = node('span', 'activity-art-frame');
      frame.append(art);
      link.append(frame);
    }
    link.append(content);
    row.replaceChildren(link);
  }
}

export function layoutDirectory(view, page, wide = true) {
  view.classList.add('wiki-directory');
  const article = view.querySelector('article');
  view.querySelector('.article-heading')?.classList.add('directory-heading');
  const tags = view.querySelector('.tags');
  if (!tags?.children.length) tags?.remove();
  const introduction = node('div', 'directory-intro');
  while (article.firstElementChild?.tagName === 'P') introduction.append(article.firstElementChild);
  if (introduction.children.length) (view.querySelector('.jump') ?? article).before(introduction);
  const jump = view.querySelector('.jump');
  if (jump) {
    jump.prepend(node('span', 'jump-label', 'On this page'));
    const contents = node('details', 'directory-contents');
    contents.open = wide;
    contents.append(node('summary', null, 'On this page'));
    jump.before(contents);
    contents.append(jump);
  }
  if (page.title === 'Dungeons' || page.title === 'Raids') {
    view.classList.add('activity-directory');
    for (const list of article.querySelectorAll('.browse-records')) {
      let heading = list.previousElementSibling;
      while (heading && !heading.matches('h2')) heading = heading.previousElementSibling;
      const section = heading?.textContent;
      if (section === 'Five-player dungeons' || section === 'Raids' || page.title === 'Raids') {
        activityList(list, section === 'Raids' || page.title === 'Raids');
        if (heading) {
          const count = node('span', 'section-count', String(list.children.length));
          count.setAttribute('aria-label', list.children.length + ' entries');
          heading.append(count);
        }
      }
    }
  }
  for (const row of article.querySelectorAll('.browse-records > li')) {
    const art = row.querySelector(':scope > img');
    const copy = node('div', 'record-copy');
    for (const child of [...row.childNodes]) if (child !== art) copy.append(child);
    const title = copy.querySelector('a');
    if (title) {
      title.classList.add('record-name');
      const detail = node('span', 'record-detail');
      while (title.nextSibling) detail.append(title.nextSibling);
      const first = detail.firstChild;
      if (first?.nodeType === 3) first.textContent = first.textContent.replace(/^\s*·\s*/, '');
      if (detail.textContent.trim()) copy.append(detail);
    }
    row.append(copy);
  }
}

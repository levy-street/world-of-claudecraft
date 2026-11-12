// Turns the "Normal loot" and "Heroic loot" subsections of a creature page into two tabs,
// so a reader sees one difficulty at a time. Also marks the small titles above each table.
const TABS = ['Normal loot', 'Heroic loot'];

function sectionNodes(heading) {
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
  const tabs = document.createElement('div');
  tabs.className = 'loot-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Loot by difficulty');
  const panels = headings.map((heading, index) => {
    const panel = document.createElement('div');
    panel.className = 'loot-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.id = 'loot-panel-' + index;
    panel.append(...sectionNodes(heading));
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'loot-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.textContent = heading.textContent.replace(' loot', '');
    tabs.append(tab);
    return panel;
  });
  const select = (active) => {
    [...tabs.children].forEach((tab, index) => {
      tab.setAttribute('aria-selected', String(index === active));
      tab.tabIndex = index === active ? 0 : -1;
      panels[index].hidden = index !== active;
    });
  };
  [...tabs.children].forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const next = (index + (event.key === 'ArrowRight' ? 1 : panels.length - 1)) % panels.length;
      select(next);
      tabs.children[next].focus();
    });
  });
  headings[0].before(tabs, ...panels);
  for (const heading of headings) heading.remove();
  select(0);
}

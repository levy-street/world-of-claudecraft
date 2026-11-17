// Keep long reference material available without burying the rest of an article.
export function organizeReferenceDetails(article) {
  const maps = [...article.querySelectorAll(':scope > .woc-map')];
  if (maps.length > 2) {
    maps.forEach((map, index) => {
      const label = map.previousElementSibling;
      if (label?.tagName !== 'P' || !label.querySelector('strong')) return;
      const legend = map.nextElementSibling;
      const details = document.createElement('details');
      details.className = 'wiki-map-region';
      details.open = index === 0;
      const summary = document.createElement('summary');
      summary.textContent = label.textContent + ' map';
      label.before(details);
      details.append(summary, label, map);
      if (legend?.tagName === 'UL') details.append(legend);
    });
  }
  const sourceHeading = [...article.children].find(
    (node) => node.tagName === 'H2' && node.textContent === 'Sources',
  );
  if (!sourceHeading) return;
  const details = document.createElement('details');
  details.className = 'wiki-source-notes';
  const summary = document.createElement('summary');
  summary.textContent = 'Additional source notes';
  summary.id = 'section-sources';
  details.append(summary);
  for (let node = sourceHeading.nextElementSibling; node && !node.matches('h2,h3'); ) {
    const next = node.nextElementSibling;
    details.append(node);
    node = next;
  }
  sourceHeading.replaceWith(details);
}

// Boss fights are spoilers: how a boss works stays closed until the reader asks for it.
const ENCOUNTER_HEADINGS = [
  'Encounter',
  'Normal encounter',
  'Heroic encounter',
  'Boss encounters',
  'Pulling the final boss',
];

export function isBossPage(page) {
  return /^! Rank\n\| (?:World boss|Boss)$/m.test(page.text ?? '');
}

export function hideSpoilers(article, page) {
  const boss = isBossPage(page);
  for (const heading of [...article.children].filter((node) => node.tagName === 'H2')) {
    const title = heading.textContent;
    if (!ENCOUNTER_HEADINGS.includes(title) && !(boss && title === 'Mechanics')) continue;
    const details = document.createElement('details');
    details.className = 'wiki-spoiler';
    const summary = document.createElement('summary');
    const label = document.createElement('strong');
    label.textContent = 'Spoiler';
    summary.append(label, ' · ' + title + '. Select to show how this fight works.');
    details.append(summary);
    for (let node = heading.nextElementSibling; node && node.tagName !== 'H2'; ) {
      const next = node.nextElementSibling;
      details.append(node);
      node = next;
    }
    if (details.children.length > 1) heading.after(details);
  }
}

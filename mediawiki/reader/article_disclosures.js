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

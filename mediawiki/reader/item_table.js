// Makes an item table sortable and filterable: select a heading to sort, type to
// search by name, and pick stats to keep only the items that have all of them.
const QUALITY = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** "+3 Stamina, +2 Agility" becomes ["Stamina", "Agility"]. */
export function statNames(text) {
  return text
    .split(',')
    .map((part) => part.trim().replace(/^\+[\d.]+%?\s*/, ''))
    .filter(Boolean);
}

/** Compares two cells: quality by rank, numbers by value, everything else as text. */
export function compareCells(a, b) {
  const qa = QUALITY.indexOf(a),
    qb = QUALITY.indexOf(b);
  if (qa >= 0 && qb >= 0) return qa - qb;
  const na = Number.parseFloat(a),
    nb = Number.parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  // Empty cells sort last in ascending order.
  if (!a !== !b) return a ? -1 : 1;
  return a.localeCompare(b, 'en', { numeric: true });
}

export function enhanceItemTable(table) {
  const [head, ...rows] = table.querySelectorAll('tr');
  if (!head || !rows.length) return;
  const headings = [...head.children];
  const statColumn = headings.findIndex((th) => th.textContent === 'Stats');
  const cell = (row, i) => row.children[i]?.textContent.trim() ?? '';

  const bar = node('div', 'item-filter');
  const search = node('input', 'item-filter-search');
  search.type = 'search';
  search.placeholder = 'Filter by name';
  search.setAttribute('aria-label', 'Filter items by name');
  const count = node('span', 'item-filter-count');
  count.setAttribute('aria-live', 'polite');
  const chips = node('div', 'item-filter-stats');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Show only items with these stats');
  const wanted = new Set();
  const names =
    statColumn < 0 ? [] : [...new Set(rows.flatMap((row) => statNames(cell(row, statColumn))))];
  for (const name of names.sort((a, b) => a.localeCompare(b, 'en'))) {
    const chip = node('button', 'item-filter-chip', name);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      const on = !wanted.has(name);
      if (on) wanted.add(name);
      else wanted.delete(name);
      chip.setAttribute('aria-pressed', String(on));
      apply();
    });
    chips.append(chip);
  }
  function apply() {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const has = statColumn < 0 ? [] : statNames(cell(row, statColumn));
      row.hidden =
        !cell(row, 0).toLowerCase().includes(query) || ![...wanted].every((s) => has.includes(s));
      if (!row.hidden) shown++;
    }
    count.textContent = shown + ' of ' + rows.length + ' items';
  }
  search.addEventListener('input', apply);
  bar.append(search, count);
  if (names.length) bar.append(chips);
  (table.closest('.scroll') ?? table).before(bar);

  headings.forEach((th, index) => {
    const button = node('button', 'item-sort', th.textContent);
    button.type = 'button';
    th.replaceChildren(button);
    th.setAttribute('aria-sort', 'none');
    button.addEventListener('click', () => {
      const descending = th.getAttribute('aria-sort') === 'ascending';
      for (const other of headings) other.setAttribute('aria-sort', 'none');
      th.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
      const sorted = [...rows].sort(
        (a, b) => compareCells(cell(a, index), cell(b, index)) * (descending ? -1 : 1),
      );
      for (const row of sorted) row.parentNode.append(row);
    });
  });
  apply();
}

export function enhanceItemTables(root) {
  for (const table of root.querySelectorAll('table.item-table')) enhanceItemTable(table);
}

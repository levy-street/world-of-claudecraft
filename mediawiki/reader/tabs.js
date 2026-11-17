// Accessible tabs over a set of panels: a tablist of buttons, one panel shown at a time,
// arrow keys move between tabs. Used for loot and encounters by difficulty.

/** Builds the tabs and panels. `groups` is [{ label, nodes }]; returns { tabs, panels }. */
export function makeTabs(groups, { label, idPrefix, tabClass, panelClass, listClass }) {
  const tabs = document.createElement('div');
  tabs.className = listClass;
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', label);
  const panels = groups.map((group, index) => {
    const panel = document.createElement('div');
    panel.className = panelClass;
    panel.setAttribute('role', 'tabpanel');
    panel.id = idPrefix + index;
    panel.append(...group.nodes);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = tabClass;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.textContent = group.label;
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
  select(0);
  return { tabs, panels };
}

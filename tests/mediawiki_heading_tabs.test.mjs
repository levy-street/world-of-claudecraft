// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { layoutHeadingTabs } from '../mediawiki/reader/heading_tabs.js';

function article(html) {
  const node = document.createElement('article');
  node.innerHTML = html;
  return node;
}
const classBlock = (name, rows) =>
  '<h3><a href="#' + name + '">' + name + '</a></h3><p>' + rows + ' pieces.</p><table></table>';

describe('Encyclopedia per-class tabs', () => {
  it('turns a run of class subheadings into tabs, one panel shown at a time', () => {
    const page = article(
      '<h2>What is inside</h2><p>Pick your class below.</p>' +
        classBlock('Warrior', 24) +
        classBlock('Mage', 22) +
        classBlock('Paladin', 36) +
        '<h2>Related</h2>',
    );
    layoutHeadingTabs(page);
    const tabs = [...page.querySelectorAll('.heading-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Warrior', 'Mage', 'Paladin']);
    const panels = [...page.querySelectorAll('.heading-panel')];
    expect(panels.map((p) => p.hidden)).toEqual([false, true, true]);
    expect(panels[2].textContent).toContain('36 pieces.');
    tabs[2].click();
    expect(panels.map((p) => p.hidden)).toEqual([true, true, false]);
    expect(page.querySelectorAll('h3')).toHaveLength(0);
    // The next section stays outside the tabs.
    expect(page.querySelector('.heading-panel:last-of-type + h2, h2:last-child').textContent).toBe(
      'Related',
    );
  });

  it('leaves deed chapters and short runs as they are', () => {
    const deeds = article(
      '<h3><a href="#A">Wayfarer of the Vale</a></h3><p>One.</p>' +
        '<h3><a href="#B">Living off the Land</a></h3><p>Two.</p>' +
        '<h3><a href="#C">Something in Mirror Lake</a></h3><p>Three.</p>',
    );
    layoutHeadingTabs(deeds);
    expect(deeds.querySelector('.heading-tabs')).toBeNull();
    expect(deeds.querySelectorAll('h3')).toHaveLength(3);
    const two = article(classBlock('Warrior', 24) + classBlock('Mage', 22));
    layoutHeadingTabs(two);
    expect(two.querySelector('.heading-tabs')).toBeNull();
  });
});

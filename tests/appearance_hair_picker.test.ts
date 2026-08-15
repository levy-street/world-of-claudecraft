// @vitest-environment jsdom
//
// The hair list outgrew a chip row long ago, and the tabbed customizer made
// every style list a stepper capsule built OVER a real <select>. The select is
// the part a refactor must not lose: it is what lets a player jump straight to
// a named style instead of arrowing through nineteen of them, and it is the
// control the keyboard and assistive tech land on (the stepper arrows are
// aria-hidden pointer sugar). That difference is easy to lose in a refactor,
// so it is asserted here rather than left to review.
import { describe, expect, it } from 'vitest';
import { HAIR_STYLES, type ModularAppearance } from '../src/render/characters/modular';
import { mountAppearanceCustomizer } from '../src/ui/appearance_customizer';

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let last: ModularAppearance | null = null;
  const ui = mountAppearanceCustomizer(host, {
    onChange: (v) => {
      last = v;
    },
  });
  return { host, ui, changed: () => last };
}

/** The hair control, found by its option set rather than a label so the test
 *  neither depends on the resolved language nor on which tab holds the row.
 *  Only the hair select carries exactly HAIR_STYLES. */
function hairSelect(host: HTMLElement): HTMLSelectElement | null {
  for (const sel of host.querySelectorAll<HTMLSelectElement>('select.ac-step-value')) {
    if ([...sel.options].map((o) => o.value).join(',') === HAIR_STYLES.join(',')) return sel;
  }
  return null;
}

describe('appearance customizer: the hair picker', () => {
  it('is a select listing every style exactly once, in HAIR_STYLES order', () => {
    const { host, ui } = mount();
    const sel = hairSelect(host);
    expect(sel).not.toBeNull();
    expect([...sel!.options].map((o) => o.value)).toEqual([...HAIR_STYLES]);
    // Every option carries a resolved label rather than the bare style key,
    // which is what a missing i18n entry would leave behind.
    for (const o of sel!.options) {
      expect(o.textContent && o.textContent.length > 0).toBe(true);
      expect(o.textContent).not.toBe(o.value);
    }
    ui.destroy();
    host.remove();
  });

  it('reports the picked style, and set() pushes a style back onto the control', () => {
    const { host, ui, changed } = mount();
    const sel = hairSelect(host)!;

    sel.value = 'warriorbraid';
    sel.dispatchEvent(new Event('change'));
    expect(changed()?.hair).toBe('warriorbraid');

    // A programmatic set has to repaint the control too, otherwise Randomize
    // rolls a style the select goes on showing the old name for.
    ui.set({ hair: 'mullet' });
    expect(sel.value).toBe('mullet');

    ui.destroy();
    host.remove();
  });

  it('lands a retired style on the default rather than an empty select', () => {
    // A character created before the sculpt library replaced the parametric one
    // has a style like `spiky` stored. normalizeAppearance() maps it to the
    // default; what matters here is that the control still shows a real
    // selection, because a <select> whose value matches no option renders
    // blank.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ui = mountAppearanceCustomizer(host, {
      value: { hair: 'spiky' } as never,
      onChange: () => {},
    });
    const sel = hairSelect(host)!;
    expect(sel.selectedIndex).toBeGreaterThanOrEqual(0);
    expect(HAIR_STYLES).toContain(sel.value as (typeof HAIR_STYLES)[number]);
    ui.destroy();
    host.remove();
  });
});

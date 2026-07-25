// Real-engine guard for the micro-menu section keylines (#side-buttons).
//
// Why this exists as a BROWSER test and not another source-text pin: the first
// version of this divider used a nested :has() (":has() inside :has()"), which
// is invalid per Selectors 4 and is dropped whole by every shipping engine. It
// read perfectly in the stylesheet and satisfied every regex pin in
// tests/micromenu_groups.test.ts while painting absolutely nothing. Only a
// computed-style assertion in a real browser can tell "the selector is in the
// file" apart from "the selector matches something".
//
// The markup structure itself is pinned in tests/micromenu_groups.test.ts (in
// both entry files); this file synthesizes the same shape and asserts what the
// cascade actually does with it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from './_harness';

const KEYLINE_PX = 1;

// One column of the rail, mirroring the real markup: a .side-buttons-col with
// .micro-group sections of .micro-btn launchers.
function buildColumn(sections: Array<{ group: string; buttons: string[] }>): HTMLElement {
  const col = document.createElement('div');
  col.className = 'side-buttons-col';
  for (const section of sections) {
    const g = document.createElement('div');
    g.className = 'micro-group';
    g.dataset.group = section.group;
    for (const id of section.buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'micro-btn';
      b.id = id;
      g.appendChild(b);
    }
    col.appendChild(g);
  }
  const rail = document.createElement('div');
  rail.id = 'side-buttons';
  rail.appendChild(col);
  document.body.appendChild(rail);
  return col;
}

const sectionsOf = (col: HTMLElement): HTMLElement[] => [
  ...col.querySelectorAll<HTMLElement>('.micro-group'),
];

const borderTopPx = (el: HTMLElement): number =>
  Number.parseFloat(getComputedStyle(el).borderTopWidth);

const displayOf = (el: HTMLElement): string => getComputedStyle(el).display;

beforeEach(() => {
  document.body.className = '';
});

afterEach(() => {
  cleanup();
  document.body.className = '';
});

describe('micro-menu section keylines, as the engine actually resolves them', () => {
  it('rules every section after the first, and never the first one', () => {
    const col = buildColumn([
      { group: 'rewards', buttons: ['daily-rewards-button'] },
      { group: 'activities', buttons: ['mm-arena', 'mm-dfinder'] },
      { group: 'people', buttons: ['mm-social', 'mm-emote'] },
      { group: 'system', buttons: ['mm-music', 'mm-options'] },
    ]);
    const [rewards, activities, people, system] = sectionsOf(col);

    // The regression that a source-text pin cannot see: a dropped rule leaves
    // every one of these at 0.
    expect(borderTopPx(rewards), 'the first section must carry no keyline').toBe(0);
    expect(borderTopPx(activities)).toBe(KEYLINE_PX);
    expect(borderTopPx(people)).toBe(KEYLINE_PX);
    expect(borderTopPx(system)).toBe(KEYLINE_PX);
  });

  it('collapses a section whose every entry is hidden', () => {
    const col = buildColumn([
      { group: 'rewards', buttons: ['daily-rewards-button'] },
      { group: 'activities', buttons: ['mm-arena'] },
    ]);
    const [rewards] = sectionsOf(col);
    expect(displayOf(rewards)).not.toBe('none');

    rewards.querySelector('button')?.toggleAttribute('hidden', true);
    expect(displayOf(rewards), 'an emptied section must not reserve layout').toBe('none');
  });

  it('leaves no orphaned keyline when the first section collapses', () => {
    // The live case: the rewards section is the lone daily chest, which the
    // showDailyRewardsChest setting hides. display:none does not remove it
    // from the sibling chain, so the section below it must actively drop the
    // keyline it would otherwise inherit.
    const col = buildColumn([
      { group: 'rewards', buttons: ['daily-rewards-button'] },
      { group: 'activities', buttons: ['mm-arena', 'mm-dfinder'] },
      { group: 'people', buttons: ['mm-social'] },
    ]);
    const [rewards, activities, people] = sectionsOf(col);
    expect(borderTopPx(activities)).toBe(KEYLINE_PX);

    document.getElementById('daily-rewards-button')?.toggleAttribute('hidden', true);

    expect(displayOf(rewards)).toBe('none');
    expect(
      borderTopPx(activities),
      'the first SURVIVING section must not be ruled against nothing',
    ).toBe(0);
    // ...and the sections further down keep theirs.
    expect(borderTopPx(people)).toBe(KEYLINE_PX);
  });

  it('keeps the keyline on the section after a collapsed MIDDLE section', () => {
    // The reason the neutralizer is scoped to the one section that can empty
    // rather than written as a general "after any collapsed section" rule:
    // here the visible section above is still there, so the keyline is still
    // separating two real sections and must stay.
    const col = buildColumn([
      { group: 'you', buttons: ['mm-char', 'mm-spell'] },
      { group: 'world', buttons: ['mm-quest'] },
      { group: 'stuff', buttons: ['mm-bag', 'mm-crafting'] },
    ]);
    const [, world, stuff] = sectionsOf(col);

    document.getElementById('mm-quest')?.toggleAttribute('hidden', true);

    expect(displayOf(world)).toBe('none');
    expect(borderTopPx(stuff), 'a real section is still above it').toBe(KEYLINE_PX);
  });

  it('keeps a uniform button pitch, so two columns of different shape still line up', () => {
    // The rail is two side-by-side columns whose buttons read as aligned ROWS.
    // The sections do not divide those columns at the same offsets (col-a has
    // 3, col-b has 4), so a divider that added height would shift one column
    // relative to the other and break the rows. The keyline is drawn inside
    // the column gap with a compensating negative margin for exactly that
    // reason; this measures that it worked.
    const colA = buildColumn([
      { group: 'you', buttons: ['mm-char', 'mm-spell', 'mm-talents'] },
      { group: 'world', buttons: ['mm-quest', 'mm-map'] },
      { group: 'stuff', buttons: ['mm-bag', 'mm-crafting'] },
    ]);
    const colB = buildColumn([
      { group: 'activities', buttons: ['mm-arena', 'mm-dfinder'] },
      { group: 'people', buttons: ['mm-social', 'mm-emote'] },
      { group: 'system', buttons: ['mm-music', 'mm-options'] },
    ]);

    const pitches = (col: HTMLElement): number[] => {
      const tops = [...col.querySelectorAll<HTMLElement>('.micro-btn')].map(
        (b) => b.getBoundingClientRect().top,
      );
      return tops.slice(1).map((t, i) => Math.round(t - tops[i]));
    };

    const a = pitches(colA);
    const b = pitches(colB);
    expect(a.length).toBeGreaterThan(2);
    expect(b.length).toBeGreaterThan(2);
    // One distinct step within each column: crossing a section boundary costs
    // exactly the same as staying inside one.
    expect(new Set(a).size, `col-a pitches ${a.join(',')} are not uniform`).toBe(1);
    expect(new Set(b).size, `col-b pitches ${b.join(',')} are not uniform`).toBe(1);
    // ...and the same step in both, which is what makes the rows line up.
    expect(a[0]).toBe(b[0]);
  });

  it('renders no rail at all, and so no keylines, on mobile', () => {
    const col = buildColumn([
      { group: 'rewards', buttons: ['daily-rewards-button'] },
      { group: 'activities', buttons: ['mm-arena'] },
    ]);
    document.body.className = 'mobile-touch game-active';
    const rail = document.getElementById('side-buttons') as HTMLElement;
    expect(displayOf(rail), 'the launchers live in the More tray on mobile').toBe('none');
    expect(col.getBoundingClientRect().height).toBe(0);
  });
});

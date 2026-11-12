// The item comparison core (item_compare_view.ts): the comparison is drawn on
// the hovered card's own stat lines, so these pin which worn slots a hovered
// item compares against, that each stat's change cell is handed out exactly
// once, that per-copy stats on BOTH sides move the numbers, and that a set
// tier the swap breaks or lights is named at the foot. The worn item's card
// is never rendered.
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { itemCombatTooltipLines } from '../src/ui/item_combat_tooltip_view';
import { compareStatLineHtml, itemCompareMarks } from '../src/ui/item_compare_view';

const HOVERED_HELM = {
  id: 'cmp_test_helm',
  name: 'Test Helm',
  kind: 'armor',
  slot: 'helmet',
  quality: 'epic',
  stats: { armor: 40, sta: 10 },
  critRating: 12,
  sellValue: 1,
} as ItemDef;
const WORN_HELM = {
  id: 'cmp_test_worn_helm',
  name: 'Worn Helm',
  kind: 'armor',
  slot: 'helmet',
  quality: 'epic',
  stats: { armor: 40, sta: 6 },
  hitRating: 10,
  sellValue: 1,
} as ItemDef;
const HOVERED_RING = {
  id: 'cmp_test_ring',
  name: 'Test Ring',
  kind: 'armor',
  slot: 'ring',
  quality: 'epic',
  stats: { sta: 5 },
  sellValue: 1,
} as ItemDef;
const WORN_RING_A = { ...HOVERED_RING, id: 'cmp_test_ring_a', stats: { sta: 2 } } as ItemDef;
const WORN_RING_B = { ...HOVERED_RING, id: 'cmp_test_ring_b', stats: { sta: 9 } } as ItemDef;

const TABLE: Record<string, ItemDef> = Object.fromEntries(
  [HOVERED_HELM, WORN_HELM, HOVERED_RING, WORN_RING_A, WORN_RING_B].map((d) => [d.id, d]),
);
const lookup = (id: string): ItemDef | undefined => TABLE[id] ?? ITEMS[id];

const UP = (n: string) => `<span class="tt-delta tt-green">+${n}</span>`;
const DOWN = (n: string) => `<span class="tt-delta tt-red">−${n}</span>`;

describe('itemCompareMarks', () => {
  it('has nothing to say about an item with no slot', () => {
    const slotless = { ...HOVERED_HELM, slot: undefined } as ItemDef;
    expect(itemCompareMarks(slotless, { equipment: {} }, lookup)).toBe(undefined);
  });

  it('hands each changed stat its cell once, and the unclaimed ones to the rest rows', () => {
    const marks = itemCompareMarks(HOVERED_HELM, { equipment: { helmet: WORN_HELM.id } }, lookup);
    expect(marks?.headHtml()).toBe('');
    // sta 10 versus worn 6: a green +4, handed out exactly once.
    expect(marks?.take('sta')).toBe(` <span class="tt-deltas">${UP('4')}</span>`);
    expect(marks?.take('sta')).toBe('');
    // Equal armor on both sides: no cell.
    expect(marks?.take('armor')).toBe('');
    // Crit (gained) and hit (lost) were never claimed by a line: both land in
    // the rest rows, the lost stat as a red down cell, and only once.
    const rest = marks?.restHtml() ?? '';
    expect(rest).toContain(UP('12'));
    expect(rest).toContain(DOWN('10'));
    expect(rest.match(/class="tt-sub tt-row"/g)).toHaveLength(2);
    expect(marks?.restHtml()).toBe('');
    expect(marks?.footerHtml()).toBe('');
  });

  it('the stat lines carry the cells and the hovered card never embeds the worn card', () => {
    const marks = itemCompareMarks(HOVERED_HELM, { equipment: { helmet: WORN_HELM.id } }, lookup);
    const html = itemCombatTooltipLines(HOVERED_HELM, undefined, marks);
    // The stamina line is a row holding its own text plus the +4 cell.
    expect(html).toMatch(
      /<div class="tt-green tt-row"><span>[^<]*10[^<]*<\/span> <span class="tt-deltas">/,
    );
    // Crit has a line on the hovered card, so it is claimed there; only the
    // lost hit rating needs a rest row.
    expect(html.match(/class="tt-sub tt-row"/g)).toHaveLength(1);
    expect(html).toContain(DOWN('10'));
    expect(html).not.toContain(WORN_HELM.name);
    // Without a comparison the same lines keep their plain markup.
    expect(itemCombatTooltipLines(HOVERED_HELM)).not.toContain('tt-row');
  });

  it('per-copy stats on BOTH sides move the change (the net-loss case)', () => {
    // The worn copy's bake (rolled sta 8 atop def sta 6 = 14) beats the
    // hovered def's flat 10: the swap is a NET LOSS and must read a red 4.
    const wornSource = {
      equipment: { helmet: WORN_HELM.id },
      instances: { helmet: { rolled: { quality: 'legendary' as const, stats: { sta: 8 } } } },
    };
    expect(itemCompareMarks(HOVERED_HELM, wornSource, lookup)?.take('sta')).toContain(DOWN('4'));
    // The hovered COPY's own bake rides the candidate argument: 10 + 5 = 15
    // against the worn 14 flips it back to a +1 gain.
    const withCandidate = itemCompareMarks(HOVERED_HELM, wornSource, lookup, {
      rolled: { stats: { sta: 5 } },
    });
    expect(withCandidate?.take('sta')).toContain(UP('1'));
  });

  it('a hovered ring gets one column per worn ring, in slot order, under a header', () => {
    const marks = itemCompareMarks(
      HOVERED_RING,
      { equipment: { ring1: WORN_RING_A.id, ring2: WORN_RING_B.id } },
      lookup,
    );
    expect(marks?.headHtml()).toContain('tt-delta-head');
    expect(marks?.headHtml().match(/class="tt-delta"/g)).toHaveLength(2);
    // sta 5 against ring1's 2 and ring2's 9.
    expect(marks?.take('sta')).toBe(
      ` <span class="tt-deltas tt-deltas-2">${UP('3')}${DOWN('4')}</span>`,
    );
  });

  it('a ring column with no change keeps an empty cell so the columns stay aligned', () => {
    const marks = itemCompareMarks(
      HOVERED_RING,
      { equipment: { ring1: WORN_RING_A.id, ring2: HOVERED_RING.id } },
      lookup,
      // A per-copy bake makes the same-id ring2 a genuine, equal-stat compare.
    );
    // ring2 holds the hovered item itself: only ring1 compares, one column.
    expect(marks?.headHtml()).toBe('');
    expect(marks?.take('sta')).toBe(` <span class="tt-deltas">${UP('3')}</span>`);
    const two = itemCompareMarks(
      { ...HOVERED_RING, stats: { sta: 2, str: 1 } } as ItemDef,
      { equipment: { ring1: WORN_RING_A.id, ring2: WORN_RING_B.id } },
      lookup,
    );
    // str is new against both; sta is unchanged against ring1 only.
    expect(two?.take('sta')).toBe(
      ` <span class="tt-deltas tt-deltas-2"><span class="tt-delta"></span>${DOWN('7')}</span>`,
    );
  });

  it('never compares the worn copy against itself, and says so when nothing changes', () => {
    const self = itemCompareMarks(HOVERED_HELM, { equipment: { helmet: HOVERED_HELM.id } }, lookup);
    expect(self?.take('sta')).toBe('');
    expect(self?.footerHtml()).toBe('');
    // A different item with identical stats: a real comparison with no change.
    const twin = { ...WORN_HELM, id: 'cmp_test_twin' } as ItemDef;
    const same = itemCompareMarks(twin, { equipment: { helmet: WORN_HELM.id } }, lookup);
    expect(same?.restHtml()).toBe('');
    expect(same?.footerHtml()).toContain('No stat changes');
  });

  it('a weapon carries its change on the DPS line, and an empty slot compares nothing', () => {
    const sword = {
      id: 'cmp_test_sword',
      name: 'Test Sword',
      kind: 'weapon',
      slot: 'mainhand',
      quality: 'rare',
      weapon: { min: 10, max: 20, speed: 2 },
      sellValue: 1,
    } as ItemDef;
    const worn = { ...sword, id: 'cmp_test_worn_sword', weapon: { min: 8, max: 12, speed: 2 } };
    const table = (id: string) => (id === worn.id ? (worn as ItemDef) : lookup(id));
    const marks = itemCompareMarks(sword, { equipment: { mainhand: worn.id } }, table);
    // 7.5 DPS against 5.0: the DPS line holds the +2.5 cell and no rest row.
    const html = itemCombatTooltipLines(sword, undefined, marks);
    expect(html).toContain(`<span class="tt-deltas">${UP('2.5')}</span>`);
    expect(html).not.toContain('tt-sub tt-row');
    // Nothing worn in the slot: no cells, and no "No stat changes" claim.
    const bare = itemCompareMarks(sword, { equipment: {} }, table);
    expect(itemCombatTooltipLines(sword, undefined, bare)).not.toContain('tt-delta');
    expect(bare?.footerHtml()).toBe('');
  });

  it('names the set tier a swap breaks, with the count the set would be left at', () => {
    // Four Strength-lineage pieces worn (the 4-piece tier lit); the hovered
    // non-set helm replaces one of them.
    const equipment = {
      helmet: 'deathlords_dread_visage',
      chest: 'deathlord_warplate',
      legs: 'deathlord_legguards',
      feet: 'deathlord_sabatons',
    };
    const footer = itemCompareMarks(HOVERED_HELM, { equipment }, lookup)?.footerHtml() ?? '';
    expect(footer).toContain('class="tt-set-change tt-red"');
    expect(footer).toContain('Breaks (4) set bonus');
    expect(footer).not.toContain('(2) set bonus');
    expect(footer).toContain('(3/');
    expect(footer).not.toContain('No stat changes');
  });

  it('names the set tier a hovered set piece would light, even into an empty slot', () => {
    const footer =
      itemCompareMarks(
        ITEMS.deathlord_warplate,
        { equipment: { legs: 'deathlord_legguards' } },
        lookup,
      )?.footerHtml() ?? '';
    expect(footer).toContain('class="tt-set-change tt-green"');
    expect(footer).toContain('Activates (2) set bonus');
  });
});

describe('compareStatLineHtml', () => {
  it('is the plain line with no comparison or no cell for the stat', () => {
    expect(compareStatLineHtml('tt-green', 'x', undefined, 'sta')).toBe(
      '<div class="tt-green">x</div>',
    );
  });
});

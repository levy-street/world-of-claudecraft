// @vitest-environment jsdom

// Town Focus spells its numbers in the active locale (issue #2530).
//
// The panel handed three raw numbers straight to the render sinks: two as t()
// interpolation values for the budget line and one spliced into the row
// template's innerHTML. t()'s interpolate() finishes with a bare String(value),
// so none of the three ever reached Intl, two lines below a tier hint that
// formats correctly. Root CLAUDE.md: "Numbers, money, dates, percents go
// through formatNumber/formatMoney/formatDateTime/Intl."
//
// WHAT THIS FILE OWNS, stated narrowly on purpose: the three numbers the
// painter takes off the TownFocusView. The panel paints a FOURTH, the tier
// hint's POINTS_PER_TIER_BONUS / MAX_FOCUS_TIER_BONUS, which was already
// formatted and is the reference this fix was written to match. It is not
// pinned here or anywhere else, and it cannot be pinned the way these three
// are: both are module constants imported from src/sim/professions/focus (5 and
// 2), so no input reaches the range where a formatted and a raw number differ
// and both arms of any assertion would coincide.
//
// WHY THIS FILE HAS TO BUILD AN OUT-OF-RANGE VIEW, stated up front because it
// is the one thing a reader will question. FOCUS_POINT_BUDGET is 10, and every
// supported locale renders 0..999 as the same ASCII digits (none uses a
// non-Latin numbering system, and no grouping separator fires below a
// thousand). So a case painted at the shipped budget cannot tell a formatted
// number from a raw one: both arms of the fix coincide and the pin is dead on
// arrival. Every view below still comes out of the REAL buildTownFocusView,
// which takes the budget as a parameter and reads points straight off the
// allocation, so what is synthetic is the INPUT, never the view shape.
//
// The third case is the same argument one level down: { maximumFractionDigits: 0 }
// is unobservable on any integer, so a fractional input is the only way to
// assert the option bag behaviorally instead of scraping the painter's source
// for the literal call (which a local helper would silently kill).
//
// The repaint gate (tests/town_focus_repaint_gate.test.ts) owns everything else
// about this painter and asserts nothing about rendered digits, deliberately:
// it queries controls by data-focus-key and by class, so formatting is free to
// change under it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_POINT_BUDGET } from '../src/sim/professions/focus';
import { ensureLocaleLoaded, setLanguage, supportedLanguages } from '../src/ui/i18n';
import { buildTownFocusView, TOWN_FOCUS_COMPONENTS } from '../src/ui/town_focus_view';
import { renderTownFocusWindow } from '../src/ui/town_focus_window';

/** Rows keep TOWN_FOCUS_COMPONENTS order, so this one owns the FIRST .tf-points. */
const COMPONENT = TOWN_FOCUS_COMPONENTS[0];

function paint(allocation: Record<string, number>, budget: number): HTMLElement {
  document.getElementById('town-focus-window')?.remove();
  const el = document.createElement('div');
  el.id = 'town-focus-window';
  document.body.appendChild(el);
  renderTownFocusWindow(el, buildTownFocusView(allocation, budget, true), {
    onStep: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
  });
  return el;
}

const budgetLine = (el: HTMLElement): string =>
  el.querySelector('.town-focus-budget')?.textContent ?? '';

/** The row count, alone in its own span: the one number in this panel that can
 *  be asserted without also asserting the catalog sentence around it. */
const rowPoints = (el: HTMLElement): string => el.querySelector('.tf-points')?.textContent ?? '';

/**
 * The numbers out of a rendered sentence, in order.
 *
 * Pulled out rather than asserting the sentence whole, so the pin survives a
 * copy reword and can compare a German render against an English one. The two
 * non-ASCII group separators the supported locales use are written as escapes
 * on purpose: typed literally they are invisible in a diff and a reviewer
 * cannot tell U+00A0 from a plain space. A plain space is deliberately NOT in
 * the class, or the run would swallow the copy between two numbers.
 *
 * Every run has to END on a digit, which is what makes the reword claim above
 * true rather than lucky: no locale spells a number with a trailing separator,
 * but plenty of copy could put a period or a comma straight after {budget}, and
 * a greedy class would absorb it and red these cases with a mismatch that has
 * nothing to do with formatting.
 */
const numbersIn = (line: string): string[] =>
  [...line.matchAll(/\d(?:[\d.,\u00A0\u202F]*\d)?/g)].map((m) => m[0]);

describe('the Town Focus panel formats the numbers it takes from the view', () => {
  // setLanguage persists to localStorage, so a non-en language left set leaks
  // into every later case in this file. Restored here rather than at the end of
  // each it(), which an assertion failure would skip.
  afterEach(() => setLanguage('en'));

  it('groups all three of them under a locale whose separator is not the English one', async () => {
    // The chunk is only needed for the SENTENCE: formatNumber goes straight to
    // Intl and never reads the catalog table, so the digits would flip either
    // way. Awaited so the line under assertion is the one a German player sees.
    await ensureLocaleLoaded('de_DE');
    setLanguage('de_DE');
    // Three DISTINCT five-digit values, one per call site, so formatting only
    // some of them still fails here: remaining = 99999 - 12345.
    const el = paint({ [COMPONENT]: 12_345 }, 99_999);

    expect(budgetLine(el)).toContain('87.654');
    expect(budgetLine(el)).toContain('99.999');
    expect(rowPoints(el)).toBe('12.345');
    // Belt, not the teeth: on the pre-fix tree the three assertions above are
    // what red, and they abort the case before these run. They are here to say
    // out loud that the grouped form must REPLACE the raw one rather than
    // appear alongside it, which the toContain pair above cannot express.
    // (There is deliberately no `rowPoints(el)).not.toBe('12345')` to match:
    // the exact-equality assertion above already implies it, so it could never
    // fail in either direction.)
    expect(budgetLine(el)).not.toContain('87654');
    expect(budgetLine(el)).not.toContain('99999');
  });

  it('groups them in English as well, where the separator is the comma', () => {
    // Not a restatement of the case above: it is what proves the values run
    // through the ACTIVE locale rather than through one hardcoded formatter.
    setLanguage('en');
    const el = paint({ [COMPONENT]: 12_345 }, 99_999);

    expect(budgetLine(el)).toContain('87,654');
    expect(budgetLine(el)).toContain('99,999');
    expect(rowPoints(el)).toBe('12,345');
    expect(budgetLine(el)).not.toContain('87654');
    expect(budgetLine(el)).not.toContain('99999');
  });

  it('rounds to whole points, the same option bag as the tier hint above it', () => {
    // formatNumber with no options keeps up to three fraction digits, so this
    // is the case that separates `formatNumber(n, { maximumFractionDigits: 0 })`
    // from a bare `formatNumber(n)`. 10.75 - 2.5 = 8.25 exactly (both dyadic),
    // so there is no float slop in the expectations.
    setLanguage('en');
    const el = paint({ [COMPONENT]: 2.5 }, 10.75);

    expect(rowPoints(el)).toBe('3');
    // Both budget-line sites at once, exactly and in order: a substring pin
    // would say nothing about the remaining value or about which number is
    // which. Every arm this case exists to separate is red here (raw and bare
    // formatNumber give ['8.25', '10.75'], a minimum-fraction bag gives
    // ['8.00', '11.00']).
    expect(numbersIn(budgetLine(el))).toEqual(['8', '11']);
  });

  it('leaves the range the shipped panel actually paints spelled exactly as before', () => {
    // The other half of the claim, and the reason this fix ships no
    // screenshots: at the real budget nothing a player sees moves, in any
    // locale. Every supported locale, not a sample, because the one realistic
    // way this change ever becomes visible is a locale whose default numbering
    // system is not Latin, and adding one is exactly the change nobody would
    // think to re-run this file for. It also catches a formatter that went
    // further than asked (compact notation, a minimum-integer-digits pad),
    // which the cases above cannot see.
    //
    // No ensureLocaleLoaded: this case asserts DIGITS only (numbersIn strips
    // the copy, rowPoints reads a bare span), and formatNumber reads the active
    // language straight off Intl rather than out of the catalog table, so an
    // unloaded locale still renders its real numbers inside an English
    // sentence. The `lang` message argument is what makes a future offender
    // name itself.
    const spent = 3;
    const expected = [String(FOCUS_POINT_BUDGET - spent), String(FOCUS_POINT_BUDGET)];
    expect(supportedLanguages.length).toBeGreaterThan(1);
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      const el = paint({ [COMPONENT]: spent }, FOCUS_POINT_BUDGET);
      expect(rowPoints(el), lang).toBe(String(spent));
      expect(numbersIn(budgetLine(el)), lang).toEqual(expected);
    }
  });
});

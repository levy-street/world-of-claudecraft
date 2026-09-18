// Regression: the Performance Overlay's gilded corner motif (perf_ornament_svg.ts)
// reaches roughly 50px in from each corner along the top/bottom edges. The base
// `.window > .panel-title` rule (layout.css) starts the title content at just
// --window-pad (12px) and pins the close button 8px from the inline end, and the
// base `.window` padding is 12px on every side -- all squarely inside the
// ornament's footprint, so the title text, the back/close buttons, and the footer
// buttons sat under the gold on every corner. #options-menu.perf-wide widens all
// three (components.css) to clear it; pin the values so a future edit cannot
// shrink them back under the ornament without this test catching it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERF_CORNER_SIZE } from '../src/ui/perf_ornament_svg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const componentsCss = readFileSync(join(root, 'src/styles/components.css'), 'utf8');
// The non-scrolling host and the one scrolling child are the shared window shell
// now (W25), so the two overflow guarantees below are declared in library.css.
const libraryCss = readFileSync(join(root, 'src/styles/library.css'), 'utf8');

// The same selector can (legitimately) appear as more than one rule block in
// this file (e.g. `#options-menu.perf-wide` sets `width` in one block and the
// ornament's own `padding-bottom` in another); every declaration across all of
// them applies cumulatively, so collect every block's body rather than just the
// first match.
function ruleBodies(css: string, selector: string): string[] {
  const bodies: string[] = [];
  const needle = `${selector} {`;
  let from = 0;
  for (;;) {
    const start = css.indexOf(needle, from);
    if (start < 0) break;
    const body = css.slice(start);
    bodies.push(body.slice(0, body.indexOf('}')));
    from = start + needle.length;
  }
  expect(bodies.length, `could not find rule "${selector}"`).toBeGreaterThan(0);
  return bodies;
}

// The px value of `prop` from whichever of the selector's rule blocks declares
// it (there must be exactly one, since a later duplicate would silently win and
// is worth flagging on its own).
function pxValue(bodies: string[], prop: string): number {
  const matches = bodies
    .map((b) => b.match(new RegExp(`\\b${prop}:\\s*(\\d+)px`)))
    .filter((m): m is RegExpMatchArray => m !== null);
  expect(matches, `no rule block declares "${prop}"`).toHaveLength(1);
  return Number(matches[0][1]);
}

// A leaf/tendril reaching a full corner-radius out from the pivot would clear at
// most PERF_CORNER_SIZE px; treat anything past half of that as "clears the
// ornament's typical ink", the same margin the hand-tuned values above target.
const MIN_CLEARANCE = PERF_CORNER_SIZE / 2;

describe('perf overlay header/footer clear the corner ornament (padding)', () => {
  it('the title text and back button start well clear of the top-left ornament', () => {
    const bodies = ruleBodies(componentsCss, '#options-menu.perf-wide .panel-title');
    expect(pxValue(bodies, 'padding-left')).toBeGreaterThanOrEqual(MIN_CLEARANCE);
  });

  it('the title reserves enough right-side room for the close button past the top-right ornament', () => {
    const bodies = ruleBodies(componentsCss, '#options-menu.perf-wide .panel-title');
    const closeBodies = ruleBodies(
      componentsCss,
      '#options-menu.perf-wide .panel-title > .x-btn:not(.back-btn)',
    );
    const closeInset = pxValue(closeBodies, 'inset-inline-end');
    expect(closeInset).toBeGreaterThanOrEqual(MIN_CLEARANCE);
    // The title's own right padding must reach at least as far as the close
    // button's inset, or the title text can still run underneath it.
    expect(pxValue(bodies, 'padding-right')).toBeGreaterThanOrEqual(closeInset);
  });

  it('the close button (never the back button) is the one pulled in from the corner', () => {
    // .back-btn stays in normal flex flow at the inline start (layout.css); only
    // the absolutely-positioned close control needs its own inset override.
    expect(componentsCss).not.toContain('#options-menu.perf-wide .panel-title > .x-btn.back-btn');
  });

  it('the scroll wrapper bottom padding clears the bottom-corner ornament for the footer buttons', () => {
    // Moved off #options-menu.perf-wide itself (issue #2569): that element hosts
    // the gilded ::before ornament and must stay non-scrolling (see the describe
    // block below), so the bottom clearance now lives on the .perf-scroll child
    // that actually scrolls (perf_overlay_settings.ts).
    const bodies = ruleBodies(componentsCss, '#options-menu.perf-wide .perf-scroll');
    expect(pxValue(bodies, 'padding-bottom')).toBeGreaterThanOrEqual(MIN_CLEARANCE);
  });
});

// Rule bodies carry explanatory prose (this file's own comments above are proof
// enough of that), and that prose is free to mention `overflow-y: auto` as the
// bug it is guarding against; strip CSS comments before pattern-matching actual
// declarations so the guard cannot trip over its own explanation.
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('perf overlay ornament host never scrolls with the panel content (issue 2569)', () => {
  it('#options-menu.perf-wide itself declares no auto/scroll overflow (the ::before ornament lives on this exact box)', () => {
    // The base `.window` rule (layout.css) sets `overflow-y: auto`; if this
    // element (the one the gilded ::before ornament is attached to) inherited
    // that unchanged, the ornament would scroll away with the panel content
    // instead of staying pinned to the window frame.
    const bodies = [
      ...ruleBodies(componentsCss, '#options-menu.perf-wide'),
      // .perf-scroll carries .ui-win-body, so this selector matches the panel.
      ...ruleBodies(libraryCss, '.ui-window:has(> .ui-win-body)'),
    ];
    const overflowDecls = bodies
      .flatMap((b) => [...stripCssComments(b).matchAll(/\boverflow(?:-y)?:\s*([a-z]+)/g)])
      .map((m) => m[1]);
    expect(overflowDecls, 'no rule block overrides overflow/overflow-y').not.toHaveLength(0);
    for (const value of overflowDecls) {
      expect(['auto', 'scroll']).not.toContain(value);
    }
  });

  it('the .perf-scroll wrapper is the one that actually scrolls', () => {
    const bodies = [
      ...ruleBodies(componentsCss, '#options-menu.perf-wide .perf-scroll'),
      ...ruleBodies(libraryCss, '.ui-win-body'),
    ];
    const hasScrollY = bodies.some((b) => /overflow-y:\s*(auto|scroll)/.test(stripCssComments(b)));
    expect(hasScrollY, '.perf-scroll must declare overflow-y: auto or scroll').toBe(true);
  });
});

// The gilded pilot frame is the Fancy Gold theme's look. When the fancyGold
// preset landed, its window frame became a theme opt-in (the .fancy-gold-ui
// root class applyTheme stamps in main.ts; every other preset keeps the classic
// flat panels, see THEME_PRESETS in src/ui/theme.ts), but the Performance
// sub-view's own pilot ornament stayed unconditional, so Classic, Midnight,
// Parchment and High Contrast all opened a gold-framed perf panel. Every rule
// that paints or makes room for that ornament must carry the theme gate; the
// panel's width/layout block stays theme-agnostic.
describe('perf overlay ornament is a Fancy Gold theme opt-in', () => {
  // Flat "selector { body }" pairs; an at-rule's own `{` simply ends the previous
  // non-brace run, so the rules nested inside it still surface as pairs.
  const pairs = [...stripCssComments(componentsCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
  const perfWide = pairs.filter((p) => p.selector.includes('#options-menu.perf-wide'));
  const ornamentMarkers = [
    /--perf-ornament-/,
    /border-radius:\s*30px/,
    /--color-gold-/,
    /padding-left:\s*64px/,
    /inset-inline-end:\s*64px/,
    /padding-bottom:\s*64px/,
    /border-color:\s*(transparent|CanvasText)/,
  ];

  it('every ornament-painting or ornament-clearing perf-wide rule is gated on .fancy-gold-ui', () => {
    const ornamentRules = perfWide.filter((p) => ornamentMarkers.some((re) => re.test(p.body)));
    expect(ornamentRules.length).toBeGreaterThanOrEqual(5);
    for (const rule of ornamentRules) {
      expect(rule.selector, rule.selector).toMatch(/^\.fancy-gold-ui\s+#options-menu\.perf-wide/);
    }
  });

  it('the ::before ornament host exists only under the theme gate', () => {
    const befores = perfWide.filter((p) => p.selector.includes('::before'));
    expect(befores.length).toBeGreaterThan(0);
    for (const rule of befores) expect(rule.selector).toMatch(/^\.fancy-gold-ui\s/);
  });

  it('the wide two-column layout itself stays theme-agnostic', () => {
    const layout = perfWide.find(
      (p) => p.selector === '#options-menu.perf-wide' && /\bwidth:/.test(p.body),
    );
    expect(layout, 'ungated #options-menu.perf-wide width rule').toBeTruthy();
    expect(ornamentMarkers.some((re) => re.test(layout?.body ?? ''))).toBe(false);
  });
});

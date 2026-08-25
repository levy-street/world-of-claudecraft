// Regression guard for the minimap rim satellites: the absolutely positioned
// children of #minimap-disc, which have now collided twice.
//
// FIRST: the raid-lockout badge and the Ravenpost envelope both anchored to
// left + bottom, so whenever unread mail and a lockout were live together they
// stacked. That is what this file was written for.
//
// SECOND: the World Market coin shipped into top-right, the corner the
// day/night dial already held, and the dial (later in the DOM, same z-index)
// painted over it completely. This guard did not see it because its list was
// three BADGES and the dial is a canvas. The list is now every rim widget, and
// membership is derived from the markup rather than trusted, since the failure
// mode both times was a widget added to a rim that looked like it had room.
//
// THIRD, and why the mobile half exists: fixing the second collision moved the
// coin's desktop anchor from `right` to `left`, which silently broke its mobile
// placement. The touch sheet then re-anchored these onto `right` to line them up
// beside the disc, and with left + width + right all non-auto the absolute
// over-constraint rule drops `right` in LTR, pinning the coin back on the disc.
// The other two mobile blocks already cleared the desktop side (`left: auto`,
// `bottom: auto`); the coin did not, so a desktop-only fix regressed touch.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const css = read('src/styles/hud.css');
const mobileCss = read('src/styles/hud.mobile.css');
// Selector matching runs over a comment-free copy: a rule's leading comment lands
// inside the selector capture below, and every rule here carries one.
const uncommentedMobileCss = mobileCss.replace(/\/\*[\s\S]*?\*\//g, ' ');
const ENTRIES = ['index.html', 'play.html'] as const;

/** Every rim widget, badge or canvas. The dial's absence is what let the coin
 *  land on top of it. */
const RIM_WIDGETS = [
  '#raid-lockout',
  '#mail-indicator',
  '#market-indicator',
  '#minimap-daynight',
] as const;

/** The disc's own canvas fills it and claims no corner. */
const NOT_A_RIM_WIDGET = new Set(['minimap']);

// The base rule for each widget is the bare selector followed by "{" (the
// pseudo-class, descendant, and [hidden] rules never match that shape), and
// none of these blocks nest braces.
function declarationBlock(selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing ${selector} rule in src/styles/hud.css`);
  return match[1];
}

/** Every touch-sheet declaration for the widget ITSELF, merged: the sheet styles
 *  these across more than one block (a base rule plus per-tier nudges), and
 *  grouped selectors mean a block can carry several widgets at once. A DESCENDANT
 *  rule is not the widget (the envelope's unread-count pip carries its own
 *  absolute inset), so the id has to end the selector for the block to count. */
function mobileDeclarations(selector: string): string {
  const id = selector.slice(1);
  const own = new RegExp(`^body\\.mobile-touch[\\w.-]*\\s+#${id}(:[\\w-]+)?$`);
  const blocks = [...uncommentedMobileCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(
    ([, selectors]) => selectors.split(',').some((part) => own.test(part.trim())),
  );
  return blocks.map(([, , decls]) => decls).join('\n');
}

const anchoredSides = (block: string, sides: readonly string[]): string[] =>
  sides.filter((side) => new RegExp(`(?:^|[\\s;])${side}\\s*:\\s*(?!auto)`).test(block));

function anchoredCorner(selector: string): string {
  const block = declarationBlock(selector);
  const horizontal = anchoredSides(block, ['left', 'right']);
  const vertical = anchoredSides(block, ['top', 'bottom']);
  expect(horizontal, `${selector} must anchor exactly one of left/right`).toHaveLength(1);
  expect(vertical, `${selector} must anchor exactly one of top/bottom`).toHaveLength(1);
  return `${horizontal[0]}+${vertical[0]}`;
}

/** Ids of the absolutely positioned children of #minimap-disc in an entry. */
function discChildren(entry: string): string[] {
  const html = read(entry);
  const start = html.indexOf('<div id="minimap-disc">');
  expect(start, `${entry} has no #minimap-disc`).toBeGreaterThan(-1);
  const open = html.indexOf('>', start) + 1;
  const end = html.indexOf('</div>', html.indexOf('minimap-daynight', start));
  return [...html.slice(open, end).matchAll(/<(?:button|canvas|div)\s+id="([\w-]+)"/g)].map(
    (m) => m[1],
  );
}

describe('minimap rim badges', () => {
  it('anchors each rim widget to a distinct corner of the minimap disc', () => {
    const corners = RIM_WIDGETS.map(anchoredCorner);
    expect(
      new Set(corners).size,
      `rim widgets share a corner: ${RIM_WIDGETS.map((s, i) => `${s} at ${corners[i]}`).join(', ')}`,
    ).toBe(corners.length);
  });

  it('knows about every widget on the disc, in both entries', () => {
    // The half that actually closes the hole: a fifth widget cannot land in a
    // corner someone else holds without this failing first.
    for (const entry of ENTRIES) {
      const unregistered = discChildren(entry).filter(
        (id) => !NOT_A_RIM_WIDGET.has(id) && !RIM_WIDGETS.includes(`#${id}` as never),
      );
      expect(
        unregistered,
        `${entry}: rim widget(s) with no corner claim: ${unregistered.join(', ')}`,
      ).toEqual([]);
    }
  });

  // Both game entries carry their own copy of the minimap cluster markup, and
  // tests/entry_window_parity.test.ts scans only `.window panel` divs, so a rim
  // badge shipped to one entry passes every other gate while the other entry
  // silently loses it (or worse, its HUD init throws on the missing element).
  it('ships every rim widget in both game entries', () => {
    for (const entry of ENTRIES) {
      const present = new Set(discChildren(entry));
      for (const selector of RIM_WIDGETS) {
        expect(present.has(selector.slice(1)), `${entry} is missing ${selector}`).toBe(true);
      }
    }
  });

  // FOURTH: the touch sheet did not just resize these, it lifted all three badges
  // OFF the disc into a free-floating row beside it (`right: calc(100% + 138px)`
  // puts the coin's right edge 138px past the disc's LEFT edge), so on a phone they
  // read as detached chrome hanging in the world. A rim satellite belongs on the
  // rim on every host: an inset may nudge it around the disc box, never past it.
  it('keeps every rim widget inside the disc box on touch', () => {
    // A `100%` term in an inset is the whole disc box, so anything built on one
    // lands the widget beyond the opposite edge; a raw px inset at or past the
    // canvas box is the same escape spelled without the percentage.
    const canvasBoxPx = Number(
      /<canvas id="minimap" width="(\d+)"/.exec(read('index.html'))?.[1] ?? '0',
    );
    expect(canvasBoxPx, 'index.html has no sized #minimap canvas').toBeGreaterThan(0);
    for (const selector of RIM_WIDGETS) {
      const mobile = mobileDeclarations(selector);
      for (const [, side, rawValue] of mobile.matchAll(
        /(?:^|[\s;])(left|right|top|bottom)\s*:\s*([^;]+)/g,
      )) {
        const value = rawValue.trim();
        const offDisc =
          value.includes('100%') ||
          [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].some((m) => Number(m[1]) >= canvasBoxPx);
        expect(
          offDisc,
          `${selector}: touch \`${side}: ${value}\` puts the satellite off the minimap disc`,
        ).toBe(false);
      }
    }
  });

  it('clears the desktop anchor wherever the touch sheet re-anchors the other side', () => {
    // left + width + right all non-auto is over-constrained, and LTR resolves it
    // by dropping `right`: the widget stays where the desktop rule put it and
    // never joins the touch row. Changing a desktop anchor is exactly when this
    // bites, which is when nobody is looking at the mobile sheet.
    for (const selector of RIM_WIDGETS) {
      const mobile = mobileDeclarations(selector);
      if (!mobile.trim()) continue; // no touch override (the dial keeps its corner)
      for (const [a, b] of [
        ['left', 'right'],
        ['top', 'bottom'],
      ]) {
        const desktop = anchoredSides(declarationBlock(selector), [a, b]);
        const opposite = desktop[0] === a ? b : a;
        if (!anchoredSides(mobile, [opposite]).length) continue; // not re-anchored
        expect(
          new RegExp(`(?:^|[\\s;])${desktop[0]}\\s*:\\s*auto`).test(mobile),
          `${selector}: the touch sheet re-anchors on ${opposite} but never clears ${desktop[0]}, so the desktop inset wins and it stays on the disc`,
        ).toBe(true);
      }
    }
  });
});

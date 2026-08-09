// The player card's Book of Deeds title line. The canvas compositor is
// browser-only (renderPlayerCardCanvas needs document/fonts/Image), so the
// pin altitude is the pure layout gate (cardTitleLayout, which the ONE guarded
// draw call consumes) plus source pins on the guarded draw site and the data
// build-site fill; the untitled byte-identical guarantee IS the null return
// (nothing extra ever draws when it is null).
//
// #3125: the title used to share the y=158 realm baseline (starting past the
// measured realm-line width), which heavily ellipsized or dropped a long
// title. It now gets its OWN row (TITLE_BASELINE in card_layout.ts) so it
// can never collide with the realm line regardless of either string's
// length; cardTitleLayout no longer takes a realm-width argument.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cardTitleLayout,
  HEADER_RIGHT_EDGE,
  HEADER_X,
  TITLE_BASELINE,
} from '../src/ui/hud/player_card/card_layout';

describe('cardTitleLayout (the pure title-line gate)', () => {
  it('returns null for absent, empty, and whitespace titles (untitled cards draw nothing)', () => {
    expect(cardTitleLayout(undefined)).toBeNull();
    expect(cardTitleLayout('')).toBeNull();
    expect(cardTitleLayout('   ')).toBeNull();
  });

  it('places the title on its own row, at the header column, full header width', () => {
    const line = cardTitleLayout('the Resplendent')!;
    expect(line).toEqual({
      text: 'the Resplendent',
      x: HEADER_X,
      y: TITLE_BASELINE,
      maxW: HEADER_RIGHT_EDGE - HEADER_X,
    });
  });

  it('a long title still gets the full header width regardless of the realm line length', () => {
    // The whole point of #3125: an extreme realm string can no longer starve
    // the title of room, since the two no longer share a baseline.
    const short = cardTitleLayout('the Resplendent')!;
    const long = cardTitleLayout('the Truly Exceptionally Resplendent and Undying')!;
    expect(short.maxW).toBe(long.maxW);
    expect(short.y).toBe(long.y);
  });

  it('the compositor guards its ONE title draw call on this gate (source pin)', () => {
    const src = readFileSync(
      new URL('../src/ui/hud/player_card/player_card.ts', import.meta.url),
      'utf8',
    );
    const drawSite = src.slice(src.indexOf('const titleLine = cardTitleLayout('));
    expect(drawSite.length).toBeGreaterThan(0);
    expect(drawSite.slice(0, 300)).toContain('if (titleLine) {');
    expect(drawSite.slice(0, 300)).toContain(
      'fillTextClamped(ctx, titleLine.text, titleLine.x, titleLine.y, titleLine.maxW);',
    );
    // Exactly one consumer: no second, unguarded title draw can appear.
    expect(src.split('cardTitleLayout(').length - 1).toBe(1);
  });

  it('the data builder resolves the deed id to display text and omits it when empty', () => {
    const dataSrc = readFileSync(
      new URL('../src/ui/hud/player_card/player_card_data.ts', import.meta.url),
      'utf8',
    );
    const site = dataSrc.slice(dataSrc.indexOf('const titleText ='));
    expect(site.slice(0, 200)).toContain(
      "world.activeTitle ? deedTitleText(world.activeTitle) : ''",
    );
    expect(site.slice(0, 600)).toContain('...(titleText ? { titleText } : {})');
  });
});

// The player card's Book of Deeds title line. The canvas compositor is
// browser-only (renderPlayerCardCanvas needs document/fonts/Image), so the
// pin altitude is the pure layout gate (cardTitleLayout, which the ONE guarded
// draw call consumes) plus source pins on the guarded draw site and the hud
// build-site fill; the untitled byte-identical guarantee IS the null return
// (nothing extra ever draws when it is null).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardTitleLayout } from '../src/ui/player_card';

describe('cardTitleLayout (the pure title-line gate)', () => {
  it('returns null for absent, empty, and whitespace titles (untitled cards draw nothing)', () => {
    expect(cardTitleLayout(undefined, 200)).toBeNull();
    expect(cardTitleLayout('', 200)).toBeNull();
    expect(cardTitleLayout('   ', 200)).toBeNull();
  });

  it('places the title on the realm baseline, past the measured realm line', () => {
    const line = cardTitleLayout('the Resplendent', 200.4)!;
    // x = header column (478) + ceil(realm width) + 16; clamped left of 1018.
    expect(line).toEqual({ text: 'the Resplendent', x: 478 + 201 + 16, y: 158, maxW: 1018 - 695 });
  });

  it('skips the line entirely when the realm text leaves too little room to read', () => {
    // maxW = 1018 - (478 + ceil(w) + 16) < 40 => null, never a clipped smear.
    expect(cardTitleLayout('the Resplendent', 485)).toBeNull();
    expect(cardTitleLayout('the Resplendent', 484)).not.toBeNull();
  });

  it('the compositor guards its ONE title draw call on this gate (source pin)', () => {
    const src = readFileSync(new URL('../src/ui/player_card.ts', import.meta.url), 'utf8');
    const drawSite = src.slice(src.indexOf('const titleLine = cardTitleLayout('));
    expect(drawSite.length).toBeGreaterThan(0);
    expect(drawSite.slice(0, 300)).toContain('if (titleLine) {');
    expect(drawSite.slice(0, 300)).toContain(
      'fillTextClamped(ctx, titleLine.text, titleLine.x, titleLine.y, titleLine.maxW);',
    );
    // Exactly one consumer: no second, unguarded title draw can appear.
    expect(src.split('cardTitleLayout(').length - 1).toBe(2); // the export + the one call
  });

  it('the hud build site resolves the deed id to display text and omits it when empty', () => {
    const hudSrc = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const site = hudSrc.slice(hudSrc.indexOf('const cardTitleText ='));
    expect(site.slice(0, 200)).toContain("sim.activeTitle ? deedTitleText(sim.activeTitle) : ''");
    expect(site.slice(0, 600)).toContain('...(cardTitleText ? { titleText: cardTitleText } : {})');
  });
});

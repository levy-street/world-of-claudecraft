import { describe, expect, it, vi } from 'vitest';

const portraitUrl = `data:image/png;base64,${'A'.repeat(20_000)}`;
const mechUrl = `data:image/png;base64,MECH${'B'.repeat(20_000)}`;

vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: () => undefined,
  onPortraitUpdate: () => undefined,
  // 'priest' stands for a class whose headshot is not cached yet: that chip
  // falls back to the crest, which is the other arm of the fallback line.
  playerPortraitDataUrl: (cls: string) => (cls === 'priest' ? null : portraitUrl),
  visualPortraitDataUrl: (key: string) => (key === 'player_mech' ? mechUrl : portraitUrl),
  modularPortraitDataUrl: () => portraitUrl,
  portraitsReady: () => true,
}));
vi.mock('../src/ui/i18n', () => ({ t: () => 'Mage portrait' }));
vi.mock('../src/ui/icons', () => ({ iconDataUrl: () => 'data:image/png;base64,crest' }));

import { portraitChipHtml } from '../src/ui/portrait_chip';

describe('portrait chip deferred source', () => {
  it('keeps the normal one-off chip behavior', () => {
    const html = portraitChipHtml({ cls: 'mage', name: 'Mage' });
    expect(html).toContain(portraitUrl);
    expect(html).not.toContain('data-portrait-pending');
    const portraitTag = html.match(/<img class="portrait-img"[^>]+>/)?.[0] ?? '';
    expect(portraitTag).not.toContain('data-crest-fallback');
  });

  it('omits a large cached data URL from dense repeated markup', () => {
    const html = portraitChipHtml({
      cls: 'mage',
      name: 'Mage',
      badge: false,
      deferSource: true,
    });
    expect(html).not.toContain(portraitUrl);
    expect(html).not.toContain('base64');
    expect(html).toContain('data-portrait-pending="1"');
    expect(html).toContain('decoding="async"');
  });

  it('leaves the deferred chip OFF the crest fallback, which would paint per chip', () => {
    // deferSource ships no src at all, and hydrateCrestImageFallbacks fires
    // its error path immediately for a src-less image (complete, naturalWidth
    // 0): marking these would paint a procedural crest data URL into every
    // chip of a dense grid, which is the exact per-chip cost deferSource
    // exists to avoid. They upgrade through hydratePortraits instead.
    const html = portraitChipHtml({
      cls: 'mage',
      name: 'Mage',
      badge: false,
      deferSource: true,
    });
    const portraitTag = html.match(/<img class="portrait-img"[^>]+>/)?.[0] ?? '';
    expect(portraitTag).not.toContain('data-crest-fallback-id');
    expect(portraitTag).not.toContain('data-crest-fallback-size');
    expect(portraitTag).not.toContain('src=');
    expect(html).toContain('data-portrait-pending="1"');
    expect(html).not.toContain('base64');
  });

  it('still marks a NON-deferred chip with no portrait for the crest fallback', () => {
    // The other arm of the same line: that chip already ships a real src (the
    // crest data URL), so arming its fallback adds no data URL the markup does
    // not already carry, and a crest that fails to load still resolves.
    const html = portraitChipHtml({ cls: 'priest', name: 'Priest', badge: false });
    const portraitTag = html.match(/<img class="portrait-img"[^>]+>/)?.[0] ?? '';
    expect(portraitTag).toContain('src="data:image/png;base64,crest"');
    expect(portraitTag).toContain('data-crest-fallback-id="class_priest"');
    expect(portraitTag).toContain('data-crest-fallback-size="96"');
    expect(html).toContain('data-portrait-pending="1"');
  });

  it('draws the mech body for a mech-catalog chip, ignoring any look', () => {
    const html = portraitChipHtml({
      cls: 'mage',
      name: 'Mage',
      skin: 3,
      catalog: 'mech',
      // a composed look must not win over the worn mech
      look: {} as never,
    });
    expect(html).toContain(mechUrl);
    expect(html).toContain('data-catalog="mech"');
  });
});

import { describe, expect, it, vi } from 'vitest';

const portraitUrl = `data:image/png;base64,${'A'.repeat(20_000)}`;

vi.mock('../src/render/characters/portrait', () => ({
  onPortraitsReady: () => undefined,
  playerPortraitDataUrl: () => portraitUrl,
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
});

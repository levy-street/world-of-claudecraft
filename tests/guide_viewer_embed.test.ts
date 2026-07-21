// Unit test for modelViewerEmbed (src/guide/viewer/embed.ts), the pure-markup home of the
// branch's a11y-relevant viewer logic: prefer the baked `still` over the 2D crest as the default
// poster, give the still a descriptive alt while the decorative crest stays alt="", and emit the
// data-autoplay/data-tint/data-model attributes the wirer reads. It is pure (no DOM, no three), so
// a regression that mislabels a decorative image or drops autoplay would otherwise ship silently.
import { describe, expect, it } from 'vitest';
import { modelViewerEmbed } from '../src/guide/viewer/embed';
import { setLanguage } from '../src/ui/i18n';

setLanguage('en');

describe('modelViewerEmbed', () => {
  it('prefers the baked still as the default poster and gives it a descriptive alt', () => {
    const html = modelViewerEmbed({
      modelKey: 'wolf',
      name: 'Forest Wolf',
      poster: 'data:crest',
      still: '/guide-stills/mob_wolf__abc.webp',
    });
    expect(html).toContain('src="/guide-stills/mob_wolf__abc.webp"');
    expect(html).not.toContain('src="data:crest"'); // still wins over the crest
    expect(html).toContain('guide-viewer-poster-still');
    // the still IS the content now, so its alt names the subject (non-empty)
    const alt = html.match(/class="guide-viewer-poster[^"]*"[^>]*\salt="([^"]*)"/)?.[1] ?? '';
    expect(alt.length).toBeGreaterThan(0);
    expect(alt).toContain('Forest Wolf');
  });

  it('falls back to the 2D crest as a DECORATIVE image (alt="") when there is no still', () => {
    const html = modelViewerEmbed({ modelKey: 'mage', name: 'Mage', poster: 'data:crest' });
    expect(html).toContain('src="data:crest"');
    expect(html).not.toContain('guide-viewer-poster-still');
    const alt = html.match(/class="guide-viewer-poster[^"]*"[^>]*\salt="([^"]*)"/)?.[1] ?? null;
    expect(alt).toBe(''); // decorative crest, not announced
  });

  it('emits no poster image when neither a still nor a crest is provided', () => {
    const html = modelViewerEmbed({ modelKey: 'spellhound', name: 'Spellhound' });
    expect(html).not.toContain('class="guide-viewer-poster');
  });

  it('marks an autoplay hero and leaves other embeds without the flag', () => {
    const hero = modelViewerEmbed({ modelKey: 'warrior', name: 'Warrior', autoplay: true });
    expect(hero).toContain('data-autoplay="true"');
    const plain = modelViewerEmbed({ modelKey: 'warrior', name: 'Warrior' });
    expect(plain).not.toContain('data-autoplay');
    const off = modelViewerEmbed({ modelKey: 'warrior', name: 'Warrior', autoplay: false });
    expect(off).not.toContain('data-autoplay');
  });

  it('emits the status line as an empty ARIA live region for mount.ts to drive', () => {
    // VIEW-4: the load/error copy is written imperatively on each state transition (mount.ts),
    // because aria-live announces a text mutation, not the CSS show/hide keyed off data-state.
    // The static markup must therefore ship an EMPTY live region, not two CSS-toggled spans.
    const html = modelViewerEmbed({ modelKey: 'wolf', name: 'Forest Wolf' });
    expect(html).toContain('<p class="guide-viewer-status" role="status" aria-live="polite"></p>');
    expect(html).not.toContain('guide-viewer-status-loading');
    expect(html).not.toContain('guide-viewer-status-error');
  });

  it('carries the wirer data-attributes (model, tint, idle state) and the feature variant', () => {
    const html = modelViewerEmbed({
      modelKey: 'demon',
      name: 'Demon',
      tint: '#c8a972',
      variant: 'feature',
    });
    expect(html).toContain('data-model="demon"');
    expect(html).toContain('data-tint="#c8a972"');
    expect(html).toContain('data-name="Demon"');
    expect(html).toContain('data-state="idle"');
    expect(html).toContain('guide-viewer-feature');
    // untinted figures omit the attribute entirely
    expect(modelViewerEmbed({ modelKey: 'demon', name: 'Demon' })).not.toContain('data-tint');
  });
});

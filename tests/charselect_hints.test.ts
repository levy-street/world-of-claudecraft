// src/ui/charselect_hints.ts: the hint lines under a character-select roster
// row. The zone line is what lets an account owner see where every character
// is without logging each one in; it renders through tEntity so it follows the
// active language like every other zone name in the client.
import { describe, expect, it } from 'vitest';
import { charselectHintsHtml, charselectZoneLabel } from '../src/ui/charselect_hints';
import { zoneDisplayName } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';

describe('charselectZoneLabel', () => {
  it('names the zone in English', () => {
    setLanguage('en');
    expect(charselectZoneLabel({ online: false, zoneId: 'eastbrook_vale' })).toBe('Eastbrook Vale');
  });

  it('is null when the server sent no zone (older server, or a world-start save)', () => {
    setLanguage('en');
    expect(charselectZoneLabel({ online: false })).toBeNull();
    expect(charselectZoneLabel({ online: false, zoneId: null })).toBeNull();
  });

  it('follows the active language', async () => {
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    try {
      const label = charselectZoneLabel({ online: false, zoneId: 'eastbrook_vale' });
      expect(label).toBe(zoneDisplayName('eastbrook_vale'));
      expect(label).not.toBe('Eastbrook Vale');
    } finally {
      setLanguage('en');
    }
  });
});

describe('charselectHintsHtml', () => {
  it('renders the zone line for an offline character and nothing else', () => {
    setLanguage('en');
    expect(charselectHintsHtml({ online: false, zoneId: 'mirefen_marsh' })).toBe(
      '<span class="char-zone-hint">Mirefen Marsh</span>',
    );
  });

  it('renders the zone line above the in-world notice for an online character', () => {
    setLanguage('en');
    expect(charselectHintsHtml({ online: true, zoneId: 'mirefen_marsh' })).toBe(
      `<span class="char-zone-hint">Mirefen Marsh</span><span class="char-inworld-hint">${t('character.inWorldHint')}</span>`,
    );
  });

  it('renders only the in-world notice when there is no zone', () => {
    setLanguage('en');
    expect(charselectHintsHtml({ online: true })).toBe(
      `<span class="char-inworld-hint">${t('character.inWorldHint')}</span>`,
    );
    expect(charselectHintsHtml({ online: false })).toBe('');
  });

  it('escapes the zone name', () => {
    setLanguage('en');
    // An unknown id falls back to the id text itself; markup in it must not render.
    const html = charselectHintsHtml({ online: false, zoneId: '<b>x</b>' });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});

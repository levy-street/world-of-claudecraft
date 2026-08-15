import { describe, expect, it } from 'vitest';
import { stillKey, stillUrl } from '../scripts/wiki/still_key.mjs';

// stillKey/stillUrl are the single source of truth for a Guide model still's identity
// (scripts/wiki/still_key.mjs), shared by the content generator (build_content.mjs) and the
// still renderer (render_model_stills.mjs). Issue #2764: a tintStrength-only VisualDef edit
// (tint color unchanged) must mint a new key, or the committed still keeps its stale baked
// strength indefinitely with nothing failing tests/guide.test.ts to catch it.
describe('stillKey / stillUrl (issue #2764)', () => {
  it('keys purely off model when there is no tint', () => {
    expect(stillKey('player_mage', null)).toBe('player_mage');
    expect(stillKey('player_mage', undefined)).toBe('player_mage');
  });

  it('appends the tint hex, lowercased and without a leading #', () => {
    expect(stillKey('mob_wolf', '#7F8C8D')).toBe('mob_wolf__7f8c8d');
    expect(stillKey('mob_wolf', '7f8c8d')).toBe('mob_wolf__7f8c8d');
  });

  it('omits the strength suffix when tintStrength is undefined', () => {
    expect(stillKey('player_priest', '#f0e9d6')).toBe('player_priest__f0e9d6');
  });

  it('omits the strength suffix when tintStrength equals the manifest default (0.4)', () => {
    expect(stillKey('player_shaman', '#6f8fc9', 0.4)).toBe('player_shaman__6f8fc9');
  });

  it('appends a rounded strength suffix when tintStrength differs from the default', () => {
    expect(stillKey('player_priest', '#f0e9d6', 0.5)).toBe('player_priest__f0e9d6__s50');
    expect(stillKey('player_warlock', '#8d5fd3', 0.45)).toBe('player_warlock__8d5fd3__s45');
  });

  it('two figures sharing (model, tint) but differing in tintStrength get distinct keys', () => {
    const strong = stillKey('mob_kobold', '#5a4a78', 0.6);
    const weak = stillKey('mob_kobold', '#5a4a78', 0.15);
    expect(strong).not.toBe(weak);
    expect(strong).toBe('mob_kobold__5a4a78__s60');
    expect(weak).toBe('mob_kobold__5a4a78__s15');
  });

  it('a strength-only change (same model, same tint) mints a new key', () => {
    const before = stillKey('player_priest', '#f0e9d6', 0.5);
    const after = stillKey('player_priest', '#f0e9d6', 0.15);
    expect(before).not.toBe(after);
  });

  it('stillUrl forwards tintStrength into the key and serves under /guide-stills/', () => {
    expect(stillUrl('player_priest', '#f0e9d6', 0.5)).toBe(
      '/guide-stills/player_priest__f0e9d6__s50.webp',
    );
    expect(stillUrl('player_shaman', '#6f8fc9', 0.4)).toBe(
      '/guide-stills/player_shaman__6f8fc9.webp',
    );
  });

  it('stillUrl returns null without a model, independent of tint/tintStrength', () => {
    expect(stillUrl(null, '#f0e9d6', 0.5)).toBeNull();
    expect(stillUrl(undefined, undefined, undefined)).toBeNull();
  });
});

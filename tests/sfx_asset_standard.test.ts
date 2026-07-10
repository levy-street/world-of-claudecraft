import { describe, expect, it } from 'vitest';
import {
  buildSfxCatalogMap,
  filenameForEntry,
  validateSfxCatalog,
} from '../scripts/sfx/sfx_asset_standard.mjs';
import { SFX } from '../scripts/sfx/sfx_prompts.mjs';

describe('SFX asset catalog filenames', () => {
  it('keeps generated entries on the default MP3 filename', () => {
    expect(filenameForEntry({ key: 'cast_nature' })).toBe('cast_nature.mp3');
  });

  it('preserves an explicitly cataloged custom container', () => {
    const catalog = buildSfxCatalogMap(SFX);
    expect(validateSfxCatalog(SFX)).toEqual([]);
    expect(catalog.get('cast_lightning_bolt')).toMatchObject({
      custom: true,
      filename: 'cast_lightning_bolt.wav',
      loop: true,
    });
  });

  it('rejects filename overrides that are not custom or do not match the key', () => {
    expect(validateSfxCatalog([{ key: 'cast_nature', filename: 'cast_nature.wav' }])).toContain(
      'cast_nature: explicit filenames are reserved for custom assets.',
    );
    expect(
      validateSfxCatalog([{ key: 'cast_nature', custom: true, filename: '../different_name.wav' }]),
    ).toContain('cast_nature: custom filename must stay flat and match the catalog key.');
  });
});

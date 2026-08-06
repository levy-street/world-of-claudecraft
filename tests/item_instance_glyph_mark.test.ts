// Pure unit pins for the shared instance corner-mark HTML helper. The bags and
// bank painters both mint through this module; a silent drift (wrong class,
// missing aria-hidden, masterwork without the seal image) would show up here
// before any painter suite.

import { describe, expect, it } from 'vitest';
import { bagInstanceGlyphKind } from '../src/ui/bag_instance_glyph_view';
import {
  INSTANCE_GLYPH_ARIA_KEYS,
  instanceGlyphMarkHtml,
  UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS,
} from '../src/ui/item_instance_glyph_mark';
import { MASTERWORK_SEAL_IMAGE_URL } from '../src/ui/profession_art';

describe('item_instance_glyph_mark', () => {
  it('returns empty HTML for a plain fungible stack', () => {
    expect(instanceGlyphMarkHtml(null)).toBe('');
    expect(instanceGlyphMarkHtml(bagInstanceGlyphKind(undefined))).toBe('');
  });

  it('mints the authored masterwork seal image with a11y attributes', () => {
    const html = instanceGlyphMarkHtml('masterwork');
    expect(html).toContain('bi-masterwork-seal');
    expect(html).toContain(`src="${MASTERWORK_SEAL_IMAGE_URL}"`);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('draggable="false"');
  });

  it('mints distinct per-kind glyphs for enchanted, signed, and bound', () => {
    const enchanted = instanceGlyphMarkHtml('enchanted');
    const signed = instanceGlyphMarkHtml('signed');
    const bound = instanceGlyphMarkHtml('bound');
    expect(enchanted).toContain('bi-glyph-enchanted');
    expect(signed).toContain('bi-glyph-signed');
    expect(bound).toContain('bi-glyph-bound');
    expect(enchanted).toContain('aria-hidden="true"');
    // Three different SVG payloads, not one shape recolored.
    expect(new Set([enchanted, signed, bound]).size).toBe(3);
  });

  it('mints the generic wedge for an unclassified instanced payload', () => {
    const html = instanceGlyphMarkHtml('generic');
    expect(html).toContain('bi-instance');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('bi-glyph');
    expect(html).not.toContain('bi-masterwork-seal');
  });

  it('resolves payload to HTML through the pure kind priority', () => {
    // The painters compose the pure kind core with the mark mint themselves
    // (they need the kind for the aria key too); this pins that composition.
    expect(
      instanceGlyphMarkHtml(
        bagInstanceGlyphKind({
          signer: 'Anna',
          rolled: { masterwork: true, stats: { sta: 1 } },
        }),
      ),
    ).toContain('bi-masterwork-seal');
    expect(instanceGlyphMarkHtml(bagInstanceGlyphKind({ signer: 'Anna' }))).toContain(
      'bi-glyph-signed',
    );
    expect(bagInstanceGlyphKind({ rolled: { masterwork: true, stats: { sta: 1 } } })).toBe(
      'masterwork',
    );
  });

  it('keeps one distinct aria key per kind (and unknown siblings)', () => {
    const known = Object.values(INSTANCE_GLYPH_ARIA_KEYS);
    const unknown = Object.values(UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS);
    // signed and generic intentionally share the maker-marked wording.
    expect(new Set(known).size).toBe(4);
    expect(new Set(unknown).size).toBe(4);
    expect(INSTANCE_GLYPH_ARIA_KEYS.masterwork).toBe('hudChrome.bags.itemAriaMasterwork');
    expect(UNKNOWN_INSTANCE_GLYPH_ARIA_KEYS.masterwork).toBe(
      'itemUi.bags.unknownItemAriaMasterwork',
    );
  });
});

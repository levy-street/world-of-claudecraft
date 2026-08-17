// Pure unit pins for the shared instance corner-mark HTML helper. The bags and
// bank painters both mint through this module; a silent drift (wrong class,
// missing aria-hidden, masterwork without the seal image) would show up here
// before any painter suite.

import { describe, expect, it } from 'vitest';
import { bagCornerMark } from '../src/ui/bag_corner_mark_view';
import { bagInstanceGlyphKind } from '../src/ui/bag_instance_glyph_view';
import {
  cornerMarkHtml,
  fineSealMarkHtml,
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

  it('cornerMarkHtml dispatches every resolved corner kind exhaustively', () => {
    // The one dispatch every painter uses; a painter re-deriving the corner
    // from the raw glyph kind is the drift this function exists to close.
    expect(cornerMarkHtml(null)).toBe('');
    expect(cornerMarkHtml('fine')).toBe(fineSealMarkHtml());
    expect(cornerMarkHtml('fine')).toContain('class="bi-fine-seal"');
    expect(cornerMarkHtml('fine')).toContain('aria-hidden="true"');
    expect(cornerMarkHtml('masterwork')).toBe(instanceGlyphMarkHtml('masterwork'));
    for (const kind of ['enchanted', 'signed', 'bound', 'generic'] as const) {
      expect(cornerMarkHtml(kind)).toBe(instanceGlyphMarkHtml(kind));
    }
    // questReady only affects the quest arm; every other kind ignores it.
    expect(cornerMarkHtml('fine', { questReady: true })).toBe(cornerMarkHtml('fine'));
  });

  it('cornerMarkHtml mints the quest seal, brightening only when ready', () => {
    // Reachable from bags only (the banks pass a null quest arm into
    // bagCornerMark), but the dispatch stays total so a future surface that
    // CAN hold quest stacks needs no new markup path. Driven through the real
    // priority core so the pin covers the composition, not just the string.
    const quiet = cornerMarkHtml(bagCornerMark(null, 'quest', false));
    expect(quiet).toContain('class="bi-quest-seal"');
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain('bi-quest-seal-ready');
    const ready = cornerMarkHtml(bagCornerMark(null, 'questReady', false), { questReady: true });
    expect(ready).toContain('bi-quest-seal bi-quest-seal-ready');
    // Quest purpose outranks the fine grade through the core, and the
    // dispatch honors the core's answer rather than the fine flag.
    expect(cornerMarkHtml(bagCornerMark(null, 'quest', true))).toContain('bi-quest-seal');
    expect(cornerMarkHtml(bagCornerMark(null, 'quest', true))).not.toContain('bi-fine-seal');
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

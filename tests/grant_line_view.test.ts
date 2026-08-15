// Pure-core tests for src/ui/grant_line_view.ts (#2430): the item token a
// profession grant line splices, and the quantity-variant key choice shared by
// the gather and craft line families. These are the decisions that make the
// profession's own line self-sufficient once the grant hub's "You receive:"
// line stands down for it, so each one is pinned directly rather than only
// through the HUD arms that consume it.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { itemDisplayName } from '../src/ui/entity_i18n';
import {
  craftedLineKey,
  gatherLineKey,
  grantItemToken,
  grantQtyText,
  harvestLineKey,
  isMultiUnitGrant,
} from '../src/ui/grant_line_view';
import { parseChatSegments } from '../src/ui/hud/quest/quest_link';

// A real content id, resolved from the table rather than hardcoded, so a
// content rename cannot leave this file pinning a phantom.
const KNOWN_ID = Object.keys(ITEMS)[0];

describe('grantItemToken', () => {
  it('emits a chat item link the chat-log parser actually resolves', () => {
    const token = grantItemToken(KNOWN_ID);
    // Not just "contains [[i:": the token must round-trip through the SAME
    // parser appendLog uses, or the player sees the raw source text.
    expect(parseChatSegments(token)).toEqual([{ kind: 'item', itemId: KNOWN_ID }]);
  });

  it('produces a token that survives interpolation into a line', () => {
    // The token is spliced as a t() VALUE, so it has to stay parseable when it
    // sits inside surrounding sentence text.
    const line = `You gather: ${grantItemToken(KNOWN_ID)}.`;
    expect(parseChatSegments(line)).toEqual([
      { kind: 'text', value: 'You gather: ' },
      { kind: 'item', itemId: KNOWN_ID },
      { kind: 'text', value: '.' },
    ]);
  });

  it('falls back to the raw id for an item the client cannot resolve', () => {
    // Content drift between client and server. The chat renderer degrades an
    // unknown link to a bare "[?]", which names nothing; the raw id at least
    // identifies what arrived, which is what the pre-link code did.
    expect(grantItemToken('no_such_item_id')).toBe('no_such_item_id');
    expect(grantItemToken('no_such_item_id')).not.toContain('[[i:');
  });

  it('falls back to the localized name for a known id the link parser would reject', () => {
    // The parser only accepts [A-Za-z0-9_]+. A content id with any other
    // character would render as literal "[[i:...]]" source text to the player,
    // so such an id must take the plain-name path instead.
    const originalIds = Object.keys(ITEMS);
    const oddId = 'odd-id.with punctuation';
    ITEMS[oddId] = { ...ITEMS[KNOWN_ID], id: oddId };
    try {
      const token = grantItemToken(oddId);
      expect(token).not.toContain('[[i:');
      expect(token).toBe(itemDisplayName(ITEMS[oddId]));
    } finally {
      delete ITEMS[oddId];
      expect(Object.keys(ITEMS)).toEqual(originalIds);
    }
  });
});

describe('grantQtyText', () => {
  // The {qty} value every grant line splices. It lives here rather than being
  // respelled at each hud.ts event arm (five of them), so the one-unit default
  // and the digit options cannot diverge between families.
  it('defaults an absent count to one unit', () => {
    // craftResult.count and disenchantResult.secondaryCount are both optional
    // on the wire; an arm that dropped the default would render a bare "x".
    expect(grantQtyText(undefined)).toBe('1');
  });

  it('renders a plain localized integer, never a decimal or a unit suffix', () => {
    expect(grantQtyText(1)).toBe('1');
    expect(grantQtyText(5)).toBe('5');
    expect(grantQtyText(12)).toBe('12');
  });

  it('drops a fractional part rather than printing one into a chat line', () => {
    // No grant path produces a fraction today; the option is what guarantees a
    // future one cannot print "x2.5" into the log.
    expect(grantQtyText(2.4)).toBe('2');
    expect(grantQtyText(2.6)).toBe('3');
  });
});

describe('isMultiUnitGrant', () => {
  it('is true only past one unit', () => {
    // The genre convention both reference string tables ship: a singular
    // string and a quantity string as a PAIR, and x1 is never rendered.
    expect(isMultiUnitGrant(undefined)).toBe(false);
    expect(isMultiUnitGrant(0)).toBe(false);
    expect(isMultiUnitGrant(1)).toBe(false);
    expect(isMultiUnitGrant(2)).toBe(true);
    expect(isMultiUnitGrant(99)).toBe(true);
  });
});

describe('the quantity-variant key selectors', () => {
  it('gatherLineKey switches families exactly at 2', () => {
    expect(gatherLineKey(1)).toBe('hudChrome.gathering.gatherLine');
    expect(gatherLineKey(2)).toBe('hudChrome.gathering.gatherLineQty');
    expect(gatherLineKey(5)).toBe('hudChrome.gathering.gatherLineQty');
  });

  it('craftedLineKey switches families exactly at 2, and treats an absent count as one', () => {
    // craftResult.count is optional on the event; a denied craft carries none.
    expect(craftedLineKey(undefined)).toBe('hudChrome.crafting.craftedToast');
    expect(craftedLineKey(1)).toBe('hudChrome.crafting.craftedToast');
    expect(craftedLineKey(3)).toBe('hudChrome.crafting.craftedToastQty');
  });

  it('harvestLineKey switches families exactly at 2 for a component yield', () => {
    // #2457: the corpse-harvest family. Its selector runs PER ENTRY, not per
    // command, because one harvest grants several distinct items.
    expect(harvestLineKey({ kind: 'plain', qty: 1 })).toBe('hudChrome.gathering.harvestLine');
    expect(harvestLineKey({ kind: 'plain', qty: 2 })).toBe('hudChrome.gathering.harvestLineQty');
    expect(harvestLineKey({ kind: 'plain', qty: 6 })).toBe('hudChrome.gathering.harvestLineQty');
  });

  it('harvestLineKey renders a SIGNED component with the same line as a plain one', () => {
    // Deliberate, and the reason the discriminant is three-valued rather than
    // a specimen boolean: the node-gather windfall's signed batch has never
    // had a line of its own either, so two gathering surfaces must not
    // announce the same mark differently. Both quantity variants are bound so
    // a future divergence has to re-pin this on purpose.
    expect(harvestLineKey({ kind: 'signed', qty: 1 })).toBe(
      harvestLineKey({ kind: 'plain', qty: 1 }),
    );
    expect(harvestLineKey({ kind: 'signed', qty: 3 })).toBe(
      harvestLineKey({ kind: 'plain', qty: 3 }),
    );
  });

  it('harvestLineKey gives the specimen its own key, at every quantity', () => {
    // A Pristine specimen is a pure extra granted BESIDE its family's own
    // plain component, so it must never share that component's wording. It is
    // always exactly one unit today, and the quantity arm is pinned anyway so
    // a future multi-unit specimen cannot silently fall back to the component
    // family's Qty key.
    expect(harvestLineKey({ kind: 'specimen', qty: 1 })).toBe(
      'hudChrome.gathering.harvestSpecimenLine',
    );
    expect(harvestLineKey({ kind: 'specimen', qty: 4 })).toBe(
      'hudChrome.gathering.harvestSpecimenLine',
    );
  });

  it('the harvest family never collides with the gather family', () => {
    // Two gathering surfaces, two wordings: a copy/paste that pointed the
    // corpse arm at the node-harvest keys would leave every other pin green.
    const harvestKeys = [
      harvestLineKey({ kind: 'plain', qty: 1 }),
      harvestLineKey({ kind: 'plain', qty: 2 }),
      harvestLineKey({ kind: 'specimen', qty: 1 }),
    ];
    expect(new Set(harvestKeys).size).toBe(3);
    expect(harvestKeys).not.toContain(gatherLineKey(1));
    expect(harvestKeys).not.toContain(gatherLineKey(2));
  });
});

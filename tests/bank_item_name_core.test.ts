// The name a bank cell shows (src/ui/bank_item_name_core.ts), which the bank's
// search and its name-sort both run over so all three agree with each other.
//
// The contract these pin has two halves, and the second is why this suite loads
// a real locale instead of asserting over English fixtures: the resolver is pure
// over (def, instance, ACTIVE LANGUAGE), because it falls through to
// itemDisplayName. Pinned against English alone, every arm here would pass while
// the localized path rotted, which is exactly the failure the bank search had in
// the first place.

import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { bankSlotDisplayName } from '../src/ui/bank_item_name_core';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

// A live shipped def whose name really is translated, so the locale arm below
// compares two different strings rather than English with itself.
const TRANSLATED_ID = 'worn_sword';
const def = (): ItemDef => {
  const item = ITEMS[TRANSLATED_ID];
  if (!item) throw new Error(`missing fixture def ${TRANSLATED_ID}`);
  return item;
};

describe('bankSlotDisplayName: the name the cell shows', () => {
  it("uses the COPY's chosen name when it carries one", () => {
    setLanguage('en');
    const name = bankSlotDisplayName(def(), {
      itemId: TRANSLATED_ID,
      instance: { name: 'Dawn Oath' },
    });
    expect(name).toBe('Dawn Oath');
    // The whole point of the fix: the chosen name REPLACES the def name, so a
    // renamed legendary is not filed under a name its cell never shows.
    expect(name).not.toBe(itemDisplayName(def()));
  });

  it('falls back to the def name for a copy with no chosen name', () => {
    setLanguage('en');
    expect(bankSlotDisplayName(def(), { itemId: TRANSLATED_ID })).toBe(itemDisplayName(def()));
    // An instance with no `name` is the same case, not a third one: a signed or
    // masterwork copy is still shown under its def name.
    expect(
      bankSlotDisplayName(def(), { itemId: TRANSLATED_ID, instance: { signer: 'Smith' } }),
    ).toBe(itemDisplayName(def()));
  });

  it('falls back to the RAW ID when the def is unknown, which is what that cell paints', () => {
    // The stale-client guard: a cell whose id resolves to no def renders the id,
    // so search and sort have to use the id too or they file a visible cell
    // under a name nothing displays.
    setLanguage('en');
    expect(bankSlotDisplayName(undefined, { itemId: 'not_a_real_item' })).toBe('not_a_real_item');
  });
});

describe('bankSlotDisplayName: it is pure over the ACTIVE LANGUAGE too', () => {
  it('answers in the language current when it is CALLED, and caches nothing', async () => {
    setLanguage('en');
    const english = bankSlotDisplayName(def(), { itemId: TRANSLATED_ID });
    // LOADED, not merely selected: setLanguage alone leaves t() on the English
    // fallback table, and then the two strings compare EQUAL and this arm passes
    // while proving nothing (the bank_bonus_view rule, one module over).
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const japanese = bankSlotDisplayName(def(), { itemId: TRANSLATED_ID });
    // Read the localized fixture BEFORE switching back: the resolver answers for
    // whatever language is current at the moment it is called, which is the
    // property under test and the easiest thing to assert against the wrong one.
    const fixtureMoved = itemDisplayName(def());
    setLanguage('en');
    expect(japanese, 'the ja_JP fixture really is translated').not.toBe(english);
    expect(japanese).toBe(fixtureMoved);
    // ...and switching back restores it, so nothing was memoized in the module.
    expect(bankSlotDisplayName(def(), { itemId: TRANSLATED_ID })).toBe(english);
  });

  it('leaves a CHOSEN name alone across the same switch: it is player text, not catalog text', async () => {
    setLanguage('en');
    const chosen = { itemId: TRANSLATED_ID, instance: { name: 'Dawn Oath' } };
    expect(bankSlotDisplayName(def(), chosen)).toBe('Dawn Oath');
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const underJa = bankSlotDisplayName(def(), chosen);
    setLanguage('en');
    // The language arm above must not be read as "every name moves": a name the
    // player typed is theirs in every locale, and a resolver that ran it through
    // the catalog would be a different (and worse) bug.
    expect(underJa).toBe('Dawn Oath');
  });
});

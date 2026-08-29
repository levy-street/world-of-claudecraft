// The Season 1 Armory's markup core (src/ui/armory_card_view.ts), split out of
// src/ui/daily_rewards_window.ts in Bank Storage phase 15 as the twin of
// src/ui/charter_card_view.ts. Registering it in UI_PURE_CORES proves it is
// PURE; these arms prove it is CORRECT, which is the point of extracting a
// markup builder in the first place: it is now renderable without a DOM.
//
// Rows come from the real projection (buildArmorySections over the shipped
// catalog), never from hand-rolled literals, so a catalog or projection change
// reaches these arms instead of sailing past a fixture.

import { describe, expect, it } from 'vitest';
import {
  armoryCardHtml,
  armoryClassChipsHtml,
  armorySectionHtml,
} from '../src/ui/armory_card_view';
import {
  type ArmorySkinRow,
  buildArmorySections,
  type WocStoreItemInput,
} from '../src/ui/woc_store_view';

const noCosmetics = { weaponSkinIds: [] as string[], weaponSkinLoadout: {} };

function sections(balance: number | null, items: readonly WocStoreItemInput[]) {
  return buildArmorySections(balance, items, {
    cosmetics: noCosmetics,
    cls: 'warrior',
    mainhandItemId: null,
    skinCatalog: {} as never,
  });
}

function firstRow(): ArmorySkinRow {
  const row = sections(0, [])[0]?.rows[0];
  if (!row) throw new Error('the shipped catalog projected no armory row');
  return row;
}

function priced(row: ArmorySkinRow, costClaudium: number): WocStoreItemInput {
  return { itemId: row.skin.id, name: row.skin.id, kind: 'skin', costClaudium, owned: false };
}

describe('armoryCardHtml', () => {
  it('renders an unowned priced card with the cost, never an owned or applied state', () => {
    const seed = firstRow();
    const row = sections(5_000, [priced(seed, 1234)])[0].rows.find(
      (r) => r.skin.id === seed.skin.id,
    );
    if (!row) throw new Error('the priced row vanished from the projection');
    const html = armoryCardHtml(row);
    expect(html).toContain('armory-cost');
    expect(html).toContain('1,234'); // formatNumber, not a raw number
    expect(html).not.toContain('armory-state applied');
    expect(html).not.toContain('>Owned<');
    // The inspect button carries BOTH ids the window's click handlers read.
    expect(html).toContain(`data-armory-skin="${row.skin.id}"`);
    expect(html).toContain(`data-focus-key="armory-${row.skin.id}"`);
  });

  it('renders the shared unavailable treatment when the service prices nothing', () => {
    // Every catalog skin always shows; a skin the service snapshot is missing
    // renders unavailable with no price rather than dropping out of the grid.
    const html = armoryCardHtml(firstRow());
    expect(html).toContain('armory-state unavailable');
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('armory-cost');
  });

  it('escapes every interpolated value, including the art path', () => {
    const row = firstRow();
    const hostile: ArmorySkinRow = {
      ...row,
      art: '/ui/store/armory/"><script>x</script>.webp',
    };
    const html = armoryCardHtml(hostile);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('armoryClassChipsHtml', () => {
  it('emits one chip per eligible class, and nothing at all when there are none', () => {
    const row = firstRow();
    expect(row.eligibleClasses.length).toBeGreaterThan(0); // the fixture is real
    const html = armoryClassChipsHtml(row);
    expect((html.match(/armory-class-chip/g) ?? []).length).toBe(row.eligibleClasses.length);
    expect(html).toContain('armory-classes');
    // The empty arm returns '' rather than an empty wrapper, which would paint a
    // stray gap on the card.
    expect(armoryClassChipsHtml({ ...row, eligibleClasses: [] })).toBe('');
  });
});

describe('armorySectionHtml', () => {
  it('heads the section with the rarity class and one card per row', () => {
    const section = sections(0, [])[0];
    const html = armorySectionHtml(section);
    expect(html).toContain(`armory-section rarity-${section.rarity}`);
    expect((html.match(/armory-card /g) ?? []).length).toBe(section.rows.length);
    expect(section.rows.length).toBeGreaterThan(1); // not a one-row section
  });

  it('takes its header price from the FIRST priced row, and says unavailable with none', () => {
    const section = sections(0, [])[0];
    expect(armorySectionHtml(section)).toContain('armory-section-price unavailable');

    const seed = section.rows[1];
    const withPrice = sections(0, [priced(seed, 777)])[0];
    const html = armorySectionHtml(withPrice);
    expect(html).toContain('777');
    expect(html).not.toContain('armory-section-price unavailable');
  });
});

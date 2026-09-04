// The Machine Stable's markup core (src/ui/store_mount_card_view.ts), the
// store-mount twin of src/ui/armory_card_view.ts. Registering it in
// UI_PURE_CORES proves it is PURE; these arms prove it is CORRECT: the card is
// the Armory card family (so the shipped .armory-* CSS styles it), the rarity
// class sits on the SECTION where the CSS keys the border, the three card
// states, and the buy attribute the store body binding reads back
// (src/ui/store_body_actions.ts).
//
// Rows come from the real projection (buildStoreMountRows over the shipped
// catalog), never from hand-rolled literals, so a catalog or projection change
// reaches these arms instead of sailing past a fixture.

import { describe, expect, it } from 'vitest';
import { MOUNTS } from '../src/sim/content/mounts';
import { STORE_MOUNT_ITEM_IDS } from '../src/sim/content/store_mounts';
import { t } from '../src/ui/i18n';
import {
  STORE_MOUNT_BUY_ATTR,
  storeMountCardHtml,
  storeMountName,
  storeMountsSectionHtml,
} from '../src/ui/store_mount_card_view';
import {
  buildStoreMountRows,
  type StoreMountRow,
  type WocStoreItemInput,
} from '../src/ui/woc_store_view';

const REINS = STORE_MOUNT_ITEM_IDS[0];

function service(over: Partial<WocStoreItemInput> = {}): WocStoreItemInput {
  return {
    itemId: REINS,
    name: 'service name',
    kind: 'item',
    costClaudium: 1200,
    owned: false,
    ...over,
  };
}

function row(
  balance: number | null,
  items: WocStoreItemInput[],
  owned: string[] = [],
): StoreMountRow {
  const first = buildStoreMountRows(balance, items, owned)[0];
  if (!first) throw new Error('the shipped catalog projected no store mount row');
  return first;
}

function rarityOf(r: StoreMountRow): string {
  return MOUNTS[r.mountKey as keyof typeof MOUNTS].rarity;
}

describe('storeMountCardHtml', () => {
  it('renders a priced row as an Armory-family card whose button carries the item id', () => {
    const priced = row(5000, [service()]);
    const html = storeMountCardHtml(priced);
    expect(html).toMatch(new RegExp(`^<article class="armory-card rarity-${rarityOf(priced)}">`));
    expect(html).toContain(`<button type="button" ${STORE_MOUNT_BUY_ATTR}="${REINS}"`);
    expect(html).not.toContain(' disabled');
    expect(html).toContain(
      `aria-label="${t('hudChrome.wocStore.mountBuyAria', { item: storeMountName(REINS) })}"`,
    );
    // The art and copy slots the shipped .armory-card CSS lays out.
    expect(html).toContain(
      `<span class="armory-card-art"><img src="/ui/items/${REINS}.webp" alt="" loading="lazy" decoding="async"></span>`,
    );
    expect(html).toContain('<span class="armory-card-copy"><span class="armory-card-type">');
    expect(html).toContain(`<h4>${storeMountName(REINS)}</h4>`);
    // The price is the service's, in the .armory-cost slot, never invented.
    expect(html).toMatch(/<span class="armory-cost"><img [^>]*><strong>1\D?200<\/strong><\/span>/);
    expect(html).not.toContain('armory-state');
  });

  it('renders an owned row as the owned state with a disabled card button', () => {
    const html = storeMountCardHtml(row(5000, [service()], ['mech_bird']));
    expect(html).toMatch(/^<article class="armory-card rarity-\w+ owned">/);
    expect(html).toContain('<span class="armory-state">');
    expect(html).toContain(' disabled ');
    expect(html).not.toContain('armory-cost');
  });

  it('renders a row the service snapshot lacks as unavailable, disabled, with no price', () => {
    const html = storeMountCardHtml(row(5000, []));
    expect(html).toContain('<span class="armory-state unavailable">');
    expect(html).toContain(' disabled ');
    expect(html).not.toContain('claudium_coin_64.webp');
  });

  it('names the mount from the catalog, never from the service name', () => {
    const html = storeMountCardHtml(row(5000, [service({ name: '<script>service</script>' })]));
    expect(html).not.toContain('service');
    expect(html).toContain('armory-card-type');
  });

  it('renders nothing for a row whose item the catalog does not declare', () => {
    const bogus: StoreMountRow = { ...row(5000, [service()]), itemId: 'not_a_reins', mountKey: '' };
    expect(storeMountCardHtml(bogus)).toBe('');
  });
});

describe('storeMountsSectionHtml', () => {
  it('wraps the cards in an Armory section carrying the rarity class and the Machine Stable header', () => {
    const rows = buildStoreMountRows(5000, [service()], []);
    const html = storeMountsSectionHtml(rows);
    expect(html).toMatch(
      new RegExp(`^<section class="armory-section store-mounts rarity-${rarityOf(rows[0])}">`),
    );
    expect(html).toContain(`<span>${t('hudChrome.wocStore.mountsEyebrow')}</span>`);
    expect(html).toContain(`<h3>${t('hudChrome.wocStore.mountsTitle')}</h3>`);
    expect(html).toContain('<div class="armory-grid"><article class="armory-card');
  });

  it('is empty with no rows, so the store paints no empty strip', () => {
    expect(storeMountsSectionHtml([])).toBe('');
  });
});

describe('storeMountName', () => {
  it('falls back to the id only for an item the catalog does not declare', () => {
    expect(storeMountName(REINS)).not.toBe(REINS);
    expect(storeMountName('not_an_item')).toBe('not_an_item');
  });
});

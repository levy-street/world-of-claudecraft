// The Crucible sigil purpose line (src/ui/sigil_redeem_tooltip_view.ts):
// players misread "Mantle" and "Grip", so every sigil's tooltip names the
// vendor, where he stands, and the gear slot the token buys.
import { describe, expect, it } from 'vitest';
import {
  CRUCIBLE_VENDOR_ENTRANCE_POS,
  CRUCIBLE_VENDOR_STOCK,
  IGNIVAR_SIGIL_ITEMS,
} from '../src/sim/content/ignivar_loot';
import { ITEMS, zoneAt } from '../src/sim/data';
import { sigilRedeemSlot, sigilRedeemTooltipLine } from '../src/ui/sigil_redeem_tooltip_view';

const SIGIL_IDS = Object.keys(IGNIVAR_SIGIL_ITEMS);

// The player-facing slot label each sigil's line must name, pinned to
// literals so a slot-table or stock edit that changes the word fails here.
const EXPECTED_SLOT_WORD: Record<string, string> = {
  helmet: 'Helmet',
  shoulder: 'Shoulder',
  chest: 'Chest',
  gloves: 'Gloves',
  legs: 'Legs',
};

describe('Crucible sigil purpose line', () => {
  it('covers all fifteen sigils', () => {
    expect(SIGIL_IDS).toHaveLength(15);
  });

  it.each(SIGIL_IDS)('%s names the vendor, the place, and its slot', (id) => {
    const suffix = id.split('_').at(-1) as string;
    const line = sigilRedeemTooltipLine(ITEMS[id]);
    expect(line).toBe(
      '<div class="tt-desc tt-sigil-redeem">Can be traded to Quartermaster Bronn Emberward, outside the ' +
        'Crucible of the Last Spring entrance in The Drakelands, for a ' +
        `${EXPECTED_SLOT_WORD[suffix]} set piece.</div>`,
    );
  });

  it('reads the slot from what the vendor sells for that sigil', () => {
    for (const id of SIGIL_IDS) {
      const offers = CRUCIBLE_VENDOR_STOCK.filter((offer) => offer.sigilId === id);
      expect(offers.length).toBeGreaterThan(0);
      for (const offer of offers) expect(ITEMS[offer.itemId].slot).toBe(sigilRedeemSlot(id));
    }
    expect(sigilRedeemSlot('sigil_ember_shoulder')).toBe('shoulder');
    expect(sigilRedeemSlot('sigil_tempest_gloves')).toBe('gloves');
  });

  it('places the vendor in the Drakelands', () => {
    expect(zoneAt(CRUCIBLE_VENDOR_ENTRANCE_POS.x, CRUCIBLE_VENDOR_ENTRANCE_POS.z).id).toBe(
      'drakelands',
    );
  });

  it('gives the slotless pattern currency no line', () => {
    expect(CRUCIBLE_VENDOR_STOCK.some((offer) => offer.sigilId === 'lastflame_core')).toBe(true);
    expect(sigilRedeemSlot('lastflame_core')).toBeNull();
    expect(sigilRedeemTooltipLine(ITEMS.lastflame_core)).toBe('');
  });

  it('gives an ordinary item no line', () => {
    expect(sigilRedeemTooltipLine(ITEMS.slagbreaker_shoulder)).toBe('');
    expect(sigilRedeemTooltipLine(ITEMS.heroic_mark)).toBe('');
  });
});

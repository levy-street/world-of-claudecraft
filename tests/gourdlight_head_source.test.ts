// @vitest-environment happy-dom
// The Carved Pumpkin Head comes ONLY from Old Thatchgrin (owner direction 2026-10-18):
// his first-kill drop for a character who does not own one. Hester's shelf no longer
// carries it, so every surface that names its source (the shop, the Book of Deeds Feat,
// the item tooltip) says the boss and never the vendor.
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_KEEPER_NPC,
  GOURDLIGHT_SHOP_ITEMS,
  GOURDLIGHT_SHOP_PRICES,
} from '../src/sim/content/gourdlight_eve';
import { THATCHGRIN_ID } from '../src/sim/content/gourdlight_eve_scarecrow';
import { ITEMS, MOBS, NPCS } from '../src/sim/data';
import { seasonalItemSourceText, seasonalItemTooltipLines } from '../src/ui/seasonal_item_tooltip';

describe('the Carved Pumpkin Head is the boss drop only', () => {
  it('is on no vendor shelf and carries no price', () => {
    expect(GOURDLIGHT_SHOP_ITEMS).not.toContain(CARVED_PUMPKIN_HEAD_ID);
    expect(GOURDLIGHT_KEEPER_NPC.vendorItems).not.toContain(CARVED_PUMPKIN_HEAD_ID);
    expect(CARVED_PUMPKIN_HEAD_ID in GOURDLIGHT_SHOP_PRICES).toBe(false);
    expect(ITEMS[CARVED_PUMPKIN_HEAD_ID]?.priceItem).toBeUndefined();
    for (const npc of Object.values(NPCS)) {
      expect(npc.vendorItems ?? [], npc.id).not.toContain(CARVED_PUMPKIN_HEAD_ID);
    }
  });

  it('still drops from Old Thatchgrin for a character who does not own one', () => {
    const row = MOBS[THATCHGRIN_ID]?.loot?.find((l) => l.itemId === CARVED_PUMPKIN_HEAD_ID);
    expect(row).toBeDefined();
    expect(row?.chance).toBe(1);
    expect(row?.unlessOwned).toBe(true);
  });

  it('the Feat and the tooltip name the boss, never the vendor', () => {
    const desc = DEEDS.feat_gourdlight_guise.desc;
    expect(desc).toContain('Old Thatchgrin');
    expect(desc).not.toContain('Hester');
    const source = seasonalItemSourceText({ id: CARVED_PUMPKIN_HEAD_ID }) ?? '';
    expect(source).toContain('Old Thatchgrin');
    expect(source).toContain('No vendor sells it');
    expect(seasonalItemTooltipLines({ id: CARVED_PUMPKIN_HEAD_ID })).toContain(source);
    expect(seasonalItemSourceText({ id: 'jar_of_mischief' })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { buildArmorySections, type WocStoreItemInput } from '../src/ui/woc_store_view';

const noCosmetics = { weaponSkinIds: [], weaponSkinLoadout: {} };

function serviceRow(itemId: string, costClaudium: number, owned = false): WocStoreItemInput {
  return { itemId, name: itemId, kind: 'skin', costClaudium, owned };
}

describe('buildArmorySections', () => {
  it('always lists all 29 skins in 4 sections, highest rarity first', () => {
    const sections = buildArmorySections(0, [], {
      cosmetics: noCosmetics,
      cls: 'warrior',
      mainhandItemId: 'worn_sword',
    });
    expect(sections.map((s) => s.rarity)).toEqual(['legendary', 'epic', 'rare', 'uncommon']);
    expect(sections.map((s) => s.collection)).toEqual([
      'fallen_star',
      'hoarfrost',
      'emberwrought',
      'guildmark',
    ]);
    // 7 per collection, plus the Fallen Star encore (the legendary bow slot).
    expect(sections.map((s) => s.rows.length)).toEqual([8, 7, 7, 7]);
    // No service rows: the game must not invent a price for a missing SKU.
    const ice = sections[1].rows.find((r) => r.skin.id === 'ice_fang_sword');
    expect(ice?.costClaudium).toBeNull();
    expect(ice?.purchasable).toBe(false);
    expect(ice?.affordable).toBe(false);
    expect(ice?.shortfall).toBeNull();
  });

  it('takes the live service price and purchasability when the SKU exists', () => {
    const sections = buildArmorySections(5000, [serviceRow('ice_fang_sword', 2400)], {
      cosmetics: noCosmetics,
      cls: 'warrior',
      mainhandItemId: 'worn_sword',
    });
    const ice = sections.flatMap((s) => s.rows).find((r) => r.skin.id === 'ice_fang_sword');
    expect(ice?.purchasable).toBe(true);
    expect(ice?.costClaudium).toBe(2400);
    expect(ice?.affordable).toBe(true);
    expect(ice?.shortfall).toBe(0);
  });

  it('computes shortfall against the balance', () => {
    const sections = buildArmorySections(1000, [serviceRow('solheim_sword', 5000)], {
      cosmetics: noCosmetics,
      cls: 'warrior',
      mainhandItemId: 'worn_sword',
    });
    const solheim = sections.flatMap((s) => s.rows).find((r) => r.skin.id === 'solheim_sword');
    expect(solheim?.affordable).toBe(false);
    expect(solheim?.shortfall).toBe(4000);
  });

  it('unions service and account ownership, and derives applied + canApplyNow', () => {
    const sections = buildArmorySections(0, [serviceRow('ice_fang_sword', 3000, true)], {
      cosmetics: {
        weaponSkinIds: ['cinderbrand_sword'],
        weaponSkinLoadout: { sword: 'cinderbrand_sword' },
      },
      cls: 'warrior',
      mainhandItemId: 'worn_sword',
    });
    const rows = sections.flatMap((s) => s.rows);
    const ice = rows.find((r) => r.skin.id === 'ice_fang_sword');
    const cinder = rows.find((r) => r.skin.id === 'cinderbrand_sword');
    const star = rows.find((r) => r.skin.id === 'starfall_mace');
    expect(ice?.owned).toBe(true); // service grant only
    expect(ice?.canApplyNow).toBe(true);
    expect(ice?.applied).toBe(false);
    expect(cinder?.owned).toBe(true); // account mirror only
    expect(cinder?.applied).toBe(true);
    expect(star?.owned).toBe(false);
  });

  it('gates canApplyNow on the equipped weapon type (hunter ranged rule included)', () => {
    const owned = {
      weaponSkinIds: ['glaciersplit_axe', 'winterbite'],
      weaponSkinLoadout: {},
    };
    const asWarrior = buildArmorySections(0, [], {
      cosmetics: owned,
      cls: 'warrior',
      mainhandItemId: 'rusty_hatchet',
    }).flatMap((s) => s.rows);
    expect(asWarrior.find((r) => r.skin.id === 'glaciersplit_axe')?.canApplyNow).toBe(true);
    expect(asWarrior.find((r) => r.skin.id === 'winterbite')?.canApplyNow).toBe(false);
    const asHunter = buildArmorySections(0, [], {
      cosmetics: owned,
      cls: 'hunter',
      mainhandItemId: 'rusty_hatchet',
    }).flatMap((s) => s.rows);
    expect(asHunter.find((r) => r.skin.id === 'glaciersplit_axe')?.canApplyNow).toBe(false);
    expect(asHunter.find((r) => r.skin.id === 'winterbite')?.canApplyNow).toBe(true);
  });

  it('threads the eligible-class chips onto every row', () => {
    const rows = buildArmorySections(0, [], {
      cosmetics: noCosmetics,
      cls: 'warrior',
      mainhandItemId: 'worn_sword',
    }).flatMap((s) => s.rows);
    expect(rows.every((r) => r.eligibleClasses.length > 0)).toBe(true);
    const bow = rows.find((r) => r.skin.weaponType === 'bow');
    expect(bow?.eligibleClasses).toEqual(['hunter']);
    const sword = rows.find((r) => r.skin.weaponType === 'sword');
    expect(sword?.eligibleClasses).toContain('warrior');
    expect(sword?.eligibleClasses).not.toContain('hunter');
  });
});

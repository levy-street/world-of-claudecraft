import { describe, expect, it } from 'vitest';
import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import {
  proceduralItemVisualId,
  proceduralItemWeaponVisualId,
} from '../src/ui/procedural_item_art';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

const EXPECTED_VISUAL_IDS = {
  ashwood_staff: 'gnarled_staff',
  gravecaller_cloth_hood: 'wayfarers_hood',
  gravecaller_ring: 'seal_of_the_nine_oaths',
  iron_broadsword: 'worn_sword',
  mirefen_leather_gloves: 'roughspun_gloves',
  thornpeak_mail_chest: 'militia_vest',
} as const;

describe('procedural item art', () => {
  it('maps every first-slice base to its deliberate reusable artwork', () => {
    expect(
      Object.fromEntries(
        Object.keys(PROCEDURAL_ITEM_BASES)
          .sort()
          .map((baseId) => [baseId, proceduralItemVisualId(baseId)]),
      ),
    ).toEqual(EXPECTED_VISUAL_IDS);
  });

  it('keeps every visual key independent of generated instance identity', () => {
    for (const base of Object.values(PROCEDURAL_ITEM_BASES)) {
      const visualId = proceduralItemVisualId(base.id);
      expect(visualId, base.id).toBe(base.visualItemId);
      expect(visualId).not.toMatch(/pi1:|uid|seed|affix|roll/i);
    }
  });

  it('keeps procedural weapon thumbnails and held models on the same variant', () => {
    for (const base of Object.values(PROCEDURAL_ITEM_BASES)) {
      const weaponVisualId = proceduralItemWeaponVisualId(base.id);
      if (base.kind === 'weapon') {
        expect(weaponVisualId, base.id).toBeTruthy();
        expect(ITEM_WEAPON_VARIANTS[proceduralItemVisualId(base.id)], base.id).toBe(weaponVisualId);
      } else {
        expect(weaponVisualId, base.id).toBeUndefined();
      }
    }
  });

  it('leaves non-procedural ids unchanged and without a weapon override', () => {
    expect(proceduralItemVisualId('wolf_fang')).toBe('wolf_fang');
    expect(proceduralItemWeaponVisualId('wolf_fang')).toBeUndefined();
  });
});

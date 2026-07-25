import { describe, expect, it } from 'vitest';
import {
  PROCEDURAL_LEGENDARY_POWERS,
  proceduralLegendaryPowerCompatibleWithBase,
} from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import { WEAPON_TYPE_BY_ITEM } from '../src/sim/content/weapon_skin_rules';
import type { ProceduralRarity } from '../src/sim/procedural_item';
import type { ItemInstancePayload } from '../src/sim/types';
import { ITEM_IMAGE_IDS, iconDataUrl, itemImageUrl } from '../src/ui/icons';
import {
  PROCEDURAL_ICON_RARITIES,
  proceduralItemVisualId,
  proceduralItemWeaponVisualId,
  resolveProceduralItemIcon,
} from '../src/ui/procedural_item_art';
import type { ItemPresentationInstance } from '../src/ui/procedural_item_presentation';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

function presentationInstance(
  baseId: string,
  rarity: ProceduralRarity,
  legendaryPowerId?: string,
  powerRevision?: number,
): ItemPresentationInstance {
  return {
    procedural: {
      version: 1,
      baseId,
      itemLevel: 20,
      rarity,
      affixes: [],
      ...(legendaryPowerId && { legendaryPowerId }),
      ...(powerRevision !== undefined && { powerRevision }),
      generatedName: {
        baseId,
        ...(legendaryPowerId && { legendaryNameId: legendaryPowerId }),
      },
    },
  };
}

function persistedLegendaryInstance(token: string, seed: number): ItemInstancePayload {
  return {
    procedural: {
      version: 1,
      uid: `pi1:${token}:1`,
      baseId: 'gravecaller_cloth_hood',
      itemLevel: 20,
      rarity: 'legendary',
      affixes: [
        {
          affixId: `affix_${token}`,
          family: `family_${token}`,
          position: 'prefix',
          tier: 1,
          revision: 1,
          budget: seed,
          values: { int: seed },
          ranges: { int: { min: 1, max: seed } },
        },
      ],
      legendaryPowerId: 'crown_last_pyre',
      powerRevision: 1,
      legendaryRolls: { potencyPct: seed },
      generatedName: {
        baseId: 'gravecaller_cloth_hood',
        legendaryNameId: `name_${token}`,
      },
      seed,
    },
  };
}

describe('procedural item art', () => {
  it('ships one unique dedicated visual for each of the 34 launch families', () => {
    const bases = Object.values(PROCEDURAL_ITEM_BASES);
    expect(bases).toHaveLength(34);
    expect(new Set(bases.map((base) => base.visualItemId)).size).toBe(34);
    for (const base of bases) {
      expect(base.visualItemId, base.id).toBe(base.id);
      expect(proceduralItemVisualId(base.id), base.id).toBe(base.id);
    }
  });

  it('serves dedicated painted art for every launch base, including weapons', () => {
    for (const baseId of Object.keys(PROCEDURAL_ITEM_BASES)) {
      expect(ITEM_IMAGE_IDS.has(baseId), baseId).toBe(true);
      expect(itemImageUrl(baseId), baseId).toBe(`/ui/items/${baseId}.webp`);
      expect(iconDataUrl('item', baseId), baseId).toBe(`/ui/items/${baseId}.webp`);
    }
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

  it('keeps each procedural weapon gameplay type aligned with the canonical map', () => {
    const weapons = Object.values(PROCEDURAL_ITEM_BASES).filter((base) => base.kind === 'weapon');
    expect(weapons).toHaveLength(9);
    expect(new Set(weapons.map((base) => base.weaponType))).toEqual(
      new Set(['sword', 'axe', 'mace', 'dagger', 'staff', 'wand', 'polearm', 'bow', 'crossbow']),
    );
    for (const weapon of weapons) {
      expect(WEAPON_TYPE_BY_ITEM[weapon.id], weapon.id).toBe(weapon.weaponType);
      expect(Boolean(weapon.dagger), weapon.id).toBe(weapon.weaponType === 'dagger');
    }
  });

  it('leaves non-procedural ids unchanged and without a weapon override', () => {
    expect(proceduralItemVisualId('wolf_fang')).toBe('wolf_fang');
    expect(proceduralItemWeaponVisualId('wolf_fang')).toBeUndefined();
    expect(resolveProceduralItemIcon('wolf_fang')).toBeNull();
  });
});

describe('procedural item static icon resolver', () => {
  it('resolves all 34 bases without an instance to their legacy preview', () => {
    for (const baseId of Object.keys(PROCEDURAL_ITEM_BASES)) {
      expect(resolveProceduralItemIcon(baseId), baseId).toEqual({
        cacheKey: `pli|v1|${baseId}|legacy`,
        state: 'legacy',
        url: `/ui/items/${baseId}.webp`,
      });
    }
  });

  it('resolves all 34 bases across the five active rarity states', () => {
    let states = 0;
    for (const baseId of Object.keys(PROCEDURAL_ITEM_BASES)) {
      for (const rarity of PROCEDURAL_ICON_RARITIES) {
        const resolved = resolveProceduralItemIcon(baseId, presentationInstance(baseId, rarity));
        expect(resolved, `${baseId}:${rarity}`).not.toBeNull();
        if (!resolved) continue;
        if (rarity === 'legendary') {
          expect(resolved).toEqual({
            cacheKey: `pli|v1|${baseId}|legendary|fallback`,
            state: 'legendary-fallback',
            url: `/ui/items/procedural/v1/${baseId}/legendary/_fallback.webp`,
          });
        } else {
          expect(resolved).toEqual({
            cacheKey: `pli|v1|${baseId}|${rarity}|none`,
            state: 'rarity',
            url: `/ui/items/procedural/v1/${baseId}/${rarity}.webp`,
          });
        }
        states++;
      }
    }
    expect(states).toBe(170);
  });

  it('resolves exactly the 21 approved power-base pairs and rejects every other pair', () => {
    let compatibleCount = 0;
    let incompatibleCount = 0;
    for (const base of Object.values(PROCEDURAL_ITEM_BASES)) {
      for (const power of Object.values(PROCEDURAL_LEGENDARY_POWERS)) {
        const compatible = proceduralLegendaryPowerCompatibleWithBase(power, base);
        const resolved = resolveProceduralItemIcon(
          base.id,
          presentationInstance(base.id, 'legendary', power.id, power.revision),
        );
        expect(resolved, `${base.id}:${power.id}`).not.toBeNull();
        if (!resolved) continue;
        if (compatible) {
          compatibleCount++;
          expect(resolved).toEqual({
            cacheKey: `pli|v1|${base.id}|legendary|${power.id}|r${power.revision}`,
            state: 'legendary',
            url:
              `/ui/items/procedural/v1/${base.id}/legendary/` +
              `${power.id}.r${power.revision}.webp`,
          });
        } else {
          incompatibleCount++;
          expect(resolved).toEqual({
            cacheKey: `pli|v1|${base.id}|legendary|fallback`,
            state: 'legendary-fallback',
            url: `/ui/items/procedural/v1/${base.id}/legendary/_fallback.webp`,
          });
        }
      }
    }
    expect(compatibleCount).toBe(21);
    expect(incompatibleCount).toBe(387);
  });

  it('fails malformed Legendary states closed to the requested base fallback', () => {
    const baseId = 'gravecaller_cloth_hood';
    const fallback = {
      cacheKey: `pli|v1|${baseId}|legendary|fallback`,
      state: 'legendary-fallback',
      url: `/ui/items/procedural/v1/${baseId}/legendary/_fallback.webp`,
    };
    expect(
      resolveProceduralItemIcon(
        baseId,
        presentationInstance(baseId, 'legendary', 'not_a_power', 1),
      ),
    ).toEqual(fallback);
    expect(
      resolveProceduralItemIcon(
        baseId,
        presentationInstance(baseId, 'legendary', 'crown_last_pyre'),
      ),
    ).toEqual(fallback);
    expect(
      resolveProceduralItemIcon(
        baseId,
        presentationInstance(baseId, 'legendary', 'crown_last_pyre', 2),
      ),
    ).toEqual(fallback);
    expect(
      resolveProceduralItemIcon(
        baseId,
        presentationInstance('iron_broadsword', 'legendary', 'greyjaws_edge', 1),
      ),
    ).toEqual(fallback);
  });

  it('ignores stray power fields on non-Legendary items and reserves Mythic for later', () => {
    expect(
      resolveProceduralItemIcon(
        'gravecaller_cloth_hood',
        presentationInstance('gravecaller_cloth_hood', 'rare', 'crown_last_pyre', 1),
      ),
    ).toEqual({
      cacheKey: 'pli|v1|gravecaller_cloth_hood|rare|none',
      state: 'rarity',
      url: '/ui/items/procedural/v1/gravecaller_cloth_hood/rare.webp',
    });
    expect(
      resolveProceduralItemIcon(
        'gravecaller_cloth_hood',
        presentationInstance('gravecaller_cloth_hood', 'mythic'),
      ),
    ).toEqual({
      cacheKey: 'pli|v1|gravecaller_cloth_hood|legacy',
      state: 'legacy',
      url: '/ui/items/gravecaller_cloth_hood.webp',
    });
  });

  it('derives cache identity only from stable visual content fields', () => {
    const first = resolveProceduralItemIcon(
      'gravecaller_cloth_hood',
      persistedLegendaryInstance('first_secret', 29),
    );
    const second = resolveProceduralItemIcon(
      'gravecaller_cloth_hood',
      persistedLegendaryInstance('second_secret', 34),
    );
    expect(first).toEqual(second);
    expect(first?.cacheKey).toBe('pli|v1|gravecaller_cloth_hood|legendary|crown_last_pyre|r1');
    expect(first?.cacheKey).not.toMatch(
      /pi1|secret|seed|uid|affix|family|name|potency|roll|29|34/i,
    );
  });
});

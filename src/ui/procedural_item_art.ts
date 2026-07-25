import {
  proceduralLegendaryPower,
  proceduralLegendaryPowerCompatibleWithBase,
} from '../sim/content/procedural_legendary_powers';
import { PROCEDURAL_ITEM_BASES } from '../sim/content/procedural_loot';
import type { ItemPresentationInstance } from './procedural_item_presentation';

export const PROCEDURAL_ICON_RARITIES = ['common', 'magic', 'rare', 'epic', 'legendary'] as const;

export type ProceduralIconRarity = (typeof PROCEDURAL_ICON_RARITIES)[number];

export const PROCEDURAL_ICON_ROOT = '/ui/items/procedural/v1';

export type ProceduralItemIconState = 'legacy' | 'rarity' | 'legendary' | 'legendary-fallback';

export interface ProceduralItemIconResolution {
  cacheKey: string;
  state: ProceduralItemIconState;
  url: string;
}

function isActiveRarity(value: string): value is ProceduralIconRarity {
  return (PROCEDURAL_ICON_RARITIES as readonly string[]).includes(value);
}

function legacyIcon(baseId: string): ProceduralItemIconResolution {
  return {
    cacheKey: `pli|v1|${baseId}|legacy`,
    state: 'legacy',
    url: `/ui/items/${baseId}.webp`,
  };
}

function legendaryFallback(baseId: string): ProceduralItemIconResolution {
  return {
    cacheKey: `pli|v1|${baseId}|legendary|fallback`,
    state: 'legendary-fallback',
    url: `${PROCEDURAL_ICON_ROOT}/${baseId}/legendary/_fallback.webp`,
  };
}

/**
 * Resolve one static WebP for a procedural item presentation state.
 *
 * Only stable visual content fields participate in the cache identity. Per-copy UID, seed,
 * affixes, generated name fragments, and roll magnitudes deliberately cannot change the URL.
 */
export function resolveProceduralItemIcon(
  itemId: string,
  instance?: ItemPresentationInstance,
): ProceduralItemIconResolution | null {
  const base = PROCEDURAL_ITEM_BASES[itemId];
  if (!base) return null;

  const legacy = legacyIcon(base.id);
  const procedural = instance?.procedural;
  if (!procedural) return legacy;

  const rarity = procedural.rarity;
  if (!isActiveRarity(rarity)) return legacy;
  if (procedural.baseId !== base.id) {
    return rarity === 'legendary' ? legendaryFallback(base.id) : legacy;
  }

  if (rarity !== 'legendary') {
    return {
      cacheKey: `pli|v1|${base.id}|${rarity}|none`,
      state: 'rarity',
      url: `${PROCEDURAL_ICON_ROOT}/${base.id}/${rarity}.webp`,
    };
  }

  const fallback = legendaryFallback(base.id);
  const powerId = procedural.legendaryPowerId;
  const powerRevision = procedural.powerRevision;
  if (!powerId || powerRevision === undefined) return fallback;

  const power = proceduralLegendaryPower(powerId);
  if (
    !power ||
    power.revision !== powerRevision ||
    !proceduralLegendaryPowerCompatibleWithBase(power, base)
  ) {
    return fallback;
  }

  return {
    cacheKey: `pli|v1|${base.id}|legendary|${power.id}|r${power.revision}`,
    state: 'legendary',
    url: `${PROCEDURAL_ICON_ROOT}/${base.id}/legendary/` + `${power.id}.r${power.revision}.webp`,
  };
}

/** Resolve the reusable neutral preview for a static item definition. */
export function proceduralItemVisualId(itemId: string): string {
  return PROCEDURAL_ITEM_BASES[itemId]?.visualItemId ?? itemId;
}

/**
 * Resolve the 3D weapon variant authored for a procedural base item.
 *
 * Non-weapons and non-procedural ids return undefined. Rarity and legendary power never
 * change weapon gameplay or the held model; they only change the inventory presentation.
 */
export function proceduralItemWeaponVisualId(itemId: string): string | undefined {
  return PROCEDURAL_ITEM_BASES[itemId]?.weaponVisualId;
}

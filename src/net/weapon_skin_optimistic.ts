// The optimistic half of ClientWorld.changeWeaponSkin: what the own player
// entity should show the instant the player applies or detaches a Season 1
// Armory skin, before the identity wire confirms it. Pure and DOM-free so the
// resolution is unit-testable (tests/weapon_skin_optimistic.test.ts); online.ts
// stays a thin consumer that mutates the entity and sends the command.
import { resolveActiveWeaponSkin, withWeaponSkinApplied } from '../sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../sim/content/weapon_skins';
import type { SkinCatalog, WeaponSkinLoadout, WeaponSkinType } from '../sim/types';

export interface WeaponSkinOptimisticInput {
  templateId: string;
  mainhandItemId: string | null;
  weaponSkinLoadout: WeaponSkinLoadout;
  skinCatalog?: SkinCatalog;
}

export interface WeaponSkinOptimisticResult {
  /** The weapon type the change addresses (the skin's own, or the detach's). */
  type: WeaponSkinType;
  loadout: WeaponSkinLoadout;
  /** The resolved render-only skin for the equipped mainhand after the change. */
  weaponSkinId: string | null;
  /** The account-cosmetics mirror of `loadout` (string values only). */
  loadoutRecord: Record<string, string>;
}

/** Null when the request is malformed (unknown skin, a detach with no type, or
 *  a skin that cannot apply onto the current loadout): the caller sends nothing. */
export function optimisticWeaponSkinChange(
  p: WeaponSkinOptimisticInput,
  skinId: string | null,
  weaponType?: WeaponSkinType,
): WeaponSkinOptimisticResult | null {
  const def = skinId ? WEAPON_SKINS[skinId] : null;
  if (skinId !== null && !def) return null;
  const type = def ? def.weaponType : weaponType;
  if (!type) return null;
  let loadout: WeaponSkinLoadout;
  if (def) {
    const applied = withWeaponSkinApplied(p.weaponSkinLoadout, def.id);
    if (!applied) return null;
    loadout = applied;
  } else {
    loadout = { ...p.weaponSkinLoadout };
    delete loadout[type];
  }
  const loadoutRecord: Record<string, string> = {};
  for (const [t, id] of Object.entries(loadout)) if (id) loadoutRecord[t] = id;
  return {
    type,
    loadout,
    weaponSkinId: resolveActiveWeaponSkin(
      p.templateId,
      p.mainhandItemId,
      loadout,
      p.skinCatalog ?? 'class',
    ),
    loadoutRecord,
  };
}

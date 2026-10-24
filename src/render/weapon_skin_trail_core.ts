// Swing trails carried by a weapon SKIN (the Season 1 Armory's per-skin look, plus the earned
// ones): a ribbon traced by the blade's tip through every melee swing the wearer makes,
// auto-attack and ability alike. Today Lantern Hall's blade (a lantern-fire streak) and the four
// elemental arms (reserved for a future raid) carry one; a skin without a row here swings exactly
// as before.
//
// Pure and Three-free: the decision (does this swing trail, in what colour, how wide, how
// long) is a table lookup a Vitest pins (tests/weapon_skin_trail.test.ts). The ribbon itself
// is the ability VFX's existing tracked-path ribbon (ability_vfx/fx.ts weaponTrail), the one
// the warrior's physical abilities already draw, so this adds no material, program or pool.
// Cosmetic only: a trail is not information a player acts on.

import { WEAPON_SKINS } from '../sim/content/weapon_skins';

export interface WeaponSkinTrailSpec {
  /** Ribbon colour (sRGB hex). */
  color: number;
  /** Ribbon width in world units. */
  width: number;
  /** Seconds the ribbon takes to fade. */
  duration: number;
}

/** Per skin MODEL (the same key the weapon VFX spec map uses, src/render/weapon_vfx.ts). */
export const WEAPON_SKIN_TRAILS: Readonly<Record<string, WeaponSkinTrailSpec>> = {
  // a streak of lantern-fire, wide and warm, gone in a third of a second
  lantern_hall_sword: { color: 0xff9a3c, width: 0.34, duration: 0.32 },
  // the elemental arms (reserved for a future raid), each swing streaking its element:
  // forge-fire, storm light, frost and dusk-violet
  hearthbrand: { color: 0xff6a1e, width: 0.4, duration: 0.36 },
  squallcrest: { color: 0x5fd0ff, width: 0.4, duration: 0.36 },
  rimelight_staff: { color: 0x9fe4ff, width: 0.36, duration: 0.34 },
  duskwick_staff: { color: 0x9a50ff, width: 0.36, duration: 0.34 },
};

/** The trail a swing with this skin draws, or null (no skin, an unknown skin, a skin without a
 *  trail, or a wand's bolt, which is a cast and not a swing). */
export function weaponSkinSwingTrail(
  skinId: string | null | undefined,
  kind?: 'melee' | 'wand',
): WeaponSkinTrailSpec | null {
  if (!skinId || kind === 'wand') return null;
  const skin = Object.hasOwn(WEAPON_SKINS, skinId) ? WEAPON_SKINS[skinId] : undefined;
  if (!skin) return null;
  return Object.hasOwn(WEAPON_SKIN_TRAILS, skin.model) ? WEAPON_SKIN_TRAILS[skin.model] : null;
}

/** The ribbon sink (ability_vfx/fx.ts AbilityVfxFx satisfies it). */
export interface WeaponTrailSink {
  weaponTrail(id: number, hand: 0 | 1, color: number, width: number, duration: number): void;
}

/** Draw the swing's skin trail off the main hand, if the wearer's skin carries one. */
export function playSkinSwingTrail(
  sink: WeaponTrailSink,
  entityId: number,
  entity: { readonly weaponSkinId?: string | null } | undefined,
  kind?: 'melee' | 'wand',
): void {
  const trail = weaponSkinSwingTrail(entity?.weaponSkinId, kind);
  if (trail) sink.weaponTrail(entityId, 0, trail.color, trail.width, trail.duration);
}

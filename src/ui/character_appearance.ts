import { hasArmoredBody } from '../render/characters/manifest';
import { canWearArmorSet, MECH_CHROMAS, SKIN_COUNTS } from '../sim/content/skins';
import type { PlayerClass, SkinCatalog } from '../sim/types';

export type CharacterAppearanceOption =
  | { kind: 'class'; label: number; skin: number }
  | { kind: 'mech'; label: number; skin: number; chromaId: string };

export interface ActiveCharacterAppearancePreview {
  skin: number;
  visualKey: string;
}

/**
 * The numbered appearance swatches a character sheet offers: the class chromas
 * plus any unlocked Combat Mech chromas.
 *
 * The level-20 armor set is deliberately NOT one of these. It is a toggle
 * (`offersArmorSet`), worn over whichever chroma is selected, so giving it a
 * swatch number would consume a chroma label and make "selected chroma" and
 * "wearing armor" mutually exclusive when they are independent.
 */
export function characterAppearanceOptions(
  cls: PlayerClass,
  unlockedMechChromaIds: readonly string[],
): CharacterAppearanceOption[] {
  const classCount = SKIN_COUNTS[cls];
  const unlockedMechs = new Set(unlockedMechChromaIds);
  const classOptions = Array.from({ length: classCount }, (_, skin) => ({
    kind: 'class' as const,
    label: skin + 1,
    skin,
  }));
  const mechOptions = MECH_CHROMAS.map((chroma, skin) => ({ chroma, skin }))
    .filter(({ chroma }) => unlockedMechs.has(chroma.id))
    .map(({ chroma, skin }, index) => ({
      kind: 'mech' as const,
      label: classCount + index + 1,
      skin,
      chromaId: chroma.id,
    }));
  return [...classOptions, ...mechOptions];
}

/**
 * Whether the character sheet shows the level-20 armor-set toggle: the class must
 * ship an armored body AND the character must have reached the unlock level.
 *
 * Presentation only. `Sim.setPlayerSkin` is what refuses an early equip, because a
 * client cannot be trusted to gate itself.
 */
export function offersArmorSet(cls: PlayerClass, level: number): boolean {
  return canWearArmorSet(level) && hasArmoredBody(cls);
}

/** The committed icon for a class's level-20 armor set (`public/ui/armor-sets/`). */
export function armorSetIconUrl(cls: PlayerClass): string {
  return `/ui/armor-sets/${cls}.webp`;
}

export function activeCharacterAppearancePreview(
  cls: PlayerClass,
  skin: number,
  catalog: SkinCatalog,
): ActiveCharacterAppearancePreview {
  return {
    skin: Math.max(0, Math.floor(skin)),
    visualKey:
      catalog === 'mech'
        ? 'player_mech'
        : catalog === 'armored'
          ? `player_${cls}_armored`
          : `player_${cls}`,
  };
}

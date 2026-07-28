import { MECH_CHROMAS, SKIN_COUNTS } from '../sim/content/skins';
import type { PlayerClass, SkinCatalog } from '../sim/types';

export type CharacterAppearanceOption =
  | { kind: 'class'; label: number; skin: number }
  | { kind: 'mech'; label: number; skin: number; chromaId: string }
  | { kind: 'armored'; label: number; skin: number };

export interface ActiveCharacterAppearancePreview {
  skin: number;
  visualKey: string;
}

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

  // The level-20 armored look: a single always-available cosmetic body (no
  // unlock gate and no chroma set of its own yet, so skin 0). Kept last so the
  // class/mech option labels stay stable.
  const armoredOption = {
    kind: 'armored' as const,
    label: classCount + mechOptions.length + 1,
    skin: 0,
  };

  return [...classOptions, ...mechOptions, armoredOption];
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

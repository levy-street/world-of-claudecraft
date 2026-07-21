import type { PlayerClass, SkinCatalog } from '../sim/types';
import { MECH_CHROMAS, SKIN_COUNTS } from '../sim/content/skins';

export type CharacterAppearanceOption =
  | { kind: 'class'; label: number; skin: number }
  | { kind: 'mech'; label: number; skin: number; chromaId: string };

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
  const mechOptions = MECH_CHROMAS
    .map((chroma, skin) => ({ chroma, skin }))
    .filter(({ chroma }) => unlockedMechs.has(chroma.id))
    .map(({ chroma, skin }, index) => ({
      kind: 'mech' as const,
      label: classCount + index + 1,
      skin,
      chromaId: chroma.id,
    }));

  return [...classOptions, ...mechOptions];
}

export function activeCharacterAppearancePreview(
  cls: PlayerClass,
  skin: number,
  catalog: SkinCatalog,
): ActiveCharacterAppearancePreview {
  return {
    skin: Math.max(0, Math.floor(skin)),
    visualKey: catalog === 'mech' ? 'player_mech' : `player_${cls}`,
  };
}

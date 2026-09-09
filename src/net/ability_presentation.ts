// Client-only reconstruction of the server's talent and ability presentation.
import { abilitiesKnownAt } from '../sim/content/classes';
import {
  emptyAllocation,
  repairAllocation,
  type SavedLoadout,
  type TalentAllocation,
} from '../sim/content/talents';
import { computeCharacterModifiers } from '../sim/set_bonus_mods';
import { mergeAugmentMods } from '../sim/social/fiesta';
import { parseTalentAllocation } from '../sim/talent_allocation_input';
import { repairTalentLoadouts } from '../sim/talent_loadouts';
import type { EquipSlot, PlayerClass } from '../sim/types';

interface PresentationState {
  talents: TalentAllocation;
  loadouts: SavedLoadout[];
  activeLoadout: number;
  equipment: Partial<Record<EquipSlot, string>>;
  questsDone: Set<string>;
}
interface TalentWire {
  alloc?: unknown;
  loadouts?: unknown;
  activeLoadout?: unknown;
}

export function buildClientAbilityPresentation(
  cls: PlayerClass,
  level: number,
  current: PresentationState,
  wire: TalentWire | null | undefined,
  augments: string[],
) {
  let { talents, loadouts, activeLoadout } = current;
  if (wire) {
    const parsed = parseTalentAllocation(wire.alloc);
    if (parsed) {
      talents = repairAllocation(cls, parsed, level);
      ({ loadouts, activeLoadout } = repairTalentLoadouts(
        cls,
        level,
        wire.loadouts,
        wire.activeLoadout,
      ));
    }
  }
  talents ??= emptyAllocation();
  const base = computeCharacterModifiers(cls, talents, level, current.equipment);
  const mods = augments.length ? mergeAugmentMods(base, augments) : base;
  return {
    talents,
    loadouts,
    activeLoadout,
    mods,
    known: abilitiesKnownAt(cls, level, mods, current.questsDone),
  };
}

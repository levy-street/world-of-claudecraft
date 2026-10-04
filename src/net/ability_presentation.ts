// Client-only reconstruction of the server's talent and ability presentation.
import { abilitiesKnownAt } from '../sim/content/classes';
import {
  emptyAllocation,
  repairAllocation,
  type SavedLoadout,
  type TalentAllocation,
} from '../sim/content/talents';
import { morthenKitKnown } from '../sim/graveyard_shift/kit';
import { hasMorthenIdentity } from '../sim/graveyard_shift/morthen_identity';
import { computeCharacterModifiers } from '../sim/set_bonus_mods';
import { mergeAugmentMods } from '../sim/social/fiesta';
import { parseTalentAllocation } from '../sim/talent_allocation_input';
import { repairTalentLoadouts } from '../sim/talent_loadouts';
import type { Entity, EquipSlot, PlayerClass } from '../sim/types';

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
  self: Pick<Entity, 'level' | 'auras'>,
  current: PresentationState,
  wire: TalentWire | null | undefined,
  augments: string[],
) {
  const { level } = self;
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
    // The same known-list rule as the sim (graveyard_shift knownAbilitiesFor):
    // while the player covers Morthen's shift, the kit is all they know.
    known: hasMorthenIdentity(self)
      ? morthenKitKnown()
      : abilitiesKnownAt(cls, level, mods, current.questsDone),
  };
}

/** ClientWorld.actionBarReadOnly, in step with the offline Sim: no bar writer
 *  runs while spectating, or while Morthen's kit stands in for the bar. */
export function clientActionBarReadOnly(
  spectating: string | null,
  spectateFacingPending: boolean | undefined,
  player: Pick<Entity, 'auras'>,
): boolean {
  return spectating !== null || spectateFacingPending === true || hasMorthenIdentity(player);
}

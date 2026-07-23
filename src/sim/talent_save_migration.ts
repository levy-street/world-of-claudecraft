import { ABILITIES, abilitiesKnownAt } from './content/classes';
import {
  computeTalentModifiers,
  repairAllocation,
  SAVED_LOADOUT_BAR_SLOTS,
  type SavedLoadout,
  type TalentAllocation,
} from './content/talents';
import type { CharacterState } from './sim';
import { repairTalentLoadouts } from './talent_loadouts';
import { MAX_LEVEL, type PlayerClass } from './types';

/** Production character-JSON revision introduced by the v0.26 Talents V2 rollout. */
export const CURRENT_CHARACTER_CONTENT_REVISION = 1;

function migrationLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_LEVEL, Math.trunc(value)));
}

function isMainBarAbility(cls: PlayerClass, abilityId: string): boolean {
  const ability = ABILITIES[abilityId];
  return (
    ability?.class === cls &&
    ability.passive !== true &&
    ability.exclusiveGroup !== 'warrior_stance'
  );
}

function canSeedOnMainBar(cls: PlayerClass, abilityId: string): boolean {
  const ability = ABILITIES[abilityId];
  return (
    isMainBarAbility(cls, abilityId) &&
    ability?.requiresForm === undefined &&
    ability?.requiresStealth !== true
  );
}

/**
 * Keep valid positions, drop obsolete/duplicate/passive entries, then fill empty
 * slots with deterministic baseline/spec actives. Computing seed candidates with
 * an empty row map prevents unselected row grants from leaking onto the bar.
 */
function migrateLoadoutBar(
  cls: PlayerClass,
  level: number,
  allocation: TalentAllocation,
  value: readonly (string | null)[],
): (string | null)[] {
  const fullMods = computeTalentModifiers(cls, allocation, level);
  const known = new Set(abilitiesKnownAt(cls, level, fullMods).map((entry) => entry.def.id));
  const seen = new Set<string>();
  const bar = Array.from({ length: SAVED_LOADOUT_BAR_SLOTS }, (_, index) => {
    const abilityId = value[index];
    if (
      typeof abilityId !== 'string' ||
      !known.has(abilityId) ||
      !isMainBarAbility(cls, abilityId) ||
      seen.has(abilityId)
    ) {
      return null;
    }
    seen.add(abilityId);
    return abilityId;
  });

  const specOnly = computeTalentModifiers(cls, { spec: allocation.spec, rows: {} }, level);
  const seedIds = abilitiesKnownAt(cls, level, specOnly)
    .map((entry) => entry.def.id)
    .filter((abilityId) => canSeedOnMainBar(cls, abilityId));
  for (const abilityId of seedIds) {
    if (seen.has(abilityId)) continue;
    const empty = bar.indexOf(null);
    if (empty < 0) break;
    bar[empty] = abilityId;
    seen.add(abilityId);
  }
  return bar;
}

function migrateLoadouts(
  cls: PlayerClass,
  level: number,
  value: unknown,
  activeValue: unknown,
): { loadouts: SavedLoadout[]; activeLoadout: number } {
  const repaired = repairTalentLoadouts(cls, level, value, activeValue);
  return {
    activeLoadout: repaired.activeLoadout,
    loadouts: repaired.loadouts.map((loadout) => ({
      name: loadout.name,
      alloc: loadout.alloc,
      bar: migrateLoadoutBar(cls, level, loadout.alloc, loadout.bar),
    })),
  };
}

/**
 * Pure one-way migration from production point-tree saves to canonical
 * `{spec, rows}`. Valid specialization identity survives; old ranks/choices have
 * no deterministic row mapping and become a free repick. All unrelated fields
 * are preserved. Reapplying the current revision is an identity operation.
 */
export function migrateCharacterTalentsV2(cls: PlayerClass, state: CharacterState): CharacterState {
  if (
    Number.isSafeInteger(state.contentRevision) &&
    (state.contentRevision as number) >= CURRENT_CHARACTER_CONTENT_REVISION
  ) {
    return state;
  }

  const level = migrationLevel(state.level);
  const talents = repairAllocation(cls, state.talents, level);
  const migratedLoadouts = migrateLoadouts(cls, level, state.loadouts, state.activeLoadout);
  return {
    ...state,
    contentRevision: CURRENT_CHARACTER_CONTENT_REVISION,
    talents,
    loadouts: migratedLoadouts.loadouts,
    activeLoadout: migratedLoadouts.activeLoadout,
  };
}

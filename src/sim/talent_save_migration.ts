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

const TALENTS_V2_CONTENT_REVISION = 1;

/**
 * Latest production character-JSON revision.
 *  1: the v0.26 Talents V2 rollout.
 *  2: the first v0.29 class redesigns (hunter, shaman, priest, rogue) on the
 *     class-wave line, AND the Warlock overhaul on its own line. The two lines
 *     assigned DIFFERENT meanings to 2, so a stored 2 is ambiguous across the
 *     merged fleet and cannot be trusted to mean either one.
 *  3: the v0.29 Druid redesign (class-wave line only).
 *  4: this composed wave. Because 2 and 3 are ambiguous, EVERY class redesigned
 *     anywhere in the wave re-qualifies for its free repick here.
 */
export const CURRENT_CHARACTER_CONTENT_REVISION = 4;

/**
 * The classes redesigned AT the current revision. Per-revision, NOT cumulative:
 * when your rework joins a revision someone else opened, ADD YOUR CLASS here
 * rather than assuming the marker bump covers you. Omitting a class is what
 * stranded retired ability ids on live Paladin bars once already.
 */
const REDESIGNED_AT_CURRENT_REVISION: ReadonlySet<PlayerClass> = new Set([
  'hunter',
  'shaman',
  'priest',
  'rogue',
  'paladin',
  'druid',
  'warlock',
]);

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
 * slots with deterministic baseline, specialization, and selected-row actives.
 * The repaired allocation is already authoritative, so its grants cannot leak
 * unselected row abilities onto the bar.
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

  const seedIds = abilitiesKnownAt(cls, level, fullMods)
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
  freeRepick: boolean,
): { loadouts: SavedLoadout[]; activeLoadout: number } {
  const repaired = repairTalentLoadouts(cls, level, value, activeValue);
  return {
    activeLoadout: repaired.activeLoadout,
    loadouts: repaired.loadouts.map((loadout) => {
      const alloc = freeRepick ? { spec: loadout.alloc.spec, rows: {} } : loadout.alloc;
      return {
        name: loadout.name,
        alloc,
        bar: migrateLoadoutBar(cls, level, alloc, loadout.bar),
      };
    }),
  };
}

/**
 * Pure one-way content migration. Revision 1 converted production point-tree
 * saves to canonical `{spec, rows}`. Revision 2 grants Hunters a free row repick.
 * Revision 3 does the same for Druids and scrubs retired row grants from bars.
 * Reapplying the current revision is an identity operation.
 */
export function migrateCharacterTalentsV2(cls: PlayerClass, state: CharacterState): CharacterState {
  const revision = Number.isSafeInteger(state.contentRevision)
    ? (state.contentRevision as number)
    : 0;
  if (revision >= CURRENT_CHARACTER_CONTENT_REVISION) return state;

  // The free repick / row wipe is GATED: refilling slots would disturb a bar an
  // untouched player deliberately left gapped, and a redesigned class needs its
  // picks re-chosen because row ids were reused with changed meaning.
  const freeRepick =
    revision < TALENTS_V2_CONTENT_REVISION || REDESIGNED_AT_CURRENT_REVISION.has(cls);

  // UNIVERSAL SCRUB: migrateLoadouts runs for EVERY class, always. A slot naming
  // an ability the character cannot use is dead whoever owns it, and nothing
  // downstream catches it (talent_loadouts.repairBar only checks that a slot is
  // a string, so a retired id survives every load). Only the repick/re-seed
  // above is gated.
  const level = migrationLevel(state.level);
  const repairedTalents = repairAllocation(cls, state.talents, level);
  const talents = freeRepick ? { spec: repairedTalents.spec, rows: {} } : repairedTalents;
  const migratedLoadouts = migrateLoadouts(
    cls,
    level,
    state.loadouts,
    state.activeLoadout,
    freeRepick,
  );
  return {
    ...state,
    contentRevision: CURRENT_CHARACTER_CONTENT_REVISION,
    talents,
    loadouts: migratedLoadouts.loadouts,
    activeLoadout: migratedLoadouts.activeLoadout,
  };
}

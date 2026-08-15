// R35 GM professions inspector: normalize a character's persisted-state blob
// (or a live serializeCharacter snapshot, the same CharacterState shape) into
// the admin dashboard's professions read. PURE, no SQL, no IO, the
// character_sheet.ts pattern, so the shaping is unit-testable without a pool.
//
// Reads run through the LOADER'S OWN per-field normalizers
// (normalizeGatheringProficiency / normalizeCraftSkills /
// normalizeToolEffectSlots), so what the operator sees is what the next login
// resolves field-by-field: the legacy `professions` dual-key fallback, the
// clamps, the retired/refused slot drops, and the confirmMode coercion all
// match by construction. The ONE-SHOT load migrations (mastery reset, the
// proficiency display heal, the recipe grandfather union) are load-path code
// this read cannot replay, so a stored blob written before them is MARKED
// (`preMigration`) instead: the modal warns that those values will be
// rewritten at the character's next login. Node timers pass through as the
// persisted remaining-second deltas (anchored at save time for a blob, at
// serialize time for a live snapshot; the `live` flag tells the operator
// which clock they are reading), clamped to each live node's respawnSeconds
// the way applyNodeReadiness clamps on load.

import { CRAFT_RING, GATHERING_PROFESSION_IDS, TOOL_EFFECTS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { normalizeArchetypeState } from '../src/sim/professions/archetype';
import {
  gatherNodeById,
  NODE_HARVEST_TABLE,
  normalizeGatheringProficiency,
} from '../src/sim/professions/gathering';
import { normalizeToolEffectSlots, slotToolEffectRefused } from '../src/sim/professions/tools';
import { normalizeCraftSkills, tierForSkill } from '../src/sim/professions/wheel';
import type { CharacterState } from '../src/sim/sim';
import type { AdminCharacterProfessionsRow } from './admin_db';

export interface ProfessionsGatheringRow {
  professionId: string;
  proficiency: number;
}

export interface ProfessionsCraftRow {
  craftId: string;
  skill: number;
  tier: number;
}

export interface ProfessionsSlotRow {
  professionId: string;
  effectId: string;
  durability: number;
  maxDurability: number;
  // Signer provenance (server-only in the game wire; operators are staff and
  // need it to judge a restore, so the admin read carries it).
  craftedBy: string | null;
  confirmMode: string;
}

export interface ProfessionsNodeTimerRow {
  nodeId: string;
  // Enrichment from live content; null when the saved node id no longer
  // resolves (a retired node: the load-side filter will drop it anyway).
  zoneId: string | null;
  nodeType: string | null;
  remainingSeconds: number;
}

export interface CharacterProfessionsSheet {
  characterId: number;
  name: string;
  class: string;
  level: number;
  accountId: number;
  username: string;
  // True when the state came from a live serializeCharacter snapshot rather
  // than the stored blob (which lags the 30s autosave for an online player).
  live: boolean;
  // The blob's save time; null for a live snapshot (it is "now").
  updatedAt: string | null;
  // True when a STORED blob predates one of the one-shot load migrations
  // (mastery reset, proficiency display heal, recipe grandfather union):
  // the skills and recipe count shown will be REWRITTEN at the character's
  // next login, so the operator must not judge a restore off them. Every
  // curve-era save writes the three flags as literal true, so this is
  // precise, and a live snapshot is never pre-migration.
  preMigration: boolean;
  archetype: {
    activeArchetype: string | null;
    pairedMajor: string | null;
    hobbyCraft: string | null;
  };
  gathering: ProfessionsGatheringRow[];
  crafting: ProfessionsCraftRow[];
  knownRecipes: number;
  slots: ProfessionsSlotRow[];
  nodeTimers: ProfessionsNodeTimerRow[];
  // The live tool-effect vocabulary, server-authored so the restore-slot
  // select renders data instead of a client-side mirror that could drift.
  toolEffectIds: string[];
}

export interface CharacterProfessionsInput {
  characterId: number;
  name: string;
  class: string;
  level: number;
  accountId: number;
  username: string;
  state: CharacterState;
  live: boolean;
  updatedAt: string | null;
  // True when there was no stored blob at all (a created-but-never-entered
  // character): the one-shot migrations never apply to the CONSTRUCTION path
  // a first login takes, so the preMigration warning must not fire.
  emptyBlob?: boolean;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    value != null &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}

export function characterProfessionsSheet(
  input: CharacterProfessionsInput,
): CharacterProfessionsSheet {
  const { state } = input;
  // The loader's own per-field normalizers, so the sheet shows exactly what
  // the next login resolves: the legacy `professions` dual-key fallback, the
  // [0, maxSkill] clamps, and 0 defaults for every absent profession.
  const gatheringMap = normalizeGatheringProficiency(
    state.gatheringProficiency ?? state.professions,
  );
  const gathering = GATHERING_PROFESSION_IDS.map((professionId) => ({
    professionId,
    proficiency: gatheringMap[professionId],
  }));
  const craftSkills = normalizeCraftSkills(state.craftSkills ?? null);
  const crafting = CRAFT_RING.map((craft) => {
    const skill = craftSkills[craft.id];
    return { craftId: craft.id, skill, tier: tierForSkill(skill) };
  });
  // normalizeToolEffectSlots applies the load rules a raw read would miss:
  // retired effects and refused pairs DROP (a row minted before the policy
  // must not render as a live slot a GM then declines to restore), durability
  // clamps, and the legacy confirmMode coercion (absent reads 'always').
  const slots: ProfessionsSlotRow[] = Object.entries(
    normalizeToolEffectSlots(state.toolEffectSlots) ?? {},
  ).flatMap(([professionId, slot]) =>
    slot
      ? [
          {
            professionId,
            effectId: slot.effectId,
            durability: slot.durability,
            maxDurability: slot.maxDurability,
            craftedBy: slot.craftedBy ?? null,
            confirmMode: slot.confirmMode,
          },
        ]
      : [],
  );
  const nodeTimers = Object.entries(state.nodeHarvestCooldowns ?? {})
    // The loader's positive() rule: a non-positive or non-finite remaining is
    // garbage the login drops, and Math.min(NaN, cap) would render NaN.
    .filter(([, remainingSeconds]) => Number.isFinite(remainingSeconds) && remainingSeconds > 0)
    .map(([nodeId, remainingSeconds]) => {
      const node = gatherNodeById(nodeId);
      return {
        nodeId,
        zoneId: node?.zoneId ?? null,
        nodeType: node?.type ?? null,
        // Two of the loader's three rules apply here (the positive filter
        // above and this respawnSeconds clamp); the third, dropping RETIRED
        // node ids, is deliberately NOT applied: the operator should see the
        // row existed (null zone/type marks it), even though the next login
        // discards it.
        remainingSeconds: node
          ? Math.min(remainingSeconds, NODE_HARVEST_TABLE[node.type].respawnSeconds)
          : remainingSeconds,
      };
    })
    .sort((a, b) => b.remainingSeconds - a.remainingSeconds || a.nodeId.localeCompare(b.nodeId));
  // The loader's archetype normalizer, with the craftSkills computed above
  // as its repair input (the same pre-mastery-reset map the loader passes at
  // the equivalent point in its own order): an invalid activeArchetype nulls
  // the trio, a non-adjacent pairedMajor is repaired to the default pair,
  // and a null hobby resolves to defaultHobbyForPair, so the operator sees
  // the trio the next login actually resolves rather than the raw blob.
  const archetype = normalizeArchetypeState(state.archetype, craftSkills);
  return {
    characterId: input.characterId,
    name: input.name,
    class: input.class,
    level: input.level,
    accountId: input.accountId,
    username: input.username,
    live: input.live,
    updatedAt: input.updatedAt,
    preMigration:
      !input.live &&
      input.emptyBlob !== true &&
      (state.masteryResetApplied !== true ||
        state.proficiencyDisplayHealApplied !== true ||
        state.recipesGrandfathered !== true),
    archetype: {
      activeArchetype: archetype.activeArchetype,
      pairedMajor: archetype.pairedMajor,
      hobbyCraft: archetype.hobbyCraft,
    },
    gathering,
    crafting,
    // The loader builds a Set (src/sim/sim.ts), so duplicate ids in a
    // hand-edited blob collapse at login; count the deduplicated size the
    // next login resolves, not the raw array length. Guarded on ITERABILITY
    // rather than Array.isArray so a corrupt non-iterable value renders 0
    // instead of throwing the whole sheet into a 500, which is exactly the
    // blob the operator opened the inspector to diagnose.
    //
    // The two readings agree on every ARRAY, which is every legal blob, and
    // diverge on a non-array iterable (a stored STRING is the only shape
    // that reaches here): sanitizeKnownRecipeIds drops such a value whole,
    // so the next login resolves ZERO while this row counts the string's
    // DISTINCT CHARACTERS, a garbage number that reads like a plausible
    // recipe count. Known divergence, kept because the sheet describes the
    // blob as stored; an operator diagnosing a recipe-less login against a
    // nonzero row here should suspect a corrupt non-array value, not trust
    // the number.
    knownRecipes: isIterable(state.knownRecipes) ? new Set(state.knownRecipes).size : 0,
    slots,
    nodeTimers,
    toolEffectIds: Object.keys(TOOL_EFFECTS),
  };
}

/** Shape one admin db row (plus an optional live serializeCharacter
 *  snapshot) into the sheet. The stored-blob cast lives HERE, beside the
 *  CharacterState type it asserts, so the admin handler never imports sim
 *  types; a live snapshot wins over the stored blob (it is fresher). */
export function characterProfessionsSheetFromRow(
  row: AdminCharacterProfessionsRow,
  liveState: CharacterState | null,
): CharacterProfessionsSheet {
  return characterProfessionsSheet({
    characterId: row.id,
    name: row.name,
    class: row.class,
    level: row.level,
    accountId: row.accountId,
    username: row.username,
    // characters.state is NULLABLE (a created-but-never-entered character
    // stores SQL NULL until its first save, and the admin list shows such
    // rows), so an empty object stands in: every field then reads its
    // documented default instead of throwing. Such a row is emptyBlob, not
    // pre-migration: first login takes the construction path, which the
    // one-shot migrations never touch.
    state: liveState ?? ((row.state ?? {}) as CharacterState),
    live: liveState !== null,
    updatedAt: liveState !== null ? null : row.updatedAt,
    // The liveState conjunct is DEFENSIVE, not load-bearing: emptyBlob only
    // feeds preMigration, which already short-circuits on live input, so the
    // conjunct changes no output today. It documents the undefined-vs-null
    // contract (a live caller suppresses the blob fetch, which must never
    // read as never-entered) and keeps the derivation honest if emptyBlob
    // ever gains a second reader.
    emptyBlob: liveState === null && row.state == null,
  });
}

/** The dev_give clamp applied to a GM item restore: a positive integer count,
 *  at most 20 per action (a larger restore is several audited actions). */
export const RESTORE_ITEM_MAX_COUNT = 20;

/** Validate a restore-item request body. Returns the English error prose
 *  (the admin error model, reverse-mapped client-side) or null when valid.
 *  Validation runs BEFORE the audit write, so a fat-fingered request never
 *  leaves an audit row for a grant that was never possible; the runtime
 *  re-checks everything defensively. */
export function restoreItemBodyError(body: { itemId?: unknown; count?: unknown }): string | null {
  if (
    typeof body.itemId !== 'string' ||
    body.itemId.length === 0 ||
    !Object.hasOwn(ITEMS, body.itemId)
  ) {
    return 'unknown item id';
  }
  const count = body.count;
  if (
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > RESTORE_ITEM_MAX_COUNT
  ) {
    return `count must be a whole number between 1 and ${RESTORE_ITEM_MAX_COUNT}`;
  }
  return null;
}

/** Validate a restore-slot request body, same contract as
 *  restoreItemBodyError: pre-audit refusal in English prose. The STATIC
 *  pair-validity policy is checked here too (co-owned with the sim action,
 *  which re-checks defensively); only runtime state (online, tool owned,
 *  already slotted) stays with the action. */
export function restoreSlotBodyError(body: {
  professionId?: unknown;
  effectId?: unknown;
}): string | null {
  if (
    typeof body.professionId !== 'string' ||
    !(GATHERING_PROFESSION_IDS as readonly string[]).includes(body.professionId)
  ) {
    return 'unknown gathering profession id';
  }
  if (typeof body.effectId !== 'string' || !Object.hasOwn(TOOL_EFFECTS, body.effectId)) {
    return 'unknown tool effect id';
  }
  // The static pair-validity policy (fishing takes no effect; respawnSpeed
  // effects are parked on every profession) is a pure content predicate, so
  // it belongs HERE, ahead of the audit write: without it, 6 of the 12 pairs
  // the admin modal offers were refusable only by the sim action, and each
  // attempt left a moderation audit row for a grant that was never possible.
  if (slotToolEffectRefused(body.professionId, body.effectId)) {
    return 'that effect cannot be slotted on that profession';
  }
  return null;
}

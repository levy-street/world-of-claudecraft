// Mutual-exclusion for self-buff groups (aspects, auras, shouts, and other
// "only one of these may be active" kits). Pure and host-agnostic so a Vitest can
// drive it directly without constructing a Sim. Form toggles are NOT handled here:
// they are excluded by aura kind in effect_dispatch, since their kinds are unique.

/** The minimal aura shape this rule needs: the id of the ability that applied it. */
export interface ExclusiveAuraLike {
  id: string;
}

/**
 * Indices of auras that belong to the SAME exclusive group as the ability being
 * cast but were applied by a DIFFERENT ability, so the caller can cancel them
 * before applying the new buff. Returned in DESCENDING order so the caller can
 * `splice` each index without reindexing the ones it has not handled yet.
 *
 * @param newGroup      the casting ability's `exclusiveGroup` (undefined = no group)
 * @param newAbilityId  the casting ability's id (a re-cast of the same buff is not a conflict)
 * @param auras         the entity's current auras
 * @param groupOf       resolves any ability id to its `exclusiveGroup`
 */
export function exclusiveAuraConflicts(
  newGroup: string | undefined,
  newAbilityId: string,
  auras: readonly ExclusiveAuraLike[],
  groupOf: (abilityId: string) => string | undefined,
): number[] {
  if (newGroup === undefined) return [];
  const out: number[] = [];
  // Walk backwards so the indices come out descending: the caller splices them
  // one at a time and the unprocessed ones never shift.
  for (let i = auras.length - 1; i >= 0; i--) {
    const a = auras[i];
    if (a.id === newAbilityId) continue;
    if (groupOf(a.id) === newGroup) out.push(i);
  }
  return out;
}

// Which auras a talent change orphans.
//
// A buff a talent's ability put up used to outlive the talent: channel
// Aetherwell, swap the capstone row to Rune of Power, fight with both (player
// report, v0.44). The talent recompute now strips every aura the player
// applied that the new build could not have produced:
//   1. an id only a DROPPED ability can produce: a granted ability that fell
//      out of the known list, or a talent rider (addEffects) that no longer
//      resolves onto a still-known one (Ghostfoot Ward's damage cut on the
//      baseline Ghostfoot);
//   2. a TIMED buff whose resolved shape changed: a talent that boosted a
//      baseline buff's value or duration (Enduring Protection on Ward of
//      Faith) no longer lets the boosted copy ride past the swap. Toggles
//      (forms, stances, permanent auras) are exempt: their value is re-read
//      from the live build, and stripping them would throw a druid out of
//      form over an unrelated row;
//   3. a companion id a system mints outside combat/aura_ids.ts as
//      `<abilityId>_<suffix>` (Thieves' Chorus's `_spell` haste, the
//      dispatcher's `_ap`/`_dmg`/`_crit` riders), attributed to the LONGEST
//      known ability id it extends, so `rune_of_power_x` never reads as
//      belonging to a hypothetical `rune`.
//
// The exact ids come from the dispatcher's own rules (combat/aura_ids.ts),
// applied to each known ability's RESOLVED effects, so a talent-added
// companion buff is named exactly as the cast named it. Abilities whose aura
// ids are unrelated constants in a bespoke system (Temporal Echo and its kin)
// keep their own teardown in talents.ts.
// Pure: no Sim, no Rng, no host.
import { absorbAuraId, buffTargetAuraId, selfBuffAuraId } from '../combat/aura_ids';
import { isWarriorStanceKind } from '../combat/warrior_stances';
import { type AbilityEffect, type Aura, isFormAuraKind } from '../types';

/** The slice of a known ability this reads: the def the dispatcher names ids
 *  from, and the resolved effects a cast runs. */
export interface AuraSourceAbility {
  def: { id: string; effects: readonly AbilityEffect[] };
  effects: readonly AbilityEffect[];
}

// Effect shapes that leave a HELPFUL aura whose value or duration a talent can
// bake (buffPct, durationFlat, the absorb/heal multipliers). Only these feed
// the shape signature, so a damage talent never strips a buff it never touched.
const BUFF_SHAPED_EFFECTS: ReadonlySet<string> = new Set([
  'selfBuff',
  'buffTarget',
  'absorb',
  'hot',
  'aoeAllyAbsorb',
  'aoeAllyAttackPower',
  'aoeAllyDamage',
  'aoeAllyHaste',
  'aoeAllyMaxHp',
  'aoeAllySureCrit',
  'absorbSpentResource',
  'finisherHaste',
  'imbue',
]);

/** Each aura id one resolved ability can leave, mapped to the signature of the
 *  buff-shaped effects that produce it ('' when none do). The bare id is always
 *  one: most effect shapes (heals over time, group absorbs, zones) apply under it. */
export function abilityAuraSignatures(ability: AuraSourceAbility): Map<string, string> {
  const parts = new Map<string, string[]>([[ability.def.id, []]]);
  let buffTargetIndex = 0;
  for (const eff of ability.effects) {
    let id: string;
    if (eff.type === 'selfBuff') id = selfBuffAuraId(ability.def, eff);
    else if (eff.type === 'absorb') id = absorbAuraId(ability.def, eff);
    else if (eff.type === 'buffTarget') {
      id = buffTargetAuraId(ability.def, eff, buffTargetIndex);
      buffTargetIndex += 1;
    } else if ('auraId' in eff && typeof eff.auraId === 'string') id = eff.auraId;
    else id = ability.def.id;
    const list = parts.get(id) ?? [];
    if (BUFF_SHAPED_EFFECTS.has(eff.type)) list.push(JSON.stringify(eff));
    parts.set(id, list);
  }
  return new Map([...parts].map(([id, list]) => [id, list.join('|')]));
}

/** Every aura id one resolved ability can leave. */
export function abilityAuraIds(ability: AuraSourceAbility): Set<string> {
  return new Set(abilityAuraSignatures(ability).keys());
}

function signaturesOf(known: readonly AuraSourceAbility[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const ability of known) {
    for (const [id, sig] of abilityAuraSignatures(ability)) {
      const prior = out.get(id);
      out.set(id, prior === undefined ? sig : `${prior}#${sig}`);
    }
  }
  return out;
}

/** Aura ids the previous known set could leave that the next one cannot (rule 1). */
export function orphanedAbilityAuraIds(
  previous: readonly AuraSourceAbility[],
  next: readonly AuraSourceAbility[],
): Set<string> {
  const kept = signaturesOf(next);
  const orphaned = new Set<string>();
  for (const id of signaturesOf(previous).keys()) if (!kept.has(id)) orphaned.add(id);
  return orphaned;
}

/** Ability ids the previous known set had and the next one lacks. */
export function droppedAbilityIds(
  previous: readonly AuraSourceAbility[],
  next: readonly AuraSourceAbility[],
): Set<string> {
  const nextIds = new Set(next.map((ability) => ability.def.id));
  return new Set(previous.map((ability) => ability.def.id).filter((id) => !nextIds.has(id)));
}

type OrphanCandidate = Pick<Aura, 'id' | 'kind'> & Partial<Pick<Aura, 'permanent'>>;

const LIVE_RECONCILED_BUFF_IDS = new Set([
  // Warlock Fiendhide is a long-lived class self-buff whose active armor and
  // magic reduction are refreshed by reconcileWarlockTalentState after a talent
  // swap; stripping it here loses the aura before that sync can run.
  'demon_skin',
]);

/** The whole orphan rule (see the header) as one predicate over an aura the
 *  swapping player applied. Returns null when the change orphans nothing. */
export function talentSwapOrphanMatcher(
  previous: readonly AuraSourceAbility[],
  next: readonly AuraSourceAbility[],
): ((aura: OrphanCandidate) => boolean) | null {
  const before = signaturesOf(previous);
  const after = signaturesOf(next);
  const dropped = droppedAbilityIds(previous, next);
  const reshaped = [...before].some(([id, sig]) => after.has(id) && after.get(id) !== sig);
  const orphanedIds = [...before.keys()].some((id) => !after.has(id));
  if (dropped.size === 0 && !reshaped && !orphanedIds) return null;
  // Longest id first, so the first prefix hit is the owning ability.
  const abilityIds = [...new Set([...previous, ...next].map((a) => a.def.id))].sort(
    (a, b) => b.length - a.length,
  );
  return (aura) => {
    const was = before.get(aura.id);
    const now = after.get(aura.id);
    if (was !== undefined) {
      if (now === undefined) return true;
      if (now === was) return false;
      const toggle = isFormAuraKind(aura.kind) || isWarriorStanceKind(aura.kind);
      if (LIVE_RECONCILED_BUFF_IDS.has(aura.id)) return false;
      return !toggle && aura.permanent !== true;
    }
    if (now !== undefined) return false;
    const owner = abilityIds.find((id) => aura.id.startsWith(`${id}_`));
    return owner !== undefined && dropped.has(owner);
  };
}

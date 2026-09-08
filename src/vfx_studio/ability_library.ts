import { replaceResolvedAbility } from '../sim/combat/action_replacement';
import { applyTalentMods } from '../sim/content/classes';
import type { ResolvedAbility, Sim } from '../sim/sim';
import type { ActionReplacementRule } from '../sim/types';

/** Inspect a selected payoff without changing the actor's active resource bank. */
export function studioAbilityInfo(sim: Sim, id: string): ResolvedAbility | null {
  const entry = studioAbilityLibrary(sim).get(id);
  if (!entry) return null;
  const current = sim.resolvedAbility(entry.base);
  if (current?.def.id === id) return current;
  const base = sim.known.find((known) => known.def.id === entry.base);
  if (!base) return null;
  if (entry.base === id) return base;
  const result = replaceResolvedAbility(base, id, sim.player.level);
  const meta = sim.players.get(sim.player.id);
  if (meta) applyTalentMods(result, sim.playerMods(meta));
  return result;
}

/** The learned action remains the authority; payoff entries point back to it. */
export function studioAbilityLibrary(
  sim: Sim,
): Map<string, { base: string; rule?: ActionReplacementRule }> {
  const result = new Map<string, { base: string; rule?: ActionReplacementRule }>();
  const spec = sim.players.get(sim.player.id)?.talents.spec;
  const owners: Record<string, string> = {
    redline: 'combat',
    venom_ritual: 'assassination',
    moontide: 'balance',
    old_blood: 'feral',
    verdance: 'restoration',
    hunter_ferocity: 'beast_mastery',
  };
  for (const { def } of sim.known) {
    result.set(def.id, { base: def.id });
    const rules = def.actionReplacement;
    for (const rule of rules ? (Array.isArray(rules) ? rules : [rules]) : []) {
      if (owners[rule.auraKind] && owners[rule.auraKind] !== spec) continue;
      result.set(rule.abilityId, { base: def.id, rule });
    }
  }
  if (sim.players.get(sim.player.id)?.talents.rows[17] === 'hun_r17_pack_rally')
    result.set('pack_rally', { base: 'aspect_of_the_cheetah' });
  return result;
}

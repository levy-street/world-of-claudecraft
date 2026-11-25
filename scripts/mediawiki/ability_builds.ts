import { applyAbilityCostTail, resolveAbilityChain } from '../../src/sim/combat/ability_resolution';
import { abilitiesKnownAt } from '../../src/sim/content/classes';
import { computeTalentModifiers, TALENTS } from '../../src/sim/content/talents';
import { CLASSES, QUESTS } from '../../src/sim/data';
import { createPlayer } from '../../src/sim/entity';
import type { ResolvedAbility } from '../../src/sim/resolved_ability';
import { type AbilityDef, MAX_LEVEL, type PlayerClass } from '../../src/sim/types';
import { wikiAbilityText } from './ability_description';

export function referenceAbility(def: AbilityDef): ResolvedAbility {
  return {
    def,
    rank: 1,
    cost: def.cost,
    castTime: def.castTime,
    cooldown: def.cooldown,
    effects: def.effects,
    threatFlat: def.threat?.flat ?? 0,
    threatMult: def.threat?.mult ?? 1,
    charges: def.maxCharges,
  };
}

const zero = { spellPower: 0, attackPower: 0, healPower: 0, rangedPower: 0 };
const sample = { spellPower: 100, attackPower: 100, healPower: 100, rangedPower: 100 };
const completedQuests = new Set(Object.keys(QUESTS));
// This is a publication snapshot. Ask the same two resolve stages as the HUD
// instead of approximating spec-specific transformations or talent baking.
function resolveClass(cls: PlayerClass) {
  const entries: { spec: string; name: string; abilities: Map<string, ResolvedAbility> }[] = [];
  const actor = createPlayer(1, cls, { x: 0, y: 0, z: 0 }, 'Wiki');
  actor.level = MAX_LEVEL;
  for (const spec of TALENTS[cls].specs) {
    const talents = { spec: spec.id, rows: {} };
    const mods = computeTalentModifiers(cls, talents, MAX_LEVEL);
    const known = abilitiesKnownAt(cls, MAX_LEVEL, mods, completedQuests);
    const abilities = new Map<string, ResolvedAbility>();
    for (const ab of known) {
      const resolved = resolveAbilityChain(ab, actor, { cls, talents }, mods);
      abilities.set(ab.def.id, applyAbilityCostTail(resolved, ab.def.id, actor, known, mods));
    }
    entries.push({ spec: spec.id, name: spec.name, abilities });
  }
  return entries;
}
const cache = new Map<PlayerClass, ReturnType<typeof resolveClass>>();

export function specializationExamples(base: ResolvedAbility): [string, string][] {
  const cls = base.def.class;
  let entries = cache.get(cls);
  if (!entries) {
    entries = resolveClass(cls);
    cache.set(cls, entries);
  }
  const round = (n: number) => Number(n.toFixed(2));
  function text(ab: ResolvedAbility): string {
    const baseText = wikiAbilityText(ab, zero);
    const powered = wikiAbilityText(ab, sample);
    const lines = [
      `'''Cost''' ${round(ab.cost)} · '''Cast''' ${ab.def.channel ? ab.def.channel.duration + ' sec channel' : ab.castTime ? round(ab.castTime) + ' sec cast' : 'instant'} · '''Cooldown''' ${ab.cooldown ? round(ab.cooldown) + ' sec cooldown' : 'none'}.`,
    ];
    if (ab.charges && ab.charges > 1) lines.push(`Holds ${ab.charges} charges.`);
    for (const e of ab.effects) {
      if (e.type === 'gainResource')
        lines.push(
          `Gives ${e.amount} ${CLASSES[cls].resourceType}, before any bonuses that change how much you gain.`,
        );
    }
    lines.push(baseText);
    if (baseText !== powered) lines.push("'''With 100 of each power:''' " + powered);
    return lines.join(' ');
  }
  const neutral = text(base);
  return entries.flatMap((entry) => {
    const ab = entry.abilities.get(base.def.id);
    if (!ab) return [];
    const value = text(ab);
    return value !== neutral ? [[entry.spec, value] as [string, string]] : [];
  });
}

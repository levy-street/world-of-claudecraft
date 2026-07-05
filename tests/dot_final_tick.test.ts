import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';
import type { AbilityDef, AbilityEffect, Aura, Entity } from '../src/sim/types';

const TICKS_PER_SECOND = 20;

type DotCase = {
  ability: AbilityDef;
  rankLabel: string;
  effect: Extract<AbilityEffect, { type: 'dot' }>;
};

function dotCases(): DotCase[] {
  const cases: DotCase[] = [];
  for (const ability of Object.values(ABILITIES)) {
    const ranks = [{ rankLabel: 'rank 1', effects: ability.effects }, ...((ability.ranks ?? []).map((rank, index) => ({
      rankLabel: `rank ${index + 2}`,
      effects: rank.effects ?? ability.effects,
    })))];
    for (const rank of ranks) {
      for (const effect of rank.effects) {
        if (effect.type === 'dot') cases.push({ ability, rankLabel: rank.rankLabel, effect });
      }
    }
  }
  return cases;
}

function addDot(target: Entity, source: Entity, ability: AbilityDef, effect: Extract<AbilityEffect, { type: 'dot' }>): Aura {
  const aura: Aura = {
    id: `${ability.id}_${effect.duration}_${effect.interval}`,
    name: ability.name,
    kind: 'dot',
    remaining: effect.duration,
    duration: effect.duration,
    value: Math.max(1, Math.round(effect.total / (effect.duration / effect.interval))),
    tickInterval: effect.interval,
    tickTimer: effect.interval,
    sourceId: source.id,
    school: ability.school,
  };
  target.auras.push(aura);
  return aura;
}

describe('damage-over-time final ticks', () => {
  it.each(dotCases().map((entry) => [
    `${entry.ability.class}.${entry.ability.id} ${entry.rankLabel} (${entry.effect.duration}s/${entry.effect.interval}s)`,
    entry,
  ] as const))('%s ticks for every interval implied by its duration', (_name, entry) => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const sourceId = sim.addPlayer(entry.ability.class, 'Dotter');
    const targetId = sim.addPlayer('warrior', 'Target');
    const source = sim.entities.get(sourceId)!;
    const target = sim.entities.get(targetId)!;
    target.maxHp = 100000;
    target.hp = target.maxHp;

    addDot(target, source, entry.ability, entry.effect);

    let damageTicks = 0;
    for (let i = 0; i < entry.effect.duration * TICKS_PER_SECOND; i++) {
      damageTicks += sim.tick().filter((event) =>
        event.type === 'damage'
        && event.sourceId === source.id
        && event.targetId === target.id
        && event.ability === entry.ability.name
      ).length;
    }

    expect(damageTicks).toBe(entry.effect.duration / entry.effect.interval);
  });
});

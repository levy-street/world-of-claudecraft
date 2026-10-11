// Absorb credit: a shield soaking a hit emits one healing-shaped `absorb`
// event per shield, credited to the shield's caster (the shielder), so the
// Healing meter and the parse recorder can report shields as healing. Runs the
// REAL dealDamage pipeline against a real Sim.ctx so the emit site under test is
// the one the engine uses.

import { describe, expect, it } from 'vitest';
import { emitAbsorbCredit } from '../src/sim/combat/absorb_credit';
import { dealDamage } from '../src/sim/combat/damage';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity, SimEvent } from '../src/sim/types';

type AbsorbEvent = Extract<SimEvent, { type: 'absorb' }>;

function absorbEvents(events: readonly SimEvent[]): AbsorbEvent[] {
  return events.filter((e): e is AbsorbEvent => e.type === 'absorb');
}

function shield(id: string, name: string, value: number, sourceId: number): Aura {
  return {
    id,
    name,
    kind: 'absorb',
    remaining: 15,
    duration: 15,
    value,
    sourceId,
    school: 'arcane',
  } as Aura;
}

describe('absorb credit (shields on the healing meter)', () => {
  it('a partly drained shield credits the shielder for exactly what it soaked', () => {
    const sim = new Sim({ seed: 11, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    const allyId = sim.addPlayer('warrior', 'Shielded');
    const ally = sim.entities.get(allyId) as Entity;
    const mobSource = { id: 9999 } as Entity;
    ally.auras.push(shield('temporal_aegis', 'Temporal Aegis', 80, sim.playerId));
    sim.drainEvents();

    dealDamage(sim.ctx, null, ally, 50, false, 'physical', null, 'hit');

    const events = sim.drainEvents();
    expect(absorbEvents(events)).toEqual([
      {
        type: 'absorb',
        sourceId: sim.playerId,
        targetId: allyId,
        amount: 50,
        ability: 'Temporal Aegis',
        abilityId: 'temporal_aegis',
      },
    ]);
    // The damage event's own aggregate is unchanged: the credit is additive.
    const dmg = events.find((e) => e.type === 'damage' && e.targetId === allyId);
    expect(dmg).toMatchObject({ type: 'damage', amount: 0, absorbed: 50 });
    void mobSource;
  });

  it('two shields from two casters each credit their own caster, innermost first', () => {
    const sim = new Sim({ seed: 12, playerClass: 'mage', autoEquip: true });
    sim.setPlayerLevel(20);
    const priestId = sim.addPlayer('priest', 'Shielder Two');
    const allyId = sim.addPlayer('warrior', 'Shielded');
    const ally = sim.entities.get(allyId) as Entity;
    ally.auras.push(shield('temporal_aegis', 'Temporal Aegis', 30, sim.playerId));
    ally.auras.push(shield('ward', 'Ward', 20, priestId));
    sim.drainEvents();

    dealDamage(sim.ctx, null, ally, 100, false, 'physical', null, 'hit');

    const credits = absorbEvents(sim.drainEvents());
    // dealDamage drains the aura list from the END (the most recent shield first).
    expect(credits.map((c) => [c.sourceId, c.amount])).toEqual([
      [priestId, 20],
      [sim.playerId, 30],
    ]);
    expect(credits.reduce((sum, c) => sum + c.amount, 0)).toBe(50);
  });

  it('never emits for a zero soak', () => {
    const emitted: SimEvent[] = [];
    emitAbsorbCredit(
      { emit: (ev) => emitted.push(ev) },
      { id: 'x', name: 'X', sourceId: 1 },
      { id: 2 },
      0,
    );
    expect(emitted).toEqual([]);
  });
});

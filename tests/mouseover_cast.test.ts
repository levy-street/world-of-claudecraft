// Tests for the Clique-style mouseover cast (castAbilityOn): a friendly
// ability cast with an explicit target id lands on that target, resolved at
// cast FINISH for timed heals (the lifecycle re-reads the target when the
// cast completes), without ever touching the caster's persistent selection.
// An invalid/stale override falls back to the classic current-friendly-
// target-else-self resolution.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'priest', noPlayer: true });
}

// The priest's first friendly timed heal (learnLevel 1), resolved from the
// primary player's known list so a content rename fails loudly here.
function timedHeal(sim: Sim): string {
  const heal = sim.known.find(
    (k) =>
      k.def.requiresTarget &&
      k.def.targetType === 'friendly' &&
      k.def.castTime > 0 &&
      k.def.effects.some((e) => e.type === 'heal'),
  );
  if (!heal) throw new Error('expected a timed friendly heal on a fresh priest');
  return heal.def.id;
}

function castToCompletion(sim: Sim, seconds: number): void {
  for (let i = 0; i < 20 * seconds; i++) sim.tick();
}

describe('mouseover cast (castAbilityOn)', () => {
  it('lands a timed heal on the explicit target without touching the selection', () => {
    const sim = makeWorld();
    const healer = sim.addPlayer('priest', 'Mender'); // primary
    const tank = sim.addPlayer('warrior', 'Tanko');
    const other = sim.addPlayer('mage', 'Blinky');
    sim.tick();
    const healId = timedHeal(sim);
    // the healer is LOOKING AT the mage, but hovers the tank's frame
    sim.targetEntity(other, healer);
    const tankEnt = sim.entities.get(tank);
    if (!tankEnt) throw new Error('tank entity missing');
    tankEnt.hp = tankEnt.maxHp - 30;
    const otherHpBefore = sim.entities.get(other)?.hp;

    sim.castAbilityOn(healId, tank, healer);
    castToCompletion(sim, 4);

    expect(tankEnt.hp).toBe(tankEnt.maxHp); // min heal (42) covers the 30 missing
    expect(sim.entities.get(other)?.hp).toBe(otherHpBefore); // bystander untouched
    expect(sim.entities.get(healer)?.targetId).toBe(other); // selection preserved
    expect(sim.entities.get(healer)?.castTargetId).toBe(null); // override consumed
  });

  it('falls back to the classic self-cast when the override id is stale', () => {
    const sim = makeWorld();
    const healer = sim.addPlayer('priest', 'Mender');
    sim.tick();
    const healId = timedHeal(sim);
    const me = sim.entities.get(healer);
    if (!me) throw new Error('healer entity missing');
    me.hp = me.maxHp - 30;

    sim.castAbilityOn(healId, 999999, healer); // no such entity
    castToCompletion(sim, 4);

    expect(me.hp).toBe(me.maxHp); // healed yourself (no target -> self rule)
    expect(me.castTargetId).toBe(null);
  });

  it('ignores a hostile-target override for friendly resolution (mob id falls back)', () => {
    const sim = makeWorld();
    const healer = sim.addPlayer('priest', 'Mender');
    sim.tick();
    const healId = timedHeal(sim);
    const mob = [...sim.entities.values()].find((e) => e.kind === 'mob');
    if (!mob) throw new Error('expected a mob in the world');
    const me = sim.entities.get(healer);
    if (!me) throw new Error('healer entity missing');
    me.hp = me.maxHp - 30;
    const mobHpBefore = mob.hp;

    sim.castAbilityOn(healId, mob.id, healer);
    castToCompletion(sim, 4);

    expect(me.hp).toBe(me.maxHp); // hostile override rejected -> self
    expect(mob.hp).toBe(mobHpBefore);
  });
});

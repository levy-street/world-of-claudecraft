import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

describe('v0.26 canonical successful-cast hooks', () => {
  it('routes a selected castNth row through the normal instant-cast lifecycle', () => {
    // The mage unify rework deleted the Rime Ambush row (mage row 8 is now a
    // survival row with no castNth hooks), so the lifecycle vehicle is the
    // surviving analogue: Ghostfoot Gambit, a castNth n=1 hook on Ghostfoot
    // (evasion), an instant self-cast, granting a scoped next_cast_cheap aura.
    const sim = new Sim({ seed: 2603, playerClass: 'rogue', autoEquip: false });
    sim.setPlayerLevel(20);
    expect(sim.selectTalentRow(17, 'rog_r17_improved_evasion')).toBe(true);

    sim.castAbility('evasion');

    expect(sim.player.auras).toContainEqual(
      expect.objectContaining({
        id: 'rog_improved_evasion',
        kind: 'next_cast_cheap',
        // value carries the discount: 1 - costPct (0.5) from the row record.
        value: 0.5,
        empowerAbilities: [
          'sinister_strike',
          'backstab',
          'gouge',
          'ambush',
          'garrote',
          'cheap_shot',
          'hemorrhage',
          'ghostly_strike',
        ],
      }),
    );
  });

  it('emits an authored Warrior cast cue with the stable ability id', () => {
    const sim = new Sim({ seed: 2604, playerClass: 'warrior', autoEquip: false });
    sim.events = [];

    sim.castAbility('battle_shout');

    expect(sim.events).toContainEqual({
      type: 'spellfx',
      sourceId: sim.player.id,
      targetId: sim.player.id,
      school: 'physical',
      fx: 'shout',
      ability: 'battle_shout',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { umbralAnchorPosition } from '../src/sim/combat/warlock_utility';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';

function makeWarlock(
  spec: 'affliction' | 'demonology' | 'destruction' = 'affliction',
  rows: Record<number, string> = {},
): Sim {
  const sim = new Sim({ seed: 808, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(20);
  expect(sim.setSpec(spec)).toBe(true);
  expect(sim.applyTalents({ spec, rows })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  return sim;
}

describe('Warlock Umbral Anchor', () => {
  it('is a shared level-5 Warlock ability in all three specializations', () => {
    for (const spec of ['affliction', 'demonology', 'destruction'] as const) {
      const before = abilitiesKnownAt('warlock', 4, {
        ...emptyModifiers(),
        spec,
      }).map((entry) => entry.def.id);
      const known = abilitiesKnownAt('warlock', 5, {
        ...emptyModifiers(),
        spec,
      }).map((entry) => entry.def.id);
      expect(before, spec).not.toContain('umbral_anchor');
      expect(known, spec).toContain('umbral_anchor');
    }
  });

  it('places for free of cooldown, then recalls and consumes the anchor', () => {
    const sim = makeWarlock();
    const origin = { ...sim.player.pos };
    const mana = sim.player.resource;

    sim.castAbility('umbral_anchor');

    expect(umbralAnchorPosition(sim.player)).toEqual(origin);
    expect(sim.player.resource).toBe(mana - 25);
    expect(sim.player.cooldowns.has('umbral_anchor')).toBe(false);

    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    sim.player.pos = { x: origin.x + 20, y: origin.y, z: origin.z };
    sim.castAbility('umbral_anchor');

    expect(sim.player.pos).toEqual(origin);
    expect(umbralAnchorPosition(sim.player)).toBeNull();
    expect(sim.player.cooldowns.get('umbral_anchor')).toBe(45);
  });

  it('refuses an out-of-range recall before spending mana or cooldown', () => {
    const sim = makeWarlock();
    sim.castAbility('umbral_anchor');
    const anchor = umbralAnchorPosition(sim.player);
    if (!anchor) throw new Error('Expected anchor');
    sim.player.gcdRemaining = 0;
    sim.player.resource = sim.player.maxResource;
    const mana = sim.player.resource;
    sim.player.pos = { x: anchor.x + 41, y: anchor.y, z: anchor.z };

    sim.castAbility('umbral_anchor');

    expect(sim.player.resource).toBe(mana);
    expect(sim.player.cooldowns.has('umbral_anchor')).toBe(false);
    expect(umbralAnchorPosition(sim.player)).toEqual(anchor);
  });

  it('makes all three mobility-row variants change the live Anchor', () => {
    const rhythmic = makeWarlock('affliction', { 5: 'wlk_r5_bane' });
    const origin = { ...rhythmic.player.pos };
    rhythmic.castAbility('umbral_anchor');
    rhythmic.player.gcdRemaining = 0;
    rhythmic.player.resource = rhythmic.player.maxResource;
    rhythmic.player.pos = { x: origin.x + 20, y: origin.y, z: origin.z };
    rhythmic.castAbility('umbral_anchor');
    expect(rhythmic.player.cooldowns.get('umbral_anchor')).toBe(30);

    const blacktide = makeWarlock('demonology', { 5: 'wlk_r5_improved_corruption' });
    const blacktideOrigin = { ...blacktide.player.pos };
    blacktide.castAbility('umbral_anchor');
    expect(blacktide.player.auras.some((aura) => aura.id === 'wlk_blacktide_speed')).toBe(false);
    blacktide.player.gcdRemaining = 0;
    blacktide.player.resource = blacktide.player.maxResource;
    blacktide.player.pos = {
      x: blacktideOrigin.x + 20,
      y: blacktideOrigin.y,
      z: blacktideOrigin.z,
    };
    blacktide.castAbility('umbral_anchor');
    expect(blacktide.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'wlk_blacktide_speed',
          kind: 'buff_speed',
          value: 1.4,
          remaining: 4,
        }),
      ]),
    );

    const marching = makeWarlock('destruction', { 5: 'wlk_r5_improved_immolate' });
    marching.castAbility('sacrilegious_march');
    expect(marching.player.auras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sacrilegious_march',
          kind: 'buff_speed',
          value: 1.35,
        }),
      ]),
    );
  });
});

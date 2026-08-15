import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { WARLOCK_PET_MOBS } from '../src/sim/content/warlock_pets';
import { Sim } from '../src/sim/sim';

const RETIRED_SUMMONS = [
  'summon_succubus',
  'summon_felhunter',
  'summon_felguard',
  'summon_doomguard',
] as const;

function knownAt(level: number, spec?: 'affliction' | 'demonology' | 'destruction'): string[] {
  return abilitiesKnownAt('warlock', level, {
    ...emptyModifiers(),
    spec: spec ?? null,
  }).map((ability) => ability.def.id);
}

function summonStarterEmberkin(): Sim {
  const sim = new Sim({ seed: 2632, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(4);
  sim.castAbility('summon_imp');
  for (let i = 0; i < 20 * 6 && sim.player.castingAbility; i++) sim.tick();
  expect(sim.petOf(sim.playerId)?.templateId).toBe('emberkin');
  sim.setPlayerLevel(5);
  return sim;
}

describe('Warlock pet progression', () => {
  it('removes retired demon summons from the Warlock class and content catalogs', () => {
    for (const abilityId of RETIRED_SUMMONS) {
      expect(CLASSES.warlock.abilities, abilityId).not.toContain(abilityId);
      expect(ABILITIES[abilityId], abilityId).toBeUndefined();
    }
    expect(Object.keys(WARLOCK_PET_MOBS)).toEqual(['emberkin', 'gloomshade', 'pyre_colossus']);
  });

  it('shares Emberkin before specialization and keeps it only for Destruction afterward', () => {
    expect(knownAt(1)).toContain('summon_imp');
    expect(knownAt(4)).toContain('summon_imp');
    expect(knownAt(5)).toContain('summon_imp');

    expect(knownAt(5, 'affliction')).not.toContain('summon_imp');
    expect(knownAt(5, 'demonology')).not.toContain('summon_imp');
    expect(knownAt(5, 'destruction')).toContain('summon_imp');
  });

  it('dismisses a starter Emberkin for Affliction and Necromancy but keeps it for Destruction', () => {
    for (const spec of ['affliction', 'demonology'] as const) {
      const sim = summonStarterEmberkin();
      const emberkin = sim.petOf(sim.playerId);
      const watcherId = sim.addPlayer('mage', `Watcher ${spec}`);
      const watcher = sim.entities.get(watcherId);
      if (!emberkin || !watcher) throw new Error('Expected Emberkin and watcher.');
      watcher.targetId = emberkin.id;

      expect(sim.setSpec(spec)).toBe(true);
      expect(sim.petOf(sim.playerId), spec).toBeNull();
      expect(watcher.targetId, spec).toBeNull();
    }

    const destruction = summonStarterEmberkin();
    const emberkin = destruction.petOf(destruction.playerId);
    expect(destruction.setSpec('destruction')).toBe(true);
    expect(destruction.petOf(destruction.playerId)).toBe(emberkin);
  });
});

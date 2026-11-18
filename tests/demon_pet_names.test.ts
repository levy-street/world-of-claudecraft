// A warlock's demon rename survives a resummon, a swap to another demon and
// back, and a relog (src/sim/pet/demon_names.ts). Demons themselves are never
// saved (pet_commands.ts isDemonPetState), so the name lives on the owner.
import { describe, expect, it } from 'vitest';
import { normalizeDemonNames } from '../src/sim/pet/demon_names';
import { summonPet } from '../src/sim/pet/pet_commands';
import { Sim } from '../src/sim/sim';

function warlock() {
  const sim = new Sim({ seed: 42, playerClass: 'warlock', autoEquip: false });
  const owner = sim.entities.get(sim.playerId)!;
  return { sim, owner, meta: sim.meta(sim.playerId)! };
}

describe('demon renames persist through summons', () => {
  it('a resummon of the same demon keeps its custom name', () => {
    const { sim, owner, meta } = warlock();
    summonPet(sim.ctx, owner, 'emberkin');
    sim.renamePet('Sparky');
    expect(sim.petOf(sim.playerId)!.name).toBe('Sparky');
    expect(meta.demonNames).toEqual({ emberkin: 'Sparky' });

    summonPet(sim.ctx, owner, 'emberkin');
    expect(sim.petOf(sim.playerId)!.name).toBe('Sparky');
  });

  it('each demon keeps its own name across a swap and back', () => {
    const { sim, owner } = warlock();
    summonPet(sim.ctx, owner, 'emberkin');
    sim.renamePet('Sparky');
    summonPet(sim.ctx, owner, 'gloomshade');
    expect(sim.petOf(sim.playerId)!.name).not.toBe('Sparky');
    sim.renamePet('Murk');
    summonPet(sim.ctx, owner, 'emberkin');
    expect(sim.petOf(sim.playerId)!.name).toBe('Sparky');
    summonPet(sim.ctx, owner, 'gloomshade');
    expect(sim.petOf(sim.playerId)!.name).toBe('Murk');
  });

  it('the names survive a save and reload', () => {
    const { sim, owner } = warlock();
    summonPet(sim.ctx, owner, 'emberkin');
    sim.renamePet('Sparky');
    const saved = sim.serializeCharacter(sim.playerId)!;
    expect(saved.pet).toBeNull(); // the demon itself is still not saved
    expect(saved.demonNames).toEqual({ emberkin: 'Sparky' });

    const next = new Sim({ seed: 42, playerClass: 'warlock', autoEquip: false });
    const pid = next.addPlayer('warlock', 'Reloaded', { state: saved, autoEquip: false });
    summonPet(next.ctx, next.entities.get(pid)!, 'emberkin');
    expect(next.petOf(pid)!.name).toBe('Sparky');
  });

  it('a save with no renamed demon writes no demonNames key', () => {
    const { sim, owner } = warlock();
    summonPet(sim.ctx, owner, 'emberkin');
    expect('demonNames' in sim.serializeCharacter(sim.playerId)!).toBe(false);
  });

  it('the load guard drops unknown templates and unclean names', () => {
    expect(
      normalizeDemonNames({
        emberkin: 'Sparky',
        gloomshade: '!!',
        forest_wolf: 'Rex',
        no_such_mob: 'Ghost',
      }),
    ).toEqual({ emberkin: 'Sparky' });
    expect(normalizeDemonNames(null)).toEqual({});
    expect(normalizeDemonNames(['Sparky'])).toEqual({});
  });
});
